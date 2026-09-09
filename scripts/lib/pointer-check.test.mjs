// Zero-dep unit tests for scripts/lib/pointer-check.mjs (CWK-075). Drives checkPointers
// in-memory via its resolve() callback -- no tmpdir, no real git repo needed, the module's
// whole contract is a pure function over strings and a resolver it is handed.
//
// Tests 1-19 are the exemplar's own suite (CoalBoard 516c52c), ported verbatim -- they cover
// the shared, unmodified checkPointers()/pointerCandidates() logic. Tests 20+ are
// CoalTipple's own, covering the two logic changes this room's own measurement required
// (FIX 1 -- bare-domain URLs, FIX 2 -- relative-to-citing-surface resolution, and its guard
// against a bare directory-fragment word being wrongly joined).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPointers, pointerCandidates } from './pointer-check.mjs';

const OUR_ROOTS = new Set(['scripts', 'skills']);
const IGNORED_ROOTS = new Set(['scratchpad', 'AGENTS.md']);

function fakeResolve(states) {
  return (rel) => states[rel] ?? 'missing';
}

test('a clean surface with no citations reports zero findings', () => {
  const findings = checkPointers({
    surfaces: [{ label: 'README.md', text: 'No pointers here at all.' }],
    ourRoots: OUR_ROOTS,
    ignoredRoots: IGNORED_ROOTS,
    resolve: fakeResolve({}),
    pending: [],
  });
  assert.equal(findings.length, 0, JSON.stringify(findings));
});

test('a tracked citation is silent; an untracked one FAILs naming UNTRACKED', () => {
  const findings = checkPointers({
    surfaces: [{ label: 'README.md', text: 'See `scripts/verify.mjs` and `scripts/ghost.mjs`.' }],
    ourRoots: OUR_ROOTS,
    ignoredRoots: IGNORED_ROOTS,
    resolve: fakeResolve({ 'scripts/verify.mjs': 'tracked', 'scripts/ghost.mjs': 'untracked' }),
    pending: [],
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0].msg, /scripts\/ghost\.mjs/);
  assert.match(findings[0].msg, /UNTRACKED/);
});

test('untracked vs missing produce DIFFERENT messages, not the same generic fail', () => {
  const untracked = checkPointers({
    surfaces: [{ label: 'a', text: 'See `scripts/x.mjs`.' }],
    ourRoots: OUR_ROOTS, ignoredRoots: IGNORED_ROOTS,
    resolve: fakeResolve({ 'scripts/x.mjs': 'untracked' }), pending: [],
  })[0].msg;
  const missing = checkPointers({
    surfaces: [{ label: 'a', text: 'See `scripts/x.mjs`.' }],
    ourRoots: OUR_ROOTS, ignoredRoots: IGNORED_ROOTS,
    resolve: fakeResolve({ 'scripts/x.mjs': 'missing' }), pending: [],
  })[0].msg;
  assert.notEqual(untracked, missing);
  assert.match(untracked, /UNTRACKED/);
  assert.match(missing, /does not resolve/);
});

test('the gitignored branch FAILs even though the path does not (yet) exist on disk', () => {
  const findings = checkPointers({
    surfaces: [{ label: 'CHANGELOG.md', text: 'See `scratchpad/notes.md` for the log.' }],
    ourRoots: OUR_ROOTS,
    ignoredRoots: IGNORED_ROOTS,
    resolve: fakeResolve({}), // resolve() never even needs to be asked
    pending: [],
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0].msg, /gitignored `scratchpad\/`/);
});

test('the gitignored branch fires BEFORE `pending` is consulted -- a declared gitignored path still FAILs', () => {
  const findings = checkPointers({
    surfaces: [{ label: 'CHANGELOG.md', text: 'See `scratchpad/notes.md`.' }],
    ourRoots: OUR_ROOTS,
    ignoredRoots: IGNORED_ROOTS,
    resolve: fakeResolve({}),
    pending: [{ path: 'scratchpad/notes.md', reason: 'an attempted declaration -- must not launder a gitignored path' }],
  });
  assert.equal(findings.length, 1, 'pending must not excuse a gitignored citation');
  assert.match(findings[0].msg, /gitignored/);
});

