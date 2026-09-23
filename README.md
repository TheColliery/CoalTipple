<div align="center">

# 🚂 CoalTipple

> A *tipple* is the sorting-and-rail-switching station of a coal mine—this one switches rails for prompts across models.

**A model/effort router for Claude Code**—delegate a task you *can* do but that is large and cheap *down* to a cheaper tier to save tokens, and hand a task beyond your reach *up* to a stronger tier for quality.

Not the cheapest router by claimed savings—a cross-provider or empirical router can point to a bigger number on someone else's benchmark. The real difference is MECHANISM, not degree: CoalTipple's `qualityBar` staircase is **inspectable and local**—the contract lives in `SKILL.md`, the tier ladder and fall logic in `classify.mjs`, the config in your own file, all readable in this repo—not an **empirical claim** measured on someone else's workload that you have to trust. Newer entrants like Not Diamond Code (announced 2026-08-04) report large self-measured savings (their own figure: 20–65%) on their own benchmarks; we make no comparable claim, and place no number beside theirs. One mechanism difference that IS verifiable by reading this repo: CoalTipple's routing decision runs entirely in the agent's own context on local files—zero external network calls for the decision itself—unlike Not Diamond Code's own-documented architecture, where a local proxy sends per-step derived metadata to a remote optimization service for every routing call. That is a property of HOW the decision is made, not a claim about which result is better.

