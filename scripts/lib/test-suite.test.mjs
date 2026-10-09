// scripts/lib/test-suite.mjs, the room's glue over the canon wave runner (09a). Every leg runs the REAL glue and the REAL canon runner in a temp tree that holds copies of
// wave-run.mjs, machine-reading.mjs and stdout-sync.mjs and a few planted test files, under tiny limits, so a hang is a bounded failure and never a hung test. The planted
// files are plain data strings. Probed, not assumed: nothing here asserts what a plain `node --test` does with a planted file (that varies by Node version); each leg
// asserts what THIS runner does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIMITS, waveRunArgs, runSuite } from './test-suite.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CANON = ['wave-run.mjs', 'machine-reading.mjs', 'stdout-sync.mjs'];
const IMPORT = "import { test } from 'node:test';";
const PLANTS = {
  green: [IMPORT, "test('a real test', () => {});"],
  vacuous: [IMPORT, 'process.exit(0);', "test('never registered', () => {});"],
  leak: [IMPORT, 'setInterval(() => {}, 1000);', "test('passes while the file leaks an interval', () => {});"],
  hangTest: [IMPORT, 'setInterval(() => {}, 1000);', "test('awaits forever', async () => { await new Promise(() => {}); });"],
  hangFile: ['setInterval(() => {}, 1000);', 'await new Promise(() => {});'],
};
const TINY = { heapMb: 512, fileTimeoutMs: 4000, fileClockMs: 9000, deadlineMs: 30000, backstopMarginMs: 2000 };

// A temp repo with the canon runner copied in and the named plants written under scripts/. Registered for cleanup the line after it is made.
function tree(t, plants) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-suite-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
  for (const f of CANON) fs.copyFileSync(path.join(HERE, f), path.join(dir, 'scripts', 'lib', f));
  const tests = [];
  for (const [name, key] of Object.entries(plants)) {
    const rel = 'scripts/' + name + '.test.mjs';
    fs.writeFileSync(path.join(dir, ...rel.split('/')), PLANTS[key].join('\n') + '\n');
    tests.push(rel);
  }
  return { dir, tests };
}

test('test-suite: the limits are finite, the roster follows the double dash, and the whole-run deadline sits under the CI gate job (10 minutes)', () => {
  for (const k of ['heapMb', 'fileTimeoutMs', 'fileClockMs', 'deadlineMs', 'backstopMarginMs']) assert.ok(Number.isInteger(LIMITS[k]) && LIMITS[k] > 0, k + ' is a positive integer');
  assert.ok(LIMITS.fileTimeoutMs < LIMITS.fileClockMs && LIMITS.fileClockMs < LIMITS.deadlineMs, 'test clock < file clock < whole-run deadline');
  assert.ok(LIMITS.deadlineMs + LIMITS.backstopMarginMs < 10 * 60 * 1000, 'the runner backstop ends before the CI gate job does');
  const args = waveRunArgs(['a.test.mjs', 'b.test.mjs'], LIMITS);
  assert.equal(args[0], path.join('scripts', 'lib', 'wave-run.mjs'));
  assert.deepEqual(args.slice(args.indexOf('--') + 1), ['a.test.mjs', 'b.test.mjs']);
  for (const flag of ['--heap-mb', '--file-timeout-ms', '--file-clock-ms', '--deadline-ms']) assert.ok(args.includes(flag), flag);
});

test('test-suite: a green roster ends 0 and the summary says GREEN', async (t) => {
  const { dir, tests } = tree(t, { a: 'green', b: 'green' });
  const r = await runSuite({ repo: dir, tests, limits: TINY, quiet: true });
  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /GREEN/);
});

test('test-suite: a file that exits 0 before its tests register is VACUOUS and the run is red (the TAP-names MUST)', async (t) => {
  const { dir, tests } = tree(t, { a: 'green', ghost: 'vacuous' });
  const r = await runSuite({ repo: dir, tests, limits: TINY, quiet: true });
  assert.equal(r.code, 1, r.output);
  assert.match(r.output, /VACUOUS scripts\/ghost\.test\.mjs/);
  assert.match(r.output, /vacuous 1/);
  assert.match(r.output, /FAIL test runner: the suite is RED/);
});

