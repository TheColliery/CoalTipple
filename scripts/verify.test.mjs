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
function mkGitSandbox() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-verify-nonlocal-'));
  for (const item of VERIFY_ITEMS) fs.cpSync(path.join(repo, item), path.join(tmp, item), { recursive: true });
  for (const f of ['README.md', 'SECURITY.md', 'CONTRIBUTING.md', 'PRIVACY.md', '.gitignore']) {
    fs.copyFileSync(path.join(repo, f), path.join(tmp, f));
  }
  const git = (args) => {
    const r = spawnSync('git', args, { cwd: tmp, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.error?.message}`);
    return r.stdout;
  };
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@test.invalid']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'baseline']);
  return { tmp, git };
}

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

    const git = (args) => {
      const r = spawnSync('git', args, { cwd: tmp, encoding: 'utf8' });
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
    const bare = spawnSync('git', ['check-ignore', '--stdin'], { cwd: tmp, encoding: 'utf8', input: 'totally-fake-root/\n' });
    assert.equal(bare.status, 0,
      'RED: the bare feed must reproduce the false match on THIS fixture -- an absent, un-patterned root reported ignored');
    const probed = spawnSync('git', ['check-ignore', '--stdin'], { cwd: tmp, encoding: 'utf8', input: 'totally-fake-root/.pointer-check-probe\n' });
    assert.equal(probed.status, 1, 'the injection-site feed correctly reports the SAME root as NOT ignored');
    const verbose = spawnSync('git', ['check-ignore', '-v', '--stdin'], { cwd: tmp, encoding: 'utf8', input: 'totally-fake-root/\n' });
    assert.match(verbose.stdout, /\.gitignore:2:/,
      'the matching pattern must be the lone-CR line (line 2), naming the source unambiguously');

    // CONTROL: a genuinely-ignored root still matches under BOTH feeds -- the probe loses
    // no true positive.
    assert.equal(spawnSync('git', ['check-ignore', '--stdin'], { cwd: tmp, encoding: 'utf8', input: 'dogfood/\n' }).status, 0);
    assert.equal(spawnSync('git', ['check-ignore', '--stdin'], { cwd: tmp, encoding: 'utf8', input: 'dogfood/.pointer-check-probe\n' }).status, 0);

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
    const needle = "spawnSync('git', ['check-ignore', '--stdin'], { cwd: repo, encoding: 'utf8', input })";
    assert.ok(src.includes(needle), 'the check-ignore spawn line moved -- update this test\'s patch target');
    fs.writeFileSync(verifyPath, src.replace(needle,
      "spawnSync('git', ['check-ignore', '--stdin', '--bogus-flag-xyz'], { cwd: repo, encoding: 'utf8', input })"), 'utf8');

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
