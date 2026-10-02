// CWK-133/C-4. Unit tests for gitEnv() itself (ported from CoalFace's git-test-env.test.mjs,
// same four properties), plus a reproduction of the actual incident it exists to prevent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gitEnv } from './git-env.mjs';

test('gitEnv: strips every GIT_-prefixed key, whatever the name', () => {
  const saved = { ...process.env };
  try {
    process.env.GIT_DIR = '/somewhere/.git';
    process.env.GIT_INDEX_FILE = '/somewhere/.git/index';
    process.env.GIT_WORK_TREE = '/somewhere';
    process.env.GIT_SOME_FUTURE_KEY_NOBODY_HAS_WRITTEN_YET = 'x';
    const env = gitEnv('/ceiling');
    for (const key of Object.keys(env)) {
      assert.ok(!key.startsWith('GIT_') || key === 'GIT_CEILING_DIRECTORIES',
        `${key} is a GIT_* key that survived the strip`);
    }
  } finally {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('GIT_') && !(key in saved)) delete process.env[key];
    }
    Object.assign(process.env, saved);
  }
});

test('gitEnv: sets GIT_CEILING_DIRECTORIES to the given ceiling, and only that', () => {
  const env = gitEnv('/tmp/some-parent');
  assert.equal(env.GIT_CEILING_DIRECTORIES, '/tmp/some-parent');
});

test('gitEnv: non-GIT_ keys pass through unchanged (a plain copy, not a wipe)', () => {
  const saved = process.env.COALTIPPLE_GITENV_TEST_PROBE;
  try {
    process.env.COALTIPPLE_GITENV_TEST_PROBE = 'kept';
    const env = gitEnv('/ceiling');
    assert.equal(env.COALTIPPLE_GITENV_TEST_PROBE, 'kept');
  } finally {
    if (saved === undefined) delete process.env.COALTIPPLE_GITENV_TEST_PROBE;
    else process.env.COALTIPPLE_GITENV_TEST_PROBE = saved;
  }
});

test('gitEnv: mutating the returned object never touches process.env (a real copy)', () => {
  const before = process.env.GIT_DIR;
  const env = gitEnv('/ceiling');
  env.GIT_DIR = '/poisoned';
  assert.equal(process.env.GIT_DIR, before);
});

// The actual incident, reproduced against a THROWAWAY sandbox "enclosing repo" -- never
// the real umbrella or CoalTipple repo. `poisonedRepo` plays the role a linked worktree's
// hook plays in production: something upstream has already exported an absolute GIT_DIR
// pointing at IT. `fixtureDir` is the empty target directory a gate/test then tries to
// `git init` inside.
//
// R6b CI-RED: the original single test asserted the CoalFace signature (`core.bare` flipped
// to true) as a precondition on every platform. It is NOT universal. Measured 2026-09-24:
//   - Windows (git 2.55.0.windows.5), GIT_DIR in native backslash form: init is redirected
//     onto poisonedRepo AND flips its core.bare to true (the incident).
//   - The SAME Windows git with a forward-slash GIT_DIR: redirected, bare stays false.
//   - Linux (git 2.53.0, WSL) and the CI runners (ubuntu + macos, git 2.55.0): redirected,
//     bare stays false.
// What IS universal is the REDIRECT (fixtureDir never gets the `.git` its caller asked for)
// and the CONTAINMENT (gitEnv() prevents it). So: the redirect and the containment legs run
// everywhere; the bare-flip reproduction is a probed leg that skips visibly where the
// hazard does not occur. One skippable leg per test.
function mkIncident(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-gitenv-incident-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const poisonedRepo = path.join(root, 'poisoned-repo');
  const fixtureDir = path.join(root, 'fixture-target');
  fs.mkdirSync(poisonedRepo, { recursive: true });
  fs.mkdirSync(fixtureDir, { recursive: true });
  // Findings-back (INSPECT HIGH-1): EVERY fixture spawn in this file -- setup and check
  // spawns included, not only the deliberately-poisoned one -- routes through gitEnv(),
  // never bare process.env. Run from a real linked worktree's pre-commit hook (which already
  // exports a poisoned GIT_DIR), an unguarded spawn here would hit the REAL enclosing repo.
  const init = spawnSync('git', ['init', '-q', '.'], { cwd: poisonedRepo, encoding: 'utf8', env: gitEnv(root) });
  assert.equal(init.status, 0, `setup: poisonedRepo must init cleanly -- ${init.stderr}`);
  const bareOf = () => spawnSync('git', ['config', '--get', 'core.bare'], { cwd: poisonedRepo, encoding: 'utf8', env: gitEnv(root) }).stdout.trim();
  assert.equal(bareOf(), 'false', 'setup: an ordinary git init starts non-bare');
  // Built from gitEnv() plus the ONE planted GIT_DIR, never a raw `{...process.env}` spread
  // (INSPECT HIGH-1): an ambient GIT_* leftover from a real wrapping hook must not compound
  // with the deliberate poison. GIT_CEILING_DIRECTORIES never suppresses an explicit GIT_DIR.
  const poisonedEnv = { ...gitEnv(root), GIT_DIR: path.join(poisonedRepo, '.git') };
  return { root, poisonedRepo, fixtureDir, poisonedEnv, bareOf };
}

