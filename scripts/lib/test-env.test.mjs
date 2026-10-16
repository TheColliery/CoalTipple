// 15b item 5 (a): every hook or CLI spawn in this room's tests runs under sandboxEnv (hooks-safety.md section 7).
// Two legs: the helper itself (a child sees the sandbox and none of the host variables), and a source guard that names the test
// files owning such spawns and fails when one stops using the helper or builds the env inline again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sandboxEnv } from './test-env.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

test('sandboxEnv: a child sees the sandbox for HOME, USERPROFILE, TEMP, TMP and TMPDIR and none of the host variables', (t) => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'ct-testenv-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const planted = { CLAUDE_CONFIG_DIR: 'x', CLAUDE_PROJECT_DIR: 'x', CLAUDE_PLUGIN_ROOT: 'x', CLAUDE_PLUGIN_DATA: 'x' };
  const saved = {};
  for (const k of Object.keys(planted)) { saved[k] = process.env[k]; process.env[k] = planted[k]; }
  let env;
  try { env = sandboxEnv(dir); } finally { for (const k of Object.keys(planted)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
  const probe = 'process.stdout.write(JSON.stringify(["HOME","USERPROFILE","TEMP","TMP","TMPDIR","CLAUDE_CONFIG_DIR","CLAUDE_PROJECT_DIR","CLAUDE_PLUGIN_ROOT","CLAUDE_PLUGIN_DATA"].map((k) => process.env[k] ?? null)))';
  const r = spawnSync(process.execPath, ['-e', probe], { env, encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [dir, dir, dir, dir, dir, null, null, null, null]);
});

test('sandboxEnv: extra keys win, so a test that needs its own CLAUDE_CONFIG_DIR can pass it', () => {
  assert.equal(sandboxEnv('/d', { CLAUDE_CONFIG_DIR: '/cfg' }).CLAUDE_CONFIG_DIR, '/cfg');
});

const OWNERS = ['project-links', 'conductor', 'conductor-update', 'install', 'configure', 'grade-task'].map((n) => `${n}.test.mjs`);
for (const file of OWNERS) {
  test(`${file}: its hook and CLI spawns use sandboxEnv and build no inline process.env copy with HOME`, () => {
    const src = fs.readFileSync(path.join(HERE, file), 'utf8');
    assert.match(src, /sandboxEnv\(/, `${file} must build its spawn env with sandboxEnv`);
    assert.doesNotMatch(src, /\.\.\.process\.env,\s*(USERPROFILE|HOME)\b/, `${file} still builds a HOME-only env inline`);
  });
}
