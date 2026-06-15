# CORE benchmark tasks — one per task-type group

Each task is **hard** (forces escalate-up off a cheap tier) and **subtle** (a "looks right" eyeball misses the
real failure; only the objective gold catches it). Fire one per fresh session per model; the main escalates
**one rung up** and the worker produces the deliverable. Score the deliverable against the gold — never the
main's self-verdict. See [`README.md`](README.md) for the protocol.

---

## T1 — `coding` (crypto) · grade 5, sensitive

**Prompt to the main:**
> Implement `hmacVerify(secretKey, message, tagHex)` in Node.js (CommonJS). Compute the HMAC-SHA256 of
> `message` under `secretKey` and return `true` iff it matches the hex digest `tagHex`, else `false`. This
> guards a webhook signature, so the comparison must not leak a timing side-channel. Include a few tests.

**Why hard:** crypto-logic + timing-attack surface → grade 5, never-delegate-down.
**Subtle failure (why a cheap verify misses it):** `return computed === tagHex` passes **every** functional
test but short-circuits on the first differing character → a timing leak. It "looks right."

**Gold (AUTOMATED):**
- Functional: correct tag → `true`; one-byte-flipped tag → `false`; wrong-length tag → `false` (no throw).
- Constant-time: uses `crypto.timingSafeEqual` on equal-length buffers (length-checked first); the tag
  comparison does **not** use `===`/`==`/`!==`, `indexOf`, or `localeCompare`.
- **Score = pass** iff both hold. (Run the vectors; static-check the comparison.)

---

## T2 — `math` (proof) · grade 5

**Prompt to the main:**
> Prove rigorously: a token-bucket rate limiter with capacity `C` (bucket starts full) and constant refill
> rate `r` tokens/sec admits at most `C + r·T` requests in **any** time window of length `T` (each admitted
> request costs 1 token; a request is admitted iff ≥1 token is available). State your assumptions and handle
> the boundary.

**Why hard:** a real proof (accumulation argument + boundary), not a formula recall → grade 5.
**Subtle failure:** a proof that states the right bound `C + r·T` but hand-waves the refill accumulation,
or silently assumes the bucket starts **empty** (which changes the bound), or double-counts a boundary token.

**Gold (RUBRIC → strong judge):**
- States the bound `C + r·T` correctly.
- Argues: admitted ≤ tokens consumed in the window ≤ (tokens available at window start, ≤ C) + (tokens
  refilled during the window, = r·T). Justifies each ≤.
- Handles "starts full" (initial available ≤ C) and the continuous refill over `T`.
- **Score = pass** iff the bound is correct AND the accumulation step AND the boundary are both justified
  (not asserted). A reasoning-tier judge scores it; the cheap main cannot.

---

## T3 — `knowledge` (research, sourced) · grade 3, must be sourced

**Prompt to the main:**
> Using authoritative sources (cite them): in the current stable Node.js `node:test` runner, do the tests
> within a single test file run **concurrently by default**, or is in-file concurrency opt-in? Give the
> default, the exact mechanism to change it, and the Node version your answer applies to. Cite the official docs.

**Why hard:** the correct answer is version-sensitive and has changed across Node releases → recall is unsafe;
the worker must FETCH and cite. (This is the source-grounding test.)
**Subtle failure:** a fluent, confident answer from training memory that is **out of date** — and no citation,
or a citation to a blog. A cheap eyeball can't tell a stale-but-plausible answer from a current one.

**Gold (VERIFY against the source):**
- The stated default + mechanism + version match the official Node.js documentation (verify at scoring time).
- A citation to an **authoritative** source (nodejs.org / the Node docs), not a blog or memory.
- **Score = pass** iff the fact is current-correct AND backed by an authoritative citation. (Strong judge
  with web access verifies; an unsourced answer = fail even if it happens to be right.)

---

## T4 — `domain` (legal translation) · grade 4, sensitive

**Prompt to the main:**
> Translate this software-license clause into Thai, preserving the legal meaning precisely:
> *"Licensee shall indemnify and hold harmless the Licensor from any claims arising out of Licensee's use,
> except to the extent such claims result from the Licensor's gross negligence or willful misconduct."*

**Why hard:** legal terms of art + a scoped exception; a wrong word changes liability → grade 4, never-down,
preserve the deliverable.
**Subtle failure:** a fluent translation that drops **"to the extent"** (turning a *partial* carve-out into a
*total* one), or renders **"gross negligence"** as plain negligence, or **"hold harmless"** as a generic
"protect." Reads smoothly; the legal meaning is wrong — invisible to a non-lawyer eyeball.

**Gold (RUBRIC → strong/domain judge):**
- Each term of art correct: *indemnify*, *hold harmless*, *arising out of*, *to the extent* (partial scope
  preserved), *gross negligence* (not plain negligence), *willful misconduct*.
- The exception applies **only** to the Licensor's gross negligence / willful misconduct, and only *to the
  extent* the claims result from them.
- **Score = pass** iff every term of art AND the exception scope are preserved.

---

## T5 — `creative` (voice + fact preservation) · grade 2, preserveVoice

**Prompt to the main:**
> Rewrite this product blurb in a terse, technical voice — no marketing adjectives, no exclamation, ≤2
> sentences — preserving every factual claim:
> *"Our blazing-fast widget processes up to 10,000 events per second with 99.9% uptime, ships with a 30-day
> money-back guarantee, and integrates with over 50 tools out of the box!"*

**Why hard for the routing:** the deliverable IS user-facing prose → `preserveVoice` (don't hand the final
voice to a cheaper model). The trap is fact-drift under a style rewrite.
**Subtle failure:** a crisp, on-voice rewrite that silently **drops** a fact ("99.9% uptime" gone) or
**softens a number** ("10,000 events/sec" → "thousands of events"). Sounds right; a fact slipped.

**Gold (FACT-CHECKLIST + voice rubric):**
- All four facts present and unchanged: `10,000 events/sec`, `99.9% uptime`, `30-day money-back`, `50+ tools`.
  (Semi-automated: check each is present and numerically exact.)
- Voice: terse + technical, marketing adjective ("blazing-fast") removed, ≤2 sentences. (Rubric → judge.)
- **Score = pass** iff all four facts are exact AND the voice constraints hold.
