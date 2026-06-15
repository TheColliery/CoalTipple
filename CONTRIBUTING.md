# Contributing to CoalTipple

CoalTipple is the model/effort router of the [TheColliery](https://github.com/TheColliery) series. We welcome issues, bug reports, and pull requests.

---

## 🤝 Proposing a Change

1. **Open an issue first** describing the problem, routing gap, or proposed feature (especially for changes to `SKILL.md`).
2. Make your code changes and ensure the verification gates remain green.
3. For routing or `SKILL.md` changes, **dogfood it live** on a supported platform (e.g. Claude Code) and document the routing behavior in your PR description.

---

## 💻 Developing & Testing

CoalTipple is **zero-dependency** (built using Node.js built-ins only, Node 18+). No `npm install` is required.

Keep the verification gates green before and after making edits:
```bash
node scripts/verify.mjs   # validates config schemas, plugins, and SSoT sync
node scripts/test.mjs     # runs the zero-dependency test runner (node --test)
```

### Development Rules:
* **`keywords.mjs` is the Single Source of Truth:** Edit keywords there, run `node scripts/build-plugin.mjs` to re-sync the conductor, then `node scripts/build-dist.mjs` to compile the distribution. Do not hand-edit hooks directly.
* **Synchronize `plugin/`:** Rebuild the plugin distribution after modifying the core skill, hooks, or manifest.
* **Add Unit Tests:** Every shared helper should have a corresponding `*.test.mjs` test file.
* **Keep Hooks Phoenix-Pure:** Hooks must have zero dependencies, fail-silent execution (wrap in try/catch, never exit non-zero), and run 100% locally.
* **Language & Tone:** Shipped source files and documentations must stay in English.

---

## 🖥️ Supported Platforms

| Platform | Support Status |
|---|---|
| **Claude Code** | **Validated Live** - Hardened across every model tier (Haiku, Sonnet, Opus). |
| **Antigravity** | **Supported Target** - Actively developed and tested against. |

Other subagent-capable agents (Codex, Cursor, Copilot, Gemini) are supported on a best-effort basis. The core logic (`SKILL.md`) is platform-agnostic, while per-platform model classifications are mapped via `scripts/lib/targets.mjs`. 

*Note: `skills/coaltipple/SKILL.md` is the highest-risk file. Prompts cannot be easily validated via unit tests; changes must be verified through actual live agent dogfooding.*

---

## 🗂️ Project Layout

| Path | Purpose |
|---|---|
| `skills/coaltipple/SKILL.md` | The core routing contract (platform-agnostic prompt). |
| `scripts/lib/` | Core logic modules: `grade`, `classify` (Lock ranking), `keywords` (SSoT), `config-schema`. |
| `scripts/` | Tool scripts: `install.mjs`, `configure.mjs`, `verify.mjs`, `test.mjs`. |
| `hooks/coaltipple-conductor.js` | Phoenix-pure SessionStart hook. Auto-synced by build scripts. |
| `plugin/` | Generated Claude Code plugin distribution. |
| `platform-configs/.coaltipple.json` | Commented factory default configuration. |

---

## 🚀 Releasing (Maintainers)

Bump version in `.claude-plugin/plugin.json` ➡️ Add changelog entry in `CHANGELOG.md` ➡️ Ensure `verify.mjs` and `test.mjs` pass ➡️ Commit ➡️ Create signed git tag (`vX.Y.Z`) ➡️ Push ➡️ Create a GitHub Release.

---

## 📄 License & Conduct

Contributions are licensed under the [MIT License](LICENSE). Please assume good faith and be respectful. Report security issues according to [SECURITY.md](SECURITY.md).
