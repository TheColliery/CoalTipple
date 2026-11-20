// The byte bound on a config file. A .coaltipple.json (global or project) larger than MAX_CONFIG_BYTES is never read
// whole and never handed to the comment stripper: a project config arrives with a cloned repository, so its size is
// not ours to trust. The size is taken from the open file (fstat on the descriptor, not a path check that a swap could
// outrun) BEFORE any content is read.
//
// readConfigBounded(file) -> the file's text, or throws: the usual fs error (ENOENT, EISDIR, ...), or an Error whose
// `code` is ECONFIGSIZE when the file is over the bound. The callers decide what over-size means for them: the config
// loader reads it as absent, configure.mjs and verify.mjs fail with the message, and the conductor (which cannot import
// this module, Phoenix #9) carries an inline copy of the constant and the same open + fstat step.
// scripts/lib/jsonc-sync.mjs fails if the conductor's MAX_CONFIG_BYTES line drifts from this one.
import fs from 'node:fs';

export const MAX_CONFIG_BYTES = 1024 * 1024;

// 29ky: the same bounded read, returning the text AND the identity of the one descriptor it read (device, inode, size,
// mtime, taken by fstat on that descriptor after the read). A caller that judges the file again later compares with it;
// the identity belongs to the bytes that were read, never to whatever the NAME holds at a later stat.
export function readConfigBoundedWithIdentity(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    if (size > MAX_CONFIG_BYTES) {
      const e = new Error(`config is larger than ${MAX_CONFIG_BYTES} bytes (${size} bytes): ${file}`);
      e.code = 'ECONFIGSIZE';
      throw e;
    }
    const text = fs.readFileSync(fd, 'utf8');
    const st = fs.fstatSync(fd);
    return { text, identity: { dev: st.dev, ino: st.ino, size: st.size, mtimeMs: st.mtimeMs } };
  } finally {
    fs.closeSync(fd);
  }
}

export function readConfigBounded(file) {
  return readConfigBoundedWithIdentity(file).text;
}

// 29ky: the re-check before a migration deletes its legacy config. ONE descriptor: the file is opened, judged by fstat
// (a regular file, the identity the seeding read returned, within the size bound), read through that same descriptor and
// closed here. It returns { dev, ino } of that descriptor when the file is still the one the snapshot holds (same
// identity, same text), else null: a file that cannot be checked counts as changed. The caller then compares the NAME's
// lstat with the returned { dev, ino } before it deletes. RESIDUAL WINDOW: a change between that lstat and the delete is
// not seen (Node has no delete by descriptor); that is a stated limit, not a closed one.
export function recheckConfigIdentity(file, snap) {
  if (!snap) return null;
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const st = fs.fstatSync(fd);
    const id = snap.identity;
    if (!st.isFile() || st.size > MAX_CONFIG_BYTES) return null;
    if (st.dev !== id.dev || st.ino !== id.ino || st.size !== id.size || st.mtimeMs !== id.mtimeMs) return null;
    if (fs.readFileSync(fd, 'utf8') !== snap.text) return null;
    return { dev: st.dev, ino: st.ino };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* closing a descriptor that is already gone changes nothing */ }
    }
  }
}
