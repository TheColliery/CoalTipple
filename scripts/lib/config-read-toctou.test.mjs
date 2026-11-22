// 29nn (T, the check-then-use window in a reader): a project config is CHECKED by name (containedPath, an lstat, an existsSync) and then OPENED by name.
// A link swapped in between (a junction or dir symlink at a folder of the chain, or a hard link at the file's own name) made the reader return a stranger's
// bytes, and configure.mjs then WROTE them back out through the swapped folder. The fix (the 29nd form): where a root is given, an lstat walk of the folder
// chain, then lstat of the file, the open, then fstat of the HANDLE compared with that lstat on dev AND ino (bigint); a mismatch closes the handle and
// refuses (ECHANGED), fail closed. Three readers carry it: scripts/lib/config-bound.mjs (config-load, configure, legacy-backup) and the conductor hook.
//
// The seam is the form note's: fs.openSync is reassigned so the name is swapped just before the REAL open (no privilege needed). Legs:
//   (a) library, in-process: readConfigBounded and loadMergedConfig, a junction swap and a hard-link swap;
//   (b) CLI: the real configure.mjs spawned with scripts/lib/config-read-toctou-preload.mjs;
//   (c) hook: the real conductor spawned with the same preload (fail-silent: the swapped file reads as absent, exit 0, nothing of it read).
// Green legs stay green: an unswapped config is read; a missing one is absent.
// Temp roots are taken by fs.realpathSync.native; no assertion matches a bare word a temp path can contain (paths are stripped before a word check).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sandboxEnv, namesPath } from './test-env.mjs';
import { readConfigBounded } from './config-bound.mjs';
import { loadMergedConfig } from './config-load.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOM = path.resolve(HERE, '..', '..');
const CONFIGURE = path.join(ROOM, 'scripts', 'configure.mjs');
const CONDUCTOR = path.join(ROOM, 'hooks', 'coaltipple-conductor.js');
const PRELOAD = path.join(HERE, 'config-read-toctou-preload.mjs');
const PREFIX = 'ct-29nn-toc-';
const INSIDE = '{ "marker": "INSIDE", "qualityBar": 60 }\n';
const OUTSIDE = '{ "marker": "OUTSIDE", "qualityBar": 61 }\n';
const VICTIM = '{ "marker": "VICTIM", "qualityBar": 62 }\n';
const MODES = ['junction', 'hardlink'];

// One project per case: <dir>/proj/.git, <dir>/proj/.claude/coal/coaltipple.json (INSIDE), <dir>/outside/coaltipple.json (OUTSIDE), <dir>/victim.json (VICTIM).
function makeCase(t) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), PREFIX)));
  t.after(() => {
    for (const j of [path.join(dir, 'proj', '.claude', 'coal')]) { try { if (fs.lstatSync(j).isSymbolicLink()) fs.rmdirSync(j); } catch { /* not a link, or gone */ } }
    const root = fs.realpathSync.native(os.tmpdir());
    const real = fs.realpathSync.native(dir);
    if (path.dirname(real) === root && path.basename(real).startsWith(PREFIX)) fs.rmSync(real, { recursive: true, force: true });
  });
  const proj = path.join(dir, 'proj');
  const home = path.join(dir, 'home');
  const outside = path.join(dir, 'outside');
  const victim = path.join(dir, 'victim.json');
  const target = path.join(proj, '.claude', 'coal', 'coaltipple.json');
  fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(target, INSIDE);
  fs.writeFileSync(path.join(outside, 'coaltipple.json'), OUTSIDE);
  fs.writeFileSync(victim, VICTIM);
  return { dir, proj, home, outside, victim, target, mark: path.join(dir, 'mark.jsonl') };
}

// In-process seam: just before the real open of `target`, swap the name (once; mode 'count' only counts). Returns { undo, opens, fired } (opens counts opens of the target name).
function seam(c, mode) {
  const realOpen = fs.openSync;
  const state = { fired: false, opens: 0 };
  fs.openSync = function seamOpen(p, flags, ...rest) {
    const reading = flags === undefined || flags === 'r' || flags === 0;
    if (reading && path.resolve(String(p)).toLowerCase() === c.target.toLowerCase()) {
      state.opens += 1;
      if (!state.fired && mode !== 'count') {
        state.fired = true;
        if (mode === 'junction') {
          const dir = path.dirname(c.target);
          fs.renameSync(dir, `${dir}.moved-by-witness`);
          fs.symlinkSync(c.outside, dir, process.platform === 'win32' ? 'junction' : 'dir');
        } else {
          fs.renameSync(c.target, `${c.target}.moved-by-witness`);
          fs.linkSync(c.victim, c.target);
        }
      }
    }
    return realOpen(p, flags, ...rest);
  };
  state.undo = () => { fs.openSync = realOpen; };
  return state;
}

