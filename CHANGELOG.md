# Changelog

All notable changes to CoalTipple are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow SemVer (the canonical version lives in `.claude-plugin/plugin.json`).

## [1.0.11] - 2026-06-18

A comprehensive vulnerability hunt (4 parallel scanners + an adversarial work-review pass) — safety-gate, routing-correctness, config-honesty, and worldwide-language fixes.

### Fixed

- **The never-down sensitive gate could be breached by a mis-cased / typo'd floor.** `resolveWorker` (classify.mjs) matched `floorTier` case-sensitively, so `'Heavy'` or a typo fell through `indexOf → -1 → Math.max(-1,0) = 0` and collapsed a SENSITIVE task to the *cheapest* tier under a limit-hit. Now case-normalized + fail-safe: an unrecognized floor returns `null` (hand back), never the floor.
- **Non-English sensitive prompts lost the deterministic safety flag.** The keyword grader + the conductor hint match English literals only, so a Thai/CJK/Arabic prompt meaning "scan for bugs" / "constant-time compare" fired no flag — the "keyword is the gate" backstop silently vanished. The Step-2 HARD GATE now states the model is the sensitive-gate authority for non-English (grade by MEANING), and the conductor injects a generic non-English nudge on non-Latin script. (The model layer has been multilingual since 1.0.9; this closes the *deterministic* backstop.)
- **`mode` and per-domain `disableRouting` were documented but dead.** `mode:"off"` still routed; `disableRouting:["coding"]` did nothing. Both are now wired (SKILL + conductor): `mode` constrains direction (`auto`/`delegation`/`escalation`/`off`, the sensitive HARD GATE overriding it), and per-domain disable is honored.
- **The grade keyword matcher over-matched, then a fix under-matched.** A missing trailing word-boundary let `token`→"tokenizer", `crypto`→"cryptocurrency" wrongly grade sensitive. Fixed with a stem (`*`) vs whole-word convention — and the common plurals (`tokens`/`secrets`/`passwords`/`sessions`/`payments`/`deadlocks`/`mutexes`) are now listed so a plural no longer escapes the never-down flag.
- **The `modelTiers` pin doc named a non-existent tier.** The `--help`/schema text said `cheap` (silently dropped by `applyPins`); the real cheapest tier is `low`.
- **Project config could be read from the wrong directory.** `config-load.mjs` resolved from `process.cwd()` while the conductor + configure used the git root — a subdir cwd read a different file. All three now anchor at the git root (git stays optional).
- **`validateRanking` blessed broken rankings.** An array, `{}`, a missing key, or `complete` merely truthy passed the Lock, letting `resolveWorker` return `null` for every tier (routing dead while the Lock read green). Now strict: every tier present + an array, `complete === true`, ≥1 non-empty.
- **`verify.mjs` used a third, divergent JSONC parser** instead of the shared `stripJsonc` — the gate now validates with the same parser runtime uses.
- **`grade()` threw on null input** (`{files:null}`, etc.); a boundary authority now degrades instead of crashing.

### Added

- Regression tests across every fix — the case-insensitive/fail-safe floor, the non-English nudge, `mode:"off"`, the stem/whole-word + plural matching (A/B both directions), strict `validateRanking`, the git-root config anchor, and null-input degradation. 110 tests.

## [1.0.10] - 2026-06-18

Keyword/config-precision hardenings, caught by the 3-sub review pass.

### Fixed

- **A degenerate `CLAUDE_CONFIG_DIR` (`,` / whitespace) no longer yields a relative config path.** `claudeBaseDir` (config-load.mjs) and the conductor's inline resolver fall back to `~/.claude` when the first comma-list entry is empty: `(c && c.split(',')[0].trim()) || <home>/.claude`.
- **Over-broad domain keywords narrowed (false grade-4 on non-medical prompts).** `diagnosis` → `medical diagnosis` + `clinical diagnosis`; bare `clinical` → `clinical trial`. "a clinical analysis of the codebase" and "fix the bug diagnosis" no longer wrongly grade as a high-stakes regulated-domain task (the specific-phrase convention: 'mathematical proof' not 'proof').

