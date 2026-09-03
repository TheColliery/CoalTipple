// CWK-060 -- documentation-vs-schema drift gate, PORTED from CoalMine
// (commit 0019e09, scripts/lib/config-keys.mjs + verify.mjs block 2.9, CWK-059/061).
// Every config key NAMED on a user-facing surface must RESOLVE in config-schema.mjs,
// or be declared. The DETECTION RULE, PENDING/NOT_CONFIG/BLIND_KEYS mechanism, the
// structured key-table pass, and the self-cleaning expiry rules are the exemplar's
// shape, unchanged. What is NOT ported: the exemplar's `const TRANSLATIONS` + `\n};`
// notice-region locator. See NOTICE SITES below -- porting that locator unmodified
// would have shipped this gate broken on day one.

// DETECTION RULE, measured on THIS room's surfaces (skills/coaltipple/SKILL.md,
// skills/coaltipple/references/{lock,damage-control}.md, README.md), not copied from
// CoalMine's numbers:
//   - naive "any backticked token" rule: 82 distinct tokens, 58 NOT keys -- 71% noise.
//   - requiring an internal capital (KEY_SHAPE below): 29 tokens, 8 NOT keys -- 28%
//     noise. The capital rule drops the 53 tokens the naive rule wrongly flags: enum
//     VALUES (auto/off/heavy/ask/low/max/strict), model+alias names (fable/opus/
//     haiku/flash/pro/inherit), tool names (Read/Write/Edit/Bash/Agent/Task), keyword-
//     group names (crypto/security/audit/concurrency/domain/creative/knowledge/coding/
//     math), and ordinary prose. So the rule TRANSFERS here -- unlike CoalWash, which
//     measured 75% noise even under the capital rule and abandoned shape for a
//     structural pass instead.
//   - residue after the capital rule: exactly 8 tokens, every one a real code
//     identifier, all declared in NOT_CONFIG below with a reason (re-derived
//     independently at CWK-060 build time: 29 distinct capital-shaped tokens across the
//     four IN surfaces, 8 of them absent from the 24-key schema -- the same 29/8 split).
//
// A SAME-LINE-CONFIG-MARKER FILTER WAS MEASURED AND REJECTED. It would remove 2 false
// positives (desiredTier, floorTier -- both already declared in NOT_CONFIG, so it buys
// nothing there) but PROVABLY DROPS 2 REAL SCHEMA KEYS: `enableRouting` (SKILL.md:83,
// a bare table row -- "master switch..." carries no word "config" on that line) and
// `excludePaths` (SKILL.md:97, "dirs never counted toward grading breadth" -- same
// shape). A 1:1 trade of noise removed for real misses introduced is not a filter worth
// having. Verdict differs from all three prior rooms for a room-specific reason, not a
// disagreement with them: CoalMine measured 0 removed and rejected on cost-for-nothing
// grounds; CoalWash measured 48 removed and adopted; CoalBoard measured 1 removed and
// rejected. Ours is the only one with a MEASURED miss, which is why it is the strongest
// rejection of the four, not merely another data point.
const KEY_SHAPE = /^[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*$/;

// A key that is NAMED but not yet IMPLEMENTED. An entry MUST carry a ticket or reason.
// EXPIRY is event-based, not calendar-based (see checkConfigKeys' two self-cleaning
// rules): (1) a PENDING key that now resolves in the schema is a FAIL -- implemented,
// delete the entry. (2) an entry no IN-scope surface mentions is a FAIL -- dead weight.
//
// Empty today, as far as this room's own enumeration can tell -- exercised in the test
// file via a SYNTHETIC key regardless (CoalBoard's own precedent: prove the empty case,
// don't just assume it holds).
export const PENDING_KEYS = {
};

// A key that WAS real and no longer is. Declaring it here means a mention on an
// IN-scope surface is reported BY NAME with its retirement reason, never as a bare
// "does not resolve" FAIL indistinguishable from a typo or a genuinely new drift.
// Steady state is EMPTY mentions on IN-surfaces (a retired key's history belongs in
// CHANGELOG.md, an OUT surface by design -- see SURFACES below) -- so unlike
// PENDING_KEYS/NOT_CONFIG, an unmentioned RETIRED_KEYS entry is NOT dead weight and
// carries no rule-2 self-cleaning. Rule 1 (a name that now resolves in the schema
// again is a lie) still applies -- a retirement is permanent until someone reuses the
// name for something new, and that reuse is itself worth catching.
export const RETIRED_KEYS = {
  rankingMode: 'tombstoned v1.0.14 (B2) -- the model-ranking introspection layer was dropped; routing rides the alias floor + pins instead',
  rankingRefreshDays: 'tombstoned v1.0.14 (B2) -- companion key to rankingMode, same removal',
  ultracodeEnabled: 'tombstoned v1.0.23 -- no consumer; the ultracode rung gates on maxConcurrentSubagents + fastModeOnLatencyRequest instead',
  callFable: 'withdrawn v1.1.1, same day as v1.1.0 shipped it -- a SKILL-only flag could not hard-block a spawn; superseded by the real routable fable rung + the fableConsent gate',
  hardEnforce: 'never implemented -- gated a PreToolUse hard-enforce hook that was never built; routing stays advisory-only',
  skillUpdateCheckDays: 'never implemented -- no consumer + offline-staleness unverifiable; superseded by updateCheckDays',
};

// NOT a config key and never will be -- a code identifier that happens to be camelCase
// (or, for preserveVoice, a NESTED field inside a config VALUE rather than a top-level
// key) in prose. Separate from PENDING_KEYS: "planned" and "not a key" are different
// KINDS of claim, and merging them hides which is which.
export const NOT_CONFIG = {
  isFableModel: 'classify.mjs function name, named in prose (Step 2 fable bullet)',
  resolveWorker: 'classify.mjs function name, named in prose (Step 0, F1, references/lock.md)',
  findGitRoot: 'config-load.mjs function name, named in prose (SKILL.md Files ledger)',
  applyPins: 'classify.mjs function name, named in prose (references/lock.md)',
  preserveVoice: 'a FLAG INSIDE the keywords config VALUE (per-group, e.g. the creative group) -- not a top-level schema key. Do not confuse with the real key preserveVoiceForUserFacing',
  sizeUnits: "grade.mjs's own internal parameter name, named in the Step 1 grade table (SKILL.md)",
  desiredTier: 'resolveWorker parameter name, named in prose (SKILL.md, references/lock.md)',
  floorTier: 'resolveWorker parameter name, named in prose (SKILL.md, references/lock.md)',
};

// A schema key this gate's detection rule CANNOT SEE (KEY_SHAPE requires an internal
// capital), declared with the reason it is accepted. MANDATORY, not optional: any
// schema key failing KEY_SHAPE and NOT declared here is a HARD FAIL -- the gate refuses
// to run while silently checking less than it claims. THIS ROOM MEASURED 3, not the 1
// the porting ticket predicted from CoalMine's own single-entry precedent:
export const BLIND_KEYS = {
  language: 'AGENTS.md 5 Standard Systems #2 mandates it flock-wide; a single lowercase word is indistinguishable from prose',
  mode: "this room's core routing-direction knob (auto/delegation/escalation/off) -- a single lowercase word, same shape problem as language",
  keywords: 'the user-tunable keyword-group object -- a single lowercase word, same shape problem',
};

// SURFACES -- chosen by MEASUREMENT, each in/out with its reason.
//   IN  skills/coaltipple/SKILL.md                        the agent-facing contract.
//   IN  skills/coaltipple/references/lock.md               on-demand depth, still user-facing.
//   IN  skills/coaltipple/references/damage-control.md     same.
//   IN  README.md                                          the most user-visible key list.
//   IN  hooks/coaltipple-conductor.js NOTICE REGIONS ONLY   see NOTICE SITES below.
//   OUT CHANGELOG.md    -- names retired + planned keys BY DESIGN (this is where a
//       retirement's history belongs). A gate reddening on accurate history is not
//       merely noisy, it is WRONG -- the CHANGELOG's job is to record what a key once
//       was, and RETIRED_KEYS above exists so THIS module can be told about that
//       history without scanning the surface that carries it.
//   OUT platform-configs/.coaltipple.json -- true of the JSON data half only: every
//       key/value pair there is real by construction and verify.mjs's own
//       factory-vs-schema check already validates it (scanning those would
//       double-report). The file's ~131 `//` COMMENT lines are a SEPARATE surface that
//       check never reaches -- it parses keys, never comment text -- and they ship into
//       every user's config home via install.mjs. MEASURED (INSPECT independently
//       reproduced the same number): 9 capital-shaped candidates in the comments, only
//       `preserveVoice` absent from the schema -- and it is the SAME NOT_CONFIG entry
//       already declared above (the nested keyword-group flag). Zero drift TODAY, by
//       measurement, not by the "real by construction" reasoning that covers only the
//       data half. The real grounds for OUT: the one non-resolving token needs no new
//       declaration, and candidatesInMarkdown is backtick-based -- these comments name
//       most real keys as bare `"key": value` JSON pairs or unbacktracked prose, so
//       scanning would need a THIRD extraction pass for a catch this room does not have
//       today. REVISIT TRIGGER: the template's comment prose grows a key name that is
//       NOT real (a typo, a renamed key left behind in the prose) -- that is exactly the
//       class this OUT verdict is presently gambling will not happen silently.
//   OUT CONTRIBUTING.md / SECURITY.md / PRIVACY.md -- MEASURED: 0 capital-rule
//       candidates in any of the three. Including them buys nothing today and grows
//       the surface a future room must reason about for free.
//   OUT the plugin/ twins -- byte-identical copies enforced by verify.mjs's own dist-
//       parity check. Scanning both would double every finding for zero extra coverage.
//
// THE SURFACE LIST ITSELF IS A FIXED, HAND-KEPT ROSTER -- no readdir/glob walk anywhere
// in this module or its verify.mjs wiring. A new file added under
// skills/coaltipple/references/ (or a new notice site, or a new key table) is NOT
// scanned until someone adds it here, and nothing notices the gap. Named, not fixed:
// widening to an enumerated walk is a real design change (CoalMine's own CWK-059 uses
// one for its skills/ + hooks/ directories), out of this port's scope.

const NL = String.fromCharCode(10);
const BS = String.fromCharCode(92); // a literal backslash, built not typed

// NOTICE SITES -- hooks/coaltipple-conductor.js has NO `const TRANSLATIONS` block
// (`text.indexOf('const TRANSLATIONS')` returns -1): the exemplar's locator, ported
// unmodified, would scan ZERO BYTES here and report a false GREEN. Our two user-facing
// notice sites are the contract(cfg) function's returned array of strings (the
// SessionStart routing contract) and the `cue` const in the UserPromptSubmit path (a
// single-line ternary). Neither is bounded by the exemplar's `\n};` sentinel: contract()
// closes on `].join('\n');`, not a bare `};`, and cue is one statement with no block to
// close at all. MEASURED: a literal `};` line does not occur ANYWHERE in this 347-line
// file after either site's start marker -- so a straight port of the exemplar's "end
// sentinel not found -> scan to end of file" fallback would have silently overrun by
// up to ~96 lines (contract) or ~39 lines (cue), the exact CoalLedger-class degradation
// this ticket named. locateNoticeRegion below therefore FAILS CLOSED instead: an end
// sentinel that is not found returns null, never a slice-to-EOF.
//
// LINE-COUNT RECONCILIATION, so a future reader does not re-derive this as a bug: the
// coverage line prints contract() at 12 lines; contract()'s SOURCE SPAN (function
// signature through its closing brace) is 13 lines. Not an off-by-one -- the region
// scanned STOPS at the newline before `].join(`, so the line holding the join call
// itself (source line 13) is correctly excluded: it carries no string literal and no
// key, only JS syntax. 12 = bytes actually scanned; 13 = the function's own extent.
// Both numbers are right, for different questions.
export const NOTICE_SITES = [
  { name: 'contract()', file: 'hooks/coaltipple-conductor.js', start: 'function contract(cfg) {', end: NL + '  ].join(' },
  { name: 'cue', file: 'hooks/coaltipple-conductor.js', start: 'const cue = ', end: null },
];

// KEY TABLES -- a markdown table whose FIRST cell is a single backticked token is a key
// CLAIM regardless of shape (position supplies the signal KEY_SHAPE cannot), so this is
// the one place a BLIND key is still catchable in a structured surface. Two in this
// room, not the one the porting ticket's exemplar carries:
//   README.md "Configure"           -- the most user-visible key list (6 rows).
//   skills/coaltipple/SKILL.md "Config" -- the room's OWN canonical reference; its own
//     heading states "all 24 config keys in 23 rows" (a shared updateMode/
//     updateCheckDays row). NOT named in the porting ticket -- found by this build's own
//     enumeration. Adding it is a coverage INCREASE, not a logic change: it uses the
//     same region-bounded, shape-free pass README's table already proves safe, and it
//     is the more complete of the two surfaces. The shared row's two backticked tokens
//     sit in one table cell separated by " · ", which ROW_KEY (below) cannot split --
//     that row contributes NOTHING to this structured pass. MEASURED, not assumed: both
//     of its keys (updateMode, updateCheckDays) already pass KEY_SHAPE and are
//     independently seen by the ordinary prose pass elsewhere in the same file, so no
//     coverage is actually lost by the miss.
export const KEY_TABLES = [
  { file: 'README.md', heading: 'Configure' },
  { file: 'skills/coaltipple/SKILL.md', heading: 'Config' },
];

const TICK = new RegExp('`([^`' + BS + 'n]+)`', 'g');
// A JS single-quoted string literal, escape-aware so a value ending in a backslash
// cannot leak escape state into the next token.
const JS_STRING = new RegExp("'((?:" + BS + BS + ".|[^'" + BS + BS + "])*)'", 'g');
// Blank out escape sequences BEFORE scanning a literal's contents. Without this the two
// characters of an escape fuse with the following word and manufacture a phantom
// identifier. This room's notices carry `\'` (an escaped apostrophe, e.g. "CoalFace\'s")
// -- MEASURED: unblanked, `sAuthority` is exactly the kind of phantom token this step
// exists to prevent (the "s" from "\'s" fusing with "Authority").
const JS_ESCAPE = new RegExp(BS + BS + '[a-zA-Z]', 'g');
const IDENT = new RegExp(BS + 'b([a-z][a-z0-9]*[A-Z][A-Za-z0-9]*)' + BS + 'b', 'g');
// A markdown table row whose FIRST cell is a single backticked token. The pipe is
// written as the character class [|] rather than an escape -- a hand-built
// backslash-pipe is one keystroke from meaning ALTERNATION instead of a literal.
const ROW_KEY = new RegExp('^' + BS + 's*[|]' + BS + 's*`([^`|]+)`' + BS + 's*[|]');

function candidatesInMarkdown(text) {
  const out = new Set();
  for (const m of text.matchAll(TICK)) if (KEY_SHAPE.test(m[1])) out.add(m[1]);
  return out;
}

// STRUCTURED SURFACE -- shape-free by design: inside a declared key table the first
// cell is a key by the table's own contract. Region-bounded by heading, same technique
// as locateNoticeRegion below.
// Returns the region's LINES, or null if the heading itself is not found. null is
// DISTINCT from an empty array (a heading present with zero rows under it) -- the
// caller must FAIL on null (Hard Rule 1) and only treat an empty array as "no rows
// documented", never conflate the two the way an unguarded [] return invites.
function tableRegion(text, heading) {
  const lines = text.split(NL);
  const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.includes(heading));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^#{1,6}\s/.test(l));
  return end === -1 ? rest : rest.slice(0, end);
}

