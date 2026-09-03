// CWK-060 -- unit tests for the config-key drift gate (ported shape, this room's
// content). Most cases drive checkConfigKeys with an in-memory `read` fixture so a
// rule can be isolated without touching disk; the last group runs against the REAL
// repo files to prove the port actually holds here, not just in a synthetic fixture.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  checkConfigKeys, NOTICE_SITES, KEY_TABLES,
  PENDING_KEYS, NOT_CONFIG, BLIND_KEYS, RETIRED_KEYS,
} from './config-keys.mjs';

const SCHEMA = ['enableRouting', 'mode', 'qualityBar', 'language', 'keywords'];
const fixtureRead = (files) => (f) => {
  if (!Object.hasOwn(files, f)) throw new Error('ENOENT ' + f);
  return files[f];
};

function findLevel(findings, level) {
  return findings.filter((f) => f.level === level);
}

test('clean fixture: no undeclared candidates, only the expected blind-key SKIP', () => {
  const files = { 'a.md': 'the `enableRouting` switch and `qualityBar` bar.' };
  const { findings } = checkConfigKeys({
    schemaKeys: SCHEMA, mdFiles: ['a.md'], noticeSites: [], keyTables: [],
    read: fixtureRead(files),
    // this room's real NOT_CONFIG/RETIRED_KEYS defaults name entries this tiny fixture
    // never mentions -- irrelevant to what THIS test checks, so silenced explicitly
    // rather than left to trip rule 2 (proven directly by its own dedicated tests below).
    notConfig: {}, retired: {},
  });
  assert.deepEqual(findLevel(findings, 'FAIL'), []);
  const skip = findLevel(findings, 'SKIP').find((f) => f.msg.startsWith('blind to'));
  assert.ok(skip, 'expected the blind-key SKIP');
  assert.match(skip.msg, /language, mode/);
});

test('PRECONDITION -- an undeclared blind schema key is a HARD FAIL, not a silent SKIP', () => {
  const { findings } = checkConfigKeys({
    schemaKeys: ['weirdlowercasekey'], mdFiles: [], noticeSites: [], keyTables: [],
    read: fixtureRead({}), blind: {},
  });
  assert.ok(findLevel(findings, 'FAIL').some((f) => f.msg.includes('weirdlowercasekey')));
});

test('an unresolved candidate on a markdown surface is a FAIL naming the file', () => {
  const files = { 'a.md': 'set `phantomFlag` to enable it.' };
  const { findings } = checkConfigKeys({
    schemaKeys: SCHEMA, mdFiles: ['a.md'], noticeSites: [], keyTables: [],
    read: fixtureRead(files),
  });
  const f = findLevel(findings, 'FAIL').find((x) => x.msg.includes('phantomFlag'));
  assert.ok(f);
  assert.match(f.msg, /a\.md/);
});

test('a RETIRED key named on a surface is reported BY NAME with its reason, not as a bare unresolved FAIL', () => {
  const files = { 'a.md': 'the old `deadKnob` still gets mentioned by accident.' };
  const { findings } = checkConfigKeys({
    schemaKeys: SCHEMA, mdFiles: ['a.md'], noticeSites: [], keyTables: [],
    read: fixtureRead(files), retired: { deadKnob: 'tombstoned v9.9.9 -- test fixture' },
  });
  const f = findLevel(findings, 'FAIL').find((x) => x.msg.includes('deadKnob'));
  assert.ok(f);
  assert.match(f.msg, /RETIRED/);
  assert.match(f.msg, /tombstoned v9\.9\.9/);
});

test('STRUCTURED PASS: a key-table row that does not resolve is a FAIL, shape-free (catches a lowercase key too)', () => {
  const files = {
    'r.md': '## Configure\n\n| key | default |\n|---|---|\n| `lowerblind` | x |\n| `enableRouting` | x |\n\n## Next\n',
  };
  const { findings } = checkConfigKeys({
    schemaKeys: SCHEMA, mdFiles: [], noticeSites: [], read: fixtureRead(files),
    keyTables: [{ file: 'r.md', heading: 'Configure' }],
  });
  const fails = findLevel(findings, 'FAIL');
  assert.ok(fails.some((f) => f.msg.includes('lowerblind')), 'a lowercase key-table row must still be caught');
  assert.ok(!fails.some((f) => f.msg.includes('enableRouting')), 'a real key-table row must not be flagged');
});

