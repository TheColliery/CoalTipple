// 29ob (T-29nw-1, T-29nw-2): the install record's reads took their identity somewhere other than where their check looked.
//   loadInstallRecord checked the record name with lstat (a link is refused) and then read it with readConfigBounded and NO root, so openChecked took the
//   identity it compares from its OWN later lstat, and followed a link at that moment: a record name swapped for a link between the two was read through.
//   folderHashes lstat'd each child in its walk and opened it by name in another function with no compare of the opened handle, so a child swapped for
//   another file between the two was hashed as the other file.
// The fix: the record read passes its own folder as the root (the file's lstat refuses a link and is the compared identity: one lstat), and the walk compares
// the opened handle's dev AND ino (bigint) with its own lstat in the same function. Both fail closed: a record reads as NONE, a folder as UNPROVABLE (null).
// Seams (no privilege needed): (a) the loader's identity lstat (the bigint one) is made to see a link, simulated where a file symlink cannot be made here
// (EPERM on Windows) and REAL where it can (its own test, which skips visibly where it cannot); (b) fs.openSync is reassigned so a child's name is swapped for a
// hard link just before the real open. Each has a CONTROL leg (no swap, the read works), an INSIDE leg (the other file is in the same folder) and an OUTSIDE leg
// (the other file is outside it). Temp roots are taken by fs.realpathSync.native.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { recordFile, loadInstallRecord, RECORD_SCHEMA, folderHashes } from './install-record.mjs';

const PREFIX = 'ct-29ob-rl-';
const sha = (s) => createHash('sha256').update(s).digest('hex');

function makeRoot(t) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), PREFIX)));
  t.after(() => {
    const base = fs.realpathSync.native(os.tmpdir());
    const real = fs.realpathSync.native(root);
    if (path.dirname(real) === base && path.basename(real).startsWith(PREFIX)) fs.rmSync(real, { recursive: true, force: true });
  });
  return root;
}
const rec = (marker) => JSON.stringify({ stateSchema: RECORD_SCHEMA, targets: {}, marker }) + '\n';
const same = (a, b) => path.resolve(String(a)).toLowerCase() === path.resolve(String(b)).toLowerCase();
function canFileSymlink(dir) {
  const a = path.join(dir, 'probe-a');
  try { fs.writeFileSync(a, 'x'); fs.symlinkSync(a, path.join(dir, 'probe-b'), 'file'); return true; } catch { return false; }
}
function canHardLink(dir) {
  const a = path.join(dir, 'probe-h-a');
  try { fs.writeFileSync(a, 'x'); fs.linkSync(a, path.join(dir, 'probe-h-b')); return true; } catch { return false; }
}

