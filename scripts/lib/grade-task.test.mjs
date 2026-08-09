// Integration tests for scripts/grade-task.mjs -- the -p-dispatch grading CLI (board
// #44, COALTIPPLE_RESIDENT_DISPATCH_DESIGN.md). Zero new grading logic to test here --
// grade()/resolveWorker() already have their own suites (grade.test.mjs,
// classify.test.mjs); these tests only cover the CLI skin: argv parsing, JSON output
// shape, and the tier-only degrade when no global ranking exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GRADE_TASK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'grade-task.mjs');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ct-grade-home-'));
}
// CLAUDE_CONFIG_DIR is DELETED so it can never redirect claudeBaseDir off the
// sandbox home (config-load.test.mjs's own #6 precedent).
const run = (home, ...a) => {
  const env = { ...process.env, USERPROFILE: home, HOME: home };
  delete env.CLAUDE_CONFIG_DIR;
  return spawnSync(process.execPath, [GRADE_TASK, ...a], { cwd: home, env, encoding: 'utf8', timeout: 60000 });
};

test('no --prompt: prints usage and exits non-zero (fail-loud CLI, not a hook)', () => {
  const home = freshHome();
  try {
    const r = run(home);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /Usage: node scripts\/grade-task\.mjs/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('--help: prints usage and exits 0', () => {
  const home = freshHome();
  try {
    const r = run(home, '--help');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Usage:/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('board #44 F1: --file followed by a flag-shaped token errors loud instead of swallowing it as a phantom file + dropping the next flag\'s value', () => {
  const home = freshHome();
  try {
    // BEFORE the fix this produced files:[{path:"--size-units",lines:0}] and
    // sizeUnits:0 -- a wrong grade printed with full confidence, no warning.
    const r = run(home, '--prompt', 'x', '--file', '--size-units', '5');
    assert.notEqual(r.status, 0, 'a flag-shaped next token after --file must fail loud, not silently consume it');
    assert.match(r.stderr, /--file needs a value/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('board #44 F1 (same exposure, --size-units): a flag-shaped next token errors loud instead of Number()-coercing to NaN->0', () => {
  const home = freshHome();
  try {
    const r = run(home, '--prompt', 'x', '--size-units', '--file', 'a.js');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /--size-units needs a value/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('--size-units given a non-numeric value (not flag-shaped) still errors loud rather than silently coercing to 0', () => {
  const home = freshHome();
  try {
    const r = run(home, '--prompt', 'x', '--size-units', 'banana');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /--size-units needs a numeric value/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('--file/--size-units at the very end of argv (no next token at all) errors loud too, not just the flag-shaped case', () => {
  const home = freshHome();
  try {
    const r = run(home, '--prompt', 'x', '--file');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /--file needs a value/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('trivial prompt, no files: grade 1, tier low, no sensitive flag, tier-only (no global ranking in the sandbox home)', () => {
  const home = freshHome();
  try {
    const r = run(home, '--prompt', 'read the README and summarize it');
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.grade, 1);
    assert.equal(out.tier, 'low');
    assert.equal(out.sensitive, false);
    assert.equal(out.suggestedModel, null, 'no ranking on disk in the sandboxed home -> tier-only, never a fabricated model name');
    assert.equal(out.modelSource, 'tier-only');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('a sensitive-path file argument floors the grade at 4 and sets sensitive:true, matching grade() directly', () => {
  const home = freshHome();
  try {
    const r = run(home, '--prompt', 'tweak the timeout', '--file', 'src/auth/session.js:40');
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.grade, 4);
    assert.equal(out.tier, 'heavy');
    assert.equal(out.sensitive, true);
    assert.ok(out.reasons.some((x) => x.includes('sensitive path')));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('--file with no lines suffix defaults lines to 0 but still runs the sensitive-path check on the path alone', () => {
  const home = freshHome();
  try {
    const r = run(home, '--prompt', 'quick look', '--file', 'src/crypto/hash.js');
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.sensitive, true, 'a bare path (no :lines) must still trip the sensitive-path floor');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('a global ranking on disk resolves suggestedModel via resolveWorker (modelSource: global-ranking)', () => {
  const home = freshHome();
  try {
    const stateDir = path.join(home, '.claude', 'coal', 'coaltipple');
    fs.mkdirSync(stateDir, { recursive: true });
    const ranking = {
      schemaVer: 1, complete: true, listHash: 'x',
      tiers: { local: [], low: ['haiku'], mid: ['sonnet'], heavy: ['opus'], reasoning: ['fable'] },
    };
    fs.writeFileSync(path.join(stateDir, 'ranking.json'), JSON.stringify(ranking), 'utf8');
    const r = run(home, '--prompt', 'refactor this large module', '--file', 'a.js:1200');
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.tier, 'heavy');
    assert.equal(out.suggestedModel, 'opus');
    assert.equal(out.modelSource, 'global-ranking');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
