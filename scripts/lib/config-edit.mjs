// Edit one top-level property of a JSONC config text in place (used by scripts/configure.mjs).
//
// The key is found by READING the text as a JSONC document, left to right, once: strings are skipped whole, line and block comments
// are skipped, and only the properties of the root object (depth 1) are recorded, each with the start and end of its value. So the
// search never reads a nested key, a line inside a comment or a key inside a string, it matches a key written on the same line as the
// opening brace, and its work is linear in the text however much white space, however many comments and however deep the nesting.
// JSON.parse keeps the LAST of several top-level properties with one name, so the property edited is the last one: editing an earlier
// copy would change nothing the reader sees. Only the value text is replaced; the indentation, the key, the comma that follows and a
// trailing comment stay as they are.
//
// An optional counter, `{ steps }`, receives one step per character visit; scripts/lib/config-edit.test.mjs asserts the work by that
// count instead of reading a clock.
import { isDeepStrictEqual } from 'node:util';
import { stripJsonc } from './jsonc.mjs';

const isLineBreak = (c) => c === '\n' || c === '\r' || c === String.fromCharCode(0x2028) || c === String.fromCharCode(0x2029);

// The properties of the root object, in order: [{ key, start, end }], the value being text.slice(start, end).
// A text that is not an object, or that stops making sense, yields the properties read so far (the caller validates the parse).
export function findTopLevelProps(text, counter) {
  const n = text.length;
  let steps = 0;
  // The index of the next character that is not white space or inside a comment (n when there is none).
  const trivia = (from) => {
    let p = from;
    for (;;) {
      steps++;
      const c = text[p];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { p++; continue; }
      if (c === '/' && text[p + 1] === '/') {
        p += 2;
        while (p < n && !isLineBreak(text[p])) { p++; steps++; }
        continue;
      }
      if (c === '/' && text[p + 1] === '*') {
        p += 2;
        while (p < n && !(text[p] === '*' && text[p + 1] === '/')) { p++; steps++; }
        p = Math.min(n, p + 2);
        continue;
      }
      return p;
    }
  };
  // The index after the closing quote of the string that opens at `from` (n when it never closes).
  const stringEnd = (from) => {
    let p = from + 1;
    while (p < n) {
      steps++;
      const c = text[p];
      if (c === '\\') p += 2;
      else if (c === '"') return p + 1;
      else p++;
    }
    return n;
  };
  // The index after the value that starts at `from`.
  const valueEnd = (from) => {
    let p = from;
    const c = text[p];
    if (c === '"') return stringEnd(p);
    if (c === '{' || c === '[') {
      let depth = 0;
      while (p < n) {
        steps++;
        const d = text[p];
        if (d === '"') { p = stringEnd(p); continue; }
        if (d === '/' && (text[p + 1] === '/' || text[p + 1] === '*')) { p = trivia(p); continue; }
        if (d === '{' || d === '[') depth++;
        else if (d === '}' || d === ']') { depth--; if (depth === 0) return p + 1; }
        p++;
      }
      return n;
    }
    // a number, true, false or null: it runs to the next separator
    while (p < n) {
      steps++;
      const d = text[p];
      if (d === ',' || d === '}' || d === ']' || d === ' ' || d === '\t' || d === '\n' || d === '\r' || d === '/') break;
      p++;
    }
    return p;
  };

  const props = [];
  let i = trivia(text.charCodeAt(0) === 0xFEFF ? 1 : 0);
  if (text[i] === '{') {
    i++;
    for (;;) {
      i = trivia(i);
      if (i >= n || text[i] === '}') break;
      if (text[i] === ',') { i++; continue; }
      if (text[i] !== '"') break; // not a property key: the text is malformed, stop reading
      const keyStart = i;
      i = stringEnd(i);
      let key;
      try { key = JSON.parse(text.slice(keyStart, i)); } catch { break; }
      i = trivia(i);
      if (text[i] !== ':') break;
      i = trivia(i + 1);
      if (i >= n) break;
      const end = valueEnd(i);
      props.push({ key, start: i, end });
      i = end;
    }
  }
  if (counter) counter.steps += steps;
  return props;
}

// Throws unless the JSONC `text` parses and the value JSON.parse keeps for `key` equals the requested `jsonValue`.
export function assertEffective(text, key, jsonValue) {
  const body = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  const parsed = JSON.parse(stripJsonc(body)); // throws if the text is not JSON once the comments are gone
  const requested = JSON.parse(jsonValue);
  if (!parsed || typeof parsed !== 'object' || !Object.prototype.hasOwnProperty.call(parsed, key) || !isDeepStrictEqual(parsed[key], requested)) {
    throw new Error(`the edit to "${key}" did not take effect: the value in force after it is ${JSON.stringify(parsed && parsed[key])}, not the requested ${jsonValue}`);
  }
}

// Rewrite the effective top-level `key` of the JSONC text to `jsonValue` (already JSON text). Returns the new text, or null when the
// root object has no such property (the caller appends it). Throws when the edited text does not parse, or when the value that wins
// after the edit is not the value requested, so a write that would leave the old setting in force never reaches the disk.
export function setKeyInText(text, key, jsonValue, counter) {
  let hit = null;
  for (const prop of findTopLevelProps(text, counter)) if (prop.key === key) hit = prop; // the last one is the one JSON.parse keeps
  if (hit === null) return null;
  const result = text.slice(0, hit.start) + jsonValue + text.slice(hit.end);
  assertEffective(result, key, jsonValue);
  return result;
}
