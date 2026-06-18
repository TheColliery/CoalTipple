// Zero-dep unit tests for the deterministic grader. Run: node --test grade.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grade } from './grade.mjs';

test('null inputs DEGRADE, never throw (a boundary authority must not crash)', () => {
  // `= []`/`= {}` defaults fire only on undefined — an explicit null used to throw.
  assert.equal(grade({ files: null }).grade, 1, 'files:null -> coerced to []');
  assert.equal(grade({ config: null, prompt: 'x' }).grade, 1, 'config:null -> coerced to {}');
  assert.equal(grade({ prompt: null }).grade, 1, 'prompt:null -> coerced to ""');
  assert.equal(grade({ sizeUnits: null }).grade, 1, 'sizeUnits:null -> coerced to 0');
  assert.equal(grade(null).grade, 1, 'grade(null) -> {} default + inner coercion, no throw');
  // config:null must not break keyword grading either (still grades a hot keyword).
  assert.equal(grade({ prompt: 'add a constant-time compare', config: null }).grade, 5);
});

test('trivial prompt, no files -> grade 1 / low', () => {
  const r = grade({ prompt: 'list the readme files' });
  assert.equal(r.grade, 1);
  assert.equal(r.tier, 'low');
});

test('single small file -> grade 2', () => {
  const r = grade({ prompt: 'fix typo', files: [{ path: 'src/util.js', lines: 40 }] });
  assert.equal(r.grade, 2);
});

test('2 files / 600 lines -> grade 3 / mid', () => {
  const r = grade({ prompt: 'refactor', files: [{ path: 'a.js', lines: 300 }, { path: 'b.js', lines: 300 }] });
  assert.equal(r.grade, 3);
  assert.equal(r.tier, 'mid');
});

test('>3 files -> grade 4 / heavy', () => {
  const r = grade({ prompt: 'x', files: [{ path: 'a' }, { path: 'b' }, { path: 'c' }, { path: 'd' }] });
  assert.equal(r.grade, 4);
  assert.equal(r.tier, 'heavy');
});

test('sensitive path forces >=4 even at 1 small file (kills overconfidence)', () => {
  const r = grade({ prompt: 'small tweak', files: [{ path: 'src/auth/login.js', lines: 30 }] });
  assert.equal(r.grade, 4);
  assert.match(r.reasons.join(' '), /sensitive/);
});

test('concurrency keyword forces grade 5 regardless of size', () => {
  const r = grade({ prompt: 'is there a race condition in this mutex?', files: [{ path: 'x.js', lines: 10 }] });
  assert.equal(r.grade, 5);
  assert.equal(r.tier, 'reasoning');
});

test('excluded dirs do not count toward breadth', () => {
  const r = grade({ prompt: 'x', files: [{ path: 'node_modules/foo/a.js', lines: 9999 }] });
  assert.equal(r.grade, 1);
});

test('deterministic — same input, same output', () => {
  const input = { prompt: 'optimize query in a db migration', files: [{ path: 'm.sql', lines: 50 }] };
  assert.deepEqual(grade(input), grade(input));
});

test('keyword match is word-boundary: no false grade on embedded words, plurals still fire', () => {
  assert.equal(grade({ prompt: 'translate an anatomical diagram', sizeUnits: 80 }).grade, 2); // 'atomic' must NOT fire inside 'anatomical'
  assert.equal(grade({ prompt: 'summarize immigration policy', sizeUnits: 80 }).grade, 2);    // 'migration' must NOT fire inside 'immigration'
  assert.equal(grade({ prompt: 'run the db migrations', sizeUnits: 10 }).grade, 4);            // 'migration' still matches the plural
  assert.equal(grade({ prompt: 'fix the atomic counter', sizeUnits: 10 }).grade, 5);          // real 'atomic' still fires
});

test('non-code task graded by generalized sizeUnits (translation/research/docs)', () => {
  assert.equal(grade({ prompt: 'translate this paragraph', sizeUnits: 80 }).grade, 2);  // small content
  assert.equal(grade({ prompt: 'translate this chapter', sizeUnits: 700 }).grade, 3);   // medium
  assert.equal(grade({ prompt: 'translate this whole book', sizeUnits: 5000 }).grade, 4); // large
  assert.equal(grade({ prompt: 'summarize', sizeUnits: 1000 }).grade, 4); // boundary: >=1000 -> grade 4 (matches maxLines>=1000)
  // a hard/sensitive keyword still overrides size for text too:
  assert.equal(grade({ prompt: 'proofread this legal contract', sizeUnits: 80, config: { hotKeywords: ['legal contract'] } }).grade, 4);
});

test('crypto/timing keyword forces grade 5 by description, no files (the constantTimeEqual dogfood gap)', () => {
  // pre-fix: none of these matched HOT5 ('cryptograph'/'encrypt' miss them), so the
  // floor graded them trivial and a weak main delegated hand-rolled crypto DOWN.
  assert.equal(grade({ prompt: 'implement constantTimeEqual timing-attack-safe + test' }).grade, 5);
  assert.equal(grade({ prompt: 'a constant-time comparison for tokens' }).grade, 5);
  assert.equal(grade({ prompt: 'small crypto helper, ~10 lines' }).grade, 5);
});

