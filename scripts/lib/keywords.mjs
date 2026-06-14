// Single source of truth for routing keyword lists. grade.mjs imports these
// directly; the conductor's `<coaltipple-shared: hot-keywords>` region is SYNCED
// from here by build-plugin.mjs (the conductor is standalone-portable and cannot
// import). Edit HERE — never edit the conductor's block by hand (verify.mjs
// fails if they drift).

// grade-5 = reasoning-hard (concurrency / crypto-logic / proof). Use specific
// phrases ('mathematical proof' not 'proof') so substrings like 'proofread' or
// 'bulletproof' never false-trigger. The crypto/timing family was added 2026-06
// after a dogfood gap: 'constantTimeEqual timing-attack-safe' matched NONE of the
// old terms ('cryptograph'/'encrypt' miss it), so the deterministic floor graded
// it trivial and a weak main delegated hand-rolled crypto DOWN to save tokens.
// Match crypto-by-description so the sensitive floor fires on the keyword, not the grade.
export const HOT5 = [
  'concurrency', 'mutex', 'race condition', 'deadlock', 'thread-saf', 'atomic',
  'encrypt', 'decrypt', 'mathematical proof', 'formal proof', 'derive equation',
  // 'crypto' (word-start) subsumes the old 'cryptograph' (matches cryptography/-ic too), so that is dropped.
  'crypto', 'timing attack', 'timing-attack', 'constant-time', 'constant time', 'timing-safe', 'side-channel',
];

// grade-4 = sensitive but not pure-logic. Stems ('authenticat', 'authoriz') so the
// grader's word-start match catches the whole family (authenticate/-tion, authorize/-ation);
// these also cover a pure-PROMPT security task that lists no files yet (path-only SENSITIVE
// would miss it). The conductor's loose substring match over the same list is intentional —
// a 0-token hint may over-fire; the grader is the precise authority.
export const HOT4 = [
  'oauth', 'authenticat', 'authoriz', 'auth bypass', 'sql injection', 'migration', 'schema change',
  'access control', 'permission', 'payment', 'rate limit', 'optimize query',
];

// Path fragments that force the High/Reasoning tier even on a 1-file change.
export const SENSITIVE = ['auth', 'crypto', 'payment', 'billing', 'migration', 'secret', 'token', 'password', 'session', 'security'];

// Dirs never counted toward grading breadth.
export const EXCLUDE = ['node_modules', '.git', 'dist', 'vendor', 'build', '.next', 'coverage'];
