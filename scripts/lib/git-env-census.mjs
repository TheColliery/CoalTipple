// CWK-133/C-4 findings-back (INSPECT HIGH-1) -- a cheap TEXTUAL census: does every
// spawnSync('git'.../execFileSync('git'... call under scripts/ carry an explicit `env:`
// in the same call? It stops anything NEW from landing a bare git spawn that silently
// inherits process.env, the exact shape the reviewer found unguarded in four sites this
// room's own gates never caught before this check existed.
//
// CWK-136 (R14) -- the second rung. PRESENCE of an `env:` key is not SAFETY: `env: process.env`
// passes the first rung and re-opens the linked-worktree GIT_DIR hazard CWK-133 closed (a git
// hook exports an ABSOLUTE GIT_DIR / GIT_INDEX_FILE; a fixture that inherits it re-initialises
// the REAL repository). So the census also refuses an `env:` value whose text holds
// process.env once every gitEnv(...) call is removed from it: gitEnv() is this room's
// GIT_*-stripping helper (git-env.mjs, proven by git-env.test.mjs), and a spread of
// process.env BESIDE a gitEnv() spread does not repair it -- a spread never deletes the GIT_*
// keys process.env already put there. An identifier env (`env: E`) is resolved ONE hop to its
// `const|let|var E =` initializer in the same file.
//
// THE NAMED CEILING (a textual census, not a JS parser; it errs only toward silence). These
// shapes PASS the census silently, measured by INSPECT's probe (R14, LOW-2):
//   1. an identifier it cannot resolve in the same file (a parameter, an import);
//   2. a second hop (`const A = process.env; const B = A; env: B`);
//   3. a non-stripping helper call whose body returns process.env (`env: mk()`): only the
//      NAME gitEnv is trusted, never what a helper does, and a local helper that happens to be
//      called gitEnv is trusted by name (secret-gate.mjs ships its own);
//   4. bracket access to the env object (`env: process['env']`), which PROCESS_ENV_RE misses;
//   5. destructuring (`const { env } = process; ... env: env`);
//   6. a `//` inside an earlier string on the spawn's own line hides that call.
// (A name that merely ENDS in gitEnv, e.g. rawgitEnv(process.env), is NOT in this list: the call
// is matched at an identifier boundary and the census refuses it.) What proves the env SAFE is
// gitEnv()'s own test; this proves nothing NEW can land the shapes the room has actually met.
//
// scanGitSpawns() is pure (a fixture map in, { findings, files, calls, safe } out) so it is
// unit-tested directly, red-first, without a repo clone; censusGitSpawns() is its findings-only
// view; collectScriptsMjs() is the real filesystem walk, kept separate so the pure functions
// never touch disk.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// BLOB-PINNED EXEMPTIONS (CWK-174, R14; the chief's order r14 section 6, rail 2; the way CoalMine,
// CoalBoard and CoalLedger answered it). The house secret scan is a BYTE-EQUAL canon copy (the
// umbrella's scripts/scanner-parity.mjs measures it), so its test file cannot be patched room-side
// without breaking parity. Its git spawns -- scripts/secret-scan.test.mjs (the gitAt helper, no env:)
// -- inherit an ABSOLUTE GIT_INDEX_FILE whenever the pre-commit hook runs under a PATHSPEC commit
// (git commit -F msg -- <file>) or git commit -a, so the fixtures stage into the REAL commit's
// index: the CWK-133 class living in the canon TEMPLATE, routed to the .github deputy. Until that
// fix lands the census exempts the file BY BYTES: a row matches only while the file's git blob id
// (line endings normalised to LF) equals `blob`, so any edit, or the canon fix itself, re-arms the
// census on that file. DELETE the row when the canon fix lands and this room re-copies the file.
// Measured when the row was written: scripts/secret-gate.test.mjs and scripts/secret-gate.mjs
// route every git spawn through their own GIT_*-stripping gitEnv(), so they carry NO row.
export const CENSUS_EXEMPT = [
  { rel: 'scripts/secret-scan.test.mjs', blob: 'a9cb7145e31139ec3c490dd7714df8fa7dc6cf86', why: 'canon template test file, byte-equal by parity; gitAt() spawns carry no env: (absolute GIT_INDEX_FILE under a pathspec/-a commit); DELETE when the canon fix lands' },
];

// The git blob id of `text` (what `git hash-object` prints for that content), CRLF -> LF first so
// a Windows autocrlf checkout of the same file pins the same row.
export function gitBlobId(text) {
  const body = Buffer.from(String(text).replace(/\r\n/g, '\n'), 'utf8');
  return createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
}