![version](https://img.shields.io/github/v/tag/TheColliery/CoalTipple?label=version&color=blue)
![license](https://img.shields.io/badge/license-Apache_2.0-blue)
![status](https://img.shields.io/badge/status-live-brightgreen)
![SKILL.md](https://img.shields.io/badge/SKILL.md-open_standard-success)

![Claude Code](https://img.shields.io/badge/Claude_Code-validated-brightgreen)
![Antigravity](https://img.shields.io/badge/Antigravity-non--actuating-lightgrey)
![Cursor](https://img.shields.io/badge/Cursor-candidate-orange)
![Codex](https://img.shields.io/badge/Codex-non--actuating-lightgrey)
![Gemini CLI](https://img.shields.io/badge/Gemini_CLI-non--actuating-lightgrey)
![Cline](https://img.shields.io/badge/Cline-non--actuating-lightgrey)
![Windsurf](https://img.shields.io/badge/Windsurf-non--actuating-lightgrey)
![Copilot CLI](https://img.shields.io/badge/Copilot_CLI-candidate-orange)
![claude.ai](https://img.shields.io/badge/claude.ai-non--actuating-lightgrey)

*Tier key: **non-actuating**—the platform cannot run CT's routing AS SHIPPED (most have no per-worker model-pick at all; Antigravity is the one exception with a real per-spawn tier pick that still doesn't map onto CT's design—see the caution below) · **candidate**—a worker model-pick is documented but unverified live (monthly review, not a supported install). Further candidates (Zed · OpenCode · Devin · Kiro) are listed in [Install](#-install).*

[Benchmark](https://github.com/TheColliery/.github/tree/main/benchmarks/CoalTipple) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [Security](SECURITY.md) · [Privacy](PRIVACY.md) · [Releases](https://github.com/TheColliery/CoalTipple/releases)

**Docs:** [thecolliery.gitbook.io/thecolliery-docs/tools/coaltipple](https://thecolliery.gitbook.io/thecolliery-docs/tools/coaltipple) *(publishing soon)*

**Part of [TheColliery](https://github.com/TheColliery)**—siblings: **[CoalMine](https://github.com/TheColliery/CoalMine)** (quality canaries) · **[CoalBoard](https://github.com/TheColliery/CoalBoard)** (consensus & debate board) · **[CoalHearth](https://github.com/TheColliery/CoalHearth)** (session warm-resume) · **[CoalFace](https://github.com/TheColliery/CoalFace)** (fan-out discipline) · **[CoalWash](https://github.com/TheColliery/CoalWash)** (memory defrag) · **[CoalLedger](https://github.com/TheColliery/CoalLedger)** (docs health) · **[CoalGob](https://github.com/TheColliery/CoalGob)** (OS-trash delete guard, PUBLIC BETA v0.1.0-beta.1).

</div>

---

> [!CAUTION]
> **Claude Code only.** CoalTipple's routing only actuates where an agent can pick a spawned worker's model + effort. Today that is **Claude Code**. **Antigravity does NOT ship CT** -- `invoke_subagent` DOES take a per-spawn `Model` tier (proven by a live spawn, 2026-08-04), but that tier selects a GOOGLE model regardless of the parent's vendor, and no effort knob exists anywhere in its schema. CT's never-down gate, qualityBar staircase, and Claude alias floor don't map onto a cross-vendor Google tier ladder -- a different, unbuilt product, not a missing spawn param. Other platforms (Codex, Cursor, ...) are under monthly review.

---

## 🚂 What it is

A *tipple* is the sorting-and-rail-switching station of a coal mine. This tool switches rails for **prompts across models** (alongside [CoalMine](https://github.com/TheColliery/CoalMine)).

You are **main**. CoalTipple decides, per task, whether to:

| Direction | When | Why |
|---|---|---|
| **delegate-DOWN** | Task is mechanical and large | A cheaper tier does the bulk → **saves tokens** |
| **escalate-UP** | Task is beyond the current tier's competence | A stronger tier does it right → protects **quality** |
| **stay (route OFF)** | Task is small / no valid ranking | Bypasses routing to prevent overhead |

*Routing logic lives inside `SKILL.md`—the model reads and routes natively. No background daemon.*

---

## 🤖 Compatibility

* **Claude Code (validated live across the 2.1.x line):** Built Claude-Code-first and run end-to-end across all model tiers (Haiku, Sonnet, Opus). Routing degrades safe on any CC version—an unfamiliar model classifies strong, a failed spawn falls, and the platform resolves each alias to its current best model at spawn-time (the ranking is the alias floor + pins—nothing to enumerate).
* **Routing actuates on Claude Code only:** CT needs a platform where an *agent* can pick a spawned worker's model + effort. CC's Agent/Task tool takes a `model` param -- that is the requirement.
* **Subagent-capable != qualifies:** a model choice alone isn't enough either -- **Antigravity** DOES let the agent pick a per-spawn model tier (`invoke_subagent`'s `Model` field, proven live 2026-08-04), but that tier is a cross-vendor Google model regardless of the parent's own vendor, and carries no effort knob. CT's never-down gate, qualityBar staircase, and Claude alias floor don't map onto that shape -- a different, unbuilt product, not a missing spawn param -- so CT is gated to CC. Other platforms (Cursor · Zed · OpenCode · Devin · Kiro · Copilot CLI, …) are under monthly review—see Install → Other platforms for the current matrix.

### Surfaces

CoalTipple is **Claude-Code-only, by product judgement, not oversight**—the design needs a platform where an *agent* can pick a spawned worker's model *and* effort, and that is the requirement every surface below is checked against:

* **Claude Code (validated)**—the surface this room is built and dogfooded on; see the line above.
* **Cowork** runs a plugin's hooks and sub-agents, but this room has **not verified** it here: whether Cowork's own agent-spawn surface accepts a worker `model` parameter—the one thing routing needs—is unknown from this repo. Not claimed to work; not claimed to fail. Unverified, stated plainly rather than left silent.
* **claude.ai (chat)** loads only the skill's prose—there is no Agent/Task tool at all on that surface, so CoalTipple's routing has nothing to actuate through. See [Other platforms](#other-platforms--no-install-routing-cannot-actuate) below for the full reasoning.

---

## 🚀 Install

CoalTipple installs on **Claude Code only**—routing actuates only where an agent can pick a spawned worker's model + effort, and Claude Code's `Agent`/`Task` tool is the one that takes a `model` parameter.

### Claude Code — plugin

```bash
claude plugin marketplace add TheColliery/CoalTipple
claude plugin install coaltipple@coaltipple
# Restart Claude Code to load the /coaltipple commands (stats | off | memory | update)
```

Optional per-project config override, first-found wins: `<project>/.claude/coal/coaltipple.json` → `.agents/coal/coaltipple.json` → `.gemini/coal/coaltipple.json` → two deprecated legacy paths (`.claude/.coaltipple.json`, then `.coaltipple.json` at the git root; see Configure below).

### Other platforms — no install (routing cannot actuate)

There is deliberately **no file-copy or `install.mjs` path** for other agents: none gives CT what it needs to ship as designed -- most have no worker model-pick at all, and the one exception (Antigravity) picks a cross-vendor tier with no effort knob (see [Compatibility](#-compatibility) for the full reason).

* **Antigravity**—**does not ship CT, but not for the reason previously stated here.** The 2026-06-16 note that AG has "no per-spawn model parameter" was wrong, or went stale -- we cannot tell which from here. Re-verified 2026-08-04 by reading the live tool schema and running a real spawn: `invoke_subagent`'s `Model` field (`inherit` / `flash_lite` / `flash` / `pro`) DOES let the agent pick a per-spawn tier at invocation time (the earlier check only looked at `define_subagent`, which has no such field) -- a Claude Opus 4.6 parent spawned a Gemini 2.0 Flash child by naming `Model: "flash"`. What IS still true, confirmed the same day: **no effort knob exists anywhere in the schema.** CT still does not install here: the `Model` enum selects a GOOGLE tier regardless of the parent's own vendor -- a cross-vendor handoff, not a cheaper same-family worker -- and CT's never-down gate, qualityBar staircase, and Claude alias floor (haiku<sonnet<opus<fable) don't map onto that shape. A tier-only, cross-vendor AG lane would be a different, unbuilt product under CT's name, not a missing install step.
* **Codex · Gemini CLI · Cline · Windsurf**—no worker model-pick → not supported.
* **Cursor**—reports a worker `model` param but it is **unverified**; a monitored candidate under monthly review (verify the spawn schema first), not a supported install today.
* **Zed · OpenCode · Devin · Kiro · Copilot CLI**—**candidates—docs-verified 2026-07-13; a live spawn-schema verify on a real install is REQUIRED before any adapter** (the Antigravity burn rule: docs-claimed ≠ actuating). What the docs show: Zed `agent.subagent_model` · OpenCode per-agent `model` (`provider/model-id`) · Devin subagent `model` frontmatter (+ an Adaptive auto-router) · Kiro a subagent model attribute · Copilot CLI **partial** (a profile pin works, but the Task-tool `model` param has an open upstream bug and a cost-guard silently downgrades sub models).
* **Adapter design, locked ahead of any verify:** pre-provisioned pins—define per-tier pinned subagents (the Codex pattern: per-agent config files carrying a pinned model), so routing = picking the agent, no per-spawn model param needed; it ships only after a live schema verify on a real install.
* **claude.ai**—see [Surfaces](#surfaces) above: no Agent/Task tool exists on that surface, so a routing skill has nothing to actuate through.

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
| **TIER** | *correctness*—which model | Coarse (`low < mid < heavy < reasoning`) |
| **EFFORT** | *size*—output volume / iteration | Fine-grained (`low → max`) |

* TIER tracks **difficulty/sensitivity**; EFFORT tracks **output size**. A short cryptographic function wants a high tier but low effort. A large mechanical template wants a cheap tier but high effort.

### The qualityBar Staircase

`qualityBar` (0–100, default **60**) defines the acceptable quality threshold:
1. The task's **grade** picks the starting tier (cheapest possible).
2. The worker runs, and output is verified against the task contract.
3. **Passes → done. Fails → climb one rung.** Out of attempts/fails hard → jump to top tier.
* Tune `qualityBar` by risk: raise (~85) for critical logic; lower (~45) for quick drafts.
* This is the inspectable, local mechanism named above—the contract and the code that implements it live in this repo, not a benchmark number you have to trust.

---

## 🛡️ Routing the Work Safely

* **No Down-Delegation for Sensitive Tasks:** Cryptography, auth, payments, and security paths are forced to the `heavy` tier based on keywords. They never fall to cheap tiers, even under quota limits—and a `modelTiers` pin naming a known-weaker model (e.g. `haiku`) can never satisfy that floor either.
* **Overhead Floor:** Tasks below `delegateMinLines` (default 120) stay on main to avoid spawn overhead.
* **Prose Preservation:** User-facing writing and translation stay on main to protect voice.
* **Verify, Do Not Eyeball:** Output merges require passing objective checks (`qaOnMerge`: strict/standard/off).
* **Workers are Leaves:** By policy a worker is given a bounded task contract and returns to main rather than spawning its own workers—routing stays depth-0 whether or not the platform allows nesting.

### Damage Control

* **Isolation:** Uses git worktree-isolation (or local `.claude/.coaltipple/proposed/` sandbox with `state.json` journaling) to protect files from mid-run failures.
* **Rate Limits:** Automatically falls back to the next available tier on limit-hits, but never below a sensitive task's minimum tier.
* **Side Effects:** Commands with external side-effects (e.g. bash mutations, commits) are never delegated.

---

## 🔒 The Lock — Safe Routing States

The Lock guarantees CoalTipple is only ever in one of two states: *routing correctly* or *routing off*.
* **Always Buildable:** The ranking is the alias floor `haiku < sonnet < opus < fable` (→ `low/mid/heavy/reasoning`; `reasoning` = `fable`, the top rung above opus—a real-money spawn that is consent-gated, see `fableConsent`) overlaid with your `modelTiers` pins—a constant, no enumeration. Unknown models default to `heavy`.
* **Validity-Gated:** Checks ranking schema, hash, and completeness before writing.
* **Fails Safe:** Bypasses routing if the model ranking is broken.
* **Spawn-Time Resolution:** The platform resolves each alias to its current best model at spawn-time, and a failed spawn falls to the next available tier—so the floor never goes stale and there is no refresh cadence.

---

## 🧠 Memory Anchor

Workers start context-fresh. A **memory anchor** file gives a fresh worker project context.
* If `contextFiles` is empty, CoalTipple auto-loads `CLAUDE.md` / `AGENTS.md`.
* Offers once to set up an anchor on new projects. Manage manually via `/coaltipple memory`.

---

## Commands

| Command | What it does |
|---|---|
| `/coaltipple` | Manually load the routing contract for this turn (routing is normally automatic via the hook; useful after `/coaltipple off`) |
| `/coaltipple stats` | Approximate token savings + delegate-down / escalate-up activity this session |
| `/coaltipple off` | Turn routing off for this session—work as a normal single agent |
| `/coaltipple memory [on\|off\|set <file>]` | Set up or change the memory anchor a fresh worker reads |
| `/coaltipple update` | Check for a newer CoalTipple version and offer to apply it, or set how updates are handled |

---

## 🧪 Try it

Three real prompts, put through the shipped grader so nothing below is invented—`node scripts/grade-task.mjs --prompt "<text>" [--size-units N]` prints `grade()`'s own verdict as JSON, plus the `suggestedModel`/`modelSource` metadata read from the local ranking—advisory-only, and never touches effort or a routing decision:

| Prompt | Command | Output |
|---|---|---|
| **delegate-down** (mechanical bulk) | `node scripts/grade-task.mjs --prompt "Rename the userId field to accountId across the codebase and update every call site" --size-units 400` | `{"grade":2,"tier":"low","reasons":["content: 400 units"],"sensitive":false,...}` |
| **escalate-up** (real difficulty) | `node scripts/grade-task.mjs --prompt "Prove this numerical algorithm converges by working through the formal mathematical proof step by step"` | `{"grade":5,"tier":"reasoning","reasons":["keyword math(5):mathematical proof"],"sensitive":false,...}` |
| **sensitive, never-down** | `node scripts/grade-task.mjs --prompt "Write the function that verifies an auth token signature before granting access"` | `{"grade":4,"tier":"heavy","reasons":["keyword security(4):token"],"sensitive":true,...}` |

The grader only decides the *starting* tier from the prompt text—everything past that point is `SKILL.md`'s behavior, not something this table observed: a delegate-down grade like the first row routes the mechanical bulk to a cheaper worker; the sensitive third row can still climb the staircase but never falls below its graded `heavy` start; and a climb that reaches the fable rung stops at a consent ask before it spends real money—unless `fableConsent` is already `true`.

**Turn it off:** `/coaltipple off` disables routing for this session only. `enableRouting: false` in this project's `.coaltipple.json` disables it for the whole project.

---

## ⚙️ Configure

Everything is tunable in `.coaltipple.json`—a global `~/.claude/.coaltipple.json` overlaid per key by the first-found project config (`<gitroot>/.claude/coal/coaltipple.json` → `.agents/coal/coaltipple.json` → `.gemini/coal/coaltipple.json` → deprecated `.claude/.coaltipple.json` → deprecated `.coaltipple.json`; project wins), so you can **tune or shut off a globally-installed skill per project** (off-switch: `enableRouting: false`)—a skill you don't need in a given project stops loading (and burning tokens) there. Ships zero-config with optimal defaults. The high-impact keys:

| Key | Default | What it does |
|---|---|---|
| `enableRouting` | `true` | Master routing switch |
| `mode` | `auto` | Direction: `delegation` (down) \| `escalation` (up) \| `auto` \| `off` |
| `qualityBar` | `60` | Quality threshold (0–100) for the staircase—raise (~85) for critical logic, lower (~45) for quick drafts |
| `delegateMinLines` | `120` | Minimum task size below which down-delegation is skipped (spawn-overhead floor) |
| `fableConsent` | `false` | Standing consent to route to the fable rung (the top rung above opus, a real-money spawn) without asking each time. Unset/`false` = ask once per fable escalation (once / always-this-project / no); `no` caps the climb at the top non-fable rung (opus today—read from the ranking). Set per-project: `configure.mjs --project --fableConsent true` |
| `modelTiers` | unset | Optional pins overlaying the alias floor (e.g. `{ "reasoning": ["future-top-model"] }`)—the one human override for a model the agent cannot see; an unavailable pin falls safely down the ladder at spawn-fail |

Full key reference: every key + default lives in [`scripts/lib/config-schema.mjs`](scripts/lib/config-schema.mjs) and the commented template [`platform-configs/.coaltipple.json`](platform-configs/.coaltipple.json)—or run `node scripts/configure.mjs --help`.

**Deprecated project-config paths.** `<gitroot>/.claude/.coaltipple.json` and `<gitroot>/.coaltipple.json` are still read (in that order, after the three canonical paths), so nothing that worked stops working, but both are deprecated. Move the file to `<gitroot>/.claude/coal/coaltipple.json`, or run `node scripts/configure.mjs --project <key> <value>`, which writes the canonical file (seeded from the legacy one when it does not exist yet). **A legacy file the tool did not read is never deleted:** it is renamed aside to `<path>.superseded` (numbered on a collision) with its contents kept, so a mistake costs a rename, not a file, and only the one legacy file it read as the seed is removed; each path removed or moved is printed, and a `.superseded` file is yours to delete. `node scripts/install.mjs --reset` likewise writes the canonical file, never a legacy path, and renames every legacy file aside. **Window:** deprecated as of 1.6.0 (a MINOR release), removable no sooner than the next MAJOR release, never on a calendar. **Owner of the migration:** this repo (CoalTipple). **Where you are told:** here and in the [CHANGELOG](CHANGELOG.md)'s `### Deprecated` entry, plus one runtime line: when a legacy file is the one that was read, the conductor's session-start message carries a single `LEGACY:` note, and a config sitting at a path CoalTipple never reads (ten fixed near-miss spots under the git root, no directory crawl) is named with an `IGNORED:` line instead of being silently skipped. Both appear at session start only, never per prompt, and not at all while routing is off. **No louder warning is coming:** the hook may speak only through three sanctioned surfaces (Phoenix Commandment #13), and the session-start context is one of them; a stderr warning or console nag is not, so it does not exist.

---

## 🔧 Troubleshooting

* **First check:** is routing running at all? `enableRouting: false` (global or project) turns it off entirely; `/coaltipple off` turns it off for just this session.
* **State lives in files you can read** (same paths [Privacy](PRIVACY.md) documents): the config—`~/.claude/.coaltipple.json`, overlaid by the first-found of `<gitroot>/.claude/coal/coaltipple.json` → `.agents/coal/coaltipple.json` → `.gemini/coal/coaltipple.json` → the two deprecated legacy paths (see Configure)—and the model ranking at `~/.claude/coal/coaltipple/ranking.json`. A missing or broken ranking is rebuilt on the spot from the alias floor; only if it genuinely cannot be built does routing go off (see [The Lock](#-the-lock--safe-routing-states)).
* **A worker spawn failing** falls to the next available tier on its own (see [Damage Control](#damage-control))—no action needed unless every tier is unavailable, in which case the route hands back.

## 🗑️ Uninstall

Removing the **plugin** (`claude plugin uninstall coaltipple@coaltipple`) removes the skill, the conductor hook, and the four `/coaltipple` commands—the platform's own plugin-cache install, gone in one step.

Removing a **file-copy install** by deleting its `coaltipple/` skill directory removes only the skill. The conductor hook it seeded at `<gitroot>/.claude/.coaltipple/hooks/coaltipple-conductor.js` is a separate file outside that directory and is not touched—delete it by hand too if you wired it into your own settings.

Neither path removes, and neither ever has removed, your state—by design, so a reinstall recovers exactly where you left off:

* the config files (`~/.claude/.coaltipple.json` and any per-project override)
* the model ranking (`~/.claude/coal/coaltipple/ranking.json`)
* the self-update stamp (`~/.claude/coal/coaltipple/update-check`)
* the per-project `<gitroot>/.claude/.coaltipple/` directory (`proposed/` sandbox, `state.json` journal, and—for a file-copy install—the `hooks/coaltipple-conductor.js` copy named above)

Delete these by hand if you want a clean slate—they are plain files under `.claude/`, nothing hidden.

## More

[Privacy](PRIVACY.md) · [Security](SECURITY.md) · [Issues](https://github.com/TheColliery/CoalTipple/issues)

---

## Permissions

* **Reads** its own config/ranking and your project; **writes** only its own scratch state (a ranking cache, an update-check stamp)—never a target file.
* **The one defining right:** picking the model a spawned worker runs at—the whole mechanism. A worker gets strictly LESS: a bounded task contract, no re-spawning, no shell/network of its own.
* **Never** network, exec, or delete by itself; **always asks** before spending real money (the `fableConsent` gate before the fable rung) or anything else beyond read+scratch—you, main, execute it on your own tools.

Full series matrix + the must-fail set: [Permission Matrix](https://github.com/TheColliery/.github/blob/main/PERMISSION-MATRIX.md)

---

## 📊 Benchmark

We evaluate the **final output correctness** after the main escalates one rung, and the **token savings** of delegating mechanical bulk down—each dated, on small honest samples, in the linked record so a copied number cannot drift.

* **ON-vs-OFF (paired, 2026-07-03, v1.0.23):** the same 4 tasks at every tier (36 runs, K=3, Haiku 4.5/Sonnet 5/Opus 4.8)—**routing ON scored 4/4 task quality on both baselines; OFF scored 3/4 on both, failing a DIFFERENT task each** (an Opus main fails the boring spec's letter; a Sonnet main fails the sensitive legal nuance). From an Opus main ON is also **~23% cheaper**; from a Sonnet main it is cost-neutral and removes a liability-shifting translation error.

Full harnesses, per-task scoring, the quality-vs-tier matrix, routing-savings history, and every honest-scope caveat live in the series umbrella: [`TheColliery/.github/benchmarks/CoalTipple`](https://github.com/TheColliery/.github/tree/main/benchmarks/CoalTipple) ([RESULTS.md](https://github.com/TheColliery/.github/blob/main/benchmarks/CoalTipple/RESULTS.md) · [ROUTING-SAVINGS.md](https://github.com/TheColliery/.github/blob/main/benchmarks/CoalTipple/ROUTING-SAVINGS.md)).

---

## 🧭 Part of TheColliery

CoalTipple is the series' model/effort router, and it shares its engineering doctrine with seven siblings:

* [CoalMine](https://github.com/TheColliery/CoalMine)—quality canaries
* [CoalBoard](https://github.com/TheColliery/CoalBoard)—consensus & debate board
* [CoalHearth](https://github.com/TheColliery/CoalHearth)—session warm-resume
* [CoalFace](https://github.com/TheColliery/CoalFace)—fan-out discipline
* [CoalWash](https://github.com/TheColliery/CoalWash)—memory defrag
* [CoalLedger](https://github.com/TheColliery/CoalLedger)—docs health
* [CoalGob](https://github.com/TheColliery/CoalGob)—OS-trash delete guard (PUBLIC BETA v0.1.0-beta.1)

Install one, it stands alone; install all, they compose without conflict.

That doctrine: Phoenix-13 hooks (zero-dependency, no network, fail-silent, no child processes, deterministic), single-source-of-truth config schemas, and a strict no-overkill discipline—full series at [TheColliery](https://github.com/TheColliery).

Zero-dependency, offline by default, no API keys—"by default" because the consent-gated self-update check (`/coaltipple:update`) goes online; the hook never does.

## 📄 License

Apache License 2.0. See [LICENSE](LICENSE) for details.
