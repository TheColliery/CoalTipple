// The configurator's key search (scripts/lib/config-edit.mjs) reads the config text as a JSONC document, once, left to right. This file
// proves four things, the work ones by counting and never by reading a clock:
//   1. it finds the property JSON keeps: the last top-level property of that name, never a nested key, a line inside a comment or a key
//      inside a string, and it matches a key written on the same line as the opening brace;
//   2. its work is linear: steps stay under C per character, and at most double when the text doubles, on the shapes that made the old
//      line pattern (kept below as OLD_setKeyInText) rescan, such as a long run of white space and newlines before a key. The
//      witness is red on a quadratic stand-in and on a stand-in that does not count, so it can fail;
//   3. on the factory config it edits exactly what the old pattern edited, byte for byte, so the formatting of other keys is unchanged;
//   4. an edit whose value in force is not the requested one throws, and so does an edit that leaves the text unparsable.
// Zero-dep (node:test + built-ins), scripts-quality.md section 2; testing.md Determinism: no clock, a fixed seed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTopLevelProps, setKeyInText, assertEffective } from './config-edit.mjs';
import { stripJsonc } from './jsonc.mjs';
import { escapeRegExp } from './regex-escape.mjs';
import { CONFIG_SCHEMA } from './config-schema.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const parse = (text) => JSON.parse(stripJsonc(text));

// The key search as it stood before the scanner (scripts/configure.mjs, 1.7.6), kept verbatim as the reference the differential compares against.
// (it calls stripJsonc for its own parse check; the import above is the same module.)
function OLD_setKeyInText(text, key, jsonValue) {
  // Match an active (non-commented) "key": ... line. The lazy suffix group captures
  // everything after the colon-space up to the optional trailing whitespace at EOL.
  // We then dissect the suffix ourselves to separate value / comma / comment so that:
  //   - the trailing comma is PRESERVED AS-IS (never synthesised) - H1 fix
  //   - any trailing // comment is preserved verbatim - M6 fix
  const re = new RegExp(`^(\\s*"${escapeRegExp(key)}"\\s*:\\s*)([^\\n]*?)(\\s*)$`, 'm')
  if (!re.test(text)) return null
  const result = text.replace(re, (_m, head, suffix, tail) => {
    // Walk the suffix char-by-char to find the first '//' outside a quoted string.
    let commentPart = ''
    let rest = suffix
    let inStr = false
    for (let ci = 0; ci < rest.length - 1; ci++) {
      const ch = rest[ci]
      if (inStr) {
        if (ch === '\\') { ci++; continue } // skip escaped char
        if (ch === '"') inStr = false
      } else {
        if (ch === '"') { inStr = true; continue }
        if (ch === '/' && rest[ci + 1] === '/') {
          commentPart = rest.slice(ci) // "// ..." to end of suffix
          rest = rest.slice(0, ci)     // value[,][spaces]
          break
        }
      }
    }
    // Extract the trailing comma and any spaces between the value/comma and the comment.
    // `rest` at this point is everything before the '//' (e.g. '"auto", ' or '"on"').
    // Trim trailing whitespace to isolate the structural content, then separate the comma.
    const restTrimmed = rest.trimEnd()       // e.g. '"auto",' or '"on"'
    const trailingSpaces = rest.slice(restTrimmed.length) // spaces before comment (e.g. ' ')
    const trailingComma = restTrimmed.endsWith(',') ? ',' : '' // H1: preserve, never synthesise
    return `${head}${jsonValue}${trailingComma}${trailingSpaces}${commentPart}${tail}`
  })
  // Validate the rewrite parses before the caller writes it to disk.
  let check = result
  if (check.charCodeAt(0) === 0xFEFF) check = check.slice(1)
  JSON.parse(stripJsonc(check)) // throws if the rewrite corrupted the JSON
  return result
}

// ---- 1. the property JSON keeps -----------------------------------------------------------------

test('setKeyInText edits a key written on the same line as the opening brace, once', () => {
  const out = setKeyInText('{"qualityBar": 60, "mode": "auto"}', 'qualityBar', '85');
  assert.equal(out, '{"qualityBar": 85, "mode": "auto"}');
});

test('setKeyInText edits the LAST of several top-level properties of one name, the one JSON.parse keeps', () => {
  const text = '{\n  "k": 1,\n  "m": 2,\n  "k": 3 // keeps\n}';
  const out = setKeyInText(text, 'k', '9');
  assert.equal(out, '{\n  "k": 1,\n  "m": 2,\n  "k": 9 // keeps\n}');
  assert.equal(parse(out).k, 9);
});

