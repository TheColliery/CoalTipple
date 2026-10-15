// CWK2-027 (15b item 1): every hook entry is the EXEC form (`command: "node"` + one `args` path), never a shell string.
// A shell-form string carrying ${CLAUDE_PLUGIN_ROOT} runs through PowerShell on Windows without Git for Windows, where the
// placeholder is a PowerShell variable that expands to nothing: node gets a missing script and the hook fails.
// Exec form has no shell (hooks-safety.md section 3: `command` must be a real executable on Windows, so `node`, never a shim).
// Exemplar: CoalWash scripts/hooks-exec-form.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLACEHOLDER = '${CLAUDE_PLUGIN_ROOT}';
const CONDUCTOR_ARG = `${PLACEHOLDER}/hooks/coaltipple-conductor.js`;

function entries(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'hooks', 'hooks.json'), 'utf8'));
  const out = [];
  for (const [event, groups] of Object.entries(manifest.hooks)) {
    for (const g of groups) for (const h of g.hooks) out.push({ event, h });
  }
  return out;
}

for (const [label, root] of [['source', REPO], ['dist', path.join(REPO, 'plugin')]]) {
  test(`hooks.json (${label}): both entries are exec form, node + one args path to the conductor, no shell or onFailure`, () => {
    const all = entries(root);
    assert.deepEqual(all.map((e) => e.event), ['SessionStart', 'UserPromptSubmit']);
    for (const { event, h } of all) {
      assert.equal(h.type, 'command', event);
      assert.equal(h.command, 'node', `${event}: command is the executable alone, never a shell string (got ${JSON.stringify(h.command)})`);
      assert.deepEqual(h.args, [CONDUCTOR_ARG], event);
      assert.ok(!('shell' in h), `${event}: no shell field`);
      assert.ok(!('onFailure' in h), `${event}: no onFailure (hooks-safety section 1: never block on a fail-silent hook)`);
      assert.ok(!String(h.command).includes(PLACEHOLDER), `${event}: no placeholder inside a command string`);
    }
  });
}

test('the SessionStart entry runs the way exec form runs it: no shell, node + the resolved path, exit 0, sanctioned output only', (t) => {
  const tmp = fs.realpathSync.native(os.tmpdir());
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(tmp, 'ct-execform-')));
  t.after(() => {
    assert.ok(dir.startsWith(tmp + path.sep), `refusing to remove ${dir}`);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const home = path.join(dir, 'home');
  const proj = path.join(dir, 'proj');
  fs.mkdirSync(home);
  fs.mkdirSync(proj);
  const start = entries(REPO).find((e) => e.event === 'SessionStart');
  assert.ok(start && Array.isArray(start.h.args), 'the SessionStart entry carries args (exec form)');
  const args = start.h.args.map((a) => a.split(PLACEHOLDER).join(REPO));
  const env = { ...process.env, HOME: home, USERPROFILE: home, TEMP: home, TMP: home, TMPDIR: home, CLAUDE_CONFIG_DIR: '', CLAUDE_PLUGIN_ROOT: REPO, CLAUDE_PLUGIN_DATA: '', CLAUDE_PROJECT_DIR: proj };
  delete env.NODE_TEST_CONTEXT;
  const input = JSON.stringify({ hook_event_name: 'SessionStart', session_id: 't-exec', cwd: proj });
  const r = spawnSync(start.h.command === 'node' ? process.execPath : start.h.command, args,
    { cwd: proj, env, input, encoding: 'utf8', timeout: 20000, killSignal: 'SIGKILL', windowsHide: true, shell: false });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.equal(r.stderr, '');
  assert.ok(r.stdout.includes('[CoalTipple]'), 'the conductor ran: its sanctioned context line is on stdout');
});
