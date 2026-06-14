# Changelog

All notable changes to CoalTipple are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow SemVer (the canonical version lives in `.claude-plugin/plugin.json`).

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
