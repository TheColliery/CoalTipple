// The SKILL.md frontmatter check stays linear on a malformed file and still judges a good one. The check used to look for the
// opening ---, then name:, then description:, then a closing --- with lazy matches in a row, so a file holding many name and
// description lines and no closing --- cost time that grew far faster than its size. The block is now found first (one lazy
// scan from the start) and the two keys are tested inside it. Zero-dep (node:test + built-ins), scripts-quality.md section 2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { skillFrontmatterOk } from './skill-frontmatter.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SIZE = 48 * 1024;
const BUDGET_MS = 50;
const PAIR = 'name: coaltipple\ndescription: x\n';

test('skillFrontmatterOk is fast on a 48 KB frontmatter that never closes (best of 3 runs, 50 ms)', () => {
  const shapes = {
    pairsNoClose: '---\n' + PAIR.repeat(Math.floor(SIZE / PAIR.length)),
    namesNoClose: '---\n' + 'name: coaltipple\n'.repeat(Math.floor(SIZE / 17)),
    descriptionsNoClose: '---\nname: coaltipple\n' + 'description: x\n'.repeat(Math.floor(SIZE / 15)),
  };
  for (const [name, text] of Object.entries(shapes)) {
    const times = [];
    for (let i = 0; i < 3; i++) {
      const t0 = process.hrtime.bigint();
      skillFrontmatterOk(text);
      times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    assert.ok(Math.min(...times) < BUDGET_MS, `${name}: best of 3 = ${Math.min(...times).toFixed(1)} ms, budget ${BUDGET_MS} ms`);
  }
});

test('skillFrontmatterOk accepts this room\'s SKILL.md and a minimal good block, LF or CRLF', () => {
  assert.equal(skillFrontmatterOk(fs.readFileSync(path.join(repo, 'skills', 'coaltipple', 'SKILL.md'), 'utf8')), true);
  assert.equal(skillFrontmatterOk('---\nname: coaltipple\ndescription: routes work\n---\nbody'), true);
  assert.equal(skillFrontmatterOk('---\r\nname: coaltipple\r\ndescription: routes work\r\n---\r\nbody'), true);
});

test('skillFrontmatterOk refuses a block with the wrong name, no description, no name, or no closing line', () => {
  assert.equal(skillFrontmatterOk('---\nname: other\ndescription: x\n---\n'), false, 'wrong name');
  assert.equal(skillFrontmatterOk('---\nname: coaltipple\n---\ndescription: after the block\n'), false, 'description outside the block');
  assert.equal(skillFrontmatterOk('---\ndescription: x\n---\n'), false, 'no name');
  assert.equal(skillFrontmatterOk('---\nname: coaltipple\ndescription: x\n'), false, 'no closing line');
  assert.equal(skillFrontmatterOk('name: coaltipple\ndescription: x\n---\n'), false, 'no opening line');
});