// A hard link cannot always be made (a filesystem without them, a policy): that leg skips VISIBLY, in its own test.
function canLink(dir) {
  const a = path.join(dir, 'probe-a');
  const b = path.join(dir, 'probe-b');
  try { fs.writeFileSync(a, 'x'); fs.linkSync(a, b); return true; } catch { return false; } finally { for (const f of [a, b]) { try { fs.unlinkSync(f); } catch { /* absent */ } } }
}
function canJunction(dir) {
  const a = path.join(dir, 'probe-dir');
  const b = path.join(dir, 'probe-link');
  try { fs.mkdirSync(a); fs.symlinkSync(a, b, process.platform === 'win32' ? 'junction' : 'dir'); return true; } catch { return false; } finally { for (const f of [b]) { try { fs.rmdirSync(f); } catch { /* absent */ } } try { fs.rmdirSync(a); } catch { /* absent */ } }
}
const skipFor = (t, c, mode) => {
  if (mode === 'hardlink' && !canLink(c.dir)) { t.skip('hard links cannot be made here'); return true; }
  if (mode === 'junction' && !canJunction(c.dir)) { t.skip('junctions or directory symlinks cannot be made here'); return true; }
  return false;
};

// ---------- (a) library ----------
for (const mode of MODES) {
  test(`readConfigBounded with a root refuses a ${mode} swapped in after the check: ECHANGED, nothing of the other file is returned`, (t) => {
    const c = makeCase(t);
    if (skipFor(t, c, mode)) return;
    const s = seam(c, mode);
    let got; let err;
    try { got = readConfigBounded(c.target, c.proj); } catch (e) { err = e; } finally { s.undo(); }
    assert.equal(s.fired, true, 'the swap fired: the reader opened the name');
    assert.equal(got, undefined, `no text may come back; got: ${got}`);
    assert.ok(err && err.code === 'ECHANGED', `the refusal is ECHANGED; got: ${err && err.code} ${err && err.message}`);
    assert.ok(namesPath(err.message, c.target), `the refusal names the file; got: ${err.message}`);
  });

  test(`loadMergedConfig reads a project config as ABSENT when a ${mode} is swapped in after the check (it never returns the other file's keys)`, (t) => {
    const c = makeCase(t);
    if (skipFor(t, c, mode)) return;
    const s = seam(c, mode);
    let cfg;
    try { cfg = loadMergedConfig({ cwd: c.proj, home: c.home }); } finally { s.undo(); }
    assert.equal(s.fired, true, 'the swap fired: the loader opened the name');
    assert.equal(cfg.marker, undefined, `the swapped file's keys must not appear; got marker ${cfg.marker}`);
  });
}

test('readConfigBounded with a root never opens the file when a link already sits in the folder chain', (t) => {
  const c = makeCase(t);
  if (skipFor(t, c, 'junction')) return;
  const dir = path.dirname(c.target);
  fs.renameSync(dir, `${dir}.moved-aside`);
  fs.symlinkSync(c.outside, dir, process.platform === 'win32' ? 'junction' : 'dir');
  const s = seam(c, 'count');
  let err; let got;
  try { got = readConfigBounded(c.target, c.proj); } catch (e) { err = e; } finally { s.undo(); }
  assert.equal(got, undefined);
  assert.equal(s.opens, 0, 'the walk refuses BEFORE the open: a link in the chain is never followed');
  assert.ok(err && err.code === 'ELINK', `a link in the chain is ELINK; got ${err && err.code}`);
});

test('green: an unswapped project config is read through the same path, and a missing one is absent', (t) => {
  const c = makeCase(t);
  assert.equal(readConfigBounded(c.target, c.proj), INSIDE);
  assert.equal(loadMergedConfig({ cwd: c.proj, home: c.home }).marker, 'INSIDE');
  fs.rmSync(c.target);
  assert.throws(() => readConfigBounded(c.target, c.proj), (e) => e.code === 'ENOENT', 'a missing file keeps its ENOENT, so a caller still reads it as absent');
  assert.equal(loadMergedConfig({ cwd: c.proj, home: c.home }).marker, undefined);
  assert.equal(readConfigBounded(path.join(c.outside, 'coaltipple.json')), OUTSIDE, 'with no root the read still works (a global config is read this way)');
});