// Returns a Set, or null if tableRegion found no heading (propagated, never swallowed).
function keysInTable(text, heading) {
  const region = tableRegion(text, heading);
  if (region === null) return null;
  const out = new Set();
  for (const ln of region) {
    const m = ROW_KEY.exec(ln);
    if (m) out.add(m[1]);
  }
  return out;
}

// NOTICE-REGION LOCATOR -- room-specific, FAIL-CLOSED. Never the exemplar's
// scan-to-end-of-file fallback (see NOTICE SITES above for the measured reason).
//   site.end === null  -> a SINGLE-LINE region: the site's own line, start to the next
//                          newline (or end of text if the site is the last line).
//   site.end a string  -> region is [start, indexOf(site.end, start)). If that end
//                          marker is not found, returns null -- an absent bound is a
//                          locator problem, not an invitation to scan further than the
//                          shape we know the file to have.
// Returns { region, lines } or null (site start not found, or end bound not found).
function locateNoticeRegion(text, site) {
  const start = text.indexOf(site.start);
  if (start === -1) return null;
  if (site.end === null) {
    const lineEnd = text.indexOf(NL, start);
    const region = lineEnd === -1 ? text.slice(start) : text.slice(start, lineEnd);
    return { region, lines: 1 };
  }
  const endIdx = text.indexOf(site.end, start);
  if (endIdx === -1) return null;
  const region = text.slice(start, endIdx);
  return { region, lines: region.split(NL).length };
}