test('BOUNDED TABLE: a row outside the named heading is NOT scanned', () => {
  const files = {
    'r.md': '## Commands\n\n| `/foo` | does a thing |\n\n## Configure\n\n| key | default |\n|---|---|\n| `enableRouting` | x |\n',
  };
  const { findings, coverage } = checkConfigKeys({
    schemaKeys: SCHEMA, mdFiles: [], noticeSites: [], read: fixtureRead(files),
    keyTables: [{ file: 'r.md', heading: 'Configure' }],
    notConfig: {}, retired: {},
  });
  assert.deepEqual(findLevel(findings, 'FAIL'), []);
  assert.equal(coverage.keyTables[0].rows, 1, 'only the Configure-section row should be counted');
});

test('KEY TABLE, heading absent: locator FAILS LOUDLY, never a silent zero-row pass (Hard Rule 1 -- INSPECT HIGH-1, CWK-060 findings-back)', () => {
  // A renamed/moved heading is exactly the shape this fixture reproduces: the file has
  // a real "Configure" section, but the caller asks for a heading that no longer
  // exists. Before the fix, tableRegion() returned [] here -- the loop body never ran,
  // and checkConfigKeys reported ZERO findings: a silent green on a broken locator,
  // the identical class NOTICE_SITES was already armed against, one surface over.
  const files = {
    'r.md': '## Configure\n\n| key | default |\n|---|---|\n| `enableRouting` | x |\n',
  };
  const { findings, coverage } = checkConfigKeys({
    schemaKeys: SCHEMA, mdFiles: [], noticeSites: [], read: fixtureRead(files),
    keyTables: [{ file: 'r.md', heading: 'ConfigureXX' }],
    notConfig: {}, retired: {},
  });
  assert.ok(findLevel(findings, 'FAIL').some((f) => f.msg.includes('r.md') && f.msg.includes('NOTHING') && f.msg.includes('ConfigureXX')));
  assert.equal(coverage.keyTables[0].rows, 0);
});

test('NOTICE SITE, start marker absent: locator FAILS LOUDLY, never a silent zero-candidate pass (Hard Rule 1)', () => {
  const files = { 'h.js': 'function somethingElse() { return 1; }' };
  const { findings, coverage } = checkConfigKeys({
    schemaKeys: SCHEMA, mdFiles: [], keyTables: [], read: fixtureRead(files),
    noticeSites: [{ name: 'missing', file: 'h.js', start: 'function contract(cfg) {', end: null }],
  });
  assert.ok(findLevel(findings, 'FAIL').some((f) => f.msg.includes('missing') && f.msg.includes('NOTHING')));
  assert.equal(coverage.noticeSites[0].lines, 0);
});

test('NOTICE SITE, end sentinel absent: FAILS CLOSED -- never scans past the missing bound (trap 3, the sentinel-overrun class)', () => {
  // A phantom candidate sits AFTER where the end marker would have been, had it existed.
  // The exemplar's own fallback ("end not found -> slice to end of text") would have
  // scanned into it and reported it as a real finding. Ours must not.
  const files = {
    // deliberately no join-close marker anywhere in this fixture -- the comment below
    // must NOT spell it out literally, or the fixture accidentally supplies the very
    // bound it exists to prove absent.
    'h.js': "function contract(cfg) {\n  return [\n    'hello',\n  ]\n  // the array is never joined in this fixture on purpose\n  const somewhereElsePhantomKey = 'x';\n}",
  };
  const { findings, coverage } = checkConfigKeys({
    schemaKeys: SCHEMA, mdFiles: [], keyTables: [], read: fixtureRead(files),
    noticeSites: [{ name: 'contract()', file: 'h.js', start: 'function contract(cfg) {', end: '].join(' }],
    notConfig: {}, retired: {},
  });
  assert.ok(findLevel(findings, 'FAIL').some((f) => f.msg.includes('contract()') && f.msg.includes('NOTHING')));
  assert.equal(coverage.noticeSites[0].lines, 0);
  assert.ok(!findings.some((f) => f.msg.includes('somewhereElsePhantomKey')), 'must not scan past the missing end bound');
});

