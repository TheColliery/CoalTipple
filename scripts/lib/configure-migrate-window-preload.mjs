// Fixture of scripts/lib/configure-migrate.test.mjs (29kl, reviewer 3cd548da; re-shaped 29mj for card BB-533), loaded with `node --import` into
// the REAL scripts/configure.mjs. It reaches the windows of the legacy-config migration and the failures of its one destroying call.
//
// Two kinds of hook point, neither tied to one implementation:
//   AFTER THE NEW CONFIG IS WRITTEN (modes append, samesize, remove): the rename that lands the NEW config (writeConfigAtomic ->
//     renameWithRetry -> fs.renameSync) has run, the legacy file is not yet retired.
//   THE LAST MOMENT BEFORE THE LEGACY FILE IS DESTROYED OR MOVED (modes append-last, refuse, descriptor, bak-oversize): the call that
//     takes the legacy name away (fs.rmSync, fs.unlinkSync or fs.renameSync of it), whatever the migration calls it. A fix that checks
//     the file before that call and then destroys it is caught here, because this change lands after its last look (the study's W-c1).
// Env: CT_WINDOW_TARGET  absolute path of the new config (the rename destination to wait for)
//      CT_WINDOW_LEGACY  absolute path of the legacy config to change
//      CT_WINDOW_MODE    'append' | 'samesize' | 'remove' | 'append-last' | 'refuse' | 'descriptor' | 'bak-oversize' | 'none'
//      CT_WINDOW_AFTER   for 'refuse': what the legacy name shows after the refused move: 'kept' (default) | 'gone' | 'unchecked'
//      CT_WINDOW_MARK    absolute path of a marker file written when the change was made (so a green run is never vacuous)
// It fires once. It never deletes anything: the same-size replace renames a file of its own making over the legacy name, and the
// removal renames the legacy file to a name of this fixture's own.
import fs from 'node:fs';
import path from 'node:path';

// Paths are compared by their REAL path (macOS /var and /private/var, a runner's 8.3 and long TEMP spellings name one file); a path that
// does not exist falls back to path.resolve.
const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
const target = process.env.CT_WINDOW_TARGET ? path.resolve(process.env.CT_WINDOW_TARGET) : null;
const legacy = process.env.CT_WINDOW_LEGACY ? path.resolve(process.env.CT_WINDOW_LEGACY) : null;
const mode = process.env.CT_WINDOW_MODE || 'none';
const after = process.env.CT_WINDOW_AFTER || 'kept';
const mark = process.env.CT_WINDOW_MARK || null;
const realRename = fs.renameSync;
const realRm = fs.rmSync;
const realUnlink = fs.unlinkSync;
const realLstat = fs.lstatSync;
let fired = false;
let legacyUnchecked = false;
let descriptor = null;

const isLegacy = (p) => legacy !== null && real(String(p)) === real(legacy);
const note = () => { if (mark) fs.writeFileSync(mark, `${mode}\n`, 'utf8'); };

function changeLegacy() {
  const before = fs.readFileSync(legacy, 'utf8');
  if (mode === 'append' || mode === 'append-last') {
    fs.appendFileSync(legacy, '// edited while the migration ran\n', 'utf8');
  } else if (mode === 'samesize') {
    // Another file, the same size, takes the legacy name: a new inode and new bytes at the old length.
    const replaced = before.replace('"qualityBar": 90', '"qualityBar": 91');
    if (replaced === before || Buffer.byteLength(replaced) !== Buffer.byteLength(before)) throw new Error('witness preload: same-size edit did not apply');
    const side = `${legacy}.window-replace`;
    fs.writeFileSync(side, replaced, { encoding: 'utf8', flag: 'wx' });
    realRename(side, legacy);
  } else if (mode === 'remove') {
    // Another program takes the legacy file away inside the window: it is renamed to a name of this fixture's own, never deleted.
    realRename(legacy, `${legacy}.moved-away`);
  }
  note();
}

// The move of the legacy file to its backup, or any other call that takes the legacy name away, is reached here.
function beforeLegacyTaken() {
  if (fired || legacy === null) return;
  if (mode === 'append-last') { fired = true; changeLegacy(); }
}

fs.renameSync = function renameSyncWindow(from, to) {
  if (!fired && legacy !== null && isLegacy(from)) {
    if (mode === 'append-last') { fired = true; changeLegacy(); }
    else if (mode === 'refuse') {
      fired = true;
      if (after === 'gone') realRename(from, `${legacy}.moved-away`);
      if (after === 'unchecked') legacyUnchecked = true;
      note();
      const e = new Error(`EBUSY: resource busy or locked, rename '${String(from)}' -> '${String(to)}'`);
      e.code = 'EBUSY'; e.syscall = 'rename'; e.errno = -4082;
      throw e;
    } else if (mode === 'descriptor') {
      // A writer that opened the legacy file before the move and keeps writing after it (W-b1: libuv opens with delete sharing).
      descriptor = fs.openSync(from, 'r+');
      fired = true;
      const r = realRename(from, to);
      fs.writeSync(descriptor, 'WRITTEN-AFTER-RENAME\n', fs.fstatSync(descriptor).size);
      fs.closeSync(descriptor);
      note();
      return r;
    } else if (mode === 'bak-oversize') {
      fired = true;
      const r = realRename(from, to);
      fs.appendFileSync(to, ' '.repeat(1024 * 1024 + 16), 'utf8'); // the backup grows past the config size bound after the move
      note();
      return r;
    }
  }
  const r = realRename(from, to);
  if (!fired && mode !== 'none' && target && legacy && (mode === 'append' || mode === 'samesize' || mode === 'remove') && real(String(to)) === real(target)) {
    fired = true;
    changeLegacy();
  }
  return r;
};

fs.rmSync = function rmSyncWindow(p, ...rest) {
  if (isLegacy(p)) beforeLegacyTaken();
  return realRm(p, ...rest);
};
fs.unlinkSync = function unlinkSyncWindow(p) {
  if (isLegacy(p)) beforeLegacyTaken();
  return realUnlink(p);
};
fs.lstatSync = function lstatSyncWindow(p, ...rest) {
  if (legacyUnchecked && path.resolve(String(p)) === path.resolve(legacy)) {
    const e = new Error(`EIO: i/o error, lstat '${String(p)}'`);
    e.code = 'EIO'; e.syscall = 'lstat'; e.errno = -4;
    throw e;
  }
  return realLstat(p, ...rest);
};
