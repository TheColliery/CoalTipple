// T-29mj-2, the 0444 refusal (ruled once for the flock, 29mr): a config the user made read-only is REFUSED BY NAME, never replaced.
// POSIX replaces a read-only file when a temp file is renamed over it (a rename ignores the target's own mode), so the user's choice to protect the file was lost
// without a word. Every writer of a user's file calls refuseIfReadOnly(target) FIRST: before its temp file exists, and, for a run that writes more than one file,
// before the FIRST write of the run (the migration's .bak path is checked before the new home, so a refusal never follows a partial write).
//
// target absent (ENOENT)            -> returns: there is nothing to protect.
// target exists, a file, no write bit -> throws code EREADONLY: "FAIL <file>: read-only; nothing was written -- make the file writable if you mean to change it".
//                                       On Windows a read-only attribute reads as mode 0o444, so one check serves both.
// lstat fails for any other reason  -> throws code EINSPECT: "FAIL <file>: could not be inspected (<code>); nothing was written -- <file advice>". A step that cannot be
//                                       checked is said, never taken as "writable"; the advice names the FILE (its permissions), not the folder.
// The target is lstat-ed, never stat-ed: a link at the name is replaced by the temp-then-rename writers, not followed, so the link's own entry is what is judged.
// RESIDUAL (stated, not closed): the check and the replace are two steps and Node has no "replace unless read-only". A file made read-only on POSIX after this
// check and before the rename is replaced. The window is the few milliseconds between them.
import fs from 'node:fs';

function refusal(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

export function refuseIfReadOnly(target) {
  let st;
  try {
    st = fs.lstatSync(target);
  } catch (e) {
    if (e && e.code === 'ENOENT') return;
    throw refusal('EINSPECT', `FAIL ${target}: could not be inspected (${e && e.code ? e.code : 'error'}); nothing was written -- check that this file can be read and that its permissions allow you to change it`);
  }
  if (st.isFile() && (st.mode & 0o222) === 0) {
    throw refusal('EREADONLY', `FAIL ${target}: read-only; nothing was written -- make the file writable if you mean to change it`);
  }
}

// True for the two codes above, so a caller prints the sentence as it is instead of wrapping it in its own "failed to write" text.
export function isRefusal(e) {
  return Boolean(e) && (e.code === 'EREADONLY' || e.code === 'EINSPECT');
}
