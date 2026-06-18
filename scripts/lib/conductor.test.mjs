// Hermetic spawn test for the conductor hook (hooks-safety section 7).
// Spawns the REAL hook with fixture stdin in a sandbox cwd; asserts exit 0,
// silence except sanctioned stdout, and the right state. Run: node --test conductor.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'hooks', 'coaltipple-conductor.js');

// `home` sandboxes the GLOBAL config layer: point USERPROFILE/HOME at a throwaway
// dir so os.homedir() inside the hook resolves there, never the real machine.
function run(input, cwd, home) {
  const stdin = typeof input === 'string' ? input : JSON.stringify(input);
  const env = { ...process.env };
  if (home) { env.USERPROFILE = home; env.HOME = home; }
  return spawnSync(process.execPath, [HOOK], { input: stdin, cwd, env, encoding: 'utf8', timeout: 20000 });
}
const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ct-hook-'));
const mkHomeGlobal = (cfg) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-home-'));
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', '.coaltipple.json'), JSON.stringify(cfg));
  return home;
};

test('SessionStart -> injects the routing contract, exit 0, no stderr', () => {
  const tmp = mk();
  try {
    // home := tmp (no .claude/.coaltipple.json there) -> isolates the GLOBAL layer.
    const r = run({ hook_event_name: 'SessionStart' }, tmp, tmp);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /\[CoalTipple\].*routing active/);
    assert.equal(r.stderr, '');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('SessionStart honors cfg.language -> directive names the language + keeps the jargon rule', () => {
  const tmp = mk();
  try {
    fs.mkdirSync(path.join(tmp, '.git'));
    fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude', '.coaltipple.json'), JSON.stringify({ language: 'th' }));
    const r = run({ hook_event_name: 'SessionStart' }, tmp, tmp); // empty home -> no global layer
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Respond to the user in Thai/);
    assert.match(r.stdout, /NEVER translate technical terms/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('config cascade: global-only language directive applies when no project file', () => {
  const tmp = mk();
  const home = mkHomeGlobal({ language: 'ja' });
  try {
    const r = run({ hook_event_name: 'SessionStart' }, tmp, home);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Respond to the user in Japanese/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); }
});

test('config cascade: project overrides global (project language wins the merge)', () => {
  const tmp = mk();
  const home = mkHomeGlobal({ language: 'ja' });
  try {
    fs.mkdirSync(path.join(tmp, '.git'));
    fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude', '.coaltipple.json'), JSON.stringify({ language: 'th' }));
    const r = run({ hook_event_name: 'SessionStart' }, tmp, home);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Respond to the user in Thai/);
    assert.doesNotMatch(r.stdout, /Japanese/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); }
});

test('config cascade: a backslash value + a //-containing string still parse (conductor #12 inline stripper)', () => {
  const tmp = mk();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-home-'));
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  // The CM #12 case in the conductor's INLINE stripper: a value ending in a literal
  // backslash, plus a later string containing //. A non-string-aware stripper miscounts
  // the string boundary, JSON.parse throws, the catch returns null, and the language
  // directive silently reverts. The inline string-aware stripper must survive both.
  const fileContent = [
    '{',
    '  "winPath": "C:\\\\",',
    '  "url": "http://example.com",',
    '  "language": "th"',
    '}',
  ].join('\n');
  fs.writeFileSync(path.join(home, '.claude', '.coaltipple.json'), fileContent);
  try {
    const r = run({ hook_event_name: 'SessionStart' }, tmp, home);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Respond to the user in Thai/, 'config parsed despite the backslash + // (no silent revert)');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); }
});

test('config cascade: global enableRouting:false silences even with no project file', () => {
  const tmp = mk();
  const home = mkHomeGlobal({ enableRouting: false });
  try {
    const r = run({ hook_event_name: 'SessionStart' }, tmp, home);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); }
});

test('UserPromptSubmit with a hot keyword -> grade-5 hint that feeds grade + qualityBar', () => {
  const tmp = mk();
  try {
    const r = run({ hook_event_name: 'UserPromptSubmit', prompt: 'fix the race condition in the mutex' }, tmp);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /grade 5/);
    assert.match(r.stdout, /qualityBar/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('UserPromptSubmit always injects the routing forcer (trivial prompt: directive, no complexity hint)', () => {
  const tmp = mk();
  try {
    const r = run({ hook_event_name: 'UserPromptSubmit', prompt: 'list the readme files' }, tmp, tmp);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Route BEFORE acting/);
    assert.match(r.stdout, /SKILL\.md/);
    assert.doesNotMatch(r.stdout, /Complexity hint/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('UserPromptSubmit honors enableRouting:false -> fully silent (the always-on forcer respects the off switch)', () => {
  const tmp = mk();
  try {
    fs.mkdirSync(path.join(tmp, '.git'));
    fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude', '.coaltipple.json'), JSON.stringify({ enableRouting: false }));
    const r = run({ hook_event_name: 'UserPromptSubmit', prompt: 'fix the race condition in the mutex' }, tmp, tmp);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('enableRouting:false (project) -> fully silent', () => {
  const tmp = mk();
  try {
    fs.mkdirSync(path.join(tmp, '.git'));
    fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude', '.coaltipple.json'), JSON.stringify({ enableRouting: false }));
    const r = run({ hook_event_name: 'SessionStart' }, tmp, tmp); // empty home -> no global layer
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('garbage stdin -> exit 0, no crash, no stderr (fail-silent)', () => {
  const tmp = mk();
  try {
    const r = run('not json at all', tmp);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
