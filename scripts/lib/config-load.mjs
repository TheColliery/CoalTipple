// CoalTipple config cascade — the 2-level merge that every config reader uses.
//
//   GLOBAL  = <home>/.claude/.coaltipple.json   the user's defaults for ALL projects
//   PROJECT = optional per-project OVERRIDE, now resolved under an agent dir (namespace
//             campaign #69+#39, owner-designated 2026-08-08) — see `projectConfigPath`'s
//             own header for the full read order and the LEGACY fallback it still honors.
//
// Precedence (shallow, per-key): PROJECT value > GLOBAL value > schema default.
// A project file is created ONLY when the user customizes per-project (no-clutter):
// absent project file = the global defaults (and schema defaults) apply unchanged.
//
// State dirs (NOT part of the config merge):
//   GLOBAL  <home>/.claude/.coaltipple/  the model RANKING (platform-level, shared)
//   PROJECT <gitroot>/.claude/.coaltipple/   per-project work-state (proposed/, state.json)
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
import { parseJsonc } from './jsonc.mjs';

// Read one JSONC file into an object. Returns {} for any failure mode
// (missing file, unreadable, malformed JSON, non-object top-level) — never throws.
// parseJsonc drops __proto__/constructor/prototype at parse (proto-pollution guard,
// SKILL-REPO-PATTERN.md Layer 3 — flock-canonical; this file was the one room missing it).
function readJsonc(file) {
  try {
    let content = fs.readFileSync(file, 'utf8');
    if (content.charCodeAt(0) === 0xfeff) content = content.slice(1); // BOM-safe
    const parsed = parseJsonc(content);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// The canonical paths, exported so other readers (configure/install/conductor) agree.
// Everything lives under .claude/ — global at ~/.claude (or $CLAUDE_CONFIG_DIR), project at <cwd>/.claude.
// CLAUDE_CONFIG_DIR (#6) redirects the GLOBAL .claude dir (portable / multi-account / CI installs);
// it may be a comma-list (multi-account) — use the first entry. Project paths are NOT affected.
export function claudeBaseDir(home = os.homedir()) {
  const c = process.env.CLAUDE_CONFIG_DIR;
  return (c && c.split(',')[0].trim()) || path.join(home, '.claude');
}
export function globalConfigPath(home = os.homedir()) {
  return path.join(claudeBaseDir(home), '.coaltipple.json');
}

// Walk up from startDir for a `.git`, returning the git root; fall back to startDir
// when none is found (git is OPTIONAL — a non-git project still resolves to its own
// dir). Anchors the PROJECT config/state at the git root so a subdir cwd reads the
// SAME file the conductor + configure do (they each inline an identical copy — Phoenix
// #9 keeps the hook standalone; verify.mjs's config-path-sync gate guards the project-config
// PATH SEGMENTS, not the function body).
// Keep this logic byte-identical to the conductor's + configure's inlined copies.
export function findGitRoot(startDir = process.cwd()) {
  let dir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}
// Namespace campaign (#69+#39, owner-designated 2026-08-08). Per-project config
// lives under an agent dir, never bare at the project root. THE READ ORDER IS A
// RAIL — identical wording in every room's readCfg comment and README Configure
// section, one flock:
//   1. <project>/.<the running agent's OWN dir>/coal/coaltipple.json — the dir of
//      the agent actually executing. CoalTipple activates ONLY through Claude
//      Code's own hook system (`hooks/hooks.json`); it has no other running-agent
//      identity to branch on, so for THIS room "own dir" is always `.claude` and
//      collapses onto the first entry of step 2 below rather than needing a
//      separate check.
//   2. Other known agent dirs, fixed order: `.claude` -> `.agents` -> `.gemini`
//      (first FOUND wins).
//   3. LEGACY: <project>/.claude/.coaltipple.json — CT's own CURRENT shape as of
//      this campaign (never a bare root dotfile, unlike CoalWash's legacy) —
//      read normally, no breakage for an existing user.
// WRITE target = where the config was found; absent everywhere, the running
// agent's own dir. Hooks never perform this move on a READ (Phoenix #5, no side
// effects) — CT DOES have a project-config writer (`configure.mjs`, including the
// fableConsent "always-this-project" consent persistence), so unlike CoalWash the
// write side is real: `configure.mjs` implements write-new-then-drop-old via its
// own `projectWriteTarget` helper, which reuses `projectConfigCandidates` below.
const AGENT_DIR_ORDER = ['.claude', '.agents', '.gemini'];
export function projectConfigCandidates(cwd = process.cwd()) {
  const root = findGitRoot(cwd);
  const candidates = AGENT_DIR_ORDER.map((d) => path.join(root, d, 'coal', 'coaltipple.json'));
  candidates.push(path.join(root, '.claude', '.coaltipple.json')); // LEGACY, always last
  return candidates;
}
export function projectConfigPath(cwd = process.cwd()) {
  const candidates = projectConfigCandidates(cwd);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return candidates[0]; // nothing found anywhere -- own-dir is both the read and write target
}
// State dirs — hold the ranking / work-state, NOT config. The GLOBAL state dir holds
// the shared platform model-ranking; the PROJECT state dir holds per-project
// work-state (proposed/, state.json) and the optional project conductor copy.
// Namespace campaign (#69+#39 part 2, owner-designated 2026-08-08): the machine-global
// scratch state moves under coal/ too. This dir holds ONLY ranking.json for this room
// (verified: `globalStateDir(` has exactly two consumers outside tests, both building
// `path.join(globalStateDir(), 'ranking.json')` -- install.mjs). oldGlobalStateDir is the
// pre-campaign location, kept only so install.mjs's migration can find + move a ranking
// written before this change.
export function globalStateDir(home = os.homedir()) {
  return path.join(claudeBaseDir(home), 'coal', 'coaltipple');
}
export function oldGlobalStateDir(home = os.homedir()) {
  return path.join(claudeBaseDir(home), '.coaltipple');
}
export function projectStateDir(cwd = process.cwd()) {
  return path.join(findGitRoot(cwd), '.claude', '.coaltipple');
}

function isPlainObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

// SAFER-VALUE-WINS (hooks-safety.md §9, "Config-cascade clamp"): a project
// .coaltipple.json arrives WITH A CLONED REPO — untrusted. A plain project-wins overlay
// would let it ESCALATE a consent/spend-bearing key past what the user chose globally
// (e.g. flip a global `mode:'off'` to `'auto'`, or `updateMode:'off'` to `'auto'` —
// standing consent to network + spend tokens nobody agreed to for THIS project). The
// project layer may only QUIETEN a value toward the safe end, never escalate past it.
// Every other key stays plain project-wins (unchanged).
// Index 0 = SAFEST. `updateMode` mirrors CoalMine's v3.9.3 precedent verbatim. `mode`
// has no direct sibling precedent (CT-only key) — ordered by the axis this rule actually
// cares about (spend), not routing quality: off = no routing at all (safest) ->
// delegation = DOWN-only (spend-REDUCING, still safe) -> escalation = UP-only
// (spend-INCREASING, up to a real-money Fable ask) -> auto = both directions.
const SAFER_ENUM = {
  mode: ['off', 'delegation', 'escalation', 'auto'],
  updateMode: ['off', 'remind', 'ask', 'auto'],
};
// A bool whose SAFE value is false: fableConsent:false = ask before every real-money
// Fable spawn; true = standing consent, no per-instance gate. (Opposite direction from
// CoalWash's `localOnly`, whose safe value is true — the safe end depends on the key.)
const SAFER_FALSE = ['fableConsent'];
// R2 (hooks-safety.md §9, corrected 2026-07-27): the FACTORY DEFAULT is the user's
// effective stance even with NO global file (the common case) — matches platform-configs/
// .coaltipple.json (the shipped factory template) + config-schema.mjs's documented
// defaults. `mode`'s default ('auto') is already the top/least-safe index of its own
// ordering, so it substitutes as a no-op ceiling; `updateMode` genuinely gains protection
// an absent global previously left wide open.
const SCHEMA_DEFAULT_ENUM = { mode: 'auto', updateMode: 'ask' };

// DELIBERATE NON-EXTENSION, found + reasoned through this session (do not "fix" this into
// matching SAFER_ENUM's absent-global substitution -- that was tried and it breaks a
// shipped feature; see the failing-test history in git blame before changing it again):
// fableConsent's ONLY persistence path is a PROJECT-level write -- SKILL.md's "always"
// option runs `configure.mjs --project --fableConsent true`, with NO global-write
// counterpart (unlike updateMode's ask-flow, which writes GLOBAL). Substituting the
// schema default (false) for an absent global would clamp that legitimate write back to
// false on every subsequent read, silently breaking "always-this-project" and forcing a
// re-ask on every fable route. So fableConsent clamps ONLY against an EXPLICIT global
// `false` (a user's deliberate machine-wide stance) -- an absent global leaves a bare
// project `true` alone, because that bare value IS how a legitimate per-project consent
// persists, not just how an attacker's clone would look.
function applySaferValueWins(merged, global, project) {
  for (const [key, order] of Object.entries(SAFER_ENUM)) {
    if (project[key] === undefined) continue;
    const effectiveGlobal = global[key] !== undefined ? global[key] : SCHEMA_DEFAULT_ENUM[key];
    // Case-fold: config-schema.mjs's enum validation is case-insensitive, so a project
    // 'AUTO'/'Off' must not evade the lookup via case and fall through to plain project-wins.
    const gi = order.indexOf(String(effectiveGlobal).toLowerCase());
    const pi = order.indexOf(String(project[key]).toLowerCase());
    if (gi === -1 || pi === -1) continue; // unknown value: leave the shallow-merge result (schema clamps it downstream)
    merged[key] = pi <= gi ? project[key] : effectiveGlobal; // project may not move PAST the effective global toward the weaker end
  }
  for (const key of SAFER_FALSE) {
    if (global[key] === false) merged[key] = false; // project cannot turn an EXPLICIT global false into true (absent global: see the comment above)
  }
  return merged;
}

// Load + merge the cascade. Shallow per-key (project keys overwrite global keys),
// EXCEPT `modelTiers`, which is deep-merged PER-TIER. Keys absent from both are
// simply absent (the schema default applies downstream). Returns {} when neither
// file exists.
//
// Why modelTiers is special: it is a nested obj of PLATFORM-LEVEL pins (the human
// override for a model the agent cannot introspect — e.g. an episodic Fable pin on
// `reasoning`). A shallow spread lets ANY project `modelTiers` REPLACE the whole
// global pin set — a project pinning only `heavy` would silently drop a global
// `reasoning: fable` pin. Deep-merging per-tier lets a project REFINE one tier's pin
// over the global base without wiping the others.
//
// `keywords` (the other obj key) stays SHALLOW by design (named divergence): its
// security FLOOR is the built-in FACTORY groups (crypto/auth/…) applied downstream by
// mergeKeywordGroups — never the config value — so the sensitive HARD GATE cannot be
// weakened by a global-vs-project keyword merge. Deep-merging it would touch the
// sensitive-merge path (the v1.0.18 REPLACE→UNION class) for a non-security
// customization concern that is not this finding; left as-is deliberately.
export function loadMergedConfig({ cwd = process.cwd(), home = os.homedir() } = {}) {
  const global = readJsonc(globalConfigPath(home));
  const project = readJsonc(projectConfigPath(cwd));
  const merged = { ...global, ...project };
  if (isPlainObj(global.modelTiers) || isPlainObj(project.modelTiers)) {
    merged.modelTiers = {
      ...(isPlainObj(global.modelTiers) ? global.modelTiers : {}),
      ...(isPlainObj(project.modelTiers) ? project.modelTiers : {}),
    };
  }
  return applySaferValueWins(merged, global, project);
}
