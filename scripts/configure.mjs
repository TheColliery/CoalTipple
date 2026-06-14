#!/usr/bin/env node
// CoalTipple configurator — edit .coaltipple.json from the command line.
// Flags, parsing, validation, and help all come from one table
// (scripts/lib/config-schema.mjs, shared with verify.mjs): a key added there is
// automatically settable, validated, and documented here. Fail-loud CLI (not a
// hook): a bad value exits non-zero and writes nothing.
//
// Unlike CoalMine's configurator (which writes plain JSON), this one PRESERVES
// the factory comments: it rewrites only the changed value lines in place, so the
// `## desc / # type / # default` docs survive. If the file is absent, it seeds
// from platform-configs/.coaltipple.json first, then applies the edits.
//
// TWO-LEVEL CASCADE: by default it writes the GLOBAL config (~/.claude/.coaltipple.json)
// = your defaults for ALL projects. Pass --project to write the per-project override
// (<gitroot>/.coaltipple.json) instead — that file is created ONLY when you use
// --project (no-clutter; a global install never auto-creates it). Effective precedence
// is project > global > schema default; `--list` shows that merged effective config.
//   node scripts/configure.mjs --qualityBar 85 --mode delegation   # edits GLOBAL
//   node scripts/configure.mjs --project --qualityBar 90            # edits THIS project
//   node scripts/configure.mjs --sensitive auth,crypto,payments
//   node scripts/configure.mjs --list      # show the merged effective config
//   node scripts/configure.mjs --help
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { CONFIG_SCHEMA, validateValue } from './lib/config-schema.mjs';
import { loadMergedConfig, globalConfigPath } from './lib/config-load.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const factoryCfg = path.join(repo, 'platform-configs', '.coaltipple.json');

function findGitRoot(startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}

function printHelp() {
  const lines = [
    'CoalTipple Configurator Utility',
    'Usage: node scripts/configure.mjs [--project] [options]',
    '',
    'Target (default = GLOBAL):',
    '  (none)                                   Write the GLOBAL config ~/.claude/.coaltipple.json (your defaults for ALL projects)',
    `  ${'--project, -p'.padEnd(40)} Write the per-project override <gitroot>/.coaltipple.json instead (created only when used)`,
    '',
    'Options:',
  ];
  for (const spec of CONFIG_SCHEMA) {
    const flags = [`--${spec.key}`, ...(spec.flags || [])].join(', ');
    lines.push(`  ${flags.padEnd(40)} ${spec.help}`);
  }
  lines.push(`  ${'--list'.padEnd(40)} Show the merged effective config (project > global > default)`);
  lines.push(`  ${'--help, -h'.padEnd(40)} Show this help message`);
  lines.push('');
  lines.push('Examples:');
  lines.push('  node scripts/configure.mjs --qualityBar 85 --mode delegation   # edits the GLOBAL defaults');
  lines.push('  node scripts/configure.mjs --project --qualityBar 90           # edits THIS project only');
  lines.push('  node scripts/configure.mjs --sensitive auth,crypto,payments');
  console.log(lines.join('\n'));
}

// Strip // and /* */ comments (string-aware) so the value JSON can be parsed.
function stripComments(content) {
  return content.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => (g ? '' : m));
}

function parseConfig(content) {
  let c = content;
  if (c.charCodeAt(0) === 0xFEFF) c = c.slice(1); // BOM-safe
  return JSON.parse(stripComments(c)) || {};
}

// Parse one raw CLI value against a spec. Returns { value } or { error }.
// `int` and `enum` reuse validateValue so the schema's own range/enum message is
// the single source of truth for what is rejected.
function parseValue(spec, raw) {
  switch (spec.type) {
    case 'bool': {
      if (raw !== 'true' && raw !== 'false') return { error: `${spec.key} needs true or false` };
      return { value: raw === 'true' };
    }
    case 'int': {
      if (raw === undefined || raw.trim() === '' || !/^-?\d+$/.test(raw.trim())) {
        return { error: `${spec.key} must be an integer` };
      }
      const n = parseInt(raw, 10);
      const err = validateValue(spec, n);
      return err ? { error: `${spec.key} ${err}` } : { value: n };
    }
    case 'enum': {
      const v = (raw || '').toLowerCase();
      const err = validateValue(spec, v);
      return err ? { error: `${spec.key} ${err}` } : { value: v };
    }
    case 'strArr': {
      if (raw === undefined) return { error: `${spec.key} needs a comma-separated value (pass "" to clear the list)` };
      if (raw === '' || raw === '""') return { value: [] };
      let items = raw.split(',').map((s) => s.trim()).filter(Boolean);
      if (spec.lower) items = items.map((s) => s.toLowerCase());
      return { value: items };
    }
    case 'obj':
      return { error: `${spec.key} is not CLI-settable — edit .coaltipple.json directly` };
    default:
      return { error: `internal: unknown spec type '${spec.type}'` };
  }
}

