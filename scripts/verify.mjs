#!/usr/bin/env node
// CoalTipple verify gate — fail LOUD if the factory config drifts from the
// schema, the skill/conductor are missing/malformed, or a lib fails to import.
// Wrapped per-check so one bad input yields a clean FAIL line, not a stack trace.
// Run by the pre-commit / pre-push hooks.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { CONFIG_SCHEMA, validateValue } from './lib/config-schema.mjs';
import { stripJsonc } from './lib/jsonc.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Leading-BOM strip for the plugin.json description check below, built from a char
// code rather than a hand-typed escape sequence (board #64 exemplar, CoalMine
// 13daf36: typing the literal BOM escape directly in a tool call silently became
// the literal BOM character in transit). This file's other BOM strips (charCodeAt
// checks) are untouched.
const BOM_RE = new RegExp('^' + String.fromCharCode(0xfeff));
let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const fail = (m) => { console.log(`  FAIL ${m}`); fails++; };

console.log('files:');
for (const [label, p] of [
  ['skills/coaltipple/SKILL.md', path.join(repo, 'skills', 'coaltipple', 'SKILL.md')],
  ['hooks/coaltipple-conductor.js', path.join(repo, 'hooks', 'coaltipple-conductor.js')],
  ['hooks/hooks.json', path.join(repo, 'hooks', 'hooks.json')],
  ['platform-configs/.coaltipple.json', path.join(repo, 'platform-configs', '.coaltipple.json')],
  ['.claude-plugin/plugin.json', path.join(repo, '.claude-plugin', 'plugin.json')],
]) { try { fs.existsSync(p) ? ok(label) : fail(`${label} missing`); } catch (e) { fail(`${label}: ${e.message}`); } }

