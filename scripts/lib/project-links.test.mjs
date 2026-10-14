// 14a: the E2-4 class, planted-link witnesses. A project's own state folder (<root>/.claude/coal/, the legacy config paths,
// <root>/.claude/.coaltipple/) arrives with a CLONED repo, so a link inside it (a junction on Windows, a symlink on POSIX) can
// point OUTSIDE the project. The shipped conductor and the user-run scripts must neither READ a config through such a link nor
// WRITE (create, overwrite, rename, delete) a file through one (hooks-safety.md section 10, node/runtime.md sections 4-5).
//
// Every fixture lives under one mkdtemp root inside os.tmpdir(); HOME/USERPROFILE point inside it and CLAUDE_CONFIG_DIR and
// GIT_* are dropped from each child, so no real config is ever read or written. The "victim" is a folder in that root but
// OUTSIDE proj/: its bytes are snapshotted before the run and must be identical after it.
// The directory legs use a junction on Windows and a dir symlink on POSIX (no privilege needed on either). The FILE-symlink legs
// need the symlink privilege on Windows: each is a probed leg with a VISIBLE skip, and it is the only link kind in its test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const INSTALL = path.join(REPO, 'scripts', 'install.mjs');
const CONFIGURE = path.join(REPO, 'scripts', 'configure.mjs');
const HOOK = path.join(REPO, 'hooks', 'coaltipple-conductor.js');
const SPAWN_TIMEOUT_MS = 30000; // every test spawn is bounded (testing.md: a finite clock)
const WIN = process.platform === 'win32';
const VICTIM_BYTES = 'VICTIM-BYTES\n';
const VICTIM_JSON = '{ "qualityBar": 5 }\n'; // a config the tools CAN parse, so a write-through is not masked by a parse error
const OFF_CONFIG = JSON.stringify({ mode: 'off', qualityBar: 11 }); // routingOff() is true when this is READ

function dropLink(p) {
  let st;
  try { st = fs.lstatSync(p); } catch { return; }
  if (!st.isSymbolicLink()) return;
  try { fs.unlinkSync(p); } catch { try { fs.rmdirSync(p); } catch { /* the sandbox root is removed whole below */ } }
}
function sandbox(t) {
  const base = fs.realpathSync.native(os.tmpdir());
  const root = fs.mkdtempSync(path.join(base, 'ct-links-'));
  const sb = { root, proj: path.join(root, 'proj'), victim: path.join(root, 'victim'), home: path.join(root, 'home'), links: [] };
  for (const d of [sb.proj, sb.victim, sb.home, path.join(sb.proj, '.git')]) fs.mkdirSync(d, { recursive: true });
  t.after(() => {
    for (const l of sb.links) dropLink(l);
    const real = fs.realpathSync.native(root);
    if (real.startsWith(base + path.sep) && path.basename(real).startsWith('ct-links-')) fs.rmSync(real, { recursive: true, force: true });
  });
  return sb;
}
// Make a link at `at` pointing to `target`. Returns null on success, else the error code (the caller skips VISIBLY).
function mkLink(sb, target, at, kind) {
  try {
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.symlinkSync(target, at, kind === 'dir' ? (WIN ? 'junction' : 'dir') : 'file');
    sb.links.push(at);
    return null;
  } catch (e) { return e.code || 'ERR'; }
}
function linkOrSkip(t, sb, target, at, kind) {
  const err = mkLink(sb, target, at, kind);
  if (err) { t.skip(`${kind} link not creatable here (${err}) -- capability-gated, not asserting a false pass`); return false; }
  return true;
}
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
// A byte snapshot of a tree, links NOT followed: sorted "rel:size:sha1" lines.
function snap(dir) {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const rel = path.relative(dir, p).split(path.sep).join('/');
      if (e.isDirectory()) { out.push(`${rel}/`); walk(p); }
      else {
        const bytes = fs.readFileSync(p); // read ONCE: the size comes from the same buffer the hash does (no stat-then-read race, CodeQL js/file-system-race)
        out.push(`${rel}:${bytes.length}:${crypto.createHash('sha1').update(bytes).digest('hex')}`);
      }
    }
  })(dir);
  return out.sort();
}
function childEnv(home) {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.CLAUDE_CONFIG_DIR;
  for (const k of Object.keys(env)) if (/^GIT_/i.test(k)) delete env[k];
  return env;
}
const node = (args, sb, input) => spawnSync(process.execPath, args, { cwd: sb.proj, env: childEnv(sb.home), input, encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS });
const hook = (sb) => node([HOOK], sb, JSON.stringify({ hook_event_name: 'SessionStart' }));
const install = (sb, ...a) => node([INSTALL, ...a], sb);
const configure = (sb, ...a) => node([CONFIGURE, ...a], sb);

