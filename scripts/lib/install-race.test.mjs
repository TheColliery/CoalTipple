// 29gj: two installs on one target at the same time no longer race. The installer takes an exclusive per-target lock (lib/install-lock.mjs) under the
// user's home before it reads or writes the install record's `pending` list or touches the target, and holds it for the whole install or uninstall. A live
// lock refuses the run (one [busy] line, exit 1, nothing changed); a lock whose holder is provably dead is recovered. Zero-dep (node:test + built-ins),
// scripts-quality.md section 2; every child carries a heap cap and a timeout that kills it (testing.md, Determinism).
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
const ROUNDS = 20;

function sandbox(t) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-race-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const cwd = path.join(root, 'project');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(cwd, '.git'), { recursive: true });
  return { root, home, cwd };
}
const run = (sb, ...a) => spawnSync(process.execPath, [...ARGS, ...a], { cwd: sb.cwd, env: sandboxEnv(sb.home), encoding: 'utf8', timeout: 60000 });
// A child started now, awaited later: { code, out, err }.
function start(sb, ...a) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...ARGS, ...a], { cwd: sb.cwd, env: sandboxEnv(sb.home), timeout: 60000, killSignal: 'SIGKILL' });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => resolve({ code, out, err }));
  });
}
const recordPath = (sb) => path.join(sb.home, '.claude', 'coal', 'coaltipple', 'install-record.json');
const lockFilePath = (sb, dest) => lockPathFor(sb.home, fs.realpathSync.native(dest));
const locksIn = (sb) => {
  const dir = path.dirname(lockPathFor(sb.home, 'x'));
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.lock')) : [];
};
const pendingOf = (sb) => { try { const r = JSON.parse(fs.readFileSync(recordPath(sb), 'utf8')); return Array.isArray(r.pending) ? r.pending : []; } catch { return []; } };
const workDirs = (dest) => (fs.existsSync(dest) ? fs.readdirSync(dest).filter((n) => n.startsWith('.coaltipple-install-')) : []);

function hashFolder(dir) {
  const out = {};
  const walk = (abs, rel) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const child = path.join(abs, e.name);
      const key = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) walk(child, key);
      else out[key] = createHash('sha256').update(fs.readFileSync(child)).digest('hex');
    }
  };
  walk(dir, '');
  return out;
}
// Plants a lock at the target's lock path; returns the exact bytes written.
function plantLock(sb, dest, info) {
  const file = lockFilePath(sb, dest);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bytes = JSON.stringify({ token: 'planted0123456789', startedAt: new Date().toISOString(), host: os.hostname(), ...info }) + '\n';
  fs.writeFileSync(file, bytes, 'utf8');
  return { file, bytes };
}
// A process id that is certainly not running: a child that has exited.
function deadPid() {
  const r = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8', timeout: 30000 });
  return Number(r.stdout);
}

test('14. a live lock refuses an install: one [busy] line, exit 1, no stack frame, and the target, the record and the lock are unchanged', (t) => {
  const sb = sandbox(t);
  const dest = path.join(sb.root, 'skills');
  assert.equal(run(sb, dest).status, 0);
  const folderBefore = hashFolder(path.join(dest, 'coaltipple'));
  const recordBefore = fs.readFileSync(recordPath(sb), 'utf8');
  const lock = plantLock(sb, dest, { pid: process.pid });
  const r = run(sb, dest);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const busy = r.stderr.split(/\r?\n/).filter((l) => l.includes('[busy]'));
  assert.equal(busy.length, 1, `one [busy] line on stderr: ${r.stderr}`);
  assert.ok(busy[0].includes(String(process.pid)), 'the line names the holder process');
  assert.doesNotMatch(r.stderr, /\n\s+at /, 'no stack frame');
  assert.deepEqual(hashFolder(path.join(dest, 'coaltipple')), folderBefore, 'the installed folder is unchanged');
  assert.equal(fs.readFileSync(recordPath(sb), 'utf8'), recordBefore, 'the record is unchanged');
  assert.equal(fs.readFileSync(lock.file, 'utf8'), lock.bytes, 'the planted lock is byte for byte what it was');
  assert.deepEqual(workDirs(dest), [], 'no work folder was made');

  // an absent target stays absent
  const fresh = path.join(sb.root, 'fresh');
  fs.mkdirSync(fresh, { recursive: true });
  const lock2 = plantLock(sb, fresh, { pid: process.pid });
  const r2 = run(sb, fresh);
  assert.equal(r2.status, 1, r2.stdout + r2.stderr);
  assert.match(r2.stderr, /\[busy\]/);
  assert.ok(!fs.existsSync(path.join(fresh, 'coaltipple')), 'coaltipple was not installed');
  assert.equal(fs.readFileSync(lock2.file, 'utf8'), lock2.bytes);
});

