# Verifying CoalTipple

CoalTipple is verified under the same framework as **[CoalMine](https://github.com/HetCreep/CoalMine/blob/main/SECURITY.md)**: all execution hooks follow the [Phoenix-13 commandments](https://github.com/TheColliery/.github/blob/main/hooks-safety.md), builds are fully reproducible from source, and security scans run periodically (event-driven).

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

<!-- version-transition: the pin below reflects the LAST ACTUAL scan -- do NOT bump the scanner/CoalTipple version or score without a real re-scan (an unscanned version's security is UNVERIFIED; never claim coverage). Re-scan periodically or on a significant SKILL.md change, then re-sync. Findings reference the SKILL.md section by NAME (not a line number) so they do not drift on a skill edit. Last scan: SkillSpector v2.2.3, CoalTipple v1.0.16 (commit 79143ba), 2026-06-20, static stage -- score 100/100 (CRITICAL, all false-positive), 9 issues (RA1 self-update x8 + RA2 memory-anchor). Authoritative report: skillspector-20260620.json (local). -->

CoalTipple is evaluated against [NVIDIA SkillSpector](https://github.com/NVIDIA/skillspector) v2.2.3. **Last scan: CoalTipple v1.0.16 (commit `79143ba`), 2026-06-20.** Scanning is event-driven (a new SkillSpector version, or a genuinely new attack surface) — this pins the last version actually verified.

* **Static Scan (100/100 - CRITICAL · 9 issues, all false-positive):** Up from 0/100 because CoalTipple now ships consent-gated **Self-Updating** (v1.0.13), which the static **RA1 self-modification** rule flags ×8 (the `/coaltipple:update` command + the conductor's self-update scheduler + `self-update` comments) — the hook only SCHEDULES (no network), the agent offers the platform's own `claude plugin update`; the skill never rewrites its own files. The 9th issue is `MED · RA2 Session Persistence` on the consent-gated **Memory anchor** (see below). The score jump is this new surface, not a defect.
* **Method:** `uvx --from git+https://github.com/NVIDIA/skillspector.git skillspector scan <plugin> --format json` -- uvx fetches its own ephemeral Python, so **no manual Python/pip install is needed** (this corrects an earlier note). A JSON report is written even when the optional LLM stage is unavailable.
* **LLM Semantic Scan:** Requested, but the provider returned HTTP 429 (rate-limit), so the scan fell back to the static stage above (by design). The **`RA2 Session Persistence`** false positive (now raised by the static stage too) is the consent-gated **Memory anchor** -- an opt-in local project-memory file: no telemetry, and none of the OS-persistence mechanisms RA2 keys on (crontab, shell-rc, systemd/launchd, registry). Re-run when quota is free for a full semantic pass.

---

## 🛡️ Structural Safety (Phoenix-13)

The primary security assurance is structural. The `coaltipple-conductor.js` hook follows the Phoenix-13 rules:
* **Zero Dependencies & No Network:** Runs 100% locally with no third-party libraries.
* **No Child Processes:** Does not execute external terminal shell commands.
* **Fail-Silent:** Exits 0 on any error, preventing execution blockages in the host agent.
* **No Secrets:** Never reads, logs, or stores hardcoded API keys or credentials.
* **Damage Control:** Writes proposals to a local `.claude/.coaltipple/proposed/` sandbox or isolated git worktree before main merges them.
