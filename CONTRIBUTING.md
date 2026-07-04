# Contributing to CoalTipple

CoalTipple is the model/effort router of the [TheColliery](https://github.com/TheColliery) series. We welcome issues, bug reports, and pull requests.

---

## 🤝 Proposing a Change

1. **Open an issue first** describing the problem, routing gap, or proposed feature (especially for changes to `SKILL.md`).
2. Make your code changes and ensure the verification gates remain green.
3. For routing or `SKILL.md` changes, **dogfood it live** on Claude Code and document the routing behavior in your PR description.

---

## 💻 Developing & Testing

CoalTipple is **zero-dependency** (built using Node.js built-ins only, Node 18+). No `npm install` is required.

Keep the verification gates green before and after making edits:

```bash
# after editing a skill, hook, or manifest, rebuild the dist FIRST — verify checks dist-sync:
node scripts/build-plugin.mjs   # re-sync the conductor from keywords.mjs (the SSoT)
node scripts/build-dist.mjs     # compile plugin/ from source
node scripts/verify.mjs         # validates config schemas, plugins, and SSoT sync
node scripts/test.mjs           # runs the zero-dependency test runner (node --test)
```

### Development Rules
* **`keywords.mjs` is the Single Source of Truth:** Edit keywords there, run `node scripts/build-plugin.mjs` to re-sync the conductor, then `node scripts/build-dist.mjs` to compile the distribution. Do not hand-edit hooks directly.
* **Synchronize `plugin/`:** Rebuild the plugin distribution after modifying the core skill, hooks, or manifest.
* **Add Unit Tests:** Every shared helper should have a corresponding `*.test.mjs` test file.
* **Keep Hooks Phoenix-Pure:** Hooks must have zero dependencies, fail-silent execution (wrap in try/catch, never exit non-zero), and run 100% locally.
* **Language & Tone:** Shipped source files and documentations must stay in English.

---

## 🖥️ Supported Platforms

CoalTipple is **Claude Code only**. Routing actuates only where an agent can pick a spawned worker's model and effort — Claude Code's `Agent`/`Task` `model` parameter. Antigravity is confirmed unable to actuate it (a spawned subagent inherits the parent model — no model parameter, no effort knob), so it is not supported. Cursor, Codex, Gemini CLI, Cline, and Windsurf are unverified and under monthly review.

| Platform | Support Status |
|---|---|
| **Claude Code** | **Validated across the 2.1.x line** - Hardened across every model tier (Haiku, Sonnet, Opus); routing degrades safe on any CC version. |

*Note: `skills/coaltipple/SKILL.md` is the highest-risk file. Prompts cannot be validated via unit tests; changes must be verified through actual live agent dogfooding.*

---

## 🗂️ Project Layout

| Path | Purpose |
|---|---|
| `skills/coaltipple/SKILL.md` | The core routing contract (the load-bearing prompt). |
| `scripts/lib/` | Core logic modules: `grade`, `classify` (Lock ranking), `keywords` (SSoT), `config-schema`. |
| `scripts/` | Tool scripts: `install.mjs`, `configure.mjs`, `verify.mjs`, `test.mjs`. |
| `hooks/coaltipple-conductor.js` | Phoenix-pure conductor hook (SessionStart + UserPromptSubmit). Auto-synced by build scripts. |
| `plugin/` | Generated Claude Code plugin distribution. |
| `platform-configs/.coaltipple.json` | Commented factory default configuration. |

---

## 🚀 Releasing (Maintainers)

Bump version in `.claude-plugin/plugin.json` ➡️ Add a changelog entry in `CHANGELOG.md` ➡️ Ensure `verify.mjs` and `test.mjs` pass ➡️ Commit ➡️ Create a signed git tag (`vX.Y.Z`) ➡️ Push `--follow-tags` ➡️ Create a GitHub Release (stable tags only).

---

## 📄 License & Conduct

Contributions are licensed under the [Apache License 2.0](LICENSE). Please assume good faith and be respectful. Report security issues according to [SECURITY.md](SECURITY.md).
