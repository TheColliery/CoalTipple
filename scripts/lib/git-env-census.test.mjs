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
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { censusGitSpawns, scanGitSpawns, gitBlobId, CENSUS_EXEMPT } from './git-env-census.mjs';
import { gitEnv } from './git-env.mjs';

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

// ---------------------------------------------------------------------------
// CWK-174 (R14) -- BLOB-PINNED EXEMPTIONS for the byte-equal canon secret-scan test file. A row
// matches only while the file's git blob id equals the pin; any edit re-arms the census on it.
// ---------------------------------------------------------------------------
const ROOM = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('CWK-174: gitBlobId equals what `git hash-object` prints, and a CRLF checkout of the same text pins the same blob', () => {
  const text = 'alpha\nbeta\n';
  const viaGit = execFileSync('git', ['hash-object', '--stdin', '--no-filters'], { input: text, encoding: 'utf8', timeout: 30000, env: gitEnv(ROOM) }).trim();
  assert.equal(gitBlobId(text), viaGit);
  assert.equal(gitBlobId('alpha\r\nbeta\r\n'), viaGit, 'autocrlf must not defeat a pin');
});

test('CWK-174: an exempt file (rel + blob both match) is skipped and COUNTED; one changed byte, or the same bytes under another name, re-arms the census', () => {
  const text = `const r = execFileSync('${GIT}', ['init'], { cwd: dir });\n`;
  const rows = [{ rel: 'scripts/canon.test.mjs', blob: gitBlobId(text), why: 'fixture row' }];
  const exempt = scanGitSpawns([{ rel: 'scripts/canon.test.mjs', text }], rows);
  assert.deepEqual(exempt.findings, []);
  assert.equal(exempt.exempted, 1);
  assert.equal(exempt.calls, 0, 'an exempt file is not scanned');
  assert.equal(scanGitSpawns([{ rel: 'scripts/canon.test.mjs', text: text + '// edited\n' }], rows).findings.length, 1, 'one added line lifts the exemption');
  assert.equal(scanGitSpawns([{ rel: 'scripts/other.test.mjs', text }], rows).findings.length, 1, 'the pin names the FILE as well as the bytes');
  assert.equal(scanGitSpawns([{ rel: 'scripts/canon.test.mjs', text: text.replace(/\n/g, '\r\n') }], rows).exempted, 1, 'CRLF checkout of the same file stays exempt');
  assert.equal(censusGitSpawns([{ rel: 'scripts/canon.test.mjs', text }], []).length, 1, 'with no rows the same file is refused (the default list is only the real rows)');
});

test('CWK-174: every shipped CENSUS_EXEMPT row is LIVE (its file exists with the pinned blob) and names how it ends -- a stale row fails here, never silently', () => {
  // 08d: the shipped list is empty (the target is no pin), so the loop may run zero times; the per-row checks below
  // still bind any row a later unit adds.
  assert.ok(Array.isArray(CENSUS_EXEMPT));
  for (const row of CENSUS_EXEMPT) {
    const abs = path.join(ROOM, ...row.rel.split('/'));
    assert.ok(fs.existsSync(abs), `${row.rel}: pinned file is gone -- delete the row`);
    assert.equal(gitBlobId(fs.readFileSync(abs, 'utf8')), row.blob, `${row.rel}: the bytes changed -- re-copy from the canon or delete the row (a row never follows an edit)`);
    assert.match(row.why, /DELETE when (the canon fix lands|the census rule accepts)/);
  }
});

// R14 BOUNCE 1 (INSPECT LOW-2): withoutGitEnvCalls() matched the bare substring `gitEnv(`, so a helper
// whose name merely ENDS in gitEnv (rawgitEnv, notgitEnv) was stripped as if it were the real one and its
// process.env argument vanished with it. The call must start at a word boundary.
test('CWK-136 RED: a helper whose name only ENDS in gitEnv (rawgitEnv(process.env)) is NOT the stripping helper', () => {
  for (const name of ['rawgitEnv', 'notgitEnv', 'my_gitEnv', 'x$gitEnv']) {
    const text = `spawnSync('${GIT}', ['status'], { cwd: d, env: ${name}(process.env) });`;
    const findings = censusGitSpawns([{ rel: 'fixture.mjs', text }]);
    assert.equal(findings.length, 1, name);
    assert.match(findings[0], UNSAFE, name);
  }
});

