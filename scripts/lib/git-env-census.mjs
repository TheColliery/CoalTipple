// CWK-133/C-4 findings-back (INSPECT HIGH-1) -- a cheap TEXTUAL census: does every
// spawnSync('git'.../execFileSync('git'... call under scripts/ carry an explicit `env:`
// in the same call? This does NOT verify the env is SAFE (that is gitEnv()'s own job,
// proven by git-env.test.mjs) -- it only proves nothing NEW can land a bare git spawn
// that silently inherits process.env, the exact shape the reviewer found unguarded in
// four sites this room's own gates never caught before this check existed.
//
// censusGitSpawns() is pure (a fixture map in, a findings array out) so it is unit-
// tested directly, red-first, without a repo clone; collectScriptsMjs() is the real
// filesystem walk, kept separate so the pure function never touches disk.
import fs from 'node:fs';
import path from 'node:path';

const CALL_RE = /(spawnSync|execFileSync)\(\s*['"]git['"]/g;

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

export function censusGitSpawns(files) {
  const findings = [];
  for (const { rel, text } of files) {
    CALL_RE.lastIndex = 0;
    let m;
    while ((m = CALL_RE.exec(text))) {
      if (isInLineComment(text, m.index)) continue;
      const openIdx = text.indexOf('(', m.index);
      const closeIdx = findMatchingClose(text, openIdx);
      if (closeIdx === -1) {
        const line = text.slice(0, m.index).split('\n').length;
        findings.push(`${rel}:${line} unbalanced parens scanning a ${m[1]}('git', ...) call -- census cannot verify it`);
        continue;
      }
      const callText = text.slice(openIdx, closeIdx + 1);
      if (!/\benv\s*:/.test(callText)) {
        const line = text.slice(0, m.index).split('\n').length;
        findings.push(`${rel}:${line} ${m[1]}('git', ...) carries no 'env:' -- must route through gitEnv() (CWK-133/C-4)`);
      }
    }
  }
  return findings;
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
