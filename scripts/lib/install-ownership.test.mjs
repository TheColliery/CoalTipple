// The installer writes or removes a skill folder only on proof. The proof is the install record (lib/install-record.mjs), keyed by the
// target's real path: a folder the record names is ours when its files are exactly the recorded files with the recorded hashes. A
// target with no record entry adopts a folder whose files are byte-equal to the shipped source, but only to INSTALL over it; a DELETE
// never adopts. Everything else is kept: never removed or overwritten, one [kept] line says why, exit 1. A record written by a newer
// schema is never rewritten. Zero-dep (node:test + built-ins), scripts-quality.md section 2; testing.md Determinism: no clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sandboxEnv } from './test-env.mjs';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INSTALL = path.join(REPO, 'scripts', 'install.mjs');
const SKILL_SRC = path.join(REPO, 'skills', 'coaltipple');

// One throwaway root per test: home, a cwd (the project the installer seeds) and the skill target folders all live under it.
function sandbox(t) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ownership-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const cwd = path.join(root, 'project');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(cwd, '.git'), { recursive: true });
  return { root, home, cwd };
}
const run = (sb, ...a) => spawnSync(process.execPath, ['--max-old-space-size=512', INSTALL, ...a],
  { cwd: sb.cwd, env: sandboxEnv(sb.home), encoding: 'utf8', timeout: 60000 });
const recordPath = (sb) => path.join(sb.home, '.claude', 'coal', 'coaltipple', 'install-record.json');
const readRecord = (sb) => JSON.parse(fs.readFileSync(recordPath(sb), 'utf8'));
const realDest = (dest) => fs.realpathSync.native(dest);

// The sha256 of every file under `dir`, keyed by its path inside `dir` with forward slashes.
function hashFolder(dir) {
  const out = {};
  const walk = (abs, rel) => {
    // The kind comes from the directory listing, not from a stat of the path just before the read (a check-then-use race shape).
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const child = path.join(abs, e.name);
      const key = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) walk(child, key);
      else out[key] = createHash('sha256').update(fs.readFileSync(child)).digest('hex');
    }
  };
  walk(dir, '');
  return out;
}
// A fresh copy of the shipped skill folder at `to`, the bytes an installer would write.
function copyShipped(to) {
  fs.cpSync(SKILL_SRC, to, { recursive: true });
  return to;
}
// Flip one byte of one file, so the folder's bytes are no longer the shipped ones.
function changeOneByte(folder) {
  const f = path.join(folder, 'SKILL.md');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8') + '\n<!-- edited -->\n', 'utf8');
  return f;
}

test('1. record present: a first install writes a record that names coaltipple with the files hashes; a second install exits 0 and the hashes still match', (t) => {
  const sb = sandbox(t);
  const dest = path.join(sb.root, 'skills');
  const first = run(sb, dest);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const entry = readRecord(sb).targets[realDest(dest)];
  assert.ok(entry, 'the record has an entry for this target');
  assert.deepEqual(entry.skills.coaltipple, hashFolder(path.join(dest, 'coaltipple')), 'the recorded hashes are the folder files hashes');
  const second = run(sb, dest);
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.deepEqual(readRecord(sb).targets[realDest(dest)].skills.coaltipple, hashFolder(path.join(dest, 'coaltipple')));
});

test('2. no record, byte match: a byte-equal folder with no entry is adopted (install exits 0) and the record gains the entry', (t) => {
  const sb = sandbox(t);
  const ref = path.join(sb.root, 'ref');
  assert.equal(run(sb, ref).status, 0); // writes a record for ref, so the record file exists
  const dest = path.join(sb.root, 'skills');
  fs.mkdirSync(dest, { recursive: true });
  copyShipped(path.join(dest, 'coaltipple'));
  const r = run(sb, dest);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(readRecord(sb).targets[realDest(dest)], 'the adopted folder is recorded');
});

test('3. no record, one byte changed: kept, exit 1, bytes unchanged, one [kept] line names the folder and the remedy', (t) => {
  const sb = sandbox(t);
  const ref = path.join(sb.root, 'ref');
  assert.equal(run(sb, ref).status, 0);
  const dest = path.join(sb.root, 'skills');
  fs.mkdirSync(dest, { recursive: true });
  const folder = copyShipped(path.join(dest, 'coaltipple'));
  const edited = changeOneByte(folder);
  const before = fs.readFileSync(edited);
  const r = run(sb, dest);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(fs.readFileSync(edited).equals(before), 'the edited bytes are unchanged');
  const kept = r.stderr.split('\n').filter((l) => l.includes('[kept]'));
  assert.equal(kept.length, 1, r.stderr);
  assert.ok(kept[0].includes(path.join(dest, 'coaltipple')), kept[0]);
  assert.match(kept[0], /Remove the whole folder, or move the whole folder aside, then re-run/);
});

