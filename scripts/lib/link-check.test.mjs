// CW-017 -- zero-dep unit tests for scripts/lib/link-check.mjs. Fixtures live under
// scripts/fixtures/link-check/ (excluded from the real walk -- the workflow's own
// `git ls-files ... | grep -v '^scripts/fixtures/'` line, and CW-017's own dispatch:
// "Excluded from the WALK, never from the TESTS.").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  slugifyHeading,
  extractHeadingSlugs,
  extractLinkTargets,
  checkLinks,
} from './link-check.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = path.join(repo, 'scripts', 'fixtures', 'link-check');

// Real small trees on disk (mirrors the shape checkLinks() is actually driven with
// at runtime -- a repo-relative resolve()/readHeadings() pair), read once per test
// via helpers rather than hand-built in-memory surfaces, so the ON-DISK fixtures
// (not a restatement of them) are what the tests actually exercise.
function readTreeMd(root) {
  const out = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      if (fs.statSync(abs).isDirectory()) { walk(abs); continue; }
      if (name.endsWith('.md')) out.push(abs);
    }
  })(root);
  return out;
}

function surfacesFor(root) {
  return readTreeMd(root).map((abs) => {
    const rel = path.relative(root, abs).replace(/\\/g, '/');
    return { label: rel, text: fs.readFileSync(abs, 'utf8'), dir: path.dirname(rel).replace(/^\.$/, '') };
  });
}

function ioFor(root) {
  const readRel = (rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return undefined; } };
  return {
    resolve: (rel) => (readRel(rel) !== undefined ? 'exists' : 'missing'),
    readHeadings: (rel) => { const t = readRel(rel); return t === undefined ? null : extractHeadingSlugs(t); },
  };
}

test('checkLinks: the GREEN fixture is entirely clean -- zero findings', () => {
  const root = path.join(FIXTURES, 'green');
  const findings = checkLinks({ surfaces: surfacesFor(root), ...ioFor(root) });
  assert.deepEqual(findings, [], JSON.stringify(findings));
});