test('the gitignored branch binds a historyOnly surface, while ordinary resolution does not', () => {
  const surfaces = [{
    label: 'CHANGELOG.md',
    historyOnly: true,
    text: 'Old entry cited `scratchpad/old-lab-notes.md` and `scripts/removed-tool.mjs`.',
  }];
  const findings = checkPointers({
    surfaces,
    ourRoots: OUR_ROOTS,
    ignoredRoots: IGNORED_ROOTS,
    // scripts/removed-tool.mjs no longer exists -- historyOnly means this is NOT a defect.
    resolve: fakeResolve({ 'scripts/removed-tool.mjs': 'missing' }),
    pending: [],
  });
  // Exactly one finding: the gitignored scratchpad citation. The ours-rooted-but-gone
  // scripts/removed-tool.mjs is excused by historyOnly and produces nothing.
  assert.equal(findings.length, 1);
  assert.match(findings[0].msg, /scratchpad\/old-lab-notes\.md/);
  assert.match(findings[0].msg, /gitignored/);
});

test('PENDING_KEYS-style expiry, direction 1: a pending path that NOW resolves is a lie -- FAIL', () => {
  const findings = checkPointers({
    surfaces: [{ label: 'a', text: 'See `scripts/new-thing.mjs`.' }],
    ourRoots: OUR_ROOTS,
    ignoredRoots: IGNORED_ROOTS,
    resolve: fakeResolve({ 'scripts/new-thing.mjs': 'tracked' }), // it landed
    pending: [{ path: 'scripts/new-thing.mjs', reason: 'CWK-000 -- landing next unit' }],
  });
  assert.ok(findings.some((f) => /now resolves/.test(f.msg)));
});

test('expiry, direction 2: a pending path no in-scope surface cites is dead weight -- FAIL', () => {
  const findings = checkPointers({
    surfaces: [{ label: 'a', text: 'Nothing relevant here.' }],
    ourRoots: OUR_ROOTS,
    ignoredRoots: IGNORED_ROOTS,
    resolve: fakeResolve({}), // still missing, so the first branch does not fire
    pending: [{ path: 'scripts/never-mentioned.mjs', reason: 'stale declaration' }],
  });
  assert.ok(findings.some((f) => /no in-scope surface cites it/.test(f.msg)));
});

test('a pending declaration that is genuinely still pending and still cited stays silent', () => {
  const findings = checkPointers({
    surfaces: [{ label: 'a', text: 'See `scripts/future-thing.mjs` (landing soon).' }],
    ourRoots: OUR_ROOTS,
    ignoredRoots: IGNORED_ROOTS,
    resolve: fakeResolve({ 'scripts/future-thing.mjs': 'missing' }),
    pending: [{ path: 'scripts/future-thing.mjs', reason: 'CWK-000 -- landing next unit' }],
  });
  assert.equal(findings.length, 0, JSON.stringify(findings));
});

test('a pending entry with no reason FAILs -- an allowlist of bare strings is a bypass with no author', () => {
  const findings = checkPointers({
    surfaces: [{ label: 'a', text: 'See `scripts/future-thing.mjs`.' }],
    ourRoots: OUR_ROOTS,
    ignoredRoots: IGNORED_ROOTS,
    resolve: fakeResolve({ 'scripts/future-thing.mjs': 'missing' }),
    pending: [{ path: 'scripts/future-thing.mjs' }],
  });
  assert.ok(findings.some((f) => /no reason/.test(f.msg)));
});

test('an unreadable surface reports a SKIP, never a silent pass', () => {
  const findings = checkPointers({
    surfaces: [{ label: 'ghost.md', text: undefined }],
    ourRoots: OUR_ROOTS,
    ignoredRoots: IGNORED_ROOTS,
    resolve: fakeResolve({}),
    pending: [],
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].level, 'SKIP');
  assert.match(findings[0].msg, /could not read ghost\.md/);
});

test('a path into someone else\'s tree (not ours, not ignored, and not resolvable relative to any surface) is silently out of scope', () => {
  const findings = checkPointers({
    surfaces: [{ label: 'a', text: 'The user\'s own `platform-configs/other.json` lives there.' }],
    ourRoots: OUR_ROOTS,
    ignoredRoots: IGNORED_ROOTS,
    resolve: fakeResolve({}), // resolve() must never even be consulted for this token
    pending: [],
  });
  assert.equal(findings.length, 0, JSON.stringify(findings));
});

test('pointerCandidates: a bare filename (no directory component) is dropped', () => {
  assert.deepEqual(pointerCandidates('See `SKILL.md` for the contract.'), []);
});

test('pointerCandidates: a dot-dir is dropped unconditionally', () => {
  assert.deepEqual(pointerCandidates('The user\'s own `.coaltipple.json` lives in their project.'), []);
});

test('pointerCandidates: a command or table row (has whitespace) is not a pointer', () => {
  assert.deepEqual(pointerCandidates('Run `node scripts/verify.mjs now`.'), []);
});

