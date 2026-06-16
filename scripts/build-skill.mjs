#!/usr/bin/env node
// CoalTipple cross-platform SKILL build (transform-from-CC).
//
// The Claude Code SKILL (skills/coaltipple/SKILL.md) is the SOURCE OF TRUTH and is NEVER
// modified by this script. A non-CC platform's SKILL.md is DERIVED from it by applying that
// platform's adapter (skill-src/adapters/<platform>.mjs): a list of literal find->replace
// rules (token swaps + whole-block overrides) for every platform-specific in the contract.
//
// Three guarantees keep this safe:
//  1. DRIFT GATE — every rule's `find` MUST occur >= its `min` (default 1) in the CC source.
//     A miss means the CC crux changed a platform-specific the adapter no longer maps, so the
//     build FAILs loud (you then update the adapter).
//  2. NO-MIX GATE — after transform, NONE of the adapter's `forbidden` CC-isms may survive in
//     the output (e.g. ~/.claude, xhigh, ultracode). A residual = a platform-specific the
//     adapter has not swapped yet — the build reports it (and --check fails on it).
//  3. NO CASCADE — replacement is two-phase via NUL sentinels, rules applied longest-find-first,
//     so a short find can't pre-empt a longer one and an inserted replacement is never rescanned.
//
// Unfilled values use TODO(...) and survive as visible <<TODO:...>> text; --check fails on them
// too, so a half-finished adapter can never ship. Node built-ins only.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CC_SKILL = path.join(repo, 'skills', 'coaltipple', 'SKILL.md');
const NUL = String.fromCharCode(0); // sentinel — never present in markdown source

export const TODO_OPEN = '<<TODO:';

export function platformOut(platform) {
  if (!PLATFORMS.includes(platform)) throw new Error('unknown platform: ' + JSON.stringify(platform));
  return path.join(repo, 'platform-skills', platform, 'coaltipple', 'SKILL.md');
}

export async function loadAdapter(platform) {
  if (!PLATFORMS.includes(platform)) throw new Error('unknown platform: ' + JSON.stringify(platform));
  const mod = await import(pathToFileURL(path.join(repo, 'skill-src', 'adapters', platform + '.mjs')).href);
  return mod.default ?? mod.adapter;
}

const count = (hay, needle) => hay.split(needle).length - 1;

// Apply an adapter's rules to the CC source. Throws on drift (a find that no longer hits).
// Returns { text, todos, residual }.
export function applyAdapter(ccText, adapter) {
  const rules = [...adapter.rules].sort((a, b) => b.find.length - a.find.length);
  const misses = rules.filter((r) => count(ccText, r.find) < (r.min ?? 1));
  if (misses.length) {
    throw new Error(
      'adapter rule(s) did not hit the CC source (the crux changed a platform-specific — update the adapter):\n' +
        misses.map((m) => '  MISSING find: ' + JSON.stringify(m.find)).join('\n'),
    );
  }
  let out = ccText;
  rules.forEach((r, i) => { out = out.split(r.find).join(NUL + i + NUL); });
  rules.forEach((r, i) => { out = out.split(NUL + i + NUL).join(r.replace); });
  const todos = rules.filter((r) => r.replace.includes(TODO_OPEN)).map((r) => r.find);
  const residual = (adapter.forbidden || []).filter((f) => out.includes(f));
  return { text: out, todos, residual };
}

// Build (check=false) or verify (check=true) a platform's derived SKILL.md. Returns, for
// build: { todos, residual }; for check: a list of problem strings ([] = ok).
export async function buildPlatform(platform, opts) {
  const check = opts && opts.check;
  const cc = fs.readFileSync(CC_SKILL, 'utf8');
  const adapter = await loadAdapter(platform);
  const { text, todos, residual } = applyAdapter(cc, adapter);
  const dest = platformOut(platform);
  if (check) {
    const out = [];
    if (!fs.existsSync(dest)) out.push('missing: platform-skills/' + platform + '/coaltipple/SKILL.md — run: node scripts/build-skill.mjs ' + platform);
    else if (fs.readFileSync(dest, 'utf8') !== text) out.push('stale: platform-skills/' + platform + '/coaltipple/SKILL.md — run: node scripts/build-skill.mjs ' + platform);
    if (residual.length) out.push(platform + ': residual CC-ism(s) leaked into output (un-swapped): ' + residual.join(', '));
    if (todos.length) out.push(platform + ': ' + todos.length + ' unfilled TODO(s) — adapter not ready to ship');
    return out;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, text, 'utf8');
  return { todos, residual };
}

// AG scrapped 2026-06-16: Antigravity cannot actuate routing -- a spawned subagent inherits the
// PARENT's model (invoke_subagent/define_subagent expose no model param) and AG has no separate
// effort knob (low/mid/high are baked into model names). Confirmed by reading the live tool schema
// in-app. The transform ENGINE above is PARKED, not deleted. Add a platform here ONLY after
// verifying its spawn tool accepts a worker model parameter -- read the ACTUAL tool schema, do not
// trust docs (AG's docs implied yes; the tool said no). Capability movement is reviewed monthly.
export const PLATFORMS = [];

async function main() {
  const checkOnly = process.argv.includes('--check');
  const only = process.argv.find((a) => !a.startsWith('-') && PLATFORMS.includes(a));
  const targets = only ? [only] : PLATFORMS;
  const problems = [];
  for (const p of targets) {
    try {
      if (checkOnly) {
        const res = await buildPlatform(p, { check: true });
        if (res.length) problems.push(...res);
        else console.log('  ok   ' + p + ': SKILL.md in sync with CC source, no residual CC-isms, no TODOs');
      } else {
        const { todos, residual } = await buildPlatform(p, { check: false });
        console.log('  built platform-skills/' + p + '/coaltipple/SKILL.md from CC source');
        if (residual.length) console.log('         RESIDUAL CC-ism still to swap: ' + residual.join(', '));
        console.log('         TODO(' + todos.length + '): ' + (todos.length ? todos.map((t) => JSON.stringify(t)).join(' | ') : 'none'));
      }
    } catch (e) {
      problems.push(p + ': ' + e.message);
    }
  }
  if (problems.length) {
    console.error((checkOnly ? 'cross-platform SKILL OUT OF SYNC:\n' : 'SKILL build FAILED:\n') + problems.map((x) => '  ' + x).join('\n'));
    process.exit(1);
  }
  console.log(checkOnly ? '\ncross-platform SKILL: in sync.' : '\ncross-platform SKILL: built.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('build-skill failed: ' + e.message); process.exit(1); });
}
