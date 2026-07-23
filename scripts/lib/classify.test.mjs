// Zero-dep tests for the ranking Lock. Run: node --test classify.test.mjs
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  aliasDefaults, modelListHash, validateRanking,
  loadRanking, writeRankingAtomic, buildFloorRanking, SCHEMA_VER, escalationStep, applyPins, resolveWorker, isFableModel,
} from './classify.mjs';

test('writeRankingAtomic falls back to a direct write on EPERM/EBUSY (#7 Windows) — the update is never lost', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-rank-'));
  try {
    mock.method(fs, 'renameSync', () => { const e = new Error('EPERM'); e.code = 'EPERM'; throw e; });
    writeRankingAtomic(dir, { schemaVer: SCHEMA_VER, complete: true, tiers: {} });
    mock.restoreAll();
    const written = fs.readdirSync(dir).filter((f) => !f.includes('.tmp'));
    assert.equal(written.length, 1, 'dest written via the fallback; tmp cleaned (no orphan)');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, written[0]), 'utf8')).schemaVer, SCHEMA_VER);
  } finally { mock.restoreAll(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('aliasDefaults: the alias floor structure (low<mid<heavy<reasoning = haiku<sonnet<opus<fable, no local/empty)', () => {
  // B2: the ranking IS this constant alias floor — routing keys off the tier STRUCTURE,
  // not an enumerated model list. haiku<sonnet<opus -> low/mid/heavy; reasoning = fable (the
  // top rung above opus, consent-gated before spawn).
  assert.deepEqual(aliasDefaults(), { local: [], low: ['haiku'], mid: ['sonnet'], heavy: ['opus'], reasoning: ['fable'] });
});

test('buildFloorRanking: ALWAYS the alias floor (B2 — models do not shape tiers, only stamp listHash)', () => {
  const r = buildFloorRanking();
  assert.equal(r.complete, true);
  assert.equal(r.schemaVer, SCHEMA_VER);
  assert.equal(r.source, 'alias-floor');
  assert.deepEqual(r.tiers.low, ['haiku']);
  assert.deepEqual(r.tiers.mid, ['sonnet']);
  assert.deepEqual(r.tiers.heavy, ['opus']);   // strong floor: an unknown model the agent over-provisions to 'heavy' lands here
  assert.deepEqual(r.tiers.reasoning, ['fable']); // reasoning = fable, the top rung (consent-gated before spawn)
  // The `models` arg is for the listHash fingerprint ONLY — it must NOT inject names into the tiers
  // (no introspection layer; routing rides the structure + unknown->heavy + the spawn-fail-fall).
  const r2 = buildFloorRanking(['Some-New-Model 9', 'Mythos Preview', 'Fable 5']);
  assert.deepEqual(r2.tiers, r.tiers, 'arbitrary model names do not pollute the alias floor');
});

test('validity gate: missing / wrong-schema / incomplete / stale all fail; good passes', () => {
  // A complete + usable tiers map (every TIERS key present, >=1 non-empty) — the baseline a valid ranking needs.
  const full = (over = {}) => ({ schemaVer: SCHEMA_VER, complete: true, tiers: { local: [], low: ['haiku'], mid: [], heavy: [], reasoning: [] }, ...over });
  assert.equal(validateRanking(null, 'h'), 'missing');
  assert.equal(validateRanking({ schemaVer: 999, complete: true, tiers: {} }, null), 'schema-version mismatch');
  assert.match(validateRanking(full({ complete: false }), null), /incomplete/);
  assert.match(validateRanking(full({ listHash: 'old' }), 'new'), /stale/);
  assert.equal(validateRanking(full({ listHash: 'x' }), 'x'), null);
});

test('validity gate: local-only ranking and empty-string models are REJECTED (routable-tier check)', () => {
  // 'local' is NOT on the escalation ladder -> a local-only ranking routes nothing, yet a
  // naive TIERS check passed it ("Lock reads green while routing is dead" — the audit finding).
  assert.match(validateRanking({ schemaVer: SCHEMA_VER, complete: true, tiers: { local: ['haiku', 'sonnet', 'opus'], low: [], mid: [], heavy: [], reasoning: [] } }, null), /routable|dead/);
  // an empty-string entry is no model.
  assert.match(validateRanking({ schemaVer: SCHEMA_VER, complete: true, tiers: { local: [''], low: [''], mid: [], heavy: [], reasoning: [] } }, null), /routable|dead/);
  // a genuinely routable ranking still passes.
  assert.equal(validateRanking({ schemaVer: SCHEMA_VER, complete: true, tiers: { local: [], low: ['haiku'], mid: ['sonnet'], heavy: ['opus'], reasoning: ['opus'] } }, null), null);
});

test('validity gate (strict): array tiers / {} / missing key / non-array value / all-empty / complete-truthy all REJECTED', () => {
  // A loosely-"valid" ranking that makes resolveWorker return null for every tier = routing silently dead.
  assert.match(validateRanking({ schemaVer: SCHEMA_VER, complete: true, tiers: [] }, null), /no tiers/);          // array, not a plain object
  assert.match(validateRanking({ schemaVer: SCHEMA_VER, complete: true, tiers: {} }, null), /missing\/non-array/); // {} -> no keys
  assert.match(validateRanking({ schemaVer: SCHEMA_VER, complete: true, tiers: { local: [], low: ['x'], mid: [], heavy: [] } }, null), /reasoning/); // missing a key
  assert.match(validateRanking({ schemaVer: SCHEMA_VER, complete: true, tiers: { local: [], low: 'x', mid: [], heavy: [], reasoning: [] } }, null), /non-array/); // non-array value
  assert.match(validateRanking({ schemaVer: SCHEMA_VER, complete: true, tiers: { local: [], low: [], mid: [], heavy: [], reasoning: [] } }, null), /routable|dead/); // every tier empty -> routing dead
  assert.match(validateRanking({ schemaVer: SCHEMA_VER, complete: 1, tiers: { local: [], low: ['x'], mid: [], heavy: [], reasoning: [] } }, null), /incomplete/); // complete truthy, not === true
});

test('atomic write + load roundtrip; stale/corrupt/missing -> rebuild signal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-rank-'));
  try {
    const models = ['Haiku 4.5', 'Opus 4.8'];
    const hash = modelListHash(models);
    writeRankingAtomic(dir, buildFloorRanking(models));

    const ok = loadRanking(dir, hash);
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.ranking.tiers.low, ['haiku']); // the alias floor (B2: models stamp the hash, don't shape tiers)

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

test('buildFloorRanking honors modelTiers pins (the human override for a model the agent cannot see)', () => {
  const r = buildFloorRanking([], { reasoning: 'fable-9-unreleased' });
  assert.equal(r.tiers.reasoning[0], 'fable-9-unreleased'); // a model the agent can't see, pinned -> wins (front)
  assert.equal(r.complete, true);
  assert.deepEqual(r.tiers.low, ['haiku']);                // the alias floor is built underneath the pins
  // a pin re-tiering an alias-floor model de-dups it out of its old tier
  const r2 = buildFloorRanking([], { mid: 'opus' });
  assert.equal(r2.tiers.mid[0], 'opus');
  assert.equal(r2.tiers.heavy.includes('opus'), false);
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

test('resolveWorker: a SCALAR blocked (a model-supplied single option) never throws — normalized to an array', () => {
  // The never-fail contract: blocked may arrive as a bare string, not an array. A string's
  // `.map` would throw; normalize first so it behaves like a one-element block list.
  const ranking = { tiers: { low: ['haiku'], mid: ['sonnet'], heavy: ['opus-4.8', 'opus-4.7'], reasoning: ['fable'] } };
  assert.doesNotThrow(() => resolveWorker(ranking, 'heavy', { blocked: 'opus-4.8' }));
  // scalar 'opus-4.8' blocked -> within-tier next version, same as the array form.
  assert.deepEqual(resolveWorker(ranking, 'heavy', { blocked: 'opus-4.8' }), { tier: 'heavy', model: 'opus-4.7' });
  // a scalar that blocks the only model at a tier still falls correctly.
  assert.deepEqual(resolveWorker(ranking, 'reasoning', { blocked: 'fable' }), { tier: 'heavy', model: 'opus-4.8' });
  // null / undefined blocked are tolerated (default-empty) and never throw.
  assert.deepEqual(resolveWorker(ranking, 'heavy', { blocked: null }), { tier: 'heavy', model: 'opus-4.8' });
});

test('resolveWorker: everything blocked -> null (hand back / do it yourself)', () => {
  const ranking = { tiers: { low: ['haiku'], mid: ['sonnet'], heavy: ['opus'], reasoning: ['fable'] } };
  assert.equal(resolveWorker(ranking, 'heavy', { blocked: ['haiku', 'sonnet', 'opus', 'fable'] }), null);
});

test('resolveWorker: floorTier is case-insensitive + fail-safe on an unrecognized floor (never collapse to cheapest)', () => {
  const ranking = { tiers: { low: ['haiku'], mid: ['sonnet'], heavy: ['opus'], reasoning: ['fable'] } };
  // valid floor 'heavy' (lowercase) -> walks reasoning->heavy, stops at heavy (no fall to mid/low)
  assert.deepEqual(resolveWorker(ranking, 'reasoning', { blocked: ['fable'], floorTier: 'heavy' }), { tier: 'heavy', model: 'opus' });
  // wrong-CASE floor 'Heavy'/'HEAVY' must behave the SAME (was indexOf=-1 -> Math.max(-1,0)=0 -> floor collapsed to cheapest)
  assert.deepEqual(resolveWorker(ranking, 'reasoning', { blocked: ['fable'], floorTier: 'Heavy' }), { tier: 'heavy', model: 'opus' });
  assert.deepEqual(resolveWorker(ranking, 'reasoning', { blocked: ['fable'], floorTier: 'HEAVY' }), { tier: 'heavy', model: 'opus' });
  // crypto floored at heavy, heavy ALSO blocked: wrong-case floor must STILL refuse to fall cheaper -> null
  assert.equal(resolveWorker(ranking, 'reasoning', { blocked: ['fable', 'opus'], floorTier: 'Heavy' }), null);
  // 'local' = a known TIER below the climb ladder -> allow from the bottom (floor 0), not null
  assert.deepEqual(resolveWorker(ranking, 'heavy', { blocked: ['opus', 'sonnet'], floorTier: 'local' }), { tier: 'low', model: 'haiku' });
  // a typo'd / unrecognized floor -> FAIL SAFE: null, NEVER a cheap route
  assert.equal(resolveWorker(ranking, 'heavy', { blocked: [], floorTier: 'reasoner' }), null);
  assert.equal(resolveWorker(ranking, 'reasoning', { blocked: [], floorTier: 'Heavyy' }), null);
  // desiredTier is also case-normalized
  assert.deepEqual(resolveWorker(ranking, 'HEAVY', { blocked: [] }), { tier: 'heavy', model: 'opus' });
});

test('resolveWorker (M3 defense-in-depth): sensitive + OMITTED floor fails CLOSED (never downgrades by omission)', () => {
  const ranking = { tiers: { low: ['haiku'], mid: ['sonnet'], heavy: ['opus'], reasoning: ['fable'] } };
  // pre-fix: a sensitive task whose caller FORGOT floorTier collapsed to the cheapest available tier.
  // Now `sensitive:true` with no floorTier floors at the desired tier -> it cannot drop below it.
  // desired heavy, opus blocked, floor omitted but sensitive -> null (NOT a fall to mid/low).
  assert.equal(resolveWorker(ranking, 'heavy', { blocked: ['opus'], sensitive: true }), null, 'sensitive + omitted floor + desired blocked -> hand back, never downgrade');
  // desired heavy, opus AVAILABLE -> still returns opus at the desired tier (no false negative).
  assert.deepEqual(resolveWorker(ranking, 'heavy', { blocked: [], sensitive: true }), { tier: 'heavy', model: 'opus' }, 'sensitive + available desired tier still routes there');
  // an EXPLICIT floorTier always wins over the sensitive default (walk reasoning->heavy, stop at heavy).
  assert.deepEqual(resolveWorker(ranking, 'reasoning', { blocked: ['fable'], sensitive: true, floorTier: 'heavy' }), { tier: 'heavy', model: 'opus' }, 'explicit floorTier overrides the sensitive fail-closed default');
  // a NON-sensitive task with an omitted floor keeps the full availability walk-down (unchanged).
  assert.deepEqual(resolveWorker(ranking, 'heavy', { blocked: ['opus', 'sonnet'] }), { tier: 'low', model: 'haiku' }, 'non-sensitive omitted floor still walks down (availability fallback preserved)');
});

test('resolveWorker DRIVES the spawn-fail-fall loop: each unavailable model accrues, fall reaches a working one then null', () => {
  // The Step-3 driver: spawn errors "unavailable" -> add to blocked -> resolveWorker -> spawn next -> repeat.
  const ranking = { tiers: { low: ['haiku'], mid: ['sonnet'], heavy: ['opus-4.8', 'opus-4.7'], reasoning: ['fable'] } };
  const blocked = [];
  // desired reasoning. fable spawn fails (proven: instant 0-token "unavailable").
  blocked.push('fable');
  assert.deepEqual(resolveWorker(ranking, 'reasoning', { blocked }), { tier: 'heavy', model: 'opus-4.8' }); // fall to next available
  // opus-4.8 ALSO blocked (quota) -> within-tier next.
  blocked.push('opus-4.8');
  assert.deepEqual(resolveWorker(ranking, 'reasoning', { blocked }), { tier: 'heavy', model: 'opus-4.7' });
  // opus-4.7 blocked too -> drop a tier.
  blocked.push('opus-4.7');
  assert.deepEqual(resolveWorker(ranking, 'reasoning', { blocked }), { tier: 'mid', model: 'sonnet' });
  // sonnet + haiku blocked -> everything gone -> null (hand back, never stuck on an unavailable model).
  blocked.push('sonnet', 'haiku');
  assert.equal(resolveWorker(ranking, 'reasoning', { blocked }), null);
});

test('resolveWorker (M2a): a modelTiers pin cannot slip a KNOWN-weaker alias past the SENSITIVE floor', () => {
  // The finding's exact repro: a pin front-loads haiku into the reasoning tier. The SLOT
  // (reasoning) passes the never-down gate, but the MODEL (haiku) is a known downgrade.
  const poisoned = buildFloorRanking([], { reasoning: ['haiku'] });
  assert.deepEqual(poisoned.tiers.reasoning, ['haiku', 'fable'], 'pre-condition: the pin wins front-of-tier (fable is the reasoning floor)');
  // a SENSITIVE route must NOT resolve to haiku — it skips the known-weaker alias and returns
  // the next known-strong candidate in the tier (fable, now the reasoning floor); the gate is GENUINELY satisfied.
  assert.deepEqual(
    resolveWorker(poisoned, 'reasoning', { sensitive: true }),
    { tier: 'reasoning', model: 'fable' },
    'sensitive: haiku pinned into reasoning is skipped -> fable (the finding, flipped)',
  );
  // when a weaker alias is the ONLY model at/above the floor, a sensitive route HANDS BACK
  // rather than downgrade (never-down holds — same discipline as the quota fail-closed floor).
  const onlyWeak = { tiers: { low: ['haiku'], mid: ['sonnet'], heavy: ['opus'], reasoning: ['haiku'] } };
  assert.equal(
    resolveWorker(onlyWeak, 'reasoning', { sensitive: true, floorTier: 'reasoning' }),
    null,
    'sensitive: a reasoning tier holding ONLY a weaker alias -> null (never downgrade)',
  );
  // a sensitive task floored at heavy: sonnet slotted into heavy is a downgrade -> skipped -> null.
  const sonnetInHeavy = { tiers: { low: ['haiku'], mid: ['sonnet'], heavy: ['sonnet'], reasoning: ['opus'] } };
  assert.equal(
    resolveWorker(sonnetInHeavy, 'heavy', { sensitive: true, floorTier: 'heavy' }),
    null,
    'sensitive: sonnet slotted into heavy does not satisfy a heavy floor',
  );
});

test('resolveWorker (M2b): an UNKNOWN pinned name stays TRUSTED on the sensitive path (unknown->strong preserved)', () => {
  // A model the agent cannot introspect (no known family token) must NOT be skipped by the
  // sensitive floor — the M2 fix cannot break the pin doctrine. (Fable is now a KNOWN top rung,
  // so a truly unseeable name stands in for the unknown-pin case here.)
  const unknownPin = buildFloorRanking([], { reasoning: ['mythos-9-unreleased'] });
  assert.deepEqual(
    resolveWorker(unknownPin, 'reasoning', { sensitive: true }),
    { tier: 'reasoning', model: 'mythos-9-unreleased' },
    'sensitive: an unknown pinned model is trusted (unknown->strong)',
  );
});

test('resolveWorker (M2c): NON-sensitive resolution with the same pin is UNCHANGED (no behavior change off the sensitive path)', () => {
  // The pin is honored exactly as pre-fix — haiku resolves at the reasoning tier; the M2 guard
  // is scoped to `sensitive:true` and must never touch the availability walk-down.
  const poisoned = buildFloorRanking([], { reasoning: ['haiku'] });
  assert.deepEqual(
    resolveWorker(poisoned, 'reasoning', {}),
    { tier: 'reasoning', model: 'haiku' },
    'non-sensitive: the pin is honored (haiku) — byte-equivalent to pre-fix behavior',
  );
});

test('reasoning floor = [fable] — fable is the EXPLICIT top rung (haiku<sonnet<opus<fable), heavy = opus', () => {
  // Fable 5 is live, so the floor now names it as the top rung (first-class identity, not
  // merely unknown->strong). opus drops to heavy only; a consent-ask + the spawn-fail-fall
  // guard the real-money spawn.
  const a = buildFloorRanking([]); // no models, no pins -> pure alias floor
  assert.deepEqual(a.tiers.reasoning, ['fable']);
  assert.deepEqual(a.tiers.heavy, ['opus']);
  assert.equal(a.tiers.reasoning.includes('fable'), true);
});

test('fable qualifies for a SENSITIVE slot by CAPABILITY (known-strong top rung; never-down holds)', () => {
  // Task #3: the sensitive gate is unchanged — fable, being the top known rung (FAMILY_RANK
  // fable=3), is never skipped as "below floor" at any floor, so a sensitive route resolves to it.
  const r = buildFloorRanking([]); // reasoning = ['fable'], heavy = ['opus']
  assert.deepEqual(resolveWorker(r, 'reasoning', { sensitive: true }), { tier: 'reasoning', model: 'fable' });
  assert.deepEqual(resolveWorker(r, 'reasoning', { sensitive: true, floorTier: 'reasoning' }), { tier: 'reasoning', model: 'fable' });
  // opus still satisfies a heavy-floored sensitive task (its FAMILY_RANK dropped 3->2 but heavy floor = 2).
  assert.deepEqual(resolveWorker(r, 'heavy', { sensitive: true, floorTier: 'heavy' }), { tier: 'heavy', model: 'opus' });
});

test('isFableModel: the consent-ask TRIGGER — matches the fable alias + a pinned fable id, not the other tiers', () => {
  for (const m of ['fable', 'Fable 5', 'claude-fable-5']) assert.equal(isFableModel(m), true, m);
  for (const m of ['opus', 'haiku', 'sonnet', 'opus-4.8']) assert.equal(isFableModel(m), false, m);
});

test('fable consent: a reasoning route lands on fable -> ASK; on `no`, blocking fable falls to opus (the top non-fable tier)', () => {
  const r = buildFloorRanking([]); // reasoning = ['fable'], heavy = ['opus']
  // the resolved top-rung worker IS fable -> the agent must ASK before spawning (isFableModel = the trigger).
  const w = resolveWorker(r, 'reasoning', {});
  assert.deepEqual(w, { tier: 'reasoning', model: 'fable' });
  assert.equal(isFableModel(w.model), true, 'fable route -> consent-ask fires');
  // `no` = stay on the highest NON-fable tier: block fable and the EXISTING spawn-fail-fall lands on opus (heavy).
  assert.deepEqual(resolveWorker(r, 'reasoning', { blocked: ['fable'] }), { tier: 'heavy', model: 'opus' });
  // a route that lands on opus is NOT a fable route -> no ask.
  assert.equal(isFableModel('opus'), false);
});
