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
//   1. NARROWED (CWK-077, porting CoalMine's own fix at d5e1466): this blind spot used to
//      exclude EVERY dot-dir at step 7. `.github/` IS TRACKED here (workflows, dependabot.yml,
//      codeql config), so a shipped doc citing `.github/workflows/ci.yml` went UNCHECKED for
//      no reason -- the dot itself was never the hazard, only the specific dot-dirs a READER'S
//      OWN agent home can be. `checkPointers()` now holds out only `agentHomeRoots`, derived
//      from `config-load.mjs`'s own `AGENT_DIR_ORDER` (`.claude`/`.agents`/`.gemini`) -- never
//      a hand-copied second list -- and lets every other dot-dir (`.github`, `.claude-plugin`,
//      `.githooks`, ...) reach normal resolution.
//
//      MEASURED, DEDUPED -- checkPointers()'s own per-surface `seen` set (above) governs
//      behaviour, so these are the figures that matter; re-derive by walking pointerCandidates()
//      per surface through an equivalent `seen` set, never by a bare grep: 24 dot-prefixed
//      tokens reach this step / 15 held out by agentHomeRoots / 9 survive -- 2 RESOLVED tracked
//      (`.claude-plugin/plugin.json`, from commands/update.md and CONTRIBUTING.md -- the whole
//      live gain), 4 on CHANGELOG.md (historyOnly + ourRoots-matching, resolution skipped by
//      design), 3 DROPPED SILENTLY on CHANGELOG.md (`.coaltipple/ranking.json`,
//      `.coaltipple/proposed/`, `.coaltipple/` -- an ordinary ourRoots MISS, `.coaltipple`
//      matches no known root, NOT FIX 2's bare-word guard), 0 HARD FAIL. RAW (pre-dedup, a
//      different scale, cross-check only): 35 / 25 / 10. `.github/` coverage is PROSPECTIVE,
//      not live: BOTH its citations (`.github/SKILL-REPO-PATTERN.md` and
//      `.github/workflows/ci.yml`) sit on CHANGELOG.md, checked-into-ourRoots but never
//      resolved (historyOnly) -- the narrowing makes a future live citation verifiable, it
//      verifies none today.
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
// nothing: a room supplies its own surfaces (walked -- `DEFAULT_SURFACE_PLAN` below is this
// room's DEFAULT declaration of that supply, not a hardcoded fact about every room), its own
// ourRoots and ignoredRoots (derived from ITS tree), its own resolve(), and its own pending
// list.