async function loadMerged(sb) {
  const saved = process.env.CLAUDE_CONFIG_DIR;
  delete process.env.CLAUDE_CONFIG_DIR;
  try {
    const m = await import(pathToFileURL(path.join(REPO, 'scripts', 'lib', 'config-load.mjs')).href);
    return m.loadMergedConfig({ cwd: sb.proj, home: sb.home });
  } finally { if (saved !== undefined) process.env.CLAUDE_CONFIG_DIR = saved; }
}
// The READ contract: nothing from the victim reaches the effective config, and the hook still routes (it saw no mode:off).
async function assertNotRead(sb) {
  const merged = await loadMerged(sb);
  assert.equal(merged.qualityBar, undefined, 'loadMergedConfig must not read a config reached through a link');
  assert.equal(merged.mode, undefined, 'loadMergedConfig must not read a config reached through a link');
  const r = hook(sb);
  assert.equal(r.status, 0); assert.equal(r.stderr, '');
  assert.match(r.stdout, /routing active/, 'the conductor read the victim config (mode:off) through the link and went silent');
}
// The WRITE contract: exit non-zero, a line on stderr naming the refusal, the victim byte-identical.
function assertRefused(r, sb, before, what) {
  assert.deepEqual(snap(sb.victim), before, `${what}: the folder OUTSIDE the project was modified`);
  assert.notEqual(r.status, 0, `${what}: must exit non-zero\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /refus/i, `${what}: stderr must say it refused\n${r.stderr}`);
}

// ---------- unconditional controls: the witnesses below discriminate ----------
test('CONTROL read: a real project config with mode:off is read (the conductor goes silent, the cascade carries it)', async (t) => {
  const sb = sandbox(t);
  write(path.join(sb.proj, '.claude', 'coal', 'coaltipple.json'), OFF_CONFIG);
  assert.equal((await loadMerged(sb)).qualityBar, 11);
  const r = hook(sb);
  assert.equal(r.status, 0); assert.equal(r.stdout, '', 'a real mode:off config silences the hook');
});
test('CONTROL write: with no link anywhere, install --reset and configure --project write the project config', (t) => {
  const sb = sandbox(t);
  const ri = install(sb, '--reset');
  assert.equal(ri.status, 0, `${ri.stdout}${ri.stderr}`);
  const cfg = path.join(sb.proj, '.claude', 'coal', 'coaltipple.json');
  assert.ok(fs.existsSync(cfg), 'install --reset seeded the canonical project config');
  const rc = configure(sb, '--project', '--qualityBar', '70');
  assert.equal(rc.status, 0, `${rc.stdout}${rc.stderr}`);
  assert.match(fs.readFileSync(cfg, 'utf8'), /"qualityBar":\s*70/);
});

// ---------- class: project-config READ ----------
test('READ: a link AT the coal directory (junction/dir symlink to a folder outside the project) is never read', async (t) => {
  const sb = sandbox(t);
  write(path.join(sb.victim, 'coaltipple.json'), OFF_CONFIG);
  if (!linkOrSkip(t, sb, sb.victim, path.join(sb.proj, '.claude', 'coal'), 'dir')) return;
  await assertNotRead(sb);
});
test('READ: a link at a PARENT between the root and the folder (.claude) is never read, canonical and legacy shapes alike', async (t) => {
  const sb = sandbox(t);
  write(path.join(sb.victim, 'coal', 'coaltipple.json'), OFF_CONFIG);
  write(path.join(sb.victim, '.coaltipple.json'), OFF_CONFIG);
  if (!linkOrSkip(t, sb, sb.victim, path.join(sb.proj, '.claude'), 'dir')) return;
  await assertNotRead(sb);
});
test('READ: a link to a folder INSIDE the project but outside the config folder is refused too (inside-the-folder, not inside-the-project)', async (t) => {
  const sb = sandbox(t);
  write(path.join(sb.proj, 'elsewhere', 'coaltipple.json'), OFF_CONFIG);
  if (!linkOrSkip(t, sb, path.join(sb.proj, 'elsewhere'), path.join(sb.proj, '.claude', 'coal'), 'dir')) return;
  await assertNotRead(sb);
});
test('READ: a file symlink AT the config file is never read', async (t) => {
  const sb = sandbox(t);
  write(path.join(sb.victim, 'outside.json'), OFF_CONFIG);
  if (!linkOrSkip(t, sb, path.join(sb.victim, 'outside.json'), path.join(sb.proj, '.claude', 'coal', 'coaltipple.json'), 'file')) return;
  await assertNotRead(sb);
});
test('READ: a file symlink AT the LEGACY-2 root dotfile is never read', async (t) => {
  const sb = sandbox(t);
  write(path.join(sb.victim, 'outside.json'), OFF_CONFIG);
  if (!linkOrSkip(t, sb, path.join(sb.victim, 'outside.json'), path.join(sb.proj, '.coaltipple.json'), 'file')) return;
  await assertNotRead(sb);
});

// ---------- class: project-config WRITE (install --reset, configure --project) ----------
test('WRITE: install --reset through a link AT the coal directory writes nothing outside the project (the T-A witness)', (t) => {
  const sb = sandbox(t);
  write(path.join(sb.proj, '.claude', '.coaltipple.json'), JSON.stringify({ qualityBar: 70 })); // a legacy config, as the thread's precondition
  write(path.join(sb.victim, 'coaltipple.json'), VICTIM_BYTES);
  if (!linkOrSkip(t, sb, sb.victim, path.join(sb.proj, '.claude', 'coal'), 'dir')) return;
  const before = snap(sb.victim);
  assertRefused(install(sb, '--reset'), sb, before, 'install --reset');
  assert.ok(fs.existsSync(path.join(sb.proj, '.claude', '.coaltipple.json')), 'the legacy config was not moved aside by a refused run');
  assert.equal(fs.existsSync(path.join(sb.proj, '.claude', '.coaltipple.json.superseded')), false);
});
test('WRITE: install --reset through a link at a PARENT (.claude) writes nothing outside the project', (t) => {
  const sb = sandbox(t);
  write(path.join(sb.victim, '.coaltipple.json'), VICTIM_BYTES);
  write(path.join(sb.victim, 'coal', 'coaltipple.json'), VICTIM_BYTES);
  if (!linkOrSkip(t, sb, sb.victim, path.join(sb.proj, '.claude'), 'dir')) return;
  const before = snap(sb.victim);
  assertRefused(install(sb, '--reset'), sb, before, 'install --reset');
});
test('WRITE: install --reset through a file symlink AT the config file writes nothing outside the project', (t) => {
  const sb = sandbox(t);
  write(path.join(sb.victim, 'outside.json'), VICTIM_BYTES);
  if (!linkOrSkip(t, sb, path.join(sb.victim, 'outside.json'), path.join(sb.proj, '.claude', 'coal', 'coaltipple.json'), 'file')) return;
  const before = snap(sb.victim);
  assertRefused(install(sb, '--reset'), sb, before, 'install --reset');
});
test('WRITE: install --reset through a DANGLING file symlink at the config path creates nothing outside the project', (t) => {
  const sb = sandbox(t);
  if (!linkOrSkip(t, sb, path.join(sb.victim, 'not-yet.json'), path.join(sb.proj, '.claude', 'coal', 'coaltipple.json'), 'file')) return;
  const before = snap(sb.victim);
  assertRefused(install(sb, '--reset'), sb, before, 'install --reset');
  assert.equal(fs.existsSync(path.join(sb.victim, 'not-yet.json')), false, 'the dangling link target was created');
});
test('WRITE: a PATH install (the create-if-absent seed, no --reset) through a link AT the coal directory creates nothing outside the project', (t) => {
  const sb = sandbox(t);
  write(path.join(sb.victim, 'placeholder.txt'), VICTIM_BYTES);
  if (!linkOrSkip(t, sb, sb.victim, path.join(sb.proj, '.claude', 'coal'), 'dir')) return;
  const before = snap(sb.victim);
  assertRefused(install(sb, path.join(sb.proj, 'skills')), sb, before, 'install <path> (seed)');
});
test('WRITE: configure --project through a link AT the coal directory writes nothing outside the project', (t) => {
  const sb = sandbox(t);
  write(path.join(sb.victim, 'coaltipple.json'), VICTIM_JSON);
  if (!linkOrSkip(t, sb, sb.victim, path.join(sb.proj, '.claude', 'coal'), 'dir')) return;
  const before = snap(sb.victim);
  assertRefused(configure(sb, '--project', '--qualityBar', '70'), sb, before, 'configure --project');
});
test('WRITE: configure --project through a link at a PARENT (.claude) writes nothing outside the project', (t) => {
  const sb = sandbox(t);
  write(path.join(sb.victim, 'placeholder.txt'), VICTIM_BYTES);
  if (!linkOrSkip(t, sb, sb.victim, path.join(sb.proj, '.claude'), 'dir')) return;
  const before = snap(sb.victim);
  assertRefused(configure(sb, '--project', '--qualityBar', '70'), sb, before, 'configure --project');
});

// ---------- class: the legacy move-aside rename / delete ----------
test('LEGACY: configure --project with the legacy config reached through a link at .claude moves, renames and deletes nothing outside the project', (t) => {
  const sb = sandbox(t);
  write(path.join(sb.victim, '.coaltipple.json'), VICTIM_JSON); // the LEGACY-1 file, as seen through the link
  if (!linkOrSkip(t, sb, sb.victim, path.join(sb.proj, '.claude'), 'dir')) return;
  const before = snap(sb.victim);
  assertRefused(configure(sb, '--project', '--qualityBar', '70'), sb, before, 'configure --project (legacy through .claude)');
  assert.equal(fs.existsSync(path.join(sb.victim, '.coaltipple.json.superseded')), false, 'the outside legacy file was renamed');
});
test('LEGACY: configure --project with the LEGACY-1 file a symlink to a file outside the project reads nothing from it and migrates nothing', (t) => {
  const sb = sandbox(t);
  write(path.join(sb.victim, 'outside.json'), VICTIM_JSON);
  if (!linkOrSkip(t, sb, path.join(sb.victim, 'outside.json'), path.join(sb.proj, '.claude', '.coaltipple.json'), 'file')) return;
  const before = snap(sb.victim);
  assertRefused(configure(sb, '--project', '--qualityBar', '70'), sb, before, 'configure --project (LEGACY-1 symlink)');
  assert.equal(fs.existsSync(path.join(sb.proj, '.claude', 'coal', 'coaltipple.json')), false, 'nothing was migrated into the project config');
});
// The legacy file is reached through a link at .claude while the WRITE TARGET itself is clean (a real .agents/coal config): only the legacy path is bad, so only a
// check that includes the LEGACY paths stops the move-aside rename of the outside file.
function cleanTargetLegacyViaLink(t, sb) {
  write(path.join(sb.proj, '.agents', 'coal', 'coaltipple.json'), JSON.stringify({ qualityBar: 61 }));
  write(path.join(sb.victim, '.coaltipple.json'), VICTIM_JSON);
  return linkOrSkip(t, sb, sb.victim, path.join(sb.proj, '.claude'), 'dir');
}
test('LEGACY: configure --project with a clean .agents target but the legacy file reached through a link at .claude renames nothing outside the project', (t) => {
  const sb = sandbox(t);
  if (!cleanTargetLegacyViaLink(t, sb)) return;
  const before = snap(sb.victim);
  assertRefused(configure(sb, '--project', '--qualityBar', '70'), sb, before, 'configure --project (clean target, legacy through .claude)');
});
test('LEGACY: install --reset with a clean .agents target but the legacy file reached through a link at .claude renames nothing outside the project', (t) => {
  const sb = sandbox(t);
  if (!cleanTargetLegacyViaLink(t, sb)) return;
  const before = snap(sb.victim);
  assertRefused(install(sb, '--reset'), sb, before, 'install --reset (clean target, legacy through .claude)');
});
// A HARD link needs no privilege on any OS and is not a link containedPath can see (the entry is its own physical path), so the write itself must replace the
// directory entry (temp + rename, node/runtime.md section 5) and never write THROUGH it into the file that shares its bytes.
test('WRITE: install --reset over a HARD link at the config file replaces the entry and leaves the file it shares bytes with untouched', (t) => {
  const sb = sandbox(t);
  const outside = path.join(sb.victim, 'outside.json');
  write(outside, VICTIM_JSON);
  const cfg = path.join(sb.proj, '.claude', 'coal', 'coaltipple.json');
  fs.mkdirSync(path.dirname(cfg), { recursive: true });
  try { fs.linkSync(outside, cfg); } catch (e) { t.skip(`hard link not creatable here (${e.code}) -- capability-gated`); return; }
  const before = snap(sb.victim);
  const r = install(sb, '--reset');
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.deepEqual(snap(sb.victim), before, 'the outside file sharing bytes with the config was written through');
  assert.match(fs.readFileSync(cfg, 'utf8'), /"mode"/, 'the project config is now the factory template');
});
test('LEGACY: install --reset with the legacy config reached through a link at .claude moves nothing outside the project', (t) => {
  const sb = sandbox(t);
  write(path.join(sb.victim, '.coaltipple.json'), VICTIM_BYTES);
  if (!linkOrSkip(t, sb, sb.victim, path.join(sb.proj, '.claude'), 'dir')) return;
  const before = snap(sb.victim);
  assertRefused(install(sb, '--reset'), sb, before, 'install --reset (legacy through .claude)');
});

// ---------- class: a state-folder WRITE (the conductor copy under <root>/.claude/.coaltipple/hooks) ----------
test('STATE: a PATH install through a link AT .claude/.coaltipple copies the conductor nowhere outside the project', (t) => {
  const sb = sandbox(t);
  write(path.join(sb.victim, 'placeholder.txt'), VICTIM_BYTES);
  if (!linkOrSkip(t, sb, sb.victim, path.join(sb.proj, '.claude', '.coaltipple'), 'dir')) return;
  const before = snap(sb.victim);
  assertRefused(install(sb, path.join(sb.proj, 'skills')), sb, before, 'install <path>');
});
test('STATE: a PATH install through a link AT .claude/.coaltipple/hooks copies the conductor nowhere outside the project', (t) => {
  const sb = sandbox(t);
  write(path.join(sb.victim, 'placeholder.txt'), VICTIM_BYTES);
  fs.mkdirSync(path.join(sb.proj, '.claude', '.coaltipple'), { recursive: true });
  if (!linkOrSkip(t, sb, sb.victim, path.join(sb.proj, '.claude', '.coaltipple', 'hooks'), 'dir')) return;
  const before = snap(sb.victim);
  assertRefused(install(sb, path.join(sb.proj, 'skills')), sb, before, 'install <path>');
});
test('STATE: a PATH install through a file symlink AT the conductor copy overwrites nothing outside the project', (t) => {
  const sb = sandbox(t);
  write(path.join(sb.victim, 'outside.js'), VICTIM_BYTES);
  if (!linkOrSkip(t, sb, path.join(sb.victim, 'outside.js'), path.join(sb.proj, '.claude', '.coaltipple', 'hooks', 'coaltipple-conductor.js'), 'file')) return;
  const before = snap(sb.victim);
  assertRefused(install(sb, path.join(sb.proj, 'skills')), sb, before, 'install <path>');
});
test('CONTROL state: with no link, a PATH install copies the conductor under the project state folder', (t) => {
  const sb = sandbox(t);
  const r = install(sb, path.join(sb.proj, 'skills'));
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.ok(fs.existsSync(path.join(sb.proj, '.claude', '.coaltipple', 'hooks', 'coaltipple-conductor.js')));
});
