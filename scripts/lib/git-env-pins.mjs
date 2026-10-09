// This room's git-spawn census PINS (09a). The census itself is the canon's (scripts/lib/git-env-census.mjs, adopted by blob id from
// TheColliery/.github templates/overlay-coal-skill/scripts/lib/, never edited here) and ships no pin; a room passes its own rows to
// scanGitSpawns(files, pins). A row matches only while the file's git blob id (line endings normalised to LF) equals `blob`, so any edit, or a
// new source blob, re-arms the census on that file; scripts/lib/git-env-pins.test.mjs holds that every row is live, names how it ends, and
// that the real tree passes with exactly these files exempt and no other.
// The house-scan files below each build their env by copying process.env minus the GIT_* names (a strip filter), which is safe but is not the
// named-keys allowlist the canon census accepts, so each is pinned at its blob with the finding quoted; a pin comes out the day its source builds the
// env from named keys, or the canon rule reads a strip filter. git-env.test.mjs plants GIT_DIR on purpose, to reproduce the hazard CWK-133 closed.
// 09a: scripts/secret-gate.test.mjs left this list when the canon rewrote it to named keys (2f066650).
export const CENSUS_PINS = [
  { rel: "scripts/lib/git-env.test.mjs", blob: "84446707c2c68a0146be2b18aa0b6536e38955ae", why: "plants GIT_DIR in poisonedEnv on purpose (lines 97 and 104 hand it to a git spawn) to reproduce the CWK-133 hazard; KEEP while the test reproduces the hazard" },
  { rel: "scripts/secret-gate.mjs", blob: "856956a1cca6f716e5507f6c23ac90ed34cbbe5f", why: "canon gate, byte-equal by skeleton-check; its gitEnv() copies process.env minus GIT_* but keeps GIT_INDEX_FILE and GIT_CEILING_DIRECTORIES by design (lines 57 and 60 are the findings); DELETE when the census rule accepts a GIT_*-stripping copy of process.env or the canon builds its env from named keys" },
  { rel: "scripts/secret-scan.test.mjs", blob: "d0db994df855ccd647f3ded878a6867bb198e196", why: "house secret-scan test, byte-equal to its Bankfire source by parity; its gitEnv() is (envSeen = { ...withoutGit(), named keys, GIT_CONFIG_NOSYSTEM }) with withoutGit() a GIT_*-stripping copy of process.env (lines 547, 548, 715, 820 and 825 are the findings); DELETE when the census rule accepts a GIT_*-stripping copy of process.env or the source builds its env from named keys" },
];