test('audit / bug-scan keyword forces grade 4 by description (the Haiku-floor-self gap)', () => {
  // pre-fix: 'scan for bugs' / 'security audit' matched NO group, so a whole-repo
  // bug-scan graded by SIZE alone -> at the floor (Haiku) it collapsed to SELF and
  // returned a shallow "no bugs". The 'audit' group makes it high-by-DIFFICULTY.
  assert.equal(grade({ prompt: 'scan for bugs in the codebase' }).grade, 4);
  assert.equal(grade({ prompt: 'do a security audit of this skill' }).grade, 4);
  assert.equal(grade({ prompt: 'find all bugs, most thorough' }).grade, 4);
});

test('keyword GROUPS set the sensitive flag (never-down), keyed on the group not the grade', () => {
  const crypto = grade({ prompt: 'add a constant-time compare' });
  assert.equal(crypto.grade, 5);
  assert.equal(crypto.sensitive, true);   // crypto is a sensitive group
  const conc = grade({ prompt: 'fix the race condition' });
  assert.equal(conc.grade, 5);
  assert.equal(conc.sensitive, false);    // concurrency is grade-5 but NOT sensitive (reasoning-hard, not security)
  const path = grade({ prompt: 'tweak', files: [{ path: 'src/payment/charge.js', lines: 20 }] });
  assert.equal(path.sensitive, true);     // a sensitive PATH also flags it
});

test('non-code domains grade per the built-in groups (math / knowledge / domain / creative)', () => {
  assert.equal(grade({ prompt: 'write a formal proof of termination' }).grade, 5);       // math
  assert.equal(grade({ prompt: 'do a systematic review of the sources' }).grade, 3);     // knowledge
  const dom = grade({ prompt: 'translate this legal contract clause' });
  assert.equal(dom.grade, 4);
  assert.equal(dom.sensitive, true);                                                     // domain (sensitive)
  const cre = grade({ prompt: 'rewrite this in our brand voice' });
  assert.equal(cre.grade, 2);
  assert.equal(cre.preserveVoice, true);                                                 // creative (preserveVoice)
});

test('config.keywords overrides/extends the factory groups (the user-tunable layer)', () => {
  // a brand-new group the user adds
  const added = grade({ prompt: 'frobnicate the reactor', config: { keywords: { 'custom.frob': { grade: 5, sensitive: true, words: ['frobnicate'] } } } });
  assert.equal(added.grade, 5);
  assert.equal(added.sensitive, true);
  // overriding an existing group replaces its words: the new word fires
  const over = grade({ prompt: 'add a nonce', config: { keywords: { 'crypto': { grade: 5, sensitive: true, words: ['nonce'] } } } });
  assert.equal(over.grade, 5);
  assert.equal(over.sensitive, true);
});

test('legacy hotKeywords still merges as a grade-4 sensitive group (backward-compat)', () => {
  const r = grade({ prompt: 'handle the frobwidget specially', config: { hotKeywords: ['frobwidget'] } });
  assert.equal(r.grade, 4);
  assert.equal(r.sensitive, true);
});

test('diagnosis keyword narrowed: bare word no longer fires, specific phrases still do', () => {
  // 'diagnosis' alone used to false-match "bug diagnosis", "root-cause diagnosis", etc.
  // It was replaced with 'medical diagnosis' + 'clinical diagnosis' (specific-phrase convention).
  assert.notEqual(grade({ prompt: 'fix the bug diagnosis in the report' }).grade, 4, 'bare diagnosis must NOT fire the domain group');
  assert.equal(grade({ prompt: 'review the medical diagnosis workflow' }).grade, 4, 'medical diagnosis still fires the domain group');
  assert.equal(grade({ prompt: 'flag any clinical diagnosis errors' }).grade, 4, 'clinical diagnosis still fires the domain group');
  // bare 'clinical' was over-broad (matched "clinical analysis of code"); narrowed to 'clinical trial'.
  assert.notEqual(grade({ prompt: 'a clinical analysis of the codebase' }).grade, 4, 'bare clinical (non-medical adjective) must NOT fire the domain group');
  assert.equal(grade({ prompt: 'review the clinical trial protocol' }).grade, 4, 'clinical trial still fires the domain group');
});

