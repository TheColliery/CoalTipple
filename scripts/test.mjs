#!/usr/bin/env node
// CoalTipple test runner — the canonical gate suite. Enumerates EVERY test file
// explicitly and FAILS LOUD on drift in BOTH directions:
//   listed-but-missing — `node --test` silently ignores missing file args, and
//     the directory form is unreliable on Node 24 (MODULE_NOT_FOUND);
//   on-disk-but-unlisted — an orphan *.test.mjs would silently never run.
// Run by pre-commit / pre-push alongside verify.mjs. Fail-loud CLI (not a hook).
//
// 09a: the files run through the canon wave runner (scripts/lib/wave-run.mjs, adopted by blob id; the glue and the numbers are scripts/lib/test-suite.mjs), one
// `node --test --test-force-exit` child per file under the heap cap, the clock per test/file, the wall clock per file and the whole-run deadline that kills the child TREE.
// A hung run therefore ends, and ends with a named line: `FAIL <file>: ...` from the runner, `FAIL test runner: ...` when the runner itself fails. The suite is judged by
// what the TAP says: a file that exits 0 before its tests registered is VACUOUS and the run is red (testing.md, the TAP-names MUST).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The complete suite — keep in sync when adding a test (the orphan check below
// fails the gate if you forget).
const TESTS = [
  'scripts/lib/grade.test.mjs',
  'scripts/lib/classify.test.mjs',
  'scripts/lib/config-schema.test.mjs',
  'scripts/lib/config-load.test.mjs',
  'scripts/lib/configure.test.mjs',
  'scripts/lib/conductor.test.mjs',
  'scripts/lib/conductor-update.test.mjs',
  'scripts/lib/install.test.mjs',
  'scripts/lib/jsonc.test.mjs',
  'scripts/lib/grade-task.test.mjs',
  'scripts/lib/config-keys.test.mjs',
  'scripts/lib/pointer-check.test.mjs',
  'scripts/lib/link-check.test.mjs',
  'scripts/lib/git-env.test.mjs',
  'scripts/lib/git-env-census.test.mjs',
  'scripts/lib/git-env-pins.test.mjs',
  'scripts/build-plugin.test.mjs',
  'scripts/build-dist.test.mjs',
  'scripts/build-skill.test.mjs',
  'scripts/verify.test.mjs',
  'scripts/secret-scan.test.mjs',
  'scripts/secret-gate.test.mjs',
  'scripts/release-notes.test.mjs',
  'scripts/verify-release-shape.test.mjs',
  'scripts/lib/release-shape.test.mjs',
  'scripts/lib/regex-escape.test.mjs',
  'scripts/lib/wave-run.test.mjs',
  'scripts/lib/test-suite.test.mjs',
];

async function main() {
  const missing = TESTS.filter((t) => !fs.existsSync(path.join(repo, t)));
  if (missing.length) {
    console.error(`test runner: ${missing.length} listed test file(s) MISSING — ${missing.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const onDisk = [];
  for (const dir of ['scripts', 'scripts/lib']) {
    for (const f of fs.readdirSync(path.join(repo, dir))) if (f.endsWith('.test.mjs')) onDisk.push(`${dir}/${f}`);
  }
  const orphans = onDisk.filter((f) => !TESTS.includes(f));
  if (orphans.length) {
    console.error(`test runner: ${orphans.length} on-disk test(s) NOT in the suite — ${orphans.join(', ')}. Add to scripts/test.mjs.`);
    process.exitCode = 1;
    return;
  }

  // node/runtime.md section 1: the room's own lib is imported inside main, so a missing file is a clean named line and a red exit, never a link-time stack.
  let suite;
  try {
    suite = await import(pathToFileURL(path.join(repo, 'scripts', 'lib', 'test-suite.mjs')).href);
  } catch (e) {
    console.log(`FAIL test runner: cannot load scripts/lib/test-suite.mjs (${e && e.code ? e.code : e.message}) -- restore it from git; the suite is not run without it`);
    process.exitCode = 1;
    return;
  }
  const { code } = await suite.runSuite({ repo, tests: TESTS });
  process.exitCode = code;
}

main().catch((e) => {
  console.log(`FAIL test runner: crashed (${e && e.message ? e.message : 'error'})`);
  process.exitCode = 1;
});