test('pointerCandidates: a <placeholder> is not a literal path', () => {
  assert.deepEqual(pointerCandidates('See `plugin/skills/<name>/SKILL.md`.'), []);
});

test('pointerCandidates: a glob names a set, not a file', () => {
  assert.deepEqual(pointerCandidates('Every `scripts/*.mjs` file.'), []);
});

test('pointerCandidates: an absolute path, ~, and a schemed URL are all out of scope', () => {
  assert.deepEqual(pointerCandidates('See `/etc/passwd`, `~/notes.md`, `https://example.com/x/y`.'), []);
});

test('pointerCandidates: a real repo-rooted path with a directory component survives', () => {
  assert.deepEqual(pointerCandidates('See `scripts/lib/pointer-check.mjs` for the rule.'), ['scripts/lib/pointer-check.mjs']);
});

test('normalise: a trailing line-range suffix and a trailing slash are stripped before resolving', () => {
  const seen = [];
  const findings = checkPointers({
    surfaces: [{ label: 'a', text: 'See `scripts/verify.mjs:12-40` and `scripts/lib/`.' }],
    ourRoots: OUR_ROOTS,
    ignoredRoots: IGNORED_ROOTS,
    resolve: (rel) => { seen.push(rel); return 'tracked'; },
    pending: [],
  });
  assert.equal(findings.length, 0, JSON.stringify(findings));
  assert.ok(seen.includes('scripts/verify.mjs'), 'the :12-40 suffix must be stripped before resolve() is called');
  assert.ok(seen.includes('scripts/lib'), 'the trailing slash must be stripped before resolve() is called');
});

test('a fenced code block is an EXAMPLE, not a ship-text claim -- its backticked content is not scanned', () => {
  const text = [
    'Prose citing `scripts/real.mjs`.',
    '```',
    'See `scripts/fake-in-code-block.mjs` -- this is illustrative code, not a claim.',
    '```',
  ].join('\n');
  const findings = checkPointers({
    surfaces: [{ label: 'a', text }],
    ourRoots: OUR_ROOTS,
    ignoredRoots: IGNORED_ROOTS,
    resolve: fakeResolve({ 'scripts/real.mjs': 'tracked' }),
    pending: [],
  });
  assert.equal(findings.length, 0, JSON.stringify(findings));
});

// ============================================================================
// CoalTipple's own tests -- the two logic changes this room's own measurement required
// (CWK-075 FIX 1 and FIX 2), and the guard FIX 2 needed after its own false positive.

test('pointerCandidates: FIX 1 -- a scheme-less domain citation is external, same as a schemed one', () => {
  assert.deepEqual(
    pointerCandidates('File at `github.com/TheColliery/CoalTipple/issues` (never auto-submit).'),
    [],
  );
});

test('pointerCandidates: FIX 1 does not false-positive on an ordinary path with no dot before the first slash', () => {
  // `scripts` has no embedded dot, so DOMAIN_LIKE must not match it -- a real in-repo path
  // must survive the same filter that drops a bare hostname.
  assert.deepEqual(
    pointerCandidates('See `scripts/lib/pointer-check.mjs`.'),
    ['scripts/lib/pointer-check.mjs'],
  );
});

test('pointerCandidates: a dot-dir token SURVIVES extraction (CWK-077 -- blind spot 1 narrowed); DOMAIN_LIKE still does not exclude it', () => {
  // `.claude-plugin` starts with `.`, so `[a-z0-9]` cannot match at position 0 -- DOMAIN_LIKE
  // must not fire here, unchanged. What changed is the OLD "if (tok.startsWith('.')) continue"
  // rule this test used to name: CWK-077 moved the dot-dir decision out of pointerCandidates()
  // into checkPointers()'s agentHomeRoots holdout, where the caller-supplied set is available.
  // A dot-dir token therefore now SURVIVES this function unchanged, same as any other
  // path-shaped candidate -- the narrowing itself.
  assert.deepEqual(
    pointerCandidates('See `.claude-plugin/plugin.json`.'),
    ['.claude-plugin/plugin.json'],
  );
});

test('checkPointers: a dot-dir NOT in agentHomeRoots reaches ordinary resolution (the narrowing, at the checkPointers layer)', () => {
  const seen = [];
  const findings = checkPointers({
    surfaces: [{ label: 'a', text: 'See `.claude-plugin/plugin.json`.' }],
    ourRoots: new Set([...OUR_ROOTS, '.claude-plugin']),
    ignoredRoots: IGNORED_ROOTS,
    agentHomeRoots: new Set(['.claude', '.agents', '.gemini']),
    resolve: (rel) => { seen.push(rel); return 'tracked'; },
    pending: [],
  });
  assert.equal(findings.length, 0, JSON.stringify(findings));
  assert.deepEqual(seen, ['.claude-plugin/plugin.json'], 'a dot-dir in ourRoots must resolve like any other root, not be held out');
});

