#!/usr/bin/env node
// CoalTipple verify gate — fail LOUD if the factory config drifts from the
// schema, the skill/conductor are missing/malformed, or a lib fails to import.
// Wrapped per-check so one bad input yields a clean FAIL line, not a stack trace.
// Run by the pre-commit / pre-push hooks.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
process.exit(fails ? 1 : 0);
