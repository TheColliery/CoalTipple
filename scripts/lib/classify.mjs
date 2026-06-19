// The ranking LOCK. Routing is gated on a valid ranking; this module guarantees
// one is always obtainable. The ranking IS the alias floor (haiku<sonnet<opus ->
// low/mid/heavy, reasoning=opus) overlaid with the user's `modelTiers` pins — a
// constant the platform resolves to its current best model, never stale. Routing
// rides this tier STRUCTURE + the agent's unknown->heavy rule + the spawn-fail-fall
// (resolveWorker), NOT an auto-introspected exact model list. These functions are
// the deterministic substrate: the floor builder, the validity gate, atomic state
// I/O, the escalation/availability resolvers, and the pin overlay. Node built-ins only.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const SCHEMA_VER = 1;
export const TIERS = ['local', 'low', 'mid', 'heavy', 'reasoning'];
const STATE_FILE = 'ranking.json';

const nameOf = (m) => (typeof m === 'string' ? m : (m && m.name) || '');

// Claude-family alias tiers — always available, never stale (the platform
// resolves the alias to the current model). reasoning = strongest @ max effort.
// This IS the ranking floor: routing keys off the tier STRUCTURE, not an exact
// enumerated model list, so a vendor model-list shuffle never breaks it.
export function aliasDefaults() {
  return { local: [], low: ['haiku'], mid: ['sonnet'], heavy: ['opus'], reasoning: ['opus'] };
}

export function modelListHash(models = []) {
  const names = models.map(nameOf).filter(Boolean).sort();
  return crypto.createHash('sha256').update(names.join('\n')).digest('hex').slice(0, 16);
}

// Valid iff: parses, matches schema version, strictly complete, has a USABLE tiers
// map (a non-array plain object with every TIERS key present as an array, at least one
// non-empty), and its listHash matches the CURRENT model list. Strict because a loosely
// "valid" ranking (array tiers, {}, missing/non-array keys, all-empty) passes the Lock but
// makes resolveWorker return null for every tier -> routing silently dead while the Lock
// reads green. Any failure -> rebuild (Phoenix #12).
export function validateRanking(ranking, currentHash) {
  if (!ranking || typeof ranking !== 'object') return 'missing';
  if (ranking.schemaVer !== SCHEMA_VER) return 'schema-version mismatch';
  if (ranking.complete !== true) return 'incomplete (interrupted build)';
  const tiers = ranking.tiers;
  if (!tiers || typeof tiers !== 'object' || Array.isArray(tiers)) return 'no tiers';
  for (const t of TIERS) if (!Array.isArray(tiers[t])) return `tiers missing/non-array key '${t}'`;
  // At least one ROUTABLE tier must hold a USABLE (non-empty) model. Routing rides the
  // ESCALATION_LADDER (low<mid<heavy<reasoning; the SOT defined below) — 'local' is NOT
  // routable, so a local-only ranking is dead despite passing a naive TIERS check; and an
  // empty-string entry is no model. Either would read GREEN while resolveWorker returns null.
  if (!ESCALATION_LADDER.some((t) => Array.isArray(tiers[t]) && tiers[t].some((m) => m && String(m).trim()))) {
    return 'no routable tier has a usable model (routing would be dead)';
  }
  if (currentHash && ranking.listHash !== currentHash) return 'stale (model list changed)';
  return null;
}

export function loadRanking(stateDir, currentHash) {
  try {
    const raw = fs.readFileSync(path.join(stateDir, STATE_FILE), 'utf8');
    const clean = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw; // BOM-safe (no literal BOM typed)
    const ranking = JSON.parse(clean);
    const reason = validateRanking(ranking, currentHash);
    return reason ? { ok: false, reason, ranking: null } : { ok: true, reason: null, ranking };
  } catch (e) {
    return { ok: false, reason: `unreadable: ${e.message}`, ranking: null };
  }
}

