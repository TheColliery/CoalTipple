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
//   PROJECT = optional per-project OVERRIDE, resolved under an agent dir (namespace
//             campaign #69+#39, owner-designated 2026-08-08) -- see the
//             projectConfigCandidates walk below for the full read order and the
//             LEGACY fallback it still honors.
// Shallow per-key merge, PROJECT wins (project > global > schema default). Either
// file may be missing/corrupt — each is read in isolation and contributes nothing
// on failure, so the merge always yields the best available config (never throws).
// Inlined (not imported) to keep the hook standalone-portable (Phoenix #9).
// Keep findGitRoot byte-identical to scripts/lib/config-load.mjs.
// The read-order WALK below must stay in sync with config-load.mjs's
// projectConfigCandidates -- not just findGitRoot's own body (verify.mjs's
// config-path-sync gate guards the project-config PATH SEGMENTS, not the function body).
function findGitRoot(startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}
// Namespace campaign (#69+#39): first-found-wins over the SAME order as
// config-load.mjs's projectConfigCandidates -- own agent dir (always .claude for
// this room) -> .agents -> .gemini -> LEGACY <gitroot>/.claude/.coaltipple.json.
const AGENT_DIR_ORDER = ['.claude', '.agents', '.gemini'];
function projectConfigCandidates(cwd) {
  const root = findGitRoot(cwd);
  const candidates = AGENT_DIR_ORDER.map((d) => path.join(root, d, 'coal', 'coaltipple.json'));
  candidates.push(path.join(root, '.claude', '.coaltipple.json')); // LEGACY, always last
  return candidates;
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
    // Prototype-pollution guard (OWASP Node.js; flock-canonical -- CoalMine/CoalBoard's own
    // conductors carry the same reviver inline for the identical Phoenix #9 standalone reason).
    const parsed = JSON.parse(cleanJson, (k, v) => (k === '__proto__' || k === 'constructor' || k === 'prototype' ? undefined : v));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}
// SAFER-VALUE-WINS (hooks-safety.md §9): a project .coaltipple.json arrives WITH A
// CLONED REPO -- untrusted. Only the keys THIS hook actually reads+branches on need the
// clamp (mode gates routingOff below; updateMode gates the self-update nudge) --
// fableConsent is agent-executed / never read by this hook, so its clamp lives only in
// scripts/lib/config-load.mjs (used by configure.mjs --list), not duplicated here dead.
// Index 0 = safest. Keep in sync with config-load.mjs's SAFER_ENUM (same ordering rationale).
const SAFER_ENUM = { mode: ['off', 'delegation', 'escalation', 'auto'], updateMode: ['off', 'remind', 'ask', 'auto'] };
// R2 (hooks-safety.md §9, corrected 2026-07-27): an ABSENT global is the SCHEMA DEFAULT,
// not "nothing to clamp" -- matches config-load.mjs's SCHEMA_DEFAULT_ENUM (mode's default
// 'auto' is a no-op ceiling; updateMode's 'ask' genuinely protects a zero-customization
// install). fableConsent has no entry here at all (see the header comment above), so it
// never needed this and isn't part of the discussion the config-load.mjs comment records.
const SCHEMA_DEFAULT_ENUM = { mode: 'auto', updateMode: 'ask' };
let _cfg;
function loadCfg() {
  if (_cfg !== undefined) return _cfg;
  // CLAUDE_CONFIG_DIR (#6) redirects ~/.claude (portable / multi-account / CI); first entry if a comma-list.
  const cfgDir = claudeBaseDir();
  const global = readCfgFile(path.join(cfgDir, '.coaltipple.json'));
  // First EXISTING candidate wins (matches config-load.mjs's projectConfigPath
  // exactly) -- an existing-but-corrupt file still stops the walk there and
  // contributes nothing (readCfgFile returns null), it does NOT fall through to
  // a lower-priority candidate's real content.
  const candidates = projectConfigCandidates(process.cwd());
  const projectPath = candidates.find((c) => fs.existsSync(c)) || candidates[0];
  const project = readCfgFile(projectPath);
  // Merge only when something loaded; keep null (= "no config") if neither did, so
  // the existing `if (cfg && ...)` guards in main() behave exactly as before.
  const merged = global || project ? { ...(global || {}), ...(project || {}) } : null;
  if (merged && project) {
    for (const [key, order] of Object.entries(SAFER_ENUM)) {
      if (project[key] === undefined) continue;
      const effectiveGlobal = (global && global[key] !== undefined) ? global[key] : SCHEMA_DEFAULT_ENUM[key];
      const gi = order.indexOf(String(effectiveGlobal).toLowerCase());
      const pi = order.indexOf(String(project[key]).toLowerCase());
      if (gi === -1 || pi === -1) continue; // unknown value: leave the shallow-merge result
      merged[key] = pi <= gi ? project[key] : effectiveGlobal; // project may not move PAST the effective global toward the weaker end
    }
  }
  _cfg = merged;
  return _cfg;
}

