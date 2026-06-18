// CoalTipple conductor self-update (KIND 1) tests — node:test built-in, zero deps.
// Run: node --test scripts/lib/conductor-update.test.mjs
//
// Spawns the REAL conductor (hooks/coaltipple-conductor.js) with a sandboxed HOME so
// the real ~/.claude update stamp + global config can never affect the test, and
// CLAUDE_CONFIG_DIR is cleared so it cannot redirect the base dir away from the
// sandbox. Per hooks-safety.md §7, asserts on every path:
//   - exit 0 + no stderr (Phoenix #4 / #13)
//   - each updateMode (ask/auto/remind/off) injects the right KIND-1 directive (or none)
//   - the persistent stamp throttles: due fires + writes the stamp; not-due is silent + untouched
//   - boundary at EXACTLY updateCheckDays (>= days = due)
//   - the stamp is written on a fire, never written / never touched when not due, never in off
//   - a corrupt stamp self-heals (treated as due, overwritten)
//   - the routing off-switches (enableRouting:false, mode:"off") suppress self-update too
//   - the self-update directive lands ONLY on SessionStart, never on the UserPromptSubmit forcer
//
// CT stores BOTH the global config and the stamp under <home>/.claude (claudeBaseDir),
// so config is written to the sandbox home's global location and the stamp is read
// from the same place — the project config layer is left untouched (no .git anchor).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'hooks', 'coaltipple-conductor.js');
const STAMP_REL = path.join('.claude', '.coaltipple-update-check');

// Sandbox HOME: <home>/.claude is both the global config dir and the stamp dir.
// CLAUDE_CONFIG_DIR is DELETED so it can never redirect claudeBaseDir off the sandbox.
function run(input, home, cwd = home) {
  const stdin = typeof input === 'string' ? input : JSON.stringify(input);
  const env = { ...process.env, USERPROFILE: home, HOME: home };
  delete env.CLAUDE_CONFIG_DIR;
  return spawnSync(process.execPath, [HOOK], { input: stdin, cwd, env, encoding: 'utf8', timeout: 20000 });
}

// A sandbox home, optionally seeding the GLOBAL .coaltipple.json with `cfg`.
function mkHome(cfg) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-upd-'));
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  if (cfg !== undefined) {
    fs.writeFileSync(path.join(home, '.claude', '.coaltipple.json'), JSON.stringify(cfg), 'utf8');
  }
  return home;
}

function isoDaysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function readStamp(home) {
  try { return fs.readFileSync(path.join(home, STAMP_REL), 'utf8').trim(); } catch { return null; }
}
function writeStamp(home, iso) {
  const dir = path.join(home, '.claude');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.coaltipple-update-check'), iso, 'utf8');
}
const SESSION = { hook_event_name: 'SessionStart' };

