// Unit tests for the 2-level config cascade (scripts/lib/config-load.mjs).
// Zero-dep (node:test + built-ins), per scripts-quality.md section 2. Each test
// sandboxes BOTH layers: a throwaway `home` (whose .claude/.coaltipple.json is the
// GLOBAL file) and a throwaway `cwd` (whose .claude/.coaltipple.json is the PROJECT file),
// so a real machine config can never leak in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadMergedConfig, globalConfigPath, globalStateDir, projectConfigPath, projectStateDir, claudeBaseDir, findGitRoot } from './config-load.mjs';

// Build a sandbox with optional global/project file bodies; returns { home, cwd }.
function sandbox({ global, project } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-home-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-proj-'));
  if (global !== undefined) {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.writeFileSync(globalConfigPath(home), global, 'utf8');
  }
  if (project !== undefined) {
    fs.mkdirSync(path.dirname(projectConfigPath(cwd)), { recursive: true }); // <cwd>/.claude
    fs.writeFileSync(projectConfigPath(cwd), project, 'utf8');
  }
  return { home, cwd };
}
const cleanup = ({ home, cwd }) => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(cwd, { recursive: true, force: true });
};

test('project overrides global per-key; non-overlapping keys from both survive', () => {
  const s = sandbox({
    global: JSON.stringify({ qualityBar: 60, mode: 'auto', language: 'en' }),
    project: JSON.stringify({ qualityBar: 90, language: 'th' }),
  });
  try {
    const cfg = loadMergedConfig(s);
    assert.equal(cfg.qualityBar, 90, 'project value wins');
    assert.equal(cfg.language, 'th', 'project value wins');
    assert.equal(cfg.mode, 'auto', 'global-only key survives the merge');
  } finally { cleanup(s); }
});

test('modelTiers deep-merges PER-TIER — a project pin refines one tier, global pins survive', () => {
  const s = sandbox({
    global: JSON.stringify({ modelTiers: { reasoning: 'fable', heavy: 'opus' }, qualityBar: 60 }),
    project: JSON.stringify({ modelTiers: { heavy: 'sonnet' } }),
  });
  try {
    const cfg = loadMergedConfig(s);
    // project refines `heavy`; the global `reasoning: fable` pin is NOT wiped (the bug was a shallow spread replacing the whole obj)
    assert.deepEqual(cfg.modelTiers, { reasoning: 'fable', heavy: 'sonnet' });
    assert.equal(cfg.qualityBar, 60, 'other global keys unaffected');
  } finally { cleanup(s); }
});

test('modelTiers from one layer only passes through unchanged', () => {
  const g = sandbox({ global: JSON.stringify({ modelTiers: { reasoning: 'fable' } }) });
  try { assert.deepEqual(loadMergedConfig(g).modelTiers, { reasoning: 'fable' }); } finally { cleanup(g); }
  const p = sandbox({ project: JSON.stringify({ modelTiers: { heavy: 'opus' } }) });
  try { assert.deepEqual(loadMergedConfig(p).modelTiers, { heavy: 'opus' }); } finally { cleanup(p); }
});

test('global-only when no project file exists', () => {
  const s = sandbox({ global: JSON.stringify({ qualityBar: 75, mode: 'delegation' }) });
  try {
    const cfg = loadMergedConfig(s);
    assert.equal(cfg.qualityBar, 75);
    assert.equal(cfg.mode, 'delegation');
  } finally { cleanup(s); }
});

test('project-only when no global file exists', () => {
  const s = sandbox({ project: JSON.stringify({ qualityBar: 42 }) });
  try {
    const cfg = loadMergedConfig(s);
    assert.equal(cfg.qualityBar, 42);
  } finally { cleanup(s); }
});

test('empty object when neither file exists (schema defaults apply downstream)', () => {
  const s = sandbox();
  try {
    assert.deepEqual(loadMergedConfig(s), {});
  } finally { cleanup(s); }
});

