// 29gl: the path where an install finds its lock taken over mid-run runs in a test (T-29gj-1). A REAL installer child is paused at a named point
// through the test-only seam in scripts/install.mjs (COALTIPPLE_INSTALL_TEST_PAUSE=<point>:<folder>: the child writes <folder>/<point>.reached, then waits for
// <folder>/<point>.go); while it is paused the test replaces its lock with a foreign one and plants another run's recorded work folder, then lets it go.
// The stopped run must change nothing more: not the target, not the foreign lock, not the planted folder, not the record. Zero-dep (node:test + built-ins);
// every child carries a heap cap and a timeout that kills it; each temp folder's cleanup is registered the line after it is made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sandboxEnv } from './test-env.mjs';
import { lockPathFor } from './install-lock.mjs';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INSTALL = path.join(REPO, 'scripts', 'install.mjs');
const SKILL_SRC = path.join(REPO, 'skills', 'coaltipple');
const ARGS = ['--max-old-space-size=512', INSTALL];
const PLANTED = '.coaltipple-install-fedcba9876543210';

function sandbox(t) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-takeover-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const cwd = path.join(root, 'project');
  const pauses = path.join(root, 'pauses');
  for (const d of [home, pauses, path.join(cwd, '.git')]) fs.mkdirSync(d, { recursive: true });
  return { root, home, cwd, pauses };
}
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const recordPath = (sb) => path.join(sb.home, '.claude', 'coal', 'coaltipple', 'install-record.json');
const lockFilePath = (sb, dest) => lockPathFor(sb.home, fs.realpathSync.native(dest));
const workDirs = (dest) => fs.readdirSync(dest).filter((n) => n.startsWith('.coaltipple-install-'));

// Every file's hash and every folder, keyed by path under `dir`.
function tree(dir) {
  const out = {};
  const walk = (abs, rel) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const key = rel === '' ? e.name : `${rel}/${e.name}`;
      const child = path.join(abs, e.name);
      if (e.isDirectory()) { out[`${key}/`] = 'dir'; walk(child, key); } else out[key] = sha(fs.readFileSync(child));
    }
  };
  walk(dir, '');
  return out;
}
function runOnce(sb, ...a) {
  return spawnSync(process.execPath, [...ARGS, ...a], { cwd: sb.cwd, env: sandboxEnv(sb.home), encoding: 'utf8', timeout: 60000 });
}
// A child paused at `point`: { done } resolves { code, out, err } when it exits.
function startPaused(sb, point, ...a) {
  const child = spawn(process.execPath, [...ARGS, ...a], {
    cwd: sb.cwd, env: sandboxEnv(sb.home, { COALTIPPLE_INSTALL_TEST_PAUSE: `${point}:${sb.pauses}` }), timeout: 90000, killSignal: 'SIGKILL',
  });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const done = new Promise((resolve) => child.on('close', (code) => resolve({ code, out, err })));
  return { done };
}
async function untilReached(sb, point, done) {
  const marker = path.join(sb.pauses, `${point}.reached`);
  for (let i = 0; i < 1500; i++) { // 30 s
    if (fs.existsSync(marker)) return;
    const first = await Promise.race([done.then(() => 'exited'), new Promise((r) => setTimeout(() => r('tick'), 20))]);
    assert.notEqual(first, 'exited', `the child exited before it reached ${point}`);
  }
  assert.fail(`the child did not reach ${point} within 30 s`);
}
// Replaces the paused run's lock with a foreign one that reads live, and plants another run's recorded work folder.
function takeOver(sb, dest) {
  const lockFile = lockFilePath(sb, dest);
  fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, host: os.hostname(), token: 'foreign0123456789', startedAt: new Date().toISOString() }) + '\n', 'utf8');
  const planted = path.join(fs.realpathSync.native(dest), PLANTED);
  fs.mkdirSync(path.join(planted, 'new'), { recursive: true });
  fs.writeFileSync(path.join(planted, 'new', 'x.txt'), 'the new holder\'s file\n', 'utf8');
  const rec = JSON.parse(fs.readFileSync(recordPath(sb), 'utf8'));
  rec.pending = [...(Array.isArray(rec.pending) ? rec.pending : []), planted];
  fs.writeFileSync(recordPath(sb), JSON.stringify(rec, null, 2) + '\n', 'utf8');
  return { lockFile, lockBytes: fs.readFileSync(lockFile, 'utf8'), planted, recordBytes: fs.readFileSync(recordPath(sb), 'utf8') };
}
const release = (sb, point) => fs.writeFileSync(path.join(sb.pauses, `${point}.go`), '');

