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

// AG scrapped 2026-06-16, re-checked 2026-08-04: Antigravity's invoke_subagent DOES take a
// per-spawn Model field (proven live) -- a bare spawn-model-param check PASSES it. It still
// cannot actuate CT's routing: the Model field selects a GOOGLE tier regardless of the Claude
// parent's vendor (a cross-vendor handoff, not a cheaper same-family worker), and no effort
// knob exists anywhere in the schema. CT's never-down gate, qualityBar staircase, and Claude
// alias floor don't map onto that shape. The transform ENGINE (applyAdapter) is PARKED here
// for the first platform that passes BOTH checks. Add a platform entry here ONLY after
// verifying its spawn tool takes a SAME-VENDOR worker model param AND a separate effort knob --
// read the ACTUAL tool schema, do not trust docs, and do not stop at the model-param check alone.
// Capability movement is reviewed monthly.
export const PLATFORMS = []
