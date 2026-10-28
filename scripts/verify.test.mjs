// Hermetic negative-path test for verify.mjs itself (scripts-quality.md §2: "the
// verify gate must have at least one automated negative-path test" -- board #64's
// plugin.json description-cap check, ported from CoalMine 13daf36, is the first
// verify.mjs sub-check this room spawns as a real CLI process rather than testing
// its underlying functions directly, so it's also the first verify.mjs integration
// test in this room). Copies the whole repo into a tmp dir (verify.mjs's own
// `repo` is derived from its OWN file location, so the copy must be self-contained)
// and spawns the real script -- never imports its internals.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitEnv } from './lib/git-env.mjs';
import { escapeRegExp } from './lib/regex-escape.mjs';
const SPAWN_TIMEOUT_MS = 30000; // every test spawn is bounded (testing.md: a finite clock); local git on a fixture repo, normally well under 5 s

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// T-G (14a): the roots verify.mjs's NO-GIT fallback treats as tracked (PC_OUR_ROOTS_FALLBACK). The fixture below has no .git, so verify.mjs resolves a citation
// against THAT set; a copy that omits one of them makes a true citation FAIL here while it passes on the real repo (a fact held in two places). The copy list is
// therefore built from the same literal, read from verify.mjs itself; an unreadable or empty literal fails the file loudly instead of narrowing the copy.
const FALLBACK_ROOTS = (() => {
  const m = /PC_OUR_ROOTS_FALLBACK = new Set\(\[([^\]]*)\]\)/.exec(fs.readFileSync(path.join(repo, 'scripts', 'verify.mjs'), 'utf8'));
  const roots = m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
  if (!roots.length) throw new Error('verify.test.mjs: cannot read PC_OUR_ROOTS_FALLBACK from verify.mjs -- update this extraction');
  return roots;
})();
const VERIFY_ITEMS = [...new Set(['skills', 'hooks', 'commands', 'platform-configs', '.claude-plugin', 'plugin', 'scripts', 'CHANGELOG.md', ...FALLBACK_ROOTS])];
// The four root docs config-keys.mjs declares as mandatory mdFiles/keyTables/
// pointer-check surfaces (README/SECURITY/CONTRIBUTING/PRIVACY) -- board #64's own
// VERIFY_ITEMS list omits them (that check never reads them), but PR24 #13 turned an
// UNREADABLE declared surface into a hard FAIL, so a "pristine copy" that is missing
// them is no longer pristine from config-keys.mjs's own point of view: it cannot tell
// this test's deliberately-narrow fixture apart from a real repo that renamed/deleted
// one of them. mkGitSandbox() below already copies the same four for the identical
// reason (its own comment); this is that same fix applied to mkSandbox().
const ROOT_DOCS = ['README.md', 'SECURITY.md', 'CONTRIBUTING.md', 'PRIVACY.md'];

function mkSandbox() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-verify-'));
  for (const item of VERIFY_ITEMS) fs.cpSync(path.join(repo, item), path.join(tmp, item), { recursive: true });
  for (const f of ROOT_DOCS) fs.copyFileSync(path.join(repo, f), path.join(tmp, f));
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

