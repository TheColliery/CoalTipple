// escapeRegExp: every RegExp metacharacter, the backslash included, is matched LITERALLY after the escape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeRegExp } from './regex-escape.mjs';

const META = ['.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\'];

test('escapeRegExp: a name holding each metacharacter matches itself literally and nothing else', () => {
  for (const c of META) {
    const name = `a${c}b`;
    const re = new RegExp(`^${escapeRegExp(name)}$`);
    assert.ok(re.test(name), `${JSON.stringify(name)} must match itself`);
    // the unescaped metacharacter would also match these look-alikes; the escaped one must not
    for (const other of ['axb', 'ab', 'aab', 'a', '']) assert.ok(!re.test(other), `${JSON.stringify(name)} must not match ${JSON.stringify(other)}`);
  }
});

test('escapeRegExp: all metacharacters together, a backslash before a metacharacter, and an already-escaped-looking input are matched literally', () => {
  for (const name of [META.join(''), 'a\\.b', 'x\\\\y', '\\$', '$E', 'a\\b']) {
    assert.ok(new RegExp(`^${escapeRegExp(name)}$`).test(name), JSON.stringify(name));
  }
});

test('escapeRegExp: ordinary identifiers and hyphens pass through unchanged; non-strings are stringified', () => {
  assert.equal(escapeRegExp('fableConsent'), 'fableConsent');
  assert.equal(escapeRegExp('coaltipple-conductor'), 'coaltipple-conductor');
  assert.equal(escapeRegExp(5), '5');
});

test('escapeRegExp: the exact form grade.mjs and the conductor carry inline (one escape, three sites)', () => {
  const inline = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const s of [META.join(''), 'a.b*c', 'plain']) assert.equal(escapeRegExp(s), inline(s));
});

// 15b item 5 (c) / T-C row 13: the test above compares the OUTPUT of a copy written in the test, so drift at either inline site would not turn it red.
// These legs read the SOURCE of the two inline sites and require the canonical .replace(...) call of regex-escape.mjs, text for text.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(HERE, rel), 'utf8');
const CANON_CALL = read('regex-escape.mjs').match(/\.replace\([^\n]*\)(?=;)/)[0];
const carriesCanon = (src) => src.includes(CANON_CALL);

test('escapeRegExp: the canonical call is read from regex-escape.mjs (a sanity check that the extraction found a real RegExp call)', () => {
  assert.match(CANON_CALL, /^\.replace\(\/\[/);
  assert.ok(CANON_CALL.endsWith("'\\\\$&')"), CANON_CALL);
});

for (const rel of ['grade.mjs', '../../hooks/coaltipple-conductor.js']) {
  test(`escapeRegExp: ${rel} carries the canonical escape call inline, so drift at that site turns this red`, () => {
    assert.ok(carriesCanon(read(rel)), `${rel} no longer carries ${CANON_CALL}`);
  });
}

test('escapeRegExp: a drifted copy of either inline site is detected (planted in memory, never in the tree)', () => {
  for (const rel of ['grade.mjs', '../../hooks/coaltipple-conductor.js']) {
    const src = read(rel);
    assert.ok(src.includes(CANON_CALL), `${rel}: precondition`);
    const dropsBackslash = src.split(CANON_CALL).join(CANON_CALL.replace('\\]', ']')); // the class loses its escaped bracket
    const dropsDollar = src.split(CANON_CALL).join(CANON_CALL.replace("'\\\\$&'", "'\\\\&'")); // the replacement loses its $
    assert.ok(!carriesCanon(dropsBackslash), `${rel}: a dropped bracket escape must be detected`);
    assert.ok(!carriesCanon(dropsDollar), `${rel}: a dropped $ in the replacement must be detected`);
  }
});