function candidatesInRegion(region) {
  const out = new Set();
  for (const lit of region.matchAll(JS_STRING)) {
    const clean = lit[1].replace(JS_ESCAPE, ' ');
    for (const id of clean.matchAll(IDENT)) if (KEY_SHAPE.test(id[1])) out.add(id[1]);
  }
  return out;
}

// findings: [{ level, msg }]. `read` is injected so the caller owns file IO (and a test
// can drive it in-memory). `coverage` (returned alongside findings) is the per-locator
// count a reader can sanity-check without trusting the pass/fail line alone -- files
// scanned, lines examined per notice region, candidates found per surface.
export function checkConfigKeys({
  schemaKeys, mdFiles = [], noticeSites = NOTICE_SITES, read,
  keyTables = KEY_TABLES,
  pending = PENDING_KEYS,
  notConfig = NOT_CONFIG,
  blind = BLIND_KEYS,
  retired = RETIRED_KEYS,
}) {
  const findings = [];
  const known = new Set(schemaKeys);

  // PRECONDITION -- a HARD GATE, not a printed note. Any key the schema declares that
  // KEY_SHAPE cannot see must be DECLARED in BLIND_KEYS with its reason. Undeclared, it
  // FAILs: the gate refuses to run while silently checking less than it claims.
  const invisible = [...known].filter((k) => !KEY_SHAPE.test(k)).sort();
  const accepted = invisible.filter((k) => Object.hasOwn(blind, k));
  if (accepted.length) {
    findings.push({
      level: 'SKIP',
      msg: 'blind to ' + accepted.length + ' DECLARED schema key(s) this gate cannot detect: '
        + accepted.join(', ') + ' -- named on any surface they are read and discarded, so the '
        + 'pass line does not cover them (accepted in BLIND_KEYS)',
    });
  }
  for (const k of invisible) {
    if (Object.hasOwn(blind, k)) continue;
    findings.push({
      level: 'FAIL',
      msg: 'schema key ' + k + ' cannot be detected by this gate (it does not match the '
        + 'camelCase-with-an-internal-capital shape), so any mention of it in docs is read and '
        + 'discarded. Declare it in BLIND_KEYS with the reason it is accepted, or rename the key',
    });
  }

  const seen = new Map(); // candidate -> Set(file)
  const unreadable = [];  // a named surface we could not read
  const tableReported = new Set(); // already reported by the structured pass

  const note = (tok, file) => {
    if (!seen.has(tok)) seen.set(tok, new Set());
    seen.get(tok).add(file);
  };

  const coverage = { mdFiles: [], noticeSites: [], keyTables: [] };

  for (const f of mdFiles) {
    let text;
    try { text = read(f); } catch { unreadable.push(f); coverage.mdFiles.push({ file: f, readable: false }); continue; }
    const found = candidatesInMarkdown(text);
    for (const tok of found) note(tok, f);
    coverage.mdFiles.push({ file: f, readable: true, candidates: found.size });
  }

  // NOTICE SITES -- Hard Rule 1: a locator that finds nothing FAILS LOUDLY. Every named
  // site is asserted PRESENT in this room; a null return here is the gate itself being
  // wrong, not the surface legitimately having no notice.
  for (const site of noticeSites) {
    let text;
    try { text = read(site.file); } catch {
      unreadable.push(site.file);
      coverage.noticeSites.push({ name: site.name, file: site.file, readable: false });
      findings.push({ level: 'FAIL', msg: 'notice site "' + site.name + '" (' + site.file + ') could not be read -- cannot verify this surface at all' });
      continue;
    }
    const located = locateNoticeRegion(text, site);
    if (!located) {
      findings.push({
        level: 'FAIL',
        msg: 'notice site "' + site.name + '" (' + site.file + ') locator found NOTHING -- '
          + 'its start marker ' + JSON.stringify(site.start) + ' or end bound is no longer '
          + 'present at the expected shape. A zero-byte scan must never read as a pass: fix the '
          + 'locator before trusting this gate on this file again',
      });
      coverage.noticeSites.push({ name: site.name, file: site.file, readable: true, lines: 0, candidates: 0 });
      continue;
    }
    const found = candidatesInRegion(located.region);
    for (const tok of found) note(tok, site.file + ' (' + site.name + ')');
    coverage.noticeSites.push({ name: site.name, file: site.file, readable: true, lines: located.lines, candidates: found.size });
  }

  // STRUCTURED PASS -- shape-free: a table row IS a key claim whatever its shape.
  // Hard Rule 1 applies here exactly as it does to NOTICE_SITES: both KEY_TABLES
  // entries are asserted-present in this room, so a heading tableRegion cannot find
  // (a rename, a section move) is a locator problem, not a legitimately-empty table --
  // FAIL LOUD, never a silent zero-row pass (INSPECT HIGH-1, board CWK-060 findings-back).
  for (const { file, heading } of keyTables) {
    let text;
    try { text = read(file); } catch { unreadable.push(file); coverage.keyTables.push({ file, heading, readable: false }); continue; }
    const rowKeys = keysInTable(text, heading);
    if (rowKeys === null) {
      findings.push({
        level: 'FAIL',
        msg: 'key table ' + file + ' locator found NOTHING -- heading "' + heading + '" is no longer '
          + 'present at the expected shape. A zero-row scan must never read as a pass: fix the '
          + 'locator (or the heading) before trusting this gate on this file again',
      });
      coverage.keyTables.push({ file, heading, readable: true, rows: 0 });
      continue;
    }
    coverage.keyTables.push({ file, heading, readable: true, rows: rowKeys.size });
    for (const tok of rowKeys) {
      note(tok, file);
      if (known.has(tok) || Object.hasOwn(notConfig, tok) || Object.hasOwn(pending, tok)) continue;
      tableReported.add(tok);
      if (Object.hasOwn(retired, tok)) {
        findings.push({ level: 'FAIL', msg: 'key table ' + file + ' (under "' + heading + '") documents ' + tok + ', which is RETIRED (' + retired[tok] + ') -- drop the mention, it no longer resolves in the schema' });
        continue;
      }
      findings.push({
        level: 'FAIL',
        msg: 'key table ' + file + ' (under "' + heading + '") documents ' + tok
          + ', which does not resolve in the schema -- a table row IS a key claim whatever its '
          + 'shape. Implement it, or declare it in PENDING_KEYS / NOT_CONFIG',
      });
    }
  }

  // THE CHECK -- a named token must resolve, or be declared.
  for (const [tok, files] of [...seen].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (known.has(tok)) continue;
    if (tableReported.has(tok)) continue;
    if (Object.hasOwn(notConfig, tok)) continue;
    if (Object.hasOwn(pending, tok)) continue;
    if (Object.hasOwn(retired, tok)) {
      findings.push({ level: 'FAIL', msg: 'RETIRED key ' + tok + ' (' + retired[tok] + ') is named in ' + [...files].sort().join(', ') + ' -- drop the mention, it no longer resolves in the schema' });
      continue;
    }
    findings.push({
      level: 'FAIL',
      msg: 'config key ' + tok + ' is named in ' + [...files].sort().join(', ') + ' but does not resolve in the schema '
        + '-- implement it, or declare it in PENDING_KEYS (planned, with its ticket) or NOT_CONFIG (never a key, with its reason)',
    });
  }

  // SELF-CLEANING RULE 1 -- a declaration that is no longer true.
  for (const tok of Object.keys(pending)) {
    if (known.has(tok)) findings.push({ level: 'FAIL', msg: 'PENDING_KEYS lists ' + tok + ', but it now resolves in the schema -- implemented, so delete the entry' });
  }
  for (const tok of Object.keys(notConfig)) {
    if (known.has(tok)) findings.push({ level: 'FAIL', msg: 'NOT_CONFIG lists ' + tok + ' as never-a-config-key, but it now resolves in the schema -- the entry is a lie, delete it' });
  }
  for (const tok of Object.keys(retired)) {
    if (known.has(tok)) findings.push({ level: 'FAIL', msg: 'RETIRED_KEYS lists ' + tok + ', but it now resolves in the schema again -- the name was reused, update or delete the entry' });
  }
  for (const tok of Object.keys(blind)) {
    if (!known.has(tok)) {
      findings.push({ level: 'FAIL', msg: 'BLIND_KEYS declares ' + tok + ', but it is not in the schema at all -- the key is gone, delete the entry' });
    } else if (KEY_SHAPE.test(tok)) {
      findings.push({ level: 'FAIL', msg: 'BLIND_KEYS declares ' + tok + ' as undetectable, but it now matches the shape rule -- the gate can see it, delete the entry' });
    }
  }

  // SELF-CLEANING RULE 2 -- PENDING_KEYS / NOT_CONFIG only (RETIRED_KEYS is exempt --
  // see its own doc comment: an unmentioned retirement is the DESIRED steady state, not
  // dead weight). Gated on a complete scan: a partial scan cannot prove a declaration is
  // dead, so it degrades to a visible SKIP rather than a false accusation.
  if (unreadable.length) {
    findings.push({ level: 'SKIP', msg: 'declaration-pruning not checked: ' + unreadable.length + ' named surface(s) unreadable (' + unreadable.slice(0, 3).sort().join(', ') + (unreadable.length > 3 ? ', ...' : '') + ') -- a partial scan cannot prove a declaration is dead' });
  } else {
    for (const [tok, why] of [...Object.entries(pending), ...Object.entries(notConfig)]) {
      if (!seen.has(tok)) findings.push({ level: 'FAIL', msg: 'no scanned surface names ' + tok + ' (' + why + ') -- the declaration protects nothing, delete it' });
    }
  }

  return { findings, coverage };
}
