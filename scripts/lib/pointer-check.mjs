// CWK-075 -- POINTER gate, ported from CoalBoard's pointer-check.mjs (516c52c), which itself
// ported from CoalMine's (092fd24). Ship-text names a file, and nothing resolves it against
// the actual tree.
//
// WHY THIS IS NOT CWK-060's GATE. That one resolves KEYS against config-schema.mjs. These
// are POINTERS -- to a file or a directory -- and nothing resolved them. Same family,
// different resolver: the key gate asks "is this name in the schema", this one asks "is the
// thing this name points at REACHABLE FROM A CLONE".
//
// THE CHAIR'S RULING THIS ENFORCES (settled; this module does not re-decide it): a probe
// cited as proof is not a throwaway. Cite the DURABLE artefact -- a commit SHA, a reviewer
// return, a lab record -- and recycle the probe; if the probe file is the only evidence, it
// has stopped being a throwaway, so commit it or restate the claim. A GITIGNORED PATH IS NOT
// A DURABLE CITATION. The gate enforces that distinction. It does NOT ban citations, and the
// shape of that restraint is the whole detection rule below.
//
// ============================================================================
// DETECTION RULE, measured on THIS repo's own surfaces before it was chosen (AGENTS.md, THE
// SOURCE'S VARIABLES ARE NOT OURS -- CoalBoard's own numbers (12.2% noise) and CoalMine's
// (0.0%) describe THEIR trees, not ours; CoalTipple measured 51.4% raw noise on the identical
// funnel and did NOT accept it -- see FUNNEL DEFECTS below):
//
//   step                                              occurrences  distinct
//   0  every backticked token in prose                   1153         (n/a, per-surface)
//   1  path-shaped (has `/`, or a file extension)          611          -
//   2  no whitespace                                       ~          -
//   3  no `<placeholder>` angle brackets                    -          -
//   4  no glob metacharacters                               -          -
//   5  has a DIRECTORY component                           149          -
//   ...ourRoots/ignoredRoots membership (post-fix, below)   37 distinct final candidates
//
//   Final (AFTER the three funnel fixes below): re-derive on demand -- see verify.mjs's own
//   pass line, and CWK-075's dispatch return, for the live number; never quote a number here
//   as a standing claim.
//
// THREE FUNNEL DEFECTS FOUND ON OUR OWN DATA, fixed here rather than hand-waved as "noise"
// (CWK-075, this room's own measurement -- 51.4% raw noise on the shared funnel, sharply
// worse than CoalBoard's 12.2% and CoalMine's 0.0%, was NOT accepted; classified by hand
// first, then fixed at the mechanism, per-cause):
//
//   FIX 1 -- BARE-DOMAIN URLS. The OUTSIDE regex only recognised a SCHEMED url
//   (`https://...`); a scheme-less domain citation (`github.com/TheColliery/CoalTipple/issues`)
//   slipped through as if it were an in-repo path. Widened with a DOMAIN_LIKE test: a token
//   whose text before the first `/` looks like a dotted hostname is external, schemed or not.
//
//   FIX 2 -- RELATIVE-TO-CITING-SURFACE RESOLUTION (an extension of the exemplar's own
//   resolve() contract, not a new step in pointerCandidates()). `skills/coaltipple/SKILL.md`
//   cites `references/lock.md` and `references/damage-control.md` -- REAL files at
//   `skills/coaltipple/references/`, but cited RELATIVE TO THE CITING FILE's own directory,
//   never the repo root. Neither CoalBoard's nor CoalMine's SKILL.md does this (their own
//   references are cited by full path), so neither exemplar needed this fallback -- it is
//   CoalTipple's own variable, not a port. `checkPointers()` therefore accepts an optional
//   `s.dir` per surface and, ONLY when a token's own first segment matches neither ourRoots
//   nor ignoredRoots, retries the token joined onto `s.dir` before giving up on it. Tried as
//   a FALLBACK, after the root-relative reading fails to classify, so an ordinary
//   root-relative citation is never shadowed by an accidental same-name subpath elsewhere.
//
//   FIX 3 -- SLASH IS NOT A PATH (7 of the original 19 "missing" candidates): `provider/model-id`,
//   `low/mid/heavy/reasoning`, `chars/4`, a CodeQL rule id (`js/unused-local-variable`),
//   `dest/coaltipple`, and two EXAMPLE paths describing a hypothetical USER repo in prose
//   (`src/auth-dist/login.js`, `payment/distributor.js`). None of these needed a funnel change:
//   every one has a first segment (`provider`, `low`, `chars`, `js`, `dest`, `src`, `payment`)
//   that is not a real CoalTipple root and not gitignored here, so the EXISTING
//   `ourRoots.has(first)` gate already drops every one of them once ourRoots is the real,
//   measured set (six directories -- see PC_OUR_ROOTS at the call site) rather than a
//   placeholder. Recorded as a fix category because the FIRST draft of this gate's ourRoots
//   set was wrong/incomplete, not because the gate's shape needed to change.
//
//   The remaining genuinely OUT-OF-REPO / RETIRED class (umbrella `TheColliery/...` and
//   `scratchpad/...` paths, a retired `eval/` dir, bare dir-fragment words like `proposed`,
//   `coal`, `docs`) is exactly what `historyOnly` / `ourRoots`-membership / the two
//   declaration lists below exist for -- not a funnel bug, the funnel working as designed.
//
// THE INSIGHT THAT MAKES THE RULE WORK, and a naive rule unusable: a shipped skill's prose
// names files in the SCANNED USER's repo (`.coaltipple.json`, a bare `SKILL.md`) which by
// construction do not exist in ours. Steps 5-8 (directory component, not absolute/url/domain,
// first segment not a dot-dir, first segment is OURS or gitignored) are ways of saying the
// same thing: only a path ROOTED IN OUR OWN TREE is a claim this repo can be wrong about.
//
// FOUR NAMED BLIND SPOTS, ported from the exemplar (CoalBoard's own measurement; re-verify on
// this room's data before trusting a number, never assume it transfers unchanged):
//
//   1. Step 7 excludes EVERY dot-dir. `.github/` IS TRACKED here (workflows, dependabot.yml,
//      codeql config) -- a shipped doc citing `.github/workflows/ci.yml` goes UNCHECKED.
//      Measured cost today: zero (no in-scope surface currently cites `.github/...`). Revisit
//      by hand the day one does -- prose, not a machine.
//
//   2. A same-named root shared with a SIBLING repo (e.g. a hypothetical `agents/` this room
//      does not have, but the SHAPE applies to any future same-named top-level dir) would be
//      silently admitted as "ours" whenever the first segment happens to match. Not
//      reproduced on CoalTipple's own data at build time (this room's ourRoots do not collide
//      with a sibling's non-shared root today) -- named so the next reader does not
//      rediscover it as new.
//
//   3. A cross-repo PREFIX is invisible at the ourRoots/ignoredRoots step, the same step as
//      blind spot 2 but the opposite failure: not a same-named root, a DIFFERENT-named one. A
//      citation rooted one level above this repo's checkout (the umbrella's own name) has a
//      first segment matching neither set, and is dropped SILENTLY as someone else's tree.
//      NOT the unbacktick case -- these are fully backticked, well-formed tokens the funnel
//      reads and correctly files as out of scope by its own rule. The backstop is a human
//      `grep` for the umbrella's own gitignored roots (`scratchpad/`, etc.), same as blind
//      spot 4's.
//
//   4. An UNBACKTICKED path is invisible to the ENTIRE funnel, at step 0, before any filter
//      runs -- `pointerCandidates()` only reads inside `` `...` `` pairs. This is the
//      funnel's WIDEST limit. Why it is not widened: a backtick is the only delimiter this
//      funnel has to anchor on; without it, every slash-shaped phrase in a sentence becomes a
//      candidate ("see the docs/notes on this" is not a path), which is exactly the
//      false-positive flood steps 0-8 exist to keep out. The standing backstop is a plain
//      `grep -rn` for this room's own gitignored roots, run by hand. MEASURED COST, carried
//      inline rather than deferred to a return that will not exist next year (blind spot 1's
//      own shape, three paragraphs up -- a blind spot pointing at a future document is a
//      blind spot that stops being checkable the day that document is gone): the same 8
//      surfaces produce **2 distinct unbackticked path-shaped citations**, both on the SAME
//      line (README.md's key-reference sentence): the URL HALF of a `[`label`](url)`
//      markdown link is plain text even though the LABEL beside it is backticked --
//      `scripts/lib/config-schema.mjs` and `platform-configs/.coaltipple.json`. Both RESOLVE
//      TRACKED (`git ls-files --error-unmatch`, checked individually). Zero defects hide
//      behind this blind spot TODAY.
//
//      A CORRECTION TO A PRIOR DRAFT OF THIS COUNT, kept because the method matters more than
//      the number: a first pass counted 7, by literal-string grep with no positional check --
//      it caught `scripts/build-dist.mjs`, `scripts/build-plugin.mjs`, `scripts/test.mjs`,
//      `scripts/verify.mjs` (each cited once, inside a fenced ```bash example block in
//      README.md or CONTRIBUTING.md) and `scripts/configure.mjs` (never found as a genuinely
//      unbackticked, non-fenced string at all -- every real occurrence is either fully
//      backticked as part of a command, or the BARE filename `configure.mjs` with no
//      directory component, dropped at step 1 regardless of backticks). A fenced-block
//      command example is NOT this blind spot: `pointerCandidates()`'s own first
//      transformation strips fenced blocks before the backtick scan ever runs ("Fenced code
//      blocks are EXAMPLES, not prose claims about this tree") -- that is a documented,
//      DELIBERATE exclusion, working exactly as designed, not an accidental gap. Conflating
//      "inside a stripped fence" with "outside every backtick, in live prose" overcounts this
//      blind spot with instances of a DIFFERENT, already-correct behavior. Re-derived with a
//      script that strips fences the same way `pointerCandidates()` does and checks each
//      occurrence's actual position against the real backtick spans, not a bare grep.
//
//      Re-derive rather than trust either number on the next touch of any of the 8 surfaces --
//      an unbackticked citation is exactly the shape that changes without this file's own
//      gate noticing.
//
// ============================================================================
// WHAT IS NOT SHIPPED. Section and symbol resolvers were considered and are NOT built here,
// on the same measurement CoalMine and CoalBoard already ran and reported (a section-reference
// matcher floods on natural-language "X ... below" phrasing; a symbol resolver's false flags
// are dominated by names cited as REJECTED alternatives, not names we call -- CoalBoard
// 17.1% noise all-false, CoalMine 17.8% all-false, main's ruling: after a filter strong
// enough to remove those, the survivors all resolve -- a gate catching nothing). Re-deriving
// that measurement on our own surfaces was not repeated -- the mechanism-level finding
// (natural language defeats a purely lexical section/symbol matcher) does not depend on which
// repo's prose it is run against. Path is machine-checked; section and symbol are not checked
// at all -- see verify.mjs's own pass line, which states this rather than implying coverage
// it does not have.
//
// ============================================================================
// ADOPTER CONTRACT -- DATA, never LOGIC (with ONE named exception: FIX 1 and FIX 2 above are
// LOGIC changes to the shared extraction/resolution shape, made because this room's own
// measurement found real defects the exemplar's data never exercised. Both are documented
// here as CoalTipple-measured corrections, not CoalTipple-specific layout, and are candidates
// for a future upstream port -- not this unit's call to make). Everything else below hardcodes
// nothing: a room supplies its own surfaces (walked), its own ourRoots and ignoredRoots
// (derived from ITS tree), its own resolve(), and its own pending list.

