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