test('NOTICE SITE, end sentinel present: region is bounded EXACTLY there, and a phantom candidate past it is invisible', () => {
  const files = {
    'h.js': "function contract(cfg) {\n  return [\n    'plain text, no candidate',\n  ].join('\\n');\n}\nconst laterPhantomKey = 'never scanned';\n",
  };
  const { findings, coverage } = checkConfigKeys({
    schemaKeys: SCHEMA, mdFiles: [], keyTables: [], read: fixtureRead(files),
    noticeSites: [{ name: 'contract()', file: 'h.js', start: 'function contract(cfg) {', end: '].join(' }],
    notConfig: {}, retired: {},
  });
  assert.deepEqual(findLevel(findings, 'FAIL'), []);
  assert.ok(coverage.noticeSites[0].lines > 0);
  assert.ok(!findings.some((f) => f.msg.includes('laterPhantomKey')));
});

test('NOTICE SITE single-line region (cue-shaped): only that one line is scanned', () => {
  const files = { 'h.js': "const cue = 'plain text';\nconst laterPhantomKey = 'x';\n" };
  const { coverage } = checkConfigKeys({
    schemaKeys: SCHEMA, mdFiles: [], keyTables: [], read: fixtureRead(files),
    noticeSites: [{ name: 'cue', file: 'h.js', start: 'const cue = ', end: null }],
  });
  assert.equal(coverage.noticeSites[0].lines, 1);
});

test('NOTICE SITE scans STRING CONTENTS only, and escapes are blanked so they do not fuse into a phantom identifier', () => {
  // "CoalFace\'s" must not manufacture a phantom token from the escape fusing with the
  // next word (the exact failure class the exemplar's own JS_ESCAPE step exists to stop).
  const files = { 'h.js': "function contract(cfg) {\n  return [\n    'CoalFace\\'s authority',\n    langLine(cfg),\n  ].join('\\n');\n}\n" };
  const { coverage } = checkConfigKeys({
    schemaKeys: SCHEMA, mdFiles: [], keyTables: [], read: fixtureRead(files),
    noticeSites: [{ name: 'contract()', file: 'h.js', start: 'function contract(cfg) {', end: '].join(' }],
  });
  // langLine(cfg) is bare code, not inside quotes -- must not be scanned as a candidate.
  assert.equal(coverage.noticeSites[0].candidates, 0);
});

test('SELF-CLEANING RULE 1: a PENDING_KEYS / NOT_CONFIG / RETIRED_KEYS entry that now resolves is a FAIL', () => {
  const { findings } = checkConfigKeys({
    schemaKeys: ['enableRouting'], mdFiles: [], noticeSites: [], keyTables: [], read: fixtureRead({}),
    pending: { enableRouting: 'stale' }, notConfig: {}, retired: {}, blind: {},
  });
  assert.ok(findLevel(findings, 'FAIL').some((f) => f.msg.includes('PENDING_KEYS') && f.msg.includes('enableRouting')));
});

test('SELF-CLEANING RULE 1, NOT_CONFIG variant', () => {
  const { findings } = checkConfigKeys({
    schemaKeys: ['enableRouting'], mdFiles: [], noticeSites: [], keyTables: [], read: fixtureRead({}),
    pending: {}, notConfig: { enableRouting: 'stale' }, retired: {}, blind: {},
  });
  assert.ok(findLevel(findings, 'FAIL').some((f) => f.msg.includes('NOT_CONFIG') && f.msg.includes('enableRouting')));
});

test('SELF-CLEANING RULE 1, RETIRED_KEYS variant -- a reused name must be caught even though RETIRED_KEYS is otherwise rule-2-exempt', () => {
  const { findings } = checkConfigKeys({
    schemaKeys: ['enableRouting'], mdFiles: [], noticeSites: [], keyTables: [], read: fixtureRead({}),
    pending: {}, notConfig: {}, retired: { enableRouting: 'stale' }, blind: {},
  });
  assert.ok(findLevel(findings, 'FAIL').some((f) => f.msg.includes('RETIRED_KEYS') && f.msg.includes('enableRouting')));
});

