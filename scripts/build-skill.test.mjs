#!/usr/bin/env node
// Zero-dep unit tests for the cross-platform SKILL transform engine (build-skill.mjs).
// node:test only (scripts-quality.md section 2). Covers the three guarantees: the DRIFT
// gate, the NO-MIX residual scan, and the NO-CASCADE two-phase sentinel transform.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAdapter } from './build-skill.mjs';

test('DRIFT gate: a find missing from the CC source throws', () => {
  assert.throws(
    () => applyAdapter('hello world', { rules: [{ find: 'NOPE', replace: 'x' }] }),
    /did not hit the CC source/,
  );
});

test('DRIFT gate: min counts occurrences (present once but required twice throws)', () => {
  assert.throws(
    () => applyAdapter('one only', { rules: [{ find: 'one', replace: 'x', min: 2 }] }),
    /did not hit/,
  );
});

test('transform: applies a simple find -> replace', () => {
  const { text } = applyAdapter('the quick brown fox', { rules: [{ find: 'quick', replace: 'slow' }] });
  assert.equal(text, 'the slow brown fox');
});

test("NO-CASCADE: a replacement is never re-matched as another rule's find", () => {
  // A->B then B->C on "A B": the B inserted by rule A must stay B; only the original B becomes C.
  const { text } = applyAdapter('A B', { rules: [{ find: 'A', replace: 'B' }, { find: 'B', replace: 'C' }] });
  assert.equal(text, 'B C');
});

test('longest-find-first resolves a substring overlap', () => {
  const { text } = applyAdapter('Opus 4.8 and Opus', {
    rules: [{ find: 'Opus', replace: 'X' }, { find: 'Opus 4.8', replace: 'Y' }],
  });
  assert.equal(text, 'Y and X');
});

test('NO-MIX: a forbidden token surviving in the output is reported as residual', () => {
  const { residual } = applyAdapter('keep foo here', { forbidden: ['foo'], rules: [] });
  assert.deepEqual(residual, ['foo']);
});

test('NO-MIX: a swapped-away forbidden token leaves no residual', () => {
  const { residual } = applyAdapter('drop foo here', { forbidden: ['foo'], rules: [{ find: 'foo', replace: 'bar' }] });
  assert.deepEqual(residual, []);
});

test('TODO: an unfilled TODO replace is reported', () => {
  const { todos } = applyAdapter('swap me', { rules: [{ find: 'swap me', replace: '<<TODO: x>>' }] });
  assert.deepEqual(todos, ['swap me']);
});
