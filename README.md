<div align="center">

# 🚂 CoalTipple

**A model/effort router for Claude Code** — delegate a task you *can* do but that is large and cheap *down* to a cheaper tier to save tokens, and hand a task beyond your reach *up* to a stronger tier for quality.

![version](https://img.shields.io/github/v/tag/TheColliery/CoalTipple?label=version&color=blue)
![license](https://img.shields.io/badge/license-MIT-blue)
![SKILL.md](https://img.shields.io/badge/SKILL.md-open_standard-success)
![Claude Code](https://img.shields.io/badge/Claude_Code-validated-success)
![status](https://img.shields.io/badge/status-live-brightgreen)

[Changelog](CHANGELOG.md) · [Security](SECURITY.md) · [Privacy](PRIVACY.md) · [Releases](https://github.com/TheColliery/CoalTipple/releases)

**Part of [TheColliery](https://github.com/TheColliery)** — sibling: **[CoalMine](https://github.com/HetCreep/CoalMine)**.

</div>

✅ **Live -- in real use on Claude Code.** The v1 core is validated on **Claude Code** (across the 2.1.x line) and active; the conductor hook fires a routing forcer on every prompt.

> [!CAUTION]
> **Claude Code only.** CoalTipple's routing only actuates where an agent can pick a spawned worker's model + effort. Today that is **Claude Code**. **Antigravity does NOT work** -- its subagents inherit the parent's model (no per-spawn model parameter, no separate effort knob), so routing cannot actuate there. Other platforms (Codex, Cursor, ...) are under monthly review.

---

## 🚂 What CoalTipple is

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

## 🚀 Installation

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

* **No Down-Delegation for Sensitive Tasks:** Cryptography, auth, payments, and security paths are forced to the `heavy` tier based on keywords. They never fall to cheap tiers, even under quota limits.
* **Overhead Floor:** Tasks below `delegateMinLines` (default 120) stay on main to avoid spawn overhead.
* **Prose Preservation:** User-facing writing and translation stay on main to protect voice.
* **Verify, Do Not Eyeball:** Output merges require passing objective checks (`qaOnMerge`: strict/standard/off).
* **Workers are Leaves:** Workers cannot spawn nested subagents; they return results to main.

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

## ⚙️ Configuration (.coaltipple.json)

Shops zero-config with optimal defaults. Precedence: **project override → global config → schema default**.

Key settings (see [`scripts/lib/config-schema.mjs`](scripts/lib/config-schema.mjs) for the full SSoT schema):

| Key | Type | Default | What it does |
|---|---|---|---|
| `enableRouting` | Boolean | `true` | Master routing switch |
| `mode` | Enum | `auto` | Direction: `delegation` (down) \| `escalation` (up) \| `auto` \| `off` |
| `qualityBar` | Integer 0–100 | `60` | Quality threshold for the staircase |
| `maxTotalAttempts` | Integer 1–5 | `2` | Staircase attempt budget before jumping to top tier |
| `delegateMinLines` | Integer | `120` | Minimum lines threshold for down-delegation |
| `qaOnMerge` | Enum | `standard` | Merge verification rigor (`strict` \| `standard` \| `off`) |
| `modelTiers` | Object | unset | Optional pins overlaying the alias floor (`{ tier: "model" }`) — the one human override for a model the agent cannot see |

### Configurator CLI

```bash
node scripts/configure.mjs --list                        # show merged config
node scripts/configure.mjs --qualityBar 85               # update global qualityBar
node scripts/configure.mjs --project --mode delegation   # write project override
node scripts/configure.mjs --help                        # view all schema-driven flags
```

---

## 📊 Benchmark — Routing & Output Correctness

We evaluate both routing decisions (the Lock and probe tasks) and final output correctness:

**Routing Decisions (Measured 2026-06-14/15, CoalTipple v1.0.3):**

| Probe Task | What it Evaluates | Pass Rate |
|---|---|---|
| **A: Delegate-down** | Large, mechanical tasks offloaded correctly | **7 / 7 tiers** |
| **B: Sensitive safety** | Crypto/auth tasks stay on heavy/main tier | **7 / 7 tiers** |
| **C: Escalate-up** | Tasks beyond main's tier escalate for quality | **7 / 7 tiers** |
| **D: Context routing** | Right model capacity mapped correctly | **7 / 7 tiers** |
| **Lock ranking** | Correct tier order classification | **5 / 7 tiers** |

**Output Correctness (+1 Rung Escalation):**

| Main Model | Escalation Rung | Task Domains (Crypto, Proof, Research, Legal, Voice) | Output Pass Rate |
|---|---|---|---|
| `Haiku` | ➡️ `Sonnet` | 5/5 tasks | **100%** |
| `Sonnet` | ➡️ `Opus` | 5/5 tasks | **100%** |
| `Opus 4.6` | ➡️ Self-inline | 5/5 tasks | **100%** |
| `Opus 4.7` | ➡️ Self-inline | 5/5 tasks | **100%** |

*Total: 20/20 PASS deliverables generated correctly.*

The full output-quality harness (tasks, scorer, results) lives in the series umbrella at [`TheColliery/.github/benchmarks/CoalTipple`](https://github.com/TheColliery/.github/tree/main/benchmarks/CoalTipple).

---

## 🧭 Part of TheColliery
CoalTipple shares its engineering doctrine with [CoalMine](https://github.com/HetCreep/CoalMine): Phoenix-13 hooks (zero-dependency, no network, fail-silent, no child processes, deterministic), single-source-of-truth config schemas, and a strict no-overkill discipline.

## 📄 License
MIT License. See [LICENSE](LICENSE) for details.