test('JSONC comments and a leading BOM are tolerated in both layers', () => {
  const s = sandbox({
    global: '﻿{\n  // global default\n  "qualityBar": 50,\n  "mode": "auto" /* inline */\n}',
    project: '{\n  // project override\n  "qualityBar": 88\n}',
  });
  try {
    const cfg = loadMergedConfig(s);
    assert.equal(cfg.qualityBar, 88, 'project override parsed past comments + BOM');
    assert.equal(cfg.mode, 'auto', 'global value parsed past comments + BOM');
  } finally { cleanup(s); }
});

test('a corrupt file never throws — the other layer still loads', () => {
  // Corrupt GLOBAL, valid PROJECT -> returns the project keys, no throw.
  const s1 = sandbox({ global: '{ this is not json', project: JSON.stringify({ qualityBar: 70 }) });
  try {
    assert.equal(loadMergedConfig(s1).qualityBar, 70);
  } finally { cleanup(s1); }
  // Corrupt PROJECT, valid GLOBAL -> returns the global keys, no throw.
  const s2 = sandbox({ global: JSON.stringify({ qualityBar: 33 }), project: '}{ broken' });
  try {
    assert.equal(loadMergedConfig(s2).qualityBar, 33);
  } finally { cleanup(s2); }
});

test('project config anchors at the GIT ROOT, not raw cwd — a subdir cwd reads the root file (#3 path drift)', () => {
  // Build <root>/.git + <root>/.claude/.coaltipple.json, then resolve from a nested subdir.
  // Before the fix, projectConfigPath used raw cwd -> a subdir read a DIFFERENT (absent) file
  // than the conductor/configure (which use findGitRoot), so per-project overrides mis-applied.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-gitroot-'));
  try {
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', '.coaltipple.json'), JSON.stringify({ qualityBar: 77 }), 'utf8');
    const sub = path.join(root, 'pkg', 'src', 'deep');
    fs.mkdirSync(sub, { recursive: true });
    // findGitRoot walks the subdir up to the .git root.
    assert.equal(findGitRoot(sub), root, 'findGitRoot resolves the subdir to the git root');
    // projectConfigPath/projectStateDir from the subdir land on the ROOT, not the subdir.
    assert.equal(projectConfigPath(sub), path.join(root, '.claude', '.coaltipple.json'));
    assert.equal(projectStateDir(sub), path.join(root, '.claude', '.coaltipple'));
    // The merged read from the subdir picks up the root project override.
    assert.equal(loadMergedConfig({ cwd: sub, home: fs.mkdtempSync(path.join(os.tmpdir(), 'ct-h-')) }).qualityBar, 77);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('CLAUDE_CONFIG_DIR redirects the GLOBAL paths (#6); comma-list -> first entry; project paths unaffected', () => {
  const saved = process.env.CLAUDE_CONFIG_DIR;
  try {
    const custom = path.join(os.tmpdir(), 'ct-cfgdir-test');
    process.env.CLAUDE_CONFIG_DIR = custom;
    assert.equal(globalConfigPath(), path.join(custom, '.coaltipple.json'), 'global config under $CLAUDE_CONFIG_DIR');
    assert.equal(globalStateDir(), path.join(custom, '.coaltipple'), 'global state under $CLAUDE_CONFIG_DIR');
    assert.equal(claudeBaseDir(), custom);
    process.env.CLAUDE_CONFIG_DIR = `${custom},${path.join(os.tmpdir(), 'other')}`; // multi-account comma-list
    assert.equal(claudeBaseDir(), custom, 'first entry of a comma-list');
    process.env.CLAUDE_CONFIG_DIR = ','; // degenerate: first entry is empty after trim -> fall back to default
    assert.equal(claudeBaseDir('/h'), path.join('/h', '.claude'), 'degenerate comma-only value falls back to default');
    delete process.env.CLAUDE_CONFIG_DIR; // unset -> home/.claude (unchanged default)
    assert.equal(globalConfigPath('/h'), path.join('/h', '.claude', '.coaltipple.json'));
    process.env.CLAUDE_CONFIG_DIR = custom; // project path NEVER uses it
    assert.equal(projectConfigPath('/proj'), path.join('/proj', '.claude', '.coaltipple.json'));
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = saved;
  }
});