// Atomic write (temp + rename) — a killed mid-write never leaves a half ranking
// that reads as present (the Lock's partial-write guard).
export function writeRankingAtomic(stateDir, ranking) {
  fs.mkdirSync(stateDir, { recursive: true });
  const dest = path.join(stateDir, STATE_FILE);
  const tmp = `${dest}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(ranking, null, 2) + '\n', 'utf8');
    try {
      fs.renameSync(tmp, dest);
    } catch (e) {
      // Windows (#7): dest held open (e.g. the conductor reading ranking.json) -> renameSync
      // throws EPERM/EBUSY. Fall back to a direct overwrite so the update is never lost; a kill
      // mid-overwrite leaves a corrupt dest that the Lock's validity gate catches + rebuilds.
      if (e.code === 'EPERM' || e.code === 'EBUSY') fs.writeFileSync(dest, fs.readFileSync(tmp, 'utf8'), 'utf8');
      else throw e;
    }
  } finally {
    // Phoenix #1 (zero-garbage): a failed write/rename never leaves a stray temp.
    // On success the rename consumed tmp, so this is a no-op.
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
  }
}

// The capability climb order for quality-gated escalation (cheapest -> best).
// 'local' (TIERS[0]) is orthogonal (on-device / privacy), NOT a quality rung, so
// it is excluded from the climb.
export const ESCALATION_LADDER = ['low', 'mid', 'heavy', 'reasoning'];

// Quality-gated climb (the staircase). After an attempt scores BELOW the qualityBar,
// pick the next tier to try:
//   - near the bar, attempts remain        -> climb ONE rung;
//   - FAR below (next rung won't clear it)  -> jump straight to the top tier;
//   - attempt budget spent                  -> jump to the top tier (last resort);
//   - already at the top                    -> null (nowhere to climb; hand back honestly).
// General-purpose: operates on TIERS, not models, and `farBelow` is a domain-agnostic
// "needs major rework" judgment (code/text/research alike), never a code-only metric.
export function escalationStep(currentTier, { attemptsLeft = 1, farBelow = false, ladder = ESCALATION_LADDER } = {}) {
  const top = ladder[ladder.length - 1];
  const i = ladder.indexOf(currentTier);
  if (i < 0) return ladder[0] ?? null;           // off-ladder (e.g. 'local') -> enter the climb at the bottom
  if (currentTier === top) return null;           // already best -> can't climb
  if (farBelow || attemptsLeft <= 0) return top;  // hopeless gap or budget gone -> jump to the ceiling
  return ladder[i + 1];                           // climb one rung
}

// Availability fallback — the LIMIT-HIT resolver (the DOWN move, opposite of
// escalationStep's quality climb UP). When the desired tier's model is blocked
// (quota hit / disabled / a spawn that errored), walk DOWN the ladder for the best
// AVAILABLE worker — but NEVER below `floorTier`. For a SENSITIVE task the caller
// passes floorTier = the safe minimum (e.g. 'heavy'): if nothing at/above it is
// available, returns null (hand back / wait for reset) rather than breach the
// never-down gate just because a limit was hit. Returns { tier, model } | null.
// Deterministic, pure (Phoenix #8).
export function resolveWorker(ranking, desiredTier, { blocked = [], floorTier = null, ladder = ESCALATION_LADDER } = {}) {
  const blockedSet = new Set((blocked || []).map(String));
  const tiers = (ranking && ranking.tiers) || {};
  const di = ladder.indexOf(String(desiredTier).toLowerCase());
  if (di < 0) return null;                                    // unknown tier -> caller handles
  // Floor resolution is FAIL-SAFE: a valid-but-wrong-case ('Heavy') normalizes; a
  // tier below the ladder (e.g. 'local') allows from the bottom; an UNRECOGNIZED
  // floor ('reasoner' typo) returns null rather than collapsing to the cheapest tier
  // (Math.max(-1,0)=0 would breach the never-down gate for a sensitive task).
  let floor = 0;
  if (floorTier) {
    const ft = String(floorTier).toLowerCase();
    const fi = ladder.indexOf(ft);
    if (fi >= 0) floor = fi;
    else if (TIERS.includes(ft)) floor = 0;  // known tier below the ladder (e.g. 'local') -> allow from the bottom
    else return null;                        // unrecognized floor -> FAIL SAFE, never collapse to the cheapest tier
  }
  for (let i = di; i >= floor; i--) {                         // walk desired tier -> floor, never below
    const models = Array.isArray(tiers[ladder[i]]) ? tiers[ladder[i]] : [];
    for (const m of models) if (!blockedSet.has(String(m))) return { tier: ladder[i], model: m };
  }
  return null;                                                // all blocked down to the floor -> hand back
}

// Overlay user pins from .coaltipple.json `modelTiers` onto a tiers object. A pin
// front-loads its model(s) into the named tier (highest priority) and removes them
// from every other tier, so a human can name a model introspection CANNOT see (one
// released after the model's training cutoff) or correct a misclassification. Pins
// are the one source that beats auto-classification — the introspection blind-spot
// override. Deterministic + pure (Phoenix #8): same input, same output.
export function applyPins(tiers, modelTiers = {}) {
  const out = {};
  for (const t of TIERS) out[t] = Array.isArray(tiers && tiers[t]) ? tiers[t].slice() : [];
  if (!modelTiers || typeof modelTiers !== 'object') return out;
  for (const t of TIERS) {
    const pin = modelTiers[t];
    if (!pin) continue;
    const names = (Array.isArray(pin) ? pin : [pin]).map((x) => String(x).trim()).filter(Boolean);
    if (!names.length) continue;
    for (const t2 of TIERS) out[t2] = out[t2].filter((m) => !names.includes(m)); // de-dup across tiers
    out[t] = [...names, ...out[t]];                                              // pinned models win = front
  }
  return out;
}

// A complete floor ranking ready to persist (install seed; rebuilt on the spot
// whenever the validity gate rejects the cached one). The ranking is ALWAYS the
// alias floor (haiku<sonnet<opus -> low/mid/heavy) with reasoning mirroring heavy
// (strongest @ max effort); the user's `modelTiers` pins overlay LAST — they are
// the one human override (a model released after a model's training cutoff that
// introspection cannot see). `models` is accepted only to stamp the `listHash`
// (the freshness fingerprint) — it does NOT shape the tiers: routing rides the
// tier STRUCTURE + unknown->heavy + the spawn-fail-fall, not an exact model list.
export function buildFloorRanking(models = [], modelTiers = {}) {
  const tiers = aliasDefaults();
  if (!tiers.reasoning || !tiers.reasoning.length) tiers.reasoning = tiers.heavy.slice();
  const pinned = applyPins(tiers, modelTiers);
  return { schemaVer: SCHEMA_VER, listHash: modelListHash(models), complete: true, source: 'alias-floor', tiers: pinned };
}