test('checkLinks: the RED fixture -- all three planted defects FAIL, none silently pass', () => {
  const root = FIXTURES; // walk both red/ and green/ together; red/ carries the defects
  const findings = checkLinks({ surfaces: surfacesFor(path.join(root, 'red')), ...ioFor(path.join(root, 'red')) });
  const msgs = findings.map((f) => f.msg).join('\n');
  assert.equal(findings.length, 3, msgs);
  assert.match(msgs, /does-not-exist\.md.*does not resolve/s, 'planted defect 1: missing relative file');
  assert.match(msgs, /#no-such-heading.*matches no heading/s, 'planted defect 2: same-file anchor matches no heading');
  assert.match(msgs, /target\.md#missing-heading.*matches no heading in.*target\.md/s, 'planted defect 3: cross-file anchor, file exists, heading does not');
  assert.ok(findings.every((f) => f.level === 'FAIL'));
});

// findings-back, CW-017 round 1 HIGH-1 -- the gate's ONLY mechanism (main()'s own
// process.exitCode assignment) had NO test: every test above drives the pure
// exports directly and never spawns the real CLI, so `process.exitCode = 0;` in
// place of the real ternary left the whole suite byte-identically green (measured
// by INSPECT: engine exit 1->0 on the RED fixture, workflow body exit 1->0 on a
// planted defect while STILL PRINTING the FAIL line, `node scripts/test.mjs`
// unchanged). This is the exact shape the unit exists to prevent -- "a gate wired
// without a red proof looks strict and cannot fail" -- and the one mechanism this
// module actually has, so it gets the SAME kind of call-site test this room used to
// close CWK-090's MEDIUM-2 last sitting: spawn the real file, assert the real exit.
const ENGINE = path.join(repo, 'scripts', 'lib', 'link-check.mjs');

test('link-check.mjs CLI: spawned against the RED fixture, exits 1 (the gate\'s ONLY mechanism -- process.exitCode -- pinned by a real spawn, not a pure-export call)', () => {
  const files = readTreeMd(path.join(FIXTURES, 'red')).map((abs) => path.relative(repo, abs).replace(/\\/g, '/'));
  const r = spawnSync(process.execPath, [ENGINE, ...files], { cwd: repo, encoding: 'utf8' });
  assert.equal(r.status, 1, `RED fixture must exit 1, got status=${r.status}:\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /^3 finding\(s\) across 4 file\(s\)$/m);
});

test('link-check.mjs CLI: spawned against the GREEN fixture, exits 0', () => {
  const files = readTreeMd(path.join(FIXTURES, 'green')).map((abs) => path.relative(repo, abs).replace(/\\/g, '/'));
  const r = spawnSync(process.execPath, [ENGINE, ...files], { cwd: repo, encoding: 'utf8' });
  assert.equal(r.status, 0, `GREEN fixture must exit 0, got status=${r.status}:\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /^0 finding\(s\) across 4 file\(s\)$/m);
});

test('checkLinks: the discriminating pair -- a citer-relative link resolves correctly, and the engine never asks about the repo-root-joined form', () => {
  const seen = [];
  const findings = checkLinks({
    surfaces: [{
      label: 'sub/citer.md',
      dir: 'sub',
      text: 'See [sibling](sibling.md).',
    }],
    resolve: (rel) => { seen.push(rel); return rel === 'sub/sibling.md' ? 'exists' : 'missing'; },
    readHeadings: () => new Set(),
  });
  assert.equal(findings.length, 0, JSON.stringify(findings));
  assert.deepEqual(seen, ['sub/sibling.md'], 'must ask about sub/sibling.md (citer-relative); must NEVER ask about sibling.md (repo-root-relative)');
});

test('checkLinks: an external URL, a mailto: link, a protocol-relative link, and an absolute link are all OUT OF SCOPE -- never asked about', () => {
  const seen = [];
  const findings = checkLinks({
    surfaces: [{
      label: 'a.md',
      dir: '',
      text: 'See [ext](https://example.com/x), [mail](mailto:a@b.com), [proto](//example.com/x), [abs](/etc/passwd), [home](~/x).',
    }],
    resolve: (rel) => { seen.push(rel); return 'missing'; },
    readHeadings: () => new Set(),
  });
  assert.deepEqual(seen, [], 'none of these five shapes should ever reach resolve()');
  assert.equal(findings.length, 0);
});

test('checkLinks: an unreadable surface reports a SKIP, never a silent pass or a crash', () => {
  const findings = checkLinks({
    surfaces: [{ label: 'ghost.md', dir: '', text: undefined }],
    resolve: () => 'missing',
    readHeadings: () => null,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].level, 'SKIP');
  assert.match(findings[0].msg, /could not read ghost\.md/);
});

test('checkLinks: no resolve()/readHeadings() supplied -- FAILs naming the gap, never crashes', () => {
  const findings = checkLinks({ surfaces: [{ label: 'a.md', text: 'x' }] });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].level, 'FAIL');
  assert.match(findings[0].msg, /no resolve\(\)\/readHeadings\(\) supplied/);
});

// SLUG SHAPES -- verified against real headings in THIS room's own tracked .md files
// (re-derive: `grep -n '^#' CHANGELOG.md README.md CONTRIBUTING.md SECURITY.md`),
// per CW-017's own instruction to state which shapes were checked by name.

test('slugifyHeading: a Keep-a-Changelog em-dash date heading -- "[1.0.4] — 2026-06-15" (5 real headings in CHANGELOG.md carry this exact shape)', () => {
  // Whitespace collapses to a hyphen BEFORE punctuation strips -- the two single
  // spaces flanking the em dash each become their OWN hyphen; the em dash itself is
  // stripped (not an ASCII hyphen), leaving the two survive ADJACENT: a double
  // hyphen, not a clean single one. `[`, `]`, `.` are punctuation and vanish too.
  assert.equal(slugifyHeading('[1.0.4] — 2026-06-15'), '104--2026-06-15');
});

test('slugifyHeading: a Keep-a-Changelog ASCII-hyphen date heading -- "[1.5.5] - 2026-09-10" (this room\'s own current, dominant CHANGELOG shape)', () => {
  // Three whitespace-adjacent hyphens survive: the space before the literal `-`
  // (collapsed to hyphen), the literal `-` itself (already a kept character), and
  // the space after it (collapsed to hyphen) -- a TRIPLE hyphen.
  assert.equal(slugifyHeading('[1.5.5] - 2026-09-10'), '155---2026-09-10');
});

test('slugifyHeading: an emoji-prefixed heading -- "🚂 CoalTipple" (README.md\'s own H1) -- the emoji vanishes, its separating space survives as a LEADING hyphen', () => {
  assert.equal(slugifyHeading('🚂 CoalTipple'), '-coaltipple');
});