test('checkPointers: a dot-dir IN agentHomeRoots is held out silently, even when it also matches ourRoots/ignoredRoots', () => {
  // `.claude` deliberately sits in BOTH ourRoots (the caller mistakenly listing it) and
  // agentHomeRoots here -- agentHomeRoots must win regardless, the same priority
  // checkPointers() itself documents (a reader's agent home is never resolved against our tree).
  const findings = checkPointers({
    surfaces: [{ label: 'a', text: 'See `.claude/.coaltipple/proposed/x.md`.' }],
    ourRoots: new Set([...OUR_ROOTS, '.claude']),
    ignoredRoots: IGNORED_ROOTS,
    agentHomeRoots: new Set(['.claude', '.agents', '.gemini']),
    resolve: () => { throw new Error('resolve() must not be called for an agent-home root'); },
    pending: [],
  });
  assert.equal(findings.length, 0, JSON.stringify(findings));
});

test('checkPointers: FIX 2 -- a citation relative to the CITING SURFACE resolves against surface.dir, not the repo root', () => {
  const seen = [];
  const findings = checkPointers({
    surfaces: [{
      label: 'skills/coaltipple/SKILL.md',
      dir: 'skills/coaltipple',
      text: 'Detail: `references/lock.md`.',
    }],
    ourRoots: OUR_ROOTS,
    ignoredRoots: IGNORED_ROOTS,
    resolve: (rel) => { seen.push(rel); return rel === 'skills/coaltipple/references/lock.md' ? 'tracked' : 'missing'; },
    pending: [],
  });
  assert.equal(findings.length, 0, JSON.stringify(findings));
  assert.ok(seen.includes('skills/coaltipple/references/lock.md'), 'resolve() must be asked about the JOINED path, not the raw token');
});

test('checkPointers: FIX 2 fallback never shadows an ordinary ROOT-relative citation', () => {
  // The raw token's own first segment ('scripts') already matches ourRoots -- the surface.dir
  // fallback must never even be attempted, so a root-relative citation always wins.
  const seen = [];
  const findings = checkPointers({
    surfaces: [{
      label: 'skills/coaltipple/SKILL.md',
      dir: 'skills/coaltipple',
      text: 'See `scripts/verify.mjs`.',
    }],
    ourRoots: OUR_ROOTS,
    ignoredRoots: IGNORED_ROOTS,
    resolve: (rel) => { seen.push(rel); return rel === 'scripts/verify.mjs' ? 'tracked' : 'missing'; },
    pending: [],
  });
  assert.equal(findings.length, 0, JSON.stringify(findings));
  assert.deepEqual(seen, ['scripts/verify.mjs'], 'must resolve the raw root-relative token, never a surface.dir join of it');
});

test('checkPointers: FIX 2 GUARD -- a bare directory-fragment word with only a decorative trailing slash is NOT joined onto surface.dir (the false positive this guard fixes)', () => {
  // `proposed/` names a USER-RUNTIME directory (`.claude/.coaltipple/proposed/`), never a
  // path in this repo. Before the guard, joining it onto surface.dir ('skills/coaltipple')
  // produced 'skills/coaltipple/proposed' and manufactured a false FAIL. After the guard
  // (normalise(tok).includes('/') gates the fallback), a bare word is left to the ordinary
  // ourRoots-miss silent drop -- resolve() must never even be asked.
  const findings = checkPointers({
    surfaces: [{
      label: 'skills/coaltipple/SKILL.md',
      dir: 'skills/coaltipple',
      text: 'The worker\'s proposal is in `proposed/`, finished subtasks in `state.json`.',
    }],
    ourRoots: OUR_ROOTS,
    ignoredRoots: IGNORED_ROOTS,
    resolve: () => { throw new Error('resolve() must not be called for a bare word FIX 2 should not touch'); },
    pending: [],
  });
  assert.equal(findings.length, 0, JSON.stringify(findings));
});