// 29a: a value the gate prints from a file a contributor controls must not be able to start an output line of its own. The planted words
// are neutral on purpose: the leg asserts on the SHAPE of the output (a line that begins with the planted text), not on a spoofed verdict.
const PLANT = 'FAIL planted line';
const startsAPlantedLine = (out) => out.split('\n').some((l) => l.replace(/^ +/, '').startsWith(PLANT));
function verifyWithPlugin(mutate) {
  const tmp = mkSandbox();
  try {
    const p = path.join(tmp, '.claude-plugin', 'plugin.json');
    const pj = JSON.parse(fs.readFileSync(p, 'utf8'));
    mutate(pj);
    fs.writeFileSync(p, JSON.stringify(pj, null, 2) + '\n', 'utf8');
    return runVerify(tmp);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

test('verify.mjs: a plugin.json name holding a line break never starts an output line (29a)', () => {
  const r = verifyWithPlugin((pj) => { pj.name = 'coaltipple\n  ' + PLANT; });
  assert.equal(r.status, 1, r.stdout);
  assert.equal(startsAPlantedLine(r.stdout), false, `a raw line break from the value reached the output:\n${r.stdout}`);
  assert.ok(r.stdout.includes('plugin.json name = ' + JSON.stringify('coaltipple\n  ' + PLANT)), 'the value is printed as one JSON string');
});

test('verify.mjs: a plugin.json version holding a line break never starts an output line (29a)', () => {
  const r = verifyWithPlugin((pj) => { pj.version = '9.9.9\n  ' + PLANT; });
  assert.equal(r.status, 1, r.stdout);
  assert.equal(startsAPlantedLine(r.stdout), false, `a raw line break from the value reached the output:\n${r.stdout}`);
  assert.ok(r.stdout.includes('plugin.json version ' + JSON.stringify('9.9.9\n  ' + PLANT) + ' not semver'), 'the value is printed as one JSON string');
});

test('verify.mjs: a factory config key holding a line break never starts an output line (29a)', () => {
  const tmp = mkSandbox();
  try {
    const p = path.join(tmp, 'platform-configs', '.coaltipple.json');
    const text = fs.readFileSync(p, 'utf8');
    const key = JSON.stringify('zz\n  ' + PLANT);
    fs.writeFileSync(p, text.replace('{', '{\n  ' + key + ': 1,'), 'utf8');
    const r = runVerify(tmp);
    assert.equal(r.status, 1, r.stdout);
    assert.equal(startsAPlantedLine(r.stdout), false, `a raw line break from the key reached the output:\n${r.stdout}`);
    assert.ok(r.stdout.includes('key ' + key + ' not in schema'), 'the key is printed as one JSON string');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('verify.mjs: a plugin.json that fails to parse with a line break in its quoted text never starts an output line (29a)', () => {
  const tmp = mkSandbox();
  try {
    // JSON.parse quotes the start of a text that opens with a bad token, line break included.
    fs.writeFileSync(path.join(tmp, '.claude-plugin', 'plugin.json'), '\n' + PLANT + '}', 'utf8');
    const r = runVerify(tmp);
    assert.equal(r.status, 1, r.stdout);
    assert.equal(startsAPlantedLine(r.stdout), false, `a raw line break from the parse error reached the output:\n${r.stdout}`);
    assert.match(r.stdout, /plugin manifest: .*\\n/, 'the parse error is on one line with its break written out');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// 29a bounce 1 (L-1): a terminal control, a C1 control or a Unicode line separator in a printed value must not reach the output raw either. Every character
// is built from its code, never typed, so this file holds no raw control. JSON.stringify leaves C1 and U+2028 raw; flat() writes them out as visible escapes.
test('verify.mjs: a planted ESC, C1 control and U+2028 in a printed value or a parse error never reach the output raw (29a bounce 1)', () => {
  const ESC = String.fromCharCode(0x1b);
  const CSI = String.fromCharCode(0x9b);
  const LS = String.fromCharCode(0x2028);
  const planted = 'coaltipple' + ESC + '[2K' + CSI + 'x' + LS + 'y';
  const named = verifyWithPlugin((pj) => { pj.name = planted; });
  const raw = (out) => [ESC, CSI, LS].filter((c) => out.includes(c)).map((c) => c.charCodeAt(0).toString(16));
  assert.equal(named.status, 1, named.stdout);
  assert.deepEqual(raw(named.stdout), [], 'the planted name reached the output with raw controls');
  assert.ok(named.stdout.includes('\\u001b') && named.stdout.includes('\\u009b') && named.stdout.includes('\\u2028'), 'the controls are written out as visible escapes');
  const tmp = mkSandbox();
  try {
    fs.writeFileSync(path.join(tmp, '.claude-plugin', 'plugin.json'), ESC + '[2K' + CSI + LS + 'x}', 'utf8'); // JSON.parse quotes the start of this text in its message
    const parsed = runVerify(tmp);
    assert.equal(parsed.status, 1, parsed.stdout);
    assert.deepEqual(raw(parsed.stdout), [], 'the parse error reached the output with raw controls');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('verify.mjs pointer-check pass line: the printed surface count matches the ACTUAL walked set (CWK-078, CoalHearth-class -- a typed number the instrument does not produce)', () => {
  // Spawns the REAL verify.mjs against the REAL repo, no sandbox -- the pointer-check block
  // reads README/SECURITY/CONTRIBUTING/PRIVACY, none of which VERIFY_ITEMS above copies (that
  // list exists for board #64's narrower check), so a synthetic copy would need to duplicate
  // pointer-check's own surface roster just to test it -- a maintenance burden this test
  // avoids by using the live tree main already runs against.
  const run = spawnSync(process.execPath, [path.join(repo, 'scripts', 'verify.mjs')], { encoding: 'utf8', timeout: 60000, cwd: repo });
  assert.equal(run.status, 0, `verify.mjs must PASS on the real repo, got:\n${run.stdout}${run.stderr}`);

  const m = run.stdout.match(/every in-scope path citation resolves or is declared \((\d+) checked, (\d+) surfaces,/);
  assert.ok(m, `pointer-check pass line not found or not in the expected shape:\n${run.stdout}`);
  const printedSurfaces = Number(m[2]);

  // Independently recompute the expected surface count from the SAME live tree, by the SAME
  // rule verify.mjs's own pcSurfaces array uses (SKILL.md · every references/*.md ·
  // every commands/*.md · the 4 fixed root docs · CHANGELOG.md) -- never import verify.mjs's
  // internals or re-run its walk; a fresh, independent count is what actually catches a
  // typed literal silently drifting from the real array.
  const refsCount = fs.readdirSync(path.join(repo, 'skills', 'coaltipple', 'references')).filter((f) => f.endsWith('.md')).length;
  const commandsCount = fs.readdirSync(path.join(repo, 'commands')).filter((f) => f.endsWith('.md')).length;
  const expectedSurfaces = 1 /* SKILL.md */ + refsCount + commandsCount + 4 /* README/SECURITY/CONTRIBUTING/PRIVACY */ + 1 /* CHANGELOG.md */;

  assert.equal(printedSurfaces, expectedSurfaces,
    `pointer-check pass line printed ${printedSurfaces} surfaces but the live tree has ${expectedSurfaces} -- a typed/stale number in the pass line, the exact CWK-078 defect this test exists to catch`);
});

// CWK-079 -- `looksPathShaped()` gates DISCOVERY of a candidate ROOT, never JUDGEMENT of
// a token already reaching checkPointers. Ported from CoalMine's own two-plant pin
// (findings-back MEDIUM-2). Needs its own git-initialised sandbox (VERIFY_ITEMS above
// omits README/SECURITY/CONTRIBUTING/PRIVACY and .gitignore -- board #64's narrower
// scope) since the property under test is specifically about a GITIGNORED root.
// 17e (UMB3-039 practice 1): the git baseline is built ONCE per file run, lazily at the first call, and every case gets its own copy (.git included). It used to run
// git init, three config calls, add and commit for each of the five callers; the copy costs no git spawn. A case that mutates its sandbox mutates its own copy only.
let gitBaseline = null;
const gitIn = (cwd, args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS, env: gitEnv(path.dirname(cwd)) });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.error?.message}`);
  return r.stdout;
};
// 18a (LOW-1 of the 17e INSPECT): a run killed as a tree never reaches the after() above and leaves its baseline in the temp folder. Each file run therefore sweeps
// the STALE ones before it builds its own. A narrow delete (AGENTS.md DURABLE DATA): only a direct child of the realpath'd root, named with the prefix, a real
// directory by lstat (a link is never followed), whose realpath parent is the root, older than the bound, and not this run's own baseline. Anything that fails a
// check is skipped; nothing here throws. The root, clock and bound are arguments so a test points it at a sandbox root.
const BASELINE_PREFIX = 'ct-verify-baseline-';
// 30 min: a live run of this file takes ~66-102 s here (n = 5, 17e), so a second session's fresh baseline is far inside the bound and is never touched; the wave
// runner's per-file clock (scripts/lib/test-suite.mjs) bounds a live run well below it too.
const BASELINE_MAX_AGE_MS = 30 * 60 * 1000;
function sweepStaleBaselines(root, now, maxAgeMs, keep) {
  const removed = [];
  let realRoot;
  let names;
  try {
    realRoot = fs.realpathSync.native(root);
    names = fs.readdirSync(realRoot);
  } catch { return removed; /* an unreadable root is nothing to sweep */ }
  let realKeep = null;
  try { if (keep) realKeep = fs.realpathSync.native(keep); } catch { /* a missing own baseline cannot be in the way */ }
  for (const name of names) {
    if (!name.startsWith(BASELINE_PREFIX)) continue;
    try {
      const candidate = path.join(realRoot, name);
      const st = fs.lstatSync(candidate);
      if (!st.isDirectory()) continue;
      const realCandidate = fs.realpathSync.native(candidate);
      if (path.dirname(realCandidate) !== realRoot || realCandidate === realKeep) continue;
      if (now - st.mtimeMs <= maxAgeMs) continue;
      fs.rmSync(candidate, { recursive: true, force: true });
      removed.push(name);
    } catch { /* a candidate that fails any check or the delete is skipped, never thrown on */ }
  }
  return removed;
}
function gitBaselineDir() {
  if (gitBaseline) return gitBaseline;
  try { sweepStaleBaselines(os.tmpdir(), Date.now(), BASELINE_MAX_AGE_MS, gitBaseline); } catch { /* a sweep problem never fails the suite */ }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-verify-baseline-'));
  try {
    for (const item of VERIFY_ITEMS) fs.cpSync(path.join(repo, item), path.join(dir, item), { recursive: true });
    for (const f of ['README.md', 'SECURITY.md', 'CONTRIBUTING.md', 'PRIVACY.md', '.gitignore']) {
      fs.copyFileSync(path.join(repo, f), path.join(dir, f));
    }
    gitIn(dir, ['init', '-q', '-b', 'main']);
    gitIn(dir, ['config', 'user.email', 'test@test.invalid']);
    gitIn(dir, ['config', 'user.name', 'Test']);
    gitIn(dir, ['config', 'commit.gpgsign', 'false']);
    gitIn(dir, ['add', '-A']);
    gitIn(dir, ['commit', '-q', '-m', 'baseline']);
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  gitBaseline = dir;
  return dir;
}
after(() => { if (gitBaseline) fs.rmSync(gitBaseline, { recursive: true, force: true }); });
function mkGitSandbox() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-verify-nonlocal-'));
  try {
    fs.cpSync(gitBaselineDir(), tmp, { recursive: true });
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  return { tmp, git: (args) => gitIn(tmp, args) };
}

test('verify.mjs fixtures: a commit made in one git sandbox copy is absent from a second copy and from the baseline (17e)', () => {
  const a = mkGitSandbox();
  const b = mkGitSandbox();
  try {
    const base = gitBaselineDir();
    const head = (cwd) => gitIn(cwd, ['rev-parse', 'HEAD']).trim();
    const h0 = head(base);
    assert.equal(head(a.tmp), h0, 'a copy starts at the baseline commit');
    assert.equal(head(b.tmp), h0, 'a second copy starts at the baseline commit');
    fs.writeFileSync(path.join(a.tmp, 'only-in-a.txt'), 'a\n');
    a.git(['add', '-A']);
    a.git(['commit', '-q', '-m', 'only in a']);
    assert.notEqual(head(a.tmp), h0, 'the commit landed in copy a');
    assert.equal(head(b.tmp), h0, 'copy b did not move');
    assert.equal(head(base), h0, 'the baseline did not move');
    assert.equal(fs.existsSync(path.join(b.tmp, 'only-in-a.txt')), false, 'the file is absent from copy b');
    assert.equal(gitIn(b.tmp, ['ls-files', 'only-in-a.txt']).trim(), '', 'and untracked by copy b');
    assert.equal(gitIn(base, ['ls-files', 'only-in-a.txt']).trim(), '', 'and by the baseline');
  } finally {
    fs.rmSync(a.tmp, { recursive: true, force: true });
    fs.rmSync(b.tmp, { recursive: true, force: true });
  }
});

test('verify.mjs pointer check: an extensionless citation under a gitignored root is checked NON-LOCALLY, not exempt (CWK-079)', () => {
  // Plants land on SECURITY.md/CONTRIBUTING.md -- root-level surfaces whose pcSurfaces
  // entry carries `dir: ''`, deliberately NOT commands/*.md. This room's own FIX 2
  // (CWK-075, citer-relative resolution) only fires when `s.dir` is truthy; an empty dir
  // keeps this test isolated to the property under test (shape-discovery vs judgement)
  // instead of also exercising FIX 2's unrelated citer-relative join.
  const { tmp, git } = mkGitSandbox();
  try {
    // PLANT A alone: an extensionless citation under the gitignored `dogfood/` root.
    // Shape-rejected at DISCOVERY -- the fixture's own live gate must stay silent while
    // nothing else cites that root.
    fs.appendFileSync(path.join(tmp, 'SECURITY.md'), '\nNotes: `dogfood/notes`.\n');
    git(['add', '-A']);
    const alone = runVerify(tmp);
    assert.doesNotMatch(alone.stdout, /dogfood/,
      `plant A alone must stay silent -- extensionless, discovery-rejected, got:\n${alone.stdout}`);

    // PLANT B, same tree, unrelated file: a PATH-SHAPED citation under the SAME root.
    // This one alone is enough to put 'dogfood' into ignoredRoots -- and once it is
    // there, checkPointers judges EVERY token sharing that root, including plant A's.
    fs.appendFileSync(path.join(tmp, 'CONTRIBUTING.md'), '\nReference: `dogfood/readme.md`.\n');
    git(['add', '-A']);
    const both = runVerify(tmp);
    assert.match(both.stdout, /FAIL SECURITY\.md cites `dogfood\/notes`.*gitignored/,
      'plant A must now FAIL -- the extensionless citation was never exempt from the check, only from discovering its own root');
    assert.match(both.stdout, /FAIL CONTRIBUTING\.md cites `dogfood\/readme\.md`.*gitignored/,
      'plant B, the path-shaped citation that armed the root, must FAIL too');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('verify.mjs pointer check: the clean-clone proof (CWK-079) -- a citation into an absent-but-gitignored root FAILs correctly, never misattributed to the citing surface\'s own dir', () => {
  // The DEFECT this ticket closes, live: the OLD disk-walk never saw a gitignored root
  // that does not physically exist on THIS checkout -- exactly a fresh clone's normal
  // state. Proven on the REAL old/new code pair by hand before shipping (see the return);
  // this pins the property so a future regression to disk-derivation is caught by the
  // suite, not rediscovered by hand again.
  const { tmp, git } = mkGitSandbox();
  try {
    fs.appendFileSync(path.join(tmp, 'commands', 'update.md'), '\nSee `dogfood/results/run1.json` for raw data.\n');
    git(['add', '-A']);
    const r = runVerify(tmp);
    // POSIX literal, deliberately -- pcSurfaces' own label construction normalises every
    // separator to `/` (`.replace(/\\/g, '/')`, verify.mjs) before this string ever reaches
    // stdout, so the printed label is `/`-joined on every OS this suite runs on, never `\`.
    assert.match(r.stdout, /FAIL commands\/update\.md cites `dogfood\/results\/run1\.json`.*gitignored `dogfood\/`/,
      `a citation into a gitignored-but-ABSENT root must FAIL as gitignored, not silently pass and not be misjoined onto commands/'s own dir, got:\n${r.stdout}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// CWK-090 fix (b) -- the injection-site probe (`root/.pointer-check-probe`), ported from
// CoalMine's own port (scratchpad/r31-crlf-measurement.md + scripts/lib/render.test.mjs,
// re-aimed there after its FIRST fixture -- a merely-CRLF-terminated .gitignore PATTERN
// line -- did not reproduce on this box/git version. The shape that DOES: a line whose
// ENTIRE CONTENT is a lone CR, a "blank" line carrying a stray carriage return, false-
// matches an ABSENT, un-patterned root under the bare `first + '/'` feed. MEASURED HERE
// BEFORE PORTING (per the r31 order): this room's own tracked `.gitignore` carries ZERO CR
// bytes in the worktree and the blob, `.gitattributes` pins `eol: lf`, and the exposure
// probe `git check-ignore -q "nonsense-xyz/"` exits 1 -- this fixes NOTHING live here
// today, and the red case below is therefore a CRLF FIXTURE, never this tree.
test('verify.mjs pointer check: FIX 2 -- the lone-CR .gitignore line false-matches an absent root under the bare feed; the injection-site feed and the real gate are immune (CWK-090)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-verify-lonecr-'));
  try {
    for (const item of VERIFY_ITEMS) fs.cpSync(path.join(repo, item), path.join(tmp, item), { recursive: true });
    for (const f of ['README.md', 'SECURITY.md', 'CONTRIBUTING.md', 'PRIVACY.md']) {
      fs.copyFileSync(path.join(repo, f), path.join(tmp, f));
    }
    // A real pattern (`dogfood/`, this room's own genuinely-ignored root -- see .gitignore)
    // so a control still exists, PLUS a lone-CR blank line -- the shape that actually
    // false-matches. Raw bytes, not a JS template string, so the CR survives untouched
    // through core.autocrlf's smudge filter on checkout.
    fs.writeFileSync(path.join(tmp, '.gitignore'), Buffer.from('dogfood/\r\n\r\n', 'binary'));
    // A citation to a root ABSENT from disk and named by no pattern -- the reproducing
    // shape (see the header comment). Planted on a root-level surface (`dir: ''`), never
    // commands/*.md, so this stays isolated from FIX 2's OWN citer-relative join.
    fs.appendFileSync(path.join(tmp, 'SECURITY.md'), '\nSee `totally-fake-root/notes.md` for details.\n');

    const gitTmpEnv = gitEnv(path.dirname(tmp));
    const git = (args) => {
      const r = spawnSync('git', args, { cwd: tmp, encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS, env: gitTmpEnv });
      if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.error?.message}`);
      return r.stdout;
    };
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 'test@test.invalid']);
    git(['config', 'user.name', 'Test']);
    git(['config', 'commit.gpgsign', 'false']);
    git(['config', 'core.autocrlf', 'true']);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'baseline']);
    assert.ok(fs.readFileSync(path.join(tmp, '.gitignore'), 'utf8').includes('\r\n\r\n'),
      'the working-tree .gitignore must actually carry the lone-CR blank line -- the shape this fixture exists to test');
    assert.ok(!fs.existsSync(path.join(tmp, 'totally-fake-root')),
      'the probed root must be genuinely absent -- that absence is what the false match depends on');

    // THE DISCRIMINATING PAIR, at the git level, on the SAME real fixture.
    const bare = spawnSync('git', ['check-ignore', '--stdin'], { cwd: tmp, encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS, input: 'totally-fake-root/\n', env: gitTmpEnv });
    assert.equal(bare.status, 0,
      'RED: the bare feed must reproduce the false match on THIS fixture -- an absent, un-patterned root reported ignored');
    const probed = spawnSync('git', ['check-ignore', '--stdin'], { cwd: tmp, encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS, input: 'totally-fake-root/.pointer-check-probe\n', env: gitTmpEnv });
    assert.equal(probed.status, 1, 'the injection-site feed correctly reports the SAME root as NOT ignored');
    const verbose = spawnSync('git', ['check-ignore', '-v', '--stdin'], { cwd: tmp, encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS, input: 'totally-fake-root/\n', env: gitTmpEnv });
    assert.match(verbose.stdout, /\.gitignore:2:/,
      'the matching pattern must be the lone-CR line (line 2), naming the source unambiguously');

    // CONTROL: a genuinely-ignored root still matches under BOTH feeds -- the probe loses
    // no true positive.
    assert.equal(spawnSync('git', ['check-ignore', '--stdin'], { cwd: tmp, encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS, input: 'dogfood/\n', env: gitTmpEnv }).status, 0);
    assert.equal(spawnSync('git', ['check-ignore', '--stdin'], { cwd: tmp, encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS, input: 'dogfood/.pointer-check-probe\n', env: gitTmpEnv }).status, 0);

    // END-TO-END: the real gate, as fixed, must not be fooled by this fixture -- the
    // absent-root citation is silently out of scope (never even resolves), never the false
    // "gitignored" FAIL the bare feed would have produced.
    const r = runVerify(tmp);
    assert.doesNotMatch(r.stdout, /totally-fake-root.*gitignored/i,
      'the gate must never report the absent-root citation as gitignored -- the exact false FAIL the bare feed would have produced');
    assert.doesNotMatch(r.stdout, /FAIL.*totally-fake-root/,
      'the absent-root citation must not FAIL at all -- it is silently out of scope, not "gitignored" and not "does not resolve"');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// INSPECT MEDIUM-1 + MEDIUM-2 (findings-back round 2) -- one end-to-end red proof serves
// both: MEDIUM-1's mislabeled pass line, and MEDIUM-2's untested `fail` argument at the
// applyCheckIgnoreProbe call site (proving verify.mjs wires its OWN real `fail`, not a no-op
// or the wrong function -- the unit tests in pointer-check.test.mjs only prove
// applyCheckIgnoreProbe calls whatever `fail` IT is given). Needs no `.git` corruption (the
// route CWK-079 declined for cost -- corrupting `.git/index` also breaks `pcResolve`'s own
// `git ls-files`, flooding unrelated FAILs): the sandboxed verify.mjs's OWN check-ignore spawn
// line is string-patched to append an extra invalid flag before it runs, isolating the failure
// to exactly the one call site under test.
test('verify.mjs pointer check: a REAL check-ignore derivation FAILURE reddens the gate AND the pass line stops claiming git-derived (INSPECT MEDIUM-1/MEDIUM-2)', () => {
  const { tmp } = mkGitSandbox();
  try {
    const verifyPath = path.join(tmp, 'scripts', 'verify.mjs');
    const src = fs.readFileSync(verifyPath, 'utf8');
    const needle = "spawnSync('git', ['check-ignore', '--stdin'], { cwd: repo, encoding: 'utf8', input, env: REPO_GIT_ENV })";
    assert.ok(src.includes(needle), 'the check-ignore spawn line moved -- update this test\'s patch target');
    // R7 CI-RED 3 -- the REPLACEMENT deliberately drops `input` (the `needle` above still pins
    // the real production line, which keeps it): git rejects the unknown flag and exits 129
    // before reading stdin, so a supplied `input` races git's exit and spawnSync can return
    // `error: EPIPE` (status null) instead of the 129 asserted below -- same class as the
    // pointer-check.test.mjs race removed in 82df6b4. Stdin is irrelevant to this branch.
    fs.writeFileSync(verifyPath, src.replace(needle,
      "spawnSync('git', ['check-ignore', '--stdin', '--bogus-flag-xyz'], { cwd: repo, encoding: 'utf8', env: REPO_GIT_ENV })"), 'utf8');

    const r = runVerify(tmp);
    assert.equal(r.status, 1, `a real check-ignore derivation failure must FAIL the gate, got:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /FAIL git check-ignore --stdin exited 129/,
      'the real fail() must be reached -- naming the real exit status, not a no-op fail swallowing it');
    assert.doesNotMatch(r.stdout, /git-derived, \d+ ignoredRoots\)/,
      'MEDIUM-1: the pass line must stop asserting git-derived once the derivation genuinely failed');
    assert.match(r.stdout, /DERIVATION FAILED -- see the FAIL line above/,
      'MEDIUM-1: the pass line must name the failure instead of a measured-looking count');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// CWK-133/C-4 -- verify.mjs's OWN production git spawns must never inherit an ambient
// poisoned GIT_DIR. The exact measured incident (CoalFace, r5): a linked worktree's own
// pre-commit/pre-push hook exports an absolute GIT_DIR pointing at ITS OWN repo, and a
// git spawn made from inside that hook's child process (verify.mjs, when wired as a gate)
// silently redirects onto that repo instead of the one the spawn's `cwd` actually names.
//
// Measured directly (not assumed) which of verify.mjs's OWN checks this actually breaks:
// none of its git spawns is `git init` (rev-parse/ls-files/check-ignore only), so the
// CoalFace incident's own signature (core.bare flipped to true) does not reproduce here --
// a `git ls-files` redirected onto an unrelated decoy repo just silently returns the
// DECOY's tracked files instead of throwing. The observable break in THIS gate is the
// pointer-check's own derived counts: PC_OUR_ROOTS comes from `git ls-files`, so a
// poisoned spawn derives it from the decoy's tree (which shares none of this room's real
// top-level dirs) -- every citation then falls outside PC_OUR_ROOTS and is silently
// SKIPPED rather than checked, and the pass line still prints "ok" while doing nothing.
// Reproduced directly: an unguarded run against this exact fixture+poison prints
// "(0 checked, ... 0 ourRoots -- git-derived, ...)" and still exits 0 -- a SILENTLY INERT
// gate, worse than a failing one (AGENTS.md, "a present-but-misaimed layer is worse than
// an absent one, because it reads as covered"). Reproduced with a THROWAWAY decoy repo,
// never the real umbrella or CoalTipple repo.
test('verify.mjs: an ambient poisoned GIT_DIR never redirects this gate\'s own git spawns onto the wrong repo (never silently checks 0 citations)', (t) => {
  const decoyRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-verify-decoy-'));
  t.after(() => fs.rmSync(decoyRepo, { recursive: true, force: true }));
  // Findings-back (INSPECT HIGH-1): this fixture-bookkeeping spawn must never inherit
  // ambient process.env either -- if this whole suite runs from a real linked worktree's
  // pre-commit hook (which already exports its OWN ambient GIT_DIR before this test ever
  // runs), an unguarded decoyGit() redirects onto the REAL enclosing repo instead of
  // decoyRepo, committing "decoy baseline" + decoy-marker.md onto the user's own branch.
  const decoyGit = (args) => spawnSync('git', args, { cwd: decoyRepo, encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS, env: gitEnv(path.dirname(decoyRepo)) });
  decoyGit(['init', '-q', '-b', 'main']);
  decoyGit(['config', 'user.email', 'test@test.invalid']);
  decoyGit(['config', 'user.name', 'Test']);
  decoyGit(['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(decoyRepo, 'decoy-marker.md'), 'nothing to do with CoalTipple\n');
  decoyGit(['add', '-A']);
  decoyGit(['commit', '-q', '-m', 'decoy baseline']);

  const { tmp } = mkGitSandbox();
  const savedGitDir = process.env.GIT_DIR;
  try {
    // The poison rides the AMBIENT env, matching how a real hook actually delivers it --
    // runVerify() spawns with no `env:` override, so this is what the child inherits.
    process.env.GIT_DIR = path.join(decoyRepo, '.git');
    const r = runVerify(tmp);
    assert.equal(r.status, 0, `the sandboxed gate must still PASS -- gitEnv() must not have broken its own git use, got:\n${r.stdout}${r.stderr}`);
    assert.doesNotMatch(r.stdout, /\(0 checked/,
      'the poisoned GIT_DIR must not have starved pointer-check down to zero citations checked');
    assert.doesNotMatch(r.stdout, /0 ourRoots -- git-derived/,
      'the poisoned GIT_DIR must not have derived ourRoots from the DECOY repo\'s empty tree');
    assert.match(r.stdout, /\d+ ourRoots -- git-derived/,
      'ourRoots must still be git-derived from the SANDBOX (tmp), not silently degraded to the no-git fallback');
  } finally {
    if (savedGitDir === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = savedGitDir;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// UMB-133: the config-path sync gate pins BOTH legacy segments in BOTH walk copies. A gate that
// guards one segment while the walk carries a second reads green over exactly the drift it exists
// to catch, so each (file, segment) cell is broken in turn and must FAIL by name. Asserts only the
// specific FAIL line -- never that the rest of the run is clean (the dist-sync leg is a separate concern).
for (const [file, rel] of [['config-load.mjs', ['scripts', 'lib', 'config-load.mjs']], ['coaltipple-conductor.js', ['hooks', 'coaltipple-conductor.js']]]) {
  for (const [seg, what] of [["'.claude', '.coaltipple.json'", 'LEGACY-1'], ["root, '.coaltipple.json'", 'LEGACY-2']]) {
    test(`verify.mjs config-path sync (UMB-133): ${file} losing the ${what} segment FAILs the gate by name`, () => {
      const tmp = mkSandbox();
      try {
        const target = path.join(tmp, ...rel);
        const src = fs.readFileSync(target, 'utf8');
        assert.ok(src.includes(seg), `the ${what} segment is no longer in ${file} -- update this test's patch target`);
        fs.writeFileSync(target, src.split(seg).join(seg.replace('.coaltipple.json', '.coaltipple.jsonX')), 'utf8');
        const r = runVerify(tmp);
        assert.equal(r.status, 1, 'a drifted legacy segment must FAIL the gate');
        assert.match(r.stdout, new RegExp(`FAIL ${escapeRegExp(file)} lost .*${what}.*project-config path DRIFTED`), `the FAIL line names ${file} and ${what}:\n${r.stdout}`);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  }
}

// UMB-133 bounce 1: both WRITERS take their target from the shared projectWriteTarget. install.mjs once
// derived its own from the READ walk (--reset wrote the factory template into a deprecated path), so a
// writer that stops importing the helper must FAIL the gate by name, each in turn.
for (const file of ['configure.mjs', 'install.mjs']) {
  test(`verify.mjs config-path sync (UMB-133 bounce 1): ${file} no longer importing projectWriteTarget FAILs the gate by name`, () => {
    const tmp = mkSandbox();
    try {
      const target = path.join(tmp, 'scripts', file);
      const src = fs.readFileSync(target, 'utf8');
      const mutated = src.replace(/(import\s*\{[^}]*)\bprojectWriteTarget\b/, '$1projectWriteTargetX');
      assert.notEqual(mutated, src, `the projectWriteTarget import is no longer in ${file} -- update this test's patch target`);
      fs.writeFileSync(target, mutated, 'utf8');
      const r = runVerify(tmp);
      assert.equal(r.status, 1, 'a writer that stopped importing the shared helper must FAIL the gate');
      assert.match(r.stdout, new RegExp(`FAIL ${escapeRegExp(file)} no longer imports projectWriteTarget`), `the FAIL line names ${file}:\n${r.stdout}`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
}

// E2-4 class (14a): the conductor's INLINED containment block must equal scripts/lib/contain.mjs, and both project writers must import containedProjectPath.
test('verify.mjs containment sync (14a): a drifted conductor copy of the containment block FAILs the gate by name', () => {
  const tmp = mkSandbox();
  try {
    const target = path.join(tmp, 'hooks', 'coaltipple-conductor.js');
    const src = fs.readFileSync(target, 'utf8');
    const mutated = src.replace("if (parent === cur) return null;", "if (parent === cur) return cur;"); // a weaker fail-closed branch in the hook's copy only
    assert.notEqual(mutated, src, "the patch target is no longer in the conductor's containment block -- update this test");
    fs.writeFileSync(target, mutated, 'utf8');
    const r = runVerify(tmp);
    assert.equal(r.status, 1, 'a conductor containment block that differs from contain.mjs must FAIL the gate');
    assert.match(r.stdout, /FAIL hooks\/coaltipple-conductor\.js containment block DRIFTED from scripts\/lib\/contain\.mjs/, `the FAIL line names the hook:\n${r.stdout}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
for (const file of ['configure.mjs', 'install.mjs']) {
  test(`verify.mjs containment sync (14a): ${file} no longer importing containedProjectPath FAILs the gate by name`, () => {
    const tmp = mkSandbox();
    try {
      const target = path.join(tmp, 'scripts', file);
      const src = fs.readFileSync(target, 'utf8');
      const mutated = src.replace(/(import\s*\{[^}]*)\bcontainedProjectPath\b/, '$1containedProjectPathX');
      assert.notEqual(mutated, src, `the containedProjectPath import is no longer in ${file} -- update this test's patch target`);
      fs.writeFileSync(target, mutated, 'utf8');
      const r = runVerify(tmp);
      assert.equal(r.status, 1, 'a writer that stopped importing the containment helper must FAIL the gate');
      assert.match(r.stdout, new RegExp(`FAIL ${escapeRegExp(file)} no longer imports containedProjectPath`), `the FAIL line names ${file}:\n${r.stdout}`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
}

// T-G (14a, INSPECT M-1 of the 09b round): the no-git fallback ourRoots in verify.mjs names `.github` and `.githooks`, so a TRUE tracked citation under either
// resolves against the tree. The fixture copy used to omit both, which made such a citation FAIL in the sandbox while it passes on the real repo (a fact held in
// two places: a doc-writer had to drop a real path). The copy is now built from the SAME fallback set, read from verify.mjs itself.
test('verify.mjs pointer-check (T-G): a backticked citation of a tracked .github/ file and a .githooks/ file PASSES in the no-git fixture', () => {
  const tmp = mkSandbox();
  try {
    const f = path.join(tmp, 'CONTRIBUTING.md');
    fs.appendFileSync(f, '\nCanon files: `.github/workflows/create-release.yml` and `.githooks/pre-commit`.\n');
    const r = runVerify(tmp);
    assert.equal(r.status, 0, `a true tracked citation under .github/ or .githooks/ must PASS in the fixture, got:\n${r.stdout}${r.stderr}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// T-D (e2 row 16, 15b): the git-derived roots must come from `git ls-files -z`. Without -z git QUOTES a path holding a non-ASCII byte
// (core.quotePath), so a tracked top-level directory called "dir" + e-acute derived as the quoted spelling, and the self-check that
// compares derived roots with the no-git fallback named that spelling in its FAIL line. With -z the root derives as itself.
test('verify.mjs: a tracked top-level directory with a non-ASCII name derives as itself, not as git\'s quoted spelling (T-D)', () => {
  const { tmp, git } = mkGitSandbox();
  try {
    const name = 'dir' + String.fromCharCode(0xe9);
    fs.mkdirSync(path.join(tmp, name));
    fs.writeFileSync(path.join(tmp, name, 'x.txt'), 'x\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'a non-ASCII top-level root']);
    const r = runVerify(tmp);
    const out = r.stdout + r.stderr;
    assert.ok(out.includes(`'${name}' is a tracked top-level root`), `the root must be named as itself:\n${out}`);
    assert.ok(!out.includes(String.fromCharCode(92) + '303'), `git's quoted octal spelling leaked into the derivation:\n${out}`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// 18a legs for sweepStaleBaselines(): one behaviour per test; only the link leg can skip (capability-probed, visible).
const mkSweepRoot = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-verify-sweep-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
};
const plantDir = (root, name, ageMs, now) => {
  const dir = path.join(root, name);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'marker.txt'), 'x\n');
  const when = new Date(now - ageMs);
  fs.utimesSync(dir, when, when);
  return dir;
};
const SWEEP_NOW = Date.UTC(2026, 9, 18, 12, 0, 0);

test('baseline sweep: a STALE ct-verify-baseline-* directory under the root is removed (18a)', (t) => {
  const root = mkSweepRoot(t);
  const stale = plantDir(root, BASELINE_PREFIX + 'stale', BASELINE_MAX_AGE_MS + 60000, SWEEP_NOW);
  const removed = sweepStaleBaselines(root, SWEEP_NOW, BASELINE_MAX_AGE_MS, null);
  assert.deepEqual(removed, [BASELINE_PREFIX + 'stale']);
  assert.equal(fs.existsSync(stale), false, 'the stale baseline is gone');
});

test('baseline sweep: a FRESH ct-verify-baseline-* directory (younger than the bound) is kept (18a)', (t) => {
  const root = mkSweepRoot(t);
  const fresh = plantDir(root, BASELINE_PREFIX + 'fresh', BASELINE_MAX_AGE_MS - 60000, SWEEP_NOW);
  assert.deepEqual(sweepStaleBaselines(root, SWEEP_NOW, BASELINE_MAX_AGE_MS, null), []);
  assert.equal(fs.existsSync(path.join(fresh, 'marker.txt')), true, 'a second session\'s live baseline survives');
});

test('baseline sweep: a foreign folder (another prefix), however old, is kept (18a)', (t) => {
  const root = mkSweepRoot(t);
  const foreign = plantDir(root, 'someone-elses-' + BASELINE_PREFIX, BASELINE_MAX_AGE_MS * 100, SWEEP_NOW);
  const other = plantDir(root, 'ct-verify-nonlocal-old', BASELINE_MAX_AGE_MS * 100, SWEEP_NOW);
  assert.deepEqual(sweepStaleBaselines(root, SWEEP_NOW, BASELINE_MAX_AGE_MS, null), []);
  assert.equal(fs.existsSync(foreign), true);
  assert.equal(fs.existsSync(other), true, 'the sibling fixture prefix is not this sweep\'s');
});

test('baseline sweep: a FILE named with the prefix is kept (18a)', (t) => {
  const root = mkSweepRoot(t);
  const file = path.join(root, BASELINE_PREFIX + 'file');
  fs.writeFileSync(file, 'x\n');
  const when = new Date(SWEEP_NOW - BASELINE_MAX_AGE_MS * 10);
  fs.utimesSync(file, when, when);
  assert.deepEqual(sweepStaleBaselines(root, SWEEP_NOW, BASELINE_MAX_AGE_MS, null), []);
  assert.equal(fs.existsSync(file), true);
});

test('baseline sweep: the run\'s own baseline is never removed, even when it reads stale (18a)', (t) => {
  const root = mkSweepRoot(t);
  const own = plantDir(root, BASELINE_PREFIX + 'own', BASELINE_MAX_AGE_MS * 10, SWEEP_NOW);
  assert.deepEqual(sweepStaleBaselines(root, SWEEP_NOW, BASELINE_MAX_AGE_MS, own), []);
  assert.equal(fs.existsSync(own), true);
});

test('baseline sweep: a LINK named with the prefix is not followed and its target survives (18a)', (t) => {
  const root = mkSweepRoot(t);
  const targetRoot = mkSweepRoot(t);
  const target = plantDir(targetRoot, 'precious', BASELINE_MAX_AGE_MS * 10, SWEEP_NOW);
  const link = path.join(root, BASELINE_PREFIX + 'link');
  try {
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (e) {
    t.skip('cannot create a directory link here (' + (e.code || e.message) + ')');
    return;
  }
  try { const old = new Date(SWEEP_NOW - BASELINE_MAX_AGE_MS * 10); fs.lutimesSync(link, old, old); } catch { /* the link's own age is not what the leg proves */ }
  sweepStaleBaselines(root, SWEEP_NOW, BASELINE_MAX_AGE_MS, null);
  assert.equal(fs.existsSync(path.join(target, 'marker.txt')), true, 'the link target was not deleted through the link');
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true, 'the link itself was not replaced or followed');
});
