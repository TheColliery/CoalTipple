// Zero-dep tests for config validation (config-schema.mjs). Run: node --test config-schema.test.mjs
// Locks the config guardrails — a config key is a double-edged sword, so its
// range/type must be enforced, not just documented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG_SCHEMA, validateValue } from './config-schema.mjs';

const specOf = (key) => CONFIG_SCHEMA.find((s) => s.key === key);

test('maxTotalAttempts is hard-capped 1-5 (the staircase double-edge guardrail)', () => {
  const spec = specOf('maxTotalAttempts');
  assert.ok(spec, 'maxTotalAttempts spec exists');
  assert.equal(validateValue(spec, 2), null);     // factory default
  assert.equal(validateValue(spec, 1), null);     // floor (jump-fast, but valid)
  assert.equal(validateValue(spec, 5), null);     // ceiling (full climb + slack)
  assert.match(validateValue(spec, 0), />= 1/);   // too few -> routing dead, rejected
  assert.match(validateValue(spec, 6), /<= 5/);   // too many -> death-by-a-thousand-cuts, rejected
});

test("int fields reject non-integers (an int must be an int)", () => {
  const spec = specOf('maxTotalAttempts');
  assert.match(validateValue(spec, 2.5), /integer/);
  assert.match(validateValue(spec, NaN), /finite/);
  assert.match(validateValue(spec, 'two'), /finite|number/);
});

test('qualityBar range 0-100 (the climb trigger)', () => {
  const spec = specOf('qualityBar');
  assert.equal(validateValue(spec, 60), null);
  assert.match(validateValue(spec, -1), />= 0/);
  assert.match(validateValue(spec, 101), /<= 100/);
});

test('enum / bool / strArr specs validate (sanity across the schema)', () => {
  assert.equal(validateValue(specOf('mode'), 'auto'), null);
  assert.match(validateValue(specOf('mode'), 'nonsense'), /one of/);
  assert.equal(validateValue(specOf('enableRouting'), true), null);
  assert.match(validateValue(specOf('enableRouting'), 'yes'), /boolean/);
  assert.equal(validateValue(specOf('hotKeywords'), ['x']), null);
  assert.match(validateValue(specOf('hotKeywords'), 'x'), /array/);
});

test('every schema spec has a key + a type (no malformed entry)', () => {
  for (const spec of CONFIG_SCHEMA) {
    assert.ok(spec.key && spec.type, `malformed spec: ${JSON.stringify(spec)}`);
  }
});

test('rankingMode enum + swept int ranges are enforced', () => {
  assert.equal(validateValue(specOf('rankingMode'), 'auto'), null);
  assert.equal(validateValue(specOf('rankingMode'), 'manual'), null);
  assert.match(validateValue(specOf('rankingMode'), 'robot'), /one of/);
  // the guardrail sweep — each swept int rejects its degenerate values
  assert.match(validateValue(specOf('rankingRefreshDays'), 0), />= 1/);   // 0 = per-session enumerate = token burn
  assert.equal(validateValue(specOf('rankingRefreshDays'), 30), null);
  assert.match(validateValue(specOf('maxConcurrentSubagents'), 0), />= 1/);
  assert.match(validateValue(specOf('maxConcurrentSubagents'), 17), /<= 16/);
  assert.match(validateValue(specOf('subagentTimeoutSeconds'), 4), />= 5/);
  assert.match(validateValue(specOf('delegateMinLines'), 0), />= 1/);
  assert.match(validateValue(specOf('delegateMinLines'), 100001), /<= 100000/);
});

test('memory-anchor keys validate (contextFiles strArr + memoryOffer enum)', () => {
  assert.equal(validateValue(specOf('contextFiles'), ['MEMORY.md', 'docs/conventions.md']), null);
  assert.match(validateValue(specOf('contextFiles'), 'MEMORY.md'), /array/);   // a bare string, not an array
  assert.equal(validateValue(specOf('memoryOffer'), 'auto'), null);
  assert.equal(validateValue(specOf('memoryOffer'), 'off'), null);
  assert.match(validateValue(specOf('memoryOffer'), 'maybe'), /one of/);
});

test('keywords groups are deep-validated (a bad group fails loud, not a silent bad grade)', () => {
  const spec = specOf('keywords');
  assert.ok(spec, 'keywords spec exists');
  assert.equal(validateValue(spec, {}), null);                                                            // empty = use the built-in groups
  assert.equal(validateValue(spec, { 'crypto': { grade: 5, sensitive: true, words: ['nonce'] } }), null); // a valid override
  assert.match(validateValue(spec, 'nope'), /must be an object/);                                         // not an object
  assert.match(validateValue(spec, { x: { grade: 9, words: ['a'] } }), /grade must be an integer 1-5/);   // out-of-range grade (the undefined-tier boundary)
  assert.match(validateValue(spec, { x: { grade: 3, words: 'a' } }), /words must be an array/);            // words not an array
  assert.match(validateValue(spec, { x: { words: ['a'], sensitive: 'yes' } }), /sensitive must be a boolean/); // bad flag type
});