console.log('plugin (manifest vs CHANGELOG):');
try {
  const pj = JSON.parse(fs.readFileSync(path.join(repo, '.claude-plugin', 'plugin.json'), 'utf8'));
  if (pj.name === 'coaltipple') ok("plugin.json name = 'coaltipple'"); else fail(`plugin.json name = '${pj.name}' (want 'coaltipple')`);
  // Semver accepting a pre-release/build suffix (flock-canonical form, e.g. CoalHearth/CoalFace
  // verify.mjs) — a strict x.y.z-only regex once rejected a beta tag at release time on a sibling.
  // CT ships stable-only today (latent), but the CHANGELOG-heading capture below must accept the
  // same grammar or a future beta would pass this check and fail the very next one.
  const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
  if (SEMVER_RE.test(pj.version || '')) {
    const cl = fs.readFileSync(path.join(repo, 'CHANGELOG.md'), 'utf8');
    const top = (cl.match(/^##\s*\[(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\]/m) || [])[1];
    if (top === pj.version) ok(`version ${pj.version} matches top CHANGELOG entry`);
    else fail(`plugin.json version ${pj.version} != top CHANGELOG [${top || 'none'}] — bump bookkeeping out of sync`);
  } else fail(`plugin.json version '${pj.version}' not semver`);
  // hooks.json must reference the conductor under ${CLAUDE_PLUGIN_ROOT} (only resolves with plugin.json present)
  const hj = fs.readFileSync(path.join(repo, 'hooks', 'hooks.json'), 'utf8');
  if (hj.includes('${CLAUDE_PLUGIN_ROOT}/hooks/coaltipple-conductor.js')) ok('hooks.json wires the conductor via ${CLAUDE_PLUGIN_ROOT}');
  else fail('hooks.json does not wire the conductor under ${CLAUDE_PLUGIN_ROOT}');
  // marketplace.json must serve the conformed dist, not the raw repo (ported from CoalMine verify.mjs).
  let mktRaw = fs.readFileSync(path.join(repo, '.claude-plugin', 'marketplace.json'), 'utf8');
  if (mktRaw.charCodeAt(0) === 0xFEFF) mktRaw = mktRaw.slice(1); // same BOM-strip idiom as the config check above
  const mkt = JSON.parse(mktRaw);
  const srcField = mkt.plugins?.[0]?.source;
  if (srcField === './plugin') ok('marketplace serves ./plugin (conformed dist)');
  else fail(`marketplace plugins[0].source is ${JSON.stringify(srcField)} — must be "./plugin" so installs get conformed skills`);
} catch (e) { fail(`plugin manifest: ${e.message}`); }

console.log('skill:');
try {
  const md = fs.readFileSync(path.join(repo, 'skills', 'coaltipple', 'SKILL.md'), 'utf8');
  if (/^---[\s\S]*?name:\s*coaltipple[\s\S]*?description:[\s\S]*?---/.test(md)) ok('SKILL.md frontmatter (name + description)');
  else fail('SKILL.md frontmatter malformed (need name: coaltipple + description)');
} catch (e) { fail(`SKILL.md unreadable: ${e.message}`); }

console.log('description length cap (skills + commands):');
// Skill-listing description cap: gate at 1024 = cross-platform-safe (agentskills.io / agnix);
// CC's own listing truncation is 1536 chars combined description+when_to_use
// (code.claude.com/docs/en/skills, verified 2026-07-16). USER standard 2026-07-16: never exceed.
const DESC_CAP = 1024;
function frontmatterField(text, key) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const lines = m[1].split(/\r?\n/);
  const i = lines.findIndex((l) => l.startsWith(key + ':'));
  if (i === -1) return null;
  let v = lines[i].slice(key.length + 1).trim();
  if (/^[>|][-+]?$/.test(v)) {
    const parts = [];
    for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]); j++) parts.push(lines[j].trim());
    return parts.join(' ');
  }
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v;
}
// Dynamic scan (skills/*/SKILL.md for any dir that has one, commands/*.md) so a
// new skill/command is covered without editing this gate.
const descTargets = [];
const skillsDir = path.join(repo, 'skills');
if (fs.existsSync(skillsDir)) {
  for (const d of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const smd = path.join(skillsDir, d.name, 'SKILL.md');
    if (fs.existsSync(smd)) descTargets.push([`skills/${d.name}/SKILL.md`, smd, true]);
  }
}
const commandsDir = path.join(repo, 'commands');
if (fs.existsSync(commandsDir)) {
  for (const f of fs.readdirSync(commandsDir)) {
    if (f.endsWith('.md')) descTargets.push([`commands/${f}`, path.join(commandsDir, f), false]);
  }
}
for (const [label, p, isSkill] of descTargets) {
  try {
    const text = fs.readFileSync(p, 'utf8');
    const len = (frontmatterField(text, 'description') || '').length + (frontmatterField(text, 'when_to_use') || '').length;
    if (isSkill && len === 0) fail(`${label}: frontmatter description missing/unparsed`);
    else if (len > DESC_CAP) fail(`${label}: description+when_to_use ${len} chars exceeds the ${DESC_CAP}-char cap`);
    else ok(`${label}: ${len} chars (cap ${DESC_CAP})`);
  } catch (e) { fail(`${label} description check: ${e.message}`); }
}
// .claude-plugin/plugin.json's OWN description field vs the same cap (board #64: this gate
// covered skill/command FRONTMATTER only, so a plugin.json description could silently exceed
// 1024 -- CoalLedger shipped one at 1067 before a human eye caught it). plugin.json is plain
// JSON, not YAML frontmatter, so it reads the field directly rather than through
// frontmatterField; the cap constant is the same DESC_CAP above, never redefined.
{
  const pluginJsonPath = path.join(repo, '.claude-plugin', 'plugin.json');
  try {
    const raw = fs.readFileSync(pluginJsonPath, 'utf8').replace(BOM_RE, '');
    const pj = JSON.parse(raw);
    const len = typeof pj.description === 'string' ? pj.description.length : 0;
    if (!pj.description) fail('.claude-plugin/plugin.json: description missing');
    else if (len > DESC_CAP) fail(`.claude-plugin/plugin.json: description ${len} chars exceeds the ${DESC_CAP}-char cap`);
    else ok(`.claude-plugin/plugin.json: ${len} chars (cap ${DESC_CAP})`);
  } catch (e) { fail(`.claude-plugin/plugin.json description check: ${e.message}`); }
}

console.log('config (factory vs schema):');
try {
  let c = fs.readFileSync(path.join(repo, 'platform-configs', '.coaltipple.json'), 'utf8');
  if (c.charCodeAt(0) === 0xFEFF) c = c.slice(1);
  // Use the SHARED stripJsonc (lib/jsonc.mjs) — the #12-fixed parser runtime + the
  // conductor use — so the gate validates with the SAME parser as runtime, not a 3rd divergent regex.
  const cfg = JSON.parse(stripJsonc(c));
  const byKey = Object.fromEntries(CONFIG_SCHEMA.map((s) => [s.key, s]));
  let bad = 0;
  for (const [k, v] of Object.entries(cfg)) {
    const spec = byKey[k];
    if (!spec) { fail(`key '${k}' not in schema`); bad++; continue; }
    const err = validateValue(spec, v);
    if (err) { fail(`'${k}' ${err}`); bad++; }
  }
  if (!bad) ok(`${Object.keys(cfg).length} keys all valid`);
} catch (e) { fail(`factory config: ${e.message}`); }

console.log('libs:');
for (const lib of ['config-schema.mjs', 'config-load.mjs', 'grade.mjs', 'classify.mjs', 'keywords.mjs', 'targets.mjs']) {
  try { await import(pathToFileURL(path.join(repo, 'scripts', 'lib', lib)).href); ok(`${lib} imports`); }
  catch (e) { fail(`${lib}: ${e.message}`); }
}

