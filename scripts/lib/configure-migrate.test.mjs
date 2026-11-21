// Card BB-533 (signed by the owner 2026-11-21): the legacy-config migration in scripts/configure.mjs never destroys the user's file.
// It moves the legacy file with ONE rename to <legacy>.bak beside it, then reads the backup back and compares it with the text the
// seeding read returned (scripts/lib/legacy-backup.mjs). This file drives the REAL scripts/configure.mjs from a temp project, with a
// preload (configure-migrate-window-preload.mjs, `node --import`) that changes the legacy file, or refuses its move, at the point a
// real writer or a real held file would.
//
// History: 29kl (reviewer 3cd548da's witness) and 29ky first made the delete refuse a changed file (a re-check before the delete);
// the study of 29lg (W-c1) showed that every check-then-destroy keeps a window: bytes appended after the last look were deleted with the
// file, exit 0. These legs were rewritten to the new contract in the BB-533 step (named, not loosened): where they asserted "kept, the
// file is still at its name" they now assert "moved to .bak, every byte is in it, and the run says so".
//
// Legs:
//   W-c1 (append-last): an append lands right before the call that takes the legacy name away, after any look a migration could take.
//        The appended bytes are in the .bak, the run warns and exits 1. (RED on the check-then-delete code of 2b981df: the bytes were gone, exit 0.)
//   append / samesize: a change after the new config is written (the 29kl legs). The change is in the .bak; warn, exit 1.
//   remove (F1): another program takes the legacy file away inside the window. Nothing is at the name: the rename cannot happen, the run
//        says the file is no longer there, never "kept", no .bak, exit 1.
//   refuse (W-b2): the move is refused (EBUSY). The legacy file stays, byte for byte, no .bak, exit 1, one line, no retry; the three states
//        of the name afterwards (kept, gone, unchecked) are each reported as what an lstat showed.
//   descriptor (W-b1): a writer holds the legacy file open across the move and writes after it. The bytes are in the .bak; warn, exit 1.
//   bak-oversize: the backup cannot be read back (it grew past the config size bound). Said, exit 1.
//   an earlier .bak is replaced, and the line says so; with none, the line says there was none.
//   a git-tracked legacy file: the line tells the user to commit its removal (skipped with no git).
//   unchanged (none): moved to .bak, byte for byte, exit 0, one line.
// Zero-dep: node:test + node:assert. Each case works in ONE folder it makes under the OS temp root and removes only that folder, by name,
// after checking its real path sits under the real temp root.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gitEnv } from './git-env.mjs'; // the flock's one rule for a git child's environment (CWK-133/C-4)

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOM = path.resolve(HERE, '..', '..');
const CONFIGURE = path.join(ROOM, 'scripts', 'configure.mjs');
const PRELOAD = path.join(HERE, 'configure-migrate-window-preload.mjs');
const { sandboxEnv } = await import(pathToFileURL(path.join(ROOM, 'scripts', 'lib', 'test-env.mjs')).href);

const PREFIX = 'ct-29kl-';
const LEGACY_TEXT = '{\n  "mode": "off",\n  "qualityBar": 90\n}\n';
const APPENDED = '// edited while the migration ran\n';

function makeWork() {
  // 29li: the work folder is taken by its REAL path. The child's own cwd is the real spelling (macOS /var is /private/var,
  // and a runner's 8.3 TEMP has a long form), so the rename target the preload watches and the legacy path configure prints
  // are real paths; a lexical os.tmpdir() spelling would never match either of them.
  const work = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), PREFIX)));
  const dir = path.join(work, 'proj');
  const home = path.join(work, 'home');
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true }); // findGitRoot anchor
  fs.mkdirSync(home);
  const legacy = path.join(dir, '.claude', '.coaltipple.json'); // LEGACY-1
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.writeFileSync(legacy, LEGACY_TEXT, 'utf8');
  const target = path.join(dir, '.claude', 'coal', 'coaltipple.json');
  return { work, dir, home, legacy, bak: `${legacy}.bak`, target, mark: path.join(work, 'window-fired.txt') };
}

