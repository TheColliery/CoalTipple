// Link extraction is linear on every input shape, and a test proves it by counting work, never by reading a clock.
// extractLinkTargets is a single-pass scanner with an optional counter ({ steps }, one step per character visit).
// Three things are held here:
//   1. the scanner returns exactly what the old pattern returned wherever that pattern finishes (a differential test over this
//      repo's own markdown, the fixtures below and a seeded random corpus of short strings),
//   2. its step count stays under C * text length and at most doubles when the text doubles, on the shapes that used to be
//      quadratic and on shapes aimed at the scanner's own two shared scans,
//   3. that witness goes red on a deliberately quadratic stand-in (a mutant that drops a shared scan), so it can fail.
// Zero-dep (node:test + built-ins), scripts-quality.md section 2; testing.md Determinism: no clock, a fixed seed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractLinkTargets, stripFences } from './link-check.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// The pattern the scanner replaced, kept verbatim as the reference. It is only run on inputs where it finishes fast.
const OLD_LINK_RE = /(!?)\[[^[\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const oldTargets = (text) => [...stripFences(text).matchAll(OLD_LINK_RE)].map((m) => m[2]);

// C is the most character visits per input character the witness accepts. The scanner visits a character once to find a
// start, once in a label or destination scan, and once in a title scan; it measures 1 to 2 on the shapes below, so 6 leaves room
// and still fails a quadratic scan at those sizes (a mutant at n = 4096 takes more than 2000 per character).
const C = 6;
const SLACK = 64;

function linearityFailure(extract, text) {
  const counter = { steps: 0 };
  extract(text, counter);
  return { steps: counter.steps, length: text.length };
}

// Returns '' when the extractor is linear on the shape at both sizes, else the first thing that is not.
function witness(extract, name, build) {
  const small = linearityFailure(extract, build(4096));
  const large = linearityFailure(extract, build(8192));
  if (small.steps > C * small.length) return `${name}: ${small.steps} steps for ${small.length} characters, over ${C} per character`;
  if (large.steps > C * large.length) return `${name}: ${large.steps} steps for ${large.length} characters, over ${C} per character`;
  // doubling n roughly doubles the text, so the steps may at most double (plus a small constant)
  if (large.steps > 2 * small.steps + SLACK) return `${name}: ${small.steps} steps became ${large.steps} when the text went from ${small.length} to ${large.length} characters`;
  return '';
}

const SHAPES = {
  'the "[](" run': (n) => '[]('.repeat(n),
  'the unclosed "[" run': (n) => '['.repeat(n),
  'a "[](" run, then a title that never closes': (n) => '[]('.repeat(n) + ' "' + 'x'.repeat(4 * n),
  'a "[](a" start, then a long white space run': (n) => '[](a' + ' '.repeat(4 * n) + 'x',
  'a title that closes without ")" after every start': (n) => '[](a "t"x'.repeat(n),
  'a "](" run with a label that closes each time': (n) => '[x](x'.repeat(n),
};

test('extractLinkTargets work is linear in the text: steps stay under C per character and at most double when the text doubles', () => {
  for (const [name, build] of Object.entries(SHAPES)) {
    const failure = witness(extractLinkTargets, name, build);
    assert.equal(failure, '', failure);
  }
});

// A deliberately quadratic stand-in for the scanner: the same reading, with a shared scan dropped. With stopCache false every start
// rescans its destination to the end of the line; with titleCache false every start rescans its title. Red-first record for the witness.
function mutantExtract({ stopCache, titleCache }) {
  return (text, counter) => {
    const s = stripFences(text);
    const n = s.length;
    const isWs = (c) => /\s/.test(c);
    let steps = 0;
    let stopEnd = -1;
    let titleKey = -1;
    let p = 0;
    while (p < n) {
      steps++;
      if (s[p] !== '[') { p++; continue; }
      let j = p + 1;
      while (j < n && s[j] !== '[' && s[j] !== ']' && s[j] !== '\n') { j++; steps++; }
      if (!(j + 1 < n && s[j] === ']' && s[j + 1] === '(')) { p = j; continue; }
      const d = j + 2;
      if (!stopCache || d > stopEnd) {
        let e = d;
        while (e < n && s[e] !== ')' && !isWs(s[e])) { e++; steps++; }
        stopEnd = e;
      }
      const e = stopEnd;
      if (e === d || e >= n || s[e] === ')') { p = j; continue; }
      if (!titleCache || titleKey !== e) {
        titleKey = e;
        let k = e;
        while (k < n && isWs(s[k])) { k++; steps++; }
        if (k < n && s[k] === '"') { let q = k + 1; while (q < n && s[q] !== '"') { q++; steps++; } }
      }
      p = j;
    }
    counter.steps += steps;
    return [];
  };
}

test('the work witness goes red on a quadratic stand-in: one without the destination cache and one without the title cache', () => {
  const noStop = witness(mutantExtract({ stopCache: false, titleCache: true }), 'the "[](" run', SHAPES['the "[](" run']);
  assert.notEqual(noStop, '', 'a scanner that rescans each destination to the end must fail the "[](" run witness');
  const noTitle = witness(mutantExtract({ stopCache: true, titleCache: false }), 'title', SHAPES['a "[](" run, then a title that never closes']);
  assert.notEqual(noTitle, '', 'a scanner that rescans each title must fail the unclosed-title witness');
  // and the unmutated stand-in (both caches on) stays inside the bound, so the red above is the dropped cache and nothing else
  for (const [name, build] of Object.entries(SHAPES)) {
    assert.equal(witness(mutantExtract({ stopCache: true, titleCache: true }), name, build), '', name);
  }
});

test('extractLinkTargets still finds an ordinary link, an image, and a link after an unclosed bracket', () => {
  assert.deepEqual(extractLinkTargets('see [docs](./a.md) and ![logo](./img/b.png) and [x [y](./c.md) tail'), ['./a.md', './img/b.png', './c.md']);
  assert.deepEqual(extractLinkTargets('[unclosed\n\nlater [y](./d.md)'), ['./d.md']);
  assert.deepEqual(extractLinkTargets('[![badge](./badge.svg)](./home.md)'), ['./badge.svg']);
  assert.deepEqual(extractLinkTargets('[t](./a.md "a title") and [u](./b.md \t\n "second")'), ['./a.md', './b.md']);
});

const FIXTURES = [
  '', '[', '[]', '[](', '[]()', '[](a)', '[](a', '[](a ', '[](a "', '[](a "t', '[](a "t"', '[](a "t")', '[](a  "t")', '[](a\n"t")',
  '[a](b[c](d)', '![x](y)', '!![x](y)', '[x]](y)', '[x](y))', '[x]( y)', '[x](y "z" )', '[[x](y)](z)', '[x\ny](z)', '[x](y\nz)',
  '[x](y "a\nb")', '[x](y "a""b")', '[x](y "a" "b")', '[x] (y)', '[x](y)[z](w)', '[x](y)[z](w', '[](][](a)', '[](x "y"[](z)',
  'text [a](b) more [c](d "e") end', '[x](a "t")', '[x](a "t")', '[x](a\t"t")', '[x](a\r\n"t")',
];

test('differential: the scanner returns what the old pattern returned on the existing fixtures and this repo\'s own markdown', () => {
  let compared = 0;
  for (const text of FIXTURES) {
    assert.deepEqual(extractLinkTargets(text), oldTargets(text), JSON.stringify(text));
    compared++;
  }
  const mdFiles = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === '.git' || ent.name === 'node_modules' || ent.name === 'scratchpad' || ent.name === 'coverage') continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile() && ent.name.endsWith('.md')) mdFiles.push(full);
    }
  };
  walk(repo);
  mdFiles.sort();
  assert.ok(mdFiles.length > 0, 'the repo holds markdown files');
  for (const file of mdFiles) {
    const text = fs.readFileSync(file, 'utf8');
    assert.deepEqual(extractLinkTargets(text), oldTargets(text), path.relative(repo, file));
    compared++;
  }
  assert.ok(compared >= FIXTURES.length + mdFiles.length);
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

test('differential: the scanner returns what the old pattern returned on 20000 seeded random short strings', () => {
  const alphabet = ['[', ']', '(', ')', '!', ' ', 'x', '"', '\n'];
  const rand = seeded(2904);
  const CASES = 20000;
  for (let i = 0; i < CASES; i++) {
    const len = Math.floor(rand() * 40);
    let text = '';
    for (let k = 0; k < len; k++) text += alphabet[Math.floor(rand() * alphabet.length)];
    assert.deepEqual(extractLinkTargets(text), oldTargets(text), JSON.stringify(text));
  }
});
