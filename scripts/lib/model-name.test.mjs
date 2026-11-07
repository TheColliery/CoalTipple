// A model name from a cloned repository must never reach a shell line (29cy). The pin path: project config -> loadMergedConfig -> applyPins ->
// buildFloorRanking -> a global ranking the agent later routes from. Every stage refuses a name outside the safe charset (lib/model-name.mjs).
// Zero-dep (node:test + built-ins). Nothing real is touched: the temp root is under the real tmpdir and removed in a teardown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyPins, buildFloorRanking, validateRanking, loadRanking, SCHEMA_VER } from './classify.mjs';
import { loadMergedConfig } from './config-load.mjs';
import { CONFIG_SCHEMA, validateValue } from './config-schema.mjs';
import { MODEL_NAME_RE, isSafeModelName, showName } from './model-name.mjs';

const BACKTICK = String.fromCharCode(96);
const HOSTILE = ['haiku$(touch ct-pwn)', 'haiku opus', `haiku${BACKTICK}id${BACKTICK}`, 'haiku;id', 'haiku|id', 'haiku\nid', '-haiku', '', ' ', 'haiku"x', "haiku'x", 'haiku&id', 'haiku>x', 'haiku$(id)', 'a$b', 'a(b)', 'a{b}', 'a*b', 'a?b', 'a~b', 'haiku\\x'];
const ORDINARY = ['haiku', 'sonnet', 'fable', 'claude-sonnet-5-5', 'claude-opus-5-5[1m]', 'us.anthropic.claude-opus-5-5', 'mythos-6', 'a', 'gpt-oss-120b-medium', 'anthropic/claude-haiku-5-5:beta', 'name@v1'];
const BASE = () => ({ local: [], low: ['haiku'], mid: ['sonnet'], heavy: ['opus'], reasoning: ['fable'] });
const modelTiersSpec = CONFIG_SCHEMA.find((s) => s.key === 'modelTiers');
const allNames = (tiers) => Object.values(tiers).flat();

test('the charset accepts ordinary model ids and refuses shell text', () => {
  for (const n of ORDINARY) assert.ok(isSafeModelName(n), `should pass: ${showName(n)}`);
  for (const n of HOSTILE) assert.ok(!isSafeModelName(n), `should refuse: ${showName(n)}`);
  assert.ok(!isSafeModelName(undefined) && !isSafeModelName(null) && !isSafeModelName(7) && !isSafeModelName({}));
  assert.ok(MODEL_NAME_RE instanceof RegExp);
});

test('applyPins drops a name outside the charset and names the refusal; ordinary names still pin', () => {
  for (const bad of HOSTILE.filter((h) => h.trim())) {
    const refused = [];
    const out = applyPins(BASE(), { low: bad }, (r) => refused.push(r));
    assert.ok(!allNames(out).includes(bad.trim()), `${showName(bad)} must not reach a tier`);
    assert.deepEqual(out, BASE(), 'a refused pin leaves the tiers as the floor had them');
    assert.equal(refused.length, 1, showName(bad));
    assert.equal(refused[0].tier, 'low');
    assert.equal(refused[0].name, bad.trim());
  }
  for (const good of ORDINARY) assert.ok(applyPins(BASE(), { reasoning: good }).reasoning.includes(good), good);
});

test('applyPins: one bad name in a chain is dropped, the good ones in the chain still pin; a non-string entry is dropped too', () => {
  const refused = [];
  const out = applyPins(BASE(), { mid: ['claude-sonnet-5-5', 'haiku$(touch ct-pwn)', { model: 'x' }, 'mythos-6'] }, (r) => refused.push(r.name));
  assert.deepEqual(out.mid, ['claude-sonnet-5-5', 'mythos-6', 'sonnet']);
  assert.equal(refused.length, 2);
  assert.ok(refused.includes('haiku$(touch ct-pwn)'));
});

test('applyPins without a callback still drops (the callback is optional)', () => {
  assert.deepEqual(applyPins(BASE(), { low: 'haiku$(touch ct-pwn)' }), BASE());
});

test('buildFloorRanking never holds a hostile name, for a string pin, a chain and the space and backtick cases', () => {
  for (const bad of ['haiku$(touch ct-pwn)', 'haiku opus', `haiku${BACKTICK}id${BACKTICK}`]) {
    const r = buildFloorRanking([], { low: bad, heavy: ['opus', bad] });
    assert.ok(!allNames(r.tiers).some((n) => n.includes(bad.trim())), showName(bad));
    assert.equal(validateRanking(r, null), null, 'the rebuilt floor is itself valid');
  }
  const refused = [];
  buildFloorRanking([], { low: 'haiku$(touch ct-pwn)' }, (r) => refused.push(r));
  assert.equal(refused.length, 1);
  assert.equal(buildFloorRanking([], { low: 'claude-haiku-5-5' }).tiers.low[0], 'claude-haiku-5-5');
});

