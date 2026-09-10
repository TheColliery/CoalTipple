#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// CW-017 -- zero-dep link/anchor checker (Phoenix #2: node:fs + node:path only, no
// network, no npm dependency). Closes the canon MUST at .github/SKILL-REPO-PATTERN.md:91
// ("markdownlint checks markdown FORMAT; nothing checks that a link in it actually
// resolves"), which CWK-065 had already flagged as this room's own drift with no
// recorded reason. Ported in SHAPE from CoalLedger's own link-check gate (88bc0bd,
// fixed 52b2bc4) -- not its engine: that room's checker is a vendored CommonMark+GFM
// AST (its own doc-structure canary's engine, reused); this room has no AST vendored
// and the canon's own DEFAULT reading is "a small scripts/lib/link-check.mjs walking
// the repo's own .md files" -- so this is that default, built fresh, regex-based.
//
// WHAT THIS CHECKS, and nothing more:
//   1. an internal relative link `](path)` resolves to a real file, joined against
//      the CITING FILE's own directory -- standard markdown link semantics (a
//      renderer resolves a relative link against the document it lives in, never
//      against a repo root), and the same resolution rule this room already landed
//      for backtick path CITATIONS in pointer-check.mjs (CWK-075 FIX 2). Unlike
//      pointer-check, there is no root-relative fallback here: a real `[text](path)`
//      link has exactly one correct resolution, so there is nothing to fall back to.
//   2. a `#anchor` resolves to a heading in the target file -- both the same-file
//      form (`](#x)`) and the cross-file form (`](other.md#x)`).
// `![alt](path)` is checked identically to `[text](path)` for PATH resolution (a
// broken image path is the same defect class as a broken link path); the exclusion
// below is specifically ALT-TEXT CONTENT, which this engine never reads or judges.
//
// WHAT IS OUT, by design: external URLs and any other schemed target (`mailto:`,
// `tel:`, ...), protocol-relative (`//host/...`), absolute (`/...`) and home-relative
// (`~/...`) targets, bare autolinks (`<https://...>` -- a different syntax this
// engine's [text](target) regex never matches), and GFM table shape (the canon
// itself calls that optional; CoalLedger's own AST engine owns it and this room is
// not vendoring one for one check).
//
// A DELIBERATE DIVERGENCE from pointer-check.mjs's own OUTSIDE regex, stated because
// the two modules sit side by side and a reader will compare them: pointer-check's
// scheme test requires `://` (its domain is backtick-quoted PROSE, where a bare
// `label:value` shape is a real false-positive risk). This module's domain is REAL
// markdown link syntax, where a scheme prefix with no `//` (`mailto:`, `tel:`) is
// unambiguously a URI, never a relative file path -- so the scheme test here does
// NOT require `//`, or `mailto:` links would silently reach the file-resolution
// check and FAIL as if they named a missing file.
const OUTSIDE = /^([~/]|[A-Za-z]:|[a-z][a-z0-9+.-]*:)/i;

// Fenced code blocks are EXAMPLES, not real link/heading claims about this tree --
// the same rule and the same regex shape pointer-check.mjs already uses for backtick
// path citations, applied here to both link syntax and heading syntax (a `#`-prefixed
// shell comment inside a fenced block must never be read as a markdown heading).
function stripFences(text) {
  return String(text).replace(/^```[\s\S]*?^```/gm, '');
}

// LINK EXTRACTION. Deliberately does not handle a target containing a literal space
// (CommonMark spells that as `<a target.md>` or percent-encoding; neither appears in
// this room's own ship-text, measured before choosing this shape) -- a target with a
// space is invisible to this regex the same way an unbacktick citation is invisible
// to pointer-check's funnel: a named, measured blind spot, not a denial.
const LINK_RE = /(!?)\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

export function extractLinkTargets(text) {
  const out = [];
  for (const m of stripFences(text).matchAll(LINK_RE)) out.push(m[2]);
  return out;
}