test('setKeyInText never reads a nested key, a commented line or a key inside a string', () => {
  assert.equal(setKeyInText('{"a": {"k": 1}, "b": [{"k": 2}]}', 'k', '9'), null, 'a nested key is not a top-level property');
  assert.equal(setKeyInText('{\n  // "k": 1,\n  /* "k": 2, */\n  "m": 3\n}', 'k', '9'), null, 'a commented line is not a property');
  assert.equal(setKeyInText('{"note": "\\"k\\": 5, \\"m\\": 6", "m": 1}', 'k', '9'), null, 'text inside a string is not a property');
  assert.equal(parse(setKeyInText('{"note": "\\"k\\": 5", "k": 1}', 'k', '9')).k, 9);
});

test('setKeyInText replaces a value of any kind whole and keeps the comma, the spacing and the comment after it', () => {
  const kinds = [
    ['"old"', '"new"'], ['12', '7'], ['true', 'false'], ['null', '[1,2]'], ['[\n    "a",\n    "b"\n  ]', '["x"]'], ['{ "n": [1, { "d": "}" }] }', '3'], ['"a // not a comment"', '"b"'],
  ];
  for (const [before, value] of kinds) {
    const text = `{\n  "first": 1,\n  "k": ${before}, // note about k\n  "last": 2\n}`;
    const out = setKeyInText(text, 'k', value);
    assert.equal(out, `{\n  "first": 1,\n  "k": ${value}, // note about k\n  "last": 2\n}`, before);
  }
});

test('setKeyInText reads a key with an escape in its name as the key JSON.parse reads', () => {
  const out = setKeyInText('{"\\u006b": 1}', 'k', '2');
  assert.equal(parse(out).k, 2);
});

test('setKeyInText handles a leading BOM, comments before the root, and a missing key', () => {
  const bom = String.fromCharCode(0xFEFF);
  assert.equal(setKeyInText(bom + '/* head */ {"k": 1}', 'k', '2'), bom + '/* head */ {"k": 2}');
  assert.equal(setKeyInText('{"a": 1}', 'k', '2'), null);
  assert.equal(setKeyInText('[1, 2]', 'k', '2'), null, 'a root that is not an object holds no property');
  assert.equal(setKeyInText('', 'k', '2'), null);
});

test('findTopLevelProps lists the root properties in order with the span of each value', () => {
  const text = '{ "a": 1, "b": [2, 3], "c": "x" }';
  const props = findTopLevelProps(text);
  assert.deepEqual(props.map((p) => p.key), ['a', 'b', 'c']);
  assert.deepEqual(props.map((p) => text.slice(p.start, p.end)), ['1', '[2, 3]', '"x"']);
});

// ---- 2. the work is linear ----------------------------------------------------------------------

const SIZES = [2048, 4096];
// The most steps per character the witness accepts: one visit in the document pass and at most one in an inner run.
const C = 6;
// Slack for the doubling check, so a shape that costs a fixed handful of steps at both sizes does not read as growth.
const SLACK = 64;

const SHAPES = {
  'a long run of white space and newlines before the key': (n) => '{' + ' \n'.repeat(n) + '"k": 1\n}',
  'a long run of blank lines and an absent key': (n) => '{\n' + '\n'.repeat(n) + '"m": 1\n}',
  'indentation only, then an absent key': (n) => '{\n' + '          \n'.repeat(Math.ceil(n / 4)) + '"m": 1\n}',
  // fixed-width names and values, so the text length is exactly proportional to n
  'many properties': (n) => '{' + Array.from({ length: n }, (_, i) => `"p${String(i).padStart(6, '0')}": 0`).join(',\n') + '}',
  'one top-level key repeated': (n) => '{' + '"k": 1,\n'.repeat(n) + '"z": 0}',
  'a long run of line comments': (n) => '{\n' + '// "k": 1\n'.repeat(n) + '"k": 2\n}',
  'a block comment that never closes': (n) => '{ /* ' + 'x'.repeat(4 * n),
  'a string that never closes': (n) => '{"a": "' + 'x\\'.repeat(2 * n),
  'deep nesting before the key': (n) => '{"a": ' + '['.repeat(n) + ']'.repeat(n) + ', "k": 1}',
  'a long string value': (n) => '{"a": "' + 'v'.repeat(4 * n) + '", "k": 1}',
};

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
  // the counter counts visits: a search that reads the whole text counts at least a quarter step per character, so a loop that stops ticking is seen
  if (large.steps < large.length / 4) return `${large.steps} steps for ${large.length} characters, under a quarter per character: the check undercounts its work`;
  if (large.steps > C * large.length) return `${large.steps} steps for ${large.length} characters, over ${C} per character`;
  if (large.steps > 2 * small.steps + SLACK) return `${small.steps} steps became ${large.steps} as the text went from ${small.length} to ${large.length} characters`;
  return '';
}