test('validateModelTiers rejects a name outside the charset, naming the tier, with the name escaped; ordinary names pass', () => {
  for (const bad of HOSTILE.filter((h) => h.trim())) {
    const one = validateValue(modelTiersSpec, { low: bad });
    assert.match(one, /'low'/, showName(bad));
    assert.match(one, /charset|characters/i);
    assert.ok(!/[\r\n]/.test(one), 'no line break reaches the terminal');
    const chain = validateValue(modelTiersSpec, { heavy: ['opus', bad] });
    assert.match(chain, /'heavy'/);
  }
  for (const good of ORDINARY) assert.equal(validateValue(modelTiersSpec, { mid: good }), null, good);
  assert.equal(validateValue(modelTiersSpec, { mid: ORDINARY, low: 'haiku' }), null);
  const nl = validateValue(modelTiersSpec, { low: 'haiku\u001b[31mred\nforged line' });
  assert.ok(!/[\u001b\n]/.test(nl), 'a control character or line break in the name is written out as an escape');
});

test('validateRanking fails a ranking on disk that holds a name outside the charset, so the agent rebuilds it', () => {
  const good = { schemaVer: SCHEMA_VER, complete: true, tiers: { local: [], low: ['haiku'], mid: ['sonnet'], heavy: ['opus'], reasoning: ['fable'] } };
  assert.equal(validateRanking(good, null), null);
  for (const tier of ['local', 'low', 'mid', 'heavy', 'reasoning']) {
    for (const bad of ['haiku$(touch ct-pwn)', 'haiku opus', `x${BACKTICK}id${BACKTICK}`]) {
      const r = { ...good, tiers: { ...good.tiers, [tier]: [...good.tiers[tier], bad] } };
      const why = validateRanking(r, null);
      assert.match(why, new RegExp(`'${tier}'`), `${tier}: ${showName(bad)}`);
      assert.ok(!/[\r\n]/.test(why));
    }
  }
  assert.match(validateRanking({ ...good, tiers: { ...good.tiers, low: [{ name: 'haiku' }] } }, null), /'low'/, 'a non-string entry is refused too');
});

test('loadRanking reports an on-disk ranking with a hostile name as not ok', () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'ct-modelname-'));
  try {
    const hostile = { schemaVer: SCHEMA_VER, complete: true, tiers: { local: [], low: ['haiku$(touch ct-pwn)'], mid: ['sonnet'], heavy: ['opus'], reasoning: ['fable'] } };
    fs.writeFileSync(path.join(dir, 'ranking.json'), JSON.stringify(hostile), 'utf8');
    const got = loadRanking(dir, null);
    assert.equal(got.ok, false);
    assert.match(got.reason, /'low'/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('end to end: a cloned project config pin reaches the merged config, and the floor ranking built from it holds no shell text', () => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'ct-modelname-'));
  try {
    const proj = path.join(root, 'proj');
    const home = path.join(root, 'home');
    fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
    fs.mkdirSync(path.join(proj, '.claude', 'coal'), { recursive: true });
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(proj, '.claude', 'coal', 'coaltipple.json'), JSON.stringify({ modelTiers: { low: 'haiku$(touch ct-pwn)' } }), 'utf8');
    const merged = loadMergedConfig({ cwd: proj, home });
    const refused = [];
    const r = buildFloorRanking([], merged.modelTiers, (x) => refused.push(x));
    assert.deepEqual(r.tiers.low, ['haiku'], 'the floor stands, the hostile pin is gone');
    assert.equal(refused.length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('showName escapes control characters, C1, U+2028 and U+2029, and cuts a long name', () => {
  const s = showName(['a', String.fromCharCode(1), 'b', String.fromCharCode(0x85), 'c', String.fromCharCode(0x2028), 'd', String.fromCharCode(0x2029), 'e', String.fromCharCode(10), 'f'].join(''));
  const bad = [1, 0x85, 0x2028, 0x2029, 10].map((n) => String.fromCharCode(n));
  assert.ok(bad.every((c) => !s.includes(c)), 'every control and separator is written out as an escape');
  assert.ok(showName('x'.repeat(500)).length <= 70);
});
