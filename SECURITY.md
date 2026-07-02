# Verifying CoalTipple

CoalTipple is verified under the same framework as **[CoalMine](https://github.com/HetCreep/CoalMine/blob/main/SECURITY.md)**: all execution hooks follow the [Phoenix-13 commandments](https://github.com/TheColliery/.github/blob/main/hooks-safety.md), builds are fully reproducible from source, and security scans run periodically (event-driven).

---

## 🔒 Reporting a Vulnerability

To report a security issue in the skill, the conductor hook, or the installer:
* Open a GitHub issue at `github.com/TheColliery/CoalTipple` or request a private channel (avoid posting sensitive PoC logs in public).
* We will investigate and address reported issues promptly.

---

## 🔑 Commit & Tag Signatures

All commits and release tags are SSH-signed (`gpg.format=ssh`); GitHub renders the Verified badge.

Verify locally:
```bash
echo "* ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEtqTWGKhX1Dk9nZP8ns13Wl5zsO1Cz3VlTS6m1p2fP9" > coaltipple_signers
git config gpg.ssh.allowedSignersFile ./coaltipple_signers
git verify-commit HEAD && git tag -v "$(git describe --tags --abbrev=0)"
```

---

## 📦 Dist Integrity

CoalTipple is distributed as source (human-auditable skill Markdown). The plugin distribution is generated at publish time:
* **Pre-commit/Pre-push Gates:** `node scripts/verify.mjs` automatically verifies config schema matching, files presence, and ensures the conductor is in sync with `scripts/lib/keywords.mjs` to prevent silent drift.
* **Reproducible Builds:** Run `node scripts/build-plugin.mjs` to generate a byte-identical plugin distribution for auditing.
* **Test Suite:** Run `node scripts/test.mjs` to execute zero-dependency unit tests.

---

<!-- version-transition: the pin below reflects the LAST ACTUAL scan -- do NOT bump the scanner/CoalTipple version or score without a real re-scan (an unscanned version's security is UNVERIFIED; never claim coverage). Re-scan periodically or on a significant SKILL.md change, then re-sync. Findings reference the SKILL.md section by NAME (not a line number) so they do not drift on a skill edit. Last scan: SkillSpector v2.3.9, CoalTipple v1.0.23 (commit ce0ebc0), 2026-07-02, static stage -- score 51/100 (all false-positive), 9 issues (RA1 self-update x8 + AR1 anti-refusal x1). The 43 -> 51 move is scanner-side (v2.3.9 new AR1 analyzer + per-file scoring rework; the unchanged v1.0.20 dist scored 43 under v2.3.5 and 51 under v2.3.9). Authoritative report: skillspector-20260702.json (local). -->
## 🔬 Independent Scanning — NVIDIA SkillSpector

CoalTipple is evaluated against [NVIDIA SkillSpector](https://github.com/NVIDIA/skillspector) v2.3.9 (self-reported; the tool ships no tagged releases — the version is the `uvx`-from-git HEAD, `326a2b4`). **Last scan: CoalTipple v1.0.23 (commit `ce0ebc0`), 2026-07-02.** Scanning is event-driven (a new SkillSpector version, or a genuinely new attack surface) — this pins the last version actually verified.

* **Static Scan (51/100 · 9 issues, all false-positive):** consent-gated **Self-Updating** (v1.0.13) is flagged by the static **RA1 self-modification** rule ×8 (the `/coaltipple:update` command + the conductor's self-update scheduler + `self-update` comments; two of the eight are case-variant matches on one conductor line) — the hook only SCHEDULES (no network), the agent offers the platform's own `claude plugin update`; the skill never rewrites its own files. The 9th is `HIGH · AR1 Anti-Refusal` (the `/coaltipple:update` command text, a new v2.3.9 analyzer) — it matched "Always answer"; the sentence is "Always answer **in the user's language**" — a localization rule, not refuse-suppression. (Score trend on the same finding classes: v2.2.3 100 → v2.3.1 51 → v2.3.5 43 → v2.3.9 51 — the rise is scanner-side, the new analyzer + a per-file scoring rework: the unchanged v1.0.20 dist moved 43 → 51 across scanner versions; v1.0.23 scores the same.)
* **Method:** `uvx --from git+https://github.com/NVIDIA/skillspector.git skillspector scan <plugin> --format json` -- uvx fetches its own ephemeral Python, so **no manual Python/pip install is needed**. A JSON report is written even when the optional LLM stage is skipped.
* **LLM Semantic Scan:** not run this pass (`--no-llm` — static-only is the documented, FP-prone baseline). The earlier `RA2 Session Persistence` false positive (the consent-gated **Memory anchor** — an opt-in local project-memory file) no longer fires under v2.3.x.

---

## 🛡️ Structural Safety (Phoenix-13)

The primary security assurance is structural. The `coaltipple-conductor.js` hook follows the Phoenix-13 rules:
* **Zero Dependencies & No Network:** Runs 100% locally with no third-party libraries.
* **No Child Processes:** Does not execute external terminal shell commands.
* **Fail-Silent:** Exits 0 on any error, preventing execution blockages in the host agent.
* **No Secrets:** Never reads, logs, or stores hardcoded API keys or credentials.
* **Damage Control:** Writes proposals to a local `.claude/.coaltipple/proposed/` sandbox or isolated git worktree before main merges them.
