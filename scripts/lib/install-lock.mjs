// 29gj: an exclusive per-target lock for the installer. Two installs (or an install and an uninstall) on one target at the same time used
// to race: one run's sweep could remove or move another run's live work folder, and both runs read-modify-wrote the install record. The
// lock is a file under the user's home, beside the install record (`~/.claude/coal/coaltipple/locks/<16 hex>.lock`, the hex from the
// target's real path), so a cloned project can neither plant nor remove one. It is created with `wx` (exclusive), holds one JSON line
// naming its owner, and is deleted only by the run whose token it carries.
//
// A lock that is already there is judged, never assumed:
//   - dead holder, provable: the same host and `process.kill(pid, 0)` says ESRCH. Stale; removed only if its bytes are still what was read.
//   - EPERM from kill(pid, 0) means the process exists, so the lock is live.
//   - any other lock, readable or not, is live until it is older than LOCK_STALE_MS. That age backstop exists for a process id that another
//     program now uses (pid reuse) or a lock written on another machine. It is safe because an install is one synchronous copy of a small
//     folder (seconds), so 30 minutes is far beyond any live run. A startedAt ahead of this machine's clock counts from the file's mtime instead. A malformed
//     lock is judged by its file's mtime alone; an unreadable one (a folder, a link, no permission) is always live, and the caller says to remove it by hand.
// Zero-dep, node builtins only (Phoenix #2).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { readConfigBounded } from './config-bound.mjs';
import { recordDir } from './install-record.mjs';

export const LOCK_STALE_MS = 30 * 60 * 1000;
const BOM = String.fromCharCode(0xfeff);

export function lockDir(home = os.homedir()) { return path.join(recordDir(home), 'locks'); }
// The lock for one target: keyed by the sha256 of the target's real path, first 16 hex.
export function lockPathFor(home, destReal) {
  return path.join(lockDir(home), `${createHash('sha256').update(destReal).digest('hex').slice(0, 16)}.lock`);
}

// { raw, info, mtimeMs }: info is the parsed owner record, or null when the file is empty, malformed or not the expected shape. null when the file is gone.
function readLock(lockPath) {
  let raw;
  let mtimeMs;
  try { raw = readConfigBounded(lockPath); mtimeMs = fs.statSync(lockPath).mtimeMs; }
  catch (e) {
    if (e && e.code === 'ENOENT') return null;
    return { raw: '', info: null, mtimeMs: undefined, unreadable: true };
  }
  let info = null;
  try {
    const parsed = JSON.parse(raw.startsWith(BOM) ? raw.slice(1) : raw);
    if (parsed !== null && typeof parsed === 'object' && Number.isInteger(parsed.pid) && typeof parsed.host === 'string' && typeof parsed.token === 'string') info = parsed;
  } catch { /* malformed: judged by mtime */ }
  return { raw, info, mtimeMs };
}

// 'stale' or 'live'. deps: now() -> ms, host, kill(pid, 0).
function judge(cur, deps) {
  const now = deps.now();
  const age = (ms) => (Number.isFinite(ms) ? now - ms : NaN);
  if (cur.info) {
    if (cur.info.host === deps.host) {
      try { deps.kill(cur.info.pid, 0); }
      catch (e) { if (e && e.code === 'ESRCH') return 'stale'; /* EPERM and anything else: the process exists or cannot be told */ }
    }
    const started = Date.parse(cur.info.startedAt);
    // a startedAt ahead of this clock (another machine's clock, a damaged lock) never earns more time than the file's own age
    const from = Number.isFinite(started) && started <= now ? started : cur.mtimeMs;
    return age(from) > LOCK_STALE_MS ? 'stale' : 'live';
  }
  return age(cur.mtimeMs) > LOCK_STALE_MS ? 'stale' : 'live';
}

function defaults(deps = {}) {
  return {
    now: deps.now ?? (() => Date.now()),
    host: deps.host ?? os.hostname(),
    pid: deps.pid ?? process.pid,
    kill: deps.kill ?? ((pid, sig) => process.kill(pid, sig)),
    token: deps.token ?? randomBytes(8).toString('hex'),
  };
}

// Takes the lock. { ok: true, token } or { ok: false, busy: { pid, startedAt } } (pid and startedAt are null when the lock could not be read).
// Throws for anything that is not "the lock is held": the caller decides what an unwritable lock folder means.
export function takeLock(lockPath, depsIn) {
  const deps = defaults(depsIn);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const body = () => JSON.stringify({ pid: deps.pid, host: deps.host, token: deps.token, startedAt: new Date(deps.now()).toISOString() }) + '\n';
  let removedStale = false;
  for (let i = 0; i < 4; i++) {
    let fd;
    try { fd = fs.openSync(lockPath, 'wx'); }
    catch (e) {
      if (!e || e.code !== 'EEXIST') throw e;
      const cur = readLock(lockPath);
      if (cur === null) continue; // it vanished between the create and the read: take it again
      if (removedStale || judge(cur, deps) === 'live') return { ok: false, busy: { pid: cur.info ? cur.info.pid : null, startedAt: cur.info ? cur.info.startedAt : null, unreadable: cur.unreadable === true } };
      // stale: removed only when its bytes are still what was judged, so a fresh lock that replaced it is never removed
      const again = readLock(lockPath);
      if (again !== null && again.raw === cur.raw) { try { fs.unlinkSync(lockPath); } catch { /* gone already */ } }
      removedStale = true;
      continue;
    }
    try { fs.writeSync(fd, body()); }
    catch (e) { try { fs.closeSync(fd); } catch { /* best effort */ } try { fs.unlinkSync(lockPath); } catch { /* best effort */ } throw e; }
    fs.closeSync(fd);
    return { ok: true, token: deps.token };
  }
  return { ok: false, busy: { pid: null, startedAt: null } };
}

// Does the lock file still carry this token?
export function holdsLock(lockPath, token) {
  const cur = readLock(lockPath);
  return cur !== null && cur.info !== null && cur.info.token === token;
}

// Deletes the lock only when it carries this run's token. 'released' | 'absent' | 'foreign' (another run's lock: left alone). Throws when the delete fails.
export function releaseLock(lockPath, token) {
  const cur = readLock(lockPath);
  if (cur === null) return 'absent';
  if (cur.info === null || cur.info.token !== token) return 'foreign';
  try { fs.unlinkSync(lockPath); } catch (e) { if (e && e.code === 'ENOENT') return 'absent'; throw e; }
  return 'released';
}
