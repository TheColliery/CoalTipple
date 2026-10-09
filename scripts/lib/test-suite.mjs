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
// SIZING (this room's own variables, never the canon's), measured 2026-10-09 on this box, Node 24.19, each file ALONE and serial, with another seat's wave running
// beside: slowest file scripts/verify.test.mjs 49.9 s (57.4 s on 2026-10-08), next secret-scan.test.mjs 34.6 s, secret-gate.test.mjs 29.5 s; the 27-file serial total 166.9 s, and every file, wave-run.test.mjs included, runs in the wave.
//  - fileTimeoutMs 120000: on Node 22 the clock of --test-timeout is per FILE (nodejs/node PR #57672 landed in v24, where it is per test), so it must hold the slowest FILE
//    with headroom: 120 s is 2.4x 49.9 s and 2.1x the 57.4 s of 2026-10-08, the value CoalHearth and CoalWash use.
//  - fileClockMs 240000: the wall clock of one file in a wave that shares the box, 4x the slowest serial file; it ends a hang before the first test, which
//    --test-timeout never reaches, without waiting for the whole-run deadline.
//  - deadlineMs 420000: 2.5x the serial total and 1.95x the 215 s the whole suite took through this runner, in waves, on this box with that other seat's wave running beside (the
//    waves wait for BREATHE, so a busy box stretches the run); with the 60 s backstop margin the runner is gone by 8 minutes, under the CI gate job's timeout-minutes (10, ci.yml)
//    with the job's checkout, setup and verify around it.
export const LIMITS = Object.freeze({ heapMb: 2048, fileTimeoutMs: 120000, fileClockMs: 240000, deadlineMs: 420000, backstopMarginMs: 60000 });

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