test('4. under a record, an unrecorded byte-equal folder is kept by install AND by uninstall (exit 1 each, bytes unchanged)', (t) => {
  const sb = sandbox(t);
  const ref = path.join(sb.root, 'ref');
  assert.equal(run(sb, ref).status, 0);
  const dest = path.join(sb.root, 'skills');
  fs.mkdirSync(dest, { recursive: true });
  const folder = copyShipped(path.join(dest, 'coaltipple'));
  const rec = readRecord(sb);
  rec.targets[realDest(dest)] = { version: '0.0.0', skills: {} }; // an entry for this target that names no coaltipple
  fs.writeFileSync(recordPath(sb), JSON.stringify(rec, null, 2) + '\n', 'utf8');
  const before = hashFolder(folder);
  const install = run(sb, dest);
  assert.equal(install.status, 1, install.stdout + install.stderr);
  assert.deepEqual(hashFolder(folder), before, 'install left the bytes alone');
  const uninstall = run(sb, '--uninstall', dest);
  assert.equal(uninstall.status, 1, uninstall.stdout + uninstall.stderr);
  assert.deepEqual(hashFolder(folder), before, 'uninstall left the bytes alone');
});

test('5. uninstall: a recorded folder is removed and its entry dropped; a byte-equal folder with no record is kept; an empty folder with no record is removed', (t) => {
  const sb = sandbox(t);
  const recorded = path.join(sb.root, 'recorded');
  assert.equal(run(sb, recorded).status, 0);
  const u1 = run(sb, '--uninstall', recorded);
  assert.equal(u1.status, 0, u1.stdout + u1.stderr);
  assert.ok(!fs.existsSync(path.join(recorded, 'coaltipple')), 'the recorded folder is removed');
  assert.equal(readRecord(sb).targets[realDest(recorded)], undefined, 'its entry is dropped');

  const shipped = path.join(sb.root, 'shipped');
  fs.mkdirSync(shipped, { recursive: true });
  copyShipped(path.join(shipped, 'coaltipple'));
  const u2 = run(sb, '--uninstall', shipped);
  assert.equal(u2.status, 1, u2.stdout + u2.stderr);
  assert.ok(fs.existsSync(path.join(shipped, 'coaltipple', 'SKILL.md')), 'a byte-equal folder with no record is kept');

  const empty = path.join(sb.root, 'empty');
  fs.mkdirSync(path.join(empty, 'coaltipple'), { recursive: true });
  const u3 = run(sb, '--uninstall', empty);
  assert.equal(u3.status, 0, u3.stdout + u3.stderr);
  assert.ok(!fs.existsSync(path.join(empty, 'coaltipple')), 'an empty folder with no record is removed');
});

test('6. a kept folder the record names keeps its OLD hashes in the record', (t) => {
  const sb = sandbox(t);
  const dest = path.join(sb.root, 'skills');
  assert.equal(run(sb, dest).status, 0);
  const oldHashes = readRecord(sb).targets[realDest(dest)].skills.coaltipple;
  changeOneByte(path.join(dest, 'coaltipple'));
  const r = run(sb, dest);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual(readRecord(sb).targets[realDest(dest)].skills.coaltipple, oldHashes, 'the kept folder keeps the hashes it was recorded with');
});

test('8. a link at <dest>/coaltipple is kept by install and by uninstall; the link target is left alone', (t) => {
  const sb = sandbox(t);
  const ref = path.join(sb.root, 'ref');
  assert.equal(run(sb, ref).status, 0);
  const dest = path.join(sb.root, 'skills');
  fs.mkdirSync(dest, { recursive: true });
  const other = copyShipped(path.join(sb.root, 'other'));
  try { fs.symlinkSync(other, path.join(dest, 'coaltipple'), 'junction'); }
  catch (e) { t.skip(`this volume cannot make a link (${e.code || e.message})`); return; }
  const before = fs.readFileSync(path.join(other, 'SKILL.md'));
  const install = run(sb, dest);
  assert.equal(install.status, 1, install.stdout + install.stderr);
  assert.match(install.stdout + install.stderr, /it is a link or a file, not a folder CoalTipple wrote/);
  const uninstall = run(sb, '--uninstall', dest);
  assert.equal(uninstall.status, 1, uninstall.stdout + uninstall.stderr);
  assert.match(uninstall.stdout + uninstall.stderr, /it is a link or a file, not a folder CoalTipple wrote/);
  assert.ok(fs.readFileSync(path.join(other, 'SKILL.md')).equals(before), 'the link target is unchanged');
});

test('7. a record from a newer schema is left byte-identical; one line says so; the byte-match path still applies', (t) => {
  const sb = sandbox(t);
  const ref = path.join(sb.root, 'ref');
  assert.equal(run(sb, ref).status, 0);
  const newer = JSON.stringify({ stateSchema: 2, targets: {} }, null, 2) + '\n';
  fs.writeFileSync(recordPath(sb), newer, 'utf8');
  const matched = path.join(sb.root, 'matched');
  fs.mkdirSync(matched, { recursive: true });
  copyShipped(path.join(matched, 'coaltipple'));
  const r1 = run(sb, matched);
  assert.equal(r1.status, 0, r1.stdout + r1.stderr);
  assert.match(r1.stdout + r1.stderr, /the install record was written by a newer CoalTipple and was left alone/);
  assert.equal(fs.readFileSync(recordPath(sb), 'utf8'), newer, 'the newer record is byte-identical');

  const edited = path.join(sb.root, 'edited');
  fs.mkdirSync(edited, { recursive: true });
  changeOneByte(copyShipped(path.join(edited, 'coaltipple')));
  const r2 = run(sb, edited);
  assert.equal(r2.status, 1, r2.stdout + r2.stderr);
  assert.equal(fs.readFileSync(recordPath(sb), 'utf8'), newer, 'still byte-identical after the kept run');
});