console.log('shared regions (conductor vs keywords SSoT):');
try {
  const { genHotKeywords } = await import(pathToFileURL(path.join(repo, 'scripts', 'build-plugin.mjs')).href);
  const src = fs.readFileSync(path.join(repo, 'hooks', 'coaltipple-conductor.js'), 'utf8');
  const open = '// <coaltipple-shared: hot-keywords>';
  const close = '// </coaltipple-shared: hot-keywords>';
  const oi = src.indexOf(open), ci = src.indexOf(close);
  if (oi === -1 || ci === -1 || ci < oi) fail('hot-keywords markers missing/disordered in conductor');
  else {
    const current = src.slice(src.indexOf('\n', oi) + 1, ci).trim();
    const expected = (await genHotKeywords()).trim();
    const cr = String.fromCharCode(13); // CRLF-insensitive: a Windows checkout (autocrlf) yields \r\n; genHotKeywords emits \n
    if (current.split(cr).join('') === expected.split(cr).join('')) ok('hot-keywords in sync with keywords.mjs');
    else fail('hot-keywords DRIFTED from keywords.mjs — run `node scripts/build-plugin.mjs`');
  }
} catch (e) { fail(`shared-region check: ${e.message}`); }

console.log('factory config regions (.coaltipple.json vs keywords.mjs SSoT):');
try {
  const { REGIONS } = await import(pathToFileURL(path.join(repo, 'scripts', 'build-plugin.mjs')).href);
  const src = fs.readFileSync(path.join(repo, 'platform-configs', '.coaltipple.json'), 'utf8');
  const cr = String.fromCharCode(13); // CRLF-insensitive (Windows autocrlf)
  for (const r of REGIONS.filter((x) => x.file.endsWith('.coaltipple.json'))) {
    const name = r.open.replace('// <coaltipple-shared: ', '').replaceAll('>', '');
    const oi = src.indexOf(r.open), ci = src.indexOf(r.close);
    if (oi === -1 || ci === -1 || ci < oi) { fail(`${name}: markers missing/disordered in .coaltipple.json`); continue; }
    const current = src.slice(src.indexOf('\n', oi) + 1, ci).trim();
    const expected = (await r.gen()).trim();
    if (current.split(cr).join('') === expected.split(cr).join('')) ok(`${name} config in sync with keywords.mjs`);
    else fail(`${name} config DRIFTED from keywords.mjs -- run \`node scripts/build-plugin.mjs\``);
  }
} catch (e) { fail(`config-region check: ${e.message}`); }

console.log('SKILL.md keyword floors (Step 1 restatement vs keywords.mjs SSoT):');
try {
  // keywords.mjs is under scripts/, unshipped to the installed plugin (build-dist.mjs
  // DIST_ITEMS), so SKILL.md Step 1 restates each factory group's grade/flag in prose for
  // the agent to read on every install. A 4th sibling of the 3 shared-region checks above
  // (conductor hot-keywords, factory-config keywords/sensitivePaths/excludePaths) --
  // fragment-adjacency, not a full splice-region, since this text sits inside a hand-written
  // sentence with a per-group aside (coding's), not a machine-generated block.
  const kw = await import(pathToFileURL(path.join(repo, 'scripts', 'lib', 'keywords.mjs')).href);
  const md = fs.readFileSync(path.join(repo, 'skills', 'coaltipple', 'SKILL.md'), 'utf8');
  let bad = 0;
  for (const [name, g] of Object.entries(kw.KEYWORD_GROUPS)) {
    const base = `\`${name}\` ${g.grade}`;
    const bi = md.indexOf(base);
    if (bi === -1) { fail(`${name} floor DRIFTED from keywords.mjs — SKILL.md Step 1 must contain '${base}'`); bad++; continue; }
    // Check the flag boundary EXPLICITLY in both directions, not just via .includes() on the
    // flagged fragment: an unflagged fragment is a PREFIX of the flagged one, so .includes()
    // alone is blind to a REMOVED flag (keywords.mjs drops `sensitive` but SKILL.md still says
    // "(sensitive)" -- verified 2026-07-28, reviewer finding, red-proofed both ways below).
    const after = md.slice(bi + base.length, bi + base.length + 20);
    const hasSensitive = after.startsWith(' (sensitive');
    const hasPreserveVoice = after.startsWith(' (preserveVoice');
    if (g.sensitive && !hasSensitive) { fail(`${name}: keywords.mjs marks it sensitive but SKILL.md's '${base}' has no '(sensitive' — DRIFTED`); bad++; }
    else if (g.preserveVoice && !hasPreserveVoice) { fail(`${name}: keywords.mjs marks it preserveVoice but SKILL.md's '${base}' has no '(preserveVoice' — DRIFTED`); bad++; }
    else if (!g.sensitive && !g.preserveVoice && (hasSensitive || hasPreserveVoice)) { fail(`${name}: keywords.mjs has no flag but SKILL.md's '${base}' still shows one — DRIFTED`); bad++; }
    else ok(`${name} floor ${g.grade}${g.sensitive ? ' sensitive' : g.preserveVoice ? ' preserveVoice' : ''} present in SKILL.md`);
  }
  if (!bad) ok(`all ${Object.keys(kw.KEYWORD_GROUPS).length} keyword floors match keywords.mjs`);
} catch (e) { fail(`SKILL.md keyword-floor check: ${e.message}`); }