test('default (no config): KIND-1 ask directive fires when no stamp, and the stamp is written', () => {
  const home = mkHome(); // no .coaltipple.json -> updateMode defaults to ask
  try {
    assert.equal(readStamp(home), null, 'precondition: no stamp');
    const r = run(SESSION, home);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '', 'no stderr (Phoenix #13)');
    assert.match(r.stdout, /\[CoalTipple\].*routing active/, 'base contract still injects');
    assert.match(r.stdout, /CoalTipple self-update \(ask/, 'ask directive present when due');
    assert.equal(readStamp(home), todayISO(), 'stamp written to today after firing');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('ask is throttled: a fresh stamp (today) suppresses the KIND-1 directive', () => {
  const home = mkHome({ updateMode: 'ask', updateCheckDays: 14 });
  try {
    writeStamp(home, todayISO());
    const r = run(SESSION, home);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /\[CoalTipple\].*routing active/, 'base contract still injects');
    assert.doesNotMatch(r.stdout, /CoalTipple self-update \(ask/, 'not due -> no KIND-1 directive');
    assert.equal(readStamp(home), todayISO(), 'stamp unchanged (not rewritten when not due)');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('ask is due again once updateCheckDays has elapsed (stamp older than the window)', () => {
  const home = mkHome({ updateMode: 'ask', updateCheckDays: 14 });
  try {
    writeStamp(home, isoDaysAgo(20)); // 20 >= 14 -> due
    const r = run(SESSION, home);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /CoalTipple self-update \(ask/, 'elapsed window -> directive fires');
    assert.equal(readStamp(home), todayISO(), 'stamp refreshed to today');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('ask fires at EXACTLY updateCheckDays (boundary: days === updateCheckDays is due)', () => {
  const home = mkHome({ updateMode: 'ask', updateCheckDays: 14 });
  try {
    writeStamp(home, isoDaysAgo(14)); // 14 >= 14 -> due (inclusive boundary)
    const r = run(SESSION, home);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /CoalTipple self-update \(ask/, 'exactly the window -> due');
    assert.equal(readStamp(home), todayISO(), 'stamp refreshed at the boundary');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('ask stays silent one day before the window closes (days < updateCheckDays)', () => {
  const home = mkHome({ updateMode: 'ask', updateCheckDays: 14 });
  try {
    writeStamp(home, isoDaysAgo(13)); // 13 < 14 -> not due
    const r = run(SESSION, home);
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stdout, /CoalTipple self-update \(ask/, '13 days < 14 -> not due');
    assert.equal(readStamp(home), isoDaysAgo(13), 'stamp untouched');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('auto mode (due): injects the standing-consent check directive and writes the stamp', () => {
  const home = mkHome({ updateMode: 'auto' });
  try {
    const r = run(SESSION, home);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /standing consent/, 'auto directive present');
    assert.match(r.stdout, /\/coaltipple:update/, 'auto points at the update procedure');
    assert.equal(readStamp(home), todayISO(), 'stamp written');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('remind mode (due): injects the free reminder line, names the manual command, interpolates the window', () => {
  const home = mkHome({ updateMode: 'remind', updateCheckDays: 30 });
  try {
    const r = run(SESSION, home);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /self-update reminder/, 'remind line present');
    assert.match(r.stdout, /claude plugin update coaltipple@coaltipple/, 'remind names the manual command');
    assert.match(r.stdout, /~30d/, 'remind interpolates updateCheckDays');
    assert.equal(readStamp(home), todayISO(), 'stamp written');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('off mode: no KIND-1 directive of any kind, and the stamp is NEVER written', () => {
  const home = mkHome({ updateMode: 'off' });
  try {
    const r = run(SESSION, home);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /\[CoalTipple\].*routing active/, 'base contract still injects (routing is on)');
    assert.doesNotMatch(r.stdout, /self-update/, 'no self-update directive in off mode');
    assert.equal(readStamp(home), null, 'off must not create the stamp');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('enableRouting:false silences everything, including self-update + the stamp', () => {
  const home = mkHome({ enableRouting: false, updateMode: 'auto' });
  try {
    const r = run(SESSION, home);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '', 'disabled conductor emits nothing at all');
    assert.equal(readStamp(home), null, 'no stamp when the conductor short-circuits');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('mode:"off" (routing off) also suppresses self-update + the stamp', () => {
  const home = mkHome({ mode: 'off', updateMode: 'auto' });
  try {
    const r = run(SESSION, home);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '', 'mode:off short-circuits before self-update');
    assert.equal(readStamp(home), null, 'no stamp when routing is off');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('a corrupt stamp self-heals (treated as due) and is overwritten with a valid date', () => {
  const home = mkHome({ updateMode: 'ask' });
  try {
    writeStamp(home, 'not-a-date');
    const r = run(SESSION, home);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /CoalTipple self-update \(ask/, 'unparseable stamp -> due');
    assert.equal(readStamp(home), todayISO(), 'corrupt stamp overwritten with today');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('the self-update directive lands ONLY on SessionStart, never on the UserPromptSubmit forcer', () => {
  const home = mkHome({ updateMode: 'auto' }); // auto + no stamp = due, so it WOULD fire on SessionStart
  try {
    const r = run({ hook_event_name: 'UserPromptSubmit', prompt: 'list the files' }, home);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Route BEFORE acting/, 'the per-prompt forcer still fires');
    assert.doesNotMatch(r.stdout, /self-update/, 'no self-update directive on the prompt path');
    assert.equal(readStamp(home), null, 'the forcer path never touches the update stamp');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
