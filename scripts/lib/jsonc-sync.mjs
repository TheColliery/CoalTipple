// Copy-sync guard for the JSONC strip and the config byte bound.
//
// The strip call (the regex AND its callback) lives in scripts/lib/jsonc.mjs, in the conductor's inline copy
// (hooks/coaltipple-conductor.js, which cannot import: Phoenix #9) and in the plugin/ mirror of that conductor.
// The byte bound's constant lives in scripts/lib/config-bound.mjs and in the same two conductor copies. A copy that
// drifts reads green everywhere else, so verify.mjs and scripts/lib/jsonc-linear.test.mjs both call this.
//
// checkJsoncSync(repoRoot) -> an array of failure strings; [] means every copy is byte-equal.
import fs from 'node:fs';
import path from 'node:path';

// First entry is the source; the rest are compared against it.
export const JSONC_SYNC_FILES = ['scripts/lib/jsonc.mjs', 'hooks/coaltipple-conductor.js', 'plugin/hooks/coaltipple-conductor.js'];
const BOUND_FILES = ['scripts/lib/config-bound.mjs', 'hooks/coaltipple-conductor.js', 'plugin/hooks/coaltipple-conductor.js'];
// Every file the guard reads (a test copying the repo into a scratch tree needs this whole set).
export const JSONC_GUARD_FILES = [...new Set([...JSONC_SYNC_FILES, ...BOUND_FILES])];
const CALL_START = 'content.replace(/"';
const CALL_END = ": ''))";
const BOUND_LINE = 'const MAX_CONFIG_BYTES = 1024 * 1024;';
const BOUND_LINE_SRC = 'export const MAX_CONFIG_BYTES = 1024 * 1024;';

function stripCall(text) {
  const a = text.indexOf(CALL_START);
  if (a === -1) return null;
  const b = text.indexOf(CALL_END, a);
  return b === -1 ? null : text.slice(a, b + CALL_END.length);
}

export function checkJsoncSync(repo) {
  const out = [];
  const read = (rel) => { try { return fs.readFileSync(path.join(repo, rel), 'utf8'); } catch (e) { out.push(`${rel}: cannot read (${e.code || e.message})`); return null; } };
  const src = read(JSONC_SYNC_FILES[0]);
  const want = src === null ? null : stripCall(src);
  if (src !== null && want === null) out.push(`${JSONC_SYNC_FILES[0]}: the strip call (regex and callback) was not found`);
  for (const rel of JSONC_SYNC_FILES.slice(1)) {
    const text = read(rel);
    if (text === null || want === null) continue;
    const got = stripCall(text);
    if (got === null) out.push(`${rel}: the strip call (regex and callback) was not found`);
    else if (got !== want) out.push(`${rel}: JSONC strip call DIVERGED from ${JSONC_SYNC_FILES[0]}`);
  }
  const bound = read(BOUND_FILES[0]);
  if (bound !== null && !bound.includes(BOUND_LINE_SRC)) out.push(`${BOUND_FILES[0]}: the MAX_CONFIG_BYTES line (${BOUND_LINE_SRC}) was not found`);
  for (const rel of BOUND_FILES.slice(1)) {
    const text = read(rel);
    if (text !== null && !text.includes(BOUND_LINE)) out.push(`${rel}: MAX_CONFIG_BYTES line (${BOUND_LINE}) DIVERGED from ${BOUND_FILES[0]}`);
  }
  return out;
}