test('test-suite: a file that leaks an interval while its one test passes ENDS (force-exit), it does not hold the run open', async (t) => {
  const { dir, tests } = tree(t, { leaky: 'leak' });
  const t0 = Date.now();
  const r = await runSuite({ repo: dir, tests, limits: TINY, quiet: true });
  assert.equal(r.code, 0, r.output);
  assert.ok(Date.now() - t0 < TINY.deadlineMs, 'it ended well before the whole-run deadline');
});

test('test-suite: a test that awaits forever beside a live interval is failed at the test clock, by name, and the run ends', async (t) => {
  const { dir, tests } = tree(t, { stuck: 'hangTest', a: 'green' });
  const r = await runSuite({ repo: dir, tests, limits: TINY, quiet: true });
  assert.equal(r.code, 1, r.output);
  assert.match(r.output, /FAIL scripts\/stuck\.test\.mjs/);
  assert.match(r.output, /pass 1/, 'the other file still ran');
});

test('test-suite: a file that hangs before its first test is killed at the file clock, and the rest of the roster still runs', async (t) => {
  const { dir, tests } = tree(t, { frozen: 'hangFile', a: 'green' });
  const r = await runSuite({ repo: dir, tests, limits: { ...TINY, fileClockMs: 3000 }, quiet: true });
  assert.equal(r.code, 1, r.output);
  assert.match(r.output, /FAIL scripts\/frozen\.test\.mjs: killed at the file clock/);
  assert.match(r.output, /pass 1/);
});

test('test-suite: the whole-run deadline kills a hung file and the run is red with the named reason', async (t) => {
  const { dir, tests } = tree(t, { frozen: 'hangFile' });
  const t0 = Date.now();
  const r = await runSuite({ repo: dir, tests, limits: { ...TINY, fileClockMs: 200000, deadlineMs: 3000 }, quiet: true });
  assert.equal(r.code, 1, r.output);
  assert.match(r.output, /killed at the whole-run deadline/);
  assert.ok(Date.now() - t0 < 25000, 'it ended soon after the deadline');
});

test('test-suite: a missing runner is a named FAIL test runner line and a red exit, not a stack', async (t) => {
  const { dir, tests } = tree(t, { a: 'green' });
  fs.rmSync(path.join(dir, 'scripts', 'lib', 'wave-run.mjs'));
  const r = await runSuite({ repo: dir, tests, limits: TINY, quiet: true });
  assert.equal(r.code, 1);
  assert.match(r.output, /^FAIL test runner: scripts\/lib\/wave-run\.mjs is missing/);
});

test('test-suite: a runner that outlives its own deadline is killed by the backstop and named', async (t) => {
  const { dir, tests } = tree(t, { a: 'green' });
  fs.writeFileSync(path.join(dir, 'scripts', 'lib', 'wave-run.mjs'), 'setInterval(() => {}, 1000);\n');
  const t0 = Date.now();
  const r = await runSuite({ repo: dir, tests, limits: { ...TINY, deadlineMs: 1000, backstopMarginMs: 500 }, quiet: true });
  assert.equal(r.code, 1);
  assert.match(r.output, /FAIL test runner: wave-run was still running/);
  assert.ok(Date.now() - t0 < 20000);
});

test('test-suite: a runner that ends with a code that is no verdict (a crash) is a named FAIL test runner line', async (t) => {
  const { dir, tests } = tree(t, { a: 'green' });
  fs.writeFileSync(path.join(dir, 'scripts', 'lib', 'wave-run.mjs'), 'process.exitCode = 2;\n');
  const r = await runSuite({ repo: dir, tests, limits: TINY, quiet: true });
  assert.equal(r.code, 1);
  assert.match(r.output, /FAIL test runner: wave-run ended with exit code 2/);
});
