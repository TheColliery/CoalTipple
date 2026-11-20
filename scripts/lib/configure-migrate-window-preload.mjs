// Fixture of scripts/lib/configure-migrate.test.mjs (29kl, reviewer 3cd548da), loaded with `node --import` into the REAL scripts/configure.mjs.
// It reaches the read window of the legacy-config migration: after the seeding read of the legacy file, before its delete.
// The hook point is the rename that lands the NEW config (writeConfigAtomic -> renameWithRetry -> fs.renameSync): the
// new home is written, the legacy file not yet removed. A fix that re-checks the legacy file just before its delete
// sees this change; a fix that checks before the write, or not at all, does not.
// Env: CT_WINDOW_TARGET  absolute path of the new config (the rename destination to wait for)
//      CT_WINDOW_LEGACY  absolute path of the legacy config to change
//      CT_WINDOW_MODE    'append' | 'samesize' | 'remove' | 'none'
//      CT_WINDOW_MARK    absolute path of a marker file written when the change was made (so a green run is never vacuous)
// It fires once. It never deletes anything; the same-size replace renames a file of its own making over the legacy name.
import fs from 'node:fs';
import path from 'node:path';

const target = process.env.CT_WINDOW_TARGET ? path.resolve(process.env.CT_WINDOW_TARGET) : null;
const legacy = process.env.CT_WINDOW_LEGACY ? path.resolve(process.env.CT_WINDOW_LEGACY) : null;
const mode = process.env.CT_WINDOW_MODE || 'none';
const mark = process.env.CT_WINDOW_MARK || null;
const realRename = fs.renameSync;
let fired = false;

function changeLegacy() {
  const before = fs.readFileSync(legacy, 'utf8');
  if (mode === 'append') {
    fs.appendFileSync(legacy, '// edited while the migration ran\n', 'utf8');
  } else if (mode === 'samesize') {
    // Another file, the same size, takes the legacy name: a new inode and new bytes at the old length.
    const after = before.replace('"qualityBar": 90', '"qualityBar": 91');
    if (after === before || Buffer.byteLength(after) !== Buffer.byteLength(before)) throw new Error('witness preload: same-size edit did not apply');
    const side = `${legacy}.window-replace`;
    fs.writeFileSync(side, after, { encoding: 'utf8', flag: 'wx' });
    realRename(side, legacy);
  } else if (mode === 'remove') {
    // Another program takes the legacy file away inside the window: it is renamed to a name of this fixture's own, never deleted.
    realRename(legacy, `${legacy}.moved-away`);
  }
  if (mark) fs.writeFileSync(mark, `${mode}\n`, 'utf8');
}

fs.renameSync = function renameSyncWindow(from, to) {
  const r = realRename(from, to);
  if (!fired && mode !== 'none' && target && legacy && path.resolve(String(to)) === target) {
    fired = true;
    changeLegacy();
  }
  return r;
};