// A path this room deliberately points at BEFORE it exists. Ships EMPTY unless a real forward
// pointer needs one -- the mechanism exists anyway: without an escape hatch the first
// legitimate forward pointer hard-FAILs, and the cheapest way to make a FAIL go away is to
// delete the gate. Same EVENT-based expiry as CWK-060's PENDING_KEYS/NOT_CONFIG/BLIND_KEYS --
// pruned by what BECOMES TRUE, never by a date nobody re-reads.
export const PENDING_POINTERS = [
  // { path: 'scripts/lib/thing.mjs', reason: 'CWK-000 -- landing next unit' },
];

const GLOB = /[*?[\]{}|]/;
const OUTSIDE = /^([~/]|[A-Za-z]:|[a-z][a-z0-9+.-]*:\/\/)/;
// FIX 1 (CWK-075): a scheme-less domain citation (`github.com/...`) is external too. Matches
// a dotted-hostname shape before the first `/` -- deliberately requires an embedded `.` so an
// ordinary path segment (`scripts`, `.claude-plugin`) never matches (no leading alnum before a
// dot for a dot-dir, no dot at all for a plain dir name).
const DOMAIN_LIKE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+\//i;

// Candidate extraction. Exported so an adopter (or a future audit here) can measure its OWN
// funnel with the same instrument rather than re-implementing it and getting different
// numbers.
export function pointerCandidates(text) {
  const out = [];
  // Fenced code blocks are EXAMPLES, not prose claims about this tree.
  const prose = String(text).replace(/^```[\s\S]*?^```/gm, '');
  for (const m of prose.matchAll(/`([^`\n]+)`/g)) {
    const tok = m[1];
    if (/\s/.test(tok)) continue;          // a command or a table row, not a pointer
    if (/[<>]/.test(tok)) continue;        // <placeholder>
    if (GLOB.test(tok)) continue;          // a glob names a SET, not a file
    if (!tok.includes('/')) continue;      // a bare filename is the USER's repo's
    if (OUTSIDE.test(tok)) continue;       // absolute, home-relative, or a schemed URL
    if (DOMAIN_LIKE.test(tok)) continue;   // a scheme-less domain (CWK-075 FIX 1)
    if (tok.startsWith('.')) continue;     // a dot-dir is an agent/tool home (blind spot 1)
    out.push(tok);
  }
  return out;
}

// `docs/x.md:12` and `scripts/` both name a real thing; the suffix and the trailing slash
// are punctuation, not part of the path.
function normalise(tok) {
  return tok.replace(/:\d+(-\d+)?$/, '').replace(/\/+$/, '');
}

function joinRel(dir, tok) {
  // POSIX join, deliberately hand-rolled instead of importing `path` -- this module has no
  // other dependency on Node's path module and the join here is a single `/`-normalise, not
  // worth a platform-specific import for.
  const parts = `${dir}/${tok}`.split('/').filter((p) => p && p !== '.');
  const out = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

export function checkPointers({
  surfaces = [],            // [{ label, text, historyOnly?, dir? }]
  ourRoots = new Set(),     // top-level names that belong to THIS repo
  ignoredRoots = new Set(), // top-level dirs/files this repo gitignores
  resolve,                  // (relPath) => 'tracked' | 'untracked' | 'missing'
  pending = PENDING_POINTERS,
} = {}) {
  const findings = [];
  if (typeof resolve !== 'function') {
    findings.push({ level: 'FAIL', msg: 'pointer check: no resolve() supplied -- the gate cannot answer its own question' });
    return findings;
  }

  const cited = new Set();
  let checked = 0;

  for (const s of surfaces) {
    if (typeof s.text !== 'string') {
      // NAME what could not be read. A caller that filters unreadable surfaces out first
      // hides its own scope gap -- the silent narrowing this family of gates exists to
      // catch, committed by the gate's own wiring.
      findings.push({ level: 'SKIP', msg: `pointer check could not read ${s.label}` });
      continue;
    }
    const seen = new Set();
    for (const tok of pointerCandidates(s.text)) {
      if (seen.has(tok)) continue;
      seen.add(tok);
      let effective = tok;
      let first = tok.split('/')[0];

      // FIX 2 (CWK-075): RELATIVE-TO-CITING-SURFACE. The raw token's own first segment
      // matches neither a real root nor a gitignored one -- before giving up on it as
      // "someone else's tree" (the ordinary ourRoots miss below), try it joined onto the
      // CITING surface's own directory. Only when the raw reading fails to classify, so a
      // genuine root-relative citation is never shadowed by this fallback.
      //
      // GATED ON A REAL SUB-PATH SURVIVING normalise(), not the raw token: a BARE DIRECTORY
      // FRAGMENT WITH ONLY A DECORATIVE TRAILING SLASH (`proposed/`, `coal/` -- both from
      // this room's own measurement, citing a USER-RUNTIME dir like `.claude/.coaltipple/`,
      // never a path in THIS repo) still `.includes('/')` on the RAW token, so without this
      // guard the join below would wrongly resolve it against the citing surface's own
      // directory and manufacture a false FAIL. `normalise()` strips the trailing slash
      // first; a token that no longer contains ANY '/' after that is a single bare word, not
      // a genuine relative sub-path, and is correctly left to the ordinary ourRoots-miss
      // silent drop below (the same disposition it had before this fix existed).
      if (!ourRoots.has(first) && !ignoredRoots.has(first) && s.dir && normalise(tok).includes('/')) {
        const joined = joinRel(s.dir, tok);
        const joinedFirst = joined.split('/')[0];
        if (ourRoots.has(joinedFirst) || ignoredRoots.has(joinedFirst)) {
          effective = joined;
          first = joinedFirst;
        }
      }

      // A GITIGNORED ROOT IS THE SHARP CASE, and it is decided WITHOUT resolving: from any
      // other machine "gitignored" and "does not exist" are indistinguishable, so such a
      // path was never durable -- not even on the day it was written. This branch runs
      // BEFORE `pending` is consulted, deliberately: a declaration can excuse a path that
      // does not exist YET, never one that exists and is unreachable from a clone. It also
      // binds a `historyOnly` surface, where the ordinary resolution check below does not --
      // the distinction: a renamed file was correct once, a scratchpad path never was.
      if (ignoredRoots.has(first)) {
        cited.add(normalise(effective));
        checked++;
        findings.push({
          level: 'FAIL',
          msg: `${s.label} cites \`${tok}\`, which lives under the gitignored \`${first}/\` -- not reachable from a clone. Cite the durable artefact (a commit SHA, a shipped doc) or commit the file.`,
        });
        continue;
      }

      if (!ourRoots.has(first)) continue; // a path into someone else's tree
      cited.add(normalise(effective));

      // Published history is never fixed forward: a path that was correct when the entry
      // was written is not a defect now. Such a surface is checked for the gitignored case
      // above and nothing else.
      if (s.historyOnly) continue;

      checked++;
      const rel = normalise(effective);
      const state = resolve(rel);
      if (state === 'tracked') continue;
      if (pending.some((p) => p && p.path === rel)) continue;
      if (state === 'untracked') {
        findings.push({ level: 'FAIL', msg: `${s.label} cites \`${tok}\`, which exists here but is UNTRACKED -- a clone does not have it. Commit it, or cite the durable artefact.` });
      } else {
        findings.push({ level: 'FAIL', msg: `${s.label} cites \`${tok}\`, which does not resolve in this repo` });
      }
    }
  }

  // EVENT-based expiry, both directions. A declaration list nobody prunes becomes a
  // permanent hole with an author's name on it.
  for (const p of pending) {
    if (!p || !p.path) { findings.push({ level: 'FAIL', msg: 'PENDING_POINTERS entry has no path' }); continue; }
    if (!p.reason) { findings.push({ level: 'FAIL', msg: `PENDING_POINTERS declares ${p.path} with no reason -- an allowlist of bare strings is a bypass with no author` }); }
    if (resolve(p.path) === 'tracked') {
      findings.push({ level: 'FAIL', msg: `PENDING_POINTERS declares ${p.path} as not-yet-existing, but it now resolves -- delete the entry` });
    } else if (!cited.has(p.path)) {
      findings.push({ level: 'FAIL', msg: `PENDING_POINTERS declares ${p.path}, but no in-scope surface cites it -- delete the entry` });
    }
  }

  findings.checked = checked;
  return findings;
}
