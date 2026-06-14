#!/usr/bin/env node
// CoalTipple installer — copy the coaltipple skill into a target agent's skills
// dir, seed the factory .coaltipple.json and a floor model-ranking, and copy the
// conductor hook. The SKILL.md is self-sufficient (it self-heals the ranking and
// self-activates), so the conductor hook is an OPTIMIZATION, not a requirement.
// Cross-platform. Run from YOUR project root (project targets resolve vs cwd).
//   node scripts/install.mjs all            -> every agent configured in this repo
//   node scripts/install.mjs claude         -> ~/.claude/skills/   (GLOBAL: seeds the global config)
//   node scripts/install.mjs --global        -> seed only the global config (no skill copy)
//   node scripts/install.mjs <agent|PATH>
//   node scripts/install.mjs --uninstall <agent|PATH>
//   node scripts/install.mjs --reset        -> restore factory config + ranking (the ONLY overwrite; a user's config is otherwise never touched by install/update)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGETS, detectPresentAgents } from './lib/targets.mjs';
import { buildFloorRanking, writeRankingAtomic } from './lib/classify.mjs';
import { globalConfigPath } from './lib/config-load.mjs';

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

function installSkill(dest) {
  const to = path.join(dest, 'coaltipple');
  fs.rmSync(to, { recursive: true, force: true }); // clean prior install (clean version transition)
  cpDir(skillSrc, to);
  console.log(`  installed skill -> ${to}`);
}

// GLOBAL config seeding — for a global install (the `claude` target / --global).
// Creates ~/.claude/.coaltipple.json (the user's defaults for ALL projects) only
// when ABSENT; preserves an existing one (same hard rule as the project config).
// --reset forces it back to factory. Does NOT create any project file (no-clutter:
// a global install is not bound to one project's cwd) — per-project overrides are
// created on demand via `configure.mjs --project`.
function seedGlobalConfig(force = false) {
  try {
    const dest = globalConfigPath();
    fs.mkdirSync(path.dirname(dest), { recursive: true }); // ensure ~/.claude exists
    if (force || !fs.existsSync(dest)) {
      fs.copyFileSync(factoryCfg, dest);
      console.log(`  ${force ? 'RESET global settings to factory' : 'created global default settings'} -> ${dest}`);
    } else console.log(`  global settings PRESERVED (yours, untouched) -> ${dest}`);
  } catch (e) { console.warn(`  [warn] global settings: ${e.message}`); process.exitCode = 1; }
}

// CONFIG PRESERVATION (the user's hard rule: an update must NEVER clobber a user's
// settings). `.coaltipple.json` and `ranking.json` are created only when ABSENT;
// the ONLY path that overwrites them is the explicit --reset (force=true). The
// conductor hook is CODE, so it is always refreshed (an update should ship it).
function seedProjectFiles(force = false) {
  // 1. factory config — create-if-absent; never overwritten by (re)install. --reset forces it.
  try {
    const dest = path.join(process.cwd(), '.coaltipple.json');
    if (force || !fs.existsSync(dest)) {
      fs.copyFileSync(factoryCfg, dest);
      console.log(`  ${force ? 'RESET settings to factory' : 'created default settings'} -> ${dest}`);
    } else console.log(`  settings PRESERVED (yours, untouched) -> ${dest}`);
  } catch (e) { console.warn(`  [warn] settings: ${e.message}`); process.exitCode = 1; }
  // 2. floor ranking — seed-if-absent; preserved across updates (it self-heals via the
  //    validity gate on a schema/list change). --reset re-seeds the floor.
  try {
    const stateDir = path.join(process.cwd(), '.coaltipple');
    const rankingPath = path.join(stateDir, 'ranking.json');
    if (force || !fs.existsSync(rankingPath)) {
      const ranking = buildFloorRanking([]);
      ranking.source = 'install-floor';
      writeRankingAtomic(stateDir, ranking);
      console.log(`  ${force ? 'RESET ranking to floor' : 'seeded floor ranking'} -> ${rankingPath}`);
    } else console.log(`  ranking PRESERVED (self-heals) -> ${rankingPath}`);
  } catch (e) { console.warn(`  [warn] ranking seed: ${e.message}`); process.exitCode = 1; }
  // 3. conductor hook = CODE -> always refreshed so an update ships the new hook.
  try {
    const hookDir = path.join(process.cwd(), '.coaltipple', 'hooks');
    fs.mkdirSync(hookDir, { recursive: true });
    fs.copyFileSync(conductorSrc, path.join(hookDir, 'coaltipple-conductor.js'));
    console.log(`  refreshed conductor -> ${path.join(hookDir, 'coaltipple-conductor.js')}`);
  } catch (e) { console.warn(`  [warn] conductor: ${e.message}`); process.exitCode = 1; }
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

// The explicit reset — the ONLY action that overwrites a user's config + ranking.
// Project-scoped by default (unchanged); --global resets the global config instead.
if (isReset) {
  if (isGlobalFlag) {
    console.log(`\nCoalTipple --reset --global: restoring the factory global config`);
    console.log(`  OVERWRITES ${globalConfigPath()}.`);
    seedGlobalConfig(true);
  } else {
    console.log(`\nCoalTipple --reset: restoring factory config + floor ranking in ${process.cwd()}`);
    console.log('  OVERWRITES .coaltipple.json + .coaltipple/ranking.json. (Skill files untouched — reinstall separately.)');
    seedProjectFiles(true);
  }
  console.log('\nReset done.');
  process.exit(process.exitCode || 0);
}

// --global with no skill target -> seed only the global config (no skill copy).
if (isGlobalFlag && !targetArg) {
  console.log(`\nCoalTipple --global: seeding the global default config`);
  seedGlobalConfig();
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
  console.log('\nSeeding project files...');
  seedProjectFiles();
  console.log(`\nDone: ${present.length} agent(s) -> ${seen.size} dir(s). Verify: node scripts/verify.mjs`);
  process.exit(process.exitCode || 0);
}

const dest = TARGETS[key] ?? path.resolve(targetArg);
if (path.resolve(dest) === path.resolve(skillSrc)) { console.error('Target cannot be the source skill dir.'); process.exit(1); }

if (isUninstall) {
  console.log(`\nUninstalling CoalTipple from: ${targetArg}`);
  uninstall(dest);
  console.log('\nDone.');
  process.exit(0);
}

console.log(`\nInstalling CoalTipple -> ${dest}`);
installSkill(dest);
// GLOBAL install (claude / --global / a ~/.claude dest) seeds the GLOBAL config only —
// no project .coaltipple.json / ranking / conductor (those are created per-project on
// demand). A PROJECT/PATH install keeps the existing project-scoped seeding.
if (isGlobalInstall(key, dest)) {
  console.log('\nSeeding global config...');
  seedGlobalConfig();
  console.log(`\nDone. Per-project overrides: node scripts/configure.mjs --project ...   Verify: node scripts/verify.mjs`);
} else {
  console.log('\nSeeding project files...');
  seedProjectFiles();
  console.log(`\nDone. Verify: node scripts/verify.mjs`);
}
