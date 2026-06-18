// Install integration test — spawns the real installer into a sandbox.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const INSTALL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'install.mjs');
// Sandbox HOME too: a throwaway home so the GLOBAL-config code path (the ~/.claude
// global-dest check AND the shared ranking) can never read or write the real config.
function mkHome() { return fs.mkdtempSync(path.join(os.tmpdir(), 'ct-install-home-')); }
const run = (cwd, home, ...a) =>
  spawnSync(process.execPath, [INSTALL, ...a],
    { cwd, env: { ...process.env, USERPROFILE: home, HOME: home }, encoding: 'utf8', timeout: 30000 });

// Canonical NEW paths (everything under .claude): the project config + state live at
// <cwd>/.claude; the SHARED model ranking lives at <home>/.claude/.coaltipple/.
const projCfg = (tmp) => path.join(tmp, '.claude', '.coaltipple.json');
const projState = (tmp) => path.join(tmp, '.claude', '.coaltipple');
const globalRanking = (home) => path.join(home, '.claude', '.coaltipple', 'ranking.json');
const globalCfg = (home) => path.join(home, '.claude', '.coaltipple.json');

test('install to a PATH: copies skill, seeds project config + conductor + the shared global ranking', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-install-'));
  const home = mkHome();
  const dest = path.join(tmp, 'skills');
  try {
    const r = run(tmp, home, dest);
    assert.equal(r.status, 0, `install must pass:\n${r.stdout}${r.stderr}`);
    assert.ok(fs.existsSync(path.join(dest, 'coaltipple', 'SKILL.md')), 'SKILL.md installed');
    assert.ok(fs.existsSync(projCfg(tmp)), 'project config seeded under <cwd>/.claude');
    // Seeds the POPULATED factory keywords (visible + editable), with repo-build markers/comment stripped.
    const seeded = fs.readFileSync(projCfg(tmp), 'utf8');
    assert.match(seeded, /"concurrency":/, 'seeded config ships the populated keyword groups');
    assert.doesNotMatch(seeded, /coaltipple-shared:/, 'no repo-build markers leak into a user config');
    assert.doesNotMatch(seeded, /GENERATED from keywords\.mjs/, 'no build-machinery comment leaks into a user config');
    // The ranking is GLOBAL (platform-level, shared) — any install seeds it under ~/.claude.
    const ranking = JSON.parse(fs.readFileSync(globalRanking(home), 'utf8'));
    assert.equal(ranking.complete, true, 'ranking is complete');
    assert.ok(ranking.tiers.low.includes('haiku'), 'alias floor: low=haiku');
    assert.ok(ranking.tiers.heavy.includes('opus'), 'alias floor: heavy=opus');
    assert.ok(fs.existsSync(path.join(projState(tmp), 'hooks', 'coaltipple-conductor.js')), 'conductor copied under <cwd>/.claude');
    // A PATH install seeds the shared ranking but must NOT seed the global CONFIG.
    assert.ok(!fs.existsSync(globalCfg(home)), 'PATH install leaves the global config alone');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); }
});

test('GLOBAL install (--global): seeds the global config + shared ranking, NO project files', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-global-'));
  const home = mkHome();
  try {
    const r = run(tmp, home, '--global', path.join(home, '.claude', 'skills'));
    assert.equal(r.status, 0, `global install must pass:\n${r.stdout}${r.stderr}`);
    assert.ok(fs.existsSync(globalCfg(home)), 'global config seeded under ~/.claude');
    assert.ok(fs.existsSync(globalRanking(home)), 'shared ranking seeded under ~/.claude/.coaltipple');
    // No-clutter: a global install must NOT create any project file (config / ranking).
    assert.ok(!fs.existsSync(projCfg(tmp)), 'no project config from a global install');
    assert.ok(!fs.existsSync(path.join(projState(tmp), 'ranking.json')), 'no project ranking from a global install');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); }
});

test('GLOBAL config preservation: reinstall keeps a customized global config; --reset --global restores factory', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-gpreserve-'));
  const home = mkHome();
  const gcfg = globalCfg(home);
  try {
    run(tmp, home, '--global');                          // first: seed factory global config
    fs.writeFileSync(gcfg, '{ "qualityBar": 77 }', 'utf8'); // user customizes the global config
    run(tmp, home, '--global');                          // re-run -> must PRESERVE
    assert.match(fs.readFileSync(gcfg, 'utf8'), /77/, 'reinstall PRESERVES the global config');
    const reset = run(tmp, home, '--reset', '--global'); // explicit global reset
    assert.equal(reset.status, 0, `reset must pass:\n${reset.stdout}${reset.stderr}`);
    assert.doesNotMatch(fs.readFileSync(gcfg, 'utf8'), /"qualityBar": 77/, 'reset --global OVERWRITES to factory');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); }
});

test('reinstall is clean (no stale skill files); uninstall removes the skill', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-reinstall-'));
  const home = mkHome();
  const dest = path.join(tmp, 'skills');
  try {
    run(tmp, home, dest);
    fs.writeFileSync(path.join(dest, 'coaltipple', 'STALE.md'), 'old', 'utf8');
    run(tmp, home, dest);
    assert.ok(!fs.existsSync(path.join(dest, 'coaltipple', 'STALE.md')), 'reinstall wipes stale files');
    assert.ok(fs.existsSync(path.join(dest, 'coaltipple', 'SKILL.md')), 'skill still present');

    const un = run(tmp, home, '--uninstall', dest);
    assert.equal(un.status, 0);
    assert.ok(!fs.existsSync(path.join(dest, 'coaltipple')), 'skill removed on uninstall');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); }
});

test('project config preservation: reinstall never overwrites it; a project --reset does, but leaves the shared ranking alone', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-preserve-'));
  const home = mkHome();
  const dest = path.join(tmp, 'skills');
  const cfg = projCfg(tmp);
  const rp = globalRanking(home); // the ranking is shared / global now
  try {
    run(tmp, home, dest);                                    // first install -> project config + shared ranking
    fs.writeFileSync(cfg, '{ "qualityBar": 95 }', 'utf8');   // user customizes their project config
    const r0 = JSON.parse(fs.readFileSync(rp, 'utf8'));
    r0.source = 'user-refined';                              // mark the shared ranking as user-refined (e.g. pinned)
    fs.writeFileSync(rp, JSON.stringify(r0), 'utf8');

    run(tmp, home, dest);                                    // REINSTALL (a skill update)
    assert.match(fs.readFileSync(cfg, 'utf8'), /95/, 'reinstall PRESERVES the project config');
    assert.equal(JSON.parse(fs.readFileSync(rp, 'utf8')).source, 'user-refined', 'reinstall PRESERVES the shared ranking');

    const reset = run(tmp, home, '--reset');                 // project-scoped reset (config only)
    assert.equal(reset.status, 0, `reset must pass:\n${reset.stdout}${reset.stderr}`);
    assert.doesNotMatch(fs.readFileSync(cfg, 'utf8'), /"qualityBar": 95/, 'project --reset OVERWRITES the project config to factory');
    assert.equal(JSON.parse(fs.readFileSync(rp, 'utf8')).source, 'user-refined', 'a project --reset leaves the GLOBAL ranking alone (reset it with --reset --global)');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); }
});
