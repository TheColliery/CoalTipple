// Single source of truth for every .coaltipple.json key.
// verify.mjs validates the factory config against it — a key added here is
// automatically validated and documented. The `flags`/`help` fields keep the
// schema CLI-ready for a future `configure` command (deferred in v1, not built yet).
// (Mirrors CoalMine's config-schema.mjs pattern for series parity.)
//
// Spec fields:
//   key       canonical .coaltipple.json key
//   type      'bool' | 'int' | 'enum' | 'strArr' | 'obj'
//   values    allowed values for 'enum' (compared case-insensitively)
//   lower     lowercase each 'strArr' item on write
//   flags     extra CLI aliases besides --<key> (legacy names included)
//   noFlag    validated + documented but not CLI-settable (nested objects)
//   help      one-line description for --help

export const CONFIG_SCHEMA = [
  { key: 'language', type: 'enum', values: ['auto', 'th', 'en', 'ja', 'zh', 'es'], flags: ['-l'], help: 'Language override for prompts and nudges (auto, th, en, ja, zh, es)' },
  { key: 'enableRouting', type: 'bool', flags: ['-r', '--routing'], help: 'Master switch for model/effort routing (default: true)' },
  { key: 'mode', type: 'enum', values: ['auto', 'delegation', 'escalation', 'off'], flags: ['-m'], help: 'Routing mode: auto, delegation (down for tokens), escalation (up for quality), off' },
  { key: 'qualityBar', type: 'int', min: 0, max: 100, flags: ['-Q'], help: 'Acceptable-quality bar (0-100). A result must clear it or routing climbs the model ladder: start at the grade floor -> attempt -> verify vs the task-contract done-criteria (domain-appropriate: code runs/tests, text completeness+consistency, research claims sourced) -> climb one rung if short; jump to the top tier if far below or out of attempts. 0 = anything passes (cheapest tier always). 100 = nothing passes below the top (best tier always). General-purpose, not code-only. Default: 60' },
  { key: 'delegateMinLines', type: 'int', min: 1, max: 100000, flags: ['-d'], help: 'Min task size (lines for code, words/chars for text) below which delegate-down is skipped and done in-session — the spawn-overhead break-even floor. Range 1-100000, default 120' },
  { key: 'maxTotalAttempts', type: 'int', min: 1, max: 5, flags: ['-a'], help: 'Escalation STAIRCASE budget: max spawn+retry attempts across tiers before jump-to-top/hand-back. Range 1-5 (ladder low<mid<heavy<reasoning = 4 rungs). Default 2 (one attempt + one escalation). Double-edged: 1 = jump too fast (over-provision); 4-5 = climb rung-by-rung = death by a thousand cuts; 2-3 = sweet spot' },
  { key: 'subagentTimeoutSeconds', type: 'int', min: 5, max: 3600, flags: ['-s'], help: 'Seconds before a stalled background sub-worker is marked failed. Range 5-3600, default 150' },
  { key: 'maxConcurrentSubagents', type: 'int', min: 1, max: 16, flags: ['-c'], help: 'Cap on concurrent sub-workers in a fan-out (they share one rate limit). Range 1-16 (platform concurrency ceiling), default 4' },
  { key: 'ultracodeEnabled', type: 'bool', flags: ['-U'], help: 'Allow the ultracode top rung (xhigh + multi-agent fan-out) for wide parallel work (default: true)' },
  { key: 'requireTaskContract', type: 'bool', flags: ['-T'], help: 'Require a compact task contract (goal+constraints+interface+done) on every delegation — the outbound briefing (default: true)' },
  { key: 'qaOnMerge', type: 'enum', values: ['strict', 'standard', 'off'], flags: ['-q'], help: 'Verify a sub-worker output before accepting it on merge (strict, standard, off; default: standard)' },
  { key: 'fastModeOnLatencyRequest', type: 'bool', flags: ['-F'], help: 'Allow attaching fast-mode only on an explicit human latency request — never as a routing rung (default: true)' },
  { key: 'preserveVoiceForUserFacing', type: 'bool', flags: ['-V'], help: 'Never delegate final user-facing prose/answers to a cheaper model (default: true)' },
  { key: 'gitRecoveryBoundary', type: 'enum', values: ['auto', 'on', 'off'], flags: ['-G'], help: 'Use git commits as an extra recovery boundary when inside a git repo (auto, on, off; default: auto)' },
  { key: 'rankingMode', type: 'enum', values: ['auto', 'manual'], flags: ['-M', '--ranking'], help: 'Who builds the model ranking: auto = the agent introspects + builds it (overlays modelTiers pins) — must be maximally accurate; manual = the human owns it via modelTiers (+ alias floor for unpinned tiers), no introspection. Default: auto' },
  { key: 'rankingRefreshDays', type: 'int', min: 1, max: 365, flags: ['-R'], help: 'Cadence backstop (days) to re-enumerate + re-classify the model tier map even when the list seems unchanged. Range 1-365 (min 1 — 0 would force a per-session enumerate = token burn), default 30' },
  { key: 'sensitivePaths', type: 'strArr', flags: ['--sensitive'], help: 'Comma-separated path fragments that force the High/Reasoning tier (e.g. auth, crypto, payments, migrations)' },
  { key: 'excludePaths', type: 'strArr', lower: true, flags: ['-X', '--exclude'], help: 'Comma-separated dirs skipped when grading (default: node_modules, .git, dist, vendor, build)' },
  { key: 'hotKeywords', type: 'strArr', lower: true, flags: ['--keywords'], help: 'LEGACY flat keyword list (prefer the structured `keywords` groups). Still merges as a grade-4 sensitive group. Comma-separated' },
  { key: 'keywords', type: 'obj', noFlag: true, validate: validateKeywordGroups, help: 'Routing keyword GROUPS by task type — each { grade (1-5 floor), sensitive? (never-delegate-down), preserveVoice? (keep the user-facing deliverable), words: [...] }. Overrides/extends the factory groups (coding.concurrency/crypto/security/data, math, knowledge, domain, creative): add/remove a word or change a grade per group' },
  { key: 'disableRouting', type: 'strArr', lower: true, flags: ['-x', '--disable'], help: 'Comma-separated task domains to never route (coding, text, math, research) or "all"' },
  { key: 'contextFiles', type: 'strArr', flags: ['-C', '--context'], help: 'Memory-anchor file(s) a fresh worker reads for project context/conventions beyond the task contract (any name). Empty = rely on platform memory (CLAUDE.md/AGENTS.md). Comma-separated paths' },
  { key: 'memoryOffer', type: 'enum', values: ['auto', 'off'], flags: ['--memory'], help: 'When no memory anchor exists, offer (lazily, once) to set one up: auto (default) or off (disabled/skipped; re-enable via /coaltipple memory)' },
  { key: 'modelTiers', type: 'obj', noFlag: true, help: 'Optional user pins overriding auto-classification: { cheap|mid|heavy|reasoning|local: "model" | ["priority","chain"] }' },
];