function removeWork(work) {
  const root = fs.realpathSync.native(os.tmpdir());
  const real = fs.realpathSync.native(work);
  const rel = path.relative(root, real);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.includes(path.sep) || !path.basename(real).startsWith(PREFIX)) {
    console.log(`# left in place (not a direct ${PREFIX}* child of the temp root): ${work}`);
    return;
  }
  fs.rmSync(real, { recursive: true, force: true });
}

function migrate(w, mode, extraEnv = {}) {
  const env = sandboxEnv(w.home, {
    NODE_OPTIONS: '--max-old-space-size=2048',
    CT_WINDOW_TARGET: w.target,
    CT_WINDOW_LEGACY: w.legacy,
    CT_WINDOW_MODE: mode,
    CT_WINDOW_MARK: w.mark,
    ...extraEnv,
  });
  return spawnSync(process.execPath, ['--import', pathToFileURL(PRELOAD).href, CONFIGURE, '--project', '--qualityBar', '85'],
    { cwd: w.dir, env, encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL' });
}

const outputOf = (r) => `${r.stdout}\n${r.stderr}`;
const lines = (r) => outputOf(r).split(/\r?\n/);
const migratedConfig = (w) => JSON.parse(fs.readFileSync(w.target, 'utf8'));

function assertSpawned(r, w, why) {
  assert.equal(r.error, undefined, `spawn failed: ${r.error && r.error.code}`);
  if (why) assert.ok(fs.existsSync(w.mark), why);
}

// W-c1: the change lands right before the call that takes the legacy name away.
test('W-c1: bytes appended right before the legacy file is taken away are in the .bak, the run warns and exits 1', () => {
  const w = makeWork();
  try {
    const r = migrate(w, 'append-last');
    assertSpawned(r, w, 'the preload must have appended inside the window (else this leg proves nothing)');
    assert.equal(fs.existsSync(w.bak), true, `the appended bytes were deleted with the file: no ${w.bak}; exit ${r.status}; stdout: ${r.stdout.trim()}`);
    assert.equal(fs.readFileSync(w.bak, 'utf8'), LEGACY_TEXT + APPENDED, 'the .bak must hold every byte the legacy file held, appended ones included');
    assert.equal(fs.existsSync(w.legacy), false, 'the legacy file was moved, not copied');
    assert.notEqual(r.status, 0, `a backup that differs from what was migrated must not exit 0; stdout: ${r.stdout.trim()}`);
    assert.ok(lines(r).some((l) => l.includes(w.legacy) && l.includes(w.bak) && /differs/i.test(l)), `a line must name both files and say the backup differs; got:\n${outputOf(r).trim()}`);
    assert.equal(migratedConfig(w).qualityBar, 85, 'the new config stands');
    assert.equal(migratedConfig(w).mode, 'off', 'the new config holds what the seeding read returned');
  } finally { removeWork(w.work); }
});

for (const mode of ['append', 'samesize']) {
  test(`a legacy config changed (${mode}) between the seeding read and the move is in the .bak, the run warns and exits 1`, () => {
    const w = makeWork();
    try {
      const r = migrate(w, mode);
      assertSpawned(r, w, 'the preload must have changed the legacy file inside the window (else this leg proves nothing)');
      assert.equal(fs.existsSync(w.legacy), false, 'the legacy file is moved to the .bak, never left behind or deleted');
      assert.equal(fs.existsSync(w.bak), true, `the changed bytes must be in ${w.bak}; stdout: ${r.stdout.trim()}`);
      const kept = fs.readFileSync(w.bak, 'utf8');
      assert.notEqual(kept, LEGACY_TEXT, 'the .bak must hold the change made inside the window');
      assert.notEqual(r.status, 0, 'a backup that differs from what was migrated must not exit 0');
      assert.ok(lines(r).some((l) => l.includes(w.legacy) && l.includes(w.bak) && /differs/i.test(l)), `a line must name both files; got:\n${outputOf(r).trim()}`);
    } finally { removeWork(w.work); }
  });
}

// F1: the legacy file taken away by another program inside the window. Nothing is left at that path to move; the line says it is gone.
test('a legacy config removed by another program inside the window is reported as gone, not kept, there is no .bak, and the run exits 1', () => {
  const w = makeWork();
  try {
    const r = migrate(w, 'remove');
    assertSpawned(r, w, 'the preload must have removed the legacy file inside the window (else this leg proves nothing)');
    assert.equal(fs.existsSync(w.legacy), false, 'the preload moved the legacy file away; nothing may be at its path');
    assert.equal(fs.existsSync(w.bak), false, 'there was nothing to move, so no .bak may appear');
    assert.equal(r.status, 1, `exit ${r.status}; stdout: ${r.stdout.trim()}; stderr: ${r.stderr.trim()}`);
    assert.equal(migratedConfig(w).qualityBar, 85);
    assert.equal(migratedConfig(w).mode, 'off', 'the new config holds what the seeding read returned');
    assert.ok(lines(r).some((l) => l.includes(w.legacy) && /no longer there/i.test(l)), `a line must say ${w.legacy} is no longer there; got:\n${outputOf(r).trim()}`);
    assert.ok(!/still there|kept as/i.test(outputOf(r)), `nothing is at ${w.legacy} and no backup was made, so no line may say so; got:\n${outputOf(r).trim()}`);
  } finally { removeWork(w.work); }
});

// W-b2: the move is refused (a held file; only Windows shows a real hold, so the refusal is a preload everywhere). The legacy file stays.
for (const state of ['kept', 'gone', 'unchecked']) {
  test(`a refused move is reported with what the legacy name shows (${state}), leaves no .bak, does not retry, and exits 1`, () => {
    const w = makeWork();
    try {
      const r = migrate(w, 'refuse', { CT_WINDOW_AFTER: state });
      assertSpawned(r, w, 'the preload must have refused the move (else this leg proves nothing)');
      assert.equal(r.status, 1, `exit ${r.status}; stdout: ${r.stdout.trim()}; stderr: ${r.stderr.trim()}`);
      assert.equal(fs.existsSync(w.bak), false, 'a refused move makes no .bak');
      assert.equal(migratedConfig(w).qualityBar, 85, 'the new config stands');
      const out = outputOf(r);
      assert.ok(/EBUSY/.test(out), `the refusal's own reason must be printed; got:\n${out.trim()}`);
      assert.ok(!/Migrated the project config/.test(out), `a refused move is never printed as a success; got:\n${out.trim()}`);
      assert.equal(out.split(/\r?\n/).filter((l) => /could not move/i.test(l)).length, 1, `one line, no retry loop; got:\n${out.trim()}`);
      if (state === 'kept') {
        assert.equal(fs.readFileSync(w.legacy, 'utf8'), LEGACY_TEXT, 'the legacy file stays, byte for byte');
        assert.ok(/still there/i.test(out), `the line must say the legacy file is still there; got:\n${out.trim()}`);
      } else if (state === 'gone') {
        assert.equal(fs.existsSync(w.legacy), false);
        assert.ok(/no longer there/i.test(out), `the line must say the legacy file is no longer there; got:\n${out.trim()}`);
      } else {
        assert.ok(/could not be checked/i.test(out), `an lstat that throws proves nothing, and the line must say so; got:\n${out.trim()}`);
        assert.ok(!/still there|no longer there/i.test(out), `nothing is claimed about a name that could not be checked; got:\n${out.trim()}`);
      }
    } finally { removeWork(w.work); }
  });
}

// W-b1: a writer holds the legacy file open across the move and writes after it.
test('a writer holding the legacy file open across the move: its later bytes are in the .bak and the run warns and exits 1', () => {
  const w = makeWork();
  try {
    const r = migrate(w, 'descriptor');
    assertSpawned(r, w, 'the preload must have written through the held descriptor after the move (else this leg proves nothing)');
    assert.equal(fs.existsSync(w.legacy), false);
    assert.equal(fs.readFileSync(w.bak, 'utf8'), `${LEGACY_TEXT}WRITTEN-AFTER-RENAME\n`, 'the bytes written after the move are in the .bak');
    assert.notEqual(r.status, 0, 'a backup that differs from what was migrated must not exit 0');
    assert.ok(lines(r).some((l) => l.includes(w.legacy) && l.includes(w.bak) && /differs/i.test(l)), `a line must name both files; got:\n${outputOf(r).trim()}`);
  } finally { removeWork(w.work); }
});

test('a backup that cannot be read back is said, never reported as migrated, and the run exits 1', () => {
  const w = makeWork();
  try {
    const r = migrate(w, 'bak-oversize');
    assertSpawned(r, w, 'the preload must have grown the backup after the move (else this leg proves nothing)');
    assert.equal(fs.existsSync(w.legacy), false);
    assert.equal(r.status, 1, `exit ${r.status}; stdout: ${r.stdout.trim()}; stderr: ${r.stderr.trim()}`);
    assert.ok(lines(r).some((l) => l.includes(w.bak) && /could not read the backup back/i.test(l)), `a line must say the backup could not be read back; got:\n${outputOf(r).trim()}`);
    assert.ok(!/Migrated the project config/.test(outputOf(r)), 'an unchecked backup is never printed as a success');
  } finally { removeWork(w.work); }
});

test('an unchanged legacy config is moved to .bak byte for byte, the run says there was no earlier backup, and exits 0', () => {
  const w = makeWork();
  try {
    const r = migrate(w, 'none');
    assert.equal(r.error, undefined, `spawn failed: ${r.error && r.error.code}`);
    assert.equal(r.status, 0, `exit ${r.status}; stderr: ${r.stderr.trim()}`);
    assert.equal(fs.existsSync(w.legacy), false, 'the legacy file is moved away');
    assert.equal(fs.readFileSync(w.bak, 'utf8'), LEGACY_TEXT, 'the .bak holds the legacy file, byte for byte');
    assert.equal(migratedConfig(w).qualityBar, 85);
    assert.equal(migratedConfig(w).mode, 'off', 'the legacy content was carried into the new config');
    const line = lines(r).find((l) => l.includes(w.bak));
    assert.ok(line && /no earlier backup/i.test(line), `the line must say where the backup is and that there was no earlier one; got:\n${outputOf(r).trim()}`);
    assert.ok(!/tracked by git/i.test(outputOf(r)), 'an untracked legacy file gets no git advice');
  } finally { removeWork(w.work); }
});

test('an earlier .bak is replaced by the move, and the run says so', () => {
  const w = makeWork();
  try {
    fs.writeFileSync(w.bak, '{"earlier":"backup"}\n', 'utf8');
    const r = migrate(w, 'none');
    assert.equal(r.status, 0, `exit ${r.status}; stderr: ${r.stderr.trim()}`);
    assert.equal(fs.readFileSync(w.bak, 'utf8'), LEGACY_TEXT, 'the .bak now holds the file this run moved');
    const line = lines(r).find((l) => l.includes(w.bak));
    assert.ok(line && /replaced an earlier backup/i.test(line), `the line must say it replaced an earlier backup; got:\n${outputOf(r).trim()}`);
  } finally { removeWork(w.work); }
});

test('a git-tracked legacy config: the run tells the user to commit its removal, and the move still happens', (t) => {
  const w = makeWork();
  try {
    const have = spawnSync('git', ['--version'], { encoding: 'utf8', timeout: 20000, env: gitEnv(w.work) });
    if (have.error || have.status !== 0) { t.skip('no git on this machine'); return; }
    const init = spawnSync('git', ['init', '-q'], { cwd: w.dir, encoding: 'utf8', timeout: 30000, env: gitEnv(w.work) });
    if (init.status !== 0) { t.skip(`git init failed here: ${(init.stderr || '').trim()}`); return; }
    const add = spawnSync('git', ['add', '--', path.relative(w.dir, w.legacy)], { cwd: w.dir, encoding: 'utf8', timeout: 30000, env: gitEnv(w.work) });
    if (add.status !== 0) { t.skip(`git add failed here: ${(add.stderr || '').trim()}`); return; }
    const r = migrate(w, 'none');
    assert.equal(r.status, 0, `exit ${r.status}; stderr: ${r.stderr.trim()}`);
    assert.equal(fs.readFileSync(w.bak, 'utf8'), LEGACY_TEXT);
    const out = outputOf(r);
    assert.ok(lines(r).some((l) => l.includes(w.legacy) && /tracked by git: commit its removal/i.test(l)), `the run must say the legacy file is tracked and its removal is the user's to commit; got:\n${out.trim()}`);
    assert.ok(!fs.existsSync(path.join(w.dir, '.gitignore')), 'nothing is gitignored for the user');
  } finally { removeWork(w.work); }
});