// SLUG ALGORITHM, matching GitHub's own heading-anchor rules (github-slugger's
// published behaviour, re-implemented here rather than vendored, per Phoenix #2):
// lowercase -> trim -> collapse each WHITESPACE RUN to one hyphen FIRST -> THEN strip
// every character that is not a Unicode letter, Unicode number, underscore, or the
// ASCII hyphen. The ORDER of those last two steps is the part a guess gets wrong: an
// emoji-prefixed heading like `🚀 Getting started` collapses its leading space to a
// hyphen BEFORE the emoji is stripped, so the emoji vanishes and the hyphen that
// separated it from the text is LEFT BEHIND -- producing a LEADING hyphen in the
// slug, not a clean one. Unicode letters are kept (`\p{L}`, not `[a-z]`) so a Thai or
// CJK heading slugs to its own BASE letters -- never to an empty string.
//
// THE NAMED BOUND (findings-back, CW-017 round 1 MEDIUM-1/MEDIUM-2 -- both widened
// past the head's first draft, which claimed more than it had measured): this strip
// class drops `\p{M}` (Unicode COMBINING MARKS) along with everything else it is not
// listed to keep, and the mark class is exactly what carries a Thai vowel/tone sign
// or emoji's VARIATION SELECTOR (U+FE0F) -- so a Thai heading with real vowels/tones
// slugs to CONSONANTS ONLY (`ตัวอย่าง` -> `ตวอยาง`, pinned in link-check.test.mjs, the
// case a prior fixture in this room avoided), never to an empty
// string but genuinely lossy. Whether GitHub's own real algorithm ALSO drops `\p{M}`
// (github-slugger's own reported U+FE0F behaviour) is an UNVERIFIED VENDOR CLAIM --
// no authoritative source is cited for it here, and this room's own source-grounding
// rule names that state explicitly (never "settled"). MEASURED, not assumed: across
// this room's own 12-file live scope, 6 of 174 headings carry `\p{M}` (all six are
// emoji VARIATION SELECTORS, not Thai) and exactly 0 in-tree anchor citations point
// at any of the six -- the DISCRIMINATING POPULATION between "drop `\p{M}`" and
// "keep `\p{M}`" is ZERO here today, so this bound is prospective correctness, not a
// live defect, and no code change follows from it.
export function slugifyHeading(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[\t\n\v\f\r ]+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '');
}

