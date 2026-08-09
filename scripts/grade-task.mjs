#!/usr/bin/env node
// grade-task -- a thin CLI skin over the EXISTING grade()/resolveWorker() exports,
// for a department head about to dispatch a `claude -p --resume <sid>` org-resident
// (a separate OS process CT's own Agent-tool routing has no surface for -- see
// COALTIPPLE_RESIDENT_DISPATCH_DESIGN.md, board #44). Zero new grading logic: this
// file only parses argv and prints JSON from functions grade.test.mjs/classify.test.mjs
// already cover. Advisory only -- CT cannot see a `-p` dispatch happen and this
// wrapper never touches model/effort FLIP decisions on a seated org-resident (design
// doc §3: a stateless CLI has no channel to a sid's current pin; that stays the
// dispatcher's judgment call, per agent-roster.md's cache-flip law).
//   node scripts/grade-task.mjs --prompt "..." [--file path[:lines] ...] [--size-units N]
import { grade } from './lib/grade.mjs';
import { loadMergedConfig, globalStateDir } from './lib/config-load.mjs';
import { loadRanking, resolveWorker } from './lib/classify.mjs';

// A flag-shaped next token means the user forgot the value -- error rather than
// silently swallowing the next flag as data (configure.mjs's M7a fix, ported here;
// INSPECT board #44 Finding 1: --file --size-units 5 used to produce a phantom
// file {path:"--size-units"} AND silently drop --size-units' own value).
const looksLikeFlag = (s) => typeof s === 'string' && s.startsWith('-');

function parseArgs(argv) {
  const out = { prompt: '', files: [], sizeUnits: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--prompt') out.prompt = argv[++i] ?? '';
    else if (a === '--file') {
      const next = argv[i + 1];
      if (next === undefined || looksLikeFlag(next)) return { error: '--file needs a value' };
      const raw = argv[++i];
      const sep = raw.lastIndexOf(':');
      // A bare path may itself contain ':' (a Windows drive letter) -- only treat the
      // split as path:lines when the tail actually parses as a non-negative integer,
      // else the whole string is the path (lines defaults to 0, same as no ':' at all).
      const tail = sep >= 0 ? raw.slice(sep + 1) : '';
      const lines = /^\d+$/.test(tail) ? Number(tail) : NaN;
      if (Number.isFinite(lines)) out.files.push({ path: raw.slice(0, sep), lines });
      else out.files.push({ path: raw, lines: 0 });
    } else if (a === '--size-units') {
      const next = argv[i + 1];
      if (next === undefined || looksLikeFlag(next)) return { error: '--size-units needs a value' };
      const n = Number(argv[++i]);
      if (!Number.isFinite(n)) return { error: '--size-units needs a numeric value' };
      out.sizeUnits = n;
    } else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.error(`Error: ${args.error}`);
    process.exitCode = 1;
    return;
  }
  if (args.help || !args.prompt) {
    console.log('Usage: node scripts/grade-task.mjs --prompt "<task text>" [--file path[:lines] ...] [--size-units N]');
    console.log('Advisory only -- see COALTIPPLE_RESIDENT_DISPATCH_DESIGN.md. Prints grade()\'s own verdict as JSON; never touches effort or a flip decision.');
    process.exitCode = args.help ? 0 : 1;
    return;
  }

  const config = loadMergedConfig();
  const g = grade({ prompt: args.prompt, files: args.files, sizeUnits: args.sizeUnits, config });

  let suggestedModel = null;
  let modelSource = 'tier-only';
  const loaded = loadRanking(globalStateDir());
  if (loaded.ok) {
    const resolved = resolveWorker(loaded.ranking, g.tier, { sensitive: g.sensitive });
    if (resolved) { suggestedModel = resolved.model; modelSource = 'global-ranking'; }
  }

  console.log(JSON.stringify({ ...g, suggestedModel, modelSource }));
}

main();
