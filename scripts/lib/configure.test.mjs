// Integration tests for scripts/configure.mjs — the .coaltipple.json configurator CLI.
// Zero-dep (node:test + built-ins), per scripts-quality.md section 2. Spawns the
// real script in a sandboxed temp project so it never touches the dev machine's config.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_SCHEMA } from './config-schema.mjs';

const CONFIGURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'configure.mjs');
const stripJsonc = (raw) => JSON.parse(raw.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => (g ? '' : m)));

// A sandboxed project (cwd, with a .git anchor) AND a sandboxed home (whose
// .claude/.coaltipple.json is the GLOBAL target). USERPROFILE/HOME point at the
// sandbox home so the configurator NEVER writes the real ~/.claude.
function freshProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-cfg-'));
  fs.mkdirSync(path.join(dir, '.git')); // findGitRoot anchor
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-cfg-home-'));
  return { dir, home };
}
const globalPath = (home) => path.join(home, '.claude', '.coaltipple.json');
// Namespace campaign (#69+#39): on a fresh sandbox (nothing on disk yet), --project
// now writes to the own-dir NEW shape, not the LEGACY .claude/.coaltipple.json —
// see the precedence tests in config-load.test.mjs for the full read order.
const projectPath = (dir) => path.join(dir, '.claude', 'coal', 'coaltipple.json');
const run = ({ dir, home }, ...a) =>
  spawnSync(process.execPath, [CONFIGURE, ...a],
    { cwd: dir, env: { ...process.env, USERPROFILE: home, HOME: home }, encoding: 'utf8', timeout: 60000 });
const cleanup = ({ dir, home }) => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); };

test('default target is GLOBAL: a flag writes ~/.claude/.coaltipple.json (seeds from factory, comments preserved)', () => {
  const p = freshProject();
  try {
    const r = run(p, '--qualityBar', '85');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!fs.existsSync(projectPath(p.dir)), 'default must NOT create a project config (no-clutter)');
    const raw = fs.readFileSync(globalPath(p.home), 'utf8');
    assert.equal(stripJsonc(raw).qualityBar, 85);
    assert.ok(raw.includes('//'), 'factory comments must be preserved on write');
  } finally { cleanup(p); }
});

test('--project writes the per-project override <cwd>/.coaltipple.json and leaves the global alone', () => {
  const p = freshProject();
  try {
    const r = run(p, '--project', '--qualityBar', '90');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(projectPath(p.dir)), 'project config created under --project');
    assert.equal(stripJsonc(fs.readFileSync(projectPath(p.dir), 'utf8')).qualityBar, 90);
    assert.ok(!fs.existsSync(globalPath(p.home)), '--project must NOT touch the global config');
  } finally { cleanup(p); }
});

test('--list shows the merged effective config (project > global)', () => {
  const p = freshProject();
  try {
    run(p, '--qualityBar', '60');               // global default
    run(p, '--project', '--qualityBar', '95');  // project override
    const r = run(p, '--list');
    assert.equal(r.status, 0, r.stderr);
    const shown = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    assert.equal(shown.qualityBar, 95, 'merged --list reflects the project override winning');
  } finally { cleanup(p); }
});

test('an out-of-range int is rejected with the schema message and writes nothing (either target)', () => {
  const p = freshProject();
  try {
    const r = run(p, '--qualityBar', '150');           // qualityBar caps at 100
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /qualityBar.*<= 100/);
    assert.ok(!fs.existsSync(globalPath(p.home)), 'no config may be written on a rejected value');

    const r2 = run(p, '--project', '--maxTotalAttempts', '0'); // staircase floor is 1
    assert.notEqual(r2.status, 0);
    assert.match(r2.stderr, /maxTotalAttempts.*>= 1/);
    assert.ok(!fs.existsSync(projectPath(p.dir)), 'rejected --project value writes no project file');

    const r3 = run(p, '--maxTotalAttempts', '2.5');     // ints must be ints
    assert.notEqual(r3.status, 0);
    assert.match(r3.stderr, /maxTotalAttempts must be an integer/);
  } finally { cleanup(p); }
});

test('self-update flags wire through configure: --updateMode writes, a bad enum / sub-min day is rejected', () => {
  const p = freshProject();
  try {
    // valid: --updateMode auto persists to the global config
    const ok = run(p, '--updateMode', 'auto');
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(stripJsonc(fs.readFileSync(globalPath(p.home), 'utf8')).updateMode, 'auto');

    // reject: a bad enum value (schema message), writes nothing new
    const badMode = run(p, '--updateMode', 'sometimes');
    assert.notEqual(badMode.status, 0);
    assert.match(badMode.stderr, /updateMode.*one of/);

    // reject: updateCheckDays below the min (1)
    const badDays = run(p, '--updateCheckDays', '0');
    assert.notEqual(badDays.status, 0);
    assert.match(badDays.stderr, /updateCheckDays.*>= 1/);
  } finally { cleanup(p); }
});