const CALL_RE = /(spawnSync|execFileSync)\(\s*['"]git['"]/g;
const ENV_KEY_RE = /\benv\s*:/;
const GIT_ENV_CALL_RE = /(?<![\w$])gitEnv\(/; // not global: the loop re-runs it on the shortened string
const PROCESS_ENV_RE = /\bprocess\s*\.\s*env\b/;

// A match on the same line as an EARLIER `//` is inside a line comment -- skip it. This is
// a textual heuristic, not a real JS parser: it can under-detect (a `//` inside an earlier
// string on the same line hides a real call), never over-detect a comment as code, which is
// the safer failure direction for a NEW gate landing on an existing, densely-commented tree.
function isInLineComment(text, matchIndex) {
  const lineStart = text.lastIndexOf('\n', matchIndex) + 1;
  return text.slice(lineStart, matchIndex).includes('//');
}

function findMatchingClose(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// The text of ONE expression starting at `from`: up to the first top-level `,` (or `;` when
// `stopAtSemi`), or the close of whatever encloses it. Brackets nest; a quoted string or a
// template literal is skipped whole (a `${}` inside a template is not entered).
function readExpr(text, from, stopAtSemi = false) {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === '\'' || c === '"' || c === '`') {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === '\\') i++;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) return text.slice(from, i); depth--; }
    else if (depth === 0 && (c === ',' || (stopAtSemi && c === ';'))) return text.slice(from, i);
  }
  return text.slice(from);
}

// `expr` with every gitEnv(...) call removed (balanced), so process.env inside gitEnv()'s own
// ARGUMENT is not mistaken for the env value, while a process.env spread beside it still shows.
function withoutGitEnvCalls(expr) {
  // The call starts at an identifier boundary (INSPECT LOW-2): rawgitEnv( / notgitEnv( / x$gitEnv( are
  // other helpers, not this room's, and their process.env argument must stay visible.
  let s = expr;
  for (let m = GIT_ENV_CALL_RE.exec(s); m; m = GIT_ENV_CALL_RE.exec(s)) {
    const close = findMatchingClose(s, m.index + 'gitEnv'.length);
    if (close === -1) return s.slice(0, m.index);
    s = s.slice(0, m.index) + s.slice(close + 1);
  }
  return s;
}

// true = the env value holds process.env that gitEnv() did not strip. `hop` bounds the identifier
// resolution to ONE step.
function holdsUnstrippedProcessEnv(expr, fileText, hop = 0) {
  const rest = withoutGitEnvCalls(expr);
  if (PROCESS_ENV_RE.test(rest)) return true;
  const name = rest.trim();
  if (hop === 0 && /^[A-Za-z_$][\w$]*$/.test(name)) {
    const decl = new RegExp(`\\b(?:const|let|var)\\s+${name.replace(/\$/g, '\\$')}\\s*=\\s*`).exec(fileText);
    if (decl) return holdsUnstrippedProcessEnv(readExpr(fileText, decl.index + decl[0].length, true), fileText, 1);
  }
  return false;
}

export function scanGitSpawns(files, exempt = CENSUS_EXEMPT) {
  const findings = [];
  let calls = 0;
  let safe = 0;
  let exempted = 0;
  for (const { rel, text } of files) {
    if (exempt.some((e) => e.rel === rel && e.blob === gitBlobId(text))) { exempted++; continue; }
    CALL_RE.lastIndex = 0;
    let m;
    while ((m = CALL_RE.exec(text))) {
      if (isInLineComment(text, m.index)) continue;
      calls++;
      const line = text.slice(0, m.index).split('\n').length;
      const openIdx = text.indexOf('(', m.index);
      const closeIdx = findMatchingClose(text, openIdx);
      if (closeIdx === -1) {
        findings.push(`${rel}:${line} unbalanced parens scanning a ${m[1]}('git', ...) call -- census cannot verify it`);
        continue;
      }
      const callText = text.slice(openIdx, closeIdx + 1);
      const envKey = ENV_KEY_RE.exec(callText);
      if (!envKey) {
        findings.push(`${rel}:${line} ${m[1]}('git', ...) carries no 'env:' -- must route through gitEnv() (CWK-133/C-4)`);
        continue;
      }
      const envExpr = readExpr(callText, envKey.index + envKey[0].length);
      if (holdsUnstrippedProcessEnv(envExpr, text)) {
        findings.push(`${rel}:${line} ${m[1]}('git', ...) env: holds process.env without gitEnv() -- ambient GIT_* reaches the child (CWK-133/C-4, CWK-136)`);
        continue;
      }
      safe++;
    }
  }
  return { findings, files: files.length, calls, safe, exempted };
}

export function censusGitSpawns(files, exempt = CENSUS_EXEMPT) {
  return scanGitSpawns(files, exempt).findings;
}

// Real filesystem walk of scripts/**/*.mjs, `rel` relative to `repo` so a finding names the
// exact path the reviewer's own manual census used (`scripts/lib/...`).
export function collectScriptsMjs(repo) {
  const scriptsDir = path.join(repo, 'scripts');
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.mjs')) {
        files.push({ rel: path.relative(repo, p).replace(/\\/g, '/'), text: fs.readFileSync(p, 'utf8') });
      }
    }
  })(scriptsDir);
  return files;
}
