// The one bounded rename retry, shared by config-load.mjs writeConfigAtomic and classify.mjs writeRankingAtomic (node/runtime.md section 5, MUST: a rename failure
// never falls back to an in-place write of the live file).
import fs from 'node:fs';

// Windows: configPath held open elsewhere (a live conductor read, an editor) makes renameSync throw EPERM/EBUSY, usually for a moment. node/runtime.md section 5 (MUST): the
// failure branch keeps the old file and NEVER falls back to an in-place write of the live path. So the rename is retried a BOUNDED number of times (RENAME_ATTEMPTS tries,
// RENAME_WAIT_MS between them: at most (RENAME_ATTEMPTS - 1) * RENAME_WAIT_MS of waiting), and then it fails LOUD, naming the cause; the caller's finally removes the temp.
// Any other error code throws at once. Callers (configure.mjs, install.mjs) catch the throw, print it, and exit 1; nothing was written in place. A read-only target gives the same EPERM as a held-open one, so the message names both causes.
const RENAME_ATTEMPTS = 5;
const RENAME_WAIT_MS = 40;
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); // a blocking wait with no busy loop; this runs in user-invoked CLIs only
export function renameWithRetry(from, to) {
  for (let attempt = 1; ; attempt++) {
    try { fs.renameSync(from, to); return; }
    catch (e) {
      if (e.code !== 'EPERM' && e.code !== 'EBUSY') throw e;
      if (attempt >= RENAME_ATTEMPTS) {
        throw Object.assign(new Error(`could not replace ${to} after ${RENAME_ATTEMPTS} attempts (${e.code}): it is held open by another program or is read-only; the existing file is unchanged, close the other program or clear the read-only attribute and run this again`, { cause: e }), { code: e.code });
      }
      sleepSync(RENAME_WAIT_MS);
    }
  }
}
