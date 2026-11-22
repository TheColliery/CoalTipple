// The byte bound on a config file. A .coaltipple.json (global or project) larger than MAX_CONFIG_BYTES is never read
// whole and never handed to the comment stripper: a project config arrives with a cloned repository, so its size is
// not ours to trust. The size is taken from the open file (fstat on the descriptor, not a path check that a swap could
// outrun) BEFORE any content is read.
//
// readConfigBounded(file, root?) -> the file's text, or throws: the usual fs error (ENOENT, EISDIR, ...), an Error whose
// `code` is ECONFIGSIZE when the file is over the bound, or (29nn) ELINK / ECHANGED when the file is not the one that was
// checked (below). The callers decide what a refusal means for them: the config loader reads it as absent, configure.mjs and
// verify.mjs fail with the message, and the conductor (which cannot import this module, Phoenix #9) carries an inline copy of
// the constant and of the openChecked block, held equal by scripts/lib/jsonc-sync.mjs (the constant) and scripts/verify.mjs
// (the block).
//
// 29nn (T, the check-then-use window): a NAME checked and then OPENED BY NAME can be swapped in between (a link at a folder
// of the chain, or a hard link at the file's own name) and the reader returns a stranger's bytes. openChecked closes it the
// way the 29nd form note says: where a `root` is given, an lstat walk of each folder from the root to the file (never through
// a link, the root itself only normalised); then lstat of the file; the open; then fstat of the HANDLE, compared with that
// lstat on dev AND ino as bigint; a mismatch closes the handle and refuses (ECHANGED), fail closed. A name is never
// opened first and checked after. An ino of 0 on either side (a filesystem that reports none) skips the compare: that
// leg is the old check by name, stated here and nowhere hidden.
// A file link: with a root it is refused (the project's own files are plain files, and containedPath refuses it too); with
// no root (the global config, which a dotfile manager may link) it is followed by stat, and the compare still binds.
// TWO RESIDUALS, not closed here (INSPECT 29nn F-1): (1) a folder of the chain swapped for a link AFTER the walk and BEFORE the
// file's own lstat is still read, because the lstat, the open and the fstat then all agree on the outside file. Node's fs offers no
// handle-relative walk on any platform (29np), so this residual (the 29nd form's T-82) is a stated limit, marked at the open below. (2) A hard link PLANTED BEFORE the check is not seen
// (the check and the handle see one inode); one swapped in AFTER the check is refused.
import fs from 'node:fs';
import path from 'node:path';

export const MAX_CONFIG_BYTES = 1024 * 1024;

// <identity-read-shared: openChecked> -- the conductor inlines this block verbatim; edit it here, then mirror it there
function openChecked(file, root) {
  const refuse = (code, why) => { const e = new Error(`${why}: ${file}`); e.code = code; return e; };
  if (root != null) {
    const lexRoot = path.resolve(root);
    const rel = path.relative(lexRoot, path.dirname(path.resolve(file)));
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw refuse('ELINK', 'the config is not under its project root');
    let cur = lexRoot;
    for (const seg of rel.split(path.sep).filter(Boolean)) {
      cur = path.join(cur, seg);
      if (!fs.lstatSync(cur).isDirectory()) throw refuse('ELINK', 'a folder on the way to the config is a link or not a folder'); // ENOENT propagates: absent
    }
  }
  let st = fs.lstatSync(file, { bigint: true });
  if (st.isSymbolicLink()) {
    if (root != null) throw refuse('ELINK', 'the config file is a link');
    st = fs.statSync(file, { bigint: true });
  }
  if (st.isDirectory()) throw refuse('EISDIR', 'the config is a folder');
  // STATED LIMIT (T-82): a folder of the chain swapped for a link AFTER the walk above and BEFORE the lstat of the file is still read: the lstat, this open and the fstat then all
  // agree on the outside file, so the compare below cannot see it. Node's fs offers no handle-relative walk on any platform (CoalLedger's measurement 29np; Linux's only close, /proc/self/fd,
  // is not taken), so this residual stays; it is not a later fix.
  const fd = fs.openSync(file, 'r');
  try {
    const hs = fs.fstatSync(fd, { bigint: true });
    if (st.ino !== 0n && hs.ino !== 0n && (hs.dev !== st.dev || hs.ino !== st.ino)) throw refuse('ECHANGED', 'the config file is not the one that was checked (it changed between the check and the open)');
    return { fd, size: Number(hs.size) };
  } catch (e) {
    fs.closeSync(fd);
    throw e;
  }
}
// </identity-read-shared: openChecked>

export function readConfigBounded(file, root) {
  const { fd, size } = openChecked(file, root);
  try {
    if (size > MAX_CONFIG_BYTES) {
      const e = new Error(`config is larger than ${MAX_CONFIG_BYTES} bytes (${size} bytes): ${file}`);
      e.code = 'ECONFIGSIZE';
      throw e;
    }
    return fs.readFileSync(fd, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
}
