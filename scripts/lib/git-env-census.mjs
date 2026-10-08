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
//   6. a `//` inside an earlier string on the spawn's own line hides that call;
//   7. (08c bounce 1) an allowlist env MUTATED through something other than its own name: an alias
//      (`const e = env; e.GIT_DIR = x`), a callee that writes to its argument (`fill(env)`), a getter, a Proxy;
//   8. (08c bounce 1) a binding or write the textual patterns cannot read: a parameter list that holds a nested call
//      (`function f(a = g(), env)`), a write built by `eval` or inside a string, a `with` block.
// The identifier lookups (the allowlist pass and the older process.env hop) are FILE-WIDE, not scope-aware: every
// declaration and every write of the name in the file counts. That errs toward a finding, never toward silence (two
// functions that each build a clean `env` are both refused; route one through gitEnv()).
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
import { escapeRegExp } from './regex-escape.mjs';

// BLOB-PINNED EXEMPTIONS (CWK-174, R14; the chief's order r14 section 6, rail 2; the way CoalMine,
// CoalBoard and CoalLedger answered it). The house secret scan is a BYTE-EQUAL copy of its source
// (the umbrella's scripts/scanner-parity.mjs measures it), so its test file cannot be patched room-side
// without breaking parity. A row matches only while the file's git blob id (line endings normalised
// to LF) equals `blob`, so any edit, or a new source blob, re-arms the census on that file.
// THE FIRST ROW, re-pinned at the 08c re-sync (Bankfire 4433fb56, the SOURCE of the scan; the .github
// template still reads bd5b156c): scripts/secret-scan.test.mjs line 593 passes `env: cleanEnv`, where cleanEnv
// is process.env with the GIT_* keys filtered out (Object.fromEntries over Object.entries(process.env)).
// That env is safe, but it is not the named-keys ALLOWLIST shape the census accepts (no GIT_CONFIG_NOSYSTEM,
// built from process.env rather than from named keys), so the census reads it as an unfiltered process.env.
// The older findings of the previous test blob (gitAt() with no env:) are gone in this one: measured, the
// census reports exactly that one finding on 4433fb56 without the row.
// Measured when the first row was written: scripts/secret-gate.test.mjs and scripts/secret-gate.mjs
// route every git spawn through their own GIT_*-stripping gitEnv(), so they carry NO row.
//
// (The second row, for scripts/release-notes.mjs, is gone: the allowlist rule below accepts the canon file's env, so it
// needs no pin. The 05a hold of scripts/release-notes.test.mjs at d7e299c4 was released at the 08c re-sync.)
export const CENSUS_EXEMPT = [
  { rel: 'scripts/secret-scan.test.mjs', blob: '4433fb56bc97d1facc3fb27804e1934c0577115f', why: 'house secret-scan test, byte-equal to its Bankfire source by parity; line 593 passes env: cleanEnv, process.env with GIT_* filtered out, which is not the named-keys allowlist shape; DELETE when the census rule accepts a GIT_*-filtered process.env or the source builds its env from named keys' },
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
    // EVERY declaration of the name, not the first (08c bounce 1): a clean `const E` in one function must not vouch
    // for a `const E = { ...process.env }` in another. File-wide, not scope-aware, so it errs toward a finding.
    for (const decl of fileText.matchAll(new RegExp(`\\b(?:const|let|var)\\s+${escapeRegExp(name)}\\s*=\\s*`, 'g'))) {
      if (holdsUnstrippedProcessEnv(readExpr(fileText, decl.index + decl[0].length, true), fileText, 1)) return true;
    }
  }
  return false;
}

// THE ALLOWLIST ENV (08c re-sync, main's ruling UMB-456 (2)). An env built from NAMED keys reaches git with nothing
// ambient but those keys, which is stricter than gitEnv() (that strips the GIT_* names from a full copy of
// process.env). The census accepts exactly this shape, checked textually on the env's initializer (one hop for an
// identifier, plus the array literals it names):
//   1. an object literal;
//   2. it sets GIT_CONFIG_NOSYSTEM to '1';
//   3. every process.env in it is a NAMED read, `process.env[k]` or `process.env.NAME`, never a bare spread or
//      argument (`...process.env`, `Object.assign({}, process.env)`, `Object.entries(process.env)`);
//   4. every GIT_* name in it, or in an array literal it names, is one of three that cannot aim git at another
//      repository: GIT_CONFIG_NOSYSTEM, GIT_TERMINAL_PROMPT, GIT_CEILING_DIRECTORIES (the last only NARROWS where
//      git searches). GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE and the rest are refused, in any letter case.
// An identifier (or the shorthand `env`) counts only if isBoundOnceAndNeverWritten() holds: declared once in the file,
// never a parameter or destructured binding, never written to after its declaration (INSPECT M-1, 08c bounce 1).
// Named ceiling, as for the rest of this file (a textual census, not a JS parser; it errs toward silence on shapes it
// cannot read): a key built at run time from a variable the file does not declare as an array literal, a computed key
// (`[k]: v`), a second identifier hop, a write through an alias or through a callee that mutates its argument, and a
// parameter list that holds a nested call are not seen.
const SAFE_GIT_KEYS = new Set(['GIT_CONFIG_NOSYSTEM', 'GIT_TERMINAL_PROMPT', 'GIT_CEILING_DIRECTORIES']);
const SHORTHAND_ENV_RE = /[{,]\s*env\s*(?=[,}])/;

