// CWK-133/C-4 findings-back (INSPECT HIGH-1) -- unit tests for censusGitSpawns(), pure
// and fixture-driven so this is red-first without a repo clone.
//
// One caution baked into every RED fixture below: git-env-census.mjs itself is scanned by
// the REAL shipped gate once wired into verify.mjs, and so is THIS file (collectScriptsMjs()
// walks every scripts/**/*.mjs on disk). A fixture spelling an unguarded
// spawnSync('git', ...) as a literal, contiguous, un-commented substring with no env: would
// therefore ALSO trip the real gate against this very test file. Every RED fixture below
// builds the risky substring via a `${GIT}` template interpolation instead of a literal
// quoted 'git', which breaks that static match -- the runtime STRING VALUE
// censusGitSpawns() receives is byte-identical either way (interpolation resolves before
// the string exists), so the pure function under test cannot tell the difference; only the
// FILE'S OWN static source text (what the real census scans) differs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { censusGitSpawns, scanGitSpawns } from './git-env-census.mjs';

const GIT = 'git';

test('censusGitSpawns: an unguarded spawnSync(git, ...) with no env: is a finding (RED)', () => {
  const text = `const r = spawnSync('${GIT}', ['status'], { cwd: '.' });`;
  const findings = censusGitSpawns([{ rel: 'fixture.mjs', text }]);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /^fixture\.mjs:1 spawnSync\('git', \.\.\.\) carries no 'env:' -- must route through gitEnv\(\)/);
});

test('censusGitSpawns: an unguarded execFileSync(git, ...) with no env: is a finding (RED)', () => {
  const text = `execFileSync('${GIT}', ['rev-parse', 'HEAD'], { cwd: repo });`;
  const findings = censusGitSpawns([{ rel: 'fixture.mjs', text }]);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /^fixture\.mjs:1 execFileSync\('git', \.\.\.\) carries no 'env:'/);
});

test('censusGitSpawns: the SAME call with an explicit env: is clean (GREEN)', () => {
  const text = "const r = spawnSync('git', ['status'], { cwd: '.', env: gitEnv(root) });";
  const findings = censusGitSpawns([{ rel: 'fixture.mjs', text }]);
  assert.deepEqual(findings, []);
});

test('censusGitSpawns: env: nested inside a callback still counts -- a balanced-paren scan, never a flat substring search', () => {
  const text = "const r = spawnSync('git', ['status'], { cwd: '.', env: (() => gitEnv(root))() });";
  const findings = censusGitSpawns([{ rel: 'fixture.mjs', text }]);
  assert.deepEqual(findings, []);
});

test('censusGitSpawns: a git spawn named only inside a // line comment is never flagged', () => {
  // The leading "// " here is what the fixture is proving the census respects -- it is a
  // REAL comment marker in the fixture text handed to censusGitSpawns(), not a comment in
  // THIS test file's own source (the whole thing is one JS string literal on one line).
  const text = `// see spawnSync('${GIT}', ['status']) elsewhere for the real guarded call`;
  const findings = censusGitSpawns([{ rel: 'fixture.mjs', text }]);
  assert.deepEqual(findings, []);
});

test('censusGitSpawns: multiple lines report the correct 1-based line number', () => {
  const text = `const a = 1;\nconst b = spawnSync('${GIT}', ['status'], {});\n`;
  const findings = censusGitSpawns([{ rel: 'fixture.mjs', text }]);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /^fixture\.mjs:2 /);
});

test('censusGitSpawns: an unbalanced call (no closing paren) is reported, never crashes', () => {
  const text = `const r = spawnSync('${GIT}', ['status']`;
  const findings = censusGitSpawns([{ rel: 'fixture.mjs', text }]);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /unbalanced parens/);
});

test('censusGitSpawns: multiple files are each scanned independently', () => {
  const clean = "spawnSync('git', ['status'], { env: gitEnv(root) });";
  const dirty = `spawnSync('${GIT}', ['status'], {});`;
  const findings = censusGitSpawns([
    { rel: 'a.mjs', text: clean },
    { rel: 'b.mjs', text: dirty },
  ]);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /^b\.mjs:1 /);
});

// ---------------------------------------------------------------------------
// CWK-136 (R14) -- the census proved PRESENCE of an `env:` key, never that the env is SAFE:
// `env: process.env` passed it, and that re-opens the linked-worktree GIT_DIR hazard CWK-133
// closed (a git hook exports an absolute GIT_DIR / GIT_INDEX_FILE; a fixture that inherits it
// re-initialises the REAL repository). The next rung refuses an `env:` value whose text holds
// process.env without routing through gitEnv(). Same caution as above: every fixture builds the
// spawn via `${GIT}` so the real census does not match THIS file's own source.
// ---------------------------------------------------------------------------
const UNSAFE = /env: holds process\.env without gitEnv\(\)/;