test('slugifyHeading: an emoji-plus-ampersand heading -- "💻 Developing & Testing" (CONTRIBUTING.md\'s own H2)', () => {
  assert.equal(slugifyHeading('💻 Developing & Testing'), '-developing--testing');
});

test('slugifyHeading: a plain ASCII heading is untouched but for casing and space-to-hyphen', () => {
  assert.equal(slugifyHeading('Step 1 — Grade the task (deterministic, not self-assessment)'), 'step-1--grade-the-task-deterministic-not-self-assessment');
});

test('slugifyHeading: a synthetic Thai heading with NO combining marks slugs to its own letters, never to an empty string (no live heading in this tree carries one -- prospective coverage, per CW-017)', () => {
  const slug = slugifyHeading('ทดสอบ Thai heading');
  assert.ok(slug.length > 0);
  assert.equal(slug, 'ทดสอบ-thai-heading');
});

test('slugifyHeading: a synthetic CJK heading slugs to its own letters too (CJK carries no combining marks, so this case is not the contested one below)', () => {
  const slug = slugifyHeading('测试 CJK heading');
  assert.ok(slug.length > 0);
  assert.equal(slug, '测试-cjk-heading');
});

// findings-back, CW-017 round 1 MEDIUM-1 -- the test above this one carries ZERO
// combining marks (`\p{M}`), so it passes identically under a drop-`\p{M}` rule AND
// a keep-`\p{M}` rule and pins NOTHING about which one this engine actually
// implements -- a claim ("slugs to its OWN letters") tested with a fixture that
// avoids the input where the claim breaks. A REAL Thai heading with vowels/tones
// (unlike the ASCII-transliterated fixture above) DOES carry combining marks.
//
// ROUND 2 CORRECTION: this test used to pin the LOSSY round-1 behaviour
// (consonants survive, vowels/tones dropped). That behaviour was found to
// DIVERGE from github-slugger, the reference implementation of GitHub's own
// heading-slug rule (`Flet/github-slugger`, `index.js`+`regex.js`, re-measured
// directly against a fetched copy of the source, `slugifyHeading`'s own comment
// in this file's sibling `link-check.mjs` carries the reasoning in full) --
// the reference KEEPS `\p{M}`, we dropped it. Conformed: the strip class now keeps `\p{M}`, so this heading's
// combining marks SURVIVE and the slug matches GitHub's real rendered anchor.
// This test now pins the CORRECT, conformant behaviour, not the old lossy one.
test('slugifyHeading: a REAL Thai heading WITH combining marks (vowels/tones) KEEPS them -- conforms to github-slugger, the reference implementation of GitHub\'s heading-slug rule', () => {
  const heading = 'ตัวอย่าง หัวข้อ ไทย'; // 4 combining marks (verified: 4 code points in \p{M})
  assert.equal([...heading].filter((ch) => /\p{M}/u.test(ch)).length, 4, 'fixture assumption broken -- this heading must carry combining marks for the test to mean anything');
  assert.equal(slugifyHeading(heading), 'ตัวอย่าง-หัวข้อ-ไทย');
});

test('extractHeadingSlugs: a duplicate-heading pair de-duplicates with -1, -2 -- CHANGELOG.md\'s own repeated "### Fixed"/"### Changed" shape', () => {
  const slugs = extractHeadingSlugs('# Fixed\n\n# Fixed\n\n# Fixed\n');
  assert.deepEqual([...slugs], ['fixed', 'fixed-1', 'fixed-2']);
});

test('extractLinkTargets: an image path is extracted the same as a link path (PATH resolution, never alt-text content)', () => {
  assert.deepEqual(extractLinkTargets('![alt text](img/logo.png)'), ['img/logo.png']);
});

test('extractLinkTargets: a link inside a fenced code block is an EXAMPLE, never a real citation -- not extracted', () => {
  const text = '```md\n[fenced](nope.md)\n```\n\n[real](real.md)\n';
  assert.deepEqual(extractLinkTargets(text), ['real.md']);
});

test('extractLinkTargets: a bare autolink (<https://...>) is a DIFFERENT syntax, invisible to this regex by construction', () => {
  assert.deepEqual(extractLinkTargets('See <https://example.com/x> for details.'), []);
});