test('gitEnv: an unguarded git init under an ambient poisoned GIT_DIR is REDIRECTED away from its own directory (holds on every platform)', (t) => {
  const { fixtureDir, poisonedEnv } = mkIncident(t);
  const badInit = spawnSync('git', ['init', '-q', '.'], { cwd: fixtureDir, encoding: 'utf8', env: poisonedEnv });
  assert.equal(badInit.status, 0, `the poisoned init itself must succeed for this to be the real hazard -- ${badInit.stderr}`);
  assert.equal(fs.existsSync(path.join(fixtureDir, '.git')), false, 'the poisoned run never created the FIXTURE its caller asked for');
});

test('gitEnv: the CoalFace signature -- an unguarded poisoned git init flips the unrelated repo to bare -- reproduces where this git/platform does it', (t) => {
  const { fixtureDir, poisonedEnv, bareOf } = mkIncident(t);
  spawnSync('git', ['init', '-q', '.'], { cwd: fixtureDir, encoding: 'utf8', env: poisonedEnv });
  const bareAfterPoison = bareOf();
  if (bareAfterPoison !== 'true') {
    const ver = spawnSync('git', ['--version'], { encoding: 'utf8', env: gitEnv(fixtureDir) }).stdout.trim();
    t.skip(`the bare-flip does not occur on ${process.platform} with ${ver} (GIT_DIR=${poisonedEnv.GIT_DIR}); measured: it needs a native backslash GIT_DIR under Git for Windows -- capability-gated, the redirect and containment legs still run`);
    return;
  }
  assert.equal(bareAfterPoison, 'true', 'confirms the incident: the unrelated real repo was silently flipped to bare');
});

test('gitEnv: with gitEnv() applied the SAME ambient poisoning is contained -- the fixture gets its .git and the other repo is untouched (every platform)', (t) => {
  const { poisonedRepo, fixtureDir, bareOf } = mkIncident(t);
  // The poisoning arrives via the real ambient process.env, matching production, mutated in
  // place and restored.
  const savedGitDir = process.env.GIT_DIR;
  try {
    process.env.GIT_DIR = path.join(poisonedRepo, '.git');
    const guardedEnv = gitEnv(path.dirname(fixtureDir));
    assert.equal(guardedEnv.GIT_DIR, undefined, 'gitEnv() must have stripped the poisoned GIT_DIR before this assertion even runs');
    const goodInit = spawnSync('git', ['init', '-q', '.'], { cwd: fixtureDir, encoding: 'utf8', env: guardedEnv });
    assert.equal(goodInit.status, 0, `the guarded init must succeed -- ${goodInit.stderr}`);
    assert.equal(fs.existsSync(path.join(fixtureDir, '.git')), true, 'the guarded run creates the FIXTURE its caller actually asked for');
    assert.equal(bareOf(), 'false', 'the poisoned repo is left exactly as it was -- non-bare');
  } finally {
    if (savedGitDir === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = savedGitDir;
  }
});