### Added

- Regression tests for both — the degenerate-`CLAUDE_CONFIG_DIR` fallback and the narrowed domain keywords (bare words no longer fire; specific phrases still do). 98 tests.

## [1.0.9] - 2026-06-18

Routing now treats a whole-repo audit/bug-scan as a capability task, plus two field-reported fixes (#6, #7).

### Fixed

- **A whole-repo audit / bug-scan / security-review now grades high-by-DIFFICULTY, not size.** Such a task spans many files (it looked size-driven, so at the Haiku floor it collapsed to SELF and returned a shallow "no bugs"). A new `audit` keyword group (grade 4) + a Step-1 rule route it UP or keep it on a capable main, never floor-self / delegate-down-to-cheap. Graded by the task's MEANING in any language (the skill ships worldwide — not a literal English keyword).
- **#6 — `CLAUDE_CONFIG_DIR` is honored for the GLOBAL config** (`config-load.mjs` + the conductor). A non-default config dir (portable / multi-account / CI) had its global `.coaltipple.json` silently missed. A shared `claudeBaseDir()` reads `$CLAUDE_CONFIG_DIR` (first entry of a comma-list), else `~/.claude`; project paths are unaffected.
- **#7 — `writeRankingAtomic` no longer loses the ranking on Windows `EPERM`/`EBUSY`.** When `ranking.json` is held open (the conductor reading it), `renameSync` threw and the write was lost; it now falls back to a direct overwrite (a kill mid-write leaves a corrupt file the Lock rebuilds).

### Added

- Regression tests for all three: the `audit` grade-4 group, `CLAUDE_CONFIG_DIR` redirection, and the `EPERM` fallback (97 tests).

## [1.0.8] - 2026-06-18

A version gate guards every path until the cross-version self-heal is verified, plus a test pinning the conductor's inline #12 fix.

### Added

- **Version gate on every path (human + agent), live until newer CC is verified.** "Validated on Claude Code 2.1.143" now also rides in the conductor SessionStart contract and `SKILL.md` (the agent paths) - alongside the README, CONTRIBUTING, repo About, and Release notes (the human paths): on a different CC version, rebuild the ranking on first route and verify before relying on it (routing degrades safe - unknown model to the strong tier, failed spawn falls to the next - but the self-heal is unverified outside 2.1.143). The gate lifts once newer versions are verified.
- **Behavioral test for the conductor's inline JSONC stripper (#12).** `conductor.test.mjs` feeds a backslash-terminated value plus a `//`-containing string and asserts it still parses (no silent revert) - guarding the inline copy (duplicated per Phoenix #9) from silently diverging from `jsonc.mjs`.

## [1.0.7] - 2026-06-18

Routing is hardened to be never-fail across Claude Code updates and model-availability changes: an unavailable model can never strand a route, and a freshly-installed floor ranking upgrades itself on first use.

### Changed

- **The spawn-fail-fall is now an explicit driver in `SKILL.md` Step 3.** A spawn that errors because the model is unavailable / disabled / out of quota / gone (an instant, 0-token "X is currently unavailable") adds that model to a `blocked` set, resolves the next available worker via `resolveWorker(ranking, desiredTier, {blocked, floorTier})`, spawns it, and repeats — until a working model is reached or `resolveWorker` returns `null` (everything blocked down to the floor) and routing hands back. The guarantee is stated plainly: routing reaches a working model or hands back cleanly; it never gets stuck on an unavailable model, and never falls a sensitive task below its safe-minimum floor to escape a block. The same loop is cross-referenced from Damage control (the mid-route case).
- **`SKILL.md` Step 0 — availability is now sharply distinguished from the catalog.** Introspection / the model catalog determines only the tier *structure* (which models exist and their capability order); availability is discovered only at spawn-time. A model is never treated as reachable just because the catalog lists it — a plan may disable it (proven live: a `fable` spawn returned unavailable instantly). The ranking lists the best-known model per tier; the spawn-fail-fall corrects reachability at runtime.
- **Workers must be bounded (`SKILL.md` Step 3).** A delegated worker must have clear done-criteria in its task contract so it terminates; an open-ended / "keep improving" worker can loop and burn the budget. `subagentTimeoutSeconds` catches a stall; the done-criteria prevents the loop.
- **The worker-leaf rule is reframed from a version FACT to a version-agnostic POLICY (`SKILL.md` + conductor).** The old text claimed "a worker has no spawn tool / nesting is gated off" — true on older Claude Code but false since 2.1.172 (nesting is on). It now reads: workers are leaves *by policy* (routing stays depth-0); bounded task-contracts + the spawn-fail-fall keep routing robust whether or not the platform caps nesting.
- **CI matrix trimmed to the supported Node LTS** (`.github/workflows/ci.yml`: `node: [22, 24]`, dropping EOL Node 18 and 20).

### Added

- **Bootstrap-upgrade (`SKILL.md` Step 0 + `scripts/lib/classify.mjs`).** A ranking seeded without ever enumerating the live model list — `source: "install-floor"` or `"heuristic-floor"` with the empty-list `listHash` — is a never-introspected bootstrap whose `complete: true` only attests that the floor was seeded. On the first route by a capable main it is upgraded via introspection (rewritten to `source: "introspection"` with a real `listHash`). The detection is a cheap field check, `isBootstrapRanking()` (plus the exported `EMPTY_LIST_HASH`), so it needs no live enumeration and fires once — the token-floor is preserved, and a bootstrap ranking stays valid so routing never stalls waiting to upgrade.

### Fixed

- **`.coaltipple.json` no longer silently reverts to defaults (the CoalMine #12 class).** The JSONC comment-stripper desynced on a config value ending in an escaped backslash right before a later `//` — `JSON.parse` threw and the catch fell back to defaults. Replaced with a shared string-aware `scripts/lib/jsonc.mjs` (used by `config-load.mjs` and `configure.mjs`; inlined in the conductor per Phoenix #9), plus a regression test.
- **Context-variant CAPACITY-axis fallback (`SKILL.md` Step 0).** The fall logic covered only the tier (capability) axis; when the largest context variant retires (e.g. Opus 4.8 1M), an input exceeding the remaining ceiling had no safe route — the fall went to a smaller-context cheaper tier (wrong axis) or overflowed. Added a capacity-ceiling rule: the largest *available* variant is the ceiling (discovered at spawn-time); an input over it is chunked or handed back, never dropped to a cheaper tier.

## [1.0.6] - 2026-06-16

CoalTipple is now **Claude Code only** and out of WIP -- routing actuates only where an agent can pick a spawned worker's model, which today is Claude Code. The conductor now nudges routing on every prompt. Validated on Claude Code 2.1.143.

### Changed

- **Status: WIP -> LIVE.** The v1 core is validated and in real use on Claude Code; the README status badge and banner reflect that.
- **The conductor hook nudges routing on EVERY prompt.** On every `UserPromptSubmit` it now injects a short routing forcer ("apply the routing contract before acting"); a hot keyword still adds the complexity hint on top. `enableRouting: false` still silences it entirely.
- **`SKILL.md` and `README.md` re-scoped to Claude Code only**, with a prominent platform-gate warning: routing actuates only where an agent can choose a spawned worker's model + effort (Claude Code's `Agent`/`Task` `model` param). Other platforms are under review.

### Removed

- **Antigravity (and the cross-platform routing target).** Confirmed that Antigravity cannot actuate routing -- a spawned subagent inherits the parent's model (`invoke_subagent`/`define_subagent` expose no model parameter) and there is no separate effort knob. The Antigravity adapter was removed; the transform engine is parked until a platform passes the spawn-model-param check.

### Fixed

- **`README.md` Compatibility section** no longer claims routing "self-degrades to a no-op" on an unsupported platform -- a platform that spawns but cannot pick the worker's model makes a weak main *hallucinate* a delegation it cannot perform, which is exactly why CoalTipple is gated to Claude Code.
- **`scripts/lib/targets.mjs`** header comment corrected (it implied installing broadly was safe via self-degradation).

## [1.0.5] - 2026-06-16

The topic-keyword config is now fully editable, the factory config ships its built-ins populated, and the benchmark moved to the series umbrella. Validated on Claude Code 2.1.143.

### Changed

- **BREAKING (config): keyword groups now use flat, top-level names.** `coding.concurrency` -> `concurrency`, `coding.crypto` -> `crypto`, `coding.security` -> `security`, `coding.data` -> `coding` (the `coding.` prefix is dropped). *Migration:* a `.coaltipple.json` `keywords` override pinning a dotted name (e.g. `coding.crypto`) must rename to the flat form (`crypto`), and `coding.data` -> `coding`.
- **The factory `.coaltipple.json` ships its built-ins POPULATED.** The `keywords` groups, `sensitivePaths`, and `excludePaths` are written out in full (visible, editable; add or delete entries directly) instead of an empty `{}` / `[]`. They are generated from the `keywords.mjs` single source of truth by `build-plugin.mjs` and gated by `verify.mjs` (the shipped config can never drift); the installer strips the build markers so an installed config stays clean. Set a value back to `{}` / `[]` to fall back to the built-ins.
- **The `eval/` output-quality benchmark moved to the series umbrella** (`TheColliery/.github/benchmarks/CoalTipple/`) so the skill repo stays lean - a clone carries only the skill and its docs; the README links to the new location.
- **`worker = leaf` reworded as enforced-but-not-permanent:** on the verified build a subagent has no spawn tool, so workers are leaves; a newer build could expose nesting, so the rule is "never grant a worker the spawn tool, re-verify on updates."

### Added

- **`CONTRIBUTING.md`** - the support policy (Claude Code + Antigravity are the validated platforms; others best-effort) and the contributor rule that `SKILL.md` is the load-bearing, behavioral surface that must be dogfooded, not just unit-tested.

### Fixed

- **`CONTRIBUTING.md` build command:** a keyword change re-syncs through `build-plugin.mjs` (the conductor hook and the factory config), then `build-dist.mjs` rebuilds the dist; the earlier text named `build-dist.mjs` for the keyword sync, which left `verify.mjs` failing.
- **Stale `config-schema.mjs` header comment:** the `configure` CLI is built (`scripts/configure.mjs`), no longer "deferred / not built yet".

## [1.0.4] — 2026-06-15

Topic-aware keyword config, a three-level escalation hierarchy, and an output-quality benchmark. Validated on Claude Code 2.1.143.

### Added

- **Keyword GROUPS in the config (`keywords`).** Routing keywords are grouped by task type (`coding.concurrency`/`crypto`/`security`/`data`, `math`, `knowledge`, `domain`, `creative`), each with a grade floor and optional `sensitive` (never-delegate-down) / `preserveVoice` flags. The factory config lists every group inline; override a word, a grade, or a whole group via `.coaltipple.json` (built-ins stay live by default). The deterministic grader returns `sensitive`/`preserveVoice` keyed on the matched group, not the grade. The legacy `hotKeywords` list still merges as a grade-4 group.
- **Output-quality benchmark (`eval/`).** A harness measuring the *delivered output* (the complement to the routing-decision dogfood): five hard, subtle tasks (one per domain) with objective golds, an auto-scorer (`eval/score.mjs`) for the crypto and fact-checklist tasks, and rubrics for the judgment tasks.
- **Effort rubric** — a deterministic effort-by-output-size table (low/medium/high/max), plus the "always-on lever" framing (effort optimizes even at a pinned or single tier).

### Changed

- **Escalation is now a three-level hierarchy: effort → version → tier** (was "effort before tier"). Raise effort (same model), then a stronger same-tier version (e.g. Opus 4.6 → 4.8, cheaper than a tier jump), then the next tier — never skipping to a higher tier while a stronger same-tier version is untried.
- **`worker = leaf` is enforced, not assumed permanent.** The contract no longer claims a permanent "hard-capped" platform cap. On the verified build (Claude Code 2.1.143) a subagent has no spawn tool, so workers are leaves; newer builds can expose nested subagents, so the rule is now "never grant a worker the Agent tool, and re-verify on Claude Code updates."

## [1.0.3] — 2026-06-15

A routing-quality fix (the floor tier now self-routes size-driven bulk) plus a security + CI cleanup.

### Changed

- **Floor-rule sharpen — a cheap main self-routes size-driven mechanical bulk.** The grade table routes a big size-driven mechanical task "delegate-down"; at the floor tier there is no "down", and a main could resolve that half-way (label it delegate-down, then slip the work UP to a costlier tier). The contract now states the override at both the grade table and the floor rule: a size-driven delegate-down collapses to SELF at the floor. Re-validated on Haiku-as-main; the benchmark's A (scaffold) and D (refactor) probes now hold 7/7.

### Fixed

- **CodeQL `security-and-quality` (`configure.mjs`).** Dropped an unused `os` import and removed an `existsSync`-then-read TOCTOU (read once via try/catch).
- **markdownlint MD060.** markdownlint-cli2-action v23 ships markdownlint v0.40.0, which added the MD060 table-column-style rule; disabled it (compact tables are valid GFM and are used deliberately in the SKILL contract).
- **`SECURITY.md` Phoenix-13 link** repointed to the org canonical — the series doctrine moved to the org and the CoalMine `docs/` copy was removed.

### Security

- **Workflow actions pinned to commit SHAs** (with a `# vX` comment), superseding the floating major tags; closes the OpenSSF Scorecard PinnedDependencies findings. Dependabot still tracks them.

## [1.0.2] — 2026-06-15

Now distributed as a native Claude Code plugin, with a routing benchmark, discoverable commands, and CI on every push.

### Added

- **Native Claude Code plugin distribution.** A `.claude-plugin/marketplace.json` lets you `claude plugin marketplace add TheColliery/CoalTipple` then `claude plugin install coaltipple@coaltipple` — the auto-wired plugin path CoalMine uses — alongside the cross-platform `install.mjs` for other agents. A clean `plugin/` dist (built by `scripts/build-dist.mjs`, gated by `verify.mjs`) ships ONLY the skill, hooks, commands, and manifest — never the repo's `scripts/` or other-agent install templates.
- **Discoverable slash commands.** `/coaltipple:stats`, `/coaltipple:off`, and `/coaltipple:memory` now appear in the command menu as their own entries (previously reachable only as arguments to the skill).
- **Routing benchmark in the README.** The dogfood harness scored routing across model tiers; the safety-critical sensitive-never-down gate held on every tier.
- **GitHub CI.** A cross-platform gate (verify + tests on an os × node matrix), CodeQL `security-and-quality`, OpenSSF Scorecard, Dependabot, and markdownlint run on every push.

### Fixed

- The `plugin/` dist gate now also rejects a stray top-level entry that no dist-item accounts for (the cruft guard), and is CRLF-insensitive on a Windows checkout.

## [1.0.1] — 2026-06-14

A file-layout cleanup: everything CoalTipple writes now lives under `.claude/`, and the model ranking is shared globally instead of rebuilt per project.

### Changed
- **All runtime files moved under `.claude/`** (mirroring CoalMine), so nothing is left loose at a project root. The per-project config moved from `<project>/.coaltipple.json` to **`<project>/.claude/.coaltipple.json`** (the global config was already `~/.claude/.coaltipple.json`); per-project work-state — the `proposed/` sandbox, the `state.json` journal, and the optional conductor copy — moved to **`<project>/.claude/.coaltipple/`**.
- **The model ranking is now GLOBAL and shared** at **`~/.claude/.coaltipple/ranking.json`** instead of per-project. The model list is platform-level (it does not vary by project), so the ranking is built once and shared across every project, eliminating redundant per-project rebuilds. A per-project `--reset` no longer touches it; reset the shared ranking with `--reset --global`.

### Note
- This is a **breaking path change** (no root-path fallback, in keeping with the early/WIP status). Migrate an existing `<project>/.coaltipple.json` to `<project>/.claude/.coaltipple.json`; the old per-project `.coaltipple/ranking.json` can be deleted (the ranking is global now).

## [1.0.0] — 2026-06-14

The v1 core — Claude Code first, built and dogfooded across its model tiers in a single session ("build it right once").

### Added

- **Model/effort router.** The core contract: a task you *can* do but that is large and cheap is delegated **down** to a cheaper tier to save tokens; a task beyond the current tier's competence is escalated **up** for quality; a small task, or any state where no valid ranking exists, stays on main (the router never breaks).
- **Two-knob routing — TIER × EFFORT, effort before tier.** TIER is the correctness lever (difficulty/sensitivity → which model); EFFORT is the size lever (output size → how much to produce). The two are independent: a small-but-hard task gets a strong tier at low effort; a large-but-mechanical task gets a cheap tier at high effort. The top rung (ultracode) is part of the tier ladder, not a separate axis; fast-mode is a side-channel attached only on an explicit latency request, never as a routing rung.
- **The Lock — route correctly or route off.** Routing is gated on a valid model-ranking that is always buildable (introspection → alias floor → stub), validity-checked (schema · hash · completeness) and written atomically. Classification is introspection-first so it does not rot when a vendor ships a new model; an unfamiliar model always classifies as the strong tier, never cheap. If a valid ranking cannot be built, routing turns **off** and CoalTipple runs as a normal single agent. The skill self-heals in `SKILL.md` and does not depend on the installer.
- **Ranking robustness at minimal token cost.** A cached ranking is trusted until a configurable cadence; the live model list is re-enumerated only on that cadence, on a miss, or when an unranked model is noticed — never per session. A failed spawn (a model gone / renamed / disabled / out of quota) is a free, accurate signal to fall to the next tier and rebuild. Every staleness mode degrades safe (unknown → strong tier, listed-but-gone → fall, unsure → over-provision), which is what lets the freshness check be rare. Human pins (`modelTiers`) override introspection's blind spot — a model released after the agent's training cutoff is invisible to introspection and must be pinned.
- **Deterministic grader.** A grade (1–5) derived from content size (lines for code, words/chars for text — general-purpose), sensitive paths, and a hot-keyword list — the authority that overrides a cheap main's overconfidence. The grade's *reason* sets the routing direction: high-by-difficulty escalates up, high-by-size-alone delegates down at high effort.
- **The qualityBar staircase.** `qualityBar` (0–100) is a plain acceptable-quality bar: the grade picks the starting tier, the worker runs, and the output is verified against the task contract with a domain-appropriate objective check; clearing the bar finishes, falling short climbs one rung, falling far short (or running out of attempts) jumps to the top tier, and the top tier still failing hands back. The staircase budget (`maxTotalAttempts`) is range-locked so neither extreme — jump-too-fast or death-by-a-thousand-cuts — can be configured.
- **Sensitive-never-down hard gate.** Anything touching crypto, timing-attacks, auth, payments, secrets, tokens, sessions, or security is gated on the *keyword*, independent of the grade, because a weaker main under-grades sensitive work. Sensitive tasks escalate up, stay on main, or use a vetted built-in — never delegated down, and never hand-rolled on a cheaper tier. The gate holds under a quota / limit-hit too.
- **Limit-hit / availability fallback.** When a tier goes unavailable mid-route, the next worker is resolved by walking *down* the ranking to the next available tier (within-tier first, then a tier down) — the opposite of the quality climb — but never below a sensitive task's safe-minimum tier.
- **Damage control — control the damage, not the limit.** A file-mutating delegation in a git repo prefers worktree-isolation; the `.coaltipple/proposed/` sandbox plus a `state.json` journal is the git-agnostic fallback (a mid-run death never corrupts real files, and a resume skips finished subtasks). A side-effect step (bash mutation, external call, commit) is never delegated or retried.
- **Memory anchor (context handoff).** Because a worker starts context-fresh, a memory-anchor file (`contextFiles`) gives it project context beyond the bare task contract. When none exists and context-dependent work is about to be delegated, CoalTipple offers once (never spam) to set one up — create, choose, or skip (persisted); thereafter every change is user-pulled via `/coaltipple memory`. An existing anchor is appended to, never clobbered.
- **Two-level configuration.** A global `~/.claude/.coaltipple.json` holds defaults for every project; an optional per-project `.coaltipple.json` overrides it (precedence: project → global → schema default, a per-key shallow merge). A global install never auto-creates a project file (no clutter); a project file appears only on explicit per-project customization. Project state (`.coaltipple/`) stays project-scoped.
- **Config schema as the single source of truth.** Every key is defined, typed, and range-checked in one schema; the verify gate validates the factory config against it, so a typo'd key or out-of-range value fails loud. Integer keys are range- and integer-strict (the schema exceeds CoalMine's validation strictness). The factory config is fully commented inline. Config preservation is a hard rule: an install or update never overwrites a user's settings or refined ranking — only an explicit `--reset` does.
- **Config-honesty pass.** Every shipped config key has a real consumer (hollow keys were either wired into the skill or tombstoned). The configurator CLI (`configure.mjs`) edits config from schema-driven, validated flags while preserving the JSONC comments.
- **Plugin packaging + a fail-loud build/verify gate.** `.claude-plugin/plugin.json` plus hook wiring; a build step syncs the conductor's hot-keyword region from the keyword single-source-of-truth (killing the two-source-of-truth drift); a zero-dependency test suite via a canonical runner that fails loud on a missing or orphan test file.
- **Advisory, language-aware conductor hook.** Phoenix-pure (no network, no child process, fail-silent); it reads the configured language so the model answers in the user's language, and never translates technical terms.
- **Self error-report (model-driven), with the blind spot documented honestly:** a fail-silent hook cannot report its own death, and a plausible-but-wrong worker output that slipped a weak check is caught by objective gates, not the report.
- English source for all shipped docs and the skill body (so anyone pulling it can read it); runtime output auto-adapts to the user's language while keeping technical terms verbatim. MIT licensed.

### Verified live (empirical, not assumed)

- Nesting is **hard-capped** — a subagent cannot spawn its own subagent (confirmed by a spawn probe and by a worker reporting no spawn tool). Worker = leaf; main spawns only.
- Spawn overhead is **tens of thousands of tokens per worker** (measured across a minimal probe and a real read-translate-verify task), so delegate-down only pays for large chunks — hence the `delegateMinLines` floor.
- A cheap main ranks structure correctly but mis-judges nuance, which is why the **deterministic grader is a mandatory authority** over the model's own confidence.
- The staircase climb-on-fail, the far-below jump-to-top, and the limit-hit down-fallback were all driven live; merge-verification caught a real "looks right but wrong" flaw in a worker's output.

### Deferred (next)

- Cross-platform support beyond Claude Code (the three pluggable per-platform functions: model classification, supported efforts, spawn encoding), surfaced by dogfooding on each new agent.
- ROI telemetry (an A/B token benchmark), a published marketplace listing, and git pre-commit/pre-push hooks at git-init time.
