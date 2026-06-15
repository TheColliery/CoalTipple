# Contributing to CoalTipple

CoalTipple is the model/effort router of the [TheColliery](https://github.com/TheColliery) series (sibling to [CoalMine](https://github.com/HetCreep/CoalMine)). It is **early / WIP** -- the v1 core works and is validated, but config and routing behavior still evolve. Issues, dogfood reports, and PRs are all welcome.

## Supported platforms

CoalTipple is developed and validated against two agents. These are the platforms we support:

| Platform | Status |
|---|---|
| **Claude Code** | Validated live -- the most extensively dogfooded; the routing contract was hardened here across every model tier (see the benchmark in the [README](README.md)). |
| **Antigravity** | Supported target -- actively developed against. |

**Every other subagent-capable agent (Codex `·` Cursor `·` Amp `·` Copilot `·` Gemini `·` ...) is best-effort, not guaranteed.** CoalTipple is built to travel -- a platform-agnostic **CORE** (the routing doctrine, ~90% of the skill) plus a thin **per-platform adapter** (~10%: model classification, supported-effort levels, spawn encoding, and paths/commands). You *can* install and run it on other agents via `scripts/install.mjs`, and PRs that add or sharpen a platform are very welcome -- but until a platform has been **dogfooded**, we do not promise its routing is correct.

### Why support stops at "validated", and why `SKILL.md` is the crux

CoalTipple's load-bearing -- and most fragile -- surface is **`skills/coaltipple/SKILL.md`**, the routing contract the model reads and acts on. It is *behavioral*, not mechanical: **no compiler or unit test can prove a prompt routes correctly on a given model.** That reliability is *earned per platform through dogfooding* -- driving the router as each model tier on real tasks and sharpening the contract wherever a main mis-routes. Claude Code earned roughly ten such fixes that way; a different platform -- or even a weaker main on a supported one -- can rationalize around a soft rule until the contract is tightened for it.

Consequences for contributors:

- Treat `SKILL.md` as the **highest-risk file in the repo** -- a change there changes behavior on every platform at once.
- A `SKILL.md` change is **not "done" when tests pass** (tests cannot see routing quality). It is done when it has been **dogfooded** -- ideally across tiers on Claude Code -- and the result recorded.
- Keep routing rules **sharp and unambiguous**. A weaker main follows sharp rules and rationalizes around soft ones -- this is why, for example, the never-delegate-down safety gate keys on the *keyword*, not on the model's grade.

## Project layout

| Path | Role |
|---|---|
| `skills/coaltipple/SKILL.md` | The routing contract -- the heart. Platform-agnostic doctrine. |
| `scripts/lib/` | Deterministic helpers: `grade.mjs` (grading) `·` `classify.mjs` (the ranking Lock) `·` `keywords.mjs` (keyword SSoT) `·` `config-schema.mjs` (config SSoT) `·` `config-load.mjs` `·` `targets.mjs` (per-agent map). |
| `scripts/` | `install.mjs` (cross-platform install) `·` `configure.mjs` `·` `build-dist.mjs` (assemble the `plugin/` dist) `·` `verify.mjs` (the gate) `·` `test.mjs` (the test runner). |
| `hooks/coaltipple-conductor.js` | Advise-only SessionStart hook -- Phoenix-pure (zero-dep `·` fail-silent `·` no network `·` no side effects). Derived values are synced by the build; never hand-edit them here. |
| `plugin/` | The built Claude Code plugin dist -- generated, do not edit by hand. |
| `platform-configs/.coaltipple.json` | The shipped, fully-commented factory config. |

## Developing

CoalTipple is **zero-dependency** -- Node built-ins only (Node 18+); there is nothing to `npm install`.

Keep the gate green before and after any change:

```bash
node scripts/verify.mjs   # factory config <-> schema; skill/conductor present; plugin/ dist in sync; keyword SSoT in sync
node scripts/test.mjs     # the zero-dep test suite (node --test; fail-loud on a missing or orphan test file)
```

House rules (most are gate-enforced):

- **`keywords.mjs` is the single source of truth** for routing keywords. Edit it there, re-sync the conductor (`node scripts/build-plugin.mjs`), then rebuild the dist (`node scripts/build-dist.mjs`); `verify.mjs` fails if the conductor's derived lists drift -- never hand-edit those lists.
- **The `plugin/` dist must stay in sync** with source. Rebuild after touching the skill, hooks, or manifest; the gate checks both directions (nothing stale, nothing shipped without a source).
- **Every shared helper has a `*.test.mjs`** runnable with `node --test`. Add or update the test with the logic -- the runner fails loud on a missing file.
- **Hooks stay Phoenix-pure**: zero-dep, fail-silent (wrap in try/catch, never a non-zero exit, never `process.exit()`), no network, no side effects.
- **Shipped text is English and general.** `SKILL.md`, the README, config comments, and this guide run on strangers' machines -- never assume a specific user's setup. The router adapts to the user's language at *runtime*; the source stays English.

## Proposing a change

1. **Open an issue first** describing the problem or routing gap -- especially for anything touching `SKILL.md`.
2. Make the change; keep `verify.mjs` + `test.mjs` green.
3. For a routing / `SKILL.md` change, **dogfood it on Claude Code** and describe the result (which tiers, which probes held).
4. Open a PR with a clear description and that evidence.

## Releasing (maintainers)

Bump `.claude-plugin/plugin.json` -> add a `CHANGELOG.md` entry (Keep a Changelog) -> `verify.mjs` + `test.mjs` green -> commit -> annotated, signed tag `vX.Y.Z` -> push -> publish a GitHub Release for the tag (notes from the changelog). Tags cover beta + stable; Releases are stable-only.

## License & conduct

Contributions are under the repo's [MIT License](LICENSE). Assume good faith and be respectful. For security-sensitive reports, see [SECURITY.md](SECURITY.md).
