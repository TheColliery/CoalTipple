<div align="center">

# 🚂 CoalTipple

**A model/effort router for subagent-capable AI coding agents** — delegate a task you *can* do but that is large and cheap *down* to a cheaper tier to save tokens, and hand a task beyond your reach *up* to a stronger tier for quality.

![version](https://img.shields.io/github/v/tag/TheColliery/CoalTipple?label=version&color=blue)
![license](https://img.shields.io/badge/license-MIT-blue)
![SKILL.md](https://img.shields.io/badge/SKILL.md-open_standard-success)
![Claude Code](https://img.shields.io/badge/Claude_Code-validated_live-success)
![built for](https://img.shields.io/badge/built_for-Claude_Code_·_subagent--capable_agents-informational)
![status](https://img.shields.io/badge/status-WIP_·_v1_core-yellow)

[Changelog](CHANGELOG.md) · [Security](SECURITY.md) · [Privacy](PRIVACY.md) · [Releases](https://github.com/TheColliery/CoalTipple/releases)

</div>

> 🚧 **Early / WIP — under active development, not production-ready yet.** The v1 core works (built and validated on Claude Code in real use across its model tiers) but is still evolving — config and routing behavior may change. Fine for experimentation and review; not yet something to rely on in production.

---

## 🚂 What CoalTipple is

A *tipple* is the sorting-and-rail-switching station at the mouth of a coal mine. This one switches rails for **prompts across models** — the dispatch layer of the **TheColliery** series (alongside [CoalMine](https://github.com/HetCreep/CoalMine)).

You are **main**. CoalTipple decides, per task, whether to:

| Direction | When | Why |
|---|---|---|
| **delegate-DOWN** | the task is something you *can* do, but it is large and mechanical | a cheaper tier does the bulk → you **save tokens** |
| **escalate-UP** | the task is beyond the current tier's competence (hard / sensitive) | a stronger tier does it right → you protect **quality** |
| **stay (route OFF)** | the task is small, or no valid model-ranking can be built | doing it yourself costs less than the overhead, and the router **never breaks** |

The routing logic lives in the skill itself (`SKILL.md`) — the model reads it and routes. There is no always-on background process making decisions for you.

---

## 📊 Benchmark — routing validated across every model tier

CoalTipple was driven *as* each model tier, and its routing decisions were scored against a fixed rubric: the tier ranking it builds (the Lock), plus four probe tasks — **A** delegate-down · **B** sensitive-never-down · **C** escalate-up · **D** big-context routed by difficulty.

| Probe | What it proves | Pass rate |
|---|---|---|
| **B — sensitive is never delegated down** | the safety gate (crypto · auth · secrets) holds | **7 / 7 tiers** |
| **C — escalate-up beyond competence** | quality is protected | 7 / 7 |
| **A — delegate-down + high effort** | tokens are actually saved | 7 / 7 |
| **D — strong tier + right context variant** | capacity is independent of capability | 7 / 7 |
| **Ranking (the Lock)** | correct tiers · version order · 256k as an orthogonal axis | 5 / 7 |

The **safety-critical gate held on every tier** — including Opus 4.6, which had failed this exact probe *before* the keyword-gate fix, confirming the fix generalized beyond its embedded example. The earlier A and D misses were both **Haiku-as-main** hitting one floor-tier rule ambiguity — a big mechanical task the rubric labels "delegate-down", for which the floor tier has no "down". A floor-rule sharpen resolved it: Haiku now routes A to self-inline and D to escalate-up, so A and D hold 7/7 (the fix is floor-specific; the other six mains were already clean and are unaffected). The remaining Ranking misses are the introspection-frozen model list — a main cannot enumerate models released after its own training cutoff — mitigated by the deterministic floor + modelTiers pins, not eliminated. Routing quality scales with the main model's capability — mid and heavy tiers were clean across every probe, while Haiku-as-main holds the safety gate but is a weaker routing configuration. Held-out runs on novel tasks reproduced the result.

*Method: each model tier drove the router against a fixed ranking + four-probe rubric, scored per model. **Measured 2026-06-14** (A and D re-validated 2026-06-15 after a floor-rule sharpen) on Claude Code across Haiku 4.5 · Sonnet 4.6 · Opus 4.6 / 4.7 / 4.8 (± 256k) · a reasoning tier — re-run as the model line-up changes.*

**Output quality — a second, complementary benchmark.** The probes above score the routing *decision*; a separate run scores the *delivered output* — does the work that reaches the user actually pass? Five hard + subtle tasks (one per domain: crypto · proof · research · legal · creative) were fired at four mains (Haiku→Sonnet · Sonnet→Opus · Opus 4.6/4.7→self), each escalating **one rung** and scored against an objective gold (code: a constant-time test run by `eval/score.mjs`; the rest: a rubric or a sourced fact). **Result: 20/20 — the +1 rung delivered correct output on every task, no climb needed** (cheap-tier-adequacy: escalating one rung is usually enough). Measured 2026-06-15; harness + raw deliverables in [`eval/`](eval/). *Caveat: every tier passed, so this run validates **delivery**, not the **climb-on-fail** path — that needs edge-of-competence tasks where +1 fails.*

---

## 🚀 Installation

**Claude Code — a native plugin:**

```bash
claude plugin marketplace add TheColliery/CoalTipple
claude plugin install coaltipple@coaltipple
```

That installs the skill, the discoverable `/coaltipple:stats | off | memory` commands, and the advisory conductor hook — **restart Claude Code to load it.** The shared global config and model ranking seed under `~/.claude/` (created only if absent; an update never overwrites your settings).

**Any other subagent-capable agent — cross-platform via the installer:**

```bash
git clone https://github.com/TheColliery/CoalTipple.git
node CoalTipple/scripts/install.mjs <agent|PATH>   # or `all` to auto-detect the agents configured in this repo
node CoalTipple/scripts/install.mjs --reset        # the ONLY path that restores factory config + ranking
```

A per-project override lives at `<project>/.claude/.coaltipple.json` (or run `configure.mjs --project`). Your config and refined ranking are preserved across every update — only `--reset` overwrites them.

### Verify (from a clone)

```bash
node scripts/verify.mjs   # gate: factory config ↔ schema · skill/conductor present · plugin/ dist in sync · keyword SSoT in sync
node scripts/test.mjs     # the zero-dependency test suite (fail-loud on a missing or orphan test file)
```

---

## 🎛️ The two knobs

Routing turns **two knobs**, and the order matters — **raise effort before you raise tier**:

| Knob | Axis | Scale |
|---|---|---|
| **TIER** | *correctness* — which model | coarse, burns scarce top-tier quota (`low < mid < heavy < reasoning`) |
| **EFFORT** | *size* — how much to produce / iterate | fine-grained and cheap (`low → max`) |

TIER tracks **difficulty and sensitivity**; EFFORT tracks **output size**. A 10-line crypto function wants a strong tier for *safety* but **low** effort — it is ten lines. A 1000-line mechanical scaffold wants a cheap tier with **high** effort. Burning the top tier on a tiny-but-hard task over-provisions correctness; burning maximum effort on it over-provisions size. The knobs stay independent.

### The qualityBar staircase

`qualityBar` (0–100, default **60**) is the **acceptable-quality bar** — a plain line the result must clear, not an opaque offset:

1. The task's **grade** picks the *starting* tier (the cheapest that could plausibly do it).
2. The worker runs, and its output is **verified against the task contract** with a domain-appropriate objective check — code is built / tested, text is checked for completeness and consistency, research claims are sourced, math is checked by substitution.
3. **Clears the bar → done.** **Below it → climb one rung** and verify again. **Far below, or out of attempts → jump to the top tier.** At the top and still failing → hand back to you honestly.

`0` means anything passes (stay cheapest always); `100` means almost nothing passes below the top (climb to the best every time). Both extremes *emerge* from the climb mechanism — nothing is hardcoded.

> Tune `qualityBar` by **risk, not by field**: raise toward ~85 for quality-critical or costly-to-rework work, lower toward ~45 for thrifty draft output. Per-**task** difficulty — including domain-hard work like proofs or crypto — is handled by the *grade*, not this bar, so a trivial edit in any field (even a one-line math fix) still starts cheap and saves tokens. The default **60** is *adequate-to-delegate*: low enough that cheaper tiers clear it on ordinary work (so delegate-down actually saves tokens), while main still integrates and escalates up to final quality when it matters.

---

## 🔒 The Lock — route correctly, or route off

Routing needs a valid model-ranking. The Lock guarantees CoalTipple is only ever in one of **two states**: *routing correctly* or *routing off* — never routing on a broken ranking.

- **Always buildable:** introspection first (the model classifies its own tiers — churn-proof, since a name table rots when a vendor ships a new model), an alias floor as a fallback, a stub as a last resort.
- **Validity-gated:** the ranking is checked (schema · hash · completeness) and written atomically. An unfamiliar or newly released model always classifies as `heavy`, never cheap.
- **Fails safe:** if a valid ranking genuinely cannot be built, routing turns **OFF** and CoalTipple runs as a normal single agent. The skill self-heals in `SKILL.md` — it does not depend on the installer having run.
- **Cheap to keep fresh:** a cached ranking is trusted until `rankingRefreshDays` (default 30). The live model list is only re-enumerated on that cadence, on a miss, or when a model not in the ranking is noticed — never per session. A failed spawn (a model gone / renamed / disabled / out of quota) is a free, accurate signal to fall to the next tier and rebuild.

Because every staleness mode degrades **safe** (unknown → `heavy`, listed-but-gone → spawn-fails-then-falls, unsure → over-provision), a rare freshness check is enough. For full deterministic control, `rankingMode: manual` hands the ranking to a human via `modelTiers` pins.

---

## 🛡️ Routing the work safely

- **Sensitive work is never delegated down — and this does not depend on the grade.** Anything touching crypto, timing-attacks, auth, payments, secrets, tokens, sessions, or security is gated on the *keyword*, not the grade, because a weaker main under-grades sensitive work and would slip past a grade-gated rule. For sensitive tasks: escalate up, keep it on main, or use a vetted built-in — never hand-rolled security on a cheaper tier. This holds under a quota / limit-hit too: a sensitive task waits for reset or hands back rather than falling to a cheaper tier.
- **Delegate-down has a floor.** Spawning a worker costs tens of thousands of tokens of fixed overhead. Delegate down only when doing the task yourself would cost far more than that (`delegateMinLines`, default 120) — small-to-medium tasks stay on main, because offloading them loses tokens.
- **The deliverable's voice stays on main.** A final user-facing translation, summary, or write-up is never delegated to a cheaper model, even when it is bulky — reviewing prose to protect voice and terminology costs about as much as redoing it. Bulk *mechanical* work (renames, codegen, formatting) is still delegate-able.
- **Verify, do not eyeball.** A worker's output may look right but be wrong. The merge-verify *runs* the objective check — it does not read the code and reason about whether it looks correct. (`qaOnMerge`: strict / standard / off.)
- **Workers are leaves (for now).** On the verified build a worker has no subagent-spawn tool, so it cannot nest; main spawns, and a worker that fails returns its result for main to re-route. The cap is enforced but **not assumed permanent**: a newer Claude Code build could expose nested subagents, so it is treated as temporary and re-verified on each update. <!-- version-transition: worker=leaf is Claude-Code-build-coupled; re-verify the no-spawn-tool cap on each CC update (1.0.4 reworded this from a permanent 'hard-capped' claim to 'enforced, not assumed permanent'). -->

### Damage control — control the damage, not the limit

A rate-limit is uncontrollable; the blast radius of a mid-run death is not.

- A file-mutating delegation in a git repo prefers **worktree-isolation** (a kill discards the worktree, real files stay pristine); the `<project>/.claude/.coaltipple/proposed/` sandbox plus a `state.json` journal is the **git-agnostic** fallback (a resume skips the finished subtasks).
- A **limit-hit fallback** walks *down* the ranking to the next available tier (the availability move — the opposite of the quality climb) — within-tier first, then a tier down — but **never below a sensitive task's safe-minimum tier**.
- A step with a **side-effect** (a bash mutation, an external call, a commit) is never delegated and never retried — a retry runs it twice, and bash is not checkpointed.

---

## 🧠 Memory anchor

A worker starts **context-fresh** — it sees only the task contract, not the conversation so far. A *memory anchor* (the project's own memory/conventions file) gives a fresh worker context beyond the bare contract so delegation does not drop project knowledge.

- If `contextFiles` names file(s), those are the anchor and the worker contract points at them. If it is empty, CoalTipple relies on the platform's own memory (it auto-loads `CLAUDE.md` / `AGENTS.md`).
- When you are about to delegate context-dependent work and *no* anchor exists, CoalTipple **offers once** (never spam) to set one up — Create a memory file, Choose an existing one, or Skip (persisted). After that, every change is user-pulled via `/coaltipple memory`. An existing anchor is loaded and appended to, **never clobbered**.

---

## ⚙️ Configuration (.coaltipple.json)

CoalTipple ships zero-config: sensible, token-thrifty, safe defaults that work out of the box. Every value is tunable, and the schema is the single source of truth.

- **Config lives in two levels.** A **global** `~/.claude/.coaltipple.json` holds your defaults for every project; an **optional per-project** `<project>/.claude/.coaltipple.json` overrides it. Precedence is **project → global → schema default** (a per-key shallow merge). A project file is created only when you customize one — a global install never clutters a project. Everything CoalTipple writes lives under `.claude/` (mirroring CoalMine): the global config and the shared model **ranking** sit at `~/.claude/`, the project override and per-project work-state at `<project>/.claude/`. The ranking is platform-level, so it is built once globally and shared across every project — nothing is left loose at a project root.
- **The schema is the SSoT.** Every key is defined, typed, and range-checked in [`scripts/lib/config-schema.mjs`](scripts/lib/config-schema.mjs); `scripts/verify.mjs` validates the factory config against it, so a typo'd key or out-of-range value fails loud. The shipped factory config is fully commented — every key carries its purpose, type, and default inline.

Representative keys (see the schema for the complete, authoritative list):

| Key | Type | Default | What it does |
|---|---|---|---|
| `enableRouting` | Boolean | `true` | Master on/off for all routing |
| `mode` | Enum | `auto` | Direction: `delegation` (down for tokens) · `escalation` (up for quality) · `auto` · `off` |
| `qualityBar` | Integer 0–100 | `60` | The acceptable-quality bar that drives the staircase |
| `maxTotalAttempts` | Integer 1–5 | `2` | Staircase budget — rungs to try before jump-to-top / hand-back |
| `delegateMinLines` | Integer | `120` | Spawn-overhead break-even floor below which delegate-down is skipped |
| `qaOnMerge` | Enum | `standard` | Merge-verify rigor: `strict` · `standard` · `off` |
| `rankingMode` | Enum | `auto` | `auto` = the agent introspects the ranking · `manual` = the human owns it via `modelTiers` |
| `modelTiers` | Object | unset | Optional human pins overriding auto-classification |
| `sensitivePaths` | String[] | `[]` | Path fragments that force the strong tier |
| `keywords` | Object | built-in | Careful-keyword GROUPS by task type (`coding.concurrency`/`crypto`/`security`/`data`, `math`, `knowledge`, `domain`, `creative`): each floors the grade + may flag `sensitive` (never-down) / `preserveVoice`; tune a word or a grade per group |
| `contextFiles` | String[] | `[]` | Memory-anchor file(s) a fresh worker reads |

Edit it from the CLI with the configurator (schema-driven flags, validated, comment-preserving):

```bash
node scripts/configure.mjs --list                        # show the merged effective config
node scripts/configure.mjs --qualityBar 85               # raise the global bar
node scripts/configure.mjs --project --mode delegation   # write a per-project override
node scripts/configure.mjs --help                        # every flag, generated from the schema
```

---

## 🤖 Compatibility

**Claude Code: first-class and validated in real use (verified on Claude Code 2.1.143).** CoalTipple was built Claude-Code-first and run end-to-end on it across *every* model tier (Haiku, Sonnet, Opus, and a reasoning tier) — driving real delegate-down, escalate-up, and limit-hit routing during development.

CoalTipple targets **subagent-capable platforms only** — it routes by spawning workers through the platform's *own* native subagent tool (under that platform's own permission gate; CoalTipple does not bypass it). On a platform without a subagent system, the skill **self-degrades to a no-op** — routing simply stays off, and nothing breaks. `SKILL.md` follows the cross-vendor [Agent Skills](https://agentskills.io/specification) convention, so it lands on any agent that reads skills; per-platform model classification and spawn encoding are the parts verified in real use as the project reaches each new agent.

---

## 🧭 Part of TheColliery

CoalTipple shares its engineering doctrine with [CoalMine](https://github.com/HetCreep/CoalMine): Phoenix-13 hooks (zero-dependency, no network, fail-silent, no child processes, deterministic), a single-source-of-truth config schema, a fail-loud CLI paired with fail-silent hooks, source-grounded facts, and a strict no-overkill discipline. The conductor hook obeys Phoenix-13; the CLI scripts fail loud.

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.
