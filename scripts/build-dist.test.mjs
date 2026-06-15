// Hermetic tests for the plugin/ dist builder + gate. Operate on a temp distRoot so the
// real plugin/ is never touched; the source (repo) is read-only. node:test, zero-dep.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDist, checkDist } from './build-dist.mjs';

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
