#!/usr/bin/env node
// CoalTipple verify gate — fail LOUD if the factory config drifts from the
// schema, the skill/conductor are missing/malformed, or a lib fails to import.
// Wrapped per-check so one bad input yields a clean FAIL line, not a stack trace.
// Run by the pre-commit / pre-push hooks.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CONFIG_SCHEMA, validateValue } from './lib/config-schema.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
  if (/^\d+\.\d+\.\d+$/.test(pj.version || '')) {
    const cl = fs.readFileSync(path.join(repo, 'CHANGELOG.md'), 'utf8');
    const top = (cl.match(/^##\s*\[(\d+\.\d+\.\d+)\]/m) || [])[1];
    if (top === pj.version) ok(`version ${pj.version} matches top CHANGELOG entry`);
    else fail(`plugin.json version ${pj.version} != top CHANGELOG [${top || 'none'}] — bump bookkeeping out of sync`);
  } else fail(`plugin.json version '${pj.version}' not semver`);
  // hooks.json must reference the conductor under ${CLAUDE_PLUGIN_ROOT} (only resolves with plugin.json present)
  const hj = fs.readFileSync(path.join(repo, 'hooks', 'hooks.json'), 'utf8');
  if (hj.includes('${CLAUDE_PLUGIN_ROOT}/hooks/coaltipple-conductor.js')) ok('hooks.json wires the conductor via ${CLAUDE_PLUGIN_ROOT}');
  else fail('hooks.json does not wire the conductor under ${CLAUDE_PLUGIN_ROOT}');
} catch (e) { fail(`plugin manifest: ${e.message}`); }

console.log('skill:');
try {
  const md = fs.readFileSync(path.join(repo, 'skills', 'coaltipple', 'SKILL.md'), 'utf8');
  if (/^---[\s\S]*?name:\s*coaltipple[\s\S]*?description:[\s\S]*?---/.test(md)) ok('SKILL.md frontmatter (name + description)');
  else fail('SKILL.md frontmatter malformed (need name: coaltipple + description)');
} catch (e) { fail(`SKILL.md unreadable: ${e.message}`); }

console.log('config (factory vs schema):');
try {
  let c = fs.readFileSync(path.join(repo, 'platform-configs', '.coaltipple.json'), 'utf8');
  if (c.charCodeAt(0) === 0xFEFF) c = c.slice(1);
  const clean = c.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => (g ? '' : m));
  const cfg = JSON.parse(clean);
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
    const name = r.open.replace('// <coaltipple-shared: ', '').replace('>', '');
    const oi = src.indexOf(r.open), ci = src.indexOf(r.close);
    if (oi === -1 || ci === -1 || ci < oi) { fail(`${name}: markers missing/disordered in .coaltipple.json`); continue; }
    const current = src.slice(src.indexOf('\n', oi) + 1, ci).trim();
    const expected = (await r.gen()).trim();
    if (current.split(cr).join('') === expected.split(cr).join('')) ok(`${name} config in sync with keywords.mjs`);
    else fail(`${name} config DRIFTED from keywords.mjs -- run \`node scripts/build-plugin.mjs\``);
  }
} catch (e) { fail(`config-region check: ${e.message}`); }

console.log('config-path sync (conductor + configure inline vs config-load SSoT):');
try {
  // The project-config path lives under .claude in config-load.mjs (the SSoT). The
  // conductor and configure inline their OWN copy (the hook must be standalone,
  // Phoenix #9 — it cannot import config-load), so a future edit to one could silently
  // drift. Assert all three reference the same path segments — the path analogue of the
  // hot-keyword sync above. Cheap presence guard, not a full parse.
  const seg = "'.claude', '.coaltipple.json'";
  for (const [label, rel] of [
    ['config-load.mjs', ['scripts', 'lib', 'config-load.mjs']],
    ['coaltipple-conductor.js', ['hooks', 'coaltipple-conductor.js']],
    ['configure.mjs', ['scripts', 'configure.mjs']],
  ]) {
    const s = fs.readFileSync(path.join(repo, ...rel), 'utf8');
    if (s.includes(seg)) ok(`${label} references the .claude project-config path`);
    else fail(`${label} lost ${seg} — project-config path DRIFTED from config-load (the SSoT)`);
  }
} catch (e) { fail(`config-path sync: ${e.message}`); }

console.log('plugin/ dist (the clean CC plugin vs source SSoT):');
try {
  const { checkDist } = await import(pathToFileURL(path.join(repo, 'scripts', 'build-dist.mjs')).href);
  const drift = checkDist();
  if (!drift.length) ok('plugin/ matches source (skills + hooks + commands + manifest); no scripts/platform-configs leaked');
  else for (const d of drift) fail(d);
} catch (e) { fail(`plugin/ dist check: ${e.message}`); }

console.log(fails ? `\nVERIFY: FAIL (${fails})` : '\nVERIFY: PASS');
process.exit(fails ? 1 : 0);
