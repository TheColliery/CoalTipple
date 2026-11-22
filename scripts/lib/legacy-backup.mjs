// 29mj (card BB-533, signed by the owner 2026-11-21): the legacy-config migration never destroys the user's file.
// The migration reads the legacy config as its seed, writes the new config, and then RETIRES the legacy file by moving it,
// with ONE rename, to <legacy>.bak beside it. That rename is the only destroying call in the migration: no rm, no unlink, no
// copy-then-delete, and no check-then-destroy. Nothing is decided at one moment and destroyed at a later one, so an edit made to the
// legacy file in ANY window (after the seeding read, after the last look, through a descriptor held open across the move) travels
// into the backup with the file instead of being deleted with it. The backup is then read back and compared with the SNAPSHOT
// (the text the seeding read returned, taken before the BOM is stripped): a difference is a warning that names both files.
//
// What each path does when its own source is stale, moved, held or unreadable in the middle (every step that cannot be done says so,
// returns false, and the caller exits 1; none of them prints success):
//   - no snapshot (the seeding read did not run for this file): nothing is moved.
//   - the rename is refused (EBUSY on a held file, EPERM, ...): reported with what an lstat of the legacy name then shows
//     (found = kept, none = gone, threw = unchecked); the legacy file stays where it is, nothing is retried.
//   - the legacy file is gone before the rename (another program moved it): the rename fails ENOENT and the state is 'gone'.
//   - the backup cannot be read back (moved, replaced by a link, too large, unreadable): the comparison is reported as not done.
//   - an earlier <legacy>.bak: replaced by the rename, and the run's line says so. `hadBak` is read by an lstat BEFORE the rename, so it
//     is one step stale: a .bak that appeared or vanished between that lstat and the rename is not what the line says. That is a stated
//     limit; the rename itself loses nothing the user has not already been told about.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gitEnv } from './git-env.mjs';
import { readConfigBounded } from './config-bound.mjs';
import { refuseIfReadOnly, isNoWriteFile } from './readonly-refusal.mjs';

const GIT_PROBE_MS = 10000;

// True only when git says the file is tracked. Any other answer (not a repository, git missing, a timeout, a spawn error) reads as
// false: the probe only decides whether to add a sentence of advice, never whether to move the file. GIT_* is stripped from the child's
// environment (gitEnv) and the folder search above the project root is capped (ceilingDir). On Windows the current folder is not searched
// for the executable (CWE-426): Node reads that switch from THIS process's environment, so it is set here, before the spawn.
export function trackedByGit(file, ceilingDir) {
  try {
    if (process.platform === 'win32') process.env.NoDefaultCurrentDirectoryInExePath = '1';
    const r = spawnSync('git', ['ls-files', '--error-unmatch', '--', path.basename(file)], {
      cwd: path.dirname(file), env: gitEnv(ceilingDir), stdio: 'ignore', timeout: GIT_PROBE_MS, windowsHide: true,
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

// What an lstat of the legacy NAME shows after a refused rename: 'kept' (something is there), 'gone' (ENOENT), 'unchecked' (the lstat threw
// for another reason, so nothing is claimed). No answer is preset.
function stateOfName(p) {
  try { fs.lstatSync(p); return 'kept'; } catch (e) { return e && e.code === 'ENOENT' ? 'gone' : 'unchecked'; }
}

// Retires one SEEDED legacy file. `snapshot` is the text the seeding read returned (null when it did not run). Returns true when the file
// was moved and the backup matches the snapshot; false on anything else, after saying why (the caller sets the exit code from the return).
// `log` and `warn` print one line each (console.log and console.warn).
export function retireSeededLegacy({ legacy, snapshot, configPath, ceilingDir, log, warn }) {
  const bak = `${legacy}.bak`;
  if (snapshot === null || snapshot === undefined) {
    warn(`Warning: ${legacy} was not read by this run, so nothing was moved. The new config at ${configPath} was written; check ${legacy} by hand.`);
    return false;
  }
  // 29mr (T-29mj-2): configure.mjs checked this path before it wrote the new home; checked again here for a backup made read-only since. A rename over a read-only
  // .bak would replace it on POSIX, so it is refused by name and the legacy file stays where it is.
  try { refuseIfReadOnly(bak); } catch (e) {
    warn(`${e.message}. ${legacy} was not moved; the new config at ${configPath} was written.`);
    return false;
  }
  // 29nf: read before the move, since afterwards the legacy name is gone. An unreadable mode says nothing (false), never a guess.
  let wasReadOnly = false;
  try { wasReadOnly = isNoWriteFile(fs.lstatSync(legacy)); } catch { /* the move below reports what it finds */ }
  const tracked = trackedByGit(legacy, ceilingDir); // before the move: afterwards the name is gone and git would answer for nothing
  let hadBak = false;
  try { fs.lstatSync(bak); hadBak = true; } catch { /* absent, or unreadable: the line says "no earlier backup" only when this lstat found none */ }
  try {
    fs.renameSync(legacy, bak); // the ONLY destroying call; an earlier .bak at this name is replaced by it
  } catch (e) {
    const state = stateOfName(legacy);
    const why = `${e && e.code ? e.code : 'error'}: ${e && e.message ? e.message : e}`;
    if (state === 'kept') warn(`Warning: could not move ${legacy} to ${bak} (${why}). ${legacy} is still there, unchanged by this run; the new config at ${configPath} was written. Close whatever holds it and move it by hand.`);
    else if (state === 'gone') warn(`Warning: could not move ${legacy} to ${bak} (${why}), and ${legacy} is no longer there: another program moved or removed it after it was read. The new config at ${configPath} holds what was read.`);
    else warn(`Warning: could not move ${legacy} to ${bak} (${why}), and ${legacy} could not be checked afterwards, so nothing is claimed about it. The new config at ${configPath} was written; look at ${legacy} by hand.`);
    return false;
  }
  // The legacy name is gone from here on: say what git will show, in every outcome below.
  const trackedLine = () => { if (tracked) log(`${legacy} is tracked by git: commit its removal (git add -A -- ${legacy}). ${bak} is untracked and yours to keep or delete.`); };
  let back = null;
  try {
    if (fs.lstatSync(bak).isFile()) back = readConfigBounded(bak); // a regular file only: a link planted at the name is never followed
  } catch { /* back stays null */ }
  if (back === null) {
    warn(`Warning: moved ${legacy} to ${bak}, but could not read the backup back to compare it with what was migrated. The new config at ${configPath} was written; check ${bak} by hand.`);
    trackedLine();
    return false;
  }
  if (back !== snapshot) {
    warn(`Warning: ${bak} differs from what this run migrated: ${legacy} changed after it was read, so ${configPath} does not include that change. Merge it from ${bak} by hand; ${bak} is yours to keep or delete.`);
    trackedLine();
    return false;
  }
  log(`Migrated the project config to ${configPath}; the old file is kept as ${bak}${wasReadOnly ? ', read-only as it was' : ''} (${hadBak ? 'replaced an earlier backup' : 'no earlier backup'}). It is yours to keep or delete; nothing sweeps it.`);
  trackedLine();
  return true;
}
