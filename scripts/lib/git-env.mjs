// CWK-133/C-4 -- a git spawn made from THIS room's own fixtures or gate scripts must
// never inherit an ambient GIT_* override. A LINKED WORKTREE's own pre-commit/pre-push
// hook exports an ABSOLUTE GIT_DIR (the worktree's admin dir) and an ABSOLUTE
// GIT_INDEX_FILE -- both override `cwd` AND any GIT_CEILING_DIRECTORIES a fixture tries
// to impose. Measured (CoalFace, r5, 2026-09-23 00:17:49 +07): `GIT_DIR=<abs> git init -q
// .` in an EMPTY fixture dir creates NO fixture `.git` and flips the REAL enclosing
// repository's `core.bare` to `true`. CoalTipple's own variable is WIDER than the
// exemplar's (test-fixture-only): verify.mjs's own PRODUCTION git spawns (dist staleness,
// pointer checks) carry the identical exposure whenever this room's belt runs its gate
// as part of a git hook (pre-commit/pre-push), so this helper covers both call classes --
// which is also why it is named `git-env.mjs`, not `git-test-env.mjs` (a NAMED, deliberate
// divergence from the exemplar per ONE FLOCK ONE COLOR: the exemplar's name would
// misdescribe the verify.mjs production call sites this file also covers).
//
// Deleting the WHOLE `GIT_*` family, not a hand-maintained list, is the point -- a list
// rots; the family is what git actually reads (GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE,
// GIT_COMMON_DIR, GIT_OBJECT_DIRECTORY, and anything else a future git version adds under
// the same prefix).
//
// `ceilingDir` is the one directory a spawn is never allowed to walk up past (its own
// parent, ordinarily) -- belt-and-suspenders on top of the GIT_* strip.
export function gitEnv(ceilingDir) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) delete env[key];
  }
  env.GIT_CEILING_DIRECTORIES = ceilingDir;
  return env;
}
