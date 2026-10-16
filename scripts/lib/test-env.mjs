// The env a hook or CLI test spawns with (hooks-safety.md section 7): HOME, USERPROFILE, TEMP, TMP and TMPDIR all point at the test's
// own throwaway directory, and every variable the host exports to a hook (CLAUDE_CONFIG_DIR, CLAUDE_PROJECT_DIR, CLAUDE_PLUGIN_ROOT,
// CLAUDE_PLUGIN_DATA) is dropped, so nothing from the real session or the real machine can reach the child. `extra` overrides last
// (a test that needs a CLAUDE_CONFIG_DIR of its own passes it there).
export function sandboxEnv(dir, extra = {}) {
  const env = { ...process.env };
  for (const k of ['CLAUDE_CONFIG_DIR', 'CLAUDE_PROJECT_DIR', 'CLAUDE_PLUGIN_ROOT', 'CLAUDE_PLUGIN_DATA', 'NODE_TEST_CONTEXT']) delete env[k];
  return { ...env, HOME: dir, USERPROFILE: dir, TEMP: dir, TMP: dir, TMPDIR: dir, ...extra };
}
