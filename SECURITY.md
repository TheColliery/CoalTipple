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

<!-- version-transition: re-run SkillSpector on any SKILL.md edit; re-sync the scanner version + score below. Findings reference the SKILL.md section by NAME (not a line number) so they do not drift on a skill edit. Authoritative scan report: skillspector-2.1.4.md. -->

CoalTipple is scanned using [NVIDIA SkillSpector](https://github.com/NVIDIA/skillspector) v2.1.4.

* **Static Scan (10/100 - LOW · SAFE):** Raises 1 low-confidence false positive typical of a local state-file feature:
  * `MED · RA2 Session Persistence` (`SKILL.md`, the Memory anchor section) - The consent-gated **Memory anchor** configuration (a local file the user opts into; no telemetry, no user data exfiltrated).
* **LLM Semantic Scan:** requires prepaid Anthropic API credits, so it did not run on this setup -- it falls back to the static scan above. (A v2.1.3 semantic pass returned 0 findings on the content it evaluated.)

---

## 🛡️ Structural Safety (Phoenix-13)

The primary security assurance is structural. The `coaltipple-conductor.js` hook follows the Phoenix-13 rules:
* **Zero Dependencies & No Network:** Runs 100% locally with no third-party libraries.
* **No Child Processes:** Does not execute external terminal shell commands.
* **Fail-Silent:** Exits 0 on any error, preventing execution blockages in the host agent.
* **No Secrets:** Never reads, logs, or stores hardcoded API keys or credentials.
* **Damage Control:** Writes proposals to a local `.claude/.coaltipple/proposed/` sandbox or isolated git worktree before main merges them.