// Rewrite a single top-level "key": value line in the JSONC text, preserving the
// leading indentation, the trailing comma, and every comment around it. Returns
// the new text, or null if the key line is not present (caller appends instead).
function setKeyInText(text, key, jsonValue) {
  // Match an active (non-commented) "key": ... line. The leading group keeps the
  // indent; we only swap the value up to an optional trailing comma.
  const re = new RegExp(`^(\\s*"${key}"\\s*:\\s*)([^\\n]*?)(,?)(\\s*)$`, 'm');
  if (!re.test(text)) return null;
  return text.replace(re, (_m, head, _old, comma, tail) => `${head}${jsonValue}${comma || ','}${tail}`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { printHelp(); return; }

  // Target selection: GLOBAL by default; --project/-p writes the per-project override.
  const toProject = args.includes('--project') || args.includes('-p');
  const globalPath = globalConfigPath();
  const projectPath = path.join(findGitRoot(process.cwd()), '.coaltipple.json');
  const configPath = toProject ? projectPath : globalPath;

  // Pure --list (no setting flags): show the MERGED effective config and stop.
  // --project may accompany --list (it has no effect on a read; both files merge).
  const nonTargetArgs = args.filter((a) => a !== '--project' && a !== '-p');
  if (nonTargetArgs.length === 0 || (nonTargetArgs.length === 1 && nonTargetArgs[0] === '--list')) {
    let merged;
    try { merged = loadMergedConfig(); } catch (e) {
      console.error(`Error: cannot read config cascade: ${e.message}`); process.exitCode = 1; return;
    }
    const hasGlobal = fs.existsSync(globalPath), hasProject = fs.existsSync(projectPath);
    if (!hasGlobal && !hasProject) {
      console.log('No .coaltipple.json yet (global or project) — showing factory defaults:');
      try { merged = parseConfig(fs.readFileSync(factoryCfg, 'utf8')); } catch {}
    } else {
      const sources = [hasGlobal ? `global ${globalPath}` : null, hasProject ? `project ${projectPath}` : null].filter(Boolean);
      console.log(`Effective config (project > global; from ${sources.join(' + ')}):`);
    }
    console.log(JSON.stringify(merged, null, 2));
    return;
  }

  // Flag lookup: --<key> plus every alias in the table.
  const flagMap = new Map();
  for (const spec of CONFIG_SCHEMA) {
    flagMap.set(`--${spec.key}`, spec);
    for (const f of spec.flags || []) flagMap.set(f, spec);
  }

  // Parse + validate EVERYTHING before writing — a single bad value writes nothing.
  const edits = [];
  let listAfter = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--list') { listAfter = true; continue; }
    if (args[i] === '--project' || args[i] === '-p') continue; // target flag, handled above
    const spec = flagMap.get(args[i]);
    if (!spec) { console.error(`Error: Unrecognized option '${args[i]}'`); printHelp(); process.exitCode = 1; return; }
    const parsed = parseValue(spec, args[++i]);
    if (parsed.error) { console.error(`Error: ${parsed.error}`); process.exitCode = 1; return; }
    edits.push([spec.key, parsed.value]);
  }
  if (!edits.length) { console.error('Error: no settings given. Try --help.'); process.exitCode = 1; return; }

  // Load the existing JSONC text, or seed from the factory (preserving its comments).
  let text;
  try {
    if (fs.existsSync(configPath)) {
      text = fs.readFileSync(configPath, 'utf8');
      parseConfig(text); // validate it parses before we touch it
    } else {
      text = fs.readFileSync(factoryCfg, 'utf8');
      console.log(`No ${toProject ? 'project' : 'global'} config at ${configPath} — seeding from factory then applying your edits.`);
    }
  } catch (e) {
    console.error(`Error: cannot read/parse config: ${e.message}`); process.exitCode = 1; return;
  }
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  // Apply each edit in place (comment-preserving); append before the closing brace
  // if a key is missing (e.g. an optional key the user never had).
  for (const [key, value] of edits) {
    const json = JSON.stringify(value);
    const replaced = setKeyInText(text, key, json);
    if (replaced !== null) { text = replaced; continue; }
    const close = text.lastIndexOf('}');
    if (close === -1) { console.error('Error: config has no closing brace.'); process.exitCode = 1; return; }
    const before = text.slice(0, close).replace(/\s*$/, '');
    const lastChar = before.slice(-1);
    const needsComma = lastChar !== ',' && lastChar !== '{'; // a value precedes -> comma; empty object -> none
    text = `${before}${needsComma ? ',' : ''}\n  "${key}": ${json}\n${text.slice(close)}`;
  }

  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true }); // global target: ensure ~/.claude exists
    fs.writeFileSync(configPath, text, 'utf8');
    // Echo back the parsed effective config so the user sees the result.
    const eff = parseConfig(text);
    console.log(`Updated ${toProject ? 'project' : 'global'} config ${configPath}:`);
    for (const [key] of edits) console.log(`  ${key} = ${JSON.stringify(eff[key])}`);
    if (listAfter) console.log(JSON.stringify(loadMergedConfig(), null, 2));
  } catch (e) {
    console.error(`Error: failed to write config: ${e.message}`); process.exitCode = 1; return;
  }
}

main();
