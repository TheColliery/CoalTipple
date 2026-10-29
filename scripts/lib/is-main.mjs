// Is this module the entry file of the running process? Node gives import.meta.url as the REAL (link-resolved) path of the entry
// file, while process.argv[1] keeps the spelling the process was started with. Compared as strings they differ whenever the checkout is
// reached through a symlink or a junction, and a script that runs "only when invoked directly" then does nothing and exits 0. Both sides
// go through fs.realpathSync.native (node/runtime.md section 4: .native also expands a Windows 8.3 short name). Anything unresolvable is
// not the entry file. scripts/lib/is-main.test.mjs starts each CLI through a directory link.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export function isMainModule(metaUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try { return fs.realpathSync.native(argv1) === fs.realpathSync.native(fileURLToPath(metaUrl)); } catch { return false; }
}
