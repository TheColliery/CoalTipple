// The room's census PINS (09a): the canon census (git-env-census.mjs, adopted by blob id) ships no pin, so the rows this room keeps live in git-env-pins.mjs
// and are held here against the REAL tree. A row is live while its file exists with the pinned blob; a stale row fails here, never silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanGitSpawns, collectScriptsMjs, gitBlobId } from './git-env-census.mjs';
import { CENSUS_PINS } from './git-env-pins.mjs';

const ROOM = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('every pin row is LIVE (its file exists with the pinned blob) and names how it ends: a stale row fails here, never silently', () => {
  assert.ok(Array.isArray(CENSUS_PINS) && CENSUS_PINS.length > 0);
  for (const row of CENSUS_PINS) {
    const abs = path.join(ROOM, ...row.rel.split('/'));
    assert.ok(fs.existsSync(abs), row.rel + ': pinned file is gone -- delete the row');
    assert.equal(gitBlobId(fs.readFileSync(abs, 'utf8')), row.blob, row.rel + ': the bytes changed -- re-copy from the source or delete the row (a row never follows an edit)');
    assert.match(row.why, /(DELETE when (the canon fix lands|the census rule accepts)|KEEP while )/);
  }
});

test('the real tree passes with exactly the pinned files exempt, every pin hides a real finding, and no other file needs one', () => {
  const files = collectScriptsMjs(ROOM);
  const withPins = scanGitSpawns(files, CENSUS_PINS);
  assert.deepEqual(withPins.findings, [], 'a finding outside the pinned files');
  assert.equal(withPins.exempted, CENSUS_PINS.length, 'every pin exempted its file');
  const bare = scanGitSpawns(files, []);
  const inside = new Set(bare.findings.map((f) => f.slice(0, f.indexOf(':'))));
  const pinned = new Set(CENSUS_PINS.map((row) => row.rel));
  for (const rel of inside) assert.ok(pinned.has(rel), rel + ': a finding with no pin');
  for (const rel of pinned) assert.ok(inside.has(rel), rel + ' is pinned but the census finds nothing in it: delete the row');
});

test('no pin names a file the canon already passes: the rewritten secret-gate and secret-scan tests and the canon release scripts carry none', () => {
  for (const rel of ['scripts/secret-gate.test.mjs', 'scripts/secret-scan.test.mjs', 'scripts/release-notes.mjs', 'scripts/release-notes.test.mjs', 'scripts/verify-release-shape.mjs']) {
    assert.ok(!CENSUS_PINS.some((row) => row.rel === rel), rel + ': no pin');
  }
});

test('a pin dies with the first edited byte of its file: the census runs again on the edited text', () => {
  const dirty = "import { spawnSync } from 'node:child_process';\nspawnSync('git', ['status'], { env: process.env });\n";
  const pin = { rel: 'scripts/x.mjs', blob: gitBlobId(dirty), why: 'KEEP while this test says so' };
  assert.deepEqual(scanGitSpawns([{ rel: pin.rel, text: dirty }], [pin]).findings, []);
  assert.ok(scanGitSpawns([{ rel: pin.rel, text: dirty + '// edited\n' }], [pin]).findings.length >= 1);
});