console.log('config-path sync (conductor inline vs config-load SSoT; configure imports it):');
try {
  // The LEGACY project-config path segment lives under .claude in config-load.mjs
  // (the SSoT). The conductor inlines its OWN copy (the hook must be standalone,
  // Phoenix #9 — it cannot import config-load), so a future edit to one could
  // silently drift — assert both reference the same path segment (the path
  // analogue of the hot-keyword sync above). configure.mjs is DIFFERENT since the
  // namespace campaign (#69+#39): it is a plain script (no standalone constraint),
  // so it IMPORTS projectConfigCandidates from config-load.mjs rather than
  // duplicating the segment — assert the import instead of the literal string.
  // projectConfigCandidates resolves the git root INTERNALLY (config-load.mjs), so
  // configure.mjs needs no git-root helper of its own — requiring one here would
  // pin an incidental implementation detail, not the real invariant.
  const seg = "'.claude', '.coaltipple.json'";
  for (const [label, rel] of [
    ['config-load.mjs', ['scripts', 'lib', 'config-load.mjs']],
    ['coaltipple-conductor.js', ['hooks', 'coaltipple-conductor.js']],
  ]) {
    const s = fs.readFileSync(path.join(repo, ...rel), 'utf8');
    if (s.includes(seg)) ok(`${label} references the .claude project-config path`);
    else fail(`${label} lost ${seg} — project-config path DRIFTED from config-load (the SSoT)`);
  }
  const configureSrc = fs.readFileSync(path.join(repo, 'scripts', 'configure.mjs'), 'utf8');
  const importsIt = /import\s*\{[^}]*\bprojectConfigCandidates\b[^}]*\}\s*from\s*['"]\.\/lib\/config-load\.mjs['"]/.test(configureSrc);
  if (importsIt) ok('configure.mjs imports projectConfigCandidates from config-load.mjs');
  else fail('configure.mjs no longer imports projectConfigCandidates from config-load.mjs — project-config path DRIFTED from config-load (the SSoT)');
} catch (e) { fail(`config-path sync: ${e.message}`); }

// config-key drift (CWK-060, ported from CoalMine 0019e09): every config key NAMED on
// a user-facing surface must RESOLVE in config-schema.mjs, or be declared in
// PENDING_KEYS / NOT_CONFIG / RETIRED_KEYS / BLIND_KEYS (config-keys.mjs). PRINTS
// per-locator coverage EVERY run (files scanned, notice-region LINE COUNTS, candidates
// per surface, table rows) -- a reader can sanity-check the numbers rather than trust
// the pass/fail line alone, and the line counts are what would catch a future
// re-introduction of the sentinel-overrun class config-keys.mjs's own header documents.
console.log('config keys:');
try {
  const ck = await import(pathToFileURL(path.join(repo, 'scripts', 'lib', 'config-keys.mjs')).href);
  const { findings, coverage } = ck.checkConfigKeys({
    schemaKeys: CONFIG_SCHEMA.map((e) => e.key),
    mdFiles: [
      path.join('skills', 'coaltipple', 'SKILL.md'),
      path.join('skills', 'coaltipple', 'references', 'lock.md'),
      path.join('skills', 'coaltipple', 'references', 'damage-control.md'),
      'README.md',
    ],
    read: (f) => fs.readFileSync(path.join(repo, f), 'utf8'),
  });
  const hard = findings.filter((f) => f.level !== 'SKIP');
  const blindSkips = findings.filter((f) => f.level === 'SKIP' && f.msg.startsWith('blind to'));
  const scope = blindSkips.length ? 'every DETECTABLE config key' : 'every config key';
  if (hard.length === 0) ok(`${scope} named across ${coverage.mdFiles.length} doc + ${coverage.noticeSites.length} notice-site + ${coverage.keyTables.length} key-table surface(s) resolves in the schema`);
  for (const f of findings) {
    if (f.level === 'SKIP') console.log('  --   ' + f.msg);
    else fail(f.msg);
  }
  for (const m of coverage.mdFiles) console.log(`  cov  markdown ${m.file}: ${m.readable ? `${m.candidates} candidate(s)` : 'UNREADABLE'}`);
  for (const n of coverage.noticeSites) console.log(`  cov  notice "${n.name}" (${n.file}): ${n.readable ? `${n.lines} line(s), ${n.candidates} candidate(s)` : 'UNREADABLE'}`);
  for (const t of coverage.keyTables) console.log(`  cov  key table ${t.file} "${t.heading}": ${t.readable ? `${t.rows} row(s)` : 'UNREADABLE'}`);
} catch (e) { fail(`config-key check crashed: ${e.message}`); }

