// Linear-time strip, malformed-input preservation, the config byte bound and the copy-sync guard
// for the JSONC stripper (scripts/lib/jsonc.mjs and its inline copy in hooks/coaltipple-conductor.js).
// The old stripper rescanned to the end of the input for every opener that never closed (an unclosed
// block comment, an unclosed string, a string ending in a lone backslash), so a config with many such
// openers took time roughly quadratic in its size. The strip now consumes an unclosed opener to the end
// of the input in ONE match and keeps its text unchanged: a malformed config still fails JSON.parse, and
// a well-formed one parses to the same value byte for byte. A config file over MAX_CONFIG_BYTES is never
// read whole and never stripped. Zero-dep (node:test + built-ins), scripts-quality.md section 2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripJsonc } from './jsonc.mjs';
import { sandboxEnv } from './test-env.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const lib = (name) => import(pathToFileURL(path.join(repo, 'scripts', 'lib', name)).href);

// The regex as it stood before this change, kept as the reference for the differential test.
const OLD_RE = /"(?:\\.|[^"\\])*"|\/\/.*|\/\*[\s\S]*?\*\//g;
const oldStrip = (c) => c.replace(OLD_RE, (m) => (m[0] === '"' ? m : ''));

const SIZE = 48 * 1024;
// None of these closes: the block openers never meet a star-slash, the escaped quotes never meet an
// unescaped one, and the string opener's body ends in a lone backslash.
const SHAPES = {
  unclosedBlockOpeners: '/* a'.repeat(SIZE / 4),
  unclosedStringEscapes: '"' + '\\"'.repeat(SIZE / 3),
  danglingBackslash: '"\\'.repeat(SIZE / 2),
};
const BUDGET_MS = 50;
const MAX = 1024 * 1024;

