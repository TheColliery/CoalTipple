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
import { projectConfigCandidates, projectConfigPath } from './config-load.mjs';

const HOOK =path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'hooks', 'coaltipple-conductor.js');

// `home` sandboxes the GLOBAL config layer: point USERPROFILE/HOME at a throwaway
// dir so os.homedir() inside the hook resolves there, never the real machine.
function run(input, cwd, home) {
  const stdin = typeof input === 'string' ? input : JSON.stringify(input);
  const env = { ...process.env };
  if (home) { env.USERPROFILE = home; env.HOME = home; }
  delete env.CLAUDE_CONFIG_DIR;
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

test('SessionStart contract carries the deterministic multilingual sensitive-gate aid (covers Latin-script non-English too)', () => {
  const tmp = mk();
  try {
    // H9: a Latin-script non-English (Spanish/French/German/…) sensitive prompt trips NEITHER
    // an English keyword flag NOR the per-turn non-Latin-script nudge (its script is Latin, so
    // hasNonLatinScript is false). The ONLY deterministic layer that can cover it is the always-
    // emitted SessionStart contract, which must state the keyword hints are English-only and tell
    // the model to grade sensitivity by MEANING in any language.
    const r = run({ hook_event_name: 'SessionStart' }, tmp, tmp);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /English-only fast-path/, 'contract states the keyword hints are English-only');
    assert.match(r.stdout, /by MEANING in ANY language/, 'contract tells the model to grade sensitivity by meaning');
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

test('UserPromptSubmit with a hot keyword -> grade-5 hint that feeds grade + qualityBar, cue appended (signal turn)', () => {
  const tmp = mk();
  try {
    const r = run({ hook_event_name: 'UserPromptSubmit', prompt: 'fix the race condition in the mutex' }, tmp);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /grade 5/);
    assert.match(r.stdout, /qualityBar/);
    assert.match(r.stdout, /ARBITRATE/, 'a hot-keyword hint is a signal turn -> the arbitration cue must be appended');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('r35a R9: the arbitration cue HALTS unconditionally and names no absent plugin as leader', () => {
  const tmp = mk();
  try {
    const r = run({ hook_event_name: 'UserPromptSubmit', prompt: 'fix the auth token check' }, tmp);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /HALT and ask the user before acting, always/, 'stakes work must always halt, sibling present or not');
    assert.match(r.stdout, /a plugin that is not present leads nothing/, 'a CoalTipple-only user must never be told an absent plugin leads');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('r35a R9: the OLD unconditional "CoalBoard leads" / "-> CoalBoard" wording is gone', () => {
  const tmp = mk();
  try {
    const r = run({ hook_event_name: 'UserPromptSubmit', prompt: 'fix the auth token check' }, tmp);
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stdout, /Stakes -> CoalBoard leads/, 'the unconditional leader clause must not survive the wording fix');
    assert.doesNotMatch(r.stdout, /undecidable -> CoalBoard\./, 'undecidable now maps to stakes, not to naming CoalBoard directly');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('r35a R9: the emitted cue matches the head-authored sentence BYTE FOR BYTE (pinned reference for CoalBoard\'s own conformance)', () => {
  const tmp = mk();
  try {
    const r = run({ hook_event_name: 'UserPromptSubmit', prompt: 'fix the auth token check' }, tmp);
    assert.equal(r.status, 0);
    const marker = ' Triage (binds even when only ONE hook fired):';
    const idx = r.stdout.indexOf(marker);
    assert.notEqual(idx, -1, 'the cue must be present on this signal turn');
    const cue = r.stdout.slice(idx);
    const expected = ' Triage (binds even when only ONE hook fired): STAKES = your Layer-2 verdict that the TASK is stakes-domain work (security · crypto · migration · money); fired keywords of any vocabulary are Layer-1 evidence only, never the verdict, and a Layer-2 acquittal STANDS -- no keyword re-arms it. Stakes -> HALT and ask the user before acting, always; if CoalBoard is present this session (its hook fired or its skill is listed) it leads and CoalTipple, if present, is its tier-lever -- a plugin that is not present leads nothing. No stakes: CoalTipple, if present, leads only if the WORK\'s OWN size/complexity calls for delegate-down or escalate-up -- a fired grade is evidence, never the verdict -- else neither. Layer 2 genuinely undecidable -> treat it as stakes. Both conductors fired -> ARBITRATE silently by this same rule: act on one, never surface it.';
    assert.equal(cue, expected, 'the emitted cue must match the head-authored sentence byte for byte -- CoalBoard conforms to this exact text second');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('UserPromptSubmit on a signal-free turn -> the lean one-liner, no complexity hint, no arbitration cue (HOOK-LEAN)', () => {
  const tmp = mk();
  try {
    const r = run({ hook_event_name: 'UserPromptSubmit', prompt: 'list the readme files' }, tmp, tmp);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^\[CoalTipple\] Route this turn per the resident routing contract\.$/);
    assert.doesNotMatch(r.stdout, /Complexity hint/);
    assert.doesNotMatch(r.stdout, /ARBITRATE/, 'no hint and no non-Latin signal -> nothing for CoalBoard to arbitrate, cue stays out');
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

test('UserPromptSubmit: a non-English (Thai) prompt injects the generic non-English nudge + the arbitration cue (signal turn)', () => {
  const tmp = mk();
  try {
    // Thai for "scan for bugs in this code" — matches NO English keyword, so the
    // deterministic sensitive-gate backstop would vanish without this nudge.
    const r = run({ hook_event_name: 'UserPromptSubmit', prompt: 'สแกนหาบั๊กในโค้ดนี้' }, tmp, tmp);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Route this turn per the resident routing contract/); // the lean one-liner still fires
    assert.match(r.stdout, /Non-English prompt/);            // + the generic non-English nudge
    assert.match(r.stdout, /grade by MEANING/);
    assert.match(r.stdout, /ARBITRATE/, 'non-Latin script is a signal turn -> the arbitration cue must be appended');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('UserPromptSubmit: a plain English prompt does NOT get the non-English nudge or the arbitration cue (no false trigger on typographic punctuation)', () => {
  const tmp = mk();
  try {
    // Em-dash + smart quotes are English typography (General Punctuation block) -> excluded.
    const r = run({ hook_event_name: 'UserPromptSubmit', prompt: 'refactor the parser — keep it “clean”' }, tmp, tmp);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Route this turn per the resident routing contract/);
    assert.doesNotMatch(r.stdout, /Non-English prompt/);
    assert.doesNotMatch(r.stdout, /ARBITRATE/, 'no hint and no non-Latin signal -> cue stays out');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('mode:"off" short-circuits the forcer (UserPromptSubmit fully silent — routing is off)', () => {
  const tmp = mk();
  try {
    fs.mkdirSync(path.join(tmp, '.git'));
    fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude', '.coaltipple.json'), JSON.stringify({ mode: 'off' }));
    const r = run({ hook_event_name: 'UserPromptSubmit', prompt: 'fix the race condition in the mutex' }, tmp, tmp);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '', 'mode:"off" silences the forcer like enableRouting:false');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('mode:"off" also silences the SessionStart contract', () => {
  const tmp = mk();
  try {
    fs.mkdirSync(path.join(tmp, '.git'));
    fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude', '.coaltipple.json'), JSON.stringify({ mode: 'off' }));
    const r = run({ hook_event_name: 'SessionStart' }, tmp, tmp);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('mode:"auto" (default direction) still injects the forcer — only "off" silences', () => {
  const tmp = mk();
  try {
    fs.mkdirSync(path.join(tmp, '.git'));
    fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude', '.coaltipple.json'), JSON.stringify({ mode: 'auto' }));
    const r = run({ hook_event_name: 'UserPromptSubmit', prompt: 'list files' }, tmp, tmp);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Route this turn per the resident routing contract/);
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

test('safer-value-wins (hooks-safety.md §9): a project cannot escalate mode from a global off to auto -- routing stays OFF', () => {
  const tmp = mk();
  const home = mkHomeGlobal({ mode: 'off' });
  try {
    fs.mkdirSync(path.join(tmp, '.git'));
    fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude', '.coaltipple.json'), JSON.stringify({ mode: 'auto' }));
    const r = run({ hook_event_name: 'SessionStart' }, tmp, home);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '', 'a cloned-repo project config cannot silently re-enable routing the user turned off globally');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); }
});

test('safer-value-wins: a project MAY quieten mode from a global auto to off (the allowed direction, still fully silent)', () => {
  const tmp = mk();
  const home = mkHomeGlobal({ mode: 'auto' });
  try {
    fs.mkdirSync(path.join(tmp, '.git'));
    fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude', '.coaltipple.json'), JSON.stringify({ mode: 'off' }));
    const r = run({ hook_event_name: 'SessionStart' }, tmp, home);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '', 'a project-level quieten is honored');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); }
});

test('a poisoned project config (__proto__/constructor/prototype) does not crash the hook and the real key alongside it still merges', () => {
  const tmp = mk();
  const home = mkHomeGlobal({ language: 'ja' });
  try {
    fs.mkdirSync(path.join(tmp, '.git'));
    fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude', '.coaltipple.json'), '{"__proto__":{"polluted":true},"constructor":{"x":1},"prototype":{"y":2},"language":"th"}');
    const r = run({ hook_event_name: 'SessionStart' }, tmp, home);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
    assert.match(r.stdout, /Respond to the user in Thai/, 'the real project language key still merges despite the poisoned keys alongside it');
    assert.doesNotMatch(r.stdout, /Japanese/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); }
});

test('garbage stdin -> exit 0, no crash, no stderr (fail-silent)', () => {
  const tmp = mk();
  try {
    const r = run('not json at all', tmp);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('valid-but-non-object stdin (null / number / array) -> exit 0, no crash, defaults to the contract (C6 guard)', () => {
  const tmp = mk();
  try {
    // Valid JSON that is NOT a plain object. Before the C6 guard, `input` became
    // null/42/[] and `input.hook_event_name` was a null-deref (Phoenix-caught, but the
    // contract was then silently skipped). After the guard, input falls back to {} ->
    // event '' -> the non-prompt SessionStart branch injects the contract. No crash.
    for (const payload of ['null', '42', '[1,2,3]']) {
      const r = run(payload, tmp, tmp); // home := tmp -> no global config layer
      assert.equal(r.status, 0, `exit 0 for stdin ${payload}`);
      assert.equal(r.stderr, '', `no stderr for stdin ${payload}`);
      assert.match(r.stdout, /\[CoalTipple\]/, `contract injected (input fell back to {}) for stdin ${payload}`);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// UMB-133 -- the config-path unification (holes 1 + 2). The hook is the SHIPPED walk copy
// (Phoenix #9: inlined, never imports scripts/), so everything here spawns the REAL hook.
// Cleanup is registered the line after allocation (scripts-quality.md section 2).
// ---------------------------------------------------------------------------
const CANON = '.claude/coal/coaltipple.json';
// A git-anchored project holding exactly `files` ({ relPosixPath: object|string }) + a sandboxed HOME
// (optionally holding a GLOBAL config). Both registered for cleanup immediately.
function proj(t, files, globalCfg) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-umb133-'));
  const home = globalCfg ? mkHomeGlobal(globalCfg) : fs.mkdtempSync(path.join(os.tmpdir(), 'ct-umb133-home-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(dir, '.git'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
  }
  return { dir, home };
}
const session = ({ dir, home }, cwd = dir) => run({ hook_event_name: 'SessionStart' }, cwd, home);
const lines = (stdout, tag) => stdout.split('\n').filter((l) => l.startsWith(`[CoalTipple] ${tag}:`));

test('UMB-133 legacy hit: <gitroot>/.coaltipple.json (LEGACY-2) is READ and emits ONE migration line naming what was read and the canonical path', (t) => {
  const p = proj(t, { '.coaltipple.json': { language: 'th' } });
  const r = session(p);
  assert.equal(r.status, 0); assert.equal(r.stderr, '');
  assert.match(r.stdout, /Respond to the user in Thai/, 'the root file is actually READ (the incident: it never was)');
  const notice = lines(r.stdout, 'LEGACY');
  assert.equal(notice.length, 1, `exactly one LEGACY line, got: ${JSON.stringify(notice)}`);
  assert.match(notice[0], /\.coaltipple\.json/, 'names the path that was read');
  assert.ok(notice[0].includes(CANON), 'names the canonical path to move it to');
  assert.equal(lines(r.stdout, 'IGNORED').length, 0, 'a candidate is never reported as IGNORED');
});

test('UMB-133 legacy hit: .claude/.coaltipple.json (LEGACY-1) also emits the migration line', (t) => {
  const p = proj(t, { '.claude/.coaltipple.json': { language: 'ja' } });
  const r = session(p);
  assert.equal(r.status, 0); assert.equal(r.stderr, '');
  assert.match(r.stdout, /Respond to the user in Japanese/);
  const notice = lines(r.stdout, 'LEGACY');
  assert.equal(notice.length, 1);
  assert.ok(notice[0].includes('.claude/.coaltipple.json') && notice[0].includes(CANON));
});

test('UMB-133 canonical hit emits NO notice of any kind', (t) => {
  const p = proj(t, { [CANON]: { language: 'zh' } });
  const r = session(p);
  assert.equal(r.status, 0); assert.equal(r.stderr, '');
  assert.match(r.stdout, /Respond to the user in Chinese/, 'positive state effect: the canonical config was read');
  assert.equal(lines(r.stdout, 'LEGACY').length + lines(r.stdout, 'IGNORED').length, 0);
});

test('UMB-133 no project config at all emits NO notice (nothing to migrate, nothing ignored)', (t) => {
  const p = proj(t, {});
  const r = session(p);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /\[CoalTipple\] Model\/effort routing active/);
  assert.equal(lines(r.stdout, 'LEGACY').length + lines(r.stdout, 'IGNORED').length, 0);
});

// The fixed probe list, spelled out LITERALLY here (never derived from the hook) so a probe
// silently dropped from the hook goes red. Each is a plausible near-miss of the canonical path.
// <gitroot>/.coaltipple.json is deliberately ABSENT: after hole (2) it is a candidate.
const NON_CANDIDATES = [
  'coaltipple.json',
  'coal/coaltipple.json',
  '.claude/coaltipple.json',
  '.claude/coal/.coaltipple.json',
  '.agents/coaltipple.json',
  '.agents/.coaltipple.json',
  '.agents/coal/.coaltipple.json',
  '.gemini/coaltipple.json',
  '.gemini/.coaltipple.json',
  '.gemini/coal/.coaltipple.json',
];
for (const rel of NON_CANDIDATES) {
  test(`UMB-133 IGNORED: a config at the non-candidate path ${rel} is REPORTED, never silently walked past (and never applied)`, (t) => {
    const p = proj(t, { [rel]: { language: 'th' } });
    const r = session(p);
    assert.equal(r.status, 0); assert.equal(r.stderr, '');
    assert.ok(r.stdout.includes(`[CoalTipple] IGNORED: ${rel} is not a config path; canonical = ${CANON}`), `IGNORED line for ${rel} missing:\n${r.stdout}`);
    assert.doesNotMatch(r.stdout, /Respond to the user in Thai/, 'a non-candidate file is reported, NOT read');
  });
}

test('UMB-133 IGNORED reports EVERY non-candidate hit, not just the first', (t) => {
  const p = proj(t, { 'coaltipple.json': {}, '.claude/coaltipple.json': {}, '.gemini/.coaltipple.json': {} });
  const r = session(p);
  const ignored = lines(r.stdout, 'IGNORED');
  assert.equal(ignored.length, 3, `expected 3 IGNORED lines, got ${JSON.stringify(ignored)}`);
});

test('UMB-133 IGNORED co-exists with a real canonical config: the real one is read, the stray one is named', (t) => {
  const p = proj(t, { [CANON]: { language: 'zh' }, '.claude/coaltipple.json': { language: 'th' } });
  const r = session(p);
  assert.match(r.stdout, /Respond to the user in Chinese/);
  assert.doesNotMatch(r.stdout, /Respond to the user in Thai/);
  assert.equal(lines(r.stdout, 'IGNORED').length, 1);
  assert.equal(lines(r.stdout, 'LEGACY').length, 0);
});

test('UMB-133 the probe is anchored at the GIT ROOT, not the cwd: a subdir session still sees the root legacy and the root near-miss', (t) => {
  const p = proj(t, { '.coaltipple.json': { language: 'th' }, 'coal/coaltipple.json': {} });
  const sub = path.join(p.dir, 'src', 'deep');
  fs.mkdirSync(sub, { recursive: true });
  const r = session(p, sub);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Respond to the user in Thai/);
  assert.equal(lines(r.stdout, 'LEGACY').length, 1);
  assert.equal(lines(r.stdout, 'IGNORED').length, 1);
});

test('UMB-133 channel: the notice is SessionStart-only -- the per-prompt UserPromptSubmit forcer never carries it', (t) => {
  const p = proj(t, { '.coaltipple.json': { language: 'th' }, 'coaltipple.json': {} });
  const r = run({ hook_event_name: 'UserPromptSubmit', prompt: 'hello' }, p.dir, p.home);
  assert.equal(r.status, 0); assert.equal(r.stderr, '');
  assert.match(r.stdout, /^\[CoalTipple\] Route this turn per the resident routing contract\./, 'the forcer still fires (positive effect)');
  assert.doesNotMatch(r.stdout, /LEGACY:|IGNORED:/);
});

test('UMB-133 the off-switch stays ABSOLUTE: routing off -> silence, even with a legacy hit and a stray non-candidate (named residual, not a regression)', (t) => {
  const p = proj(t, { '.coaltipple.json': { mode: 'off' }, 'coaltipple.json': {} });
  const r = session(p);
  assert.equal(r.status, 0); assert.equal(r.stderr, '');
  assert.equal(r.stdout, '', 'a user who silenced the conductor is not re-armed by this unit');
  // control: same project WITHOUT mode:off DOES speak, so the silence above is the switch and not a broken probe
  const c = proj(t, { '.coaltipple.json': { language: 'th' }, 'coaltipple.json': {} });
  assert.match(session(c).stdout, /LEGACY:/);
});

test('UMB-133 clamp-unchanged (hooks-safety section 9): a root-legacy updateMode:auto cannot escalate past a global updateMode:off', (t) => {
  const p = proj(t, { '.coaltipple.json': { updateMode: 'auto', language: 'th' } }, { updateMode: 'off' });
  const r = session(p);
  assert.equal(r.status, 0); assert.equal(r.stderr, '');
  assert.match(r.stdout, /Respond to the user in Thai/, 'proves the root legacy WAS read (a non-clamped key from the same file lands)');
  assert.doesNotMatch(r.stdout, /self-update/, 'the escalation to auto was clamped to the global off -> no self-update directive');
  assert.equal(lines(r.stdout, 'LEGACY').length, 1);
});

// The two walk copies (this hook, config-load.mjs) must agree on WHICH FILE WINS -- not just on the
// presence of two path segments. Each candidate carries a DISTINCT language; for every pair the
// hook must read the earlier candidate's language, and config-load must resolve the same file.
const LANG_OF = ['th', 'ja', 'zh', 'es', 'en'];
const LANG_NAME_OF = { th: 'Thai', ja: 'Japanese', zh: 'Chinese', es: 'Spanish', en: 'English' };
test('UMB-133 walk equivalence: for EVERY candidate alone and EVERY pair of the five, the hook reads the SAME winner config-load resolves', (t) => {
  const p = proj(t, {});
  const cands = projectConfigCandidates(p.dir);
  assert.equal(cands.length, 5, 'canonical x3 + LEGACY-1 + LEGACY-2');
  // Singles FIRST: a pair never exposes a candidate MISSING from the hook's walk when it is the
  // LATER of the two (the earlier one just wins) -- only "this file alone" does.
  for (let k = 0; k < cands.length; k++) {
    fs.mkdirSync(path.dirname(cands[k]), { recursive: true });
    fs.writeFileSync(cands[k], JSON.stringify({ language: LANG_OF[k] }), 'utf8');
    assert.equal(projectConfigPath(p.dir), cands[k], `config-load resolves candidate ${k} alone`);
    assert.match(session(p).stdout, new RegExp(`Respond to the user in ${LANG_NAME_OF[LANG_OF[k]]}`), `hook must read candidate ${k} (${path.relative(p.dir, cands[k])}) alone`);
    fs.rmSync(cands[k], { force: true });
  }
  for (let i = 0; i < cands.length; i++) {
    for (let j = i + 1; j < cands.length; j++) {
      for (const k of [i, j]) { fs.mkdirSync(path.dirname(cands[k]), { recursive: true }); fs.writeFileSync(cands[k], JSON.stringify({ language: LANG_OF[k] }), 'utf8'); }
      assert.equal(projectConfigPath(p.dir), cands[i], `config-load: candidate ${i} beats ${j}`);
      const r = session(p);
      assert.match(r.stdout, new RegExp(`Respond to the user in ${LANG_NAME_OF[LANG_OF[i]]}`), `hook: candidate ${i} (${path.relative(p.dir, cands[i])}) must beat ${j}`);
      for (const k of [i, j]) fs.rmSync(cands[k], { force: true });
    }
  }
});

// ---------------------------------------------------------------------------
// BOUNCE 1-3 / UMB-174(b) -- an EXISTING config that could not be turned into a
// config (malformed JSON / a directory / unreadable / not a JSON object) is now
// NAMED with its reason, never silently treated the same as an absent file. Each
// test targets the CANONICAL path (CANON) so the UNREADABLE branch fires rather
// than the LEGACY one -- the precedence between them is covered separately below.
// ---------------------------------------------------------------------------
test('UMB-174(b) UNREADABLE: malformed JSON at the winning candidate is named by reason, not silently treated as absent', (t) => {
  const p = proj(t, { [CANON]: '{ this is not json' });
  const r = session(p);
  assert.equal(r.status, 0); assert.equal(r.stderr, '');
  const notice = lines(r.stdout, 'UNREADABLE');
  assert.equal(notice.length, 1, `expected one UNREADABLE line, got: ${JSON.stringify(notice)}`);
  assert.ok(notice[0].includes(CANON) && notice[0].includes('malformed JSON') && notice[0].includes(`canonical = ${CANON}`), notice[0]);
});

test('UMB-174(b) UNREADABLE: the winning candidate path is a DIRECTORY (EISDIR), never crashes the hook', (t) => {
  const p = proj(t, {});
  const target = path.join(p.dir, ...CANON.split('/'));
  fs.mkdirSync(target, { recursive: true });
  const r = session(p);
  assert.equal(r.status, 0); assert.equal(r.stderr, '');
  const notice = lines(r.stdout, 'UNREADABLE');
  assert.equal(notice.length, 1);
  assert.ok(notice[0].includes('a directory'), notice[0]);
});

test('UMB-174(b) UNREADABLE: a valid JSON value that is NOT an object (an array) is named, never silently adopted', (t) => {
  const p = proj(t, { [CANON]: '[1,2,3]' });
  const r = session(p);
  assert.equal(r.status, 0); assert.equal(r.stderr, '');
  const notice = lines(r.stdout, 'UNREADABLE');
  assert.equal(notice.length, 1);
  assert.ok(notice[0].includes('not a JSON object'), notice[0]);
});

// EACCES/EPERM: capability-probed, visible skip when this box/user cannot produce a
// genuinely unreadable file (Windows chmod does not gate reads the way POSIX mode bits
// do -- confirmed by probing rather than assumed, per this room's own symlink-testing
// convention for a platform capability that a `process.platform` guess would get wrong
// in both directions).
test('UMB-174(b) UNREADABLE: an existing file this process cannot read (EACCES/EPERM) is named, never silently treated as absent', (t) => {
  const p = proj(t, { [CANON]: { mode: 'auto' } });
  const target = path.join(p.dir, ...CANON.split('/'));
  let capable;
  try {
    fs.chmodSync(target, 0o000);
    try { fs.readFileSync(target, 'utf8'); capable = false; }
    catch (e) { capable = e.code === 'EACCES' || e.code === 'EPERM'; }
  } catch { capable = false; }
  if (!capable) {
    try { fs.chmodSync(target, 0o644); } catch {}
    t.skip('cannot simulate an unreadable file on this box/user (chmod does not gate reads here) -- capability-gated, not asserting a false pass');
    return;
  }
  try {
    const r = session(p);
    assert.equal(r.status, 0); assert.equal(r.stderr, '');
    const notice = lines(r.stdout, 'UNREADABLE');
    assert.equal(notice.length, 1);
    assert.ok(notice[0].includes('unreadable'), notice[0]);
  } finally {
    try { fs.chmodSync(target, 0o644); } catch {} // restore so proj()'s cleanup can remove it
  }
});

test('UMB-174(b) a BOM-prefixed VALID config is READ and applied, never reported as unreadable -- U+FEFF is stripped before classification', (t) => {
  const p = proj(t, { [CANON]: '﻿' + JSON.stringify({ language: 'th' }) });
  const r = session(p);
  assert.equal(r.status, 0); assert.equal(r.stderr, '');
  assert.match(r.stdout, /Respond to the user in Thai/, 'the BOM-prefixed file must actually be READ and applied, not merely tolerated');
  assert.equal(lines(r.stdout, 'UNREADABLE').length, 0, 'a valid BOM-prefixed object is never reported as unreadable');
});

test('UMB-174(b) UNREADABLE takes precedence over LEGACY: a broken LEGACY-shape file is named as unreadable, never claimed to have been "read"', (t) => {
  const p = proj(t, { '.coaltipple.json': '{ this is not json' }); // LEGACY-2, deliberately malformed
  const r = session(p);
  assert.equal(r.status, 0); assert.equal(r.stderr, '');
  const unreadable = lines(r.stdout, 'UNREADABLE');
  assert.equal(unreadable.length, 1, `expected one UNREADABLE line, got: ${JSON.stringify(unreadable)}`);
  assert.ok(unreadable[0].includes('.coaltipple.json') && unreadable[0].includes('malformed JSON'), unreadable[0]);
  assert.equal(lines(r.stdout, 'LEGACY').length, 0, 'a file that failed to parse was never actually "read" -- the LEGACY line must not also claim it was');
});

test('UMB-174(b) the GLOBAL config is reported too, independently of the project side, naming ITS OWN path as canonical (no other location exists for it)', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-umb174-globalbad-'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-umb174-proj-'));
  t.after(() => { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(dir, '.git'));
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  const globalPath = path.join(home, '.claude', '.coaltipple.json');
  fs.writeFileSync(globalPath, '[1,2,3]', 'utf8'); // not a JSON object
  const r = run({ hook_event_name: 'SessionStart' }, dir, home);
  assert.equal(r.status, 0); assert.equal(r.stderr, '');
  const notice = lines(r.stdout, 'UNREADABLE');
  assert.equal(notice.length, 1, `expected one UNREADABLE line for the global config, got: ${JSON.stringify(notice)}`);
  assert.ok(notice[0].includes(globalPath) && notice[0].includes('not a JSON object'), notice[0]);
  // canonical = the SAME path -- there is nowhere else a global config could move to.
  const canonCount = (notice[0].match(new RegExp(globalPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  assert.equal(canonCount, 2, `expected globalPath to appear twice (the reported path AND its own canonical), got: ${notice[0]}`);
});

test('UMB-174(b) global and project UNREADABLE co-exist: both files broken at once are BOTH named, neither masks the other', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-umb174-both-'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-umb174-both-proj-'));
  t.after(() => { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(dir, '.git'));
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', '.coaltipple.json'), '{ bad', 'utf8');
  const canonAbs = path.join(dir, ...CANON.split('/'));
  fs.mkdirSync(path.dirname(canonAbs), { recursive: true });
  fs.writeFileSync(canonAbs, '[1,2,3]', 'utf8');
  const r = run({ hook_event_name: 'SessionStart' }, dir, home);
  assert.equal(r.status, 0); assert.equal(r.stderr, '');
  const notice = lines(r.stdout, 'UNREADABLE');
  assert.equal(notice.length, 2, `expected two UNREADABLE lines, got: ${JSON.stringify(notice)}`);
});
