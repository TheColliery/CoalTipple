// The JSONC comment stripper does its work in one counted pass (scripts/lib/jsonc.mjs and its inline copy in
// hooks/coaltipple-conductor.js). This file proves four things, all by counting work and never by reading a clock:
//   1. the work is linear: steps stay under C per character, and at most double when the text doubles, on the shapes that used to
//      cost more than their size. The witness is red on a quadratic stand-in and on a stand-in that does not count, so it can fail;
//   2. the output is the same as the previous regex and callback (kept below as OLD_STRIP_RE) on every JSON file the repo carries, on
//      the fixtures and on seeded random texts;
//   3. a malformed input is kept to the end unchanged, so it still fails JSON.parse, and a well-formed one parses to the same value;
//   4. a config file over MAX_CONFIG_BYTES is never read whole and never stripped, and the copy-sync guard names a copy that drifts.
// Zero-dep (node:test + built-ins), scripts-quality.md section 2; testing.md Determinism: no clock, a fixed seed.
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

// The previous regex and callback, kept verbatim as the reference the differential compares against.
const OLD_STRIP_RE = /"(?:\\[\s\S]|[^"\\])*(?:"|\\?$)|\/\/.*|\/\*[\s\S]*?(\*\/|$)/g;
const oldStrip = (c) => c.replace(OLD_STRIP_RE, (m, close) => (m[0] === '"' || (m[1] === '*' && close !== '*/') ? m : ''));

// The line separators are built from code points, so the source holds no invisible character.
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

const MAX = 1024 * 1024;
// The two sizes every shape is measured at: the second is double the first, in units of the shape's own building block.
const SIZES = [2048, 4096];
// The most steps per character the witness accepts: one visit in the outer pass and at most one in an inner run.
const C = 6;
// Slack for the doubling check, so a shape that costs a fixed handful of steps at both sizes does not read as growth.
const SLACK = 64;

const CONFIG_LINE = '  "key": "' + 'v'.repeat(230) + '", // note\n';
const SHAPES = {
  'unclosed block openers': (n) => '/* a'.repeat(n),
  'nested block openers, never closed': (n) => '/* /* '.repeat(n),
  'unclosed string escapes': (n) => '"' + '\\"'.repeat(n),
  'a string ending in a lone backslash': (n) => '"\\'.repeat(n),
  'line comments with no line break': (n) => '// x'.repeat(n),
  'closed block comments': (n) => '/* c */ "k": 1, /* d */\n'.repeat(n),
  'closed line comments': (n) => '"k": 1, // c "x"\n'.repeat(n),
  // a config built to sit just under MAX_CONFIG_BYTES at the larger size, so the witness reads the largest config the reader accepts
  'a config at the size bound': (n) => '{\n' + CONFIG_LINE.repeat(n) + '}\n',
};

// One run: the text the shape builds at n units, and the steps the check counted on it.
function work(check, build, n) {
  const text = build(n);
  const counter = { steps: 0 };
  check(text, counter);
  return { length: text.length, steps: counter.steps };
}

// '' when the check's work is linear on this shape, else the reason it is not.
function linearVerdict(check, build) {
  const small = work(check, build, SIZES[0]);
  const large = work(check, build, SIZES[1]);
  if (small.steps < 1 || large.steps < 1) return `no steps counted (${small.steps}, ${large.steps}): the check does not count its work`;
  // the counter counts visits: a strip that reads the whole text counts at least a quarter step per character, so a loop that stops ticking is seen
  if (large.steps < large.length / 4) return `${large.steps} steps for ${large.length} characters, under a quarter per character: the check undercounts its work`;
  if (large.steps > C * large.length) return `${large.steps} steps for ${large.length} characters, over ${C} per character`;
  if (large.steps > 2 * small.steps + SLACK) return `${small.steps} steps became ${large.steps} as the text went from ${small.length} to ${large.length} characters`;
  return '';
}

test('stripJsonc work is linear on every shape: steps stay under C per character and at most double when the text doubles', () => {
  for (const [name, build] of Object.entries(SHAPES)) {
    assert.equal(linearVerdict(stripJsonc, build), '', name);
  }
});

test('the largest shape sits near MAX_CONFIG_BYTES, so the witness covers the size the reader accepts', () => {
  const large = work(stripJsonc, SHAPES['a config at the size bound'], SIZES[1]).length;
  assert.ok(large <= MAX && large >= MAX / 2, `${large} characters against a bound of ${MAX}`);
});

// A deliberately quadratic stand-in: every block opener rescans to the end of the input, as the pattern it replaces did.
function quadraticStandIn(content, counter) {
  let steps = 0;
  for (let i = 0; i < content.length; i++) {
    steps++;
    if (content[i] === '/' && content[i + 1] === '*') {
      for (let j = i + 2; j < content.length; j++) {
        steps++;
        if (content[j] === '*' && content[j + 1] === '/') break;
      }
    }
  }
  counter.steps += steps;
  return content;
}

test('the work witness goes red on a quadratic stand-in that rescans to the end at every block opener', () => {
  assert.notEqual(linearVerdict(quadraticStandIn, SHAPES['unclosed block openers']), '', 'a rescanning check must fail the witness');
  assert.notEqual(linearVerdict(quadraticStandIn, SHAPES['nested block openers, never closed']), '', 'a rescanning check must fail the witness');
});

test('the work witness goes red on a check that never counts its work, so it cannot pass vacuously', () => {
  const uncounted = (content) => oldStrip(content);
  assert.notEqual(linearVerdict(uncounted, SHAPES['closed block comments']), '', 'a check that leaves the counter at zero must fail');
});

test('stripJsonc leaves an unclosed opener in place, so a malformed config still fails JSON.parse', () => {
  for (const name of ['unclosed block openers', 'unclosed string escapes', 'a string ending in a lone backslash']) {
    const input = SHAPES[name](8);
    assert.equal(stripJsonc(input), input, `${name}: the unclosed text is emitted unchanged`);
  }
  assert.throws(() => JSON.parse(stripJsonc('{"a":1} /* never closed')));
  assert.throws(() => JSON.parse(stripJsonc('{"a":"never closed')));
});

const FIXTURES = [
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
  '{"a":1} // ends at a line separator' + LS + '{"b":2} // ends at a paragraph separator' + PS + '{"c":3}',
  '{"mode": "auto", // trailing note\n  "count": 3,\n}',
];

// Every .json file under the repo, outside the untracked and scratch folders. Read-only: the differential reads each file once.
function jsonFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'scratchpad', 'coverage'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) jsonFiles(p, out);
    else if (e.name.endsWith('.json')) out.push(p);
  }
  return out;
}