// --- Self-update (KIND 1 — skill version): persistent once-per-window throttle ---
// Ported from CoalMine's conductor (CM v3.7.5). The hook only SCHEDULES the nudge;
// the version CHECK lives in the /coaltipple:update agent procedure (a fail-silent
// offline hook cannot verify a published version — Phoenix #7). The stamp is an ISO
// date; the conductor reads it to decide if a nudge is due, then rewrites it to today
// so the nudge fires at most once per updateCheckDays (no re-nag). Sandbox-compliant
// (Phoenix #10): only the global .claude dir is touched. CT has no gold-standard
// rules, so there is no KIND 2 (rule-freshness) scan — KIND 1 only.
// Namespace campaign (#69+#39 part 2): the stamp moved to <CLAUDE_CONFIG_DIR or
// ~>/.claude/coal/coaltipple/update-check. A pre-campaign stamp at the OLD bare
// location (.claude/.coaltipple-update-check) is still READ if the new one is
// absent (so an existing user's throttle window isn't silently reset to "due"),
// and is best-effort dropped on the next write (write-new-then-drop-old, same
// pattern as the ranking migration this session).
const UPDATE_STAMP = '.coaltipple-update-check';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// CLAUDE_CONFIG_DIR (#6 / #10) redirects the global .claude dir; first entry if a
// comma-list; a degenerate (empty / whitespace) value falls back to ~/.claude.
function claudeBaseDir() {
  const c = process.env.CLAUDE_CONFIG_DIR;
  return (c && c.split(',')[0].trim()) || path.join(os.homedir(), '.claude');
}

// Today as YYYY-MM-DD in UTC — deterministic for a calendar day, no TZ drift between
// the write and the next read (Phoenix #8: the date is the only sanctioned time input).
function todayISO(now) {
  return new Date(now).toISOString().slice(0, 10);
}
// Whole-day delta between two YYYY-MM-DD strings (b - a), or null if either is
// unparseable. Date.parse on a date-only string is UTC, matching todayISO.
function dayDiff(a, b) {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (isNaN(ta) || isNaN(tb)) return null;
  return Math.floor((tb - ta) / MS_PER_DAY);
}
function updateStampPath() {
  return path.join(claudeBaseDir(), 'coal', 'coaltipple', 'update-check');
}
function oldUpdateStampPath() {
  return path.join(claudeBaseDir(), UPDATE_STAMP);
}
function readUpdateStamp() {
  for (const p of [updateStampPath(), oldUpdateStampPath()]) {
    try { return fs.readFileSync(p, 'utf8').trim(); } catch { /* try next */ }
  }
  return null;
}
// Due when there is no stamp, a corrupt stamp, or the window has elapsed.
function updateDue(stamp, today, days) {
  if (!stamp) return true;
  const d = dayDiff(stamp, today);
  if (d === null) return true; // unparseable stamp -> self-heal by treating as due
  return d >= days;
}
// Crash-safe write: temp sibling then atomic rename, so a kill mid-write can never
// leave a half-written (unparseable) stamp.
function writeUpdateStamp(today) {
  try {
    const dir = path.dirname(updateStampPath());
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    const final = updateStampPath();
    const tmp = final + '.tmp';
    fs.writeFileSync(tmp, today, 'utf8');
    fs.renameSync(tmp, final);
    try { fs.rmSync(oldUpdateStampPath(), { force: true }); } catch {}
  } catch {}
}

