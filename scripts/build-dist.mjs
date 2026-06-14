#!/usr/bin/env node
// CoalTipple dist build — assemble a CLEAN `plugin/` from source so the Claude Code
// marketplace serves ONLY the plugin (skills + hooks + commands + manifest), never the
// repo's scripts/, platform-configs/ (other-agent install templates), .github/, or docs.
// Mirrors CoalMine's plugin/ dist; the marketplace.json `source` points at ./plugin.
// Run after editing skills/hooks/commands/plugin.json — `verify.mjs` FAILs on drift.
// Node built-ins only.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(repo, 'plugin');

// EXACTLY what a Claude Code plugin loads — nothing the marketplace clone carries that a
// CC user does not need. Each entry is a repo-relative path copied verbatim into plugin/.
// Note: only `.claude-plugin/plugin.json` (the manifest), NOT marketplace.json (that stays
// at the repo root and points here).
export const DIST_ITEMS = [
  path.join('.claude-plugin', 'plugin.json'),
  'skills',
  'hooks',
  'commands',
];

export function buildDist() {
  fs.rmSync(dist, { recursive: true, force: true });
  for (const rel of DIST_ITEMS) {
    const src = path.join(repo, rel);
    const dst = path.join(dist, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.cpSync(src, dst, { recursive: true }); // recursive always (a flat copy EISDIRs a dir)
  }
}

// Every source file under DIST_ITEMS must exist in plugin/ AND match byte-for-byte, and
// plugin/ must hold nothing without a source (orphan). Returns [] when in sync.
export function checkDist() {
  const out = [];
  const filesUnder = (root, rel) => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return [];
    if (fs.statSync(abs).isDirectory()) return fs.readdirSync(abs).flatMap((n) => filesUnder(root, path.join(rel, n)));
    return [rel];
  };
  for (const item of DIST_ITEMS) {
    for (const rel of filesUnder(repo, item)) {
      const d = path.join(dist, rel);
      if (!fs.existsSync(d)) out.push(`missing in plugin/: ${rel}`);
      else if (fs.readFileSync(path.join(repo, rel)).compare(fs.readFileSync(d)) !== 0) out.push(`stale in plugin/: ${rel}`);
    }
    for (const rel of filesUnder(dist, item)) {
      if (!fs.existsSync(path.join(repo, rel))) out.push(`orphan in plugin/ (no source): ${rel}`);
    }
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--check')) {
    const f = checkDist();
    if (f.length) { console.error('plugin/ dist OUT OF SYNC:\n' + f.map((x) => '  ' + x).join('\n') + '\n-> run: node scripts/build-dist.mjs'); process.exit(1); }
    console.log('plugin/ dist in sync with source.');
  } else {
    buildDist();
    console.log('plugin/ dist built (skills + hooks + commands + plugin.json) from source.');
  }
}