test('CWK-136 RED: `env: process.env` on a git spawn passes the PRESENCE census but is refused as UNSAFE', () => {
  const text = `const r = spawnSync('${GIT}', ['init'], { cwd: dir, env: process.env });`;
  const findings = censusGitSpawns([{ rel: 'fixture.mjs', text }]);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /^fixture\.mjs:1 spawnSync\('git', \.\.\.\) /);
  assert.match(findings[0], UNSAFE);
});

test('CWK-136 RED: a spread of process.env with extra keys is the same hole', () => {
  const text = `execFileSync('${GIT}', ['init'], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });`;
  const findings = censusGitSpawns([{ rel: 'fixture.mjs', text }]);
  assert.equal(findings.length, 1);
  assert.match(findings[0], UNSAFE);
});

test('CWK-136 RED: gitEnv() spread AFTER process.env does NOT repair it -- a spread never deletes the GIT_* keys process.env already put there', () => {
  const text = `spawnSync('${GIT}', ['init'], { env: { ...process.env, ...gitEnv(root) } });`;
  const findings = censusGitSpawns([{ rel: 'fixture.mjs', text }]);
  assert.equal(findings.length, 1);
  assert.match(findings[0], UNSAFE);
});

test('CWK-136 GREEN: gitEnv() is the safe form, alone or spread with extra keys; process.env inside gitEnv()\'s own ARGUMENT is not the env value', () => {
  for (const env of ['gitEnv(root)', "{ ...gitEnv(root), LC_ALL: 'C' }", 'gitEnv(process.env.TMPDIR)', "{ PATH: '/usr/bin' }"]) {
    const text = `spawnSync('${GIT}', ['status'], { cwd: dir, env: ${env} });`;
    assert.deepEqual(censusGitSpawns([{ rel: 'fixture.mjs', text }]), [], `env: ${env}`);
  }
});

test('CWK-136 GREEN: process.env in ANOTHER option of the same call is not the env value (the value ends at the next top-level comma)', () => {
  const text = `spawnSync('${GIT}', ['status'], { env: gitEnv(root), cwd: process.env.HOME });`;
  assert.deepEqual(censusGitSpawns([{ rel: 'fixture.mjs', text }]), []);
});

test('CWK-136 RED: an identifier env is resolved ONE hop in the same file -- `const E = process.env; ... env: E` is refused, with the line of the SPAWN', () => {
  const text = `const E = { ...process.env, A: '1' };\nconst r = spawnSync('${GIT}', ['init'], { env: E });\n`;
  const findings = censusGitSpawns([{ rel: 'fixture.mjs', text }]);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /^fixture\.mjs:2 /);
  assert.match(findings[0], UNSAFE);
});

test('CWK-136 GREEN: an identifier env that resolves to gitEnv() is clean; one the census cannot resolve (a parameter) is not guessed at -- the named ceiling', () => {
  const resolved = `const E = gitEnv(root);\nspawnSync('${GIT}', ['status'], { env: E });`;
  assert.deepEqual(censusGitSpawns([{ rel: 'fixture.mjs', text: resolved }]), []);
  const param = `function run(env) { return spawnSync('${GIT}', ['status'], { env: env }); }`;
  assert.deepEqual(censusGitSpawns([{ rel: 'fixture.mjs', text: param }]), [], 'unresolvable: not guessed at (the ceiling is stated in git-env-census.mjs)');
});

test('CWK-136: scanGitSpawns reports what the census COVERED (files, live git spawn calls, how many carry a safe env) beside the findings', () => {
  const files = [
    { rel: 'a.mjs', text: `spawnSync('${GIT}', ['status'], { env: gitEnv(r) });\n// spawnSync('${GIT}', ['x']) is a comment\nexecFileSync('${GIT}', ['log'], { env: gitEnv(r) });` },
    { rel: 'b.mjs', text: `spawnSync('${GIT}', ['init'], { env: process.env });\nspawnSync('${GIT}', ['status'], {});` },
    { rel: 'c.mjs', text: 'const nothing = 1;' },
  ];
  const cov = scanGitSpawns(files);
  assert.equal(cov.files, 3);
  assert.equal(cov.calls, 4, 'the commented spawn is not a live call');
  assert.equal(cov.safe, 2);
  assert.equal(cov.findings.length, 2);
  assert.deepEqual(censusGitSpawns(files), cov.findings, 'censusGitSpawns stays the findings-only view of the same scan');
});
