// CoalTipple config cascade — the 2-level merge that every config reader uses.
//
//   GLOBAL  = <home>/.claude/.coaltipple.json   the user's defaults for ALL projects
//   PROJECT = <cwd>/.coaltipple.json             optional per-project OVERRIDE
//
// Precedence (shallow, per-key): PROJECT value > GLOBAL value > schema default.
// A project file is created ONLY when the user customizes per-project (no-clutter):
// absent project file = the global defaults (and schema defaults) apply unchanged.
// The PROJECT-scoped state dir (.coaltipple/) is deliberately NOT part of this — it
// stays project-local (ranking.json, proposed/, state.json).
//
// Pure + node built-ins only (fs, path, os). Every read is wrapped so a missing or
// corrupt file NEVER throws — it contributes nothing and the merge proceeds with
// whatever else loaded. Both files are JSONC (// and /* */ comments + a leading BOM
// are tolerated, matching the conductor's and configure's existing parser).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Strip // and /* */ comments without eating them inside string literals.
// (Same string-aware regex the conductor + configure + verify already use.)
function stripComments(content) {
  return content.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => (g ? '' : m));
}

// Read one JSONC file into an object. Returns {} for any failure mode
// (missing file, unreadable, malformed JSON, non-object top-level) — never throws.
function readJsonc(file) {
  try {
    let content = fs.readFileSync(file, 'utf8');
    if (content.charCodeAt(0) === 0xfeff) content = content.slice(1); // BOM-safe
    const parsed = JSON.parse(stripComments(content));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// The canonical paths, exported so other readers (configure/install) agree on them.
export function globalConfigPath(home = os.homedir()) {
  return path.join(home, '.claude', '.coaltipple.json');
}
export function projectConfigPath(cwd = process.cwd()) {
  return path.join(cwd, '.coaltipple.json');
}

// Load + merge the cascade. Shallow per-key: project keys overwrite global keys;
// keys absent from both are simply absent (the schema default applies downstream).
// Returns {} when neither file exists.
export function loadMergedConfig({ cwd = process.cwd(), home = os.homedir() } = {}) {
  const global = readJsonc(globalConfigPath(home));
  const project = readJsonc(projectConfigPath(cwd));
  return { ...global, ...project };
}
