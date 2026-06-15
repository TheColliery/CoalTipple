# Verifying CoalTipple

CoalTipple is verified under the same framework as **[CoalMine](https://github.com/HetCreep/CoalMine/blob/main/SECURITY.md)**: all execution hooks follow the [Phoenix-13 commandments](https://github.com/TheColliery/.github/blob/main/hooks-safety.md), builds are fully reproducible from source, and security scans run on each release.

---

## 🔒 Reporting a Vulnerability

To report a security issue in the skill, the conductor hook, or the installer:
* Open a GitHub issue at `github.com/TheColliery/CoalTipple` or request a private channel (avoid posting sensitive PoC logs in public).
* We will investigate and address reported issues promptly.

---

## 🔑 Commit & Tag Signatures

All commits and release tags are SSH-signed (`gpg.format=ssh`). Verified badges display automatically on GitHub.

Verify signatures locally:
```bash
# Setup allowed signers
git config gpg.ssh.allowedSignersFile ./coaltipple_signers

# Verify HEAD and latest tag
git verify-commit HEAD
git tag -v "$(git describe --tags --abbrev=0)"
```

---

## 📦 Dist Integrity

CoalTipple is distributed as source (human-auditable skill Markdown). The plugin distribution is generated at publish time:
* **Pre-commit/Pre-push Gates:** `node scripts/verify.mjs` automatically verifies config schema matching, files presence, and ensures the conductor is in sync with `scripts/lib/keywords.mjs` to prevent silent drift.
* **Reproducible Builds:** Run `node scripts/build-plugin.mjs` to generate a byte-identical plugin distribution for auditing.
* **Test Suite:** Run `node scripts/test.mjs` to execute zero-dependency unit tests.

---

## 🔬 Independent Scanning — NVIDIA SkillSpector

CoalTipple is scanned using [NVIDIA SkillSpector](https://github.com/NVIDIA/skillspector) v2.1.4.

* **Static Scan (20/100 - LOW · SAFE):** Raises 2 low-confidence false positives typical of local caching and memory mapping features:
  * `MED · RA2 Session Persistence` (`SKILL.md:25`) - Writing the local tier-ranking cache `~/.claude/.coaltipple/ranking.json` (re-derivable, no user data).
  * `MED · RA2 Session Persistence` (`SKILL.md:98`) - The consent-gated **Memory anchor** configuration.
* **LLM Semantic Scan (0 findings):** Confirming zero actual risks when context is analyzed.

---

## 🛡️ Structural Safety (Phoenix-13)

The primary security assurance is structural. The `coaltipple-conductor.js` hook follows the Phoenix-13 rules:
* **Zero Dependencies & No Network:** Runs 100% locally with no third-party libraries.
* **No Child Processes:** Does not execute external terminal shell commands.
* **Fail-Silent:** Exits 0 on any error, preventing execution blockages in the host agent.
* **No Secrets:** Never reads, logs, or stores hardcoded API keys or credentials.
* **Damage Control:** Writes proposals to a local `.claude/.coaltipple/proposed/` sandbox or isolated git worktree before main merges them.