// Validate an already-parsed JSON value against a spec.
// Returns an error message fragment ("must be ...") or null when valid.
export function validateValue(spec, v) {
  switch (spec.type) {
    case 'bool':
      return typeof v === 'boolean' ? null : 'must be a boolean';
    case 'int':
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'must be a finite number';
      if (!Number.isInteger(v)) return 'must be an integer';
      if (spec.min != null && v < spec.min) return `must be >= ${spec.min}`;
      if (spec.max != null && v > spec.max) return `must be <= ${spec.max}`;
      return null;
    case 'enum':
      return typeof v === 'string' && spec.values.includes(v.toLowerCase())
        ? null
        : `must be one of: ${spec.values.join(', ')}`;
    case 'strArr':
      return Array.isArray(v) && v.every((x) => typeof x === 'string')
        ? null
        : 'must be an array of strings';
    case 'obj':
      if (!(v && typeof v === 'object' && !Array.isArray(v))) return 'must be an object';
      return spec.validate ? spec.validate(v) : null;
    default:
      return `has an unknown spec type '${spec.type}'`;
  }
}

// Deep validator for the `keywords` groups (validateValue calls it for that key; verify.mjs +
// configure.mjs surface its message). A malformed group fails loud rather than silently grading wrong:
// an out-of-range grade is the input-boundary the grader would otherwise turn into an undefined tier.
function validateKeywordGroups(groups) {
  for (const name of Object.keys(groups)) {
    const g = groups[name];
    if (!g || typeof g !== 'object' || Array.isArray(g)) return `group '${name}' must be an object`;
    if (!Array.isArray(g.words) || !g.words.every((w) => typeof w === 'string')) return `group '${name}'.words must be an array of strings`;
    if (g.grade != null && !(Number.isInteger(g.grade) && g.grade >= 1 && g.grade <= 5)) return `group '${name}'.grade must be an integer 1-5`;
    if (g.sensitive != null && typeof g.sensitive !== 'boolean') return `group '${name}'.sensitive must be a boolean`;
    if (g.preserveVoice != null && typeof g.preserveVoice !== 'boolean') return `group '${name}'.preserveVoice must be a boolean`;
  }
  return null;
}
