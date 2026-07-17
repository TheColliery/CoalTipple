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
import { TARGETS, detectPresentAgents } from './lib/targets.mjs';
import { buildFloorRanking, writeRankingAtomic } from './lib/classify.mjs';
import { globalConfigPath, projectConfigPath, globalStateDir, projectStateDir, findGitRoot } from './lib/config-load.mjs';

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

// True when `p` is the same path as `base` or nested inside it (lexical resolve-and-
// contain, matching the installer's existing resolve-based guard idiom; the installer
// runs on the user's own box, so the threat is an accidental self-target footgun, not a
// symlink attacker).
function within(p, base) {
  const rel = path.relative(path.resolve(base), path.resolve(p));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function installSkill(dest) {
  const to = path.join(dest, 'coaltipple');
  // Stage into a temp sibling then atomically swap, so an interrupt / disk-full during the
  // copy can never destroy an existing install (the old delete-then-write had NO rollback: a
  // crash mid-copy left a corrupt, backup-less target). The new copy is built BEFORE the old
  // install is moved aside; a swap failure restores the old install; the source is never the
  // delete target. Same "temp sibling + atomic rename" idiom as the conductor's update stamp.
  // pid-less names are swept at the top of every run so a crashed run self-heals (Phoenix #1).
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
      if (movedAside) { fs.renameSync(backup, to); movedAside = false; } // rollback: restore the old install
      throw e;
    }
    if (movedAside) { fs.rmSync(backup, { recursive: true, force: true }); movedAside = false; } // 4. drop old
    console.log(`  installed skill -> ${to}`);
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
  fs.writeFileSync(dest, cleaned);
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
function seedGlobalRanking(force = false) {
  try {
    const stateDir = globalStateDir();
    const rankingPath = path.join(stateDir, 'ranking.json');
    if (force || !fs.existsSync(rankingPath)) {
      const ranking = buildFloorRanking([]);
      ranking.source = 'install-floor';
      writeRankingAtomic(stateDir, ranking);
      console.log(`  ${force ? 'RESET ranking to floor' : 'seeded shared floor ranking'} -> ${rankingPath}`);
    } else console.log(`  ranking PRESERVED (self-heals, shared) -> ${rankingPath}`);
  } catch (e) { console.warn(`  [warn] ranking seed: ${e.message}`); process.exitCode = 1; }
}

// PROJECT files (a non-global install) — all under <cwd>/.claude:
//   .claude/.coaltipple.json        per-project config override (create-if-absent)
//   .claude/.coaltipple/hooks/...   the conductor copy (CODE -> always refreshed)
// The ranking is NOT here (it is global + shared). CONFIG PRESERVATION: the config is
// created only when ABSENT; the ONLY overwrite is the explicit --reset.
// `projectRoot` defaults to the invoker's cwd (a named-agent target's skills dir IS
// under cwd, so its project files belong at <cwd>/.claude). A bare PATH target passes
// the target's inferred root explicitly so the config/conductor land WITH the skill,
// not silently in the invoker's cwd.
function seedProjectFiles(force = false, projectRoot = process.cwd()) {
  try {
    const dest = projectConfigPath(projectRoot);
    fs.mkdirSync(path.dirname(dest), { recursive: true }); // ensure <root>/.claude exists
    if (force || !fs.existsSync(dest)) {
      writeFactoryConfig(dest);
      console.log(`  ${force ? 'RESET settings to factory' : 'created default settings'} -> ${dest}`);
    } else console.log(`  settings PRESERVED (yours, untouched) -> ${dest}`);
  } catch (e) { console.warn(`  [warn] settings: ${e.message}`); process.exitCode = 1; }
  // conductor hook = CODE -> always refreshed so an update ships the new hook.
  try {
    const hookDir = path.join(projectStateDir(projectRoot), 'hooks');
    fs.mkdirSync(hookDir, { recursive: true });
    fs.copyFileSync(conductorSrc, path.join(hookDir, 'coaltipple-conductor.js'));
    console.log(`  refreshed conductor -> ${path.join(hookDir, 'coaltipple-conductor.js')}`);
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

function uninstall(dest) {
  try { fs.rmSync(path.join(dest, 'coaltipple'), { recursive: true, force: true }); console.log(`  removed skill from ${dest}`); }
  catch (e) { console.warn(`  [warn] ${e.message}`); }
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
    console.log(`\nCoalTipple --reset: restoring the factory project config under ${path.join(process.cwd(), '.claude')}`);
    console.log('  OVERWRITES .claude/.coaltipple.json. (The shared ranking is global — reset it with --reset --global. Skill files untouched.)');
    seedProjectFiles(true);
  }
  console.log('\nReset done.');
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
    console.log(`\nCoalTipple 'all': no agent config dir found under ${process.cwd()}.`);
    console.log(`  Install explicitly: node scripts/install.mjs <${Object.keys(TARGETS).join('|')}|PATH>`);
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
const mutTarget = path.join(dest, 'coaltipple');
if (within(mutTarget, skillSrc) || within(skillSrc, mutTarget)) {
  console.error(`Target ${mutTarget} overlaps the source skill dir ${skillSrc} — refusing (would delete the source).`);
  process.exit(1);
}

if (isUninstall) {
  console.log(`\nUninstalling CoalTipple from: ${targetArg}`);
  uninstall(dest);
  console.log('\nDone.');
  process.exit(0);
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