test('CWK-136 GREEN: the real gitEnv() is still recognised at a word boundary -- after a spread, a paren, a comma, a space and a newline', () => {
  for (const env of ['{ ...gitEnv(r) }', '(gitEnv(r))', '{ a: 1, ...gitEnv(r) }', ' gitEnv(r)', '\n gitEnv(r)']) {
    const text = `spawnSync('${GIT}', ['status'], { cwd: d, env:${env} });`;
    assert.deepEqual(censusGitSpawns([{ rel: 'fixture.mjs', text }]), [], JSON.stringify(env));
  }
});

// R14 ALERT FIX (CodeQL js/incomplete-sanitization #40): the alias lookup builds a RegExp from the identifier
// text; it now goes through the one shared escape. A `$`-named alias (legal JS) resolves, one hop, to its initializer.
test('CWK-136: a $-named alias env resolves through the escaped declaration lookup (RED: `const $E = process.env; env: $E` is refused; a gitEnv() initializer is clean)', () => {
  const bad = `const $E = process.env;\nspawnSync('${GIT}', ['init'], { env: $E });\n`;
  const findings = censusGitSpawns([{ rel: 'fixture.mjs', text: bad }]);
  assert.equal(findings.length, 1);
  assert.match(findings[0], UNSAFE);
  const good = `const $E = gitEnv(root);\nspawnSync('${GIT}', ['init'], { env: $E });\n`;
  assert.deepEqual(censusGitSpawns([{ rel: 'fixture.mjs', text: good }]), []);
});

// 08c re-sync, step 3 (main's ruling UMB-456 (2)) -- the ALLOWLIST env shape. The canon release-notes.mjs reads the
// origin remote with an env built from NAMED keys (PATH, the temp and home variables, GIT_CEILING_DIRECTORIES) plus
// GIT_CONFIG_NOSYSTEM=1 and GIT_TERMINAL_PROMPT=0, passed as the shorthand `env`. That is stricter than gitEnv():
// nothing ambient but the named keys can reach the child. The census accepts exactly that shape and nothing wider.
const ALLOW_KEEP = "const keep = ['PATH', 'HOME', 'GIT_CEILING_DIRECTORIES'];";
const ALLOW_ENV = "const env = { ...Object.fromEntries(keep.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]])), GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };";
const allowFixture = (keep, env, call) => [keep, env, call].join('\n');
const SHORTHAND_CALL = `const r = spawnSync('${GIT}', ['config', '--get', 'remote.origin.url'], { encoding: 'utf8', env });`;

test('08c GREEN: the allowlist env (named keys read through process.env[k], GIT_CONFIG_NOSYSTEM=1, only the safe GIT_* names) passes, as the shorthand `env` and as `env:`', () => {
  const shorthand = allowFixture(ALLOW_KEEP, ALLOW_ENV, SHORTHAND_CALL);
  assert.deepEqual(censusGitSpawns([{ rel: 'fixture.mjs', text: shorthand }], []), []);
  const keyed = allowFixture(ALLOW_KEEP, ALLOW_ENV, SHORTHAND_CALL.replace('encoding: \'utf8\', env }', 'encoding: \'utf8\', env: env }'));
  assert.deepEqual(censusGitSpawns([{ rel: 'fixture.mjs', text: keyed }], []), []);
  const literal = `const r = spawnSync('${GIT}', ['status'], { env: { PATH: process.env.PATH, HOME: process.env.HOME, GIT_CONFIG_NOSYSTEM: '1' } });`;
  assert.deepEqual(censusGitSpawns([{ rel: 'fixture.mjs', text: literal }], []), [], 'an inline named-keys object passes too');
  const counted = scanGitSpawns([{ rel: 'fixture.mjs', text: shorthand }], []);
  assert.equal(counted.calls, 1);
  assert.equal(counted.safe, 1, 'an allowlist env is counted SAFE, not exempt');
});