test('differential: the scanner returns the previous regex output on every JSON file the repo carries, and on the fixtures', () => {
  const files = jsonFiles(repo);
  assert.ok(files.length >= 3, `only ${files.length} JSON files found`);
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    assert.equal(stripJsonc(text), oldStrip(text), path.relative(repo, f));
  }
  for (const f of FIXTURES) assert.equal(stripJsonc(f), oldStrip(f), JSON.stringify(f));
});

// mulberry32: a small seeded generator, so the corpus is the same on every run and every platform.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('differential: the scanner returns the previous regex output on 20000 seeded random texts of string, escape, comment and newline pieces', () => {
  const rand = seeded(2904);
  const pieces = ['"', '\\', '\\"', '\\\\', '/', '*', '//', '/*', '*/', '\n', '\r', LS, PS, 'a', ' ', ',', '{', '}', ':', 'k', '1', '\t'];
  for (let i = 0; i < 20000; i++) {
    let text = '';
    const k = Math.floor(rand() * 24);
    for (let j = 0; j < k; j++) text += pieces[Math.floor(rand() * pieces.length)];
    assert.equal(stripJsonc(text), oldStrip(text), JSON.stringify(text));
  }
});

test('differential: 5000 seeded texts built from well-formed tokens agree with the previous regex, and most of them parse', () => {
  const rand = seeded(31);
  const tokens = ['"v"', '"a\\"b"', '"C:\\\\"', '"http://x"', '"/* no */"', ' ', '\n', ' // c\n', ' /* c */ ', ',', '1', 'true'];
  let parsed = 0;
  for (let i = 0; i < 5000; i++) {
    const text = '[' + Array.from({ length: 1 + Math.floor(rand() * 8) }, () => tokens[Math.floor(rand() * tokens.length)]).join('') + ']';
    const got = stripJsonc(text);
    assert.equal(got, oldStrip(text), JSON.stringify(text));
    try { JSON.parse(got); parsed++; } catch { /* a token mix that is not valid JSON is still compared above */ }
  }
  assert.ok(parsed >= 1000, `only ${parsed} of 5000 well-formed texts parsed`);
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

test('the conductor strips comments with its inline copy: a commented project config is read, an unclosed comment is malformed', (t) => {
  const home = scratch(t, 'ct-strip-hook-home-');
  const cwd = scratch(t, 'ct-strip-hook-proj-');
  fs.mkdirSync(path.join(cwd, '.git'));
  fs.mkdirSync(path.join(cwd, '.claude', 'coal'), { recursive: true });
  const cfg = path.join(cwd, '.claude', 'coal', 'coaltipple.json');
  const run = () => spawnSync(process.execPath, [path.join(repo, 'hooks', 'coaltipple-conductor.js')], { input: JSON.stringify({ hook_event_name: 'SessionStart' }), cwd, env: sandboxEnv(home), encoding: 'utf8', timeout: 20000 });
  fs.writeFileSync(cfg, '{ // routing off for this project\n  "mode": "off" /* block */\n}\n');
  const read = run();
  assert.equal(read.status, 0);
  assert.ok(!/routing active/.test(read.stdout), 'the commented config was read, so mode off silenced routing: ' + read.stdout);
  fs.writeFileSync(cfg, '{ "mode": "off" } /* never closed\n');
  const bad = run();
  assert.equal(bad.status, 0);
  assert.ok(bad.stdout.includes('malformed JSON'), 'an unclosed block comment is kept, so the config is named malformed: ' + bad.stdout);
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
  const FROM = 'if (j >= n) break;';
  const TO = 'if (j > n) break;';
  for (const rel of JSONC_SYNC_FILES) {
    const planted = path.join(tmp, rel);
    const body = fs.readFileSync(planted, 'utf8');
    assert.ok(body.includes(FROM), `${rel} holds the unclosed-comment line`);
    fs.writeFileSync(planted, body.replace(FROM, TO));
    const out = checkJsoncSync(tmp);
    assert.ok(out.some((f) => f.includes('DIVERGED') && f.includes(rel === JSONC_SYNC_FILES[0] ? JSONC_SYNC_FILES[1] : rel)), `${rel}: ${JSON.stringify(out)}`);
    fs.writeFileSync(planted, body);
  }
  const conductor = path.join(tmp, 'hooks', 'coaltipple-conductor.js');
  const cbody = fs.readFileSync(conductor, 'utf8');
  fs.writeFileSync(conductor, cbody.replace('const MAX_CONFIG_BYTES = 1024 * 1024;', 'const MAX_CONFIG_BYTES = 1024 * 1025;'));
  assert.ok(checkJsoncSync(tmp).some((f) => f.includes('MAX_CONFIG_BYTES') && f.includes('coaltipple-conductor.js')), 'a drifted byte bound is named');
});
