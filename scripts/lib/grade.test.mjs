// Zero-dep unit tests for the deterministic grader. Run: node --test grade.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grade } from './grade.mjs';

test('trivial prompt, no files -> grade 1 / low', () => {
  const r = grade({ prompt: 'list the readme files' });
  assert.equal(r.grade, 1);
  assert.equal(r.tier, 'low');
});

test('single small file -> grade 2', () => {
  const r = grade({ prompt: 'fix typo', files: [{ path: 'src/util.js', lines: 40 }] });
  assert.equal(r.grade, 2);
});

test('2 files / 600 lines -> grade 3 / mid', () => {
  const r = grade({ prompt: 'refactor', files: [{ path: 'a.js', lines: 300 }, { path: 'b.js', lines: 300 }] });
  assert.equal(r.grade, 3);
  assert.equal(r.tier, 'mid');
});

test('>3 files -> grade 4 / heavy', () => {
  const r = grade({ prompt: 'x', files: [{ path: 'a' }, { path: 'b' }, { path: 'c' }, { path: 'd' }] });
  assert.equal(r.grade, 4);
  assert.equal(r.tier, 'heavy');
});

test('sensitive path forces >=4 even at 1 small file (kills overconfidence)', () => {
  const r = grade({ prompt: 'small tweak', files: [{ path: 'src/auth/login.js', lines: 30 }] });
  assert.equal(r.grade, 4);
  assert.match(r.reasons.join(' '), /sensitive/);
});

test('concurrency keyword forces grade 5 regardless of size', () => {
  const r = grade({ prompt: 'is there a race condition in this mutex?', files: [{ path: 'x.js', lines: 10 }] });
  assert.equal(r.grade, 5);
  assert.equal(r.tier, 'reasoning');
});

test('excluded dirs do not count toward breadth', () => {
  const r = grade({ prompt: 'x', files: [{ path: 'node_modules/foo/a.js', lines: 9999 }] });
  assert.equal(r.grade, 1);
});

test('deterministic — same input, same output', () => {
  const input = { prompt: 'optimize query in a db migration', files: [{ path: 'm.sql', lines: 50 }] };
  assert.deepEqual(grade(input), grade(input));
});

test('keyword match is word-boundary: no false grade on embedded words, plurals still fire', () => {
  assert.equal(grade({ prompt: 'translate an anatomical diagram', sizeUnits: 80 }).grade, 2); // 'atomic' must NOT fire inside 'anatomical'
  assert.equal(grade({ prompt: 'summarize immigration policy', sizeUnits: 80 }).grade, 2);    // 'migration' must NOT fire inside 'immigration'
  assert.equal(grade({ prompt: 'run the db migrations', sizeUnits: 10 }).grade, 4);            // 'migration' still matches the plural
  assert.equal(grade({ prompt: 'fix the atomic counter', sizeUnits: 10 }).grade, 5);          // real 'atomic' still fires
});

test('non-code task graded by generalized sizeUnits (translation/research/docs)', () => {
  assert.equal(grade({ prompt: 'translate this paragraph', sizeUnits: 80 }).grade, 2);  // small content
  assert.equal(grade({ prompt: 'translate this chapter', sizeUnits: 700 }).grade, 3);   // medium
  assert.equal(grade({ prompt: 'translate this whole book', sizeUnits: 5000 }).grade, 4); // large
  assert.equal(grade({ prompt: 'summarize', sizeUnits: 1000 }).grade, 4); // boundary: >=1000 -> grade 4 (matches maxLines>=1000)
  // a hard/sensitive keyword still overrides size for text too:
  assert.equal(grade({ prompt: 'proofread this legal contract', sizeUnits: 80, config: { hotKeywords: ['legal contract'] } }).grade, 4);
});

test('crypto/timing keyword forces grade 5 by description, no files (the constantTimeEqual dogfood gap)', () => {
  // pre-fix: none of these matched HOT5 ('cryptograph'/'encrypt' miss them), so the
  // floor graded them trivial and a weak main delegated hand-rolled crypto DOWN.
  assert.equal(grade({ prompt: 'implement constantTimeEqual timing-attack-safe + test' }).grade, 5);
  assert.equal(grade({ prompt: 'a constant-time comparison for tokens' }).grade, 5);
  assert.equal(grade({ prompt: 'small crypto helper, ~10 lines' }).grade, 5);
});