test('08c RED: a planted unfiltered spread of process.env still FAILS, in every spelling, with or without GIT_CONFIG_NOSYSTEM beside it', () => {
  const spellings = [
    "const env = { ...process.env };",
    "const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1' };",
    "const env = Object.assign({}, process.env);",
    "const env = Object.assign({ GIT_CONFIG_NOSYSTEM: '1' }, process.env);",
    "const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k)));",
    "const env = { ...Object.fromEntries(Object.entries(process.env)), GIT_CONFIG_NOSYSTEM: '1' };",
    "const env = process.env;",
  ];
  for (const env of spellings) {
    const text = allowFixture(ALLOW_KEEP, env, SHORTHAND_CALL);
    const findings = censusGitSpawns([{ rel: 'fixture.mjs', text }], []);
    assert.equal(findings.length, 1, env);
  }
  const keyed = `const r = spawnSync('${GIT}', ['status'], { env: Object.assign({}, process.env) });`;
  assert.equal(censusGitSpawns([{ rel: 'fixture.mjs', text: keyed }], []).length, 1, 'the keyed form fails too');
});

test('08c RED: an allowlist env that sets or keeps a GIT_* name beyond the three safe ones, or omits GIT_CONFIG_NOSYSTEM=1, FAILS', () => {
  const bad = [
    allowFixture("const keep = ['PATH', 'GIT_DIR'];", ALLOW_ENV, SHORTHAND_CALL),
    allowFixture("const keep = ['PATH', 'git_index_file'];", ALLOW_ENV, SHORTHAND_CALL),
    allowFixture(ALLOW_KEEP, ALLOW_ENV.replace("GIT_TERMINAL_PROMPT: '0'", "GIT_WORK_TREE: 'x'"), SHORTHAND_CALL),
    allowFixture(ALLOW_KEEP, "const env = { ...Object.fromEntries(keep.map((k) => [k, process.env[k]])), GIT_TERMINAL_PROMPT: '0' };", SHORTHAND_CALL),
    allowFixture(ALLOW_KEEP, "const env = { ...Object.fromEntries(keep.map((k) => [k, process.env[k]])), GIT_CONFIG_NOSYSTEM: '0' };", SHORTHAND_CALL),
    `const r = spawnSync('${GIT}', ['status'], { env: { PATH: process.env.PATH, GIT_DIR: process.env.GIT_DIR, GIT_CONFIG_NOSYSTEM: '1' } });`,
  ];
  for (const text of bad) {
    assert.equal(censusGitSpawns([{ rel: 'fixture.mjs', text }], []).length, 1, text);
  }
});

test('08c RED: a shorthand `env` the census cannot resolve (a parameter) is a finding, never guessed safe', () => {
  const text = `function run(env) { return spawnSync('${GIT}', ['status'], { encoding: 'utf8', env }); }`;
  const findings = censusGitSpawns([{ rel: 'fixture.mjs', text }], []);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /shorthand env is neither an allowlist env/, 'the message names the shorthand, not a missing env:');
});

test('08c: the canon release-notes.mjs passes the census with NO pin, and no CENSUS_EXEMPT row names it', () => {
  const text = fs.readFileSync(path.join(ROOM, 'scripts', 'release-notes.mjs'), 'utf8');
  const result = scanGitSpawns([{ rel: 'scripts/release-notes.mjs', text }], []);
  assert.deepEqual(result.findings, []);
  assert.equal(result.calls, 1);
  assert.equal(result.safe, 1);
  assert.ok(!CENSUS_EXEMPT.some((row) => row.rel === 'scripts/release-notes.mjs'), 'the pin is gone');
});

// 08c bounce 1 (INSPECT M-1, the reviewer's plants A1-A5 and A9) -- the allowlist pass trusted the FIRST `const NAME =` in the file
// and read only that initializer. So one clean `const env` made every `{ env }` in the file pass (A1, A2, A9), and a later write
// to the object (A3, A4, A5) was invisible. The pass is now refused when the name is bound more than once or as a parameter /
// destructured binding, and when the file writes to the name after its declaration.
const ALLOW_LIT = "{ PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1' }";
const spawnWith = (arg) => `spawnSync('${GIT}', ['x'], ${arg})`;
const B1_PLANTS = {
  'A1 an allowlist env in fn a(), a full copy of process.env in fn b()': `function a() { const env = ${ALLOW_LIT}; return ${spawnWith('{ env }')}; }\nfunction b() { const env = { ...process.env }; return ${spawnWith('{ env }')}; }`,
  'A2 the shorthand env is a PARAMETER, an allowlist const elsewhere': `const env = ${ALLOW_LIT};\nfunction run(env) { return ${spawnWith('{ env }')}; }`,
  'A3 env.GIT_DIR assigned after a clean literal': `const env = ${ALLOW_LIT};\nenv.GIT_DIR = '/elsewhere/.git';\n${spawnWith('{ env }')};`,
  'A4 Object.assign(env, process.env) after a clean literal': `const env = ${ALLOW_LIT};\nObject.assign(env, process.env);\n${spawnWith('{ env }')};`,
  'A5 a key loop copies every ambient key into env': `const env = ${ALLOW_LIT};\nfor (const k of Object.keys(process.env)) env[k] = process.env[k];\n${spawnWith('{ env }')};`,
  'A9 env: e2, two functions each declare e2, the first clean': `function a() { const e2 = ${ALLOW_LIT}; return ${spawnWith('{ env: e2 }')}; }\nfunction b() { const e2 = { ...process.env }; return ${spawnWith('{ env: e2 }')}; }`,
  'A9b the same, the first declaration holds no process.env at all (the older identifier hop read only the first)': `function a() { const e2 = { PATH: '/bin' }; return ${spawnWith('{ env: e2 }')}; }\nfunction b() { const e2 = { ...process.env }; return ${spawnWith('{ env: e2 }')}; }`,
};

