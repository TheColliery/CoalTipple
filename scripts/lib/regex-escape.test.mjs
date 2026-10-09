// escapeRegExp: every RegExp metacharacter, the backslash included, is matched LITERALLY after the escape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
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
