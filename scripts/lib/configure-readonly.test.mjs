// Card BB-533 follow-up, T-29mj-2 (the 0444 refusal, ruled once for the flock): every writer of a user's config in this room refuses a target that exists, is a
// file, and has no write bit (mode & 0o222 === 0). It prints one sentence naming the file ("FAIL <file>: read-only; nothing was written -- <advice>"), writes nothing
// (no new home, no temp file, no backup) and exits 1. POSIX otherwise REPLACES such a file (a rename over it ignores the file's own mode), and the user's choice to
// protect it is lost. The check runs BEFORE the first write, so a refusal never follows a partial write: the migration's .bak path is checked before the new home.
// An lstat that fails with anything but ENOENT is said as "could not be inspected (<code>)", with file advice.
// The tests assert on the MODE, never on EACCES (root ignores the bit). On Windows a read-only attribute reads as mode 0o444, and the same sentence is asserted.
// Zero-dep: node:test + node:assert; one temp folder per case under the OS temp root, removed by name after the case restores write access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sandboxEnv, namesPath } from './test-env.mjs';
import { writeConfigAtomic } from './config-load.mjs';
import { writeRankingAtomic } from './classify.mjs';
import { retireSeededLegacy } from './legacy-backup.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOM = path.resolve(HERE, '..', '..');
const CONFIGURE = path.join(ROOM, 'scripts', 'configure.mjs');
const INSTALL = path.join(ROOM, 'scripts', 'install.mjs');
const PREFIX = 'ct-29mr-ro-';
const SENTENCE = /read-only; nothing was written/;

function makeCase(t) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), PREFIX)));
  const writable = [];
  t.after(() => {
    for (const f of writable) { try { fs.chmodSync(f, 0o666); } catch { /* gone already */ } }
    const root = fs.realpathSync.native(os.tmpdir());
    const real = fs.realpathSync.native(dir);
    if (path.dirname(real) === root && path.basename(real).startsWith(PREFIX)) fs.rmSync(real, { recursive: true, force: true });
  });
  const proj = path.join(dir, 'proj');
  const home = path.join(dir, 'home');
  fs.mkdirSync(path.join(proj, '.git'), { recursive: true }); // findGitRoot anchor
  fs.mkdirSync(home, { recursive: true });
  const put = (file, text, mode) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, 'utf8');
    fs.chmodSync(file, mode);
    if (mode === 0o444) writable.push(file);
  };
  return { dir, proj, home, put };
}

