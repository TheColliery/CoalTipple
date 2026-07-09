<div align="center">

# 🚂 CoalTipple

> A *tipple* is the sorting-and-rail-switching station of a coal mine — this one switches rails for prompts across models.

**A model/effort router for Claude Code** — delegate a task you *can* do but that is large and cheap *down* to a cheaper tier to save tokens, and hand a task beyond your reach *up* to a stronger tier for quality.

Not the cheapest router on the market — a cross-provider proxy can cut deeper by routing off Claude entirely. CoalTipple is the **safe, quality-gated router *inside* Claude Code**: every delegation clears a verify staircase, sensitive work has a hard never-down gate, and a broken ranking locks routing off rather than guessing.

![version](https://img.shields.io/github/v/tag/TheColliery/CoalTipple?label=version&color=blue)
![license](https://img.shields.io/badge/license-Apache_2.0-blue)
![status](https://img.shields.io/badge/status-live-brightgreen)
![SKILL.md](https://img.shields.io/badge/SKILL.md-open_standard-success)
![Claude Code](https://img.shields.io/badge/Claude_Code-validated-success)

[Benchmark](https://github.com/TheColliery/.github/tree/main/benchmarks/CoalTipple) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [Security](SECURITY.md) · [Privacy](PRIVACY.md) · [Releases](https://github.com/TheColliery/CoalTipple/releases)

**Part of [TheColliery](https://github.com/TheColliery)** — siblings: **[CoalMine](https://github.com/HetCreep/CoalMine)** (quality canaries) · **[CoalBoard](https://github.com/TheColliery/CoalBoard)** (consensus & debate board) · **[CoalHearth](https://github.com/TheColliery/CoalHearth)** (session warm-resume) · **[CoalFace](https://github.com/TheColliery/CoalFace)** (fan-out discipline) · **[CoalWash](https://github.com/TheColliery/CoalWash)** (memory defrag) · **[CoalLedger](https://github.com/TheColliery/CoalLedger)** (docs health).

</div>

---

> [!CAUTION]
> **Claude Code only.** CoalTipple's routing only actuates where an agent can pick a spawned worker's model + effort. Today that is **Claude Code**. **Antigravity does NOT work** -- its subagents inherit the parent's model (no per-spawn model parameter, no separate effort knob), so routing cannot actuate there. Other platforms (Codex, Cursor, ...) are under monthly review.

---

## 🚂 What it is

A *tipple* is the sorting-and-rail-switching station of a coal mine. This tool switches rails for **prompts across models** (alongside [CoalMine](https://github.com/HetCreep/CoalMine)).

You are **main**. CoalTipple decides, per task, whether to:

| Direction | When | Why |
|---|---|---|
| **delegate-DOWN** | Task is mechanical and large | A cheaper tier does the bulk → **saves tokens** |
| **escalate-UP** | Task is beyond the current tier's competence | A stronger tier does it right → protects **quality** |
| **stay (route OFF)** | Task is small / no valid ranking | Bypasses routing to prevent overhead |

*Routing logic lives inside `SKILL.md` — the model reads and routes natively. No background daemon.*

---

## 🤖 Compatibility

* **Claude Code (validated live across the 2.1.x line):** Built Claude-Code-first and run end-to-end across all model tiers (Haiku, Sonnet, Opus). Routing degrades safe on any CC version — an unfamiliar model classifies strong, a failed spawn falls, and the platform resolves each alias to its current best model at spawn-time (the ranking is the alias floor + pins — nothing to enumerate).
* **Routing actuates on Claude Code only:** CT needs a platform where an *agent* can pick a spawned worker's model + effort. CC's Agent/Task tool takes a `model` param -- that is the requirement.
* **Subagent-capable != qualifies:** a platform can spawn workers yet give the agent no model choice (e.g. **Antigravity**, where the worker inherits the parent's model). There CT does **not** cleanly self-degrade -- a weak main hallucinates a delegate-down it cannot perform -- so CT is gated to CC. Other platforms (Cursor, Codex) are under monthly review.

---

## 🚀 Install

**Claude Code only** — routing actuates only where an agent can pick a spawned worker's model + effort, and Claude Code's `Agent`/`Task` tool is the one that takes a `model` parameter. On any other platform (Antigravity, Codex, …) there is no install: a spawned worker inherits the parent model, so routing cannot actuate (other platforms are under monthly review — see [Compatibility](#-compatibility)).

### Claude Code plugin

```bash
claude plugin marketplace add TheColliery/CoalTipple
claude plugin install coaltipple@coaltipple
# Restart Claude Code to load the /coaltipple commands (stats | off | memory)
```

Optional per-project config override: `<project>/.claude/.coaltipple.json`.

### Verify (from clone)

```bash
node scripts/verify.mjs   # validates config, schemas, plugin files
node scripts/test.mjs     # runs zero-dependency unit tests
```

---

## 🎛️ The Two Knobs

Routing adjusts **two independent knobs** (always raise effort before tier):

| Knob | Axis | Scale |
|---|---|---|
| **TIER** | *correctness* — which model | Coarse (`low < mid < heavy < reasoning`) |
| **EFFORT** | *size* — output volume / iteration | Fine-grained (`low → max`) |

* TIER tracks **difficulty/sensitivity**; EFFORT tracks **output size**. A short cryptographic function wants a high tier but low effort. A large mechanical template wants a cheap tier but high effort.

### The qualityBar Staircase
`qualityBar` (0–100, default **60**) defines the acceptable quality threshold:
1. The task's **grade** picks the starting tier (cheapest possible).
2. The worker runs, and output is verified against the task contract.
3. **Passes → done. Fails → climb one rung.** Out of attempts/fails hard → jump to top tier.
* Tune `qualityBar` by risk: raise (~85) for critical logic; lower (~45) for quick drafts.

---

## 🛡️ Routing the Work Safely

* **No Down-Delegation for Sensitive Tasks:** Cryptography, auth, payments, and security paths are forced to the `heavy` tier based on keywords. They never fall to cheap tiers, even under quota limits — and a `modelTiers` pin naming a known-weaker model (e.g. `haiku`) can never satisfy that floor either.
* **Overhead Floor:** Tasks below `delegateMinLines` (default 120) stay on main to avoid spawn overhead.
* **Prose Preservation:** User-facing writing and translation stay on main to protect voice.
* **Verify, Do Not Eyeball:** Output merges require passing objective checks (`qaOnMerge`: strict/standard/off).
* **Workers are Leaves:** By policy a worker is given a bounded task contract and returns to main rather than spawning its own workers — routing stays depth-0 whether or not the platform allows nesting.

### Damage Control
* **Isolation:** Uses git worktree-isolation (or local `.claude/.coaltipple/proposed/` sandbox with `state.json` journaling) to protect files from mid-run failures.
* **Rate Limits:** Automatically falls back to the next available tier on limit-hits, but never below a sensitive task's minimum tier.
* **Side Effects:** Commands with external side-effects (e.g. bash mutations, commits) are never delegated.

---

## 🔒 The Lock — Safe Routing States

The Lock guarantees CoalTipple is only ever in one of two states: *routing correctly* or *routing off*.
* **Always Buildable:** The ranking is the alias floor `haiku < sonnet < opus` (→ `low/mid/heavy`, reasoning = `opus`) overlaid with your `modelTiers` pins — a constant, no enumeration. Unknown models default to `heavy`.
* **Validity-Gated:** Checks ranking schema, hash, and completeness before writing.
* **Fails Safe:** Bypasses routing if the model ranking is broken.
* **Spawn-Time Resolution:** The platform resolves each alias to its current best model at spawn-time, and a failed spawn falls to the next available tier — so the floor never goes stale and there is no refresh cadence.

---

## 🧠 Memory Anchor
Workers start context-fresh. A **memory anchor** file gives a fresh worker project context.
* If `contextFiles` is empty, CoalTipple auto-loads `CLAUDE.md` / `AGENTS.md`.
* Offers once to set up an anchor on new projects. Manage manually via `/coaltipple memory`.

---

## ⚙️ Configure

Everything is tunable in `.coaltipple.json` — a global `~/.claude/.coaltipple.json` overlaid per key by the project `<gitroot>/.claude/.coaltipple.json` (project wins), so you can **tune or shut off a globally-installed skill per project** (off-switch: `enableRouting: false`). Ships zero-config with optimal defaults. The high-impact keys:

| Key | Default | What it does |
|---|---|---|
| `enableRouting` | `true` | Master routing switch |
| `mode` | `auto` | Direction: `delegation` (down) \| `escalation` (up) \| `auto` \| `off` |
| `qualityBar` | `60` | Quality threshold (0–100) for the staircase — raise (~85) for critical logic, lower (~45) for quick drafts |
| `delegateMinLines` | `120` | Minimum task size below which down-delegation is skipped (spawn-overhead floor) |
| `modelTiers` | unset | Optional pins overlaying the alias floor (e.g. `{ "reasoning": ["fable"] }`) — the one human override for a model the agent cannot see; an unavailable pin falls safely down the ladder at spawn-fail |

Full key reference: every key + default lives in [`scripts/lib/config-schema.mjs`](scripts/lib/config-schema.mjs) and the commented template [`platform-configs/.coaltipple.json`](platform-configs/.coaltipple.json) — or run `node scripts/configure.mjs --help`.

---

## 📊 Benchmark

We evaluate the **final output correctness** after the main escalates one rung, and the **token savings** of delegating mechanical bulk down — each dated, on small honest samples, in the linked record so a copied number cannot drift.

* **ON-vs-OFF (paired, 2026-07-03, v1.0.23):** the same 4 tasks at every tier (36 runs, K=3, Haiku 4.5/Sonnet 5/Opus 4.8) — **routing ON scored 4/4 task quality on both baselines; OFF scored 3/4 on both, failing a DIFFERENT task each** (an Opus main fails the boring spec's letter; a Sonnet main fails the sensitive legal nuance). From an Opus main ON is also **~23% cheaper**; from a Sonnet main it is cost-neutral and removes a liability-shifting translation error.

Full harnesses, per-task scoring, the quality-vs-tier matrix, routing-savings history, and every honest-scope caveat live in the series umbrella: [`TheColliery/.github/benchmarks/CoalTipple`](https://github.com/TheColliery/.github/tree/main/benchmarks/CoalTipple) ([RESULTS.md](https://github.com/TheColliery/.github/blob/main/benchmarks/CoalTipple/RESULTS.md) · [ROUTING-SAVINGS.md](https://github.com/TheColliery/.github/blob/main/benchmarks/CoalTipple/ROUTING-SAVINGS.md)).

---

## 🧭 Part of TheColliery
CoalTipple shares its engineering doctrine with [CoalMine](https://github.com/HetCreep/CoalMine), [CoalBoard](https://github.com/TheColliery/CoalBoard), [CoalHearth](https://github.com/TheColliery/CoalHearth) (session warm-resume), [CoalFace](https://github.com/TheColliery/CoalFace) (fan-out discipline), [CoalWash](https://github.com/TheColliery/CoalWash) (memory defrag), and [CoalLedger](https://github.com/TheColliery/CoalLedger) (docs health): Phoenix-13 hooks (zero-dependency, no network, fail-silent, no child processes, deterministic), single-source-of-truth config schemas, and a strict no-overkill discipline. Install one and it stands alone; install all and they compose without conflict.

## 📄 License
Apache License 2.0. See [LICENSE](LICENSE) for details.
