// Card BB-533: unit tests of scripts/lib/legacy-backup.mjs, the one place the legacy-config migration retires its seed file.
// The spawn legs of configure-migrate.test.mjs drive the whole CLI through a preload; these call the function directly for the paths the CLI
// cannot reach (a null snapshot) and for the form's own promises: one rename is the only destroying call, nothing is deleted, and a git
// probe that cannot answer says "not tracked" instead of throwing. Zero-dep: node:test + node:assert, one temp folder per case, removed by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { retireSeededLegacy, trackedByGit } from './legacy-backup.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PREFIX = 'ct-29mj-lb-';
const TEXT = '{\n  "qualityBar": 70\n}\n';

function makeCase(t) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), PREFIX)));
  t.after(() => {
    const root = fs.realpathSync.native(os.tmpdir());
    const real = fs.realpathSync.native(dir);
    if (path.dirname(real) === root && path.basename(real).startsWith(PREFIX)) fs.rmSync(real, { recursive: true, force: true });
  });
  const legacy = path.join(dir, '.coaltipple.json');
  fs.writeFileSync(legacy, TEXT, 'utf8');
  const out = { logs: [], warns: [] };
  const args = { legacy, configPath: path.join(dir, 'new.json'), ceilingDir: path.dirname(dir), log: (m) => out.logs.push(m), warn: (m) => out.warns.push(m) };
  return { dir, legacy, bak: `${legacy}.bak`, out, args };
}

test('a null snapshot moves nothing, says so, and returns false', (t) => {
  const c = makeCase(t);
  assert.equal(retireSeededLegacy({ ...c.args, snapshot: null }), false);
  assert.equal(fs.readFileSync(c.legacy, 'utf8'), TEXT, 'the legacy file is untouched');
  assert.equal(fs.existsSync(c.bak), false, 'no .bak is made without a snapshot to compare with');
  assert.equal(c.out.warns.length, 1);
  assert.match(c.out.warns[0], /nothing was moved/);
  assert.equal(c.out.logs.length, 0, 'no success line');
});

test('a matching snapshot: the legacy file is moved byte for byte, one success line, true', (t) => {
  const c = makeCase(t);
  assert.equal(retireSeededLegacy({ ...c.args, snapshot: TEXT }), true);
  assert.equal(fs.existsSync(c.legacy), false);
  assert.equal(fs.readFileSync(c.bak, 'utf8'), TEXT);
  assert.equal(c.out.warns.length, 0);
  assert.match(c.out.logs[0], /no earlier backup/);
});

test('a snapshot that differs from the file: the file is still moved whole, the warning names both files, false', (t) => {
  const c = makeCase(t);
  assert.equal(retireSeededLegacy({ ...c.args, snapshot: '{ "qualityBar": 1 }' }), false);
  assert.equal(fs.readFileSync(c.bak, 'utf8'), TEXT, 'the bytes the file held are all in the backup');
  assert.ok(c.out.warns.some((m) => m.includes(c.legacy) && m.includes(c.bak) && /differs/.test(m)));
});

test('a folder at the backup name is not an earlier backup to read: the move is refused or the read-back is said, never a silent success', (t) => {
  const c = makeCase(t);
  fs.mkdirSync(c.bak);
  const ok = retireSeededLegacy({ ...c.args, snapshot: TEXT });
  assert.equal(ok, false, 'a refused move (or an unreadable backup) is not a success');
  assert.ok(c.out.warns.length >= 1, 'it says so');
  assert.equal(c.out.logs.some((m) => /Migrated the project config/.test(m)), false, 'never printed as migrated');
  assert.ok(fs.existsSync(c.legacy) || fs.existsSync(c.bak), 'whatever happened, the user\'s bytes are still on disk');
});

test('trackedByGit answers false, not an exception, outside any repository and for a missing file', (t) => {
  const c = makeCase(t);
  assert.equal(trackedByGit(c.legacy, path.dirname(c.dir)), false);
  assert.equal(trackedByGit(path.join(c.dir, 'absent.json'), path.dirname(c.dir)), false);
});

test('the module that retires the legacy file calls no delete: one rename is the only destroying call (the form of BB-533)', () => {
  const src = fs.readFileSync(path.join(HERE, 'legacy-backup.mjs'), 'utf8');
  const code = src.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const banned of ['rmSync', 'rmdirSync', 'unlinkSync', 'copyFileSync', 'cpSync', 'writeFileSync', 'truncateSync', 'ftruncateSync']) {
    assert.equal(code.includes(banned), false, `legacy-backup.mjs must not call ${banned}`);
  }
  assert.equal((code.match(/fs\.renameSync\(/g) || []).length, 1, 'exactly one rename');
});
