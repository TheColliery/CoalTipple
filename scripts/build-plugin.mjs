#!/usr/bin/env node
// CoalTipple build — sync the standalone conductor hook's shared regions from
// their source of truth, so the portable hook can never drift from the libs.
// Today: the hot-keyword lists (from keywords.mjs). Run after editing keywords.mjs;
// verify.mjs FAILs if a region is out of sync. Node built-ins only.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fmtArray = (arr) => `[${arr.map((s) => `'${s}'`).join(', ')}]`;

// Body that belongs BETWEEN the hot-keywords markers (no marker lines).
export async function genHotKeywords() {
  const kw = await import(pathToFileURL(path.join(repo, 'scripts', 'lib', 'keywords.mjs')).href);
  return `const HOT5 = ${fmtArray(kw.HOT5)};\nconst HOT4 = ${fmtArray(kw.HOT4)};`;
}

export const REGIONS = [
  {
    file: path.join(repo, 'hooks', 'coaltipple-conductor.js'),
    open: '// <coaltipple-shared: hot-keywords>',
    close: '// </coaltipple-shared: hot-keywords>',
    gen: genHotKeywords,
  },
];

// Replace the text between (and excluding) the marker lines with `body`.
export function spliceRegion(src, open, close, body) {
  const oi = src.indexOf(open);
  const ci = src.indexOf(close);
  if (oi === -1 || ci === -1 || ci < oi) throw new Error(`markers not found / out of order: ${open}`);
  const afterOpen = src.indexOf('\n', oi) + 1;
  return src.slice(0, afterOpen) + body + '\n' + src.slice(ci);
}

async function main() {
  let changed = 0;
  for (const r of REGIONS) {
    const src = fs.readFileSync(r.file, 'utf8');
    const next = spliceRegion(src, r.open, r.close, await r.gen());
    if (next !== src) { fs.writeFileSync(r.file, next, 'utf8'); console.log(`  synced ${path.relative(repo, r.file)}`); changed++; }
    else console.log(`  ok   ${path.relative(repo, r.file)} already in sync`);
  }
  console.log(`\nDone: ${changed} region(s) synced.`);
}

// Run only when executed directly — verify.mjs imports genHotKeywords without firing main().
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`build failed: ${e.message}`); process.exit(1); });
}
