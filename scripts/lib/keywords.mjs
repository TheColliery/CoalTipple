// Single source of truth for routing keyword GROUPS, organized by major task type.
// grade.mjs reads KEYWORD_GROUPS directly (each group floors the task grade and may
// flag sensitive / preserveVoice); the .coaltipple.json `keywords` key overrides or
// extends these PER GROUP (add/remove a word, change a grade); the conductor's
// hot-keyword region is SYNCED from the derived HOT5/HOT4 flats below by
// build-plugin.mjs (edit HERE, never the conductor block — verify.mjs fails on drift).
//
// Each group: { grade (1-5 floor), sensitive? (never-delegate-down), preserveVoice?
// (never delegate the user-facing deliverable), words: [...] }. Use specific phrases
// ('mathematical proof' not 'proof', 'legal contract' not 'contract') so substrings
// like 'proofread' / 'smart contract' never false-trigger the match.
//
// STEM vs WHOLE-WORD (the trailing-* convention — see grade.mjs includesAny):
//   - a word ending in `*` is a STEM: it matches the prefix + ANY suffix
//     (`authenticat*` -> authenticate/authentication, `migrat*` -> migrations).
//   - a bare word is WHOLE-WORD: it matches that word only, NOT a longer word that
//     merely starts with it (`token` matches "token" but NOT "tokenizer";
//     `secret` not "secretary"; `crypto` not "cryptocurrency"). Mark a word a stem
//     ONLY when the suffixes are genuinely wanted; leave the over-matchers bare.
export const KEYWORD_GROUPS = {
  // Coding — split by what forces the grade: concurrency/crypto are reasoning-hard
  // (5); security/coding are sensitive (4). crypto/security/coding also never-down.
  'concurrency': { grade: 5, words: ['concurrency', 'mutex', 'mutexes', 'race condition', 'deadlock', 'deadlocks', 'thread-saf*', 'atomic'] },
  'crypto':      { grade: 5, sensitive: true, words: ['crypto', 'cryptographic', 'cryptography', 'timing attack', 'timing-attack', 'constant-time', 'constant time', 'timing-safe', 'side-channel', 'encrypt*', 'decrypt*'] },
  'security':    { grade: 4, sensitive: true, words: ['oauth', 'authenticat*', 'authoriz*', 'auth bypass', 'sql injection', 'access control', 'permission*', 'secret', 'secrets', 'token', 'tokens', 'password', 'passwords', 'session', 'sessions'] },
  'coding':      { grade: 4, sensitive: true, words: ['migrat*', 'schema change', 'payment', 'payments', 'billing', 'rate limit', 'optimize query'] },

  // Audit / review — finding REAL issues needs capability; a cheap tier returns a
  // confident shallow all-clear. High-by-DIFFICULTY: route UP, never size-down/floor-self.
  'audit':       { grade: 4, words: ['bug scan', 'scan for bugs', 'find bugs', 'find all bugs', 'security audit', 'security review', 'vulnerability scan', 'audit the codebase', 'code audit'] },

  // Math — reasoning-hard proof / derivation.
  'math':      { grade: 5, words: ['mathematical proof', 'formal proof', 'derive equation', 'complexity bound'] },

  // Knowledge / research — verify-heavy, mid-tier (the care is rigorous SOURCING, not a high tier).
  'knowledge': { grade: 3, words: ['systematic review', 'literature review', 'citation', 'claim verification'] },

  // Regulated / high-stakes non-code domains — costly errors, never-delegate-down.
  'domain':    { grade: 4, sensitive: true, words: ['legal contract', 'compliance', 'license terms', 'financial audit', 'tax filing', 'valuation', 'medical diagnosis', 'clinical diagnosis', 'dosage', 'clinical trial', 'gdpr', 'hipaa', 'pii'] },

  // Creative — low difficulty, but the prose IS the deliverable: protect the voice.
  'creative':  { grade: 2, preserveVoice: true, words: ['brand voice', 'tone of voice', 'style guide'] },
};

// Derived flat lists for the standalone conductor's 0-token hint (it only needs to
// flag "a high-grade keyword is present" -> grade 5 or 4; the grade-3/2 groups carry
// no hint). build-plugin.mjs syncs these into the conductor; verify.mjs gates drift.
const wordsAtGrade = (n) => Object.values(KEYWORD_GROUPS).filter((g) => g.grade === n).flatMap((g) => g.words);
export const HOT5 = wordsAtGrade(5);
export const HOT4 = wordsAtGrade(4);

// Path fragments that force a sensitive (High/Reasoning, never-down) classification
// even on a 1-file change — the FILE-PATH signal (the keyword groups are the PROMPT signal).
export const SENSITIVE = ['auth', 'crypto', 'payment', 'billing', 'migration', 'secret', 'token', 'password', 'session', 'security'];

// Dirs never counted toward grading breadth.
export const EXCLUDE = ['node_modules', '.git', 'dist', 'vendor', 'build', '.next', 'coverage'];
