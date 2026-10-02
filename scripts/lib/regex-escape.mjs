// ONE standard RegExp-metacharacter escape for every pattern this room builds from a variable
// (R14 ALERT FIX, CodeQL js/incomplete-sanitization #40: a hand-rolled `name.replace(/\$/g, '\\$')`
// escaped ONE metacharacter and not the backslash). Every character that has a meaning outside a
// character class is escaped, the backslash included, with the form MDN and the vendor's own
// guidance give; `-` is left alone (it is only special INSIDE a class, and these patterns never
// interpolate into one). scripts/lib/grade.mjs and hooks/coaltipple-conductor.js carry the same
// expression inline: the hook must stay standalone (Phoenix #2/#9, it never imports scripts/) and
// grade.mjs predates this file; both already conform, and regex-escape.test.mjs pins the form.
export const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
