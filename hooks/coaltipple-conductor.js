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
// Keep findGitRoot byte-identical to scripts/lib/config-load.mjs + configure.mjs
// (verify.mjs's config-path-sync gate guards the drift).
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
  // CLAUDE_CONFIG_DIR (#6) redirects ~/.claude (portable / multi-account / CI); first entry if a comma-list.
  const cfgEnv = process.env.CLAUDE_CONFIG_DIR;
  const cfgDir = (cfgEnv && cfgEnv.split(',')[0].trim()) || path.join(os.homedir(), '.claude');
  const global = readCfgFile(path.join(cfgDir, '.coaltipple.json'));
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
const HOT5 = ['concurrency', 'mutex', 'mutexes', 'race condition', 'deadlock', 'deadlocks', 'thread-saf*', 'atomic', 'crypto', 'cryptographic', 'cryptography', 'timing attack', 'timing-attack', 'constant-time', 'constant time', 'timing-safe', 'side-channel', 'encrypt*', 'decrypt*', 'mathematical proof', 'formal proof', 'derive equation', 'complexity bound'];
const HOT4 = ['oauth', 'authenticat*', 'authoriz*', 'auth bypass', 'sql injection', 'access control', 'permission*', 'secret', 'secrets', 'token', 'tokens', 'password', 'passwords', 'session', 'sessions', 'migrat*', 'schema change', 'payment', 'payments', 'billing', 'rate limit', 'optimize query', 'bug scan', 'scan for bugs', 'find bugs', 'find all bugs', 'security audit', 'security review', 'vulnerability scan', 'audit the codebase', 'code audit', 'legal contract', 'compliance', 'license terms', 'financial audit', 'tax filing', 'valuation', 'medical diagnosis', 'clinical diagnosis', 'dosage', 'clinical trial', 'gdpr', 'hipaa', 'pii'];
// </coaltipple-shared: hot-keywords>
// Match a hot keyword with the SAME stem-vs-whole-word convention as the grader
// (grade.mjs includesAny): a trailing `*` = STEM (prefix, leading \b only); a bare
// word = WHOLE-WORD (leading + trailing \b), so the conductor's hint can't over-match
// where the grader doesn't (token -> tokenizer, crypto -> cryptocurrency). `t` is lowercased.
function matchKw(t, list) {
  for (const k of list) {
    const raw = String(k).toLowerCase();
    const stem = raw.endsWith('*');
    const word = (stem ? raw.slice(0, -1) : raw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!word) continue;
    if (new RegExp('\\b' + word + (stem ? '' : '\\b')).test(t)) return true;
  }
  return false;
}
function hintFor(prompt) {
  const t = String(prompt || '').toLowerCase();
  if (matchKw(t, HOT5)) return { grade: 5, tier: 'reasoning', why: 'reasoning-hard keyword' };
  if (matchKw(t, HOT4)) return { grade: 4, tier: 'heavy', why: 'sensitive keyword' };
  return null;
}

