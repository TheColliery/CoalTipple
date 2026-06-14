# Verifying CoalTipple

## Structural safety (not just a scanner score)

The real assurance is **structural**, not a number from a scanner. CoalTipple's only executable hook is the conductor, and it obeys the same Phoenix-13 commandments as the rest of the TheColliery series:

- **The conductor hook is Phoenix-pure:** zero external dependencies, **no network** ever, **no child processes**, **fail-silent** (exits 0 on any error, never calls `process.exit`). It reads `.coaltipple.json` and the prompt — locally only — and emits an advisory routing hint. Nothing auto-executes.
- **Advisory, not auto-executing.** Routing decisions are made by the model reading `SKILL.md`; there is no covert persistence and no data-exfiltration path. A worker is spawned only through the **platform's own native subagent tool**, under the platform's own permission gate — CoalTipple does not bypass it.
- **The Lock fails safe.** If a valid model-ranking cannot be built, routing turns **OFF** and CoalTipple runs as a normal single agent. There are only two states: route correctly, or route off — it never routes on a broken ranking.
- **No secrets.** No hardcoded keys or tokens; sensitive data is never read or logged; state is written atomically (temp + rename) under `.coaltipple/` only.
- **Damage control.** A worker writes its proposal to a `.coaltipple/proposed/` sandbox (or an isolated git worktree) and main merges it deliberately, so a mid-run death never corrupts real files. A side-effect step (a bash mutation, an external call, a commit) is never delegated or retried.

## Commit & tag signatures

Once the repository is public, all commits and release tags are SSH-signed (`gpg.format=ssh`). On GitHub, signed commits show the **Verified** badge automatically. To verify locally:

```bash
# point git at the maintainer's allowed-signers entry (published with the public repo), then:
git config gpg.ssh.allowedSignersFile ./coaltipple_signers

# verify the latest release tag — resolved dynamically, no version number to go stale
git verify-commit HEAD
git tag -v "$(git describe --tags --abbrev=0)"
```

## Dist integrity

CoalTipple is distributed as source: the installer copies `skills/coaltipple/` directly into your agent, and the skill is human-readable Markdown you can audit before it runs. A marketplace/plugin dist is generated only at publish time; the build is reproducible by construction (`node scripts/build-plugin.mjs`), and the verify gate cross-checks the shipped artifacts against their single source of truth:

```bash
node scripts/verify.mjs   # factory config ↔ schema · skill/conductor present · libs load · conductor ↔ keyword SSoT in sync
node scripts/test.mjs     # the zero-dependency test suite
```

The conductor's hot-keyword list is synced from one source (`scripts/lib/keywords.mjs`) into the hook by the build step, and `verify.mjs` **fails** if the two drift — a hand-edit of the shipped hook cannot ship silently.

## Independent scanning — NVIDIA SkillSpector

CoalTipple is scanned with [NVIDIA SkillSpector](https://github.com/NVIDIA/skillspector) v2.1.4 — a security scanner for AI agent skills (prompt injection, data exfiltration, excessive agency, session persistence, dangerous code, supply-chain risk).

The scan targets the shipped `skills/coaltipple/SKILL.md` — the exact artifact the installer copies into your agent. Its fast **static** pass scores it **10/100 (LOW · SAFE)**, with a single low-confidence finding:

| Static finding | What it actually is |
|---|---|
| MED · RA2 Session Persistence (`SKILL.md:98`, 60%) | The **Memory anchor** section, which describes the consent-gated `contextFiles` / `.coaltipple/state.json` mechanism. CoalTipple offers it at most once via the platform's question tool and never writes a memory file unless the user chooses **Create**; state lives under `.coaltipple/` in the project, never silently and never in global config. |

(As with the rest of the series, SkillSpector's LLM semantic pass does not complete on the available API tier — it times out — so this is the static-pass number; the structural guarantees above are the real assurance.)

The real assurance is **structural**, as above: every CoalTipple hook obeys the [Phoenix-13 commandments](https://github.com/HetCreep/CoalMine/blob/main/docs/hooks-safety.md) — zero external dependencies, no network ever, no child processes, fail-silent, session state cleaned up — and every routing action is consent-gated through the platform's own subagent tool. There is no data-exfiltration path, no covert persistence, and nothing auto-executes. A scanner's surface-pattern findings are reviewed against that structure rather than taken as a measure of real risk.

## Reporting an issue

A security issue in the skill, the conductor hook, or the installer: open a GitHub issue once the repository is public (`github.com/TheColliery/CoalTipple`); until then, report to the maintainer directly. Do not put a sensitive proof-of-concept in a public issue — request a private channel first.
