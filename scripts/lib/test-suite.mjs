import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
// The room's glue between scripts/test.mjs and the canon wave runner (scripts/lib/wave-run.mjs, adopted by blob id, never edited here). 09a unit 1.
//
// WHAT THE CANON RUNNER ALREADY CARRIES (so this file does not): one `node --test --test-reporter=tap --test-force-exit` child per file, the next admitted only
// while a fresh machine reading says BREATHE; the heap cap on NODE_OPTIONS, so a test's own spawns inherit it (zone rule, dispatch-transport.md ninth amendment, as
// corrected 2026-10-08: the runner passes its own --max-old-space-size to the file processes, and the ENV form is what caps the processes a TEST spawns);
// --test-concurrency does not apply because the files are separate children; a clock per test/file (--test-timeout), a wall clock per FILE that kills the file's tree
// (--file-clock-ms), a whole-run deadline that kills the tree of every running child; and a file that exits 0 before its tests registered is VACUOUS, which reds the
// run (testing.md: a gate judges a run by the TAP test names it expects, never by an exit code and a pass count alone).
// WHAT IS THIS ROOM'S: the numbers below, a named `FAIL test runner` line for every way the runner itself can fail (it never starts, it crashes, it outlives its own
// deadline, the suite is red), and a backstop that kills the runner's whole tree if the runner itself hangs.
//
// SIZING (this room's own variables, never the canon's), re-measured 2026-10-16 on this box, Node 24.19, all 32 files of the roster (scripts/test.mjs TESTS; re-derive the count there, never from this line), each ALONE and serial (method, re-runnable from a clone: for every roster file in turn, wait for BREATHE, then time one `node --test --test-timeout=120000 <file>` child with --max-old-space-size=2048, wall clock around the spawn, sum the file times for the serial total):
// slowest file scripts/verify.test.mjs 66.4 s, then wave-run.test.mjs 27.3 s, secret-scan.test.mjs 26.0 s, secret-gate.test.mjs 25.3 s, test-suite.test.mjs 15.6 s; the serial total 223.0 s, every file exit 0.
// (The 2026-10-09 measurement on 28 files read 262.9 s with another seat's wave running beside, slowest file 57.4 s; a box that is busy stretches every figure, which is why the multiples below are taken against this newer, quieter reading and the old one is only history.)
// The worst case a wave can reach is the serial total, because a box that never breathes admits one file at a time.
//  - fileTimeoutMs 410000 (29iw; 240000 at 29is, 120000 on the 2026-10-16 serial reading above, where it was 1.8x the 66.4 s slowest): on Node 22 the clock of --test-timeout is per FILE
//    (nodejs/node PR #57672 landed in v24, where it is per test), so it must hold the slowest FILE with headroom. The slowest file is scripts/secret-gate.test.mjs (56 tests, canon blob 18842d601963).
//    READINGS on GitHub's Node 22 runners, from two rooms running the same blob: CoalBoard PR run 44311491675 (Windows file 185.4 s, step 211 s; its worst Node 22 file 224.9 s on macOS; an earlier
//    run there took a 294 s step on Windows); CoalLedger 4f7459f on main (Windows 187.8 s, macOS 174.1 s, Ubuntu 152.0 s). Cuts at 240 s on Windows Node 22: CoalLedger (job 134775496122), CoalMine once
//    (job 134735905795, green on re-run) and this room at 459aa46 (job 134809803395), so the true worst is above 240 s and 224.9 s is a floor under it. The 29is figure (240 s) was 1.5x a 156 s
//    PROJECTION by test count and was cut; this one is sized from the readings: 1.8x the 224.9 s worst reading is 404.8 s, rounded up to 410 s (scripts/lib/test-suite.test.mjs holds the 1.8x as a leg),
//    about what CoalBoard, CoalLedger, CoalGob and CoalWash set (400 to 420 s). The canon wave-run.mjs prints no per-file time for a passing file and is never edited here, so no per-file CI time is
//    read in this room; the readings above are the other rooms'.
//  - fileClockMs 450000 (29iw; 300000 at 29is, 240000 before, 3.6x the 66.4 s slowest): the wall clock of one file in a wave that shares the box; it ends a hang before the first test, which
//    --test-timeout never reaches, without waiting for the whole-run deadline. It must stay above fileTimeoutMs (410 s) and under deadlineMs, so it moved; 450 s is 1.1x the per-file clock.
//  - deadlineMs 500000 (29iw; 420000 before, 1.9x the 223.0 s serial total on the 2026-10-16 reading): it must stay above fileClockMs, so it moved. This room's own whole-run reading: macOS Node 22 test
//    step 398 s at 459aa46 (job 134809803476), against the old 420 s; 500 s is 1.25x that step (scripts/lib/test-suite.test.mjs holds the 1.25x as a leg). With the 60 s backstop margin the runner
//    is gone by 560 s, under the CI gate job's timeout-minutes (10, ci.yml; 40 s left for the job's checkout, setup and verify, which is why the deadline is not higher). The 2026-10-09 CI legs
//    (run 37928363807 at 02b8c20, a 28-file roster) ran the suite in 49 to 86 s, long before the gate test grew.
export const LIMITS = Object.freeze({ heapMb: 2048, fileTimeoutMs: 410000, fileClockMs: 450000, deadlineMs: 500000, backstopMarginMs: 60000 });