test('STEM-vs-WHOLE-WORD: security/crypto keywords no longer over-match (token!=tokenizer, crypto!=cryptocurrency)', () => {
  // FALSE POSITIVES must be GONE — these whole-words must NOT fire inside a longer word.
  assert.equal(grade({ prompt: 'write a tokenizer for the parser', sizeUnits: 50 }).grade, 2, 'token must NOT fire inside tokenizer');
  assert.equal(grade({ prompt: 'use sessionStorage in the browser', sizeUnits: 50 }).grade, 2, 'session must NOT fire inside sessionStorage');
  assert.equal(grade({ prompt: 'ask the secretary to file it', sizeUnits: 50 }).grade, 2, 'secret must NOT fire inside secretary');
  assert.equal(grade({ prompt: 'track the cryptocurrency price', sizeUnits: 50 }).grade, 2, 'crypto must NOT fire inside cryptocurrency');
  // And as exact whole words they STILL fire (no false-negative regression).
  assert.equal(grade({ prompt: 'store the session token securely', sizeUnits: 10 }).grade, 4, 'token + session whole-words still fire');
  assert.equal(grade({ prompt: 'rotate the secret value', sizeUnits: 10 }).grade, 4, 'secret whole-word still fires');
  assert.equal(grade({ prompt: 'reset the password', sizeUnits: 10 }).grade, 4, 'password whole-word still fires');
  assert.equal(grade({ prompt: 'small crypto helper', sizeUnits: 10 }).sensitive, true, 'crypto whole-word still fires + sensitive');
});

test('STEM-vs-WHOLE-WORD: genuine stems still match the prefix + all suffixes (no false-negative)', () => {
  // STEMS (trailing *) must catch the base AND its suffixes.
  assert.equal(grade({ prompt: 'add authentication to the API', sizeUnits: 10 }).grade, 4, 'authenticat* -> authentication');
  assert.equal(grade({ prompt: 'authenticate the user', sizeUnits: 10 }).grade, 4, 'authenticat* -> authenticate');
  assert.equal(grade({ prompt: 'add authorization checks', sizeUnits: 10 }).grade, 4, 'authoriz* -> authorization');
  assert.equal(grade({ prompt: 'make this thread-safe', sizeUnits: 10 }).grade, 5, 'thread-saf* -> thread-safe');
  assert.equal(grade({ prompt: 'run the db migrations', sizeUnits: 10 }).grade, 4, 'migrat* -> migrations');
  assert.equal(grade({ prompt: 'migrate the schema', sizeUnits: 10 }).grade, 4, 'migrat* -> migrate');
  // crypto family additions: cryptographic / cryptography fire, cryptocurrency does NOT.
  assert.equal(grade({ prompt: 'review the cryptographic primitives', sizeUnits: 10 }).grade, 5, 'cryptographic fires');
  assert.equal(grade({ prompt: 'a question about cryptography', sizeUnits: 10 }).grade, 5, 'cryptography fires');
  assert.equal(grade({ prompt: 'add encryption to the payload', sizeUnits: 10 }).grade, 5, 'encrypt* -> encryption');
  // NO security keyword regressed to a false-negative: each canonical form fires.
  assert.equal(grade({ prompt: 'check the permissions model', sizeUnits: 10 }).grade, 4, 'permission* -> permissions');
});

test('WHOLE-WORD plurals of sensitive nouns fire the never-down gate (no plural false-negative)', () => {
  // The plural-FN class (caught in the v1.0.11 work-review + commit-gate audit): a bare whole-word's
  // plural was silently missed (/\btoken\b/ != "tokens"), letting a sensitive prompt escape the
  // deterministic flag. Both forms are now listed; the FP class must stay closed (token != tokenizer).
  assert.equal(grade({ prompt: 'rotate the access tokens', sizeUnits: 10 }).grade, 4, 'tokens (plural) fires grade 4');
  assert.equal(grade({ prompt: 'rotate the access tokens', sizeUnits: 10 }).sensitive, true, 'tokens (plural) is sensitive');
  assert.equal(grade({ prompt: 'store the api secrets', sizeUnits: 10 }).sensitive, true, 'secrets (plural) is sensitive');
  assert.equal(grade({ prompt: 'reset all user passwords', sizeUnits: 10 }).sensitive, true, 'passwords (plural) is sensitive');
  assert.equal(grade({ prompt: 'invalidate stale sessions', sizeUnits: 10 }).sensitive, true, 'sessions (plural) is sensitive');
  assert.equal(grade({ prompt: 'process the pending payments', sizeUnits: 10 }).sensitive, true, 'payments (plural) is sensitive');
  assert.equal(grade({ prompt: 'debug the deadlocks', sizeUnits: 10 }).grade, 5, 'deadlocks (plural) fires grade 5');
  assert.equal(grade({ prompt: 'the mutexes contend', sizeUnits: 10 }).grade, 5, 'mutexes (plural) fires grade 5');
  assert.equal(grade({ prompt: 'rotate the access token', sizeUnits: 10 }).grade, 4, 'token (singular) still fires');
  assert.equal(grade({ prompt: 'write a tokenizer', sizeUnits: 50 }).grade, 2, 'plural additions must NOT re-open the token->tokenizer FP');
});

test('a config.keywords grade is clamped to 1-5 — the grader never emits an undefined tier', () => {
  const hi = grade({ prompt: 'frobnicate', config: { keywords: { x: { grade: 9, words: ['frobnicate'] } } } });
  assert.equal(hi.grade, 5);          // 9 -> clamped to 5
  assert.equal(hi.tier, 'reasoning'); // never undefined
  const lo = grade({ prompt: 'frobnicate', config: { keywords: { x: { grade: 0, words: ['frobnicate'] } } } });
  assert.ok(lo.tier);                 // 0 -> clamped to 1 -> a valid tier
});