console.log('pointer check (ship-text path citations resolve in this repo -- scripts/lib/pointer-check.mjs owns the detection rule, the funnel measurement, the three CoalTipple-specific fixes, and the four named blind spots; PATH only, section/symbol not checked -- CoalMine\'s + CoalBoard\'s own measurement is why that half stays unbuilt):');
try {
  const pc = await import(pathToFileURL(path.join(repo, 'scripts', 'lib', 'pointer-check.mjs')).href);
  // CWK-077: the agent-home holdout is DERIVED from config-load.mjs's own AGENT_DIR_ORDER,
  // never a hand-copied second list -- that hand-copy is the exact drift this ticket exists
  // to remove. Dynamic import (node/runtime.md §1): this is a scripts/lib/ import inside the
  // check that consumes it, same pattern as `pc` immediately above.
  const cl = await import(pathToFileURL(path.join(repo, 'scripts', 'lib', 'config-load.mjs')).href);
  const PC_AGENT_HOME_ROOTS = new Set(cl.AGENT_DIR_ORDER);
  // SAFE READ, not a direct fs.readFileSync: a hermetic sandbox test (scripts/verify.test.mjs)
  // spawns this whole script against a NARROWED copy of the repo (VERIFY_ITEMS there does not
  // include README.md/SECURITY.md/CONTRIBUTING.md/PRIVACY.md -- it exists to test board #64's
  // check in isolation, not to mirror the full tree). Reading those four DIRECTLY, unguarded,
  // crashed the whole pointer-check block there (ENOENT), which failed the ENTIRE gate on a
  // sandbox that never claimed to carry every file -- caught by CWK-075's own full-suite
  // re-run, per this room's own red-first/green-after discipline (scripts-quality.md: "run
  // the FULL suite ... before every commit"). checkPointers() already has a graceful path for
  // exactly this (an unreadable surface -> SKIP, never a crash) -- this helper is what lets a
  // per-file read failure REACH that path instead of throwing past it.
  const pcSafeRead = (rel) => { try { return fs.readFileSync(path.join(repo, rel), 'utf8'); } catch { return undefined; } };
  // SURFACE PLAN, DECLARED (CWK-090 fix 3, ported from CoalMine's own port) -- what this
  // block used to hard-code as three separate walks (one SKILL.md read, two `readdirSync`
  // fans, four root-doc reads, one CHANGELOG read) is now DATA (`DEFAULT_SURFACE_PLAN`,
  // pointer-check.mjs), driven here with THIS room's own fs IO so the module stays pure. A
  // room that narrows the plan deletes a row and states the reason in that row's own `why`,
  // never by editing this driver. Behaviour is BYTE-IDENTICAL to the three walks it replaces
  // -- same surfaces, same order, same labels, same `dir` values -- verified by a surface-
  // identity count before/after in this unit's own return, not merely asserted here.
  const pcSurfaces = pc.collectSurfaces(repo, pc.DEFAULT_SURFACE_PLAN, {
    join: path.join,
    listMd: (dir) => fs.readdirSync(dir),
    read: (abs) => pcSafeRead(path.relative(repo, abs)),
    rel: (abs) => path.relative(repo, abs).replace(/\\/g, '/'),
  });
  // no-external-assumption (AGENTS.md): git is an OPTIONAL enhancement with a graceful
  // fallback, never a hard requirement -- checked ONCE, not per-call, so the same sandbox
  // (verify.test.mjs's fs.cpSync copy, no `.git` at all) does not pay a failing `git`
  // spawn for every candidate. Inside a real work tree, tracked/untracked/missing keeps its
  // full three-way meaning via `git ls-files`. Outside one, the distinction this gate exists
  // to draw (reachable from a CLONE vs merely present on THIS disk) cannot be asked of git at
  // all -- degrades to exists-on-disk-is-good-enough (an existing file reads 'tracked', never
  // 'untracked'), which is the correct direction for a throwaway sandbox: `.gitignore`-rooted
  // citations are still caught, unconditionally, by the ignoredRoots branch above (pure string
  // membership, never touches git), so the only property actually lost here is catching a
  // genuinely untracked-but-not-gitignored stray file while running with no `.git` present --
  // narrower than normal operation, never wider. Moved ahead of PC_OUR_ROOTS/PC_IGNORED_ROOTS
  // (CWK-077 round 2) -- both derivations below now need it.
  let pcHasGit = true;
  try { execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: repo, stdio: 'pipe' }); }
  catch { pcHasGit = false; }

  // SCOPE, matching CWK-075's own dispatch (not CoalBoard's wider roster): the 8 surfaces
  // above are the ones this ticket measured and fixed against. scripts/ + hooks/ line-comment
  // scanning (which CoalBoard's own verify.mjs additionally does) is deliberately NOT added
  // here -- widening the surface set would change the funnel numbers away from what this
  // unit's own measurement, report, and INSPECT re-derivation are against. A future ticket
  // may extend it; this one does not, to keep the reported numbers reproducible.
  //
  // NO-GIT FALLBACK ONLY -- and DELIBERATELY asymmetric with ignoredRoots, which keeps no
  // literal at all (CWK-079 removed PC_IGNORED_ROOTS_FALLBACK entirely). ourRoots still needs
  // one because an EMPTY ourRoots makes every citation read as someone else's tree and the
  // gate goes uniformly, silently green; an empty ignoredRoots only stops one branch firing,
  // and says so in the pass line. Do not "restore consistency" by reviving a literal here:
  // narrowing blind spot 1 exposed that the hand-kept 6-entry literal this used to be missed
  // three TRACKED DOT-DIRS -- `.claude-plugin`, `.github`, `.githooks` -- which then matched
  // neither ourRoots, ignoredRoots nor agentHomeRoots, so FIX 2's citer-relative fallback
  // wrongly joined a root-relative citation (`.claude-plugin/plugin.json` from
  // `commands/update.md`) onto the citing surface's own dir and FAILed a tracked file. Fixed
  // the same way as PC_IGNORED_ROOTS: derive from `git ls-files` every run rather than
  // hand-adding the three missing names, which would only reproduce the defect the next time
  // a tracked top-level dir is added.
  const PC_OUR_ROOTS_FALLBACK = new Set(['.claude-plugin', '.github', '.githooks', 'commands', 'hooks', 'platform-configs', 'plugin', 'scripts', 'skills']);
  let pcOurRootsDerived = false;
  function pcDeriveOurRoots() {
    if (!pcHasGit) return PC_OUR_ROOTS_FALLBACK;
    try {
      const listing = execFileSync('git', ['ls-files'], { cwd: repo, stdio: 'pipe' }).toString('utf8');
      const roots = new Set();
      for (const line of listing.split(/\r?\n/)) {
        if (!line) continue;
        const first = line.split('/')[0];
        if (first === line) continue;                 // a top-level FILE, not a directory root
        if (PC_AGENT_HOME_ROOTS.has(first)) continue;  // an agent home wins even if somehow tracked
        roots.add(first);
      }
      pcOurRootsDerived = true;
      return roots;
    } catch {
      return PC_OUR_ROOTS_FALLBACK;
    }
  }
  const PC_OUR_ROOTS = pcDeriveOurRoots();
  // IGNORED ROOTS, CITATION-BASED (CWK-079, ported from CoalMine 6588d14/7c7cb72/8fcf443,
  // REPLACING the CWK-075/CWK-078 disk-walk this comment used to describe) -- asked of the
  // CANDIDATES actually cited in ship-text, never of what exists on THIS box's disk.
  //
  // THE FINDING, measured in THIS room, not inherited: cloned this repo to a fresh temp dir
  // and ran the OLD `fs.readdirSync(repo)`-based derivation there -- `fed=29 ignoredRoots=8`
  // on the working box against `fed=20 ignoredRoots=0` on the clean clone. `.gitignore` is
  // TRACKED; a clean clone simply does not yet HAVE the files it names, so the old probe
  // answered ZERO on every clean clone and every CI leg -- dead code everywhere except a
  // maintainer's own box. `git check-ignore` answers a PATTERN question, not an EXISTENCE
  // one, so it is correct for an absent-but-tracked-pattern path exactly as it was for a
  // present one -- what changed is what gets FED to it: the first segments of tokens
  // `pointerCandidates()` actually extracted from `pcSurfaces`, not a directory listing.
  //
  // NARROWED ON TOKEN SHAPE, NEVER EXISTENCE, via `pc.looksPathShaped()` (pointer-check.mjs --
  // its own comment carries the two measured bound populations on this tree and the
  // non-locality property this narrowing does NOT exempt a token from; pinned as a
  // regression test below). `agentHomeRoots` is held out of the probe for the same reason
  // CWK-077 held it out of `ourRoots`: `.claude`/`.agents` are BOTH a legitimate USER-tree
  // citation and one of THIS repo's own gitignored roots, and probing them would FAIL a
  // correct ship-text citation as if it named our own dir.
  const pcCandidateRoots = new Set();
  for (const s of pcSurfaces) {
    if (typeof s.text !== 'string') continue;
    for (const tok of pc.pointerCandidates(s.text)) {
      if (!pc.looksPathShaped(tok)) continue;
      pcCandidateRoots.add(tok.split('/')[0]);
    }
  }
  let pcHomesPresent = 0;
  const pcToProbe = [];
  for (const name of pcCandidateRoots) {
    if (PC_AGENT_HOME_ROOTS.has(name)) { pcHomesPresent++; continue; }
    pcToProbe.push(name);
  }
  // BATCHED: one `--stdin` call for every distinct candidate root, not a per-name spawn loop
  // (the shape the old disk-walk used) -- structurally the same batching win CoalMine
  // measured on its own tree, not independently re-timed here.
  //
  // INJECTION-SITE PROBE (CWK-090 fix 2, ported from CoalMine -- CoalFace's own finding): a
  // bare `root/` feed can FALSE-MATCH a root ABSENT FROM DISK under a `.gitignore` carrying a
  // lone-CR "blank" line (a stray carriage return with no other content) -- CoalFace's own
  // "26 bogus FAILs" shape. **MEASURED HERE BEFORE PORTING: this room's `.gitignore` carries
  // ZERO CR bytes, in the worktree AND the blob (`.gitattributes` pins `* text=auto eol=lf`),
  // and the exposure probe (`git check-ignore -q "nonsense-xyz/"`) exits 1 -- this fixes
  // NOTHING live here today.** Ported anyway as prospective hardening, one shape rather than
  // two mechanisms for the identical question: querying a path UNDER the root
  // (`root/.pointer-check-probe`) carries the same "is this directory ignored" information a
  // bare `root/` query does, without ever matching the bare-root CRLF/lone-CR shape (git
  // cannot infer that an ABSENT path is a directory either way, so SOMETHING must be
  // appended -- what changed is what). Each returned line has the fixed suffix stripped to
  // recover the root.
  const PC_PROBE_SUFFIX = '/.pointer-check-probe';
  // FAIL-OPEN, CLOSED (CWK-090 fix 1, ported from CoalMine + CoalLedger `94e994f`); WIRING
  // moved into `applyCheckIgnoreProbe` (pointer-check.mjs, CWK-090 -- the fourth occurrence of
  // this room's own "a classification with no test on the CALL SITE mutates to green" class:
  // CWK-060 HIGH-1, CWK-078 abort-path, CWK-079 findings-back HIGH-1, now this) so a unit test
  // drives the exact branch verify.mjs runs, with an injected `runCheckIgnore`, never a
  // duplicated copy. A non-0/1 exit (128 typical: a corrupted `.git`, an unreadable
  // `.gitignore`) now FAILS LOUDLY via `fail()` directly -- not merely a pass-line label,
  // which only prints when there are no hard findings elsewhere: a derivation that did not
  // happen is exactly the mislabel class CWK-078/CWK-079 both paid for, and a label in a line
  // that may never print is the weaker half of it.
  const PC_IGNORED_ROOTS = new Set();
  if (pcHasGit) {
    pc.applyCheckIgnoreProbe({
      toProbe: pcToProbe,
      PROBE_SUFFIX: PC_PROBE_SUFFIX,
      ignoredRoots: PC_IGNORED_ROOTS,
      fail,
      runCheckIgnore: (input) => spawnSync('git', ['check-ignore', '--stdin'], { cwd: repo, encoding: 'utf8', input }),
    });
  }
  // Same self-check, ourRoots side (CWK-077 round 2): a root the live derivation finds but
  // the fallback literal does not know about would silently narrow ourRoots the moment git
  // is unavailable -- the exact defect this whole fix exists to close, one layer down.
  if (pcHasGit && pcOurRootsDerived) {
    for (const r of PC_OUR_ROOTS) {
      if (!PC_OUR_ROOTS_FALLBACK.has(r)) {
        fail(`pointer check: '${r}' is a tracked top-level root (live-derived) but absent from the no-git PC_OUR_ROOTS_FALLBACK literal in verify.mjs -- add it, or the no-git degrade path silently narrows ourRoots`);
      }
    }
  }
  function pcResolve(rel) {
    if (!pcHasGit) return fs.existsSync(path.join(repo, rel)) ? 'tracked' : 'missing';
    try {
      execFileSync('git', ['ls-files', '--error-unmatch', '--', rel], { cwd: repo, stdio: 'pipe' });
      return 'tracked';
    } catch {
      return fs.existsSync(path.join(repo, rel)) ? 'untracked' : 'missing';
    }
  }
  const pcFindings = pc.checkPointers({
    surfaces: pcSurfaces,
    ourRoots: PC_OUR_ROOTS,
    ignoredRoots: PC_IGNORED_ROOTS,
    agentHomeRoots: PC_AGENT_HOME_ROOTS,
    resolve: pcResolve,
  });
  const pcHard = pcFindings.filter((f) => f.level !== 'SKIP');
  for (const f of pcFindings) {
    if (f.level === 'SKIP') console.log('  --   ' + f.msg);
  }
  // CWK-078 fix, still true: `${pcSurfaces.length}` replaces a former TYPED "8 surfaces"
  // literal that disagreed with the real walked array (12) -- a CoalHearth-class defect (a
  // number in a gate's own pass line the instrument does not produce).
  //
  // TWO NUMBERS, NOT ONE (CWK-079 -- the old single "N fed" count meant two different things
  // depending on which shape was live; this pass line now always states both): CITED =
  // `pcCandidateRoots.size`, every distinct first segment `looksPathShaped()` let through
  // discovery; PROBED = `pcToProbe.length`, that set minus the agent-home roots actually
  // fed to `git check-ignore --stdin`. The gap between them is `pcHomesPresent`, already
  // counted in the `agentHomeRoots` clause.
  //
  // SOURCE LABEL, TWO states -- no-git / git-derived. A genuine call FAILURE (CWK-090 fix 1)
  // no longer has a third label state here: `applyCheckIgnoreProbe` FAILS LOUDLY via `fail()`
  // directly on that path, so by the time this line is reached (only when `pcHard.length ===
  // 0`, i.e. checkPointers' OWN findings are clean) a prior ignore-probe failure has already
  // been reported elsewhere and counted in the gate's overall `fails` tally -- this sentence
  // never needs to re-describe it.
  let pcIgnoredRootsLabel;
  if (!pcHasGit) pcIgnoredRootsLabel = 'no-git: nothing probed';
  else pcIgnoredRootsLabel = 'git-derived';
  // Same 3-state labelling, ourRoots -- a single `git ls-files` call has no partial-walk
  // state either, so this mirrors ignoredRoots' shape, not the old fed-count one.
  let pcOurRootsLabel;
  if (pcHasGit && pcOurRootsDerived) pcOurRootsLabel = 'git-derived';
  else if (!pcHasGit) pcOurRootsLabel = 'NO-GIT FALLBACK literal';
  else pcOurRootsLabel = 'NO-GIT FALLBACK literal -- derivation FAILED despite git being present';
  if (pcHard.length === 0) ok(`every in-scope path citation resolves or is declared (${pcFindings.checked} checked, ${pcSurfaces.length} surfaces, ${PC_OUR_ROOTS.size} ourRoots -- ${pcOurRootsLabel}, ${PC_AGENT_HOME_ROOTS.size} agentHomeRoots, ${pcCandidateRoots.size} distinct first segment(s) shape-qualified and cited / ${pcToProbe.length} probed (${pcHomesPresent} agent-home held out) -- ${pcIgnoredRootsLabel}, ${PC_IGNORED_ROOTS.size} ignoredRoots)`);
  else pcHard.forEach((f) => fail(f.msg));
} catch (e) { fail(`pointer check crashed: ${e.message}`); }