const KEY = 'k';
const search = (text, counter) => setKeyInText(text, KEY, '9', counter);

test('setKeyInText work is linear on every shape: steps stay under C per character and at most double when the text doubles', () => {
  for (const [name, build] of Object.entries(SHAPES)) {
    // a shape that never parses (an unclosed comment or string) still has to be read in linear time; the edit then finds nothing or throws
    const check = (text, counter) => { try { search(text, counter); } catch { /* the parse check of an unusable text throws; the steps were counted before it */ } };
    assert.equal(linearVerdict(check, build), '', name);
  }
});

// A deliberately quadratic stand-in: the shape of the pattern it replaces, where every line start rescans the white space after it.
function quadraticStandIn(text, counter) {
  let steps = 0;
  for (let i = 0; i < text.length; i++) {
    steps++;
    if (i === 0 || text[i - 1] === '\n') {
      for (let j = i; j < text.length && /\s/.test(text[j]); j++) steps++;
    }
  }
  counter.steps += steps;
  return null;
}

test('the work witness goes red on a quadratic stand-in that rescans the white space from every line start', () => {
  assert.notEqual(linearVerdict(quadraticStandIn, SHAPES['a long run of blank lines and an absent key']), '', 'a rescanning search must fail the witness');
  assert.notEqual(linearVerdict(quadraticStandIn, SHAPES['a long run of white space and newlines before the key']), '', 'a rescanning search must fail the witness');
});

test('the work witness goes red on a search that never counts its work, so it cannot pass vacuously', () => {
  const uncounted = (text) => OLD_setKeyInText(text, KEY, '9');
  assert.notEqual(linearVerdict(uncounted, SHAPES['many properties']), '', 'a search that leaves the counter at zero must fail');
});

// ---- 3. the old pattern and the scanner edit the same bytes where the old one was right -----------

test('on the factory config, setKeyInText edits every settable key exactly as the old pattern did', () => {
  const factory = fs.readFileSync(path.join(repo, 'platform-configs', '.coaltipple.json'), 'utf8');
  const samples = { bool: ['true', 'false'], int: ['3', '77'], enum: ['"auto"', '"off"'], strArr: ['[]', '["a","b"]'] };
  let compared = 0;
  for (const spec of CONFIG_SCHEMA) {
    for (const value of samples[spec.type] || []) {
      let want;
      try { want = OLD_setKeyInText(factory, spec.key, value); } catch { continue; } // a sample the old pattern's own check refused is not a comparison
      assert.equal(setKeyInText(factory, spec.key, value), want, `${spec.key} = ${value}`);
      compared++;
    }
  }
  assert.ok(compared >= 30, `only ${compared} key and value pairs compared`);
});

// ---- 4. the value in force is checked -----------------------------------------------------------

test('assertEffective throws when the value JSON keeps is not the requested one, and when the text does not parse', () => {
  assert.doesNotThrow(() => assertEffective('{"k": 1, "k": 2}', 'k', '2'));
  assert.throws(() => assertEffective('{"k": 2, "k": 1}', 'k', '2'), /did not take effect/);
  assert.throws(() => assertEffective('{"m": 1}', 'k', '2'), /did not take effect/);
  assert.throws(() => assertEffective('{"k": 2,, }', 'k', '2'), SyntaxError);
  assert.doesNotThrow(() => assertEffective('{"k": ["a", {"b": null}]}', 'k', '["a",{"b":null}]'));
  assert.throws(() => assertEffective('{"k": ["a"]}', 'k', '["b"]'), /did not take effect/);
});

test('setKeyInText throws on a value that is not JSON, so nothing unparsable is returned', () => {
  assert.throws(() => setKeyInText('{"k": 1}', 'k', '{oops'), SyntaxError);
});
