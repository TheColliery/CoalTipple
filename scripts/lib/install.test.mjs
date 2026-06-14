// Install integration test — spawns the real installer into a sandbox.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const INSTALL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'install.mjs');
// Sandbox HOME too: a throwaway home so the GLOBAL-config code path (and the
// ~/.claude global-dest check) can never read or write the real machine config.
function mkHome() { return fs.mkdtempSync(path.join(os.tmpdir(), 'ct-install-home-')); }
const run = (cwd, home, ...a) =>
  spawnSync(process.execPath, [INSTALL, ...a],
    { cwd, env: { ...process.env, USERPROFILE: home, HOME: home }, encoding: 'utf8', timeout: 30000 });

test('install to a PATH: copies skill, seeds project config + floor ranking + conductor', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-install-'));
  const home = mkHome();
  const dest = path.join(tmp, 'skills');
  try {
    const r = run(tmp, home, dest);
    assert.equal(r.status, 0, `install must pass:\n${r.stdout}${r.stderr}`);
    assert.ok(fs.existsSync(path.join(dest, 'coaltipple', 'SKILL.md')), 'SKILL.md installed');
    assert.ok(fs.existsSync(path.join(tmp, '.coaltipple.json')), 'project config seeded');
    const ranking = JSON.parse(fs.readFileSync(path.join(tmp, '.coaltipple', 'ranking.json'), 'utf8'));
    assert.equal(ranking.complete, true, 'ranking is complete');
    assert.ok(ranking.tiers.low.includes('haiku'), 'alias floor: low=haiku');
    assert.ok(ranking.tiers.heavy.includes('opus'), 'alias floor: heavy=opus');
    assert.ok(fs.existsSync(path.join(tmp, '.coaltipple', 'hooks', 'coaltipple-conductor.js')), 'conductor copied');
    // A PATH install is PROJECT-scoped: it must NOT seed the global config.
    assert.ok(!fs.existsSync(path.join(home, '.claude', '.coaltipple.json')), 'PATH install leaves the global config alone');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); }
});

test('GLOBAL install (--global): seeds ~/.claude/.coaltipple.json and NO project files', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-global-'));
  const home = mkHome();
  try {
    const r = run(tmp, home, '--global', path.join(home, '.claude', 'skills'));
    assert.equal(r.status, 0, `global install must pass:\n${r.stdout}${r.stderr}`);
    assert.ok(fs.existsSync(path.join(home, '.claude', '.coaltipple.json')), 'global config seeded under ~/.claude');
    // No-clutter: a global install must NOT create a project config / ranking / conductor.
    assert.ok(!fs.existsSync(path.join(tmp, '.coaltipple.json')), 'no project config from a global install');
    assert.ok(!fs.existsSync(path.join(tmp, '.coaltipple', 'ranking.json')), 'no project ranking from a global install');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); }
});

test('GLOBAL config preservation: reinstall keeps a customized global config; --reset --global restores factory', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-gpreserve-'));
  const home = mkHome();
  const gcfg = path.join(home, '.claude', '.coaltipple.json');
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
    // plant a stale file inside the installed skill, then reinstall -> must be gone
    fs.writeFileSync(path.join(dest, 'coaltipple', 'STALE.md'), 'old', 'utf8');
    run(tmp, home, dest);
    assert.ok(!fs.existsSync(path.join(dest, 'coaltipple', 'STALE.md')), 'reinstall wipes stale files');
    assert.ok(fs.existsSync(path.join(dest, 'coaltipple', 'SKILL.md')), 'skill still present');

    const un = run(tmp, home, '--uninstall', dest);
    assert.equal(un.status, 0);
    assert.ok(!fs.existsSync(path.join(dest, 'coaltipple')), 'skill removed on uninstall');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); }
});

test('project config preservation: (re)install never overwrites user config/ranking; --reset does', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-preserve-'));
  const home = mkHome();
  const dest = path.join(tmp, 'skills');
  const cfg = path.join(tmp, '.coaltipple.json');
  const rp = path.join(tmp, '.coaltipple', 'ranking.json');
  try {
    run(tmp, home, dest);                                    // first install -> seeds factory config + floor ranking
    fs.writeFileSync(cfg, '{ "qualityBar": 95 }', 'utf8');   // user customizes their config
    const r0 = JSON.parse(fs.readFileSync(rp, 'utf8'));
    r0.source = 'introspection-refined';                     // mark the ranking as agent-refined
    fs.writeFileSync(rp, JSON.stringify(r0), 'utf8');

    run(tmp, home, dest);                                    // REINSTALL (a skill update)
    assert.match(fs.readFileSync(cfg, 'utf8'), /95/, 'reinstall PRESERVES the user config');
    assert.equal(JSON.parse(fs.readFileSync(rp, 'utf8')).source, 'introspection-refined', 'reinstall PRESERVES the ranking');

    const reset = run(tmp, home, '--reset');                 // the explicit reset-all button (project-scoped)
    assert.equal(reset.status, 0, `reset must pass:\n${reset.stdout}${reset.stderr}`);
    assert.doesNotMatch(fs.readFileSync(cfg, 'utf8'), /"qualityBar": 95/, 'reset OVERWRITES config to factory');
    assert.equal(JSON.parse(fs.readFileSync(rp, 'utf8')).source, 'install-floor', 'reset re-seeds the floor ranking');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); }
});
