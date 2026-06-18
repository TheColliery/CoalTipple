// JSONC comment stripper — shared by scripts/lib/config-load.mjs and scripts/configure.mjs.
// The conductor (hooks/coaltipple-conductor.js) carries an inline copy of the same logic
// per Phoenix #9 (standalone-portable — no imports from scripts/).
//
// Strips // and /* */ comments that sit OUTSIDE strings, then leaves the rest
// untouched so JSON.parse can read a comment-tolerant .coaltipple.json. The string
// alternative consumes an escaped char (\\.) or any non-quote/non-backslash char,
// so a value ending in a literal backslash (e.g. "C:\\") terminates the string
// correctly instead of leaking escape state into the next token — which would
// mis-strip a later //-containing string and silently revert the whole config.
// (Ports the CM #12 fix from CoalMine/scripts/lib/jsonc.mjs verbatim-in-spirit.)

export function stripJsonc(content) {
  return content.replace(/"(?:\\.|[^"\\])*"|\/\/.*|\/\*[\s\S]*?\*\//g, (m) => (m[0] === '"' ? m : ''));
}