// The deterministic HOT keyword flags are ENGLISH literals, so a non-English prompt
// matches NOTHING and the keyword sensitive-gate silently vanishes for it. Detect a
// non-Latin SCRIPT char — anything outside Basic Latin + Latin-1 Supplement + Latin
// Extended-A/B (code point <= 0x24F), while excluding the General Punctuation block
// (0x2000-0x206F: em-dash / smart quotes / ellipsis, common in English text) so an
// English prompt with typographic punctuation does NOT trigger a false nudge. Catches
// Thai / CJK / Arabic / Cyrillic / Hebrew / Devanagari / etc. The character class is
// BUILT from char codes — never a raw high-Unicode literal in source (the tool layer
// mangles those; this hook must stay deterministic + portable, Phoenix #8/#9).
const NON_LATIN_RE = (() => {
  const cc = String.fromCharCode;
  const cls = '[^' + cc(0x00) + '-' + cc(0x24f) + cc(0x2000) + '-' + cc(0x206f) + ']';
  return new RegExp(cls);
})();
function hasNonLatinScript(prompt) {
  return NON_LATIN_RE.test(String(prompt || ''));
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
    '- Routing degrades safe on any Claude Code version: an unfamiliar model classifies as a strong tier, a failed spawn falls to the next available, and the ranking self-heals on first route (verified across the 2.1.x line).',
    '- DELEGATE-DOWN a task you can do but is large + cheap, to a lower tier — ONLY with a compact task-contract (goal+constraints+interface+done) AND verify the returned output on merge. Skip it for small tasks (spawn overhead beats the saving).',
    '- ESCALATE-UP a task beyond the current tier for quality. Workers are leaves by policy (routing stays depth-0): give each a bounded task-contract so it RETURNS rather than spawning its own workers; a worker that fails RETURNS its result and the MAIN re-routes.',
    '- Grade by the deterministic rubric, not a model self-assessment. Opus is scarce: cheapest lever first - raise effort, then a stronger same-tier version (e.g. Opus 4.6 -> 4.8), before escalating the tier.',
    '- mode (.coaltipple.json, default auto): auto = route both directions per grade; delegation = delegate-down only (escalate-up suppressed, a budget-saving mode); escalation = escalate-up only (delegate-down suppressed, a quality mode); off = routing off, do it yourself. The sensitive HARD GATE overrides mode (sensitive is still never-down and may always escalate up).',
    '- Honor qualityBar (.coaltipple.json, 0-100, default 60): a result must clear it or climb the model ladder — start at the grade floor, verify vs the contract done-criteria by domain-appropriate means (code: tests/build; text: completeness; research: sourced claims), climb one rung if short, jump to the top tier if far below or out of attempts. 0 = anything passes (cheapest); 100 = climb until best.',
    langLine(cfg),
    '- Consent + token spend: honor .coaltipple.json; never silently fan out costly work.',
  ].join('\n');
}

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

// Routing is OFF when the master switch is off OR mode is "off" (do-it-yourself).
// Both silence the SessionStart contract AND the per-prompt forcer — the off switch.
function routingOff(cfg) {
  if (!cfg) return false;
  if (cfg.enableRouting === false || cfg.routing === false) return true; // legacy key honored
  if (typeof cfg.mode === 'string' && cfg.mode.toLowerCase() === 'off') return true; // mode:"off" short-circuit
  return false;
}

function main() {
  const cfg = loadCfg();
  if (routingOff(cfg)) return;
  const disabled = cfg && cfg.disableRouting;
  if (Array.isArray(disabled) && disabled.includes('all')) return;

  let input = {};
  try { input = JSON.parse(readStdin() || '{}'); } catch {}
  const event = input.hook_event_name || input.hookEventName || '';

  if (event === 'UserPromptSubmit') {
    const prompt = input.prompt || input.user_prompt || '';
    const h = hintFor(prompt);
    const hint = h ? ` Complexity hint: grade ${h.grade} (${h.why}) -> start tier "${h.tier}"; fold into the grade, then the result must clear qualityBar or routing climbs the ladder.` : '';
    // The English HOT-keyword hint cannot fire on a non-English prompt; add ONE generic
    // deterministic nudge so the sensitive-gate backstop is not silently lost there.
    // Complements (never replaces) the English hint above.
    const nonEnglish = hasNonLatinScript(prompt) ? ' Non-English prompt -- grade by MEANING and apply the sensitive-gate by intent; the English keyword flags will not fire.' : '';
    process.stdout.write(`[CoalTipple] Route BEFORE acting on this prompt: apply the coaltipple routing contract (SKILL.md) -- grade the task, then delegate-down (large + cheap), escalate-up (beyond this tier), or keep-on-self, per the rubric. Routing actuates on Claude Code only.${hint}${nonEnglish}`);
    return;
  }
  // SessionStart (and any non-prompt event) -> inject the routing contract.
  process.stdout.write(contract(cfg));
}

try { main(); } catch {}
