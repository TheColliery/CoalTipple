// Zero-dep tests for the conductor shared-region sync machinery (build-plugin).
// Guards the DRY fix: if spliceRegion or genHotKeywords regresses, the conductor
// could silently drift from keywords.mjs again. node:test only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spliceRegion, genHotKeywords } from './build-plugin.mjs';

const OPEN = '// <x>';
const CLOSE = '// </x>';
const doc = `head\n${OPEN}\nOLD\n${CLOSE}\ntail\n`;

test('spliceRegion replaces only the body, keeping marker lines + surroundings', () => {
  assert.equal(spliceRegion(doc, OPEN, CLOSE, 'NEW1\nNEW2'), `head\n${OPEN}\nNEW1\nNEW2\n${CLOSE}\ntail\n`);
});

test('spliceRegion is idempotent — re-splicing the same body is a no-op', () => {
  const once = spliceRegion(doc, OPEN, CLOSE, 'NEW');
  assert.equal(once, spliceRegion(once, OPEN, CLOSE, 'NEW'));
});

test('spliceRegion fails LOUD when a marker is missing', () => {
  assert.throws(() => spliceRegion('no markers here', OPEN, CLOSE, 'X'), /markers not found/);
});

test('spliceRegion fails LOUD when markers are out of order', () => {
  assert.throws(() => spliceRegion(`${CLOSE}\nx\n${OPEN}`, OPEN, CLOSE, 'X'), /out of order/);
});

test('genHotKeywords emits HOT5/HOT4 const decls sourced from keywords.mjs', async () => {
  const body = await genHotKeywords();
  assert.match(body, /^const HOT5 = \[/);
  assert.match(body, /\nconst HOT4 = \[/);
  assert.ok(body.includes("'concurrency'") && body.includes("'oauth'"), 'SSoT values present');
});
