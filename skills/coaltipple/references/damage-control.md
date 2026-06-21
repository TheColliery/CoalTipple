# CoalTipple — damage control · memory anchor · self error-report

Loaded ON-DEMAND. These run only on infrequent paths: a delegation that fails mid-run (damage control), a context-dependent delegation with no anchor + a once-per-session offer (memory anchor), or CoalTipple misbehaving (self error-report). The per-route hot path never needs them, so they live here, not in the SKILL.md body. The load-bearing SAFETY invariant — sensitive work never falls below its safe-minimum tier on a limit-hit — stays in the SKILL.md HARD GATE + Step 3.3; this file is the mechanics.

## Damage control (you can't control the limit · you can control the damage)

- Don't fight the platform's rate-limit retries (the platform handles 429 itself). Your job = bound the blast radius of a mid-run death.
- **Silent stall:** a background worker that returns nothing past `subagentTimeoutSeconds` (default 150) → treat it as failed and re-route (the platform may not signal a silent stall).
- **Limit-hit / unavailable fallback (a tier goes unreachable mid-route — quota exhausted / disabled / not in the plan / a spawn that errored "model unavailable" / a model gone):** resolve the next worker by walking DOWN the ranking to the next AVAILABLE tier — the availability move, the OPPOSITE of the quality climb (Step 3). Within-tier first (a blocked Opus 4.8 → Opus 4.7), then drop a tier (all Opus quota-blocked → Sonnet). **BUT never below the task's floor:** a SENSITIVE task floors at its safe-minimum tier — if nothing is available at/above it, hand back or wait for reset, NEVER fall crypto/auth/payment to a cheaper tier on a quota-hit. Everything blocked → do it yourself if you can clear the bar, else hand back honestly. (`resolveWorker` is the deterministic substrate; the spawn-fail-fall loop that drives it is SKILL.md Step 3.3 — this is the SAME loop, whether the block hits on the first spawn or mid-route.)
- Have the worker write its proposal to `.claude/.coaltipple/proposed/`; you merge it deliberately → a mid-run death never corrupts real files. Journal finished subtasks to `.claude/.coaltipple/state.json` → resume skips the done ones.
- **For a file-mutating delegation in a git repo, prefer worktree-isolation** (the worker edits an isolated copy; a mid-run death discards it) — else the `.claude/.coaltipple/proposed/` sandbox is the git-agnostic fallback.
- **A step with a side-effect (bash mutation, external call, commit) = never delegate + never retry** (retry = doing it twice; bash isn't checkpointed). A git user → a commit is a real recovery line, used as an extra recovery boundary per `gitRecoveryBoundary` (auto / on / off; default auto — `auto` = use it only inside a git repo) — but never assume git exists.

## Memory anchor (the context-floor mitigation)

A worker starts context-FRESH (the context-floor in SKILL.md Step 2). A **memory anchor** — the project's own memory/conventions file — gives a fresh worker (and a resuming main) context BEYOND the bare task contract, so delegation doesn't drop project knowledge.
- **Find the anchor:** if `contextFiles` is set, those file(s) ARE the anchor — point the worker contract at them (read for conventions/context). If `contextFiles` is empty, rely on the platform's OWN memory: it auto-loads `CLAUDE.md` / `AGENTS.md` into sessions, so no action is needed.
- **Lazy offer (once, never spam):** when you are about to delegate context-dependent work AND no anchor exists (`contextFiles` empty AND the project has no `CLAUDE.md`/`AGENTS.md` the worker would inherit) AND `memoryOffer` is `auto` AND you have not yet offered this session → offer via your question tool, exactly 3 options: **Create** a memory file · **Skip** · **Choose** an existing file. At most ONCE per session.
  - **Create** → create a memory file (the platform convention, e.g. `MEMORY.md`) + seed a concise handover snapshot (key conventions + decisions + current state) + set `contextFiles` to it.
  - **Choose** → set `contextFiles` to the user's named file (any name) + load it.
  - **Skip** → set `memoryOffer` to `off` (persist — never re-ask) + proceed best-effort (the task contract + `state.json` only).
- **Write-policy (respect the user's file):** a MISSING anchor → create + seed once. An EXISTING anchor → load it + append/crystallize, but **never clobber** it (the same discipline as config-preservation).
- **Maintain:** while an anchor is active, keep it updated + crystallized as the session progresses — append key decisions/conventions, consolidate duplicates, refine; never duplicate what the repo already records.
- **No spam, never locked:** CT asks at most once, then persists the choice; the user changes it anytime via `/coaltipple memory` — CT never re-prompts on its own.

## Self error-report

If CoalTipple itself misbehaves — a contradictory instruction, a procedure that loops or dead-ends, a routing decision that is clearly wrong, the Lock refusing a valid ranking, or a config key that does not behave as documented — STOP and surface it: give the user a one-paragraph summary of what went wrong and where. OFFER to file it at `github.com/TheColliery/CoalTipple/issues`. Never auto-submit; never include unapproved code or paths. A skill that hides its own failures cannot be fixed.

Honest blind spot: this report is MODEL-driven, so it fires ONLY for misbehavior the model NOTICES. It cannot see a fail-silent hook death (Phoenix hooks exit 0 on error by design), a plausible-but-wrong worker output that slipped past a weak check, or a missed delegation. A clean run means "nothing noticed", not "nothing wrong".