// HEADING EXTRACTION + PER-FILE DEDUPLICATION. GitHub scopes anchor uniqueness to
// the WHOLE document (not per heading-level, not per section) -- CHANGELOG.md's own
// repeated `### Fixed` / `### Changed` headings across releases are exactly this
// room's own live case for the `-1`, `-2` suffix. First occurrence of a slug keeps
// the bare form; each repeat appends `-N`, N counting from 1.
export function extractHeadingSlugs(text) {
  const seen = new Map();
  const slugs = [];
  for (const m of stripFences(text).matchAll(/^#{1,6}\s+(.+?)\s*$/gm)) {
    const base = slugifyHeading(m[1]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    slugs.push(n === 0 ? base : `${base}-${n}`);
  }
  return new Set(slugs);
}

// POSIX join with a `..`-floor -- the same shape as pointer-check.mjs's own
// `joinRel` (CWK-077's proven-impossible-by-construction normaliser), duplicated
// rather than imported: the two gates evolve independently and a shared helper
// would couple them for an 8-line utility. `dir` is the CITING file's own directory,
// always (see the module header) -- there is no second root to fall back to here.
function joinRel(dir, tok) {
  const parts = `${dir}/${tok}`.split('/').filter((p) => p && p !== '.');
  const out = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

// CHECK -- plan-driven and DI'd (repo/resolve/readHeadings), the same shape
// pointer-check.mjs's checkPointers()/collectSurfaces() already use in this room, so
// a unit test drives real logic with fake IO and never needs a live git repo.
//   surfaces:     [{ label, text, dir }] -- dir = the file's OWN directory, POSIX,
//                 '' for a root-level file.
//   resolve(rel): POSIX repo-relative path -> 'exists' | 'missing'.
//   readHeadings(rel): POSIX repo-relative path -> Set<slug> | null (null = unreadable).
export function checkLinks({ surfaces = [], resolve, readHeadings } = {}) {
  const findings = [];
  if (typeof resolve !== 'function' || typeof readHeadings !== 'function') {
    findings.push({ level: 'FAIL', msg: 'link-check: no resolve()/readHeadings() supplied -- the gate cannot answer its own question' });
    return findings;
  }
  for (const s of surfaces) {
    if (typeof s.text !== 'string') {
      findings.push({ level: 'SKIP', msg: `link-check could not read ${s.label}` });
      continue;
    }
    const ownHeadings = extractHeadingSlugs(s.text);
    for (const target of extractLinkTargets(s.text)) {
      if (OUTSIDE.test(target)) continue;
      const hashAt = target.indexOf('#');
      const pathPart = hashAt === -1 ? target : target.slice(0, hashAt);
      const anchor = hashAt === -1 ? null : target.slice(hashAt + 1);

      if (pathPart === '') {
        // Bare `#anchor` -- same-file form, checked against this file's OWN headings.
        if (anchor && !ownHeadings.has(anchor)) {
          findings.push({ level: 'FAIL', msg: `${s.label} links to \`#${anchor}\`, which matches no heading in this file` });
        }
        continue;
      }

      const rel = joinRel(s.dir || '', pathPart);
      if (resolve(rel) !== 'exists') {
        findings.push({ level: 'FAIL', msg: `${s.label} links to \`${target}\`, which does not resolve to a tracked file (joined as ${rel})` });
        continue;
      }
      if (anchor) {
        const targetHeadings = readHeadings(rel);
        if (targetHeadings === null) {
          findings.push({ level: 'FAIL', msg: `${s.label} links to \`${target}\`, but ${rel} could not be read to check the anchor` });
        } else if (!targetHeadings.has(anchor)) {
          findings.push({ level: 'FAIL', msg: `${s.label} links to \`${target}\`, which matches no heading in ${rel}` });
        }
      }
    }
  }
  return findings;
}

// CLI entrypoint -- `node scripts/lib/link-check.mjs <file...>`, every arg a POSIX
// repo-relative path (the caller's job to enumerate; this engine never shells out to
// git -- see the module header). Node builtins only (fs/path/url), statically
// imported: node/runtime.md §1's dynamic-import rule binds a GATE's imports of its
// OWN scripts/lib/ helpers (an ERR_MODULE_NOT_FOUND risk this file has none of,
// since it imports no local module); a node: builtin cannot go missing at runtime,
// so static import here is both simpler and outside that rule's own reason to exist.
function main() {
  const files = process.argv.slice(2);
  const cache = new Map(); // rel -> text|undefined, so readHeadings() re-reads nothing main() already read

  const readRel = (rel) => {
    if (cache.has(rel)) return cache.get(rel);
    let text;
    try { text = fs.readFileSync(rel, 'utf8'); } catch { text = undefined; }
    cache.set(rel, text);
    return text;
  };

  const surfaces = files.map((f) => ({ label: f, text: readRel(f), dir: path.dirname(f).replace(/\\/g, '/').replace(/^\.$/, '') }));
  const findings = checkLinks({
    surfaces,
    resolve: (rel) => (readRel(rel) !== undefined ? 'exists' : 'missing'),
    readHeadings: (rel) => { const t = readRel(rel); return t === undefined ? null : extractHeadingSlugs(t); },
  });

  let failCount = 0;
  for (const f of findings) {
    console.log(f.level === 'FAIL' ? `FAIL ${f.msg}` : `--   ${f.msg}`);
    if (f.level === 'FAIL') failCount++;
  }
  console.log(`${failCount} finding(s) across ${files.length} file(s)`);
  process.exitCode = failCount > 0 ? 1 : 0;
}

// Only run as a CLI when invoked directly (node scripts/lib/link-check.mjs ...) --
// a unit test imports the pure exports above and never reaches this branch. Sync
// entrypoint (no await anywhere in main()) -> try/catch is the correct fail-silent
// SHAPE per node/runtime.md §7 -- except this is a fail-LOUD CLI (hooks-safety.md
// §1.0's user-invoked-CLI row), so nothing is swallowed here; an uncaught throw is
// exactly what "fail loud" asks for on a genuine defect (a per-file read failure is
// already handled gracefully above, inside checkLinks() via readRel()'s own catch).
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