// SURFACE PLAN, DECLARED (CWK-090 fix 3, ported from CoalMine's own port). What this room's
// `verify.mjs` used to hard-code as three separate walks (a single SKILL.md read, two
// `readdirSync` fans over `references/`+`commands/`, four root-doc reads, one CHANGELOG read)
// is now DATA -- one row per surface, each carrying its own `why`, so a reader answers "what
// does this gate walk" from a table instead of a driver.
//
// THE NARROWING FORM, one sentence an adopter copies rather than guesses: a room that walks
// fewer surfaces DELETES the row and states its reason in the row's own `why`, never by
// editing `collectSurfaces` or leaving the row in place unused.
//
// `kind` is one of two: `file` (a single exact path) · `md-dir` (a directory of markdown
// files, walked NON-recursively -- `references/` and `commands/` are flat in this room; a
// future recursive need is CoalMine's own variable, not ported here without one). `citerDir`
// is the directory FIX 2 joins a relative citation against (CWK-075 -- our own named
// deviation from the exemplar); `''` for a root-level file. `historyOnly: true` marks a
// surface `checkPointers` binds to the gitignored-root case only (CHANGELOG.md -- published
// history is never fixed forward, but a gitignored citation was never correct on any day).
//
// NARROWING APPLIED, stated HERE per the narrowing form above (findings-back, CWK-090): this
// plan carries only `file`/`md-dir` rows -- no `scripts/`+`hooks/` line-comment-scanning kind,
// which the wider exemplar (CoalBoard's own verify.mjs) additionally walks. That is not an
// omitted row (there is no `comments`-shaped row to point at and delete); it is a KIND this
// room's plan never had, so the reason lives here rather than in a row's own `why`: widening to
// scan comments would change the funnel numbers this ticket's own measurement, report, and
// INSPECT re-derivation are reproducible against. A future ticket may add a `comments` kind and
// a row for it; this plan does not, to keep those numbers stable until one does.
export const DEFAULT_SURFACE_PLAN = [
  { kind: 'file', root: 'skills/coaltipple/SKILL.md', citerDir: 'skills/coaltipple',
    why: 'the shipped skill body -- every ASK/rail/config claim starts here' },
  { kind: 'md-dir', root: 'skills/coaltipple/references', citerDir: 'skills/coaltipple/references',
    why: 'reference docs, cited relative to their OWN directory (FIX 2), never the repo root' },
  { kind: 'md-dir', root: 'commands', citerDir: 'commands',
    why: 'command docs are ship-text a user reads' },
  { kind: 'file', root: 'README.md', citerDir: '',
    why: 'the front door -- every install/config claim starts here' },
  { kind: 'file', root: 'SECURITY.md', citerDir: '',
    why: 'the disclosure surface, and it cites internal paths (e.g. a hook line ref)' },
  { kind: 'file', root: 'CONTRIBUTING.md', citerDir: '',
    why: 'the dev-facing surface, and it cites internal paths' },
  { kind: 'file', root: 'PRIVACY.md', citerDir: '',
    why: 'the privacy surface, and it cites internal paths' },
  { kind: 'file', root: 'CHANGELOG.md', citerDir: '', historyOnly: true,
    why: 'published history is never fixed forward -- a path correct when the entry was written is not a defect now, but a gitignored citation was never correct on any day' },
];

// COLLECT -- plan-driven, DI'd fs so this module stays pure (it imports nothing today and
// must not start). `io.join`/`io.listMd`/`io.read`/`io.rel` are the SAME filesystem
// primitives the caller already owns. Runs the plan in ORDER, so a room's own surface
// count/order is exactly its plan's -- no hidden reordering. `io.listMd(dir)` returns
// BASENAMES only (not recursive -- see DEFAULT_SURFACE_PLAN's own kind comment); the caller
// joins them back onto `dir` itself, so this function never assumes a path-join style.
export function collectSurfaces(repo, plan, io) {
  const surfaces = [];
  for (const row of plan) {
    if (row.kind === 'md-dir') {
      const abs = io.join(repo, row.root);
      for (const f of io.listMd(abs).filter((n) => n.endsWith('.md'))) {
        const fileAbs = io.join(abs, f);
        surfaces.push({ label: io.rel(fileAbs), text: io.read(fileAbs), dir: row.citerDir });
      }
    } else {
      const s = { label: row.root, text: io.read(io.join(repo, row.root)), dir: row.citerDir };
      if (row.historyOnly) s.historyOnly = true;
      surfaces.push(s);
    }
  }
  return surfaces;
}

// A path this room deliberately points at BEFORE it exists. Ships EMPTY unless a real forward
// pointer needs one -- the mechanism exists anyway: without an escape hatch the first
// legitimate forward pointer hard-FAILs, and the cheapest way to make a FAIL go away is to
// delete the gate. Same EVENT-based expiry as CWK-060's PENDING_KEYS/NOT_CONFIG/BLIND_KEYS --
// pruned by what BECOMES TRUE, never by a date nobody re-reads.
export const PENDING_POINTERS = [
  // { path: 'scripts/lib/thing.mjs', reason: 'CWK-000 -- landing next unit' },
];

