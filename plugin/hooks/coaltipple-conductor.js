#!/usr/bin/env node
// CoalTipple conductor — ADVISE-ONLY routing hook (Phoenix-pure: no network, no
// child process, no LLM, fail-silent, ~0ms). On SessionStart it injects the
// routing contract; on EVERY UserPromptSubmit it injects a short routing forcer so
// the model trips over that contract (SKILL.md) before acting, plus a 0-token
// complexity hint on a hot keyword.
// The MODEL performs the actual spawn/route (a hook cannot) and self-heals the
// model ranking via the coaltipple skill. This file only advises.
// Self-contained / standalone-portable (Phoenix #9): no imports from scripts/.

const fs = require('fs');
const path = require('path');
const os = require('os');

// --- config cascade (BOM- and comment-tolerant, cached): GLOBAL then PROJECT ---
//   GLOBAL  = <home>/.claude/.coaltipple.json   the user's defaults for ALL projects
//   PROJECT = <gitroot>/.claude/.coaltipple.json optional per-project OVERRIDE
// Shallow per-key merge, PROJECT wins (project > global > schema default). Either
// file may be missing/corrupt — each is read in isolation and contributes nothing
// on failure, so the merge always yields the best available config (never throws).
// Inlined (not imported) to keep the hook standalone-portable (Phoenix #9).
function findGitRoot(startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}
function readCfgFile(file) {
  try {
    let content = fs.readFileSync(file, 'utf8');
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1); // BOM-safe, no literal BOM
    // String-aware JSONC stripper (CM #12 fix): the string alternative consumes
    // an escaped char (\\.) or any non-quote/non-backslash char, so a value
    // ending in a literal backslash terminates the string correctly instead of
    // leaking escape state into the next token and mis-stripping a later comment.
    const cleanJson = content.replace(/"(?:\\.|[^"\\])*"|\/\/.*|\/\*[\s\S]*?\*\//g, (m) => (m[0] === '"' ? m : ''));
    const parsed = JSON.parse(cleanJson);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}
let _cfg;
function loadCfg() {
  if (_cfg !== undefined) return _cfg;
  const global = readCfgFile(path.join(os.homedir(), '.claude', '.coaltipple.json'));
  const project = readCfgFile(path.join(findGitRoot(process.cwd()), '.claude', '.coaltipple.json'));
  // Merge only when something loaded; keep null (= "no config") if neither did, so
  // the existing `if (cfg && ...)` guards in main() behave exactly as before.
  _cfg = global || project ? { ...(global || {}), ...(project || {}) } : null;
  return _cfg;
}

// --- lean 0-token prompt grader (hook sees only the prompt; the skill does the
//     fuller file-aware grade). The grader/hint below fires ONLY on a hot
//     keyword; the always-on routing forcer in main() fires on every prompt. ---
// <coaltipple-shared: hot-keywords> — synced from scripts/lib/keywords.mjs by build-plugin.mjs; edit keywords.mjs, NOT this block
const HOT5 = ['concurrency', 'mutex', 'race condition', 'deadlock', 'thread-saf', 'atomic', 'crypto', 'timing attack', 'timing-attack', 'constant-time', 'constant time', 'timing-safe', 'side-channel', 'encrypt', 'decrypt', 'mathematical proof', 'formal proof', 'derive equation', 'complexity bound'];
const HOT4 = ['oauth', 'authenticat', 'authoriz', 'auth bypass', 'sql injection', 'access control', 'permission', 'secret', 'token', 'password', 'session', 'migration', 'schema change', 'payment', 'billing', 'rate limit', 'optimize query', 'legal contract', 'compliance', 'license terms', 'financial audit', 'tax filing', 'valuation', 'diagnosis', 'dosage', 'clinical', 'gdpr', 'hipaa', 'pii'];
// </coaltipple-shared: hot-keywords>
function hintFor(prompt) {
  const t = String(prompt || '').toLowerCase();
  if (HOT5.some((k) => t.includes(k))) return { grade: 5, tier: 'reasoning', why: 'reasoning-hard keyword' };
  if (HOT4.some((k) => t.includes(k))) return { grade: 4, tier: 'heavy', why: 'sensitive keyword' };
  return null;
}

// The contract is model-facing English (the model reads it fine); the language
// LEVER is a directive telling the model what language to PRODUCE for the user —
// the same approach CoalMine's conductor uses. cfg.language drives it, so the
// config key is live, not inert. Translate prose, never technical terms.
const LANG_NAME = { th: 'Thai', en: 'English', ja: 'Japanese', zh: 'Chinese', es: 'Spanish' };
function langLine(cfg) {
  const l = cfg && typeof cfg.language === 'string' ? cfg.language.toLowerCase() : 'auto';
  const who = LANG_NAME[l] || "the user's language";
  return `- Respond to the user in ${who}: translate prose only — NEVER translate technical terms (commands, paths, identifiers, config keys, tier/effort/grade/model names, severity labels); code and config stay verbatim.`;
}
function contract(cfg) {
  return [
    '[CoalTipple] Model/effort routing active. Before delegating, ensure a valid model-tier ranking exists (self-heal via the coaltipple skill if missing/stale). Then:',
    '- DELEGATE-DOWN a task you can do but is large + cheap, to a lower tier — ONLY with a compact task-contract (goal+constraints+interface+done) AND verify the returned output on merge. Skip it for small tasks (spawn overhead beats the saving).',
    '- ESCALATE-UP a task beyond the current tier for quality. Workers are leaves by policy (routing stays depth-0): give each a bounded task-contract so it RETURNS rather than spawning its own workers; a worker that fails RETURNS its result and the MAIN re-routes.',
    '- Grade by the deterministic rubric, not a model self-assessment. Opus is scarce: cheapest lever first - raise effort, then a stronger same-tier version (e.g. Opus 4.6 -> 4.8), before escalating the tier.',
    '- Honor qualityBar (.coaltipple.json, 0-100, default 60): a result must clear it or climb the model ladder — start at the grade floor, verify vs the contract done-criteria by domain-appropriate means (code: tests/build; text: completeness; research: sourced claims), climb one rung if short, jump to the top tier if far below or out of attempts. 0 = anything passes (cheapest); 100 = climb until best.',
    langLine(cfg),
    '- Consent + token spend: honor .coaltipple.json; never silently fan out costly work.',
  ].join('\n');
}

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function main() {
  const cfg = loadCfg();
  if (cfg && (cfg.enableRouting === false || cfg.routing === false)) return; // legacy key honored
  const disabled = cfg && cfg.disableRouting;
  if (Array.isArray(disabled) && disabled.includes('all')) return;

  let input = {};
  try { input = JSON.parse(readStdin() || '{}'); } catch {}
  const event = input.hook_event_name || input.hookEventName || '';

  if (event === 'UserPromptSubmit') {
    const h = hintFor(input.prompt || input.user_prompt || '');
    const hint = h ? ` Complexity hint: grade ${h.grade} (${h.why}) -> start tier "${h.tier}"; fold into the grade, then the result must clear qualityBar or routing climbs the ladder.` : '';
    process.stdout.write(`[CoalTipple] Route BEFORE acting on this prompt: apply the coaltipple routing contract (SKILL.md) -- grade the task, then delegate-down (large + cheap), escalate-up (beyond this tier), or keep-on-self, per the rubric. Routing actuates on Claude Code only.${hint}`);
    return;
  }
  // SessionStart (and any non-prompt event) -> inject the routing contract.
  process.stdout.write(contract(cfg));
}

try { main(); } catch {}
