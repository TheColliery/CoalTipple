// Link extraction stays linear on unclosed brackets. The label part of LINK_RE could run across
// further `[` openers, so each unclosed `[` on a line scanned to the end of that line and a long
// run of them cost time roughly quadratic in its length. The label now stops at the next `[`, so an
// unclosed opener fails at once. An ordinary link, and a link that follows an unclosed bracket,
// parse as before. Zero-dep (node:test + built-ins), scripts-quality.md section 2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractLinkTargets } from './link-check.mjs';

const SIZE = 48 * 1024;
const BUDGET_MS = 50;

test('extractLinkTargets is linear: a 48 KB line of unclosed brackets scans in under 50 ms (best of 3 runs)', () => {
  const input = '['.repeat(SIZE);
  const times = [];
  for (let i = 0; i < 3; i++) {
    const t0 = process.hrtime.bigint();
    extractLinkTargets(input);
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  assert.ok(Math.min(...times) < BUDGET_MS, `best of 3 = ${Math.min(...times).toFixed(1)} ms, budget ${BUDGET_MS} ms`);
});

test('extractLinkTargets still finds an ordinary link, an image, and a link after an unclosed bracket', () => {
  assert.deepEqual(extractLinkTargets('see [docs](./a.md) and ![logo](./img/b.png) and [x [y](./c.md) tail'), ['./a.md', './img/b.png', './c.md']);
  assert.deepEqual(extractLinkTargets('[unclosed\n\nlater [y](./d.md)'), ['./d.md']);
  assert.deepEqual(extractLinkTargets('[![badge](./badge.svg)](./home.md)'), ['./badge.svg']);
});
