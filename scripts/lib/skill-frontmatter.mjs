// The SKILL.md frontmatter check scripts/verify.mjs runs: a frontmatter block that names the skill and carries a description.
// The block is found first (one lazy scan from the start of the text, the same shape scripts/verify.mjs's frontmatterField uses),
// then the two keys are tested on lines inside it, so the cost stays linear in the size of the text however many name and
// description lines it holds and whether or not the closing --- exists.
export function skillFrontmatterOk(md) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  if (!block) return false;
  return /^name:[ \t]*coaltipple[ \t]*\r?$/m.test(block[1]) && /^description:/m.test(block[1]);
}
