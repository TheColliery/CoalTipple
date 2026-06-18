#!/usr/bin/env node
// CoalTipple test runner — the canonical gate suite. Enumerates EVERY test file
// explicitly and FAILS LOUD on drift in BOTH directions:
//   listed-but-missing — `node --test` silently ignores missing file args, and
//     the directory form is unreliable on Node 24 (MODULE_NOT_FOUND);
//   on-disk-but-unlisted — an orphan *.test.mjs would silently never run.
// Run by pre-commit / pre-push alongside verify.mjs. Fail-loud CLI (not a hook).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
  'scripts/build-plugin.test.mjs',
  'scripts/build-dist.test.mjs',
  'scripts/build-skill.test.mjs',
];

const missing = TESTS.filter((t) => !fs.existsSync(path.join(repo, t)));
if (missing.length) {
  console.error(`test runner: ${missing.length} listed test file(s) MISSING — ${missing.join(', ')}`);
  process.exit(1);
}

const onDisk = [];
for (const dir of ['scripts', 'scripts/lib']) {
  for (const f of fs.readdirSync(path.join(repo, dir))) if (f.endsWith('.test.mjs')) onDisk.push(`${dir}/${f}`);
}
const orphans = onDisk.filter((f) => !TESTS.includes(f));
if (orphans.length) {
  console.error(`test runner: ${orphans.length} on-disk test(s) NOT in the suite — ${orphans.join(', ')}. Add to scripts/test.mjs.`);
  process.exit(1);
}

const r = spawnSync(process.execPath, ['--test', ...TESTS], { cwd: repo, stdio: 'inherit' });
process.exit(r.status ?? 1);