test('14b. a lock path the installer cannot read (a folder) refuses with a message that says to remove it by hand, never that it releases on its own', (t) => {
  const sb = sandbox(t);
  const dest = path.join(sb.root, 'skills');
  fs.mkdirSync(dest, { recursive: true });
  const lockDirAsFile = lockFilePath(sb, dest);
  fs.mkdirSync(lockDirAsFile, { recursive: true }); // a folder where the lock file belongs
  const r = run(sb, dest);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /\[busy\].*cannot be read/);
  assert.match(r.stderr, /remove it by hand/);
  assert.doesNotMatch(r.stderr, /30 minutes/, 'no promise of a release that never comes');
  assert.doesNotMatch(r.stderr, /\n\s+at /, 'no stack frame');
  assert.ok(fs.lstatSync(lockDirAsFile).isDirectory(), 'the folder at the lock path is untouched');
  assert.ok(!fs.existsSync(path.join(dest, 'coaltipple')), 'nothing was installed');
});

test('15. a lock whose holder is provably dead is recovered: the install runs, the lock is gone, nothing is pending', (t) => {
  const sb = sandbox(t);
  const dest = path.join(sb.root, 'skills');
  fs.mkdirSync(dest, { recursive: true });
  plantLock(sb, dest, { pid: deadPid() });
  const r = run(sb, dest);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(hashFolder(path.join(dest, 'coaltipple')), hashFolder(SKILL_SRC), 'the skill is installed');
  assert.deepEqual(locksIn(sb), [], 'the lock is gone');
  assert.deepEqual(pendingOf(sb), []);
});

test('16. a dead run recorded work folder is recovered under a dead-holder lock: the earlier install comes back, the fresh one replaces it, everything is cleaned up', (t) => {
  const sb = sandbox(t);
  const dest = path.join(sb.root, 'skills');
  assert.equal(run(sb, dest).status, 0);
  const holder = path.join(fs.realpathSync.native(dest), '.coaltipple-install-0123456789abcdef');
  fs.mkdirSync(holder);
  fs.renameSync(path.join(dest, 'coaltipple'), path.join(holder, 'old'));
  const rec = JSON.parse(fs.readFileSync(recordPath(sb), 'utf8'));
  rec.pending = [holder];
  fs.writeFileSync(recordPath(sb), JSON.stringify(rec, null, 2) + '\n', 'utf8');
  plantLock(sb, dest, { pid: deadPid() });
  const r = run(sb, dest);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /restored the earlier install/);
  assert.deepEqual(hashFolder(path.join(dest, 'coaltipple')), hashFolder(SKILL_SRC), 'the skill is installed');
  assert.ok(!fs.existsSync(holder), 'the work folder is gone');
  assert.deepEqual(pendingOf(sb), [], 'pending is gone');
  assert.deepEqual(locksIn(sb), [], 'the lock is gone');
});

test(`17. ${ROUNDS} rounds of two installs started together on one fresh target: always the shipped files, no work folder, no pending, no lock, every refusal a clean [busy]`, async (t) => {
  let refusalRounds = 0;
  for (let i = 0; i < ROUNDS; i++) {
    const sb = sandbox(t);
    const dest = path.join(sb.root, 'skills');
    const both = [start(sb, dest), start(sb, dest)]; // both children exist before either is awaited
    const results = await Promise.all(both);
    const label = `round ${i + 1}: ${results.map((x) => `exit ${x.code}`).join(', ')}`;
    for (const x of results) {
      assert.ok(x.code === 0 || x.code === 1, `${label}: ${x.out}${x.err}`);
      assert.doesNotMatch(x.err, /\n\s+at /, `${label}: no stack frame`);
      if (x.code === 1) assert.match(x.err, /\[busy\]/, `${label}: an exit 1 is a refusal: ${x.out}${x.err}`);
    }
    assert.ok(results.some((x) => x.code === 0), `${label}: at least one run installed`);
    if (results.some((x) => x.code === 1)) refusalRounds++;
    assert.deepEqual(hashFolder(path.join(dest, 'coaltipple')), hashFolder(SKILL_SRC), `${label}: the target holds exactly the shipped files`);
    assert.deepEqual(workDirs(dest), [], `${label}: no work folder is left`);
    assert.deepEqual(pendingOf(sb), [], `${label}: no pending`);
    assert.deepEqual(locksIn(sb), [], `${label}: no lock file is left`);
  }
  t.diagnostic(`race rounds with a refusal: ${refusalRounds} of ${ROUNDS}`);
});

test('18. a live lock refuses an uninstall the same way: exit 1, [busy], the installed folder untouched', (t) => {
  const sb = sandbox(t);
  const dest = path.join(sb.root, 'skills');
  assert.equal(run(sb, dest).status, 0);
  const folderBefore = hashFolder(path.join(dest, 'coaltipple'));
  const recordBefore = fs.readFileSync(recordPath(sb), 'utf8');
  const lock = plantLock(sb, dest, { pid: process.pid });
  const r = run(sb, '--uninstall', dest);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /\[busy\]/);
  assert.doesNotMatch(r.stderr, /\n\s+at /);
  assert.deepEqual(hashFolder(path.join(dest, 'coaltipple')), folderBefore, 'the folder is untouched');
  assert.equal(fs.readFileSync(recordPath(sb), 'utf8'), recordBefore, 'the record is unchanged');
  assert.equal(fs.readFileSync(lock.file, 'utf8'), lock.bytes);
});
