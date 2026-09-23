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
import { censusGitSpawns } from './git-env-census.mjs';

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