// CHECK-IGNORE CLASSIFIER (CWK-090 fix 1, ported from CoalMine), pure -- takes the exact
// shape a `spawnSync('git', ['check-ignore', '--stdin'], {...})` result carries and answers
// ONE question: did this run actually tell us anything? Exit 0 and exit 1 both SUCCEED (1 =
// "none of the fed paths are ignored", not an error); a spawn error or any OTHER status (128
// included -- a bad pattern, an unreadable `.gitignore`, a broken worktree) means the run
// answered NOTHING, and the caller must not treat an empty stdout as "zero ignored". Exported
// and kept pure so this classification is unit-testable without a real git child for the
// non-0/1 branch specifically (the 0/1 cases ARE driven through a real git process in the
// test file -- only a genuine non-0/1 exit needs a synthetic `ci` shape, per this room's own
// measurement that git 2.55 tolerates every malformed-input fixture tried down to exit 1).
export function classifyCheckIgnoreResult(ci) {
  if (ci.error) {
    return { ok: false, message: `git check-ignore --stdin failed to spawn: ${ci.error.message}` };
  }
  if (ci.status !== 0 && ci.status !== 1) {
    const stderrLine = typeof ci.stderr === 'string' ? ci.stderr.split('\n')[0].trim() : '';
    return {
      ok: false,
      message: `git check-ignore --stdin exited ${ci.status}${stderrLine ? ` -- ${stderrLine}` : ''} -- cannot tell which cited roots are gitignored`,
    };
  }
  return { ok: true, stdout: typeof ci.stdout === 'string' ? ci.stdout : '' };
}

// APPLY the check-ignore probe's verdict onto `ignoredRoots`, or FAIL LOUDLY (CWK-090 fix 1,
// second half). `classifyCheckIgnoreResult` above is pure; this is the WIRING that ties it to
// the gate's own `fail()` -- the two-round lesson this room has now paid for four times
// (CWK-060 HIGH-1, CWK-078 abort-path, CWK-079 findings-back HIGH-1, and CoalMine's own
// identical HIGH on this exact classifier): a classification with no test driving the CALL
// SITE can be mutated to `if (false)` and leave the suite green, because nothing exercises
// the branch. Moved out of verify.mjs so a unit test can drive the EXACT code verify.mjs
// runs, with an injected `runCheckIgnore` in place of a real `spawnSync` -- the same DI shape
// `collectSurfaces(repo, plan, io)` above already uses for the surface walk, applied to the
// sibling spawn site. `runCheckIgnore(input)` takes the newline-joined probe input and
// returns the same `{status, stdout, stderr, error}` shape a real `spawnSync` result carries.
//
// A non-0/1 status now FAILS LOUDLY here, not merely a pass-line label -- CWK-090's own
// finding on ours: the prior shape set a flag and named the failure only in the SUCCESS pass
// line, which is skipped entirely whenever ANY hard finding exists elsewhere. A derivation
// that did not happen is exactly the mislabel class CWK-078/CWK-079 both paid for; a label in
// a line that may never print is the weaker half of it.
export function applyCheckIgnoreProbe({ toProbe, PROBE_SUFFIX, ignoredRoots, fail, runCheckIgnore }) {
  if (!toProbe.length) return;
  const ci = runCheckIgnore(toProbe.map((n) => n + PROBE_SUFFIX).join('\n') + '\n');
  const verdict = classifyCheckIgnoreResult(ci);
  if (!verdict.ok) {
    fail(verdict.message);
    return;
  }
  for (const line of verdict.stdout.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    ignoredRoots.add(t.endsWith(PROBE_SUFFIX) ? t.slice(0, -PROBE_SUFFIX.length) : t.replace(/\/$/, ''));
  }
}