test('08c bounce 1 RED: the reviewer plants A1, A2, A3, A4, A5 and A9, and A9b, each yield a finding (the first six passed the first allowlist rule)', () => {
  for (const [name, text] of Object.entries(B1_PLANTS)) {
    const findings = censusGitSpawns([{ rel: 'fixture.mjs', text }], []);
    assert.ok(findings.length >= 1, `${name}: the census passed it (${JSON.stringify(findings)})`);
  }
});

test('08c bounce 1 RED: a name bound as a parameter in any spelling, a destructured binding, a catch binding or a loop binding is refused', () => {
  const bound = [
    `const env = ${ALLOW_LIT};\nconst run = (a, env) => ${spawnWith('{ env }')};`,
    `const env = ${ALLOW_LIT};\nconst run = env => ${spawnWith('{ env }')};`,
    `const env = ${ALLOW_LIT};\nfunction run(a, env = {}) { return ${spawnWith('{ env }')}; }`,
    `const env = ${ALLOW_LIT};\nconst o = { run(env) { return ${spawnWith('{ env }')}; } };`,
    `const env = ${ALLOW_LIT};\ntry { x(); } catch (env) { ${spawnWith('{ env }')}; }`,
    `const { env } = opts;\n${spawnWith('{ env }')};`,
    `const [env] = list;\n${spawnWith('{ env }')};`,
    `const env = ${ALLOW_LIT};\nfor (const env of list) { ${spawnWith('{ env }')}; }`,
  ];
  for (const text of bound) assert.ok(censusGitSpawns([{ rel: 'fixture.mjs', text }], []).length >= 1, text);
});

test('08c bounce 1 RED: a write to the name after its declaration, in any spelling, is refused', () => {
  const writes = [
    "env['GIT_' + 'DIR'] = '/x';",
    "env.GIT_DIR ||= '/x';",
    "env.GIT_DIR += '/x';",
    'delete env.PATH;',
    "Object.assign(env, { GIT_DIR: '/x' });",
    "Object.defineProperty(env, 'GIT_DIR', { value: '/x' });",
    "Reflect.set(env, 'GIT_DIR', '/x');",
    "env = { ...process.env };",
    "({ env } = other);",
  ];
  for (const w of writes) {
    const text = `const env = ${ALLOW_LIT};\n${w}\n${spawnWith('{ env }')};`;
    assert.ok(censusGitSpawns([{ rel: 'fixture.mjs', text }], []).length >= 1, w);
  }
});

test('08c bounce 1 GREEN: a once-bound, never-written allowlist env still passes, beside reads of it and writes to other names', () => {
  const text = [
    `const env = ${ALLOW_LIT};`,
    'const other = {};',
    "other.GIT_DIR = 'x';",
    "envelope.X = 1; myenv[k] = 2;",
    'const copy = { ...env, extra: 1 };',
    "if (env.PATH === 'x') { console.log(Object.keys(env), env === copy); }",
    spawnWith('{ env }') + ';',
    spawnWith('{ env: env }') + ';',
  ].join('\n');
  const result = scanGitSpawns([{ rel: 'fixture.mjs', text }], []);
  assert.deepEqual(result.findings, []);
  assert.equal(result.calls, 2);
  assert.equal(result.safe, 2);
});
