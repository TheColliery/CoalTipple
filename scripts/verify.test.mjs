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
