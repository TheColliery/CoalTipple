// Zero-dep tests for the ranking Lock. Run: node --test classify.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  classifyModel, modelListHash, validateRanking, parseModel, buildHeuristicFloor,
  loadRanking, writeRankingAtomic, buildFloorRanking, SCHEMA_VER, escalationStep, applyPins, resolveWorker,
} from './classify.mjs';

test('parseModel: strips 256k/1m context suffix, extracts version, flags long-context', () => {
  assert.deepEqual(parseModel('Opus 4.8 256k'), { base: 'Opus 4.8', version: 4.8, longContext: true });
  assert.deepEqual(parseModel('Sonnet 4.6'), { base: 'Sonnet 4.6', version: 4.6, longContext: false });
});

test('floor collapses context variants + orders by version (flexible for many models)', () => {
  const r = buildHeuristicFloor(['Opus 4.8', 'Opus 4.8 256k', 'Opus 4.7', 'Opus 4.6', 'Haiku 4.5']);
  assert.deepEqual(r.heavy, ['Opus 4.8', 'Opus 4.7', 'Opus 4.6']); // 256k collapsed, version desc
  assert.deepEqual(r.low, ['Haiku 4.5']);
});

test('classifyModel: known -> tier; UNKNOWN -> heavy (Fable rule), never cheap', () => {
  assert.equal(classifyModel('Haiku 4.5'), 'low');
  assert.equal(classifyModel('Sonnet 4.6'), 'mid');
  assert.equal(classifyModel('Sonnet 4.6 (Thinking)'), 'heavy'); // strongest word wins over mid
  assert.equal(classifyModel('Opus 4.8'), 'heavy');
  assert.equal(classifyModel('Llama 3.3 70B (Local)'), 'local'); // local orthogonal, wins over 70b
  assert.equal(classifyModel('Fable 5'), 'heavy');        // unknown -> heavy, NOT cheap
  assert.equal(classifyModel('Mythos Preview'), 'heavy');
  assert.equal(classifyModel(''), 'heavy');
});

test('buildFloorRanking: alias + heuristic, complete, unknown lands heavy', () => {
  const r = buildFloorRanking(['Haiku 4.5', 'Opus 4.8', 'Fable 5']);
  assert.equal(r.complete, true);
  assert.equal(r.schemaVer, SCHEMA_VER);
  assert.ok(r.tiers.low.includes('Haiku 4.5'));
  assert.ok(r.tiers.heavy.includes('Opus 4.8'));
  assert.ok(r.tiers.heavy.includes('Fable 5'));
  assert.ok(r.tiers.reasoning.length > 0);
});

test('validity gate: missing / wrong-schema / incomplete / stale all fail; good passes', () => {
  assert.equal(validateRanking(null, 'h'), 'missing');
  assert.equal(validateRanking({ schemaVer: 999, complete: true, tiers: {} }, null), 'schema-version mismatch');
  assert.match(validateRanking({ schemaVer: SCHEMA_VER, complete: false, tiers: {} }, null), /incomplete/);
  assert.match(validateRanking({ schemaVer: SCHEMA_VER, complete: true, tiers: {}, listHash: 'old' }, 'new'), /stale/);
  assert.equal(validateRanking({ schemaVer: SCHEMA_VER, complete: true, tiers: { low: [] }, listHash: 'x' }, 'x'), null);
});

