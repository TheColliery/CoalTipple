// Hermetic tests for the plugin/ dist builder + gate. Operate on a temp distRoot so the
// real plugin/ is never touched; the source (repo) is read-only. node:test, zero-dep.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDist, checkDist, DIST_ITEMS } from './build-dist.mjs';

const withTempDist = (fn) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-dist-'));
  try { return fn(tmp); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
};

test('buildDist emits ONLY the four plugin items, and checkDist finds them in sync', () => {
  withTempDist((tmp) => {
    buildDist(tmp);
    assert.deepEqual(fs.readdirSync(tmp).sort(), ['.claude-plugin', 'commands', 'hooks', 'skills']);
    assert.deepEqual(checkDist(tmp), []);
  });
});

test('checkDist catches a STALE dist file (source edited, dist not rebuilt)', () => {
  withTempDist((tmp) => {
    buildDist(tmp);
    fs.appendFileSync(path.join(tmp, 'skills', 'coaltipple', 'SKILL.md'), '\nDRIFT');
    assert.ok(checkDist(tmp).some((d) => d.startsWith('stale')), 'expected a stale finding');
  });
});

test('checkDist catches a MISSING dist file', () => {
  withTempDist((tmp) => {
    buildDist(tmp);
    fs.rmSync(path.join(tmp, 'commands', 'stats.md'));
    assert.ok(checkDist(tmp).some((d) => d.startsWith('missing')), 'expected a missing finding');
  });
});

test('checkDist catches a TOP-LEVEL stray with no DIST_ITEM (the cruft guard)', () => {
  withTempDist((tmp) => {
    buildDist(tmp);
    fs.mkdirSync(path.join(tmp, 'scripts'));
    fs.writeFileSync(path.join(tmp, 'scripts', 'leak.mjs'), '// must not ship');
    assert.ok(checkDist(tmp).some((d) => d.includes('orphan top-level')), 'expected a top-level orphan finding');
  });
});

// board #59: a dist copy that differs from source ONLY by CRLF-vs-LF line
// endings (board #47's `.gitattributes` conform lets two checkouts of ONE
// commit differ this way for byte-identical content) must NOT read as stale.
test('a dist copy differing from source only by CRLF-vs-LF on a TEXT_EXTS file reads as in sync', () => {
  withTempDist((tmp) => {
    buildDist(tmp);
    const rel = path.join('skills', 'coaltipple', 'SKILL.md');
    const srcBytes = fs.readFileSync(path.join(tmp, rel));
    const srcText = srcBytes.toString('latin1');
    // Flip relative to whatever this checkout's actual line ending is — do
    // not assume a direction, this must pass whether the box is CRLF or LF.
    const flippedText = srcBytes.includes(Buffer.from('\r\n'))
      ? srcText.replace(/\r\n/g, '\n')
      : srcText.replace(/\n/g, '\r\n');
    const flipped = Buffer.from(flippedText, 'latin1');
    assert.notDeepEqual(flipped, srcBytes, 'fixture setup: the flip must actually change the bytes');
    fs.writeFileSync(path.join(tmp, rel), flipped);
    const drift = checkDist(tmp);
    assert.ok(!drift.some((d) => d.includes(rel)), `expected no stale entry for ${rel}, got: ${JSON.stringify(drift)}`);
  });
});

// board #59: a REAL content edit made under CRLF line endings must still
// fail loud. INSERTION-shaped deliberately (a token the original does not
// have, on its own new line) — a delete/replace-shaped fixture can pass a
// sabotaged length-only or removal-only predicate; an insertion is the
// shape that actually catches a broken equality check.
test('a real content INSERTION under CRLF line endings still fails loud (stale, not silently accepted)', () => {
  withTempDist((tmp) => {
    buildDist(tmp);
    const rel = path.join('skills', 'coaltipple', 'SKILL.md');
    const srcBytes = fs.readFileSync(path.join(tmp, rel));
    const eol = srcBytes.includes(Buffer.from('\r\n')) ? '\r\n' : '\n';
    const withInsertion = Buffer.from(srcBytes.toString('latin1') + `BOARD-59-CANARY-INSERTION${eol}`, 'latin1');
    fs.writeFileSync(path.join(tmp, rel), withInsertion);
    const drift = checkDist(tmp);
    assert.ok(drift.some((d) => d.startsWith('stale') && d.includes(rel)), `expected a stale entry for ${rel}, got: ${JSON.stringify(drift)}`);
  });
});

// 29a: a directory link (a symlink, or a junction on Windows) under a DIST_ITEM is a failure line and is never descended. checkDist used to
// follow it with statSync, so a link that points back up the tree was walked until the path ran out. One skippable leg per test: the probe
// below decides at run time whether this machine can make a directory link at all.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function tryDirLink(target, linkPath) {
  try { fs.symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir'); return null; } catch (e) { return e.code || e.message; }
}
function copyDistItems(toRoot) {
  for (const item of DIST_ITEMS) {
    fs.mkdirSync(path.dirname(path.join(toRoot, item)), { recursive: true });
    fs.cpSync(path.join(repoRoot, item), path.join(toRoot, item), { recursive: true });
  }
}

test('checkDist names a directory link under a DIST_ITEM on the dist side and does not descend into it (29a)', (t) => {
  withTempDist((tmp) => {
    buildDist(tmp);
    const why = tryDirLink(path.join(tmp, 'skills'), path.join(tmp, 'skills', 'loop'));
    if (why) { t.skip('cannot create a directory link here (' + why + ')'); return; }
    const out = checkDist(tmp);
    assert.ok(out.includes('link in plugin/: ' + path.join('skills', 'loop')), JSON.stringify(out));
    assert.ok(out.every((d) => !d.includes(path.join('loop', 'loop'))), 'the link was not descended: ' + JSON.stringify(out));
  });
});

test('checkDist names a directory link under a DIST_ITEM on the source side and does not descend into it (29a)', (t) => {
  withTempDist((tmp) => {
    const src = path.join(tmp, 'src');
    const dst = path.join(tmp, 'dst');
    copyDistItems(src);
    copyDistItems(dst);
    const why = tryDirLink(path.join(src, 'hooks'), path.join(src, 'hooks', 'loop'));
    if (why) { t.skip('cannot create a directory link here (' + why + ')'); return; }
    const out = checkDist(dst, src);
    assert.ok(out.includes('link in plugin source: ' + path.join('hooks', 'loop')), JSON.stringify(out));
    assert.ok(out.every((d) => !d.includes(path.join('loop', 'loop'))), 'the link was not descended: ' + JSON.stringify(out));
  });
});

test('checkDist given a separate source root still finds a clean copy in sync and a stale file stale (29a)', () => {
  withTempDist((tmp) => {
    const src = path.join(tmp, 'src');
    const dst = path.join(tmp, 'dst');
    copyDistItems(src);
    copyDistItems(dst);
    assert.deepEqual(checkDist(dst, src), []);
    fs.appendFileSync(path.join(dst, 'hooks', 'coaltipple-conductor.js'), '\n// drift');
    assert.deepEqual(checkDist(dst, src), ['stale in plugin/: ' + path.join('hooks', 'coaltipple-conductor.js')]);
  });
});
