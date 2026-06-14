// Deterministic 0-token task grader — the routing AUTHORITY.
// Grades a task 1-5 from file/size/sensitive-path/keyword signals WITHOUT an
// LLM, so a cheap main model's overconfident self-assessment can never route a
// hard task to a weak tier (the escalation-mode safety backstop). Same input ->
// same grade (Phoenix #8 deterministic). Pure: no fs, no network, no deps.

import { HOT5, HOT4, SENSITIVE, EXCLUDE } from './keywords.mjs';

// Re-exported from the keyword SSoT (keywords.mjs) — so the grader and the
// conductor's synced copy can never disagree (the rot-canary "two sources of
// truth" fix). Edit keywords.mjs, not here.
export const DEFAULT_EXCLUDE = EXCLUDE;
export const DEFAULT_SENSITIVE = SENSITIVE;
export const DEFAULT_HOT5 = HOT5;
export const DEFAULT_HOT4 = HOT4;

const TIER_BY_GRADE = { 1: 'low', 2: 'low', 3: 'mid', 4: 'heavy', 5: 'reasoning' };

// Word-START-boundary match: catches the keyword + its suffixes/plurals
// (migration -> migrations) but NOT mid-word embeddings (immigration, anatomical),
// killing the loose-substring false-positive class. `text` is already lowercased.
const includesAny = (text, list) =>
  list.find((k) => new RegExp('\\b' + String(k).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(text));

// grade({ prompt, files, sizeUnits, config }) -> { grade, tier, reasons }
//   prompt    : the task text (keyword scan)
//   files     : optional [{ path, lines }] in scope (the coding view)
//   sizeUnits : optional generalized content size for NON-code work — words/chars
//               for translation/research/docs. CoalTipple is general-purpose, so
//               "lines" is just the coding instance of a universal content-size axis.
//   config    : merged .coaltipple.json (sensitivePaths / excludePaths / hotKeywords override defaults)
export function grade({ prompt = '', files = [], sizeUnits = 0, config = {} } = {}) {
  const reasons = [];
  let g = 1;

  const sensitive = config.sensitivePaths && config.sensitivePaths.length ? config.sensitivePaths : DEFAULT_SENSITIVE;
  const exclude = config.excludePaths && config.excludePaths.length ? config.excludePaths : DEFAULT_EXCLUDE;
  const hot4 = DEFAULT_HOT4.concat(config.hotKeywords || []);
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

  // 2. Sensitive path -> >=4 even at 1 file.
  const hitSensitive = scoped.find((f) => sensitive.some((s) => f.path.toLowerCase().includes(String(s).toLowerCase())));
  if (hitSensitive) { g = Math.max(g, 4); reasons.push(`sensitive path: ${hitSensitive.path}`); }

  // 3. Hot keyword -> forces 5 or 4 regardless of size.
  const k5 = includesAny(text, DEFAULT_HOT5);
  const k4 = includesAny(text, hot4);
  if (k5) { g = Math.max(g, 5); reasons.push(`hot keyword (reasoning): ${k5}`); }
  else if (k4) { g = Math.max(g, 4); reasons.push(`hot keyword (sensitive): ${k4}`); }

  if (reasons.length === 0) reasons.push('trivial: read/search/format');
  return { grade: g, tier: TIER_BY_GRADE[g], reasons };
}
