// This room's git-spawn census PINS (09a). The census itself is the canon's (scripts/lib/git-env-census.mjs, adopted by blob id from
// TheColliery/.github templates/overlay-coal-skill/scripts/lib/, never edited here) and ships no pin; a room passes its own rows to
// scanGitSpawns(files, pins). A row matches only while the file's git blob id (line endings normalised to LF) equals `blob`, so any edit, or a
// new source blob, re-arms the census on that file; scripts/lib/git-env-pins.test.mjs holds that every row is live, names how it ends, and
// that the real tree passes with exactly these files exempt and no other.
// The secret gate below builds its env by copying process.env minus the GIT_* names but keeping two (a strip filter), which is not the
// named-keys allowlist the canon census accepts, so it is pinned at its blob with the finding quoted; a pin comes out the day its source builds the
// env from named keys, or the canon rule reads a strip filter. git-env.test.mjs plants GIT_DIR on purpose, to reproduce the hazard CWK-133 closed.
// 09a: scripts/secret-gate.test.mjs left this list when the canon rewrote it to named keys (2f066650).
// 09b: scripts/secret-scan.test.mjs left it when the canon rebuilt its env from named keys (a0319dcd); the census passes it with no pin.
// 25a: scripts/secret-gate.mjs re-copied from the canon (eecd5f9, blob 6b452f2f) and re-pinned to that blob; the census still finds its lines 57 and 60.
// 29gp: scripts/secret-gate.mjs re-copied from the canon (blob 4bf97717, the CWE-426 NoDefaultCurrentDirectoryInExePath fix) and re-pinned to that blob.
// 29hk: scripts/secret-gate.mjs re-copied from the canon (commit 609d86b, blob 175f0a52, the UTF-16 and UTF-32 scanner) and re-pinned to that blob; the census names its line 66, and its gitEnv() (line 56) is still a strip filter.
// 29hs: scripts/secret-gate.mjs re-copied from the canon (commit a7161df, blob 33e8a4ae) and re-pinned to that blob; the census still names its line 66, and its gitEnv() (line 56) is still a strip filter.
// 29ii: scripts/secret-gate.mjs re-copied from the canon (commit 03438a1, blob 0dd7e4e1) and re-pinned to that blob; the census still names its line 66, and its gitEnv() (line 56) is still a strip filter.
// 29iq: scripts/secret-gate.mjs re-copied from the canon (.github commit 78c53e6, blob 719f7667) and re-pinned to that blob; the census still names its line 66, and its gitEnv() (line 56) is still a strip filter.
// 29ja: scripts/secret-gate.mjs re-copied from the canon (.github commit 90c1933, blob 2800aab9) and re-pinned to that blob; the census still names its line 66, and its gitEnv() (line 56) is still a strip filter.
// 29kl: scripts/secret-gate.mjs re-copied from the canon (.github commit 1c7a36a, blob 7334d8d3) and re-pinned to that blob; the census still names its line 66, and its gitEnv() (line 56) is still a strip filter.
// 29mj: scripts/secret-gate.mjs re-copied from the canon (.github commit ea92a58, blob 235bf5b5) and re-pinned to that blob; the census now names its line 79 (the gitIn spawn), and its gitEnv() (line 69) is still a strip filter.
export const CENSUS_PINS = [
  { rel: "scripts/lib/git-env.test.mjs", blob: "be246755d951ebbc523849dab880da8efbab350c", why: "plants GIT_DIR in poisonedEnv on purpose (lines 97 and 104 hand it to a git spawn), and a lower-case git_dir copied from process.env (the probed 16e leg at the end of the file), to reproduce the CWK-133 hazard; KEEP while the test reproduces the hazard" },
  { rel: "scripts/secret-gate.mjs", blob: "235bf5b5b4dffaa814c07b7c56b5499232937b2b", why: "canon gate, byte-equal by skeleton-check; its gitEnv() copies process.env minus GIT_* but keeps GIT_INDEX_FILE and GIT_CEILING_DIRECTORIES by design (line 79, the gitIn spawn, is the finding; gitEnv() itself is line 69); DELETE when the census rule accepts a GIT_*-stripping copy of process.env or the canon builds its env from named keys" },
];
