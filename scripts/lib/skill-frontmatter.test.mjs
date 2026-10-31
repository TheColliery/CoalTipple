// The SKILL.md frontmatter check stays linear on a malformed file and still judges a good one. The check is a single-pass scanner
// with an optional counter ({ steps }, one step per character visit), and this file proves its work by counting, never by reading a clock:
//   1. it returns what the old pattern pair returned on a seeded random corpus of short strings (a differential test against the
//      pattern kept below as OLD_), and on this repo's own SKILL.md,
//   2. its step count stays under C * text length and at most doubles when the text doubles, on the shapes that used to cost
//      far more than their size,
//   3. that witness goes red on a deliberately quadratic stand-in, so it can fail.
// Zero-dep (node:test + built-ins), scripts-quality.md section 2; testing.md Determinism: no clock, a fixed seed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { skillFrontmatterOk } from './skill-frontmatter.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// The check as it stood before the scanner: find the block, then test the two keys on lines inside it. Kept verbatim as the reference.
function OLD_skillFrontmatterOk(md) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  if (!block) return false;
  return /^name:[ \t]*coaltipple[ \t]*\r?$/m.test(block[1]) && /^description:/m.test(block[1]);
}

// The most character visits per input character the witness accepts: one to find the block end, one on the line pass, and a
// blank run at most once more. The scanner measures between 1 and 3 on the shapes below (3 on the blank run).
const C = 6;
const SLACK = 64;
const PAIR = 'name: coaltipple\ndescription: x\n';

function witness(check, name, build) {
  const run = (n) => { const text = build(n); const counter = { steps: 0 }; check(text, counter); return { steps: counter.steps, length: text.length }; };
  const small = run(2048);
  const large = run(4096);
  if (small.steps > C * small.length) return `${name}: ${small.steps} steps for ${small.length} characters, over ${C} per character`;
  if (large.steps > C * large.length) return `${name}: ${large.steps} steps for ${large.length} characters, over ${C} per character`;
  if (large.steps > 2 * small.steps + SLACK) return `${name}: ${small.steps} steps became ${large.steps} when the text went from ${small.length} to ${large.length} characters`;
  return '';
}

const SHAPES = {
  'name and description pairs, never closed': (n) => '---\n' + PAIR.repeat(n),
  'name lines only, never closed': (n) => '---\n' + 'name: coaltipple\n'.repeat(n),
  'description lines only, never closed': (n) => '---\nname: coaltipple\n' + 'description: x\n'.repeat(n),
  'a long blank run after name:': (n) => '---\nname:' + ' '.repeat(8 * n) + 'x\ndescription: y\n---\n',
  'many lines in a closed block, neither key': (n) => '---\n' + 'x: y\n'.repeat(n) + '---\n',
  'dashes that never form a closing line': (n) => '---\n' + '-- \n'.repeat(n),
  'a block of carriage returns': (n) => '---\r\n' + '\r'.repeat(4 * n),
};

test('skillFrontmatterOk work is linear in the text: steps stay under C per character and at most double when the text doubles', () => {
  for (const [name, build] of Object.entries(SHAPES)) {
    const failure = witness(skillFrontmatterOk, name, build);
    assert.equal(failure, '', failure);
  }
});

// A deliberately quadratic stand-in: the same verdict, but every line start rescans the whole block for the closing ---. Red-first record.
function quadraticStandIn(md, counter) {
  let steps = 0;
  if (!md.startsWith('---\n')) { counter.steps += 1; return false; }
  for (let i = 4; i < md.length; i++) {
    if (md[i - 1] !== '\n') continue;
    for (let b = i; b < md.length; b++) { steps++; if (md[b] === '\n' && md.startsWith('---', b + 1)) break; }
  }
  counter.steps += steps;
  return false;
}

test('the work witness goes red on a quadratic stand-in that rescans the block at every line start', () => {
  const failure = witness(quadraticStandIn, 'name and description pairs, never closed', SHAPES['name and description pairs, never closed']);
  assert.notEqual(failure, '', 'a scanner that rescans for the closing line at each line start must fail the witness');
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

// mulberry32: a small seeded generator, so the corpus is the same on every run and every platform
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('differential: the scanner returns what the old pattern pair returned on this repo\'s SKILL.md and 30000 seeded random texts', () => {
  const skill = fs.readFileSync(path.join(repo, 'skills', 'coaltipple', 'SKILL.md'), 'utf8');
  assert.equal(skillFrontmatterOk(skill), OLD_skillFrontmatterOk(skill));
  const pieces = ['---', '\n', '\r\n', '\r', '\u2028', ' ', '\t', 'name:', 'coaltipple', 'description:', 'x', '-', 'nam', ': '];
  const lines = ['name: coaltipple', 'name:coaltipple', 'name:\tcoaltipple \t', 'name: coaltipple x', ' name: coaltipple', 'name: other', 'description: x', 'description:', 'Description: x', 'x', '', '---', '--'];
  const breaks = ['\n', '\n', '\r\n', '\r', '\u2028'];
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const rand = seeded(2904);
  let accepted = 0;
  const CASES = 30000;
  for (let i = 0; i < CASES; i++) {
    let text = '';
    if (i % 2 === 0) {
      // structured: an opening line, lines of the shapes the check reads, then usually a closing line
      text = '---' + (rand() < 0.7 ? '\n' : '\r\n');
      const count = Math.floor(rand() * 6);
      for (let k = 0; k < count; k++) text += pick(lines) + pick(breaks);
      if (rand() < 0.85) text += '---' + pick(breaks);
    } else {
      // raw: random pieces, most of them behind an opening line, so the block logic is reached
      text = rand() < 0.8 ? (rand() < 0.5 ? '---\n' : '---\r\n') : '';
      const count = Math.floor(rand() * 14);
      for (let k = 0; k < count; k++) text += pick(pieces);
    }
    const want = OLD_skillFrontmatterOk(text);
    if (want) accepted++;
    assert.equal(skillFrontmatterOk(text), want, JSON.stringify(text));
  }
  // the corpus must reach the accepting path too, or agreement on refusals alone would prove little
  assert.ok(accepted >= 100, `only ${accepted} of ${CASES} random texts were accepted`);
});
