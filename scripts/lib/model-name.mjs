// The one definition of a model name CoalTipple will carry. A `modelTiers` pin arrives in a config file, and a project config arrives with a
// CLONED repository, so a pin is attacker-writable text. The ranking built from it is persisted globally and its names are later put on a
// `claude --model <name>` line by the agent, so a name that holds shell text must never get that far. The rule is an allowlist of characters
// (coding-style.md, Input Validation: allowlist over denylist; reject, never sanitize): letters, digits, dot, underscore, colon, at,
// slash, square brackets and hyphen, the first character a letter or digit. That covers every id the platform and the cloud hosts use
// (`haiku`, `claude-sonnet-5-5`, `claude-opus-5-5[1m]`, `us.anthropic.claude-opus-5-5`) and nothing a shell reads as syntax.
// Node built-ins only; imports nothing, so config-schema.mjs and classify.mjs can both depend on it.

export const MODEL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/[\]-]*$/;

export function isSafeModelName(name) {
  return typeof name === 'string' && MODEL_NAME_RE.test(name);
}

// A value that may quote a hostile file, made safe to print in a message: JSON-quoted, every control character, C1 control, U+2028 and
// U+2029 written out as a visible \uXXXX escape (JSON.stringify leaves C1 and U+2028 raw), cut at 64 characters. The backslash is built
// from its code so an escape here cannot be rewritten in transit.
const BS = String.fromCharCode(92);
export function showName(v) {
  const q = JSON.stringify(typeof v === 'string' ? v : String(v));
  const flat = Array.from(q, (ch) => {
    const n = ch.codePointAt(0);
    if (n === 10) return BS + 'n';
    if (n === 13) return BS + 'r';
    if ((n < 0x20 && n !== 9) || (n >= 0x7f && n <= 0x9f) || n === 0x2028 || n === 0x2029) return BS + 'u' + n.toString(16).padStart(4, '0');
    return ch;
  });
  return flat.length > 64 ? flat.slice(0, 64).join('') + '...' : flat.join('');
}
