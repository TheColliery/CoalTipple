// 29kl (reviewer 3cd548da's witness, ported): the legacy-config migration in scripts/configure.mjs must not delete the
// legacy file when it changed after the read that seeded the migration.
// The class: READ-WINDOW CO-WRITER (umbrella code-reviewer store). The window is reached by a preload
// (configure-migrate-window-preload.mjs, `node --import`) that changes the legacy file right after the new config is renamed
// into place, i.e. after the seeding read and before the legacy delete.
// Leg A: an append, and a same-size replace by another file. The legacy file must be kept, the exit non-zero, and a line
//        must name the legacy file as kept.
// Leg R (29ky): the legacy file is removed by another program inside the window. Exit 1, the new config is written, and the
//        warning says it was removed, never that anything was kept.
// Leg B: no change. The migration still removes the legacy file and exits 0.
// Zero-dep: node:test + node:assert. Each case works in ONE folder it makes under the OS temp root and removes only that
// folder, by name, after checking its real path sits under the real temp root.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOM = path.resolve(HERE, '..', '..');
const CONFIGURE = path.join(ROOM, 'scripts', 'configure.mjs');
const PRELOAD = path.join(HERE, 'configure-migrate-window-preload.mjs');
const { sandboxEnv } = await import(pathToFileURL(path.join(ROOM, 'scripts', 'lib', 'test-env.mjs')).href);

const PREFIX = 'ct-29kl-';
const LEGACY_TEXT = '{\n  "mode": "off",\n  "qualityBar": 90\n}\n';

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
  return { work, dir, home, legacy, target, mark: path.join(work, 'window-fired.txt') };
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

function migrate(w, mode) {
  const env = sandboxEnv(w.home, {
    NODE_OPTIONS: '--max-old-space-size=2048',
    CT_WINDOW_TARGET: w.target,
    CT_WINDOW_LEGACY: w.legacy,
    CT_WINDOW_MODE: mode,
    CT_WINDOW_MARK: w.mark,
  });
  return spawnSync(process.execPath, ['--import', pathToFileURL(PRELOAD).href, CONFIGURE, '--project', '--qualityBar', '85'],
    { cwd: w.dir, env, encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL' });
}

for (const mode of ['append', 'samesize']) {
  test(`keeps the legacy config and exits non-zero when it changed (${mode}) between the seeding read and the delete`, () => {
    const w = makeWork();
    try {
      const r = migrate(w, mode);
      assert.equal(r.error, undefined, `spawn failed: ${r.error && r.error.code}`);
      assert.ok(fs.existsSync(w.mark), 'the preload must have changed the legacy file inside the window (else this leg proves nothing)');
      const changed = fs.existsSync(w.legacy) ? fs.readFileSync(w.legacy, 'utf8') : null;
      assert.notEqual(changed, null, `the legacy file was deleted although it changed after the read; exit ${r.status}; stdout: ${r.stdout.trim()}`);
      assert.notEqual(changed, LEGACY_TEXT, 'the legacy file must still hold the change made inside the window');
      assert.notEqual(r.status, 0, 'a migration that kept a changed legacy file must not exit 0');
      const out = `${r.stdout}\n${r.stderr}`;
      const named = out.split(/\r?\n/).some((l) => l.includes(w.legacy) && /kept|keep|kept it/i.test(l));
      assert.ok(named, `a line must name ${w.legacy} as kept; got:\n${out.trim()}`);
    } finally { removeWork(w.work); }
  });
}

// 29ky (F2): the legacy file taken away by another program inside the window. Nothing is left at that path to keep, so the
// warning says it was removed, never "kept"; the run still exits 1 (the file changed during the migration) and the new
// config holds what the seeding read returned.
test('a legacy config removed by another program inside the window is reported as removed, not kept, and the run exits 1', () => {
  const w = makeWork();
  try {
    const r = migrate(w, 'remove');
    assert.equal(r.error, undefined, `spawn failed: ${r.error && r.error.code}`);
    assert.ok(fs.existsSync(w.mark), 'the preload must have removed the legacy file inside the window (else this leg proves nothing)');
    assert.ok(!fs.existsSync(w.legacy), 'the preload moved the legacy file away; nothing may be at its path');
    assert.equal(r.status, 1, `exit ${r.status}; stdout: ${r.stdout.trim()}; stderr: ${r.stderr.trim()}`);
    const migrated = JSON.parse(fs.readFileSync(w.target, 'utf8'));
    assert.equal(migrated.qualityBar, 85);
    assert.equal(migrated.mode, 'off', 'the new config holds what the seeding read returned');
    const out = `${r.stdout}\n${r.stderr}`;
    assert.ok(out.split(/\r?\n/).some((l) => l.includes(w.legacy) && /removed/i.test(l)), `a line must name ${w.legacy} as removed; got:\n${out.trim()}`);
    assert.ok(!/kept/i.test(out), `nothing was kept at ${w.legacy}, so no line may say so; got:\n${out.trim()}`);
  } finally { removeWork(w.work); }
});

test('an unchanged legacy config is still migrated: the legacy file is removed and the run exits 0', () => {
  const w = makeWork();
  try {
    const r = migrate(w, 'none');
    assert.equal(r.error, undefined, `spawn failed: ${r.error && r.error.code}`);
    assert.equal(r.status, 0, `exit ${r.status}; stderr: ${r.stderr.trim()}`);
    assert.ok(!fs.existsSync(w.legacy), 'the unchanged legacy file must be gone after the migration');
    const migrated = JSON.parse(fs.readFileSync(w.target, 'utf8'));
    assert.equal(migrated.qualityBar, 85);
    assert.equal(migrated.mode, 'off', 'the legacy content was carried into the new config');
  } finally { removeWork(w.work); }
});