test('SELF-CLEANING RULE 1, BLIND_KEYS: gone from schema entirely is a FAIL', () => {
  const { findings } = checkConfigKeys({
    schemaKeys: ['enableRouting'], mdFiles: [], noticeSites: [], keyTables: [], read: fixtureRead({}),
    blind: { goneNow: 'stale' },
  });
  assert.ok(findLevel(findings, 'FAIL').some((f) => f.msg.includes('BLIND_KEYS') && f.msg.includes('goneNow') && f.msg.includes('not in the schema')));
});

test('SELF-CLEANING RULE 1, BLIND_KEYS: now shape-visible is a FAIL', () => {
  const { findings } = checkConfigKeys({
    schemaKeys: ['nowHasCapital'], mdFiles: [], noticeSites: [], keyTables: [], read: fixtureRead({}),
    blind: { nowHasCapital: 'stale' },
  });
  assert.ok(findLevel(findings, 'FAIL').some((f) => f.msg.includes('BLIND_KEYS') && f.msg.includes('nowHasCapital') && f.msg.includes('now matches')));
});

test('SELF-CLEANING RULE 2: a PENDING_KEYS/NOT_CONFIG entry no scanned surface mentions is dead weight -- FAIL', () => {
  const files = { 'a.md': 'nothing relevant here.' };
  const { findings } = checkConfigKeys({
    schemaKeys: SCHEMA, mdFiles: ['a.md'], noticeSites: [], keyTables: [],
    read: fixtureRead(files), pending: { ghostKey: 'ticket #0' }, notConfig: {},
  });
  assert.ok(findLevel(findings, 'FAIL').some((f) => f.msg.includes('ghostKey') && f.msg.includes('protects nothing')));
});

test('SELF-CLEANING RULE 2 is EXEMPT for RETIRED_KEYS -- an unmentioned retirement is the desired steady state, not dead weight', () => {
  const files = { 'a.md': 'nothing relevant here.' };
  const { findings } = checkConfigKeys({
    schemaKeys: SCHEMA, mdFiles: ['a.md'], noticeSites: [], keyTables: [],
    read: fixtureRead(files), retired: { longGoneKey: 'tombstoned, never mentioned in-scope by design' },
    notConfig: {},
  });
  assert.deepEqual(findLevel(findings, 'FAIL'), []);
});

test('SELF-CLEANING RULE 2 degrades to a SKIP, never a false FAIL, when the scan is PARTIAL (an unreadable surface)', () => {
  const { findings } = checkConfigKeys({
    schemaKeys: SCHEMA, mdFiles: ['missing.md'], noticeSites: [], keyTables: [],
    read: fixtureRead({}), pending: { ghostKey: 'ticket #0' },
  });
  assert.deepEqual(findLevel(findings, 'FAIL'), []);
  assert.ok(findLevel(findings, 'SKIP').some((f) => f.msg.includes('declaration-pruning not checked')));
});

test('EMPTY PENDING_KEYS (this room\'s actual state) is proven, not just assumed -- a synthetic pending key exercises every rule-1/rule-2 path with the DEFAULT empty map otherwise untouched', () => {
  assert.deepEqual(PENDING_KEYS, {}, "this room's default PENDING_KEYS must still be empty -- if this fails, someone added a real pending key without updating this fixture's premise");
  const files = { 'a.md': 'mentions `syntheticPendingKey` as planned.' };
  const { findings } = checkConfigKeys({
    schemaKeys: SCHEMA, mdFiles: ['a.md'], noticeSites: [], keyTables: [],
    read: fixtureRead(files), pending: { syntheticPendingKey: 'CWK-999 (test fixture)' },
  });
  // named + declared + mentioned -> no FAIL of any kind for it.
  assert.deepEqual(findLevel(findings, 'FAIL').filter((f) => f.msg.includes('syntheticPendingKey')), []);
});

// ---- integration: the REAL repo, no fixture ----

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const CONFIG_SCHEMA_KEYS = () => {
  // dynamic import kept local to this block -- avoids paying config-schema.mjs's own
  // load cost for the fixture-driven tests above, which need none of it.
  return import('./config-schema.mjs').then((m) => m.CONFIG_SCHEMA.map((e) => e.key));
};

