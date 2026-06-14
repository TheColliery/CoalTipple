// CoalTipple install targets — the single source of truth for the agent ->
// skills-dir map. Shared by install.mjs and verify.mjs so the two can never
// drift. Same skill-dir conventions as CoalMine (source-grounded Jun 2026).
// CoalTipple is for subagent-capable platforms; on a platform without sub-agents
// the skill self-degrades to a no-op (it never breaks), so installing broadly is
// safe — the routing simply stays off where it cannot run.
// Node built-ins only.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const TARGETS = {
  claude:      path.join(os.homedir(), '.claude', 'skills'),
  antigravity: path.join(process.cwd(), '.agents', 'skills'),
  copilot:     path.join(process.cwd(), '.github', 'skills'),
  codex:       path.join(process.cwd(), '.agents', 'skills'),
  cursor:      path.join(process.cwd(), '.cursor', 'skills'),
  windsurf:    path.join(process.cwd(), '.windsurf', 'skills'),
  cline:       path.join(process.cwd(), '.claude', 'skills'),
  amp:         path.join(process.cwd(), '.agents', 'skills'),
  goose:       path.join(process.cwd(), '.agents', 'skills'),
  gemini:      path.join(process.cwd(), '.gemini', 'skills'),
};

// Agents NOT auto-detected by `install.mjs all` (their dir is ambiguous with a
// global/plugin install): claude (~/.claude global) and cline (project .claude,
// also read by Claude Code itself). Both stay installable explicitly by name.
export const ALL_EXCLUDE = new Set(['claude', 'cline']);

const IMPORT_CWD = process.cwd();

// Presence detection for `install.mjs all`: an agent is present when its config
// home (the parent of its skills dir) already exists under `cwd`. Re-roots each
// project target onto the passed cwd so the logic stays unit-testable. Home/global
// targets and ALL_EXCLUDE agents are never auto-detected. Deterministic.
export function detectPresentAgents(cwd = process.cwd()) {
  const present = [];
  const absent = [];
  for (const k of Object.keys(TARGETS)) {
    if (ALL_EXCLUDE.has(k)) continue;
    const rel = path.relative(IMPORT_CWD, TARGETS[k]);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue; // not a project target
    const marker = path.dirname(path.join(cwd, rel)); // <cwd>/.cursor, <cwd>/.agents, ...
    (fs.existsSync(marker) ? present : absent).push(k);
  }
  return { present, absent };
}