test('checkPointers: a root-relative citation into a TRACKED DOT-DIR root resolves directly, never joined onto the citing surface\'s dir (CWK-077 -- guards the narrowing itself, not the ourRoots-data defect)', () => {
  // Guards the NARROWING (findings-back LOW-2, correcting an earlier version of this comment
  // that claimed to reproduce the real ourRoots-DATA defect verify.mjs shipped -- it does not:
  // this test's own `ourRoots` already includes '.github', and the shared OUR_ROOTS fixture
  // (:14) has no 'commands' either, so FIX 2's join can never fire here regardless of that
  // data defect -- it is guarded separately, at the verify.mjs level, where PC_OUR_ROOTS is
  // actually derived. What THIS test proves: once a dot-dir SURVIVES pointerCandidates() (the
  // narrowing itself) and its first segment is a real ourRoots member, it resolves directly,
  // never joined onto the citing surface's dir. It is not vacuous: reverting the narrowing
  // (restoring the old blanket dot-dir drop in pointerCandidates()) makes the token never
  // reach resolve() at all, and this test goes red (`seen` stays empty against the asserted
  // `['.github/workflows/ci.yml']`).
  const seen = [];
  const findings = checkPointers({
    surfaces: [{
      label: 'commands/update.md',
      dir: 'commands',
      text: 'See `.github/workflows/ci.yml` for the gate.',
    }],
    ourRoots: new Set([...OUR_ROOTS, '.github']),
    ignoredRoots: IGNORED_ROOTS,
    agentHomeRoots: new Set(['.claude', '.agents', '.gemini']),
    resolve: (rel) => { seen.push(rel); return rel === '.github/workflows/ci.yml' ? 'tracked' : 'missing'; },
    pending: [],
  });
  assert.equal(findings.length, 0, JSON.stringify(findings));
  assert.deepEqual(seen, ['.github/workflows/ci.yml'], 'must resolve the raw root-relative token; must NOT be joined onto commands/.github/workflows/ci.yml');
});

test('checkPointers: an interior `..` in a token whose first segment ALREADY matches ourRoots is floored before resolve(), never left to fs.existsSync/path.join to collapse (findings-back LOW-1)', () => {
  // FIX 2's join floors `..` (joinRel's out.pop() on an empty array is a no-op), but it only
  // runs when the FIRST segment matches neither ourRoots nor ignoredRoots -- a token whose
  // first segment is ALREADY an ourRoots member skips FIX 2 entirely, so before this fix the
  // raw token (with `..` still inside) went straight to resolve(), and verify.mjs's own
  // fs.existsSync(path.join(repo, rel)) DOES collapse `..` -- the stat would land outside the
  // repo. RED before the fix: `seen` held the raw escaping token itself.
  const seen = [];
  const findings = checkPointers({
    surfaces: [{ label: 'a', dir: 'scripts', text: 'See `scripts/../../../etc/passwd` here.' }],
    ourRoots: OUR_ROOTS,
    ignoredRoots: IGNORED_ROOTS,
    resolve: (rel) => { seen.push(rel); return 'missing'; },
    pending: [],
  });
  assert.deepEqual(seen, ['etc/passwd'], 'the `..` must be floored before resolve() is asked -- never the raw escaping token');
  assert.equal(findings.length, 1);
  assert.match(findings[0].msg, /does not resolve in this repo/);
});

test('checkPointers: FIX 2 fallback also binds the gitignored-root branch (a relative citation whose JOINED path lands under a gitignored root still FAILs)', () => {
  // A `../`-prefixed token DOES reach FIX 2 (findings-back MEDIUM-2, correcting an earlier
  // version of this comment: CWK-077 removed pointerCandidates()'s dot-dir drop, so `..` is
  // no longer excluded at extraction). It still cannot escape the repo -- `joinRel`'s
  // `out.pop()` on an empty array is a no-op, so `..` floors at the join root instead of
  // walking above it, AND the joined path is only ADOPTED when its own first segment lands in
  // ourRoots/ignoredRoots, which `..` itself can never be. This test exercises a simpler
  // reachable shape instead -- a surface whose OWN directory (`ignoredRoots.has('scratchpad')`-
  // style top segment) is itself gitignored, citing a plain relative filename with no leading
  // dot.
  const ignoredRootsWithDir = new Set([...IGNORED_ROOTS, 'dogfood']);
  const findings = checkPointers({
    surfaces: [{
      label: 'dogfood/README.md',
      dir: 'dogfood',
      text: 'See `results/run1.json` for the raw data.',
    }],
    ourRoots: OUR_ROOTS,
    ignoredRoots: ignoredRootsWithDir,
    resolve: () => { throw new Error('the gitignored branch must not consult resolve()'); },
    pending: [],
  });
  assert.equal(findings.length, 1, JSON.stringify(findings));
  assert.match(findings[0].msg, /gitignored `dogfood\/`/);
});
