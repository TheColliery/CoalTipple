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

export function readConfigBounded(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
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
