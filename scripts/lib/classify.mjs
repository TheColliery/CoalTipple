// The ranking + bootstrap LOCK. Routing is gated on a valid ranking; this module
// guarantees one is always obtainable. Model introspection (self-knowledge) is
// the PRIMARY classifier — run by SKILL.md, persisted here. These functions are
// the deterministic substrate: the 0-token heuristic FLOOR (last resort —
// name-matching ROTS, so it is never the authority), the validity gate, and
// atomic state I/O. Node built-ins only.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const SCHEMA_VER = 1;
export const TIERS = ['local', 'low', 'mid', 'heavy', 'reasoning'];
const STATE_FILE = 'ranking.json';

// Order = priority: local is orthogonal (on-device) and wins; then strongest
// capability word wins (heavy > mid > low) so "Sonnet (Thinking)" reads heavy,
// not mid. A name matching no word falls through to the unknown -> heavy rule.
const WORD_TIER = [
  [/(local|llama|ollama|gguf)/i, 'local'],
  [/(opus|ultra|thinking|reason|o1|o3|large|max)/i, 'heavy'],
  [/(sonnet|pro|medium|30b|70b)/i, 'mid'],
  [/(haiku|flash|mini|nano|lite|small|8b|7b|3b)/i, 'low'],
];

// Classify ONE raw model name -> tier. LAST RESORT (introspection is primary).
// Unknown -> 'heavy', NEVER cheap (the Fable rule: unrecognized = assume strong).
export function classifyModel(name) {
  const s = String(name || '');
  for (const [re, tier] of WORD_TIER) if (re.test(s)) return tier;
  return 'heavy';
}

const nameOf = (m) => (typeof m === 'string' ? m : (m && m.name) || '');

// Parse a display name -> { base, version, longContext }. A "256k"/"1m" variant
// is the SAME model with a bigger context window (orthogonal flag), NOT a
// separate capability entry — so variants collapse and never crowd a tier.
export function parseModel(name) {
  const s = String(name || '').trim();
  const longContext = /\b(\d+k|1m)\b/i.test(s);
  const base = s.replace(/\(?\b(\d+k|1m)\b\)?/ig, ' ').replace(/\s+/g, ' ').trim();
  const vm = base.match(/(\d+(?:\.\d+)?)/);
  return { base, version: vm ? parseFloat(vm[1]) : 0, longContext };
}

// Deduped, version-ordered floor: collapse context-variants to one base model
// per tier, newest version first (the priority-chain order). Last resort only —
// introspection orders better; this just keeps the fallback sane on raw names.
export function buildHeuristicFloor(models = []) {
  const seen = { local: new Map(), low: new Map(), mid: new Map(), heavy: new Map(), reasoning: new Map() };
  for (const m of models) {
    const name = nameOf(m);
    if (!name) continue;
    const { base, version } = parseModel(name);
    const map = seen[classifyModel(base)];
    if (!map.has(base)) map.set(base, version); // dedupe context-variants by base
  }
  const out = { local: [], low: [], mid: [], heavy: [], reasoning: [] };
  for (const t of TIERS) out[t] = [...seen[t].entries()].sort((a, b) => b[1] - a[1]).map(([base]) => base);
  return out;
}

// Claude-family alias tiers — always available, never stale (the platform
// resolves the alias to the current model). reasoning = strongest @ max effort.
export function aliasDefaults() {
  return { local: [], low: ['haiku'], mid: ['sonnet'], heavy: ['opus'], reasoning: ['opus'] };
}

export function modelListHash(models = []) {
  const names = models.map(nameOf).filter(Boolean).sort();
  return crypto.createHash('sha256').update(names.join('\n')).digest('hex').slice(0, 16);
}

// Valid iff: parses, matches schema version, complete, has tiers, and its
// listHash matches the CURRENT model list. Any failure -> rebuild (Phoenix #12).
export function validateRanking(ranking, currentHash) {
  if (!ranking || typeof ranking !== 'object') return 'missing';
  if (ranking.schemaVer !== SCHEMA_VER) return 'schema-version mismatch';
  if (!ranking.complete) return 'incomplete (interrupted build)';
  if (!ranking.tiers || typeof ranking.tiers !== 'object') return 'no tiers';
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
  const di = ladder.indexOf(desiredTier);
  if (di < 0) return null;                                    // unknown tier -> caller handles
  const floor = Math.max(floorTier ? ladder.indexOf(floorTier) : 0, 0);
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

// A complete floor ranking ready to persist (install / conductor bootstrap when
// no valid ranking exists yet and no introspection has run). Heuristic over
// alias defaults; reasoning mirrors heavy (strongest @ max effort). User
// `modelTiers` pins overlay LAST — they beat auto-classification.
export function buildFloorRanking(models = [], modelTiers = {}) {
  const tiers = aliasDefaults();
  if (models && models.length) {
    const floor = buildHeuristicFloor(models);
    for (const t of TIERS) if (floor[t] && floor[t].length) tiers[t] = floor[t];
  }
  if (!tiers.reasoning || !tiers.reasoning.length) tiers.reasoning = tiers.heavy.slice();
  const pinned = applyPins(tiers, modelTiers);
  return { schemaVer: SCHEMA_VER, listHash: modelListHash(models), complete: true, source: 'heuristic-floor', tiers: pinned };
}

// The listHash of an EMPTY model list — the fingerprint of a ranking seeded
// WITHOUT enumerating the live list (install / bootstrap). sha256('').slice(0,16).
export const EMPTY_LIST_HASH = modelListHash([]);
const BOOTSTRAP_SOURCES = ['install-floor', 'heuristic-floor'];

// Is this ranking a never-introspected BOOTSTRAP seed (not a real enumeration)?
// The installer/conductor seed the floor over an EMPTY list when no introspection
// has run yet: `source` is a floor source AND `listHash` is the empty-list hash.
// Its `complete:true` only attests "the floor is seeded", NOT "the live list was
// enumerated" — so on the first route by a capable main, Step 0 UPGRADES it via
// introspection (writes source:"introspection" + a real listHash). A cheap signal:
// the `source`/`listHash` fields alone decide it — no live enumeration needed, so
// the token-floor holds (a non-bootstrap cached ranking is trusted as-is). The
// validity gate still treats a bootstrap as VALID (routing never stalls waiting to
// upgrade); this is the "should refresh when convenient" signal, layered on top.
// Pure (Phoenix #8): same input, same output.
export function isBootstrapRanking(ranking) {
  return !!ranking
    && BOOTSTRAP_SOURCES.includes(ranking.source)
    && ranking.listHash === EMPTY_LIST_HASH;
}