const GLOB = /[*?[\]{}|]/;
const OUTSIDE = /^([~/]|[A-Za-z]:|[a-z][a-z0-9+.-]*:\/\/)/;
// FIX 1 (CWK-075): a scheme-less domain citation (`github.com/...`) is external too. Matches
// a dotted-hostname shape before the first `/` -- deliberately requires an embedded `.` so an
// ordinary path segment (`scripts`, `.claude-plugin`) never matches (no leading alnum before a
// dot for a dot-dir, no dot at all for a plain dir name).
const DOMAIN_LIKE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+\//i;
// findings-back (CWK-090) -- a BACKSLASH is not a separator either `joinRel` or the caller's
// resolve() reads. `joinRel` (below) splits on `/` only, so a `..` delimited by BACKSLASHES is
// invisible to it -- the token survives every shape test, takes the ourRoots branch on its
// FIRST (`/`-split) segment, and reaches resolve() with the backslash-delimited `..` still
// inside; on Windows path.resolve treats `\` as a separator and the stat lands OUTSIDE the repo
// (measured: the head's own probe, `scripts/..\..\escape.md` and
// `scripts/lib\..\..\..\etc\passwd`, both escape). THIS DOES NOT VIOLATE OUR NAMED DEVIATION
// (we normalise `/`-delimited `.`/`..` in joinRel rather than reject them, unlike CoalMine): the
// deviation binds the property the normaliser actually covers -- `/`-delimited segments -- and
// a backslash-delimited one is outside that coverage entirely, so rejecting it here is the ONLY
// mechanism for an uncovered half, never a second one for a covered property. Reject the
// CHARACTER, unconditionally, rather than widen joinRel's segment scan to read `\` too: a
// citation in our surfaces is `/`-delimited on every platform, full stop, and rejecting keeps
// that invariant platform-UNconditional instead of teaching the scanner a second separator.
// REACHABILITY measured before choosing this cure, never assumed: 121 candidate tokens across
// this room's 12 walked surfaces, ZERO contain a backslash -- a broken containment invariant
// with no live instance today, exactly like fix (b)'s CRLF probe. NAMED BLIND SPOT: a legitimate
// Windows-style citation is now dropped, unchecked and unannounced -- measured population zero;
// if that ever stops being zero, normalise separators at the boundary, never re-admit the
// character into a segment scan.
const BACKSLASH = /\\/;

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
    if (BACKSLASH.test(tok)) continue;     // not a separator this gate reads -- see above (findings-back)
    // NOTE: dot-dir tokens are NOT dropped here (CWK-077 -- narrowed blind spot 1). Only the
    // TOOL'S OWN agent-home roots are held out, and that decision needs the caller-supplied
    // `agentHomeRoots` set, which this function does not receive -- it happens in
    // checkPointers() below, at the same point ourRoots/ignoredRoots membership is decided.
    out.push(tok);
  }
  return out;
}

