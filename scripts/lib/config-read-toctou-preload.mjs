// Fixture of scripts/lib/config-read-toctou.test.mjs (29nn; the shape is the reviewer's witness preload, 3cd548da), loaded with `node --import` into a
// spawned scripts/configure.mjs or hooks/coaltipple-conductor.js. It is the seam of the 29nd form note: fs.openSync is reassigned so that, just before the
// REAL open of TC_TARGET for reading, the name is swapped, with no privilege:
//   TC_MODE=junction  the folder holding TC_TARGET is renamed aside and a junction (Windows) / dir symlink (POSIX) to TC_OUTSIDE takes its name;
//   TC_MODE=hardlink  TC_TARGET is renamed aside and a hard link to TC_VICTIM takes its name (another file);
//   TC_MODE=none      nothing is swapped (the green legs: the read is only watched).
// Every text read through a descriptor opened on TC_TARGET is recorded into TC_MARK (one JSON line each), and so is the swap itself. It fires once and
// deletes nothing.
import fs from 'node:fs';
import path from 'node:path';

const target = process.env.TC_TARGET ? path.resolve(process.env.TC_TARGET) : null;
const mode = process.env.TC_MODE || 'none';
const mark = process.env.TC_MARK || null;
const same = (a, b) => path.resolve(String(a)).toLowerCase() === String(b).toLowerCase();
const realOpen = fs.openSync;
const realRead = fs.readFileSync;
const realRename = fs.renameSync;
let fired = false;
const watched = new Set();
const note = (o) => { if (mark) fs.appendFileSync(mark, JSON.stringify(o) + '\n'); };

fs.openSync = function tcOpen(p, flags, ...rest) {
  const reading = flags === undefined || flags === 'r' || flags === 0;
  if (!fired && target && reading && same(p, target)) {
    fired = true;
    if (mode === 'junction') {
      const dir = path.dirname(target);
      realRename(dir, `${dir}.moved-by-witness`);
      fs.symlinkSync(process.env.TC_OUTSIDE, dir, process.platform === 'win32' ? 'junction' : 'dir');
      note({ swapped: 'junction' });
    } else if (mode === 'hardlink') {
      realRename(target, `${target}.moved-by-witness`);
      fs.linkSync(process.env.TC_VICTIM, target);
      note({ swapped: 'hardlink' });
    } else {
      note({ swapped: 'none' });
    }
    const fd = realOpen(p, flags, ...rest);
    watched.add(fd);
    return fd;
  }
  return realOpen(p, flags, ...rest);
};

fs.readFileSync = function tcRead(f, ...rest) {
  const out = realRead(f, ...rest);
  if (typeof f === 'number' && watched.has(f)) note({ read: String(out).slice(0, 120) });
  return out;
};
