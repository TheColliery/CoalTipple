// The env a hook or CLI test spawns with (hooks-safety.md section 7): HOME, USERPROFILE, TEMP, TMP and TMPDIR all point at the test's
// own throwaway directory, and every variable the host exports to a hook (CLAUDE_CONFIG_DIR, CLAUDE_PROJECT_DIR, CLAUDE_PLUGIN_ROOT,
// CLAUDE_PLUGIN_DATA) is dropped, so nothing from the real session or the real machine can reach the child. `extra` overrides last
// (a test that needs a CLAUDE_CONFIG_DIR of its own passes it there).
export function sandboxEnv(dir, extra = {}) {
  const env = { ...process.env };
  for (const k of ['CLAUDE_CONFIG_DIR', 'CLAUDE_PROJECT_DIR', 'CLAUDE_PLUGIN_ROOT', 'CLAUDE_PLUGIN_DATA', 'NODE_TEST_CONTEXT']) delete env[k];
  return { ...env, HOME: dir, USERPROFILE: dir, TEMP: dir, TMP: dir, TMPDIR: dir, ...extra };
}

// True when `out` names the path `p` as a whole path: the character before a match is not a path character, so a longer path that merely ENDS with `p`
// (macOS: /private/var/x ends with /var/x) does not count. `includes()` alone cannot tell the two apart (T-29li-1, T-29lv-1). Tests take their folders by
// fs.realpathSync.native, so the printed and the expected spelling are one.
export function namesPath(out, p) {
  for (let i = out.indexOf(p); i !== -1; i = out.indexOf(p, i + 1)) {
    if (i === 0 || !/[A-Za-z0-9_.~/\\-]/.test(out[i - 1])) return true;
  }
  return false;
}