const run = (script, c, args) => spawnSync(process.execPath, [script, ...args], { cwd: c.proj, env: sandboxEnv(c.home), encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL' });
const out = (r) => `${r.stdout}\n${r.stderr}`;
const noWriteBit = (file) => (fs.lstatSync(file).mode & 0o222) === 0;
const litter = (dir) => fs.readdirSync(dir).filter((n) => n.includes('.tmp') || n.endsWith('.bak'));

function assertRefused(r, file, before, why) {
  assert.equal(r.error, undefined, `spawn failed: ${r.error && r.error.code}`);
  assert.equal(r.status, 1, `${why}: exit ${r.status}; stdout: ${r.stdout.trim()}; stderr: ${r.stderr.trim()}`);
  assert.match(out(r), SENTENCE, `${why}: the sentence must say the file is read-only and nothing was written; got:\n${out(r).trim()}`);
  assert.ok(namesPath(out(r), file), `${why}: the sentence must name ${file}; got:\n${out(r).trim()}`);
  assert.equal(fs.readFileSync(file, 'utf8'), before, `${why}: the read-only file's bytes must be unchanged`);
  assert.equal(noWriteBit(file), true, `${why}: the file's mode must still have no write bit`);
}

const PROJECT_CONFIG = (proj) => path.join(proj, '.claude', 'coal', 'coaltipple.json');

test('configure --project refuses a project config with no write bit: bytes and mode unchanged, no temp, the sentence, exit 1', (t) => {
  const c = makeCase(t);
  const target = PROJECT_CONFIG(c.proj);
  const before = '{\n  "qualityBar": 42\n}\n';
  c.put(target, before, 0o444);
  const r = run(CONFIGURE, c, ['--project', '--qualityBar', '85']);
  assertRefused(r, target, before, 'project config');
  assert.deepEqual(litter(path.dirname(target)), [], 'no temp file is left beside the refused config');
});

test('configure (global) refuses a global config with no write bit: bytes and mode unchanged, no temp, the sentence, exit 1', (t) => {
  const c = makeCase(t);
  const target = path.join(c.home, '.claude', '.coaltipple.json');
  const before = '{\n  "qualityBar": 42\n}\n';
  c.put(target, before, 0o444);
  const r = run(CONFIGURE, c, ['--qualityBar', '85']);
  assertRefused(r, target, before, 'global config');
  assert.deepEqual(litter(path.dirname(target)), []);
});

test('the migration refuses a read-only .bak path BEFORE it writes anything: no new home, the legacy file and the backup unchanged, the sentence, exit 1', (t) => {
  const c = makeCase(t);
  const legacy = path.join(c.proj, '.claude', '.coaltipple.json');
  const bak = `${legacy}.bak`;
  const legacyText = '{\n  "mode": "off",\n  "qualityBar": 90\n}\n';
  const bakText = '{"an":"earlier backup"}\n';
  c.put(legacy, legacyText, 0o644);
  c.put(bak, bakText, 0o444);
  const r = run(CONFIGURE, c, ['--project', '--qualityBar', '85']);
  assertRefused(r, bak, bakText, 'read-only backup path');
  assert.equal(fs.existsSync(PROJECT_CONFIG(c.proj)), false, 'a refusal never follows a partial write: the new home must not exist');
  assert.equal(fs.readFileSync(legacy, 'utf8'), legacyText, 'the legacy file stays where it was, byte for byte');
  assert.equal(fs.existsSync(path.dirname(PROJECT_CONFIG(c.proj))), false, 'not even the new home\'s folder was made');
  assert.deepEqual(fs.readdirSync(path.dirname(legacy)).filter((n) => n.includes('.tmp')), [], 'no temp file beside the legacy file');
});

test('install --reset refuses a read-only project config: bytes and mode unchanged, the sentence, exit 1', (t) => {
  const c = makeCase(t);
  const target = PROJECT_CONFIG(c.proj);
  const before = '{ "qualityBar": 42, "userOnly": "KEEP-ME" }';
  c.put(target, before, 0o444);
  const r = run(INSTALL, c, ['--reset']);
  assertRefused(r, target, before, 'install --reset');
});

test('writeConfigAtomic refuses a target with no write bit and leaves no temp file; a writable target is still replaced', (t) => {
  const c = makeCase(t);
  const target = path.join(c.dir, 'cfg.json');
  c.put(target, 'KEEP\n', 0o444);
  assert.throws(() => writeConfigAtomic(target, 'NEW\n'), (e) => e.code === 'EREADONLY' && SENTENCE.test(e.message) && e.message.includes(target));
  assert.equal(fs.readFileSync(target, 'utf8'), 'KEEP\n');
  assert.equal(noWriteBit(target), true);
  assert.deepEqual(fs.readdirSync(c.dir).filter((n) => n.includes('.tmp')), [], 'the check runs before any temp file exists');
  const open = path.join(c.dir, 'open.json');
  c.put(open, 'OLD\n', 0o644);
  writeConfigAtomic(open, 'NEW\n');
  assert.equal(fs.readFileSync(open, 'utf8'), 'NEW\n', 'a writable config is replaced as before');
});

test('an lstat that fails with anything but ENOENT is said as could-not-be-inspected with file advice, and nothing is written', (t) => {
  const c = makeCase(t);
  // 29mr redfix: the target sits under a folder named "folders" on EVERY platform, as macOS's temp root (/private/var/folders/...) does, so the advice check below
  // is exercised with that word inside the path everywhere, not only on the one runner where the temp root happens to carry it.
  const target = path.join(c.dir, 'folders', 'cfg.json');
  c.put(target, 'KEEP\n', 0o644);
  const real = fs.lstatSync;
  fs.lstatSync = function lstatSyncStub(p, ...rest) {
    if (path.resolve(String(p)) === target) { const e = new Error(`EIO: i/o error, lstat '${target}'`); e.code = 'EIO'; throw e; }
    return real.call(fs, p, ...rest);
  };
  try {
    // the advice is judged WITHOUT the path: a path may contain the word (macOS: /private/var/folders/...), and the check is about the advice text
    assert.throws(() => writeConfigAtomic(target, 'NEW\n'), (e) => e.code === 'EINSPECT' && /could not be inspected \(EIO\)/.test(e.message) && e.message.includes(target) && /nothing was written/.test(e.message) && !/folder/i.test(e.message.split(target).join('')));
  } finally { fs.lstatSync = real; }
  assert.equal(fs.readFileSync(target, 'utf8'), 'KEEP\n');
  assert.deepEqual(fs.readdirSync(path.dirname(target)).filter((n) => n.includes('.tmp')), []);
});

test('an absent target is not refused: ENOENT means nothing to protect, and the config is created', (t) => {
  const c = makeCase(t);
  const target = path.join(c.dir, 'new.json');
  writeConfigAtomic(target, 'NEW\n');
  assert.equal(fs.readFileSync(target, 'utf8'), 'NEW\n');
});

test('writeRankingAtomic refuses a ranking file with no write bit: bytes and mode unchanged, no temp, the sentence', (t) => {
  const c = makeCase(t);
  const stateDir = path.join(c.dir, 'state');
  const rankingFile = path.join(stateDir, 'ranking.json');
  c.put(rankingFile, '{"keep":true}\n', 0o444);
  assert.throws(() => writeRankingAtomic(stateDir, { ranking: 'new' }), (e) => e.code === 'EREADONLY' && SENTENCE.test(e.message) && e.message.includes(rankingFile));
  assert.equal(fs.readFileSync(rankingFile, 'utf8'), '{"keep":true}\n');
  assert.equal(noWriteBit(rankingFile), true);
  assert.deepEqual(fs.readdirSync(stateDir).filter((n) => n.includes('.tmp')), []);
});

test('retireSeededLegacy refuses a .bak that has no write bit (made read-only after the run\'s first check): nothing is moved, the legacy file stays, false', (t) => {
  const c = makeCase(t);
  const legacy = path.join(c.dir, '.coaltipple.json');
  const bak = `${legacy}.bak`;
  c.put(legacy, '{ "qualityBar": 70 }\n', 0o644);
  c.put(bak, 'EARLIER\n', 0o444);
  const warns = [];
  const ok = retireSeededLegacy({ legacy, snapshot: '{ "qualityBar": 70 }\n', configPath: path.join(c.dir, 'new.json'), ceilingDir: path.dirname(c.dir), log: () => {}, warn: (m) => warns.push(m) });
  assert.equal(ok, false);
  assert.equal(fs.readFileSync(legacy, 'utf8'), '{ "qualityBar": 70 }\n', 'the legacy file was not moved');
  assert.equal(fs.readFileSync(bak, 'utf8'), 'EARLIER\n', 'the earlier backup was not replaced');
  assert.equal(noWriteBit(bak), true);
  assert.ok(warns.some((m) => SENTENCE.test(m) && m.includes(bak)), `the refusal names the backup; got:\n${warns.join('\n')}`);
});
