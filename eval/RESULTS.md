# Output-quality benchmark — results

> Run per [README.md](README.md): one task per fresh session per model, the main escalates **one rung up**,
> score the deliverable against the objective gold in [TASKS.md](TASKS.md) — never the main's eyeball.

**Measured:** 2026-06-15 · CoalTipple v1.0.3 · raw deliverables in `dogfood/output/` (local)
**Available ladder:** low (Haiku) < mid (Sonnet) < heavy (Opus 4.6 / 4.7) — Fable (reasoning) DISABLED, so Opus is the top.
**Scoring:** T1 = objective gold (`node eval/score.mjs T1`: constant-time via `timingSafeEqual`) · T2/T4 = judged (bound+conservation+boundary / terms+proportional-scope) · T3 = correct + sourced (`concurrency: false`, in-file opt-in, nodejs.org) · T5 = 4 facts exact + terse.

## Output correctness — +1 rung

| Main → route | T1 crypto | T2 proof | T3 research | T4 legal | T5 voice | output-% |
|---|---|---|---|---|---|---|
| Haiku → Sonnet | ✅ | ✅ | ✅ | ✅ | ✅ | **100** |
| Sonnet → Opus | ✅ | ✅ | ✅ | ✅ | ✅ | **100** |
| Opus 4.6 → self (top) | ✅ | ✅ | ✅ | ✅ | ✅ | **100** |
| Opus 4.7 → self (top) | ✅ | ✅ | ✅ | ✅ | ✅ | **100** |
| Fable (reasoning) | — | — | — | — | — | disabled |

**Total: 20/20 PASS.**

## Climb depth — when +1 rung failed

(none — no task failed at +1 rung, so the climb mechanism was not exercised this run.)

## Findings

1. **+1 rung delivers 100%** — even Haiku→Sonnet (the cheapest +1) passed all 5 incl crypto + proof. No climb triggered → cheap-tier-adequacy (escalate one rung is usually enough; climbs are rare — the savings thesis).
2. **within-tier-no-escalation = confirmed but benign** — Opus 4.6/4.7 self-collapsed (Fable off → top → self; did not call a stronger Opus). Their self-output still passed 5/5, so no task needed 4.8 here. (Addressed in the SKILL regardless: the escalation hierarchy is now effort → version → tier, so a weak-version main escalates 4.6→4.8 before a tier jump; revisit impact when a 4.6-fails-4.8-passes task appears.)
3. **effort-decoupling works** — every main scaled effort by task (voice→low, crypto→medium, proof→high) with the tier pinned. The always-on lever.
4. **objective-gold thesis validated** — score.mjs confirmed all 4 crypto deliverables are constant-time; the cheap-can't-verify point held (the gold verified, not the main's eyeball). No timing-leak shipped.

## ⚠️ Caveat

The CORE tasks did NOT stress the climb — all tiers passed, so this run validated **delivery** (+1 rung works) but did NOT exercise **climb-on-fail**. To test the climb, a round 2 needs **edge-of-competence** tasks (where +1 fails and a further rung passes). The 100% = cheap-tier-adequacy, not a flaw — but the climb path is untested by this run.