// ---------- (b) CLI ----------
function spawnWith(script, args, c, mode, extraEnv = {}, input) {
  const env = sandboxEnv(c.home, { TC_TARGET: c.target, TC_MODE: mode, TC_OUTSIDE: c.outside, TC_VICTIM: c.victim, TC_MARK: c.mark, ...extraEnv });
  return spawnSync(process.execPath, ['--import', pathToFileURL(PRELOAD).href, script, ...args], { cwd: c.proj, env, input, encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL' });
}
const marks = (c) => (fs.existsSync(c.mark) ? fs.readFileSync(c.mark, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
const compact = (s) => s.replace(/\s+/g, ' ').trim();

for (const mode of MODES) {
  test(`configure --project refuses a ${mode} swapped in after the check: exit 1, the file named, nothing of the other file written or read`, (t) => {
    const c = makeCase(t);
    if (skipFor(t, c, mode)) return;
    const r = spawnWith(CONFIGURE, ['--project', '--qualityBar', '85'], c, mode);
    assert.equal(r.error, undefined, `spawn failed: ${r.error && r.error.code}`);
    assert.ok(marks(c).some((m) => m.swapped === mode), 'the swap fired in the child');
    assert.equal(r.status, 1, `exit ${r.status}; stdout: ${r.stdout.trim()}; stderr: ${r.stderr.trim()}`);
    assert.ok(namesPath(`${r.stdout}\n${r.stderr}`, c.target), `the run names the file; got:\n${r.stdout}\n${r.stderr}`);
    assert.equal(compact(fs.readFileSync(path.join(c.outside, 'coaltipple.json'), 'utf8')), compact(OUTSIDE), 'the outside file is byte-for-byte unchanged');
    assert.equal(fs.readFileSync(c.victim, 'utf8'), VICTIM, 'the victim file is byte-for-byte unchanged');
    assert.equal(fs.readFileSync(mode === 'junction' ? path.join(`${path.dirname(c.target)}.moved-by-witness`, 'coaltipple.json') : `${c.target}.moved-by-witness`, 'utf8'), INSIDE, 'the project file this run checked was not rewritten');
  });
}

test('green: configure --project on an unswapped config reads it and writes the edit, exit 0', (t) => {
  const c = makeCase(t);
  const r = spawnWith(CONFIGURE, ['--project', '--qualityBar', '85'], c, 'none');
  assert.equal(r.status, 0, `exit ${r.status}; stderr: ${r.stderr.trim()}`);
  assert.match(fs.readFileSync(c.target, 'utf8'), /"qualityBar":\s*85/);
  assert.match(fs.readFileSync(c.target, 'utf8'), /"marker":\s*"INSIDE"/);
});

// ---------- (c) hook ----------
const hookInput = (c) => JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'rename a variable', cwd: c.proj, session_id: 'toc' });

for (const mode of MODES) {
  test(`the conductor hook reads a project config as ABSENT when a ${mode} is swapped in after the check: exit 0, nothing of the other file read`, (t) => {
    const c = makeCase(t);
    if (skipFor(t, c, mode)) return;
    const r = spawnWith(CONDUCTOR, [], c, mode, {}, hookInput(c));
    assert.equal(r.error, undefined, `spawn failed: ${r.error && r.error.code}`);
    const m = marks(c);
    assert.ok(m.some((x) => x.swapped === mode), 'the swap fired in the child');
    assert.equal(r.status, 0, `a fail-silent hook exits 0; got ${r.status}; stderr: ${r.stderr.trim()}`);
    const reads = m.filter((x) => x.read).map((x) => x.read);
    assert.deepEqual(reads, [], `no text may be read through the swapped name; got: ${reads.join(' | ')}`);
    assert.equal(r.stderr.trim(), '', 'the hook stays silent on stderr');
  });
}

test('green: the conductor hook on an unswapped config reads it (exit 0)', (t) => {
  const c = makeCase(t);
  const r = spawnWith(CONDUCTOR, [], c, 'none', {}, hookInput(c));
  assert.equal(r.status, 0, `exit ${r.status}; stderr: ${r.stderr.trim()}`);
  const reads = marks(c).filter((x) => x.read).map((x) => x.read);
  assert.ok(reads.some((x) => x.includes('INSIDE')), `the project config is read; got: ${reads.join(' | ')}`);
});
