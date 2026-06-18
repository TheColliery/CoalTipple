// Deterministic 0-token task grader — the routing AUTHORITY.
// Grades a task 1-5 from file/size/sensitive-path/keyword signals WITHOUT an
// LLM, so a cheap main model's overconfident self-assessment can never route a
// hard task to a weak tier (the escalation-mode safety backstop). Same input ->
// same grade (Phoenix #8 deterministic). Pure: no fs, no network, no deps.
//
// LANGUAGE SCOPE — the keyword floor is ENGLISH-ONLY: the `words` lists below (and
// the conductor's mirrored HOT5/HOT4 hint) are English literals, so a non-English
// prompt ("scan for bugs" / "constant-time compare" in Thai/CJK/Arabic) matches NO
// keyword and gets only the size/path floor. That is BY DESIGN: the deterministic
// layer is a best-effort English backstop; for a non-English task the MODEL layer
// (SKILL.md Step 1/2) carries the grading — it grades by MEANING/intent and applies
// the sensitive never-down gate by intent, because the keyword flag will not fire.

import { KEYWORD_GROUPS, HOT5, HOT4, SENSITIVE, EXCLUDE } from './keywords.mjs';

// Re-exported from the keyword SSoT (keywords.mjs) — so the grader and the
// conductor's synced copy can never disagree (the rot-canary "two sources of
// truth" fix). Edit keywords.mjs, not here.
export const DEFAULT_EXCLUDE = EXCLUDE;
export const DEFAULT_SENSITIVE = SENSITIVE;
export const DEFAULT_KEYWORD_GROUPS = KEYWORD_GROUPS;
export const DEFAULT_HOT5 = HOT5; // derived flats (grade-5 / grade-4 group words) kept for the conductor + any legacy caller
export const DEFAULT_HOT4 = HOT4;

const TIER_BY_GRADE = { 1: 'low', 2: 'low', 3: 'mid', 4: 'heavy', 5: 'reasoning' };

// Keyword match with a STEM-vs-WHOLE-WORD convention (the trailing-* marker):
//   - a keyword ending in `*` is a PREFIX/STEM: strip the `*`, anchor a leading \b
//     only (no trailing boundary), so it catches the stem + every suffix —
//     `authenticat*` -> authenticate/authentication, `migrat*` -> migrations.
//   - any other keyword is WHOLE-WORD: leading AND trailing \b, so it matches the
//     word but NOT a longer word that merely starts with it —
//     `token` matches "token" but NOT "tokenizer"; `secret` not "secretary".
// This kills the over-match class (token->tokenizer, session->sessionStorage,
// crypto->cryptocurrency) WITHOUT breaking intended stems. `text` is already lowercased.
// (`\b` after a word char still admits the trailing 's' of a plural, e.g. /\btoken\b/
//  matches "tokens" at the boundary before 's'? no — it requires a boundary right after
//  'token'; "tokens" has no boundary there. Plurals of whole-words are NOT auto-caught —
//  list both forms or use a stem where the plural matters. Stems (*) catch plurals.)
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const includesAny = (text, list) =>
  list.find((k) => {
    const raw = String(k).toLowerCase();
    const stem = raw.endsWith('*');
    const word = escapeRe(stem ? raw.slice(0, -1) : raw);
    if (!word) return false;
    return new RegExp('\\b' + word + (stem ? '' : '\\b')).test(text);
  });

// Merge config.keywords over the factory groups (per group: a config group carrying a
// `words` array replaces/adds that named group). The legacy flat `hotKeywords` maps onto
// a grade-4 sensitive group so OLD configs keep forcing a high grade (backward-compat).
function mergeKeywordGroups(config) {
  const groups = { ...DEFAULT_KEYWORD_GROUPS };
  const ck = config.keywords;
  if (ck && typeof ck === 'object' && !Array.isArray(ck)) {
    for (const name of Object.keys(ck)) {
      const grp = ck[name];
      if (grp && typeof grp === 'object' && Array.isArray(grp.words)) groups[name] = grp;
    }
  }
  if (Array.isArray(config.hotKeywords) && config.hotKeywords.length) {
    groups['legacy.hotKeywords'] = { grade: 4, sensitive: true, words: config.hotKeywords };
  }
  return groups;
}

