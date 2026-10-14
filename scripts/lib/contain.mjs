// Realpath containment for the project's own state folder (hooks-safety.md section 10 as amended 2026-10-04; node/runtime.md sections 4-5).
//
// A project's tool-owned paths (<root>/<agent-dir>/coal/coaltipple.json, the legacy config files, <root>/.claude/.coaltipple/...) arrive with a
// CLONED repo, so any component between the project root and the file can be a link (a junction on Windows, a symlink on POSIX) to a place OUTSIDE
// the project: a read then returns a stranger's bytes, a write creates, overwrites, renames or deletes a file the project never owned.
//
// containedPath(root, target) -> the PHYSICAL path of `target` iff no link on the way from `root` to `target` redirects it, else null.
//   - BOTH sides go through fs.realpathSync.native: the root (a user's own checkout may sit behind a link, e.g. macOS /var -> /private/var, so the root is
//     only normalised) and the candidate. `.native` expands a Windows 8.3 alias that the plain form leaves alone.
//   - The EXPECTED location is not canonicalised from the candidate: it is the resolved root joined with the candidate's own literal path under the root,
//     and the candidate's physical path must EQUAL it. That is stricter than "inside the project root" (a link to another folder inside the project is
//     refused) and it is exactly "inside the folder itself": an allowlist pins the literal expected place and only the untrusted candidate is resolved
//     (node/runtime.md section 4, the ownership-not-identity rule).
//   - A path that does not exist yet (a write creating it) resolves through its deepest existing ancestor with the missing tail re-attached; a component
//     that cannot be resolved but still EXISTS (a dangling or looping link, which a write would follow and create the target of) fails closed.
//   - Anything unresolvable, or a target not strictly under the root, is null: a refused read returns nothing, a refused write writes nothing.
// Pure, zero-dependency, synchronous. The conductor (hooks/coaltipple-conductor.js) carries a verbatim inlined copy of `physical` and `containedPath`
// (Phoenix #9: the hook cannot import); verify.mjs fails if the two bodies drift.
import fs from 'node:fs';
import path from 'node:path';

// <contain-shared: physical+containedPath> -- the conductor inlines this block verbatim; edit it here, then mirror it there
function physical(p) {
  let cur = path.resolve(p);
  const tail = [];
  for (;;) {
    try {
      const real = fs.realpathSync.native(cur);
      return tail.length ? path.join(real, ...tail.reverse()) : real;
    } catch (e) {
      if (e.code === 'EACCES' || e.code === 'EPERM') { // realpath could not open the entry (an ACL that denies read): a plain entry still resolves as its parent + its own name, a link does not
        try { if (fs.lstatSync(cur).isSymbolicLink()) return null; } catch { return null; }
      } else {
        if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') return null; // ELOOP, ...: fail closed
        try { fs.lstatSync(cur); return null; } catch (e2) { if (e2.code !== 'ENOENT') return null; } // it exists but did not resolve: a dangling link
      }
    }
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    tail.push(path.basename(cur));
    cur = parent;
  }
}
function containedPath(projectRoot, target) {
  const lexRoot = path.resolve(projectRoot);
  const rel = path.relative(lexRoot, path.resolve(target));
  if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return null;
  const realRoot = physical(lexRoot);
  if (realRoot === null) return null;
  const actual = physical(target);
  return actual !== null && actual === path.join(realRoot, rel) ? actual : null;
}
// </contain-shared: physical+containedPath>

export { physical, containedPath };
