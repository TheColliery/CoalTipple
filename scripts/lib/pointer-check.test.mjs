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

test('pointerCandidates: FIX 1 does not false-positive on a dot-dir (already excluded by its own rule, not by DOMAIN_LIKE)', () => {
  // `.claude-plugin` starts with `.`, so `[a-z0-9]` cannot match at position 0 -- DOMAIN_LIKE
  // must not fire here; the dot-dir rule is what excludes it, unchanged.
  assert.deepEqual(
    pointerCandidates('See `.claude-plugin/plugin.json`.'),
    [],
  );
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

test('checkPointers: FIX 2 fallback also binds the gitignored-root branch (a relative citation whose JOINED path lands under a gitignored root still FAILs)', () => {
  // A `../`-prefixed token is unreachable here by construction: pointerCandidates()'s own
  // dot-dir rule (`tok.startsWith('.')`) drops any token starting with `.` before FIX 2 ever
  // runs, so this exercises the reachable shape instead -- a surface whose OWN directory
  // (`ignoredRoots.has('scratchpad')`-style top segment) is itself gitignored, citing a
  // plain relative filename with no leading dot.
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
