// JSONC comment stripper — shared by scripts/lib/config-load.mjs and scripts/configure.mjs.
// The conductor (hooks/coaltipple-conductor.js) carries an inline copy of the same logic
// per Phoenix #9 (standalone-portable - no imports from scripts/). The declaration and its body are held
// byte-equal across this file, the conductor and the plugin/ mirror by scripts/lib/jsonc-sync.mjs.
// (Ported verbatim from CoalMine/scripts/lib/jsonc.mjs at commit 373c696, v3.23.8.)
//
// Strips // and /* */ comments that sit OUTSIDE strings, then leaves the rest
// untouched so JSON.parse can read a comment-tolerant .coaltipple.json. A string
// runs to its first unescaped quote, so a value ending in a literal backslash
// (e.g. "C:\\") terminates the string correctly instead of leaking escape state
// into the next token - which would mis-strip a later //-containing string and
// silently revert the whole config.
//
// One left-to-right pass with no backtracking: each character is visited once or twice, so the work is linear
// however many openers never close. An unclosed string or block comment is kept to the end of the input, so a
// malformed config still fails JSON.parse. An optional counter, `{ steps }`, receives one step per character
// visit; scripts/lib/jsonc-linear.test.mjs asserts the work by that count instead of reading a clock.

export function stripJsonc(content, counter) {
  const n = content.length;
  let out = '';
  let from = 0; // start of the text not yet copied to out
  let i = 0;
  let steps = 0;
  while (i < n) {
    steps++;
    const c = content[i];
    if (c === '"') {
      // a string runs to its first unescaped quote, or to the end of the input; it is kept whole
      i++;
      while (i < n) {
        steps++;
        if (content[i] === '\\') i += 2;
        else if (content[i++] === '"') break;
      }
      continue;
    }
    if (c === '/' && content[i + 1] === '/') {
      out += content.slice(from, i);
      i += 2;
      while (i < n) {
        steps++;
        const d = content[i];
        if (d === '\n' || d === '\r' || d === '\u2028' || d === '\u2029') break;
        i++;
      }
      from = i;
      continue;
    }
    if (c === '/' && content[i + 1] === '*') {
      let j = i + 2;
      while (j < n && !(content[j] === '*' && content[j + 1] === '/')) { steps++; j++; }
      if (j >= n) break; // unclosed: the rest of the input is kept as it is
      out += content.slice(from, i);
      i = j + 2;
      from = i;
      continue;
    }
    i++;
  }
  out += content.slice(from);
  if (counter) counter.steps += steps;
  return out;
}

// Prototype-pollution guard (OWASP Node.js; flock-canonical shape — CoalFace/CoalHearth/
// CoalWash/CoalLedger all ported this verbatim FROM this file, but the guard itself was
// never back-ported here). A poisoned project .coaltipple.json (e.g. shipped by an
// untrusted cloned repo) with a `__proto__` / `constructor` / `prototype` key would
// pollute Object.prototype through the `{ ...global, ...project }` spread merge in
// config-load.mjs. Drop those keys at parse (the reviver runs over the tree before
// anything uses it). stripJsonc stays exported for verify.mjs (reads the repo's OWN
// trusted committed factory template, not untrusted input — matches every sibling).
const PROTO_GUARD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
export function parseJsonc(content) {
  return JSON.parse(stripJsonc(content), (k, v) => (PROTO_GUARD_KEYS.has(k) ? undefined : v));
}
