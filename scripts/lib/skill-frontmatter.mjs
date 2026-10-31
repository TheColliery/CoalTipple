// The SKILL.md frontmatter check scripts/verify.mjs runs: a frontmatter block that names the skill and carries a description.
// One left-to-right pass with no backtracking, so the work is linear on every input however many name and description lines the
// text holds and whether or not the closing --- exists. It reads what the old pattern pair read: a block that opens with ---,
// ends at the first line break followed by ---, and holds a line `name: coaltipple` and a line that starts `description:`.
// A line break is \n, \r, U+2028 or U+2029 for the key lines (the multiline reading the old pattern used); the block's own
// opening and closing lines break on \n or \r\n.
// An optional counter, `{ steps }`, receives the number of character visits, so a test can assert the work is proportional
// to the text without reading a clock (scripts/lib/skill-frontmatter.test.mjs).
// U+2028 and U+2029 are written as code points: the source stays visible and safe from transit.
const isBreak = (c) => c === '\n' || c === '\r' || c === '\u2028' || c === '\u2029';
const isBlank = (c) => c === ' ' || c === '\t';

// Whether the line that starts at index p (and ends at end) is exactly `name: coaltipple`, blanks allowed after the colon and at the end.
function nameLine(md, p, end, tick) {
  const key = 'name:';
  if (!md.startsWith(key, p)) return false;
  let i = p + key.length;
  while (i < end && isBlank(md[i])) { i++; tick(); }
  const val = 'coaltipple';
  if (!md.startsWith(val, i)) return false;
  i += val.length;
  while (i < end && isBlank(md[i])) { i++; tick(); }
  return i === end || isBreak(md[i]);
}

export function skillFrontmatterOk(md, counter) {
  let steps = 0;
  const tick = () => { steps++; };
  const done = (v) => { if (counter) counter.steps += steps; return v; };
  if (!md.startsWith('---')) return done(false);
  let bs;
  if (md[3] === '\n') bs = 4;
  else if (md[3] === '\r' && md[4] === '\n') bs = 5;
  else return done(false);
  // the block ends at the first line break that is followed by ---
  let be = -1;
  for (let b = bs; b < md.length; b++) {
    tick();
    if (md[b] === '\n' && md.startsWith('---', b + 1)) { be = b; break; }
    if (md[b] === '\r' && md[b + 1] === '\n' && md.startsWith('---', b + 2)) { be = b; break; }
  }
  if (be < 0) return done(false);
  let hasName = false;
  let hasDescription = false;
  let atStart = true;
  for (let i = bs; i <= be; i++) {
    tick();
    if (atStart) {
      if (!hasName && nameLine(md, i, be, tick)) hasName = true;
      if (!hasDescription && i + 12 <= be && md.startsWith('description:', i)) hasDescription = true;
      if (hasName && hasDescription) return done(true);
      atStart = false;
    }
    if (i < be && isBreak(md[i])) atStart = true;
  }
  return done(hasName && hasDescription);
}