// grade({ prompt, files, sizeUnits, config }) -> { grade, tier, reasons, sensitive, preserveVoice }
//   prompt    : the task text (keyword scan)
//   files     : optional [{ path, lines }] in scope (the coding view)
//   sizeUnits : optional generalized content size for NON-code work — words/chars
//               for translation/research/docs. CoalTipple is general-purpose, so
//               "lines" is just the coding instance of a universal content-size axis.
//   config    : merged .coaltipple.json (keywords / sensitivePaths / excludePaths / hotKeywords override defaults)
// Beyond grade+tier it returns `sensitive` (a never-delegate-DOWN task — crypto/auth/
// payment/regulated; keyed on a sensitive GROUP or PATH, NOT on the grade, so a weak
// main that under-grades cannot bypass the hard gate) and `preserveVoice` (the prose
// is the user-facing deliverable — don't delegate it to a cheaper model).
export function grade(args = {}) {
  // Coerce at the boundary — a destructuring default (`= {}`, `= []`) fires ONLY on
  // `undefined`, never on an explicit `null`, so grade(null) / grade({files:null}) /
  // grade({config:null}) would throw. A boundary authority must DEGRADE, not crash:
  // normalize the whole arg, then each field, to a safe default.
  const a = (args && typeof args === 'object') ? args : {};
  const prompt = a.prompt == null ? '' : a.prompt;
  const sizeUnits = a.sizeUnits == null ? 0 : a.sizeUnits;
  const files = Array.isArray(a.files) ? a.files : [];
  const config = (a.config && typeof a.config === 'object' && !Array.isArray(a.config)) ? a.config : {};
  const reasons = [];
  let g = 1;
  let sensitive = false;
  let preserveVoice = false;

  const sensitivePaths = config.sensitivePaths && config.sensitivePaths.length ? config.sensitivePaths : DEFAULT_SENSITIVE;
  const exclude = config.excludePaths && config.excludePaths.length ? config.excludePaths : DEFAULT_EXCLUDE;
  const text = String(prompt).toLowerCase();

  // 1. Content size / breadth (excluded dirs never count). Lines for code, or a
  //    generalized sizeUnits (words/chars) for non-code work — whichever is larger.
  const scoped = files.filter((f) => f && f.path && !exclude.some((x) => f.path.toLowerCase().includes(String(x).toLowerCase())));
  const fileCount = scoped.length;
  const fileLines = scoped.reduce((n, f) => n + (Number(f.lines) || 0), 0);
  const maxLines = scoped.reduce((n, f) => Math.max(n, Number(f.lines) || 0), 0);
  const size = Math.max(fileLines, Number(sizeUnits) || 0);

  if (fileCount > 3 || maxLines >= 1000 || size >= 1000) { g = Math.max(g, 4); reasons.push(`size: ${fileCount} file(s) / ${size} units`); }
  else if (fileCount >= 2 || size >= 500) { g = Math.max(g, 3); reasons.push(`size: ${fileCount} file(s) / ${size} units`); }
  else if (fileCount === 1 || size > 0) { g = Math.max(g, 2); reasons.push(fileCount ? '1 file edit' : `content: ${size} units`); }

  // 2. Sensitive PATH -> >=4 + sensitive (never-down) even at 1 file.
  const hitSensitive = scoped.find((f) => sensitivePaths.some((s) => f.path.toLowerCase().includes(String(s).toLowerCase())));
  if (hitSensitive) { g = Math.max(g, 4); sensitive = true; reasons.push(`sensitive path: ${hitSensitive.path}`); }

  // 3. Keyword GROUPS -> floor the grade + flag sensitive / preserveVoice, regardless of
  //    size. The sensitive flag is keyed on the matched group, NEVER on the grade number —
  //    that is the hard gate a weak main's under-grade cannot slip past.
  const groups = mergeKeywordGroups(config);
  const matched = [];
  for (const name of Object.keys(groups)) {
    const grp = groups[name];
    if (!grp || !Array.isArray(grp.words)) continue;
    const hit = includesAny(text, grp.words);
    if (!hit) continue;
    g = Math.max(g, Math.min(5, Math.max(1, Math.floor(Number(grp.grade)) || 1))); // clamp a config grade to an integer 1-5 (never emit an undefined tier)
    if (grp.sensitive) sensitive = true;
    if (grp.preserveVoice) preserveVoice = true;
    matched.push(`${name}(${Number(grp.grade) || 1}):${hit}`);
  }
  if (matched.length) reasons.push(`keyword ${matched.join(', ')}`);

  if (reasons.length === 0) reasons.push('trivial: read/search/format');
  return { grade: g, tier: TIER_BY_GRADE[g], reasons, sensitive, preserveVoice };
}
