# Verifying CoalTipple

CoalTipple is verified under the same framework as **[CoalMine](https://github.com/TheColliery/CoalMine/blob/main/SECURITY.md)**: all execution hooks follow the [Phoenix-13 commandments](https://github.com/TheColliery/.github/blob/main/hooks-safety.md), builds are fully reproducible from source, and security scans run periodically (event-driven).

---

## 🔒 Reporting a Vulnerability

Report a vulnerability via **GitHub private vulnerability reporting**—[Security → Report a vulnerability](https://github.com/TheColliery/CoalTipple/security/advisories/new). Do not open a public issue for a security finding.
* **In scope:** the conductor hook's routing/sensitive never-down gate, the config-cascade merge-safety clamp, the installer's file-write and self-target paths, `.claude/.coaltipple/proposed/`/damage-control, and anything else that could make the skill route, spend, or write somewhere it shouldn't.
* **Out of scope:** a SkillSpector false positive, a style nit, or anything without a security impact—those go through the project's normal (public) issue flow instead.
* **What to expect:** acknowledged promptly, triaged, and coordinated disclosure once a fix ships—no fixed SLA is committed today.

---

## 🔑 Commit & Tag Signatures

Every **release tag** and **maintainer commit** is SSH-signed (`gpg.format=ssh`); GitHub shows the Verified badge on them. Automated **Dependabot / CI** commits are not signed with the maintainer key (GitHub signs these with its own), so verify a signed **release tag**—the artifact a release consumer trusts:
```bash
echo "* ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEtqTWGKhX1Dk9nZP8ns13Wl5zsO1Cz3VlTS6m1p2fP9" > coaltipple_signers
git config gpg.ssh.allowedSignersFile ./coaltipple_signers
git tag -v "$(git describe --tags --abbrev=0)"
```

---

## 📦 Dist Integrity

CoalTipple is distributed as source (human-auditable skill Markdown). The plugin distribution is generated at publish time:
* **Pre-commit/Pre-push Gates:** `node scripts/verify.mjs` automatically verifies config schema matching, files presence, ensures the conductor is in sync with `scripts/lib/keywords.mjs`, and flags a **detectable** config key documented on a user-facing surface (SKILL.md, its references, README, and the conductor's notice regions) that no longer resolves in the schema—to prevent silent drift.
* **Reproducible Builds:** Run `node scripts/build-dist.mjs` to regenerate the plugin distribution from source, then `node scripts/verify.mjs` to gate it against source—the parity check matches byte-for-byte, except `.js`/`.json`/`.md` files (today's shipped extensions) are compared EOL-normalized: a CRLF-vs-LF checkout of identical content is not flagged as drift, but any other content difference still is.
* **Test Suite:** Run `node scripts/test.mjs` to execute zero-dependency unit tests.

---

<!-- version-transition: the pin below reflects the LAST ACTUAL scan -- do NOT bump the scanner/CoalTipple version or score without a real re-scan (an unscanned version's security is UNVERIFIED; never claim coverage). Re-scan periodically or on a significant SKILL.md change, then re-sync. Findings reference the SKILL.md section by NAME (not a line number) so they do not drift on a skill edit. Last scan: SkillSpector v2.11.2 (self-reported; git 3956d4b), CoalTipple v1.6.0 (commit 0d7b418), 2026-09-22, static stage -- score 83/100 (all false-positive), 17 issues (RA1 self-update x13 + AR1 anti-refusal x1 + RA2 x1 + EA2 x1 + BH1 x1). Static coverage partial, 9 of 10 files (hooks/hooks.json opaque to the scanner, read by hand). The 68 -> 83 move is dist-side (new self-update/consent documentation and comment text, all false positive); the 51 -> 68 move on the SAME prior dist (ce0ebc0) under this scanner is scanner-side alone (v2.3.9 -> v2.11.2, on unchanged bytes). Authoritative record: CoalWorks/.claude/agent-memory/skillspector/e2-baseline-2026-09-22.json (per-room durable baseline; no report JSON shipped in this repo). -->
## 🔬 Independent Scanning — NVIDIA SkillSpector

CoalTipple is evaluated against [NVIDIA SkillSpector](https://github.com/NVIDIA/skillspector) v2.11.2 (self-reported; the tool ships no tagged releases—the version is the `uvx`-from-git HEAD, `3956d4b`). **Last scan: CoalTipple v1.6.0 (commit `0d7b418`), 2026-09-22** — static stage (`--no-llm`), 17 findings (RA1 ×13 · AR1 · RA2 · EA2 · BH1), all false positives on adjudication. Static coverage was **partial** (9 of 10 files fully inspected): `hooks/hooks.json` is opaque to the scanner; it was read by hand. Scanning is event-driven (a new SkillSpector version, or a genuinely new attack surface)—this pins the last version actually verified.

* **Static Scan (83/100 · 17 findings, all false positives on adjudication):** 13 × `HIGH · RA1 Self-Modification` matching "self-update"/"ask" across `commands/update.md` (×2, carried) and the consent-gated **Self-Updating** channel's own text—7 sites in the conductor's directive strings (`hooks/coaltipple-conductor.js`: the ask-once fable directive, the auto-mode "OFFER `claude plugin update`" line) and 4 sites in `skills/coaltipple/SKILL.md` documenting that same channel (the stamp path, the `updateMode` config row, the "No network" row) · 1 × `HIGH · AR1` on `commands/update.md`'s "Always answer **in the user's language**" line (carried; a localization rule, not refuse-suppression) · 1 × `MEDIUM · RA2` on a conductor comment describing a stamp-location migration (`:126`) · 1 × `MEDIUM · EA2` on `skills/coaltipple/SKILL.md:40`'s P4 prohibition—the rule's INVERSE of what the analyzer names: "Never spawn a fable-family worker without consent" *requires* consent, it does not suppress a refusal · 1 × `MEDIUM · BH1`, the scanner's own note that `hooks/hooks.json` registers two lifecycle hooks (`SessionStart`, `UserPromptSubmit`). The hook only reads the config/prompt locally and schedules a throttled check (a timestamp stamp under `~/.claude/coal/coaltipple/`, no network ever); `/coaltipple:update` verifies the tag online and **offers** `claude plugin update`—it never auto-applies, and the skill never rewrites its own files. The score is not comparable to the 51 recorded at v1.0.23/v2.3.9: the previous dist (v1.5.6, commit `ce0ebc0`) re-scanned with this scanner scores 68. The report JSON is not shipped.
* **Method:** `uvx --from git+https://github.com/NVIDIA/skillspector.git@3956d4b skillspector scan <plugin> --format json`—the `@<rev>` pin reproduces this exact scan (the tool ships no tagged releases, so an unpinned URL always resolves to a moving HEAD); uvx fetches its own ephemeral Python, so no manual Python/pip install is needed; a JSON report is written even when the optional LLM stage is skipped.
* **LLM Semantic Scan:** not run this pass (`--no-llm`—static-only is the documented, FP-prone baseline: pattern-match without the skill-contract context).

---

## 🛡️ Structural Safety (Phoenix-13)

The primary security assurance is structural. The `coaltipple-conductor.js` hook follows the Phoenix-13 rules:
* **Zero Dependencies & No Network:** Runs 100% locally with no third-party libraries.
* **No Child Processes:** Does not execute external terminal shell commands.
* **Fail-Silent:** Exits 0 on any error, preventing execution blockages in the host agent.
* **No Secrets:** Never reads, logs, or stores hardcoded API keys or credentials.

**Damage Control is a main-agent workflow, not the hook's.** The hook itself only reads the config and prompt locally and emits an advisory routing hint—it never writes a proposal. When `SKILL.md` routes a task carrying an external side effect, the main agent writes proposals to a local `.claude/.coaltipple/proposed/` sandbox or isolates the change in a git worktree before merging (see README's [Damage Control](README.md#damage-control) section).
