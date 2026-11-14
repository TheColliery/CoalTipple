// Unit tests for the installer's per-target lock (lib/install-lock.mjs, 29gj). The process table and the clock are injected, so no real process is
// signalled and no real time passes. Zero-dep (node:test + built-ins); each temp folder's cleanup is registered the line after it is made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { takeLock, releaseLock, holdsLock, lockPathFor, LOCK_STALE_MS } from './install-lock.mjs';

const HOST = 'test-host';
const T0 = Date.parse('2026-11-14T00:00:00.000Z');
const alive = () => {};
const gone = () => { const e = new Error('no such process'); e.code = 'ESRCH'; throw e; };
const denied = () => { const e = new Error('not permitted'); e.code = 'EPERM'; throw e; };

function lockFile(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-lock-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'locks', 'a.lock');
}
const deps = (extra = {}) => ({ pid: 4242, host: HOST, now: () => T0, kill: alive, token: 'tok-this-run', ...extra });
const plant = (file, info) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bytes = JSON.stringify({ pid: 777, host: HOST, token: 'tok-other', startedAt: new Date(T0).toISOString(), ...info }) + '\n';
  fs.writeFileSync(file, bytes, 'utf8');
  return bytes;
};

test('take then release: the lock holds one JSON line naming this run, and the release deletes it', (t) => {
  const file = lockFile(t);
  const r = takeLock(file, deps());
  assert.deepEqual(r, { ok: true, token: 'tok-this-run' });
  const body = fs.readFileSync(file, 'utf8');
  assert.ok(body.endsWith('\n') && body.split('\n').length === 2, 'one line');
  assert.deepEqual(JSON.parse(body), { pid: 4242, host: HOST, token: 'tok-this-run', startedAt: '2026-11-14T00:00:00.000Z' });
  assert.equal(holdsLock(file, 'tok-this-run'), true);
  assert.equal(releaseLock(file, 'tok-this-run'), 'released');
  assert.ok(!fs.existsSync(file));
});

test('a live lock refuses a second take and is left byte for byte as it was', (t) => {
  const file = lockFile(t);
  const bytes = plant(file, {});
  const r = takeLock(file, deps({ token: 'tok-second' }));
  assert.equal(r.ok, false);
  assert.deepEqual(r.busy, { pid: 777, startedAt: '2026-11-14T00:00:00.000Z', unreadable: false });
  assert.equal(fs.readFileSync(file, 'utf8'), bytes);
});

test('release never deletes a lock whose token is not this run\'s', (t) => {
  const file = lockFile(t);
  const bytes = plant(file, {});
  assert.equal(releaseLock(file, 'tok-this-run'), 'foreign');
  assert.equal(fs.readFileSync(file, 'utf8'), bytes);
  assert.equal(holdsLock(file, 'tok-this-run'), false);
  fs.rmSync(file);
  assert.equal(releaseLock(file, 'tok-this-run'), 'absent');
});

test('a holder that is provably dead (same host, ESRCH) is stale: the lock is taken over', (t) => {
  const file = lockFile(t);
  plant(file, {});
  const r = takeLock(file, deps({ kill: gone }));
  assert.deepEqual(r, { ok: true, token: 'tok-this-run' });
  assert.equal(holdsLock(file, 'tok-this-run'), true);
});

test('EPERM from the process check means the process exists: the lock is live', (t) => {
  const file = lockFile(t);
  const bytes = plant(file, {});
  const r = takeLock(file, deps({ kill: denied }));
  assert.equal(r.ok, false);
  assert.equal(fs.readFileSync(file, 'utf8'), bytes);
});

test('a lock written on another host is never judged by this machine\'s process table', (t) => {
  const file = lockFile(t);
  plant(file, { host: 'other-host' });
  let asked = 0;
  const r = takeLock(file, deps({ kill: () => { asked++; gone(); } }));
  assert.equal(r.ok, false, 'live while young');
  assert.equal(asked, 0, 'kill was not consulted');
});

test('the age backstop: a live-looking lock older than LOCK_STALE_MS is stale, one younger is not (injected clock)', (t) => {
  const young = lockFile(t);
  plant(young, { host: 'other-host' });
  assert.equal(takeLock(young, deps({ now: () => T0 + LOCK_STALE_MS - 1000 })).ok, false);
  const old = lockFile(t);
  plant(old, { host: 'other-host' });
  assert.equal(takeLock(old, deps({ now: () => T0 + LOCK_STALE_MS + 1000 })).ok, true);
});

test('a startedAt ahead of this clock never earns more time than the lock file\'s own age: another host, startedAt a day ahead, file 2 hours old is stale', (t) => {
  const file = lockFile(t);
  plant(file, { host: 'other-host', startedAt: new Date(T0 + 24 * 60 * 60 * 1000).toISOString() });
  const mtime = (T0 - 2 * 60 * 60 * 1000) / 1000;
  fs.utimesSync(file, mtime, mtime);
  const r = takeLock(file, deps({ token: 'tok-this-run' }));
  assert.equal(r.ok, true, 'the future startedAt did not keep the lock alive');
  assert.equal(holdsLock(file, 'tok-this-run'), true);
});

test('a same-host holder whose pid is alive stays live until the age backstop, which covers a reused process id', (t) => {
  const file = lockFile(t);
  plant(file, {});
  assert.equal(takeLock(file, deps({ now: () => T0 + 60 * 1000 })).ok, false, 'young and alive');
  assert.equal(takeLock(file, deps({ now: () => T0 + LOCK_STALE_MS + 1000 })).ok, true, 'old: the pid may belong to another program now');
});

test('a malformed lock is live while its file is young and stale once its mtime is older than LOCK_STALE_MS', (t) => {
  const file = lockFile(t);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ not json', 'utf8');
  assert.equal(takeLock(file, { now: () => Date.now() }).ok, false, 'fresh');
  const old = (Date.now() - LOCK_STALE_MS - 60 * 1000) / 1000;
  fs.utimesSync(file, old, old);
  const r = takeLock(file, { now: () => Date.now(), token: 'tok-this-run' });
  assert.equal(r.ok, true, 'old');
  assert.equal(holdsLock(file, 'tok-this-run'), true);
});

test('a stale lock is removed only if its bytes are still what was judged: a fresh lock written meanwhile is never removed', (t) => {
  const file = lockFile(t);
  plant(file, { token: 'tok-old' });
  let fresh;
  const kill = () => { fresh = plant(file, { pid: 888, token: 'tok-fresh' }); gone(); }; // the lock is replaced while it is being judged
  const r = takeLock(file, deps({ kill }));
  assert.equal(r.ok, false, 'the take stops rather than remove another run\'s lock');
  assert.equal(fs.readFileSync(file, 'utf8'), fresh, 'the fresh lock is intact');
});

test('lockPathFor is stable per target, differs between targets, and sits under the record folder\'s locks directory', () => {
  const home = path.join(os.tmpdir(), 'ct-lock-home');
  const a = lockPathFor(home, '/x/skills');
  assert.equal(a, lockPathFor(home, '/x/skills'));
  assert.notEqual(a, lockPathFor(home, '/x/other'));
  assert.match(path.relative(home, a).split(path.sep).join('/'), /^\.claude\/coal\/coaltipple\/locks\/[0-9a-f]{16}\.lock$/);
});
