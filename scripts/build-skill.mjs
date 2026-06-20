#!/usr/bin/env node
// CoalTipple cross-platform SKILL build (transform-from-CC).
//
// The Claude Code SKILL (skills/coaltipple/SKILL.md) is the SOURCE OF TRUTH and is NEVER
// modified by this script. A non-CC platform's SKILL.md is DERIVED from it by applying that
// platform's adapter: a list of literal find->replace rules (token swaps + whole-block
// overrides) for every platform-specific in the contract.
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

const NUL = String.fromCharCode(0) // sentinel — never present in markdown source

export const TODO_OPEN = '<<TODO:';

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

// AG scrapped 2026-06-16: Antigravity cannot actuate routing -- a spawned subagent inherits the
// PARENT's model (invoke_subagent/define_subagent expose no model param) and AG has no separate
// effort knob (low/mid/high are baked into model names). Confirmed by reading the live tool schema
// in-app. The transform ENGINE (applyAdapter) is PARKED here for the first platform that passes
// the spawn-model-param check. Add a platform entry here ONLY after verifying its spawn tool
// accepts a worker model parameter -- read the ACTUAL tool schema, do not trust docs.
// Capability movement is reviewed monthly.
export const PLATFORMS = []
