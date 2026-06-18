// CoalTipple config cascade — the 2-level merge that every config reader uses.
//
//   GLOBAL  = <home>/.claude/.coaltipple.json   the user's defaults for ALL projects
//   PROJECT = <cwd>/.claude/.coaltipple.json     optional per-project OVERRIDE
//
// Precedence (shallow, per-key): PROJECT value > GLOBAL value > schema default.
// A project file is created ONLY when the user customizes per-project (no-clutter):
// absent project file = the global defaults (and schema defaults) apply unchanged.
//
// State dirs (NOT part of the config merge):
//   GLOBAL  <home>/.claude/.coaltipple/  the model RANKING (platform-level, shared)
//   PROJECT <cwd>/.claude/.coaltipple/   per-project work-state (proposed/, state.json)
// Everything CoalTipple writes lives UNDER .claude/, mirroring CoalMine's layout:
// global under ~/.claude, project under <project>/.claude, nothing loose at the root.
//
// Pure + node built-ins only (fs, path, os). Every read is wrapped so a missing or
// corrupt file NEVER throws — it contributes nothing and the merge proceeds with
// whatever else loaded. Both files are JSONC (// and /* */ comments + a leading BOM
// are tolerated, matching the conductor's and configure's existing parser).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { stripJsonc } from './jsonc.mjs';

// Read one JSONC file into an object. Returns {} for any failure mode
// (missing file, unreadable, malformed JSON, non-object top-level) — never throws.
function readJsonc(file) {
  try {
    let content = fs.readFileSync(file, 'utf8');
    if (content.charCodeAt(0) === 0xfeff) content = content.slice(1); // BOM-safe
    const parsed = JSON.parse(stripJsonc(content));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// The canonical paths, exported so other readers (configure/install/conductor) agree.
// Everything lives under .claude/ — global at ~/.claude, project at <cwd>/.claude.
export function globalConfigPath(home = os.homedir()) {
  return path.join(home, '.claude', '.coaltipple.json');
}
export function projectConfigPath(cwd = process.cwd()) {
  return path.join(cwd, '.claude', '.coaltipple.json');
}
// State dirs — hold the ranking / work-state, NOT config. The GLOBAL state dir holds
// the shared platform model-ranking; the PROJECT state dir holds per-project
// work-state (proposed/, state.json) and the optional project conductor copy.
export function globalStateDir(home = os.homedir()) {
  return path.join(home, '.claude', '.coaltipple');
}
export function projectStateDir(cwd = process.cwd()) {
  return path.join(cwd, '.claude', '.coaltipple');
}

// Load + merge the cascade. Shallow per-key: project keys overwrite global keys;
// keys absent from both are simply absent (the schema default applies downstream).
// Returns {} when neither file exists.
export function loadMergedConfig({ cwd = process.cwd(), home = os.homedir() } = {}) {
  const global = readJsonc(globalConfigPath(home));
  const project = readJsonc(projectConfigPath(cwd));
  return { ...global, ...project };
}
