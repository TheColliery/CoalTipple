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
import { loadMergedConfig, globalConfigPath, globalStateDir, oldGlobalStateDir, projectConfigPath, projectConfigCandidates, projectStateDir, claudeBaseDir, findGitRoot } from './config-load.mjs';

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

test('fableConsent persists as a project override (the "always-this-project" consent write)', () => {
  // "always-this-project" writes fableConsent=true to the PROJECT config; the cascade must read it back.
  const s = sandbox({
    global: JSON.stringify({ qualityBar: 60 }),
    project: JSON.stringify({ fableConsent: true }),
  });
  try {
    const cfg = loadMergedConfig(s);
    assert.equal(cfg.fableConsent, true, 'the project consent is read back (persisted)');
    assert.equal(cfg.qualityBar, 60, 'global keys unaffected');
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
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-h-'));
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
    assert.equal(loadMergedConfig({ cwd: sub, home }).qualityBar, 77);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a poisoned project config cannot smuggle __proto__/constructor/prototype as literal keys into the merged config', () => {
  // Raw JSON string, NOT JSON.stringify on an object literal -- `{__proto__: x}` sets the
  // PROTOTYPE at construction time and never serializes as an own key at all. A literal
  // string is required to produce a genuine own "__proto__" key on parse, matching how a
  // malicious cloned-repo's .coaltipple.json would actually arrive on disk.
  const s = sandbox({
    global: JSON.stringify({ qualityBar: 60 }),
    project: '{"__proto__":{"polluted":true},"constructor":{"x":1},"prototype":{"y":2},"qualityBar":90}',
  });
  try {
    const cfg = loadMergedConfig(s);
    assert.equal(cfg.qualityBar, 90, 'the real key still merges normally');
    assert.equal(Object.prototype.hasOwnProperty.call(cfg, '__proto__'), false, 'no own __proto__ key on the merged config');
    assert.equal(Object.prototype.hasOwnProperty.call(cfg, 'constructor'), false, 'no own constructor key on the merged config');
    assert.equal(Object.prototype.hasOwnProperty.call(cfg, 'prototype'), false, 'no own prototype key on the merged config');
  } finally { cleanup(s); }
});

test('safer-value-wins (hooks-safety.md §9): project cannot escalate mode from an explicit global off to auto', () => {
  const s = sandbox({ global: JSON.stringify({ mode: 'off' }), project: JSON.stringify({ mode: 'auto' }) });
  try { assert.equal(loadMergedConfig(s).mode, 'off', 'project may not escalate mode past the global choice'); } finally { cleanup(s); }
});

test('safer-value-wins: project MAY quieten mode from a global auto to off (the allowed direction)', () => {
  const s = sandbox({ global: JSON.stringify({ mode: 'auto' }), project: JSON.stringify({ mode: 'off' }) });
  try { assert.equal(loadMergedConfig(s).mode, 'off', 'project quietening is allowed'); } finally { cleanup(s); }
});

test('safer-value-wins: delegation-only (spend-reducing) outranks escalation (spend-increasing) in mode', () => {
  const s1 = sandbox({ global: JSON.stringify({ mode: 'delegation' }), project: JSON.stringify({ mode: 'escalation' }) });
  try { assert.equal(loadMergedConfig(s1).mode, 'delegation', 'escalation may not override a global delegation-only choice'); } finally { cleanup(s1); }
  const s2 = sandbox({ global: JSON.stringify({ mode: 'delegation' }), project: JSON.stringify({ mode: 'off' }) });
  try { assert.equal(loadMergedConfig(s2).mode, 'off', 'off is still safer than delegation, always allowed'); } finally { cleanup(s2); }
});

test('safer-value-wins: project cannot escalate updateMode from a global off to auto (mirrors the CoalMine v3.9.3 precedent)', () => {
  const s = sandbox({ global: JSON.stringify({ updateMode: 'off' }), project: JSON.stringify({ updateMode: 'auto' }) });
  try { assert.equal(loadMergedConfig(s).updateMode, 'off'); } finally { cleanup(s); }
});

test('safer-value-wins: project cannot escalate fableConsent from a global false (ask) to true (standing real-money consent)', () => {
  const s = sandbox({ global: JSON.stringify({ fableConsent: false }), project: JSON.stringify({ fableConsent: true }) });
  try { assert.equal(loadMergedConfig(s).fableConsent, false, 'project may not escalate real-money standing consent'); } finally { cleanup(s); }
});

// R2 (hooks-safety.md §9, corrected 2026-07-27): an ABSENT global is the SCHEMA DEFAULT
// for updateMode, not "anything goes" -- the previous version of this test locked in the
// opposite (wrong) behavior as expected. updateMode's factory default ('ask') is SAFER
// than what a project can escalate to, so even a zero-customization install (no global
// file at all -- the common case) must be protected. fableConsent is DELIBERATELY NOT
// covered by this same substitution -- see the next test + the code comment in
// config-load.mjs for why (it would break the shipped "always-this-project" persistence).
test('safer-value-wins clamps updateMode against the SCHEMA DEFAULT when no global file exists at all (R2 fix)', () => {
  const s = sandbox({ project: JSON.stringify({ updateMode: 'auto' }) });
  try {
    assert.equal(loadMergedConfig(s).updateMode, 'ask', "updateMode's factory default (ask) is safer than the project's auto -- clamped even with no global file");
  } finally { cleanup(s); }
});

// The DELIBERATE non-extension: fableConsent's clamp stays explicit-global-only even
// after R2, because its ONLY persistence mechanism (SKILL.md's "always" option) is a
// PROJECT-level write with no global-write counterpart -- clamping an absent global would
// silently break "always-this-project" and force a re-ask on every future fable route.
// Do NOT "fix" this to match updateMode's schema-default substitution; it was tried
// (see git history on this test) and it broke the "persists as a project override" test
// directly above.
test('safer-value-wins does NOT clamp fableConsent when global is absent -- preserves "always-this-project"', () => {
  const s = sandbox({ project: JSON.stringify({ fableConsent: true }) });
  try {
    assert.equal(loadMergedConfig(s).fableConsent, true, 'a bare project fableConsent:true with no global is the legitimate always-this-project write, not an attack -- must pass through');
  } finally { cleanup(s); }
});

// mode's factory default is ALREADY 'auto', the top (least-safe) index of its own ordering
// -- there is nothing more permissive for a project to escalate TO, so an absent global
// has nothing to clamp for this specific key. A regression guard, not new protection.
test("mode's factory default sits at the ceiling of its own ordering -- an absent global clamps nothing for it", () => {
  const s = sandbox({ project: JSON.stringify({ mode: 'off' }) });
  try {
    assert.equal(loadMergedConfig(s).mode, 'off', 'project value passes through unclamped -- auto (the default) is already the least-safe end');
  } finally { cleanup(s); }
});

test('safer-value-wins clamp is case-insensitive (a project "AUTO" must not evade the lookup via case)', () => {
  const s = sandbox({ global: JSON.stringify({ mode: 'off' }), project: JSON.stringify({ mode: 'AUTO' }) });
  try { assert.equal(loadMergedConfig(s).mode, 'off'); } finally { cleanup(s); }
});

test('CLAUDE_CONFIG_DIR redirects the GLOBAL paths (#6); comma-list -> first entry; project paths unaffected', () => {
  const saved = process.env.CLAUDE_CONFIG_DIR;
  try {
    const custom = path.join(os.tmpdir(), 'ct-cfgdir-test');
    process.env.CLAUDE_CONFIG_DIR = custom;
    assert.equal(globalConfigPath(), path.join(custom, '.coaltipple.json'), 'global config under $CLAUDE_CONFIG_DIR');
    assert.equal(globalStateDir(), path.join(custom, 'coal', 'coaltipple'), 'global state under $CLAUDE_CONFIG_DIR');
    assert.equal(claudeBaseDir(), custom);
    process.env.CLAUDE_CONFIG_DIR = `${custom},${path.join(os.tmpdir(), 'other')}`; // multi-account comma-list
    assert.equal(claudeBaseDir(), custom, 'first entry of a comma-list');
    process.env.CLAUDE_CONFIG_DIR = ','; // degenerate: first entry is empty after trim -> fall back to default
    assert.equal(claudeBaseDir('/h'), path.join('/h', '.claude'), 'degenerate comma-only value falls back to default');
    delete process.env.CLAUDE_CONFIG_DIR; // unset -> home/.claude (unchanged default)
    assert.equal(globalConfigPath('/h'), path.join('/h', '.claude', '.coaltipple.json'));
    process.env.CLAUDE_CONFIG_DIR = custom; // project path NEVER uses it
    // Namespace campaign (#69+#39): nothing exists at '/proj' -> own-dir (.claude/coal/…)
    // is the default, not the LEGACY path (see the precedence tests below for the full order).
    assert.equal(projectConfigPath('/proj'), path.join('/proj', '.claude', 'coal', 'coaltipple.json'));
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = saved;
  }
});

// ---------------------------------------------------------------------------
// Namespace campaign (#69+#39, owner-designated 2026-08-08): per-project
// config read order -- own agent dir -> other known agent dirs (fixed order)
// -> LEGACY <gitroot>/.claude/.coaltipple.json. CT's legacy shape is already
// under .claude/ (never a bare root dotfile, unlike CoalWash's legacy) --
// see projectConfigPath's own header comment for the full rail wording.
// ---------------------------------------------------------------------------

test('projectConfigCandidates: the rail order is .claude -> .agents -> .gemini -> LEGACY, always relative to the resolved git root', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-proj-'));
  try {
    assert.deepEqual(projectConfigCandidates(cwd), [
      path.join(cwd, '.claude', 'coal', 'coaltipple.json'),
      path.join(cwd, '.agents', 'coal', 'coaltipple.json'),
      path.join(cwd, '.gemini', 'coal', 'coaltipple.json'),
      path.join(cwd, '.claude', '.coaltipple.json'),
    ]);
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

test('projectConfigPath precedence 1/3: own-dir (.claude/coal) wins even when every other candidate, including LEGACY, also exists', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-proj-'));
  try {
    for (const c of projectConfigCandidates(cwd)) {
      fs.mkdirSync(path.dirname(c), { recursive: true });
      fs.writeFileSync(c, '{}', 'utf8');
    }
    assert.equal(projectConfigPath(cwd), path.join(cwd, '.claude', 'coal', 'coaltipple.json'));
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

test('projectConfigPath precedence 2/3: .claude/coal absent, .agents/coal present -> the other-known-dir entry wins over LEGACY', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-proj-'));
  try {
    const [, agentsCandidate, , legacy] = projectConfigCandidates(cwd);
    fs.mkdirSync(path.dirname(agentsCandidate), { recursive: true });
    fs.writeFileSync(agentsCandidate, '{}', 'utf8');
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, '{}', 'utf8');
    assert.equal(projectConfigPath(cwd), agentsCandidate);
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

test('projectConfigPath precedence 3/3: no new-shape candidate exists anywhere -> LEGACY is read, no breakage for an existing user', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-proj-'));
  try {
    const legacy = path.join(cwd, '.claude', '.coaltipple.json');
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, JSON.stringify({ mode: 'delegation' }), 'utf8');
    assert.equal(projectConfigPath(cwd), legacy);
    // and it actually READS through loadMergedConfig, not just resolves the path
    assert.equal(loadMergedConfig({ cwd }).mode, 'delegation');
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

test('projectConfigPath: nothing exists anywhere -> the own-dir (.claude/coal) path is the read AND write target, matching a never-configured project', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-proj-'));
  try {
    assert.equal(projectConfigPath(cwd), path.join(cwd, '.claude', 'coal', 'coaltipple.json'));
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

test('clamp-unchanged regression: safer-value-wins applies identically no matter WHICH read-order candidate supplied the project value', () => {
  const s = sandbox({ global: JSON.stringify({ mode: 'off' }) });
  try {
    // the project value arrives via the NEW own-dir shape, not the legacy path
    const ownDir = projectConfigCandidates(s.cwd)[0];
    fs.mkdirSync(path.dirname(ownDir), { recursive: true });
    fs.writeFileSync(ownDir, JSON.stringify({ mode: 'auto' }), 'utf8');
    assert.equal(loadMergedConfig(s).mode, 'off', 'a project may not escalate past a deliberate global off, regardless of which candidate file the value came from -- only the ADDRESS moved, the clamp semantics did not');
  } finally { cleanup(s); }
});

// Namespace campaign (#69+#39 part 2): the machine-global scratch state (ranking.json)
// moves under coal/ too; oldGlobalStateDir is the pre-campaign location, kept for install.mjs's migration read.
test('globalStateDir/oldGlobalStateDir return the two distinct expected paths', () => {
  assert.equal(globalStateDir('/h'), path.join('/h', '.claude', 'coal', 'coaltipple'));
  assert.equal(oldGlobalStateDir('/h'), path.join('/h', '.claude', '.coaltipple'));
});
