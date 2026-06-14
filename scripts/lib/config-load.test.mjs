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
import { loadMergedConfig, globalConfigPath, projectConfigPath } from './config-load.mjs';

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
