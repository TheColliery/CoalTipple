# CoalTipple — the Lock (ranking rebuild + safety rationale)

Loaded ON-DEMAND from Step 0, only when the ranking must be REBUILT (missing / corrupt / incomplete — rare) or you need the full pin/fall/safety detail. A normal route just reads `~/.claude/.coaltipple/ranking.json` (a cheap file read) and never touches this.

## Rebuild recipe (the ranking is missing / corrupt / incomplete)
Rebuild it on the spot: `buildFloorRanking([], modelTiers)` (classify.mjs) — `aliasDefaults()` + your pins, ALWAYS (no enumeration, no model-list introspection). Write it atomically. `modelTiers` comes from the merged `.coaltipple.json`. You do NOT enumerate the live model list — the floor is the alias structure + pins, nothing more.

## The pin override (`modelTiers`)
A model released after your training cutoff is invisible to you. The user names it in `.coaltipple.json` `modelTiers: { <tier>: "<model>" }` (or an array `["first-choice","fallback"]` — a priority chain tried in order) and it wins (front of that tier). `applyPins` overlays them when the ranking is built. This is the human-ground-truth override for what you cannot see.

## The fall (`resolveWorker`, the availability mechanic)
Availability is knowable ONLY at spawn-time, never from a catalog: a spawn that errors instantly ("X is currently unavailable", 0-token — proven live with a `fable` spawn) means that model is disabled / out of quota / gone. The platform resolves each alias to its best CURRENT model; if that spawn errors, fall to the next available tier via `resolveWorker(ranking, desiredTier, {blocked, floorTier})` — it walks `desiredTier`→`floorTier` skipping the `blocked` set (the full loop is SKILL.md Step 3.3). Capacity (a 256k/1M context variant) is a SEPARATE axis from capability — pick the smallest variant that fits the input, discovered at spawn-time like availability.

## Why every degradation mode is safe (which is why the floor needs no refresh)
- unknown / new model → `heavy` (never cheap)
- a listed model that is gone → spawn-fail → fall
- unsure availability → try-then-fall
- your own SELF-ID (which tier you are) is always a correct anchor

The worst case is a little over-provisioning or one failed-spawn-then-fall — NEVER a wrong-cheap route. An idle session pays NOTHING (the ranking is read only when you route); a routing session pays a cheap file read. There is no enumerate-and-rebuild step to budget, so a rare check suffices: routing keys off the tier STRUCTURE (a vendor 5→10-model shuffle classifies the new ones `heavy` = safe), so only an exact-list view would go stale, and routing does not use one.
