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
// `git init` inside. Without gitEnv(), the ambient GIT_DIR silently redirects that `init`
// onto poisonedRepo instead of fixtureDir, and (matching the measured CoalFace incident)
// flips poisonedRepo's own `core.bare` to `true` -- corrupting a real repository the
// caller never intended to touch, while fixtureDir is left without the `.git` it asked for.
test('gitEnv: a git init spawned with an ambient poisoned GIT_DIR corrupts the WRONG repo when unguarded, and is contained when gitEnv() strips it', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-gitenv-incident-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const poisonedRepo = path.join(root, 'poisoned-repo');
  const fixtureDir = path.join(root, 'fixture-target');
  fs.mkdirSync(poisonedRepo, { recursive: true });
  fs.mkdirSync(fixtureDir, { recursive: true });
  const init = spawnSync('git', ['init', '-q', '.'], { cwd: poisonedRepo, encoding: 'utf8' });
  assert.equal(init.status, 0, `setup: poisonedRepo must init cleanly -- ${init.stderr}`);
  const bareBefore = spawnSync('git', ['config', '--get', 'core.bare'], { cwd: poisonedRepo, encoding: 'utf8' }).stdout.trim();
  assert.equal(bareBefore, 'false', 'setup: an ordinary git init starts non-bare');

  // RED (the ambient hazard, unguarded): GIT_DIR points at poisonedRepo's own .git, no
  // GIT_CEILING_DIRECTORIES imposed -- this is the shape a linked worktree's hook creates.
  const poisonedEnv = { ...process.env, GIT_DIR: path.join(poisonedRepo, '.git') };
  const badInit = spawnSync('git', ['init', '-q', '.'], { cwd: fixtureDir, encoding: 'utf8', env: poisonedEnv });
  assert.equal(badInit.status, 0, `the poisoned init itself must succeed for this to be the real hazard -- ${badInit.stderr}`);
  assert.equal(fs.existsSync(path.join(fixtureDir, '.git')), false, 'the poisoned run never created the FIXTURE its caller asked for');
  const bareAfterPoison = spawnSync('git', ['config', '--get', 'core.bare'], { cwd: poisonedRepo, encoding: 'utf8' }).stdout.trim();
  assert.equal(bareAfterPoison, 'true', 'confirms the incident: the unrelated real repo was silently flipped to bare');

  // GREEN (gitEnv() applied): the SAME ambient poisoning attempt (this time on
  // process.env itself, mutated in place -- matching production, where the poisoning
  // arrives via the real ambient environment, not a hand-built object), now stripped
  // before the spawn.
  const savedGitDir = process.env.GIT_DIR;
  try {
    process.env.GIT_DIR = path.join(poisonedRepo, '.git');
    const guardedEnv = gitEnv(path.dirname(fixtureDir));
    assert.equal(guardedEnv.GIT_DIR, undefined, 'gitEnv() must have stripped the poisoned GIT_DIR before this assertion even runs');
    const goodInit = spawnSync('git', ['init', '-q', '.'], { cwd: fixtureDir, encoding: 'utf8', env: guardedEnv });
    assert.equal(goodInit.status, 0, `the guarded init must succeed -- ${goodInit.stderr}`);
    assert.equal(fs.existsSync(path.join(fixtureDir, '.git')), true, 'the guarded run creates the FIXTURE its caller actually asked for');
  } finally {
    if (savedGitDir === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = savedGitDir;
  }
});
