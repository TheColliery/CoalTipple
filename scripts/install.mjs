#!/usr/bin/env node
// CoalTipple installer — copy the coaltipple skill into a target agent's skills
// dir, seed the factory .coaltipple.json (under .claude/) and the shared model
// ranking, and copy the conductor hook. The SKILL.md is self-sufficient (it
// self-heals the ranking and self-activates), so the conductor hook is an
// OPTIMIZATION, not a requirement. Cross-platform. Run from YOUR project root.
//   node scripts/install.mjs all            -> every agent configured in this repo
//   node scripts/install.mjs claude         -> ~/.claude/skills/   (GLOBAL: seeds the global config + ranking)
//   node scripts/install.mjs --global        -> seed only the global config + ranking (no skill copy)
//   node scripts/install.mjs <agent|PATH>
//   node scripts/install.mjs --uninstall <agent|PATH>
//   node scripts/install.mjs --reset        -> restore factory config (--global also resets the shared ranking)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGETS, ACTUATING, detectPresentAgents } from './lib/targets.mjs';
import { loadInstallRecord, saveInstallRecord, folderHashes, sameHashes } from './lib/install-record.mjs';
import { readConfigBounded } from './lib/config-bound.mjs';
import { buildFloorRanking, writeRankingAtomic, loadRanking } from './lib/classify.mjs';
import { globalConfigPath, projectConfigPath, projectWriteTarget, moveLegacyAside, writeConfigAtomic, containedProjectPath, globalStateDir, oldGlobalStateDir, projectStateDir, findGitRoot } from './lib/config-load.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillSrc = path.join(repo, 'skills', 'coaltipple');
const conductorSrc = path.join(repo, 'hooks', 'coaltipple-conductor.js');
const factoryCfg = path.join(repo, 'platform-configs', '.coaltipple.json');
const claudeGlobalDir = path.join(os.homedir(), '.claude'); // the global skills dir's parent

function cpDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) cpDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// Is physical path `p` the same as or nested inside physical path `base`? Both args must
// ALREADY be physicalized (realpath'd) — the self-target guard below realpaths both sides
// first, because a lexical compare misses a self-target reached through a symlink (macOS
// /var -> /private/var tmpdirs, a symlinked repo or home) and lets an install/uninstall
// silently DELETE the source.
function within(p, base) {
  const rel = path.relative(base, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// PHYSICAL form of a path that may not exist yet (install has not created <dest>/coaltipple):
// realpath the deepest EXISTING ancestor, then reattach the missing tail. path.resolve
// collapses any `..` lexically first; the existing part resolves through every symlink — so a
// symlinked tmpdir/home/repo (and a `..`-carrying derivation) surfaces at its REAL location for
// the containment compare. null = nothing on the path resolves -> caller fails closed (refuse).
// Series idiom (CoalWash class-b.mjs physicalForCreate).
function physicalForCreate(p) {
  let cur = path.resolve(p);
  const tail = []; // ponytail: local, never escapes
  for (;;) {
    try {
      const phys = fs.realpathSync(cur);
      return tail.length ? path.join(phys, ...tail.reverse()) : phys;
    } catch { /* not created yet — walk up to the deepest existing ancestor */ }
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    tail.push(path.basename(cur));
    cur = parent;
  }
}

// ─── Skill folder ownership (29ah) ───────────────────────────────────────────
// The installer writes or removes `<dest>/coaltipple` only when it can prove CoalTipple installed it. The proof is the install record
// (lib/install-record.mjs), keyed by the target's real path: the folder is ours when its files are exactly the recorded files with the
// recorded hashes (record). A target with no record entry at all adopts a folder whose files are byte-equal to the shipped source
// (adopt), but only to INSTALL over it: identical bytes change nothing when written again. A DELETE never adopts: two byte-equal copies
// cannot say whose they are, and a project may keep its own copy. An absent or empty folder has nothing to protect. Everything else is
// KEPT: never removed or overwritten, one [kept] line says why, exit 1. Only the record and the byte match authorize anything: a manifest
// or marker planted inside the folder does not.
// Divergence from CoalMine 3.25.1: CoalTipple ships one skill folder, copied verbatim, so the shipped hashes are the source folder's own
// (no rendered shared sections, no retired names, no orphan sweep beyond the record, no project manifest), because there is nothing to render.
// Divergence from CoalMine 3.25.1: the record lives under the user's home (`~/.claude/coal/coaltipple/`), as CoalMine's does, and is
// written through writeConfigAtomic, because a cloned repository cannot write there and a link at the record is replaced, not followed.
const SKILL = 'coaltipple';
function keepMessage(p, reason) {
  return `  [kept] ${p}: not removed or overwritten, because ${reason}. CoalTipple cannot prove it installed this folder. Remove the whole folder, or move the whole folder aside, then re-run; an absent folder is installed fresh.`;
}
const lexists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };

// Before a delete or an overwrite: the folder is a real directory, not a link, and its parent is the target itself (CWK-137).
function containedDirWhy(p, dest) {
  let st;
  try { st = fs.lstatSync(p); } catch { return 'it could not be read'; }
  if (st.isSymbolicLink() || !st.isDirectory()) return 'it is a link or a file';
  let destReal;
  try { destReal = fs.realpathSync.native(dest); } catch { return 'the target could not be resolved'; }
  let parent;
  try { parent = fs.realpathSync.native(path.dirname(p)); } catch { return 'its parent could not be resolved'; }
  return parent === destReal ? null : 'its parent is not the target folder';
}

let shippedMemo;
function shippedHashes() { if (shippedMemo === undefined) shippedMemo = folderHashes(skillSrc); return shippedMemo; }

function pluginVersion() {
  try { return JSON.parse(readConfigBounded(path.join(repo, '.claude-plugin', 'plugin.json'))).version; } catch { return 'unknown'; }
}

const isRecordEntry = (e) => e !== null && typeof e === 'object' && e.skills !== null && typeof e.skills === 'object' && !Array.isArray(e.skills);
let newerNoted = false;
// This target's record, read once per call. `key` is the target's real path, null while the folder does not exist yet.
// A record this CoalTipple cannot use (newer, or unreadable) gives the target no entry: the folder is judged by its contents.
function targetRecord(dest) {
  const loaded = loadInstallRecord(os.homedir());
  if (loaded.state === 'newer' && !newerNoted) {
    newerNoted = true;
    console.warn('  [CoalTipple] the install record was written by a newer CoalTipple and was left alone; this run judges the folder by its contents and does not record what it installs.');
  }
  let key = null;
  try { key = fs.realpathSync.native(dest); } catch { /* not created yet: nothing is recorded for it */ }
  const raw = loaded.state === 'ok' && key !== null && Object.hasOwn(loaded.record.targets, key) ? loaded.record.targets[key] : undefined;
  return { state: loaded.state, record: loaded.record, key, entry: isRecordEntry(raw) ? raw : undefined };
}

// The verdict for `<dest>/coaltipple`: { owned: true, via } or { owned: false, reason }. `entry` is this target's record entry, or
// undefined when the target has none. `purpose` is 'install' or 'delete': a byte match authorizes an install only, never a delete.
function ownership(dest, entry, purpose) {
  const p = path.join(dest, SKILL);
  let st;
  try { st = fs.lstatSync(p); }
  catch (e) { return e && e.code === 'ENOENT' ? { owned: true, via: 'absent' } : { owned: false, reason: 'it could not be read' }; }
  if (st.isSymbolicLink() || !st.isDirectory()) return { owned: false, reason: 'it is a link or a file, not a folder CoalTipple wrote' };
  let entries;
  try { entries = fs.readdirSync(p); }
  catch { return { owned: false, reason: 'it could not be read' }; }
  if (entries.length === 0) return { owned: true, via: 'empty' };
  const have = folderHashes(p);
  if (have === null) return { owned: false, reason: 'it holds a link, a non-file, or a file that could not be read' };
  if (entry && Object.hasOwn(entry.skills, SKILL)) {
    return sameHashes(have, entry.skills[SKILL]) ? { owned: true, via: 'record' } : { owned: false, reason: 'its contents differ from what CoalTipple recorded' };
  }
  if (!entry && sameHashes(have, shippedHashes())) {
    if (purpose === 'install') return { owned: true, via: 'adopt' };
    // identical bytes do not show whose copy this is, so they never authorize a delete
    return { owned: false, reason: 'the record does not name it, and identical bytes do not show whose copy it is' };
  }
  return { owned: false, reason: 'the record does not name it, and its contents are not the shipped files' };
}

// Writes this target's entry after the run. A run that installed the folder records the hashes it now has. A run that KEPT the folder
// keeps the hashes the record already named for it: a recomputed hash would bless the very edit that made the run keep it. A newer
// record is left alone.
function recordInstall(dest, installed, tr) {
  if (tr.state === 'newer') return;
  let key;
  try { key = fs.realpathSync.native(dest); } catch { return; }
  const skills = {};
  if (installed) { const h = folderHashes(path.join(dest, SKILL)); if (h) skills[SKILL] = h; }
  else if (tr.entry && Object.hasOwn(tr.entry.skills, SKILL) && lexists(path.join(dest, SKILL))) skills[SKILL] = tr.entry.skills[SKILL];
  const next = tr.record;
  if (!Object.keys(skills).length && !Object.hasOwn(next.targets, key)) return; // nothing recorded, nothing to change
  if (Object.keys(skills).length) next.targets[key] = { version: installed || !tr.entry ? pluginVersion() : tr.entry.version, skills };
  else delete next.targets[key];
  try { saveInstallRecord(os.homedir(), next); }
  catch (e) { console.warn(`  [warn] could not write the install record: ${e.message}`); process.exitCode = 1; }
}

function installSkill(dest) {
  const to = path.join(dest, 'coaltipple');
  // 29ah: the verdict comes first. A folder CoalTipple cannot prove it wrote is kept, named, and left alone; the run exits 1 and no other step is skipped.
  const tr = targetRecord(dest);
  const v = ownership(dest, tr.entry, 'install');
  let refusal = v.owned ? null : v.reason;
  if (refusal === null && v.via !== 'absent') { const why = containedDirWhy(to, dest); if (why) refusal = `it could not be removed safely (${why})`; }
  if (refusal !== null) { console.warn(keepMessage(to, refusal)); process.exitCode = 1; recordInstall(dest, false, tr); return; }
  // Stage into a temp sibling then atomically swap, so an interrupt / disk-full during the
  // copy can never destroy an existing install (the old delete-then-write had NO rollback: a
  // crash mid-copy left a corrupt, backup-less target). The new copy is built BEFORE the old
  // install is moved aside; a swap failure restores the old install; the source is never the
  // delete target. Same "temp sibling + atomic rename" idiom as the conductor's update stamp.
  // pid-less names are swept at the top of every run so a crashed run self-heals (Phoenix #1).
  // Divergence from CoalMine 3.25.1: the staging names are fixed (`.new`, `.bak`), not pid-marked, because the sweep below already clears
  // a killed run's leftovers on every run, so a pid in the name would add nothing.
  const staging = `${to}.new`;
  const backup = `${to}.bak`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.rmSync(backup, { recursive: true, force: true });
  let movedAside = false;
  try {
    cpDir(skillSrc, staging);                                    // 1. build the new copy (source untouched)
    if (fs.existsSync(to)) { fs.renameSync(to, backup); movedAside = true; } // 2. old install aside (atomic)
    try {
      fs.renameSync(staging, to);                               // 3. swap in the new copy (atomic)
    } catch (e) {
      if (movedAside) { fs.renameSync(backup, to); } // rollback: restore the old install
      throw e;
    }
    if (movedAside) { fs.rmSync(backup, { recursive: true, force: true }); } // 4. drop old
    console.log(`  installed skill -> ${to}`);
    recordInstall(dest, true, tr);
  } finally {
    // Never leave staging behind (Phoenix #1). NEVER touch backup here — if a rollback itself
    // failed, backup still holds the only copy of the old install; recovery owns it, not cleanup.
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

// The factory template carries repo-build machinery in its keywords section (the keyword-sync
// markers + a "GENERATED from keywords.mjs ... by build-plugin.mjs" note) that is meaningless in
// an installed copy (a user, especially a plugin install, has no scripts/). Strip those lines so
// the installed config is clean populated factory defaults with no dev-machine references
// (generalize-shipped); the populated keyword VALUE itself stays.
function writeFactoryConfig(dest) {
  const cleaned = fs.readFileSync(factoryCfg, 'utf8')
    .split('\n')
    .filter((l) => !l.includes('coaltipple-shared:') && !l.includes('GENERATED from keywords.mjs'))
    .join('\n');
  writeConfigAtomic(dest, cleaned); // temp sibling + rename (node/runtime.md section 5): a link AT dest is replaced, never written through
}

// GLOBAL config seeding — ~/.claude/.coaltipple.json (the user's defaults for ALL
// projects), create-if-absent; --reset forces it back to factory. Never creates a
// project file (no-clutter) — per-project overrides come from configure.mjs --project.
function seedGlobalConfig(force = false) {
  try {
    const dest = globalConfigPath();
    fs.mkdirSync(path.dirname(dest), { recursive: true }); // ensure ~/.claude exists
    if (force || !fs.existsSync(dest)) {
      writeFactoryConfig(dest);
      console.log(`  ${force ? 'RESET global settings to factory' : 'created global default settings'} -> ${dest}`);
    } else console.log(`  global settings PRESERVED (yours, untouched) -> ${dest}`);
  } catch (e) { console.warn(`  [warn] global settings: ${e.message}`); process.exitCode = 1; }
}

// GLOBAL ranking seeding — ~/.claude/.coaltipple/ranking.json. The model ranking is
// platform-level (the same models across every project), so it lives ONCE globally
// and is shared; any install ensures it exists. Create-if-absent (it self-heals via
// the validity gate on a model-list change); --reset --global re-seeds the floor.
// Namespace campaign (#69+#39 part 2): the shared ranking home moved under coal/.
// A pre-campaign ranking.json at the OLD location is MIGRATED (parsed + rewritten
// through the same atomic-write path, not byte-copied) rather than left stranded,
// so an existing user's ranking isn't silently re-seeded from the floor. --reset
// (force) also best-effort drops any old-location file, so a reset doesn't leave a
// stale old-format copy sitting around.
// Best-effort: drop an old-location file, then the dir itself if that leaves it
// empty. Non-recursive rmSync on the dir throws ENOTEMPTY (silently swallowed) if
// anything else is in there -- never force-recurse a dir that might hold unrelated
// content (INSPECT Finding 4, 2026-08-08).
function dropOldRankingFileAndDir(oldRankingPath) {
  try { fs.rmSync(oldRankingPath, { force: true }); } catch {}
  try { fs.rmSync(oldGlobalStateDir(), { recursive: false, force: true }); } catch {}
}

function seedGlobalRanking(force = false) {
  try {
    const stateDir = globalStateDir();
    const rankingPath = path.join(stateDir, 'ranking.json');
    const oldRankingPath = path.join(oldGlobalStateDir(), 'ranking.json');
    if (!force && !fs.existsSync(rankingPath) && fs.existsSync(oldRankingPath)) {
      const old = loadRanking(oldGlobalStateDir());
      if (old.ok) {
        writeRankingAtomic(stateDir, old.ranking);
        dropOldRankingFileAndDir(oldRankingPath);
        console.log(`  migrated ranking from old location -> ${rankingPath}`);
        return;
      }
      // old location unreadable/corrupt -- never worth preserving, drop it the
      // same way a successfully-migrated one gets dropped, then fall through to
      // fresh-seed below (Finding 4: previously stranded forever, since the
      // migration branch above never runs again once rankingPath exists).
      dropOldRankingFileAndDir(oldRankingPath);
    }
    if (force || !fs.existsSync(rankingPath)) {
      const ranking = buildFloorRanking([]);
      ranking.source = 'install-floor';
      writeRankingAtomic(stateDir, ranking);
      if (force) dropOldRankingFileAndDir(oldRankingPath);
      console.log(`  ${force ? 'RESET ranking to floor' : 'seeded shared floor ranking'} -> ${rankingPath}`);
    } else console.log(`  ranking PRESERVED (self-heals, shared) -> ${rankingPath}`);
  } catch (e) { console.warn(`  [warn] ranking seed: ${e.message}`); process.exitCode = 1; }
}

// E2-4 class (14a, hooks-safety.md section 10): the project's own folders arrive with a CLONED repo, so a link (junction/symlink) anywhere between the
// project root and a path below could send a write OUTSIDE the project. Every project-side path is checked by containedProjectPath BEFORE anything is created,
// renamed or written; a refused path writes nothing, is named on stderr, and the run exits non-zero.
function refuseLinked(what, p) {
  console.error(`  [refused] ${what} ${p}: it, or a folder above it inside the project, is a link/junction (or cannot be resolved), so a write there could land outside the project. Nothing was written to it. Replace the link with a real folder to proceed.`);
  process.exitCode = 1;
}
// PROJECT files (a non-global install) — all under <cwd>/.claude:
//   .claude/coal/coaltipple.json    per-project config override (create-if-absent; a config
//                                   already found anywhere on the read walk is kept)
//   .claude/.coaltipple/hooks/...   the conductor copy (CODE -> always refreshed)
// The ranking is NOT here (it is global + shared). CONFIG PRESERVATION: the config is
// created only when ABSENT; the ONLY overwrite is the explicit --reset.
// `projectRoot` defaults to the invoker's cwd (a named-agent target's skills dir IS
// under cwd, so its project files belong at <cwd>/.claude). A bare PATH target passes
// the target's inferred root explicitly so the config/conductor land WITH the skill,
// not silently in the invoker's cwd.
function seedProjectFiles(force = false, projectRoot = process.cwd()) {
  try {
    // A READ may resolve to a LEGACY path, so create-if-absent keeps whatever the walk found
    // (untouched). A WRITE (--reset) must never land on one: UMB-133 made <gitroot>/.coaltipple.json
    // a candidate, and projectConfigPath then handed --reset the deprecated path to overwrite.
    // --reset resolves to the canonical target (the same rule configure --project migrates to).
    const wt = force ? projectWriteTarget(projectRoot) : null;
    const dest = force ? wt.target : projectConfigPath(projectRoot);
    const touched = force ? [wt.target, wt.legacyToRemove, ...wt.legacyAlso].filter(Boolean) : [];
    const refused = dest === null ? [projectWriteTarget(projectRoot).target] : touched.filter((p) => containedProjectPath(projectRoot, p) === null);
    if (refused.length) { for (const p of refused) refuseLinked('settings', p); return seedConductorCopy(projectRoot); }
    fs.mkdirSync(path.dirname(dest), { recursive: true }); // ensure <root>/.claude exists
    if (containedProjectPath(projectRoot, dest) === null) { refuseLinked('settings', dest); return seedConductorCopy(projectRoot); } // re-check after the mkdir: nothing swapped in under us
    if (force || !fs.existsSync(dest)) {
      writeFactoryConfig(dest);
      console.log(`  ${force ? 'RESET settings to factory' : 'created default settings'} -> ${dest}`);
    } else console.log(`  settings PRESERVED (yours, untouched) -> ${dest}`);
    if (force) {
      // The factory config now shadows every legacy file. None was read this run, so none is
      // deleted: each is moved aside (contents kept) and named.
      for (const legacy of [wt.legacyToRemove, ...wt.legacyAlso]) {
        if (!legacy) continue;
        try { console.log(`  moved deprecated ${legacy} -> ${moveLegacyAside(legacy)} (contents kept; it is no longer a config path)`); }
        catch (e) { console.warn(`  [warn] could not retire legacy ${legacy}: ${e.message}`); }
      }
    }
  } catch (e) { console.warn(`  [warn] settings: ${e.message}`); process.exitCode = 1; }
  seedConductorCopy(projectRoot);
}
// conductor hook = CODE -> always refreshed so an update ships the new hook. The destination is inside the project's state folder
// (<root>/.claude/.coaltipple/hooks), so it is checked BEFORE the mkdir and again after it, and written temp + rename (a link at the file is replaced, not followed).
function seedConductorCopy(projectRoot) {
  try {
    const hookDir = path.join(projectStateDir(projectRoot), 'hooks');
    const hookFile = path.join(hookDir, 'coaltipple-conductor.js');
    if (containedProjectPath(projectRoot, hookFile) === null) { refuseLinked('conductor copy', hookFile); return; }
    fs.mkdirSync(hookDir, { recursive: true });
    if (containedProjectPath(projectRoot, hookFile) === null) { refuseLinked('conductor copy', hookFile); return; }
    writeConfigAtomic(hookFile, fs.readFileSync(conductorSrc));
    console.log(`  refreshed conductor -> ${hookFile}`);
  } catch (e) { console.warn(`  [warn] conductor: ${e.message}`); process.exitCode = 1; }
}

// Infer the project root for a bare PATH target so project files land WITH the skill
// (not in the invoker's cwd). The skill installs into `<dest>/coaltipple`, so `dest`
// is the agent's skills dir; walk up from it for a `.git` root, else use the skills
// dir's PARENT (the agent config home, e.g. `<root>/.cursor` -> root `<root>`). A
// named-agent target keeps the cwd default (its skills dir already sits under cwd).
function pathTargetRoot(dest) {
  const gitRoot = findGitRoot(dest);
  return fs.existsSync(path.join(gitRoot, '.git')) ? gitRoot : path.dirname(dest);
}

// 29ah: the folder goes only on a verdict that proves it ours (a record, or an empty folder); a byte match never authorizes a delete.
// Afterwards this target's record drops `coaltipple` once the folder is gone, and the entry once it names nothing. A newer record is untouched.
function uninstall(dest) {
  const tr = targetRecord(dest);
  const to = path.join(dest, SKILL);
  const v = ownership(dest, tr.entry, 'delete');
  let refusal = v.owned ? null : v.reason;
  if (refusal === null && v.via !== 'absent') { const why = containedDirWhy(to, dest); if (why) refusal = `it could not be removed safely (${why})`; }
  if (refusal !== null) { console.warn(keepMessage(to, refusal)); process.exitCode = 1; }
  else if (v.via !== 'absent') {
    try { fs.rmSync(to, { recursive: true, force: true }); console.log(`  removed skill from ${dest}`); }
    catch (e) { console.warn(keepMessage(to, `it could not be removed safely (${e.message})`)); process.exitCode = 1; }
  }
  if (tr.state === 'ok' && tr.key !== null && tr.entry && !lexists(to)) {
    delete tr.entry.skills[SKILL];
    if (Object.keys(tr.entry.skills).length === 0) delete tr.record.targets[tr.key];
    try { saveInstallRecord(os.homedir(), tr.record); }
    catch (e) { console.warn(`  [warn] could not write the install record: ${e.message}`); process.exitCode = 1; }
  }
}

// ─── Main ───
const args = process.argv.slice(2);
const isReset = args.includes('--reset');
const isGlobalFlag = args.includes('--global') || args.includes('-g');
const isUninstall = args.includes('--uninstall') || args.includes('-u');
const targetArg = args.filter((x) => !['--uninstall', '-u', '--reset', '--global', '-g'].includes(x))[0];

// Is this a GLOBAL install (seed the global config, not a project one)? True for the
// explicit --global flag, the `claude` target name, or any dest under ~/.claude.
const isGlobalDest = (dest) => {
  const rel = path.relative(claudeGlobalDir, path.resolve(dest));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};
function isGlobalInstall(key, dest) {
  return isGlobalFlag || key === 'claude' || isGlobalDest(dest);
}

// The explicit reset — the ONLY action that overwrites a user's config/ranking.
// Project-scoped by default (project config); --global resets the global config + shared ranking.
if (isReset) {
  if (isGlobalFlag) {
    console.log(`\nCoalTipple --reset --global: restoring the factory global config + shared ranking`);
    console.log(`  OVERWRITES ${globalConfigPath()} and ${path.join(globalStateDir(), 'ranking.json')}.`);
    seedGlobalConfig(true);
    seedGlobalRanking(true);
  } else {
    console.log('\nCoalTipple --reset: restoring the factory project config');
    console.log(`  OVERWRITES ${projectWriteTarget(process.cwd()).target}. (The shared ranking is global — reset it with --reset --global. Skill files untouched.)`);
    seedProjectFiles(true);
  }
  console.log(process.exitCode ? '\nReset NOT completed (see the lines above).' : '\nReset done.');
  process.exit(process.exitCode || 0);
}

// --global with no skill target -> seed only the global config + ranking (no skill copy).
if (isGlobalFlag && !targetArg) {
  console.log(`\nCoalTipple --global: seeding the global default config + shared ranking`);
  seedGlobalConfig();
  seedGlobalRanking();
  console.log(`\nDone. Per-project overrides: node scripts/configure.mjs --project ...`);
  process.exit(process.exitCode || 0);
}

if (!targetArg) {
  console.error(`Usage: node scripts/install.mjs [--uninstall|--reset|--global] <${Object.keys(TARGETS).join('|')}|all|PATH>`);
  process.exit(2);
}
const key = targetArg.toLowerCase();

if (!fs.existsSync(skillSrc)) { console.error(`No skill at ${skillSrc}`); process.exit(1); }

if (key === 'all') {
  if (isUninstall) { console.error("Uninstall does not support 'all' — name the agent explicitly."); process.exit(2); }
  const { present, absent } = detectPresentAgents(process.cwd());
  if (!present.length) {
    // CoalTipple routes only where the agent's spawn tool takes a worker model + effort (targets.mjs ACTUATING): today Claude Code alone, which `all` never auto-detects (its install is the plugin).
    console.log(`\nCoalTipple 'all': nothing to install. Routing actuates only on an agent whose spawn tool takes a worker model and effort; today that is Claude Code alone, and its install is the plugin: claude plugin install coaltipple@coaltipple (from a source checkout: node scripts/install.mjs claude).`);
    console.log(`  Another agent can still be named explicitly (node scripts/install.mjs <${Object.keys(TARGETS).filter((k) => !ACTUATING.has(k)).join('|')}>); the files copy, routing does not actuate there.`);
    process.exit(0);
  }
  console.log(`\nCoalTipple 'all' — detected: ${present.join(', ')}${absent.length ? `  ·  skipped: ${absent.join(', ')}` : ''}`);
  const seen = new Set();
  for (const a of present) { const d = TARGETS[a]; if (!seen.has(d)) { seen.add(d); installSkill(d); } }
  console.log('\nSeeding shared ranking + project files...');
  seedGlobalRanking();
  seedProjectFiles();
  console.log(`\nDone: ${present.length} agent(s) -> ${seen.size} dir(s). Verify: node scripts/verify.mjs`);
  process.exit(process.exitCode || 0);
}

const dest = TARGETS[key] ?? path.resolve(targetArg);
// Guard the ACTUAL mutation target — `<dest>/coaltipple`, which installSkill wipes+writes
// and uninstall removes — NOT `dest`. The old `dest === skillSrc` check was one level too
// shallow: `install.mjs <repo>/skills` makes `<dest>/coaltipple` == the source skill and
// sailed straight past it, silently deleting the source. Reject any overlap either direction
// (source inside target OR target inside source), covering install AND uninstall.
// Compare PHYSICAL paths (realpath both sides, fail closed if either is unresolvable):
// skillSrc comes from a realpath'd import.meta.url but dest comes from a lexical resolve of
// argv, so on a symlinked path (macOS /var -> /private/var, a symlinked repo/home) a self-
// target compared lexically looks DIFFERENT and evades the guard — a live source-wipe hole.
const mutTarget = path.join(dest, 'coaltipple');
const physTarget = physicalForCreate(mutTarget); // may not exist yet -> deepest-ancestor realpath
const physSrc = physicalForCreate(skillSrc);     // exists (checked above), symlink-normalize it too
if (!physTarget || !physSrc || within(physTarget, physSrc) || within(physSrc, physTarget)) {
  console.error(`Target ${mutTarget} overlaps the source skill dir ${skillSrc} — refusing (would delete the source).`);
  process.exit(1);
}

if (isUninstall) {
  console.log(`\nUninstalling CoalTipple from: ${targetArg}`);
  uninstall(dest);
  console.log('\nDone.');
  process.exit(process.exitCode || 0);
}

// An explicitly named agent that cannot actuate routing still installs (the transitional behaviour), but says so once, on stderr.
if (key in TARGETS && !ACTUATING.has(key)) {
  console.error(`WARNING: CoalTipple cannot actuate routing on ${key}: its spawn tool does not take a same-vendor worker model and effort, so the installed files will not route. The Claude Code install is the plugin: claude plugin install coaltipple@coaltipple.`);
}

console.log(`\nInstalling CoalTipple -> ${dest}`);
installSkill(dest);
// GLOBAL install (claude / --global / a ~/.claude dest) seeds the GLOBAL config +
// shared ranking — no project file. A NAMED-AGENT install seeds project files at the
// invoker's cwd (its skills dir is under cwd). A bare PATH install seeds them at the
// TARGET's inferred root, so the config/conductor land with the skill — not silently
// in the invoker's cwd (the PATH-target footgun).
if (isGlobalInstall(key, dest)) {
  console.log('\nSeeding global config + shared ranking...');
  seedGlobalConfig();
  seedGlobalRanking();
  console.log(`\nDone. Per-project overrides: node scripts/configure.mjs --project ...   Verify: node scripts/verify.mjs`);
} else {
  const isNamedAgent = key in TARGETS;
  const projectRoot = isNamedAgent ? process.cwd() : pathTargetRoot(dest);
  console.log('\nSeeding shared ranking + project files...');
  if (!isNamedAgent && path.resolve(projectRoot) !== path.resolve(process.cwd())) {
    console.log(`  PATH target -> project config + conductor anchored at the target root: ${projectRoot}`);
  }
  seedGlobalRanking();
  seedProjectFiles(false, projectRoot);
  console.log(`\nDone. Verify: node scripts/verify.mjs`);
}