// The KIND-1 directive per updateMode. English (the agent localizes for the user,
// same convention as the routing contract's langLine). Returns the line to inject,
// or null for a mode that emits nothing (off / unknown).
function updateDirective(mode, days) {
  switch (mode) {
    case 'ask':
      return `- CoalTipple self-update (ask the user ONCE via your question tool, in their language): "How should CoalTipple keep itself current?" Offer 3 — **auto** (I check for a newer version about every ${days} days and apply updates when you approve; ~1-2K tokens per check), **remind** (a free periodic reminder; you run \`claude plugin update coaltipple@coaltipple\` yourself), **off** (no reminders). Save the choice: \`node scripts/configure.mjs --updateMode <auto|remind|off>\` (from the CoalTipple repo, or wherever .coaltipple.json lives). Do not check now — the saved mode drives future sessions.`;
    case 'auto':
      return '- CoalTipple self-update (standing consent — do this now): follow /coaltipple:update to web-check the latest CoalTipple tag vs the installed plugin.json version. If newer, OFFER `claude plugin update coaltipple@coaltipple` + `/reload-plugins`; if current, say "up to date"; if git/network is unavailable, say so and suggest updating manually later (never assume).';
    case 'remind':
      return `- CoalTipple self-update reminder (relay to the user in their language, no action needed): it has been ~${days}d since the last CoalTipple update-check — consider \`claude plugin update coaltipple@coaltipple\` to refresh, or switch to auto (\`node scripts/configure.mjs --updateMode auto\`).`;
    default:
      return null; // 'off' (or unknown) -> nothing
  }
}

// --- lean 0-token prompt grader (hook sees only the prompt; the skill does the
//     fuller file-aware grade). The grader/hint below fires ONLY on a hot
//     keyword; the always-on routing forcer in main() fires on every prompt. ---
// <coaltipple-shared: hot-keywords> — synced from scripts/lib/keywords.mjs by build-plugin.mjs; edit keywords.mjs, NOT this block
const HOT5 = ['concurrency', 'mutex', 'mutexes', 'race condition', 'deadlock', 'deadlocks', 'thread-saf*', 'atomic', 'crypto', 'cryptograph*', 'timing attack', 'timing-attack', 'constant-time', 'constant time', 'timing-safe', 'side-channel', 'encrypt*', 'decrypt*', 'mathematical proof', 'formal proof', 'derive equation', 'complexity bound'];
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