function declInit(name, fileText) {
  const decl = new RegExp(`\\b(?:const|let|var)\\s+${escapeRegExp(name)}\\s*=\\s*`).exec(fileText);
  return decl ? readExpr(fileText, decl.index + decl[0].length, true) : null;
}

// INSPECT M-1 (08c bounce 1): the allowlist pass reads ONE initializer, so it holds only if that initializer is the
// whole story of the name. `name` must be (1) declared exactly once in the file, (2) never bound as a parameter (function,
// arrow, method, catch), a destructured declaration, or a destructuring assignment, and (3) never written to after that:
// no reassignment, no member write (`name.X =`, `name[k] =`, compound forms included), no `delete name`, and no
// Object.assign / defineProperty / setPrototypeOf / Reflect.set on it. The check is file-wide, not scope-aware, so it errs
// toward a finding: two functions that each build a clean `env` are refused too (route one through gitEnv()).
function isBoundOnceAndNeverWritten(name, fileText) {
  const id = `(?<![\\w$.])${escapeRegExp(name)}(?![\\w$])`;
  const count = (src) => [...fileText.matchAll(new RegExp(src, 'g'))].length;
  if (count(`\\b(?:const|let|var)\\s+${id}`) !== 1) return false;
  if (count(`${id}\\s*=(?![=>])`) !== 1) return false; // the declaration's own `=`, and no other
  const anywhere = [
    `\\b(?:const|let|var)\\s*[{\\[][^;]*?${id}[^;]*?[}\\]]\\s*=(?![=>])`, // const { env } = o
    `[{\\[][^;{}\\[\\]]*?${id}[^;{}\\[\\]]*?[}\\]]\\s*=(?![=>])`, // ({ env } = o)
    `\\bfunction\\b[^(]*\\([^()]*${id}`,
    `\\([^()]*${id}[^()]*\\)\\s*=>`,
    `${id}\\s*=>`,
    `(?<![\\w$.])(?!(?:if|while|switch|for|with)\\b)[\\w$]+\\s*\\([^()]*${id}[^()]*\\)\\s*\\{`, // method shorthand
    `\\bcatch\\s*\\([^()]*${id}`,
    `${id}(?:\\s*(?:\\.\\s*[\\w$]+|\\[[^\\]]*\\]))+\\s*(?:\\*\\*|<<|>>>?|&&|\\|\\||\\?\\?|[-+*/%&|^])?=(?![=>])`, // name.X = / name[k] ||=
    `${id}\\s*(?:\\*\\*|<<|>>>?|&&|\\|\\||\\?\\?|[-+*/%&|^])=(?!=)`,
    `\\bdelete\\s+${id}`,
    `\\b(?:Object\\s*\\.\\s*(?:assign|defineProperty|defineProperties|setPrototypeOf)|Reflect\\s*\\.\\s*(?:set|defineProperty|deleteProperty|setPrototypeOf))\\s*\\(\\s*${id}`,
  ];
  return !anywhere.some((src) => new RegExp(src).test(fileText));
}

function isAllowlistEnv(expr, fileText) {
  let body = expr.trim();
  if (/^[A-Za-z_$][\w$]*$/.test(body)) {
    if (!isBoundOnceAndNeverWritten(body, fileText)) return false;
    const init = declInit(body, fileText);
    if (init === null) return false;
    body = init.trim();
  }
  if (!body.startsWith('{')) return false;
  if (!/\bGIT_CONFIG_NOSYSTEM\s*:\s*['"]1['"]/.test(body)) return false;
  for (const m of body.matchAll(/\bprocess\s*\.\s*env\b/g)) {
    if (!/^\s*(?:\[|\.\s*[A-Za-z_$])/.test(body.slice(m.index + m[0].length))) return false;
  }
  let scanned = body;
  for (const decl of fileText.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\[/g)) {
    if (new RegExp(`(?<![\\w$])${escapeRegExp(decl[1])}(?![\\w$])`).test(body)) scanned += ' ' + readExpr(fileText, decl.index + decl[0].length - 1, true);
  }
  for (const g of scanned.matchAll(/\bGIT_[A-Z0-9_]+/gi)) {
    if (!SAFE_GIT_KEYS.has(g[0].toUpperCase())) return false;
  }
  return true;
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
      if (!envKey && SHORTHAND_ENV_RE.test(callText) && isAllowlistEnv('env', text)) { safe++; continue; }
      if (!envKey) {
        findings.push(SHORTHAND_ENV_RE.test(callText)
          ? `${rel}:${line} ${m[1]}('git', ...) shorthand env is neither an allowlist env (named keys, GIT_CONFIG_NOSYSTEM=1, no GIT_* beyond the safe three) nor resolvable here -- route it through gitEnv() (CWK-133/C-4)`
          : `${rel}:${line} ${m[1]}('git', ...) carries no 'env:' -- must route through gitEnv() (CWK-133/C-4)`);
        continue;
      }
      const envExpr = readExpr(callText, envKey.index + envKey[0].length);
      if (isAllowlistEnv(envExpr, text)) { safe++; continue; }
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
