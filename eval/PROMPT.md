# Benchmark run prompt (copy-paste, one per model)

Copy this whole block, paste into a FRESH session on each model you measure (run with cwd = the CoalTipple
repo). Each model WRITES its results to a self-labelled file; the reviewing session reads them — no copy-back.
Same workflow as the old dogfood, but it measures the OUTPUT (the deliverable), not the routing decision.

Fable is OFF, so: **Haiku, Sonnet** = the real rows; **Opus** = the ceiling baseline. (Restart between models.)

---

You are the CoalTipple main router. Below are 5 tasks (T1–T5). Do them ONE AT A TIME (escalate, get the
deliverable, then the next — do NOT fan out all 5 at once).

For EACH task:
1. Grade it 1–5 by difficulty / sensitivity.
2. ESCALATE-UP exactly ONE tier above yourself, among the AVAILABLE tiers (Haiku→Sonnet, Sonnet→Opus; Fable
   is OFF, so Opus is the top — an Opus main does it ITSELF). Do NOT jump to the top.
3. Spawn one worker to PRODUCE that task's deliverable, and make its task DESCRIPTION begin with
   `[tier·effort]` (e.g. `[sonnet·med] T3 research`) so the model shows on the spawn chip (the chip otherwise
   shows only "Agent"). Give the worker ONLY that task's text, no extra context.
4. Do NOT verify / judge / fix any deliverable — an objective gold scores them, not you.

When all 5 are done, WRITE them to the **CoalTipple repo's** `dogfood/output/<your-model-id>.md` (if your cwd is the umbrella TheColliery, prepend `CoalTipple/`) — e.g.
`dogfood/output/claude-haiku-4-5.md`): a `## T1` … `## T5` section each, with the chosen `[tier·effort]` on
the first line, then the worker's deliverable VERBATIM (wrap T1's code in a fenced code block).

=== T1 (coding/crypto) ===
Implement `hmacVerify(secretKey, message, tagHex)` in Node.js (CommonJS). Compute the HMAC-SHA256 of `message`
under `secretKey` and return `true` iff it matches the hex digest `tagHex`, else `false`. This guards a webhook
signature, so the comparison must not leak a timing side-channel. Include a few tests.

=== T2 (math/proof) ===
Prove rigorously: a token-bucket rate limiter with capacity C (bucket starts full) and constant refill rate r
tokens/sec admits at most C + r*T requests in any time window of length T (each admitted request costs 1 token;
admitted iff >=1 token available). State assumptions and handle the boundary.

=== T3 (knowledge/research) ===
Using authoritative sources (cite them): in the current stable Node.js `node:test` runner, do the tests within
a single test file run concurrently by default, or is in-file concurrency opt-in? Give the default, the exact
mechanism to change it, and the Node version your answer applies to. Cite the official docs.

=== T4 (domain/legal) ===
Translate this software-license clause into Thai, preserving the legal meaning precisely: "Licensee shall
indemnify and hold harmless the Licensor from any claims arising out of Licensee's use, except to the extent
such claims result from the Licensor's gross negligence or willful misconduct."

=== T5 (creative/voice) ===
Rewrite this product blurb in a terse, technical voice (no marketing adjectives, no exclamation, <=2
sentences), preserving every factual claim: "Our blazing-fast widget processes up to 10,000 events per second
with 99.9% uptime, ships with a 30-day money-back guarantee, and integrates with over 50 tools out of the box!"

---

The reviewing session then scores `dogfood/output/*.md` with `node eval/score.mjs <Tn> [file]` (see
[README.md](README.md)) and fills [RESULTS.md](RESULTS.md).
