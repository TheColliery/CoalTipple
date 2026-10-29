// A script that runs only when invoked directly must also run when it is invoked through a link. Node gives import.meta.url as the real
// (link-resolved) path of the entry file, while process.argv[1] keeps the spelling it was started with, so a check that compares the two
// as strings is false when the checkout is reached through a symlink or a junction: the script then does nothing and exits 0, which for a
// `--check` gate reads as a pass. Each leg below starts one CLI through a directory link and expects the same output as a start by the real
// path. One skippable leg per test: the probe decides at run time whether this machine can make a directory link. Zero-dep, built-ins only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sandboxEnv } from './test-env.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const scratch = (t, prefix) => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
// Returns the link path, or null after a visible skip when no directory link can be made here.
function linkTo(t, target, holder) {
  const link = path.join(holder, 'link');
  try { fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir'); return link; } catch (e) { t.skip('cannot create a directory link here (' + (e.code || e.message) + ')'); return null; }
}
const run = (script, args, cwd, home) => spawnSync(process.execPath, [script, ...args], { cwd, env: sandboxEnv(home), encoding: 'utf8', timeout: 60000 });

test('build-dist.mjs --check run through a directory link reports on the dist like a run by the real path (29a)', (t) => {
  const holder = scratch(t, 'ct-ismain-dist-');
  const link = linkTo(t, repo, holder);
  if (!link) return;
  const viaLink = run(path.join(link, 'scripts', 'build-dist.mjs'), ['--check'], link, holder);
  const real = run(path.join(repo, 'scripts', 'build-dist.mjs'), ['--check'], repo, holder);
  assert.equal(real.status, 0, real.stdout + real.stderr);
  assert.equal(viaLink.status, real.status, viaLink.stdout + viaLink.stderr);
  assert.equal(viaLink.stdout, real.stdout, 'a run through the link printed something different from a run by the real path');
  assert.match(viaLink.stdout, /dist in sync with source/);
});

test('link-check.mjs run through a directory link reports like a run by the real path (29a)', (t) => {
  const holder = scratch(t, 'ct-ismain-links-');
  const link = linkTo(t, repo, holder);
  if (!link) return;
  const viaLink = run(path.join(link, 'scripts', 'lib', 'link-check.mjs'), [], link, holder);
  const real = run(path.join(repo, 'scripts', 'lib', 'link-check.mjs'), [], repo, holder);
  assert.equal(viaLink.status, real.status, viaLink.stdout + viaLink.stderr);
  assert.match(real.stdout, /finding\(s\)/, 'the real-path run reports');
  assert.equal(viaLink.stdout, real.stdout, 'a run through the link printed something different from a run by the real path');
});

test('build-plugin.mjs run through a directory link reports on the shared regions (29a), on a scratch copy it may write', (t) => {
  const copy = scratch(t, 'ct-ismain-plugin-copy-');
  for (const d of ['scripts', 'hooks', 'platform-configs']) fs.cpSync(path.join(repo, d), path.join(copy, d), { recursive: true });
  const holder = scratch(t, 'ct-ismain-plugin-link-');
  const link = linkTo(t, copy, holder);
  if (!link) return;
  const viaLink = run(path.join(link, 'scripts', 'build-plugin.mjs'), [], link, holder);
  assert.equal(viaLink.status, 0, viaLink.stdout + viaLink.stderr);
  assert.match(viaLink.stdout, /already in sync/, 'the shared-region check ran');
  assert.match(viaLink.stdout, /Done: 0 region\(s\) synced/);
});