test('--help lists every schema key + documents the global/--project targets', () => {
  const p = freshProject();
  try {
    const r = run(p, '--help');
    assert.equal(r.status, 0);
    for (const spec of CONFIG_SCHEMA) {
      assert.ok(r.stdout.includes(`--${spec.key}`), `help is missing --${spec.key}`);
    }
    assert.ok(r.stdout.includes('--project'), 'help must document --project');
    assert.match(r.stdout, /GLOBAL/, 'help must explain the default global target');
  } finally { cleanup(p); }
});

test('an existing config is edited in place; other keys + comments survive (project target)', () => {
  const p = freshProject();
  try {
    // Seed a minimal commented project config, then flip one value via --project.
    fs.mkdirSync(path.dirname(projectPath(p.dir)), { recursive: true });
    fs.writeFileSync(projectPath(p.dir),
      '{\n  // keep me\n  "mode": "auto",\n  "qualityBar": 60\n}\n', 'utf8');
    const r = run(p, '--project', '--mode', 'delegation');
    assert.equal(r.status, 0, r.stderr);
    const raw = fs.readFileSync(projectPath(p.dir), 'utf8');
    assert.ok(raw.includes('// keep me'), 'unrelated comment must survive');
    const cfg = JSON.parse(raw.replace(/\/\/.*$/gm, ''));
    assert.equal(cfg.mode, 'delegation');
    assert.equal(cfg.qualityBar, 60, 'untouched key must be preserved');
  } finally { cleanup(p); }
});

test('an unknown flag fails loud and writes nothing', () => {
  const p = freshProject();
  try {
    const r = run(p, '--notAKey', 'x');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Unrecognized option/);
    assert.ok(!fs.existsSync(globalPath(p.home)));
    assert.ok(!fs.existsSync(projectPath(p.dir)));
  } finally { cleanup(p); }
});

// H1: editing the last key (gitRecoveryBoundary — no trailing comma in factory) must NOT
// corrupt the file. After the write the file must parse cleanly AND hold the new value.
test('H1: editing the last config key (gitRecoveryBoundary) does not corrupt the file', () => {
  const p = freshProject();
  try {
    const r = run(p, '--gitRecoveryBoundary', 'on');
    assert.equal(r.status, 0, `expected exit 0 but got: ${r.stderr}`);
    const raw = fs.readFileSync(globalPath(p.home), 'utf8');
    // Must parse cleanly — a trailing-comma bug would throw here.
    const cfg = stripJsonc(raw);
    assert.equal(cfg.gitRecoveryBoundary, 'on', 'gitRecoveryBoundary must be updated to on');
    // The factory has no trailing comma after gitRecoveryBoundary — the rewrite must not add one.
    assert.ok(!/"gitRecoveryBoundary"[^,\n]*,/.test(raw), 'last key must not gain a trailing comma');
  } finally { cleanup(p); }
});

// H1 (regression): editing the first key still works after the same fix.
test('H1 (regression): editing a non-last key (qualityBar) still works correctly', () => {
  const p = freshProject();
  try {
    const r = run(p, '--qualityBar', '75');
    assert.equal(r.status, 0, r.stderr);
    const cfg = stripJsonc(fs.readFileSync(globalPath(p.home), 'utf8'));
    assert.equal(cfg.qualityBar, 75);
  } finally { cleanup(p); }
});

// M6: a trailing // comment on the rewritten line must be preserved.
test('M6: trailing // comment on the rewritten line is preserved', () => {
  const p = freshProject();
  try {
    fs.mkdirSync(path.dirname(projectPath(p.dir)), { recursive: true });
    // Write a config where the value line has a trailing comment.
    fs.writeFileSync(projectPath(p.dir),
      '{\n  "mode": "auto", // routing direction\n  "qualityBar": 60\n}\n', 'utf8');
    const r = run(p, '--project', '--mode', 'delegation');
    assert.equal(r.status, 0, r.stderr);
    const raw = fs.readFileSync(projectPath(p.dir), 'utf8');
    assert.ok(raw.includes('// routing direction'), 'trailing comment on rewritten line must survive');
    const cfg = stripJsonc(raw);
    assert.equal(cfg.mode, 'delegation', 'value must be updated');
  } finally { cleanup(p); }
});

// M7a: a strArr flag must NOT swallow the following flag as its value.
test('M7a: --sensitive followed by another flag does not swallow that flag as value', () => {
  const p = freshProject();
  try {
    // --sensitive with no value (next token is --mode, a flag) must error, not eat --mode.
    const r = run(p, '--sensitive', '--mode', 'delegation');
    assert.notEqual(r.status, 0, 'expected non-zero exit when strArr is given a flag as its value');
    assert.match(r.stderr, /sensitivePaths needs a comma-separated value/);
  } finally { cleanup(p); }
});

