# CoalTipple output-quality benchmark

This harness measures the **final output correctness** of CoalTipple routing — *what actually reaches the
user after the model routes a task* — not just whether the routing decision was correct.

> Two complementary benchmarks. The internal routing dogfood (`dogfood/results/`, `dogfood/results2/`) scores
> the **decision** ("did the main escalate / delegate / self correctly?"). This one scores the **delivery**
> ("after it routed, is the answer right?"). Decision-correct does not guarantee output-correct — this closes
> that gap.

## What it tests (the design)

Every task here is **hard** (a cheap tier cannot do it reliably → forces escalate-up) **and subtle** (an
eyeball "looks right" verdict misses the real failure → it only shows under an objective check). Two binding
conditions:

1. **Escalate-up ONE RUNG at a time (the staircase), never jump to the top model.** If every main just called
   the strongest model, the output would be trivially good and we'd be measuring the top model, not CoalTipple.
   One rung (cheap→mid, mid→heavy, …) measures the real question: **does +1 rung deliver, or must it climb
   further?** — per (task difficulty × main tier). The top available tier has no rung above → it does the task
   itself (the ceiling baseline). *(With Fable disabled, Opus is the top.)*
2. **The little sibling cannot do the work, and cannot verify it either.** Because the cheap main cannot
   self-verify a subtle failure, verification is the **objective gold** (tests / answer key / rubric judged by
   a strong model) — *never* the main's eyeball. This reveals whether the escalated output reaches the user
   correct **without leaning on a verify the cheap main can't perform.**

## How to run

- **Division of labour:** *you* copy [`PROMPT.md`](PROMPT.md) and fire it at each model; *each model writes* its
  deliverables to `dogfood/output/<model-id>.md` (local, self-labelled); *the reviewing session reads + scores
  them* — no copy-back. Same workflow as the decision dogfood, scoring the OUTPUT instead.
- `PROMPT.md` bundles all 5 CORE tasks (one per group — `coding`, `math`, `knowledge`, `domain`, `creative`)
  and has the main do them one at a time within the session. All-5-in-one-session is convenient but carries a
  context-bleed + limit-risk tradeoff; for the cleanest per-task numbers, split into one task per session.
- Fire **Haiku + Sonnet** (the real +1-rung rows) and **Opus** (the ceiling, since Fable is off). Restart
  between models. Log anything you cap.

## Scoring (objective gold — not the main's verdict)

`node eval/score.mjs <Tn> [file]` — see [`TASKS.md`](TASKS.md) for each task's gold:

| Method | Tasks | How |
|---|---|---|
| **Automated** | T1 crypto, T5 facts | `score.mjs T1 <impl>` runs the vectors + static-checks `timingSafeEqual`; `score.mjs T5 <text>` runs the fact-checklist |
| **Rubric + strong judge** | T2 proof, T3 research, T4 legal | `score.mjs T2\|T3\|T4` prints the rubric; a reasoning-tier model scores it (the cheap main can't) |

- **Output correctness %** = correct deliverables / total, per model tier.
- **Climb second pass:** when the +1-rung output FAILS the gold, re-run escalating one *more* rung and record
  whether that clears it — the staircase economics (is one rung enough, or how far must it climb?).

## Output

Raw per-model deliverables → `dogfood/output/` (local). The headline numbers (output-% per tier + climb depth)
roll up into [`RESULTS.md`](RESULTS.md) and the repo `README.md` table, **dated** (every published benchmark
carries its test date).
