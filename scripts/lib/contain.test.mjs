// 14a: unit tests for the realpath-containment helper (scripts/lib/contain.mjs) and its use by the config cascade (config-load.mjs). The end-to-end planted-link
// witnesses (the real conductor / install.mjs / configure.mjs against a link) are in project-links.test.mjs; these pin the helper's own contract so a
// loosened or one-sided comparison fails HERE, by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { containedPath, physical } from './contain.mjs';
import { resolveProjectConfig, projectConfigPath, projectConfigCandidates, containedProjectPath } from './config-load.mjs';

const WIN = process.platform === 'win32';
function sandbox(t) {
  const base = fs.realpathSync.native(os.tmpdir());
  const root = fs.mkdtempSync(path.join(base, 'ct-contain-'));
  const sb = { root, proj: path.join(root, 'proj'), out: path.join(root, 'outside'), links: [] };
  for (const d of [sb.proj, sb.out, path.join(sb.proj, '.git')]) fs.mkdirSync(d, { recursive: true });
  t.after(() => {
    for (const l of sb.links) { try { fs.unlinkSync(l); } catch { try { fs.rmdirSync(l); } catch { /* removed with the root */ } } }
    const real = fs.realpathSync.native(root);
    if (real.startsWith(base + path.sep) && path.basename(real).startsWith('ct-contain-')) fs.rmSync(real, { recursive: true, force: true });
  });
  return sb;
}
function dirLink(t, sb, target, at) {
  try { fs.mkdirSync(path.dirname(at), { recursive: true }); fs.symlinkSync(target, at, WIN ? 'junction' : 'dir'); sb.links.push(at); return true; }
  catch (e) { t.skip(`dir link not creatable here (${e.code}) -- capability-gated`); return false; }
}
const cfgOf = (proj) => path.join(proj, '.claude', 'coal', 'coaltipple.json');

test('containedPath: a plain path that does not exist yet resolves to itself (a write creating it)', (t) => {
  const sb = sandbox(t);
  assert.equal(containedPath(sb.proj, cfgOf(sb.proj)), cfgOf(sb.proj));
});
test('containedPath: an existing real file resolves to itself', (t) => {
  const sb = sandbox(t);
  fs.mkdirSync(path.dirname(cfgOf(sb.proj)), { recursive: true });
  fs.writeFileSync(cfgOf(sb.proj), '{}');
  assert.equal(containedPath(sb.proj, cfgOf(sb.proj)), cfgOf(sb.proj));
});
test('containedPath: the root itself, a path outside the root and a ".." escape are refused', (t) => {
  const sb = sandbox(t);
  assert.equal(containedPath(sb.proj, sb.proj), null, 'the root is not a target under the root');
  assert.equal(containedPath(sb.proj, path.join(sb.out, 'x.json')), null, 'a sibling folder is outside');
  assert.equal(containedPath(sb.proj, path.join(sb.proj, '..', 'outside', 'x.json')), null, 'a ".." path that leaves the root is outside');
});
test('containedPath: a link at a middle folder is refused, whether its target exists, is inside the project, or is gone', (t) => {
  const sb = sandbox(t);
  // 1. the target is a folder outside the project
  if (!dirLink(t, sb, sb.out, path.join(sb.proj, '.claude'))) return;
  assert.equal(containedPath(sb.proj, cfgOf(sb.proj)), null, 'a link out of the project');
});
test('containedPath: a link to a folder INSIDE the project (but not the folder itself) is refused: the check is inside-the-folder, not inside-the-project', (t) => {
  const sb = sandbox(t);
  fs.mkdirSync(path.join(sb.proj, 'elsewhere'));
  if (!dirLink(t, sb, path.join(sb.proj, 'elsewhere'), path.join(sb.proj, '.claude'))) return;
  assert.equal(containedPath(sb.proj, cfgOf(sb.proj)), null);
});
test('containedPath: a DANGLING dir link (its target is gone) is refused, not walked past to a "missing" tail a write would create through it', (t) => {
  const sb = sandbox(t);
  if (!dirLink(t, sb, path.join(sb.out, 'not-created-yet'), path.join(sb.proj, '.claude'))) return;
  assert.equal(containedPath(sb.proj, cfgOf(sb.proj)), null);
  assert.equal(fs.existsSync(path.join(sb.out, 'not-created-yet')), false, 'the check itself creates nothing');
});
test('containedPath: a project reached THROUGH a link (the user\'s own checkout behind an alias) is accepted: the root is only normalised, never refused', (t) => {
  const sb = sandbox(t);
  const alias = path.join(sb.root, 'alias');
  if (!dirLink(t, sb, sb.proj, alias)) return;
  const viaAlias = containedPath(alias, cfgOf(alias));
  assert.equal(viaAlias, cfgOf(sb.proj), 'both sides resolved: the physical path under the real root');
});
test('physical: resolves through the deepest existing ancestor and re-attaches the missing tail', (t) => {
  const sb = sandbox(t);
  assert.equal(physical(path.join(sb.proj, 'a', 'b', 'c.json')), path.join(sb.proj, 'a', 'b', 'c.json'));
});

// ---- the config cascade's use of it ----
test('resolveProjectConfig: a refused candidate is skipped as ABSENT and the walk moves on to the next real one; the refusal is reported', (t) => {
  const sb = sandbox(t);
  fs.mkdirSync(path.join(sb.out, 'x'));
  fs.writeFileSync(path.join(sb.out, 'coaltipple.json'), '{"mode":"off"}');
  if (!dirLink(t, sb, sb.out, path.join(sb.proj, '.claude', 'coal'))) return;
  const agents = path.join(sb.proj, '.agents', 'coal', 'coaltipple.json');
  fs.mkdirSync(path.dirname(agents), { recursive: true });
  fs.writeFileSync(agents, '{"qualityBar":61}');
  const r = resolveProjectConfig(sb.proj);
  assert.equal(r.path, agents, 'the .agents candidate is the first READABLE one');
  assert.deepEqual(r.refused, [projectConfigCandidates(sb.proj)[0]], 'the linked .claude candidate is named as refused');
});
test('projectConfigPath: null (no safe path to hand back) when nothing is readable and the own-dir default itself is behind a link', (t) => {
  const sb = sandbox(t);
  if (!dirLink(t, sb, sb.out, path.join(sb.proj, '.claude', 'coal'))) return;
  assert.equal(projectConfigPath(sb.proj), null);
});
test('projectConfigPath: unchanged for a plain project (the lexical own-dir path when nothing exists, the found candidate otherwise)', (t) => {
  const sb = sandbox(t);
  assert.equal(projectConfigPath(sb.proj), cfgOf(sb.proj));
  fs.mkdirSync(path.dirname(cfgOf(sb.proj)), { recursive: true });
  fs.writeFileSync(cfgOf(sb.proj), '{}');
  assert.equal(projectConfigPath(sb.proj), cfgOf(sb.proj));
});
test('containedProjectPath: resolves the git root from a subdirectory cwd, then applies the same check', (t) => {
  const sb = sandbox(t);
  const sub = path.join(sb.proj, 'src', 'deep');
  fs.mkdirSync(sub, { recursive: true });
  assert.equal(containedProjectPath(sub, cfgOf(sb.proj)), cfgOf(sb.proj));
  assert.equal(containedProjectPath(sub, path.join(sb.out, 'x.json')), null);
});