test('atomic write + load roundtrip; stale/corrupt/missing -> rebuild signal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-rank-'));
  try {
    const models = ['Haiku 4.5', 'Opus 4.8'];
    const hash = modelListHash(models);
    writeRankingAtomic(dir, buildFloorRanking(models));

    const ok = loadRanking(dir, hash);
    assert.equal(ok.ok, true);
    assert.ok(ok.ranking.tiers.low.includes('Haiku 4.5'));

    assert.equal(loadRanking(dir, 'differenthash').ok, false); // stale

    fs.writeFileSync(path.join(dir, 'ranking.json'), '{ broken json', 'utf8');
    const bad = loadRanking(dir, hash);
    assert.equal(bad.ok, false);
    assert.match(bad.reason, /unreadable/);

    fs.rmSync(path.join(dir, 'ranking.json'));
    assert.equal(loadRanking(dir, hash).ok, false); // missing
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('modelListHash: order-independent, changes when the list changes', () => {
  assert.equal(modelListHash(['a', 'b']), modelListHash(['b', 'a']));
  assert.notEqual(modelListHash(['a', 'b']), modelListHash(['a', 'b', 'c']));
});

test('escalationStep: climbs one rung when near the bar with attempts left', () => {
  assert.equal(escalationStep('low', { attemptsLeft: 2, farBelow: false }), 'mid');
  assert.equal(escalationStep('mid', { attemptsLeft: 1, farBelow: false }), 'heavy');
  assert.equal(escalationStep('heavy', { attemptsLeft: 1, farBelow: false }), 'reasoning');
});

test('escalationStep: jumps to the top tier when far below the bar (next rung will not clear it)', () => {
  assert.equal(escalationStep('mid', { attemptsLeft: 1, farBelow: true }), 'reasoning');
  assert.equal(escalationStep('low', { attemptsLeft: 5, farBelow: true }), 'reasoning');
});

test('escalationStep: jumps to the top tier when the attempt budget is spent', () => {
  assert.equal(escalationStep('mid', { attemptsLeft: 0, farBelow: false }), 'reasoning');
});

test('escalationStep: returns null at the top (nowhere to climb, hand back)', () => {
  assert.equal(escalationStep('reasoning', { attemptsLeft: 1 }), null);
});

test('escalationStep: off-ladder tier (local) enters the climb at the bottom', () => {
  assert.equal(escalationStep('local', { attemptsLeft: 1 }), 'low');
});

test('applyPins: front-loads pinned models, de-dups across tiers, no-pin = passthrough copy', () => {
  const base = { local: [], low: ['haiku'], mid: ['sonnet'], heavy: ['opus'], reasoning: ['opus'] };
  assert.deepEqual(applyPins(base, {}), base);                       // no pins -> same content
  assert.deepEqual(applyPins(base, null), base);                     // bad pins -> safe passthrough
  const r = applyPins(base, { reasoning: 'mythos-6' });              // pin a model introspection can't see
  assert.deepEqual(r.reasoning, ['mythos-6', 'opus']);               // pinned wins (front)
  const r2 = applyPins(base, { mid: 'opus' });                       // re-pin across tiers
  assert.deepEqual(r2.mid, ['opus', 'sonnet']);
  assert.equal(r2.heavy.includes('opus'), false);                    // de-duped out of heavy
  assert.equal(r2.reasoning.includes('opus'), false);               // de-duped out of reasoning
  assert.deepEqual(applyPins(base, { low: ['a', 'b'] }).low, ['a', 'b', 'haiku']); // array pin
});

test('buildFloorRanking honors modelTiers pins (the introspection blind-spot override)', () => {
  const r = buildFloorRanking(['Haiku 4.5', 'Opus 4.8'], { reasoning: 'fable-9-unreleased' });
  assert.equal(r.tiers.reasoning[0], 'fable-9-unreleased'); // a model introspection can't see, pinned -> wins
  assert.equal(r.complete, true);
  assert.ok(r.tiers.low.includes('Haiku 4.5'));            // floor still built underneath
});

test('resolveWorker: limit-hit falls DOWN to the next available tier', () => {
  const ranking = { tiers: { low: ['haiku'], mid: ['sonnet'], heavy: ['opus-4.8', 'opus-4.7'], reasoning: ['fable'] } };
  // Opus 4.8 quota-hit -> next heavy version (within-tier first)
  assert.deepEqual(resolveWorker(ranking, 'heavy', { blocked: ['opus-4.8'] }), { tier: 'heavy', model: 'opus-4.7' });
  // all Opus blocked (shared quota) -> drop a tier to mid
  assert.deepEqual(resolveWorker(ranking, 'heavy', { blocked: ['opus-4.8', 'opus-4.7'] }), { tier: 'mid', model: 'sonnet' });
  // reasoning (Fable) blocked -> fall to heavy
  assert.deepEqual(resolveWorker(ranking, 'reasoning', { blocked: ['fable'] }), { tier: 'heavy', model: 'opus-4.8' });
});

test('resolveWorker: SENSITIVE floor never breached on a limit-hit (never-down holds under quota)', () => {
  const ranking = { tiers: { low: ['haiku'], mid: ['sonnet'], heavy: ['opus-4.8'], reasoning: ['fable'] } };
  // crypto: floor=heavy; Fable blocked -> falls to heavy (at floor, ok)
  assert.deepEqual(resolveWorker(ranking, 'reasoning', { blocked: ['fable'], floorTier: 'heavy' }), { tier: 'heavy', model: 'opus-4.8' });
  // heavy ALSO quota-blocked -> null (hand back), NOT a fall to mid/low — never route crypto cheap on a limit-hit
  assert.equal(resolveWorker(ranking, 'reasoning', { blocked: ['fable', 'opus-4.8'], floorTier: 'heavy' }), null);
});

test('resolveWorker: everything blocked -> null (hand back / do it yourself)', () => {
  const ranking = { tiers: { low: ['haiku'], mid: ['sonnet'], heavy: ['opus'], reasoning: ['fable'] } };
  assert.equal(resolveWorker(ranking, 'heavy', { blocked: ['haiku', 'sonnet', 'opus', 'fable'] }), null);
});