// LAST-SEGMENT SHAPE TEST (CWK-079, ported from CoalMine 7c7cb72/8fcf443) -- feeds ONLY
// verify.mjs's ignore-probe CANDIDATE-ROOT DISCOVERY, never pointerCandidates' own
// resolve-path population above. THIS GATES DISCOVERY, NOT JUDGEMENT: a token this test
// rejects can still be checked by checkPointers' own `ignoredRoots.has(first)` branch,
// NON-LOCALLY -- the moment some OTHER, unrelated, path-shaped citation shares its first
// segment and puts that root into `ignoredRoots`, every token sharing the root is judged,
// discovery-rejected or not. Pinned as a permanent regression test in verify.test.mjs
// with a two-plant pair (an extensionless citation alone, silent; the same citation
// beside an unrelated path-shaped sibling under the same root, both FAIL).
//
// THE DEFECT THIS CLOSES: a token containing `/` is not necessarily a path -- the no-`/`
// drop above (:212) proves the token HAS a slash, never what the slash SEPARATES.
// MEASURED on THIS room's own 12 surfaces (re-derive: walk pointerCandidates() over every
// surface, group by first segment, test each token with this function -- never trust a
// number pinned here): 27 distinct first segments reach today's un-narrowed
// candidate-root derivation; 6 have ZERO path-shaped citation anywhere and vanish
// entirely from discovery under this narrowing -- `provider` (`provider/model-id`, a
// placeholder pair), `low` (`low/mid/heavy/reasoning`, a tier enumeration), `chars`
// (`chars/4`, arithmetic), `js` (`js/unused-local-variable`, a CodeQL query id),
// `actions` (`actions/setup-node`, a GitHub Actions plugin ref), `dest`
// (`dest/coaltipple`, a copy-destination mention) -- none a real root in this repo, none
// colliding with anything in `.gitignore` today. THE NON-LOCALITY EXHIBIT, live on this
// tree: `TheColliery/.github/benchmarks/CoalTipple` (README.md) is itself shape-rejected
// (no trailing slash, no `.ext`-shaped last segment) but its root, `TheColliery`, is
// STILL discovered via two unrelated shaped siblings elsewhere
// (`TheColliery/scratchpad/.../SKILL-VARIANCE-WALK.md`,
// `TheColliery/.github/benchmarks/CoalTipple/`) -- so that citation is checked the moment
// `TheColliery` is ever gitignored here, exactly like any other token under a discovered
// root, despite being individually shape-rejected.
//
// THE TEST: strip a trailing `:line(-line)?` ref (the same suffix `normalise()` strips
// for resolution below), then either the token ends in `/` (an explicit directory
// reference) or its LAST segment carries a `.ext`-shaped suffix (a filename). Both are
// the deliberate, common path conventions this house's own prose already uses;
// arithmetic, enumerations, and IDs carry neither.
//
// THE RESIDUE, both directions, named rather than hidden:
//   - STILL LETS THROUGH: a token ending `/` is accepted with no check on what precedes
//     it -- a function-call-shaped token like `os.tmpdir()/` still reaches the probe.
//     Harmless in practice (no real `.gitignore` pattern is named that).
//   - DISCOVERY-EXCLUDED, but NOT check-exempt per the non-locality above: an
//     extensionless real path with no trailing slash no longer contributes its OWN root
//     to discovery. A latent accept-side case, population ZERO on this tree today: the
//     last-segment test's `.[A-Za-z0-9]{1,10}$` also matches an ALL-DIGIT "extension", so
//     a slash-separated version-shaped token (`v1/2`) would pass as filename-shaped were
//     one ever cited.
export function looksPathShaped(tok) {
  const t = tok.replace(/:\d+(-\d+)?$/, '');
  if (t.endsWith('/')) return true;
  return /\.[A-Za-z0-9]{1,10}$/.test(t.split('/').pop());
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
  surfaces = [],               // [{ label, text, historyOnly?, dir? }]
  ourRoots = new Set(),        // top-level names that belong to THIS repo
  ignoredRoots = new Set(),    // first segments of CITED tokens .gitignore matches (CWK-079: existence-independent -- not a disk listing)
  agentHomeRoots = new Set(),  // dot-dir roots that are a READER'S agent home, never ours (CWK-077)
  resolve,                     // (relPath) => 'tracked' | 'untracked' | 'missing'
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

      // CWK-077 (narrowed blind spot 1): a dot-dir whose first segment IS the reader's own
      // agent home (`.claude`/`.agents`/`.gemini`, derived from config-load.mjs's
      // AGENT_DIR_ORDER) is a claim about THEIR tree, never ours -- held out BEFORE the
      // ignoredRoots check below, deliberately: `.claude` is ALSO one of THIS repo's own
      // gitignored roots (we gitignore our own `.claude/`), so without this priority a
      // shipped doc's `.claude/.coaltipple/proposed/` would hit the ignoredRoots branch and
      // FAIL as if it named OUR gitignored dir, when it is actually describing the reader's.
      // Every OTHER dot-dir (`.github`, `.claude-plugin`, ...) falls through to normal
      // resolution -- this is the narrowing itself: CoalMine's shape holds out only the
      // agent-home roots, not every dot-prefixed token.
      if (agentHomeRoots.has(first)) continue;

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
      // LOW-1 (findings-back): FIX 2's join is the only place `..` was floored, and it only
      // runs when `first` matched neither ourRoots nor ignoredRoots. A token whose first
      // segment is ALREADY an ourRoot (e.g. `.github/../../../etc/passwd`, `first='.github'`)
      // skips FIX 2 entirely and reached resolve()/fs.existsSync() with `..` still inside --
      // `path.join()` collapses it, so the stat lands outside the repo. Floored HERE, in the
      // one place every candidate passes through regardless of which branch classified it --
      // never a second rejection mechanism, the same `joinRel` FIX 2 already uses, with an
      // empty dir so a token with no leading `..` round-trips unchanged.
      const rel = joinRel('', normalise(effective));
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
