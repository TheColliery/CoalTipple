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
const projectPath = (dir) => path.join(dir, '.claude', '.coaltipple.json');
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
    fs.mkdirSync(path.join(p.dir, '.claude'), { recursive: true });
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
    fs.mkdirSync(path.join(p.dir, '.claude'), { recursive: true });
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