// ---------- loadInstallRecord ----------
function legHome(root, leg) {
  const home = path.join(root, `${leg}-home`);
  const file = recordFile(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rec('THE-RECORD'));
  const target = leg === 'outside' ? path.join(root, `${leg}-outside`, 'elsewhere.json') : path.join(path.dirname(file), 'other.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, rec(leg === 'outside' ? 'OUTSIDE' : 'INSIDE-OTHER'));
  return { home, file, target };
}
const outcome = (home) => { const r = loadInstallRecord(home); return { state: r.state, marker: r.record.marker }; };

// The loader's identity lstat is the one that carries { bigint: true }. SIMULATED link: that lstat reports the stats of a link (isSymbolicLink true) and the
// name's stat and open then go to `target`, as the OS would through a real link. REAL link: the name is renamed aside and a file symlink put in its place.
function seamLink(L, real) {
  const realL = fs.lstatSync; const realS = fs.statSync; const realO = fs.openSync;
  const st = { fired: false };
  fs.lstatSync = function seamLstat(p, o) {
    if (!st.fired && o && o.bigint && same(p, L.file)) {
      st.fired = true;
      if (real) { fs.renameSync(L.file, `${L.file}.moved`); fs.symlinkSync(L.target, L.file, 'file'); return realL.call(fs, p, o); }
      const s = realL.call(fs, L.target, o);
      return Object.assign(Object.create(Object.getPrototypeOf(s)), s, { isSymbolicLink: () => true, isFile: () => false });
    }
    return realL.call(fs, p, o);
  };
  if (!real) {
    fs.statSync = function seamStat(p, o) { return realS.call(fs, st.fired && same(p, L.file) ? L.target : p, o); };
    fs.openSync = function seamOpen(p, ...r) { return realO.call(fs, st.fired && same(p, L.file) ? L.target : p, ...r); };
  }
  st.undo = () => { fs.lstatSync = realL; fs.statSync = realS; fs.openSync = realO; };
  return st;
}

test('loadInstallRecord control: an unswapped record is read (state ok, its own marker)', (t) => {
  const root = makeRoot(t);
  const L = legHome(root, 'control');
  assert.deepEqual(outcome(L.home), { state: 'ok', marker: 'THE-RECORD' });
});

for (const leg of ['inside', 'outside']) {
  test(`loadInstallRecord ${leg}: a record name that turns into a link at the identity lstat reads as NONE, never the link target (simulated link)`, (t) => {
    const root = makeRoot(t);
    const L = legHome(root, leg);
    const s = seamLink(L, false);
    let got;
    try { got = outcome(L.home); } finally { s.undo(); }
    assert.equal(s.fired, true, 'the swap fired: the loader took its identity with a bigint lstat of the record name');
    assert.deepEqual(got, { state: 'none', marker: undefined }, `the link target must not be read; got ${JSON.stringify(got)}`);
  });
}

test('loadInstallRecord REAL link: a record name swapped for a file symlink at the identity lstat reads as NONE, never the target', (t) => {
  const root = makeRoot(t);
  if (!canFileSymlink(root)) { t.skip('file symlinks cannot be made here (EPERM on Windows without Developer Mode)'); return; }
  const L = legHome(root, 'real');
  const s = seamLink(L, true);
  let got;
  try { got = outcome(L.home); } finally { s.undo(); }
  assert.equal(s.fired, true, 'the swap fired');
  assert.deepEqual(got, { state: 'none', marker: undefined });
});

// ---------- folderHashes ----------
function legDir(root, leg) {
  const dir = path.join(root, `${leg}-skill`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'THE-FILE');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'SIBLING');
  const other = leg === 'outside' ? path.join(root, `${leg}-elsewhere.txt`) : path.join(dir, 'b.txt');
  if (leg === 'outside') fs.writeFileSync(other, 'OUTSIDE');
  return { dir, target: path.join(dir, 'a.txt'), other };
}
// Just before the real open of `target`, its name is swapped for a hard link to `other` (no privilege needed).
function seamOpen(D) {
  const realO = fs.openSync;
  const st = { fired: false };
  fs.openSync = function swapOpen(p, ...r) {
    if (!st.fired && same(p, D.target)) {
      st.fired = true;
      fs.renameSync(D.target, `${D.target}.moved`);
      fs.linkSync(D.other, D.target);
    }
    return realO.call(fs, p, ...r);
  };
  st.undo = () => { fs.openSync = realO; };
  return st;
}

test('folderHashes control: an unswapped folder is hashed file by file', (t) => {
  const root = makeRoot(t);
  const D = legDir(root, 'control');
  assert.deepEqual(folderHashes(D.dir), { 'a.txt': sha('THE-FILE'), 'b.txt': sha('SIBLING') });
});

for (const leg of ['inside', 'outside']) {
  test(`folderHashes ${leg}: a child swapped for another file between the walk's lstat and the open makes the folder UNPROVABLE (null), never the other file's hash`, (t) => {
    const root = makeRoot(t);
    if (!canHardLink(root)) { t.skip('hard links cannot be made here'); return; }
    const D = legDir(root, leg);
    const s = seamOpen(D);
    let got;
    try { got = folderHashes(D.dir); } finally { s.undo(); }
    assert.equal(s.fired, true, 'the swap fired: the walk opened the child by name');
    assert.equal(got, null, `the folder must be unprovable; got ${JSON.stringify(got)}`);
  });
}