console.log('cross-platform SKILL transform engine (PARKED -- no active platform; add one only after verifying its spawn tool takes a worker model param):');
try {
  const bs = await import(pathToFileURL(path.join(repo, 'scripts', 'build-skill.mjs')).href);
  if (bs.PLATFORMS.length === 0) ok('PLATFORMS=[]: no active platform to check (expected while parked)');
  else for (const p of bs.PLATFORMS) fail(`${p}: in PLATFORMS but buildPlatform was removed — restore it before adding a platform`);
} catch (e) { fail(`cross-platform SKILL check: ${e.message}`); }

console.log('plugin/ dist (the clean CC plugin vs source SSoT):');
try {
  const { checkDist } = await import(pathToFileURL(path.join(repo, 'scripts', 'build-dist.mjs')).href);
  const drift = checkDist();
  if (!drift.length) ok('plugin/ matches source (skills + hooks + commands + manifest); no scripts/platform-configs leaked');
  else for (const d of drift) fail(d);
} catch (e) { fail(`plugin/ dist check: ${e.message}`); }

console.log(fails ? `\nVERIFY: FAIL (${fails})` : '\nVERIFY: PASS');
// CWK-071 -- node/runtime.md §7 bans process.exit() unconditionally: it truncates pending
// stdout writes, which is a real mechanism on an async host regardless of whether THIS
// entrypoint's own writes are ever caught by it. process.exitCode + a natural fall-through
// exit satisfies both readings of whether that risk reaches a fail-loud CLI gate like this
// one -- the ban applies either way, and this is a same-shape class fix landing in 6 of 6
// rooms, each its own file.
process.exitCode = fails ? 1 : 0;