export function waveRunArgs(tests, limits = LIMITS) {
  return [
    path.join('scripts', 'lib', 'wave-run.mjs'),
    '--heap-mb', String(limits.heapMb),
    '--file-timeout-ms', String(limits.fileTimeoutMs),
    '--file-clock-ms', String(limits.fileClockMs),
    '--deadline-ms', String(limits.deadlineMs),
    '--', ...tests,
  ];
}

function killTree(child) {
  if (process.platform === 'win32') { spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore', timeout: 30000, windowsHide: true }); return; }
  try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') child.kill('SIGKILL'); }
}

// Runs the roster through the canon runner from `repo`. Resolves { code, output } and never rejects: 0 only when the runner ended 0, else 1, with a `FAIL test runner:` line
// naming why when the runner itself failed. `quiet` keeps the output out of this process's own streams (a test reads it from `output`).
export function runSuite({ repo, tests, limits = LIMITS, env = process.env, quiet = false }) {
  return new Promise((resolve) => {
    let output = '';
    const say = (line) => { output += line + '\n'; if (!quiet) process.stdout.write(line + '\n'); };
    const done = (code) => resolve({ code, output });
    const runner = path.join(repo, 'scripts', 'lib', 'wave-run.mjs');
    if (!fs.existsSync(runner)) { say('FAIL test runner: scripts/lib/wave-run.mjs is missing -- restore it from git; the suite is not run without its runner'); done(1); return; }
    const childEnv = { ...env };
    delete childEnv.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, waveRunArgs(tests, limits), { cwd: repo, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
    let settled = false;
    const finish = (code) => { if (settled) return; settled = true; clearTimeout(backstop); done(code); };
    const forward = (chunk, stream) => { output += chunk; if (!quiet) stream.write(chunk); };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => forward(d, process.stdout));
    child.stderr.on('data', (d) => forward(d, process.stderr));
    // The runner has its own whole-run deadline and kills every file's tree there. This is the bound on the RUNNER: past its deadline and a margin, its tree is killed.
    const backstopMs = limits.deadlineMs + limits.backstopMarginMs;
    const backstop = setTimeout(() => {
      killTree(child);
      say(`FAIL test runner: wave-run was still running ${backstopMs} ms in (its own whole-run deadline is ${limits.deadlineMs} ms) -- its process tree was killed`);
      finish(1);
    }, backstopMs);
    child.on('error', (e) => { say(`FAIL test runner: wave-run could not start (${e.code || e.message})`); finish(1); });
    child.on('close', (code, signal) => {
      if (settled) return;
      if (code === 0) { finish(0); return; }
      if (code === 1) say('FAIL test runner: the suite is RED -- the FAIL, VACUOUS and NOT-RUN lines and the wave-run summary above name which files');
      else say(`FAIL test runner: wave-run ended with ${signal ? 'signal ' + signal : 'exit code ' + code} (64 = it refused its arguments, 2 = it crashed), which is no verdict`);
      finish(1);
    });
  });
}