test('T1. a run whose lock is taken over before the swap stops: the target, the foreign lock, the planted folder and the record are untouched', async (t) => {
  const sb = sandbox(t);
  const dest = path.join(sb.root, 'skills');
  assert.equal(runOnce(sb, dest).status, 0);
  const paused = startPaused(sb, 'before-swap', dest);
  await untilReached(sb, 'before-swap', paused.done);
  const taken = takeOver(sb, dest);
  const snapshot = tree(dest); // the earlier install, the paused run's own work folder, and the planted folder
  release(sb, 'before-swap');
  const r = await paused.done;
  assert.notEqual(r.code, 0, `(d) a non-zero exit: ${r.out}${r.err}`);
  assert.deepEqual(tree(dest), snapshot, '(a) the target is the snapshot: nothing more written or deleted in it');
  assert.deepEqual(tree(path.join(dest, 'coaltipple')), tree(SKILL_SRC), '(a) coaltipple is the earlier install');
  assert.equal(workDirs(dest).length, 2, '(a) the stopped run kept its own work folder beside the planted one');
  assert.equal(fs.readFileSync(taken.lockFile, 'utf8'), taken.lockBytes, '(b) the foreign lock is byte for byte what it was');
  assert.equal(fs.readFileSync(path.join(taken.planted, 'new', 'x.txt'), 'utf8'), 'the new holder\'s file\n', '(b) the planted work folder is untouched');
  assert.equal(fs.readFileSync(recordPath(sb), 'utf8'), taken.recordBytes, '(b) the record, with the planted entry, is byte for byte what it was');
  assert.match(r.err, /\[busy\].*taken over/, '(c) the taken-over [busy] line');
  assert.doesNotMatch(r.err, /\n\s+at /, '(c) no stack frame');
});

test('T2. a run whose lock is taken over between a pending read and its write stops: the record is not rewritten and the planted folder keeps its entry', async (t) => {
  const sb = sandbox(t);
  const dest = path.join(sb.root, 'skills');
  assert.equal(runOnce(sb, dest).status, 0);
  const paused = startPaused(sb, 'pending-drop', dest);
  await untilReached(sb, 'pending-drop', paused.done); // the swap is done and the run's own work folder is removed; only its pending entry is left to drop
  const taken = takeOver(sb, dest);
  const snapshot = tree(dest);
  const before = JSON.parse(taken.recordBytes);
  release(sb, 'pending-drop');
  const r = await paused.done;
  assert.notEqual(r.code, 0, `(d) a non-zero exit: ${r.out}${r.err}`);
  assert.deepEqual(tree(dest), snapshot, '(a) the target is the snapshot');
  assert.deepEqual(tree(path.join(dest, 'coaltipple')), tree(SKILL_SRC), '(a) the install the run had already swapped in is the shipped one');
  assert.deepEqual(workDirs(dest), [PLANTED], '(a) only the planted folder is in the target');
  assert.equal(fs.readFileSync(taken.lockFile, 'utf8'), taken.lockBytes, '(b) the foreign lock is untouched');
  assert.equal(fs.readFileSync(path.join(taken.planted, 'new', 'x.txt'), 'utf8'), 'the new holder\'s file\n', '(b) the planted folder is untouched');
  const after = fs.readFileSync(recordPath(sb), 'utf8');
  assert.equal(after, taken.recordBytes, 'the stopped run did not rewrite the record');
  // What the record holds: the run's own work folder, saved before the pause and now absent from disk (the next run drops it as absent), then the planted entry.
  assert.equal(before.pending.length, 2);
  assert.ok(!fs.existsSync(before.pending[0]), 'the first entry is the stopped run\'s own folder, already removed');
  assert.equal(before.pending[1], taken.planted, 'the planted entry is still named');
  assert.match(r.err, /\[busy\].*taken over/, '(c) the taken-over [busy] line');
  assert.doesNotMatch(r.err, /\n\s+at /, '(c) no stack frame');
});

test('the seam is inert with the variable unset or naming another point: an install pauses nowhere and writes no marker', (t) => {
  const sb = sandbox(t);
  const dest = path.join(sb.root, 'skills');
  const plain = runOnce(sb, dest);
  assert.equal(plain.status, 0, plain.stdout + plain.stderr);
  const other = spawnSync(process.execPath, [...ARGS, dest], {
    cwd: sb.cwd, env: sandboxEnv(sb.home, { COALTIPPLE_INSTALL_TEST_PAUSE: `no-such-point:${sb.pauses}` }), encoding: 'utf8', timeout: 60000,
  });
  assert.equal(other.status, 0, other.stdout + other.stderr);
  assert.deepEqual(fs.readdirSync(sb.pauses), [], 'no marker file was written');
});