test('INTEGRATION: the real repo surfaces resolve clean (only the 3 declared blind keys as SKIP)', async () => {
  const schemaKeys = await CONFIG_SCHEMA_KEYS();
  const read = (f) => fs.readFileSync(path.join(repo, f), 'utf8');
  const { findings } = checkConfigKeys({
    schemaKeys,
    mdFiles: ['skills/coaltipple/SKILL.md', 'skills/coaltipple/references/lock.md', 'skills/coaltipple/references/damage-control.md', 'README.md'],
    read,
  });
  assert.deepEqual(findLevel(findings, 'FAIL'), []);
  const skip = findLevel(findings, 'SKIP').find((f) => f.msg.startsWith('blind to'));
  assert.ok(skip);
  assert.match(skip.msg, /keywords, language, mode/);
});

test('INTEGRATION: schema key count is 24, and BLIND_KEYS/NOT_CONFIG/RETIRED_KEYS match the measured residue exactly', async () => {
  const schemaKeys = await CONFIG_SCHEMA_KEYS();
  assert.equal(schemaKeys.length, 24);
  assert.deepEqual(Object.keys(BLIND_KEYS).sort(), ['keywords', 'language', 'mode']);
  assert.equal(Object.keys(NOT_CONFIG).length, 8);
  assert.equal(Object.keys(RETIRED_KEYS).length, 6);
});

test('INTEGRATION: notice-region line counts stay BOUNDED to this room\'s own shape -- a regression guard against the sentinel-overrun class (trap 3)', () => {
  const read = (f) => fs.readFileSync(path.join(repo, f), 'utf8');
  const { coverage } = checkConfigKeys({
    schemaKeys: ['enableRouting'], mdFiles: [], keyTables: [], read, noticeSites: NOTICE_SITES,
  });
  const contract = coverage.noticeSites.find((s) => s.name === 'contract()');
  const cue = coverage.noticeSites.find((s) => s.name === 'cue');
  assert.ok(contract.readable && contract.lines > 0);
  assert.ok(contract.lines < 20, 'contract() region should be a small bounded block, not near end-of-file: got ' + contract.lines);
  assert.equal(cue.lines, 1, 'cue is a single-line ternary');
});

test('INTEGRATION: the SKILL.md Config table and README Configure table both resolve, bounded to their own heading', () => {
  const read = (f) => fs.readFileSync(path.join(repo, f), 'utf8');
  const { findings, coverage } = checkConfigKeys({
    schemaKeys: ['enableRouting', 'mode', 'qualityBar', 'delegateMinLines', 'fableConsent', 'modelTiers',
      'maxTotalAttempts', 'subagentTimeoutSeconds', 'maxConcurrentSubagents', 'requireTaskContract',
      'qaOnMerge', 'fastModeOnLatencyRequest', 'preserveVoiceForUserFacing', 'keywords', 'hotKeywords',
      'sensitivePaths', 'excludePaths', 'disableRouting', 'contextFiles', 'memoryOffer', 'language',
      'updateMode', 'updateCheckDays', 'gitRecoveryBoundary'],
    mdFiles: [], noticeSites: [], read, keyTables: KEY_TABLES,
    // this test only exercises the two REAL key tables against a partial schema list --
    // the room's full NOT_CONFIG/PENDING_KEYS/RETIRED_KEYS declarations are proven
    // separately (the two tests above) and are irrelevant to what this one checks.
    notConfig: {}, pending: {}, retired: {},
  });
  assert.deepEqual(findLevel(findings, 'FAIL'), []);
  const readmeTable = coverage.keyTables.find((t) => t.file === 'README.md');
  const skillTable = coverage.keyTables.find((t) => t.file === 'skills/coaltipple/SKILL.md');
  assert.equal(readmeTable.rows, 6, 'README Configure: enableRouting/mode/qualityBar/delegateMinLines/fableConsent/modelTiers');
  assert.ok(skillTable.rows >= 20, "SKILL.md's own Config table is the room's most complete surface");
});
