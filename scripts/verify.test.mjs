// Hermetic negative-path test for verify.mjs itself (scripts-quality.md §2: "the
// verify gate must have at least one automated negative-path test" -- board #64's
// plugin.json description-cap check, ported from CoalMine 13daf36, is the first
// verify.mjs sub-check this room spawns as a real CLI process rather than testing
// its underlying functions directly, so it's also the first verify.mjs integration
// test in this room). Copies the whole repo into a tmp dir (verify.mjs's own
// `repo` is derived from its OWN file location, so the copy must be self-contained)
// and spawns the real script -- never imports its internals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERIFY_ITEMS = ['skills', 'hooks', 'commands', 'platform-configs', '.claude-plugin', 'plugin', 'scripts', 'CHANGELOG.md'];

function mkSandbox() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-verify-'));
  for (const item of VERIFY_ITEMS) fs.cpSync(path.join(repo, item), path.join(tmp, item), { recursive: true });
  return tmp;
}
const runVerify = (tmp) => spawnSync(process.execPath, [path.join(tmp, 'scripts', 'verify.mjs')], { encoding: 'utf8', timeout: 60000 });

test('verify.mjs negative path: an over-cap .claude-plugin/plugin.json description FAILs the gate (board #64)', () => {
  const tmp = mkSandbox();
  try {
    const clean = runVerify(tmp);
    assert.equal(clean.status, 0, `pristine copy must PASS, got:\n${clean.stdout}${clean.stderr}`);

    const pluginJsonPath = path.join(tmp, '.claude-plugin', 'plugin.json');
    const pj = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'));
    pj.description = 'x'.repeat(1100);
    fs.writeFileSync(pluginJsonPath, JSON.stringify(pj, null, 2) + '\n', 'utf8');

    const over = runVerify(tmp);
    assert.equal(over.status, 1, 'a plugin.json description over 1024 chars must FAIL with exit 1');
    assert.match(over.stdout, /\.claude-plugin\/plugin\.json: description 1100 chars exceeds the 1024-char cap/,
      'the FAIL line names the file, the exact length, and the cap');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
