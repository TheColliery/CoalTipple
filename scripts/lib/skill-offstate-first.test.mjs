// T-29st-1 (29sy): both shipped SKILL.md copies carry ONE prose sentence, before the first acting step (`## Step 1`), that
// orders the agent to READ the (merged) config and check the OFF-STATE first. The K2 walk (29st) passed exactly when the
// leaf read the project config (32 of 32), and a slash-invoked /coaltipple may arrive with no conductor line, so the order
// has to live in the skill text. Ported from the reviewer's throwaway witness (scratchpad/29sw/rv/rv-offstate-first.mjs);
// reads the working-tree files, makes no git call. Zero-dep (node:test + built-ins).
//
// LIMIT, recorded by the reviewer and kept: PRESENCE IS NOT OBEDIENCE. This test pins that the sentence is there, in the
// right place; only a walk measures whether an agent follows it. Table rows are skipped (the Grants `read` row names the
// merged config while declaring a grant, not an order of steps), so an order written only inside a table row reads RED.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILES = ['skills/coaltipple/SKILL.md', 'plugin/skills/coaltipple/SKILL.md'];
const READ = /\b(read|re-read|open|load|check)\b/i;
const CONFIG = /\bconfig\b/i;
const OFF = /\boff-state\b|\benableRouting\b|\bmode:\s*'?off|\brouting (is )?off\b/i;
const ORDER = /\bbefore\b|\bfirst\b/i;

// The sentences before `## Step 1` (frontmatter and table rows left out) that carry all four parts at once.
export function offStateFirstSentences(text) {
  const lines = text.split(/\r?\n/);
  const stop = lines.findIndex((l) => /^## Step 1\b/.test(l));
  if (stop < 0) return null;
  const close = lines.indexOf('---', 1);
  const before = lines.slice(close + 1, stop).filter((l) => !/^\s*\|/.test(l)).join('\n');
  return before.split(/(?<=[.!?])\s+|\n/).map((s) => s.trim()).filter(Boolean)
    .filter((s) => READ.test(s) && CONFIG.test(s) && OFF.test(s) && ORDER.test(s));
}

for (const f of FILES) {
  test(`${f}: a sentence before "## Step 1" orders the config read and the off-state check first`, () => {
    const hits = offStateFirstSentences(fs.readFileSync(path.join(REPO, f), 'utf8'));
    assert.notEqual(hits, null, `${f} has no "## Step 1" heading`);
    assert.ok(hits.length >= 1, `${f}: no prose sentence before "## Step 1" carries a read verb, "config", an off-state term and an ordering word`);
  });
}

test('the check reads a table row as no order, and a prose sentence after Step 1 as too late', () => {
  const head = '---\nname: x\n---\n';
  assert.deepEqual(offStateFirstSentences(`${head}| read | the merged config, check routing off first |\n\n## Step 1\n`), []);
  assert.deepEqual(offStateFirstSentences(`${head}Intro.\n\n## Step 1\n\nFirst read the config and check the off-state.\n`), []);
  assert.equal(offStateFirstSentences(`${head}First read the config and check the off-state.\n\n## Step 1\n`).length, 1);
});