test('stripJsonc is linear: 48 KB of unclosed openers strips in under 50 ms (best of 3 runs)', () => {
  for (const [name, input] of Object.entries(SHAPES)) {
    const times = [];
    for (let i = 0; i < 3; i++) {
      const t0 = process.hrtime.bigint();
      stripJsonc(input);
      times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    assert.ok(Math.min(...times) < BUDGET_MS, `${name}: best of 3 = ${Math.min(...times).toFixed(1)} ms, budget ${BUDGET_MS} ms`);
  }
});

test('stripJsonc leaves an unclosed opener in place, so a malformed config still fails JSON.parse', () => {
  for (const [name, input] of Object.entries(SHAPES)) {
    assert.equal(stripJsonc(input), input, `${name}: the unclosed text is emitted unchanged`);
  }
  assert.throws(() => JSON.parse(stripJsonc('{"a":1} /* never closed')));
  assert.throws(() => JSON.parse(stripJsonc('{"a":"never closed')));
});

test('stripJsonc matches the previous regex byte for byte on well-formed JSON-with-comments', () => {
  const fixtures = [
    '',
    '{}',
    '{"url":"http://example.com","mode":"auto"}',
    '{"p":"C:\\\\","x":"a//b"}',
    '{"q":"he said \\"hi\\""}',
    '{\n  "a": "keep", // line comment with "quotes" inside\n  "b": "x" /* block */\n}',
    '{"s":"/* not a comment */","t":"// not either"} // trailing',
    '{"a":1 /**/ , "b":2 /* a */ /* b */}',
    '{"a":"x\\\\"} /* after an escaped-backslash value */',
    '/* header */ {"k": [1, 2, 3]} // footer */',
    '{"w":"a/*b","v":"c*/d"}',
    '{"multi":"line\\nvalue","n":1} /* a\nmultiline\ncomment */',
    '// only a comment',
    '{"a":"b"}\r\n// crlf comment\r\n',
  ];
  for (const f of fixtures) {
    assert.equal(stripJsonc(f), oldStrip(f), `differs on ${JSON.stringify(f)}`);
  }
});

// ---- the byte bound -------------------------------------------------------------------------

function scratch(t, prefix) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
// A valid config object padded with spaces to exactly `bytes` bytes.
const padded = (bytes, body = '{"mode":"off"}') => body + ' '.repeat(bytes - body.length);

test('readConfigBounded reads a config of exactly MAX_CONFIG_BYTES and refuses one byte more, by a named code', async (t) => {
  const { MAX_CONFIG_BYTES, readConfigBounded } = await lib('config-bound.mjs');
  assert.equal(MAX_CONFIG_BYTES, MAX);
  const dir = scratch(t, 'ct-bound-');
  const atLimit = path.join(dir, 'at.json');
  const over = path.join(dir, 'over.json');
  fs.writeFileSync(atLimit, padded(MAX));
  fs.writeFileSync(over, padded(MAX + 1));
  assert.equal(readConfigBounded(atLimit).length, MAX);
  assert.throws(() => readConfigBounded(over), (e) => e.code === 'ECONFIGSIZE' && /1048576/.test(e.message));
  assert.throws(() => readConfigBounded(path.join(dir, 'absent.json')), (e) => e.code === 'ENOENT');
});

test('config-load reads an over-size config as absent, so its keys never take effect', async (t) => {
  const { loadMergedConfig } = await lib('config-load.mjs');
  const home = scratch(t, 'ct-bound-home-');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', '.coaltipple.json'), padded(MAX + 1, '{"qualityBar":97}'));
  const cwd = scratch(t, 'ct-bound-proj-');
  fs.mkdirSync(path.join(cwd, '.git'));
  const big = loadMergedConfig({ cwd, home });
  assert.notEqual(big.qualityBar, 97, 'the over-size global config was not read');
  fs.writeFileSync(path.join(home, '.claude', '.coaltipple.json'), padded(MAX, '{"qualityBar":97}'));
  assert.equal(loadMergedConfig({ cwd, home }).qualityBar, 97, 'a config at the bound is still read');
});

test('configure.mjs names an over-size config and exits 1 without touching it', (t) => {
  const home = scratch(t, 'ct-bound-cfg-home-');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  const cwd = scratch(t, 'ct-bound-cfg-proj-');
  fs.mkdirSync(path.join(cwd, '.git'));
  const target = path.join(home, '.claude', '.coaltipple.json');
  const body = padded(MAX + 1);
  fs.writeFileSync(target, body);
  const r = spawnSync(process.execPath, [path.join(repo, 'scripts', 'configure.mjs'), '--qualityBar', '80'], { cwd, env: sandboxEnv(home), encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 1, r.stderr + r.stdout);
  assert.match(r.stderr, /larger than 1048576 bytes/);
  assert.equal(fs.readFileSync(target, 'utf8'), body, 'the over-size file was left as it was');
});

test('the conductor names an over-size project config as unreadable (too large) and does not read it', (t) => {
  const home = scratch(t, 'ct-bound-hook-home-');
  const cwd = scratch(t, 'ct-bound-hook-proj-');
  fs.mkdirSync(path.join(cwd, '.git'));
  const rel = '.claude/coal/coaltipple.json';
  fs.mkdirSync(path.join(cwd, '.claude', 'coal'), { recursive: true });
  // mode off would silence routing if the file were read; the notice proves it was not.
  fs.writeFileSync(path.join(cwd, ...rel.split('/')), padded(MAX + 1));
  const r = spawnSync(process.execPath, [path.join(repo, 'hooks', 'coaltipple-conductor.js')], { input: JSON.stringify({ hook_event_name: 'SessionStart' }), cwd, env: sandboxEnv(home), encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.ok(r.stdout.includes(`[CoalTipple] UNREADABLE: ${rel} exists but is not a readable config (too large); it was skipped`), r.stdout);
  assert.match(r.stdout, /routing active/, 'the config was not read, so routing stayed on');
});

// ---- the copy-sync guard -----------------------------------------------------------------------

test('the JSONC copies are byte-equal on the repo and the guard names a copy that drifts by one character', async (t) => {
  const { checkJsoncSync, JSONC_SYNC_FILES, JSONC_GUARD_FILES } = await lib('jsonc-sync.mjs');
  assert.deepEqual(checkJsoncSync(repo), []);
  const tmp = scratch(t, 'ct-jsonc-guard-');
  for (const rel of JSONC_GUARD_FILES) {
    fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
    fs.copyFileSync(path.join(repo, rel), path.join(tmp, rel));
  }
  assert.deepEqual(checkJsoncSync(tmp), [], 'the scratch copy starts in sync');
  for (const rel of JSONC_SYNC_FILES.slice(1)) {
    const planted = path.join(tmp, rel);
    const body = fs.readFileSync(planted, 'utf8');
    assert.ok(body.includes('(m, close) => (m[0]'), `${rel} holds the strip callback`);
    fs.writeFileSync(planted, body.replace('(m, close) => (m[0]', '(m) => (m[0]'));
    const out = checkJsoncSync(tmp);
    assert.ok(out.some((f) => f.includes('DIVERGED') && f.includes(rel)), `${rel}: ${JSON.stringify(out)}`);
    fs.writeFileSync(planted, body);
  }
  const conductor = path.join(tmp, 'hooks', 'coaltipple-conductor.js');
  const cbody = fs.readFileSync(conductor, 'utf8');
  fs.writeFileSync(conductor, cbody.replace('const MAX_CONFIG_BYTES = 1024 * 1024;', 'const MAX_CONFIG_BYTES = 1024 * 1025;'));
  assert.ok(checkJsoncSync(tmp).some((f) => f.includes('MAX_CONFIG_BYTES') && f.includes('coaltipple-conductor.js')), 'a drifted byte bound is named');
});
