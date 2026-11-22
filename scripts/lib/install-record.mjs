// 29ah: the install record. The installer writes or removes the skill folder `<dest>/coaltipple` only when this record (or a byte match,
// see scripts/install.mjs ownership) proves CoalTipple installed it. The record lives under the user's home, in the tool's own
// namespace (Phoenix #10): `~/.claude/coal/coaltipple/install-record.json`. A cloned repository cannot write there, so a project
// cannot plant a record; it can plant a folder, which is why the folder alone authorizes nothing.
//
// Shape: { stateSchema: 1, targets: { "<realpath of the target>": { version, skills: { coaltipple: { "<rel/path>": "<sha256>" } } } } }
//
// Reads are bounded and contained; anything unusable reads as NO RECORD, never as a claim. A record written by a NEWER schema is
// never rewritten: it is reported as 'newer' and the caller leaves it alone (the rollback half of the state-schema law).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readConfigBounded, MAX_CONFIG_BYTES } from './config-bound.mjs';
import { writeConfigAtomic } from './config-load.mjs';

export const RECORD_SCHEMA = 1;
const BOM = String.fromCharCode(0xfeff);

export function recordDir(home = os.homedir()) { return path.join(home, '.claude', 'coal', 'coaltipple'); }
export function recordFile(home = os.homedir()) { return path.join(recordDir(home), 'install-record.json'); }

const emptyRecord = () => ({ stateSchema: RECORD_SCHEMA, targets: {} });
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// { state: 'ok' | 'none' | 'newer', record } . 'none' covers a missing, link, unreadable or malformed file; 'newer' a schema above ours.
export function loadInstallRecord(home = os.homedir()) {
  const file = recordFile(home);
  // 29ob (T-29nw-1): the record's own folder is the root, so ONE lstat of the file refuses a link (ELINK) and is the identity the opened handle is compared with
  // (dev and ino, config-bound.mjs openChecked). The separate lstat that used to stand here took its look at a different moment than the read's own identity did, so a name
  // swapped for a link between the two was followed. Missing, link, unreadable and (where the volume reports an inode) swapped all read as NONE; on a volume that reports inode 0
  // the compare is skipped (openChecked), so that leg is the old check by name and a name swapped after the lstat is read.
  let raw;
  try { raw = readConfigBounded(file, recordDir(home)); } catch { return { state: 'none', record: emptyRecord() }; }
  let parsed;
  try { parsed = JSON.parse(raw.startsWith(BOM) ? raw.slice(1) : raw); } catch { return { state: 'none', record: emptyRecord() }; }
  if (!isPlainObject(parsed)) return { state: 'none', record: emptyRecord() };
  if (typeof parsed.stateSchema === 'number' && parsed.stateSchema > RECORD_SCHEMA) return { state: 'newer', record: emptyRecord() };
  if (parsed.stateSchema !== RECORD_SCHEMA || !isPlainObject(parsed.targets)) return { state: 'none', record: emptyRecord() };
  return { state: 'ok', record: parsed };
}

// Writes the record in one step: a temp file opened exclusively, then rename (a link at the file is replaced, never written through).
// Throws on failure: the caller warns and sets the exit code, never crashes the install.
export function saveInstallRecord(home, record) {
  fs.mkdirSync(recordDir(home), { recursive: true });
  writeConfigAtomic(recordFile(home), JSON.stringify(record, null, 2) + '\n');
}

// Each file is read through an open plus fstat bound of MAX_CONFIG_BYTES; a file over it makes the folder unprovable.
const MAX_FILE_BYTES = BigInt(MAX_CONFIG_BYTES);

// The sha256 of every file under `dir`, keyed by its path inside `dir` with forward slashes. null when anything under it is a link,
// a non-file, an empty sub-folder, a file over the bound, or cannot be read: a folder with any of those is proven by nothing.
export function folderHashes(dir) {
  const out = {};
  const fail = () => { throw new Error('refused'); };
  const walk = (abs, rel) => {
    const entries = fs.readdirSync(abs);
    if (entries.length === 0 && rel !== '') fail();
    for (const name of entries) {
      const child = path.join(abs, name);
      const key = rel === '' ? name : `${rel}/${name}`;
      const st = fs.lstatSync(child, { bigint: true });
      if (st.isSymbolicLink()) fail();
      // STATED LIMIT (29ob F-1): a sub-folder that passes the lstat above and is swapped for a junction or directory link before walk() reads it is walked through, and the files
      // outside are hashed into the proof. Node's fs offers no handle-relative walk on any platform (29np), so this stays; only a writer of the skill folder can race it.
      if (st.isDirectory()) { walk(child, key); continue; }
      if (!st.isFile()) fail();
      // 29ob (T-29nw-2): the check (the lstat above) and the open are in this one function, and the opened handle is compared with that lstat on dev AND ino (bigint): a
      // child swapped for another file in between makes the folder unprovable, as a link does. An ino of 0 on either side (a filesystem that reports none) skips the compare.
      const fd = fs.openSync(child, 'r');
      let bytes;
      try {
        const hs = fs.fstatSync(fd, { bigint: true });
        if (st.ino !== 0n && hs.ino !== 0n && (hs.dev !== st.dev || hs.ino !== st.ino)) fail();
        if (hs.size > MAX_FILE_BYTES) fail();
        bytes = fs.readFileSync(fd);
      } finally { fs.closeSync(fd); }
      out[key] = createHash('sha256').update(bytes).digest('hex');
    }
  };
  try { walk(dir, ''); return out; } catch { return null; }
}

// Two hash maps name exactly the same files with exactly the same hashes.
export function sameHashes(a, b) {
  if (!a || !b) return false;
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
}