// The deterministic HOT keyword flags are ENGLISH literals, so a non-English prompt fires
// NO flag. This per-turn nudge covers only the part detectable by SCRIPT: a non-Latin char
// — anything outside Basic Latin + Latin-1 Supplement + Latin Extended-A/B (code point
// <= 0x24F), while excluding the General Punctuation block (0x2000-0x206F: em-dash / smart
// quotes / ellipsis, common in English text) so an English prompt with typographic
// punctuation does NOT trigger a false nudge. Catches Thai / CJK / Arabic / Cyrillic /
// Hebrew / Devanagari / etc. LATIN-SCRIPT non-English (Spanish/French/German/Portuguese/
// Indonesian) is INDISTINGUISHABLE from English by script, so it cannot be caught here —
// the resident SessionStart contract (contract()) carries the all-language "grade
// sensitivity by MEANING" line as the deterministic aid that covers it. The character
// class is BUILT from char codes — never a raw high-Unicode literal in source (the tool
// layer mangles those; this hook must stay deterministic + portable, Phoenix #8/#9).
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
    '[CoalTipple] Model/effort routing active. Before delegating, ensure a valid model-tier ranking exists (it is the alias floor haiku<sonnet<opus<fable + your modelTiers pins; fable = the top rung, a real-money spawn you ASK before using [once/always-this-project/no], else opus; rebuild it via the coaltipple skill if missing/corrupt). Then:',
    '- Routing degrades safe on any Claude Code version: an unfamiliar model classifies as a strong tier, a failed spawn falls to the next available, and the platform resolves each alias to its current best model at spawn-time (verified across the 2.1.x line).',
    '- DELEGATE-DOWN a task you can do but is large + cheap, to a lower tier — ONLY with a compact task-contract (goal+constraints+interface+done) AND verify the returned output on merge. Skip it for small tasks (spawn overhead beats the saving).',
    '- ESCALATE-UP a task beyond the current tier for quality. Workers are leaves by policy (routing stays depth-0): give each a bounded task-contract so it RETURNS rather than spawning its own workers; a worker that fails RETURNS its result and the MAIN re-routes.',
    '- Grade by the deterministic rubric, not a model self-assessment. Opus is scarce: cheapest lever first - raise effort, then a stronger same-tier version (e.g. Opus 4.6 -> 4.8), before escalating the tier.',
    '- Sensitivity is graded by MEANING in ANY language: the keyword/complexity hints are an English-only fast-path, so a non-English prompt (Spanish/French/Thai/CJK - any script) fires NO keyword flag. Never read "no flag" as "not sensitive" - judge crypto/auth/payment/security by intent and keep never-down (delegate-down stays forbidden for sensitive work).',
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
  // Guard the parse result: valid JSON that is NOT a plain object (null, a number,
  // an array) must not become `input`, or the `input.hook_event_name` read below is a
  // null-deref / silent-wrong read. Non-object -> keep the empty-object default.
  try { const parsed = JSON.parse(readStdin() || '{}'); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) input = parsed; } catch {}
  const event = input.hook_event_name || input.hookEventName || '';

  if (event === 'UserPromptSubmit') {
    const prompt = input.prompt || input.user_prompt || '';
    const h = hintFor(prompt);
    const hint = h ? ` Complexity hint: grade ${h.grade} (${h.why}) -> start tier "${h.tier}"; fold into the grade, then the result must clear qualityBar or routing climbs the ladder.` : '';
    // The English HOT-keyword hint cannot fire on a non-English prompt. For a non-LATIN
    // script (Thai/CJK/…) we detect it here and add a per-turn nudge; a Latin-script
    // non-English prompt (Spanish/French/…) is undetectable per-turn and is covered by the
    // resident contract's grade-by-MEANING line instead (see contract() + the NON_LATIN_RE
    // note above). Complements (never replaces) the English hint above.
    const nonLatin = hasNonLatinScript(prompt);
    const nonEnglish = nonLatin ? ' Non-English prompt -- grade by MEANING and apply the sensitive-gate by intent; the English keyword flags will not fire.' : '';
    // Double-hook arbitration cue (CB↔CT coordination, DOUBLE-HOOK-FIX.md): CONDITIONAL on a
    // hint or non-Latin signal -- those mirror CoalBoard's own AND-gate seeds, so they are the
    // only turns it might also fire on; a signal-free turn has nothing to arbitrate. Lets the
    // model arbitrate silently rather than act on both / surface a "conflict" (Phoenix #13
    // zero-noise).
    const cue = (h || nonLatin) ? ' Triage (binds even when only ONE hook fired): STAKES = your Layer-2 verdict that the TASK is stakes-domain work (security · crypto · migration · money); fired keywords of any vocabulary are Layer-1 evidence only, never the verdict, and a Layer-2 acquittal STANDS -- no keyword re-arms it. Stakes -> CoalBoard leads: HALT and ask the user before acting; CoalTipple = tier-lever. No stakes: CoalTipple leads only if the WORK\'s OWN size/complexity calls for delegate-down or escalate-up -- a fired grade is evidence, never the verdict -- else neither. Layer 2 genuinely undecidable -> CoalBoard. Both conductors fired -> ARBITRATE silently by this same rule: act on one, never surface it.' : '';
    // HOOK-LEAN (2026-07-15): the full routing rubric is RESIDENT from SessionStart (incl. a
    // :compact re-inject); this per-turn line is a POINTER to it, not a re-teach. Honest caveat:
    // on a very long session that never compacts, early-context attention on that resident
    // contract can fade -- this one-liner is the safety net that re-surfaces "there is a
    // contract, go check it". A shrink, never a removal.
    process.stdout.write(`[CoalTipple] Route this turn per the resident routing contract.${hint}${nonEnglish}${cue}`);
    return;
  }
  // SessionStart (and any non-prompt event) -> inject the routing contract, plus the
  // KIND-1 self-update directive when due. Self-update is ORTHOGONAL to routing but
  // shares the SessionStart channel; it never fires here when the conductor is wholly
  // disabled (routingOff / disableRouting:all both returned above). Its own off-switch
  // is updateMode:"off". The per-prompt forcer (UserPromptSubmit, above) is untouched.
  let out = contract(cfg);
  let updateMode = 'ask';
  let updateCheckDays = 14;
  if (cfg && typeof cfg.updateMode === 'string') {
    const v = cfg.updateMode.toLowerCase();
    if (v === 'ask' || v === 'auto' || v === 'remind' || v === 'off') updateMode = v;
  }
  if (cfg && Number.isInteger(cfg.updateCheckDays) && cfg.updateCheckDays >= 1 && cfg.updateCheckDays <= 365) {
    updateCheckDays = cfg.updateCheckDays;
  }
  // Throttled by the persistent stamp: fires at most once per updateCheckDays.
  // 'off' emits nothing and skips the stamp entirely (no disk touch).
  if (updateMode !== 'off') {
    try {
      const today = todayISO(Date.now());
      if (updateDue(readUpdateStamp(), today, updateCheckDays)) {
        const directive = updateDirective(updateMode, updateCheckDays);
        if (directive) out += '\n' + directive;
        writeUpdateStamp(today); // throttle -> no re-nag until the window elapses
      }
    } catch {}
  }
  process.stdout.write(out);
}

try { main(); } catch {}