// M7b: -p is reserved for --project; updateCheckDays uses -P (uppercase).
test('M7b: -p resolves to --project (not updateCheckDays); -P sets updateCheckDays', () => {
  const p = freshProject();
  try {
    // -p without a key flag must be treated as --project; qualityBar arg selects GLOBAL above.
    // Using `-p --qualityBar 70` should write the PROJECT config (not fail with "Unrecognized '70'").
    const r = run(p, '-p', '--qualityBar', '70');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(projectPath(p.dir)), '-p must write the project config');
    assert.equal(stripJsonc(fs.readFileSync(projectPath(p.dir), 'utf8')).qualityBar, 70);

    // -P (uppercase) must set updateCheckDays.
    const r2 = run(p, '-P', '30');
    assert.equal(r2.status, 0, r2.stderr);
    assert.equal(stripJsonc(fs.readFileSync(globalPath(p.home), 'utf8')).updateCheckDays, 30);
  } finally { cleanup(p); }
});

// ---------------------------------------------------------------------------
// Namespace campaign (#69+#39): move-on-write. Unlike CoalWash (no
// project-config writer anywhere -> a structural "no writer exists" test was
// the whole proof), CT DOES write project config here, so the real behavior
// needs a real spawn, not just a grep. Structural grep is kept too, as a
// cheap regression tripwire for the mechanism's continued EXISTENCE.
// ---------------------------------------------------------------------------

test('structural: configure.mjs DOES call fs.rmSync on a legacy path inside its write logic (move-on-write exists)', () => {
  const src = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'configure.mjs'), 'utf8');
  assert.match(src, /fs\.rmSync\(\s*writeTarget\.legacyToRemove/, 'expected the move-on-write drop-old call to still be present');
});

// INSPECT Finding 1 (2026-08-08, CRITICAL, empirically reproduced): the ORIGINAL
// fixture here seeded { mode: "auto", qualityBar: 60 } -- BOTH values identical to
// the factory template's defaults -- so it could not distinguish "content carried
// over from the legacy file" from "content came from factory". The bug (seeding
// from factoryCfg instead of the legacy file in the ENOENT branch) passed this
// test for the wrong reason. Fixture now uses values that DIFFER from factory
// (fableConsent: true vs factory false; mode: "off" vs factory "auto") and
// asserts those SPECIFIC values survive at the new location.
test('move-on-write: an existing LEGACY project config with REAL customizations survives the migration -- content carried over, not replaced by factory defaults', () => {
  const p = freshProject();
  try {
    const legacy = path.join(p.dir, '.claude', '.coaltipple.json');
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, '{\n  // keep me\n  "fableConsent": true,\n  "mode": "off",\n  "qualityBar": 90\n}\n', 'utf8');
    const r = run(p, '--project', '--updateCheckDays', '30');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(projectPath(p.dir)), 'the new own-dir config must exist after the write');
    const migrated = stripJsonc(fs.readFileSync(projectPath(p.dir), 'utf8'));
    assert.equal(migrated.fableConsent, true, 'fableConsent (non-factory value) survived the migration -- the always-this-project consent record must not be destroyed');
    assert.equal(migrated.mode, 'off', 'mode:"off" (non-factory value) survived -- must NOT come back as the factory "auto" (a silent consent escalation)');
    assert.equal(migrated.qualityBar, 90, 'qualityBar (non-factory value) survived');
    assert.equal(migrated.updateCheckDays, 30, 'the edit itself still landed at the NEW location');
    assert.ok(!fs.existsSync(legacy), 'the LEGACY file must be gone -- moved, not duplicated');
    assert.doesNotMatch(r.stdout, /seeding from factory/, 'must not narrate a migration as if it were a fresh-project factory seed');
  } finally { cleanup(p); }
});

// INSPECT Finding 5 (LOW): a shadowed legacy (new-shape file already exists AND
// the legacy also exists) must still be dropped on the next write, even though
// the write target is the new-shape file, not the legacy one.
test('shadowed legacy: a legacy file coexisting with an already-migrated new-shape config is dropped on the next --project write', () => {
  const p = freshProject();
  try {
    const legacy = path.join(p.dir, '.claude', '.coaltipple.json');
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, JSON.stringify({ mode: 'delegation' }), 'utf8');
    fs.mkdirSync(path.dirname(projectPath(p.dir)), { recursive: true });
    fs.writeFileSync(projectPath(p.dir), JSON.stringify({ qualityBar: 80 }), 'utf8');
    const r = run(p, '--project', '--qualityBar', '81');
    assert.equal(r.status, 0, r.stderr);
    const kept = stripJsonc(fs.readFileSync(projectPath(p.dir), 'utf8'));
    assert.equal(kept.qualityBar, 81, 'the edit landed at the already-migrated new-shape file (the correct target all along)');
    assert.ok(!('mode' in kept), 'the shadowed legacy content must NOT leak into the new-shape file -- the new file was the read source, not the legacy');
    assert.ok(!fs.existsSync(legacy), 'the shadowed legacy file must be dropped, not left behind forever');
  } finally { cleanup(p); }
});
