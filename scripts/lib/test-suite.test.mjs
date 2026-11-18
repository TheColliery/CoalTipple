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

// 29iw: on Node 22 --test-timeout is per FILE, so fileTimeoutMs must hold the slowest file with headroom. The slowest is scripts/secret-gate.test.mjs (56 tests, canon blob 18842d601963).
// READINGS on GitHub's Node 22 runners, from two rooms running the same canon blob: CoalBoard PR run 44311491675 (Windows file 185.4 s, step 211 s; its worst Node 22 file 224.9 s on macOS; an
// earlier run there took a 294 s step on Windows); CoalLedger 4f7459f on main (Windows 187.8 s, macOS 174.1 s, Ubuntu 152.0 s). Cuts at 240 s on Windows Node 22: CoalLedger (job 134775496122),
// CoalMine once (job 134735905795, green on re-run), this room at 459aa46 (job 134809803395), so the true worst is above 240 s. 224900 ms is the worst READING, a floor on the real worst, not a ceiling.
// This room's own whole-run reading: macOS Node 22 test step 398 s at 459aa46 (job 134809803476). The 29is figure (156000) was a projection by test count and was cut at 240 s.
const CI_NODE22_WORST_FILE_READING_MS = 224900;
const CLOCK_HEADROOM = 1.8; // the readings span 152 to 225 s between legs and runs and a Windows run was cut above 240 s, so the clock sits well over the worst reading; the same 1.8x the old serial sizing held, and about what CoalBoard, CoalLedger, CoalGob and CoalWash set (400 to 420 s)
const CI_NODE22_WHOLE_RUN_STEP_MS = 398000;
const RUN_HEADROOM = 1.25; // the whole-run deadline holds this room's own measured step with 25%; the CI gate job (10 minutes) caps it, since the deadline plus the backstop margin must end before the job does

test('test-suite: the per-file test clock holds the worst file reading on CI Node 22 with headroom (29iw)', () => {
  assert.ok(LIMITS.fileTimeoutMs >= CI_NODE22_WORST_FILE_READING_MS * CLOCK_HEADROOM, 'fileTimeoutMs ' + LIMITS.fileTimeoutMs + ' < ' + CI_NODE22_WORST_FILE_READING_MS * CLOCK_HEADROOM);
});

test('test-suite: the whole-run deadline holds the measured CI whole-run step with headroom (29iw)', () => {
  assert.ok(LIMITS.deadlineMs >= CI_NODE22_WHOLE_RUN_STEP_MS * RUN_HEADROOM, 'deadlineMs ' + LIMITS.deadlineMs + ' < ' + CI_NODE22_WHOLE_RUN_STEP_MS * RUN_HEADROOM);
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
  const r = await runSuite({ repo: dir, tests, limits: TINY, quiet: true });
  assert.equal(r.code, 0, r.output); // a leak that held the run open would reach the whole-run deadline and exit 1
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
  const r = await runSuite({ repo: dir, tests, limits: { ...TINY, fileClockMs: 200000, deadlineMs: 3000 }, quiet: true });
  assert.equal(r.code, 1, r.output);
  assert.match(r.output, /killed at the whole-run deadline/);
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
  const r = await runSuite({ repo: dir, tests, limits: { ...TINY, deadlineMs: 1000, backstopMarginMs: 500 }, quiet: true });
  assert.equal(r.code, 1);
  assert.match(r.output, /FAIL test runner: wave-run was still running/);
});

test('test-suite: a runner that ends with a code that is no verdict (a crash) is a named FAIL test runner line', async (t) => {
  const { dir, tests } = tree(t, { a: 'green' });
  fs.writeFileSync(path.join(dir, 'scripts', 'lib', 'wave-run.mjs'), 'process.exitCode = 2;\n');
  const r = await runSuite({ repo: dir, tests, limits: TINY, quiet: true });
  assert.equal(r.code, 1);
  assert.match(r.output, /FAIL test runner: wave-run ended with exit code 2/);
});
