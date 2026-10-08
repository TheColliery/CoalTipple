// The witness list as DATA (08d): U/scratchpad/dispatch/08d-census-witness-list.md, F1-F42 (a git spawn whose env
// must be a finding), R1-R2 (a spawn the census must COUNT and refuse), P1-P6 (an env the census must pass with
// no pin). One entry per vector; `texts` are whole fixture files, so a vector that declares `const env` carries BOTH
// call forms (the shorthand `{ env }` and `env: env`, where CoalTipple's first allowlist rule failed). Every fixture is
// a string or a template literal here, so the real census (a token census) reads none of it as a spawn.
// Used by git-env-census.test.mjs, and by the before/after table of the 08d return.
const BT = String.fromCharCode(96);
const SHORT = "spawnSync('git', ['status'], { env });";
const KEYED = "spawnSync('git', ['status'], { env: env });";
const INLINE = (expr) => `spawnSync('git', ['status'], { env: ${expr} });`;
// A const env declaration, judged through both call forms.
const both = (decl) => [`${decl}\n${SHORT}\n`, `${decl}\n${KEYED}\n`];
const PICK = "Object.fromEntries(keep.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]))";
const KEEP = "const keep = ['PATH', 'HOME'];";
const ALLOW = "const env = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1' };";
const NOSYS = "GIT_CONFIG_NOSYSTEM: '1'";
const PICKENV = (tail) => `${KEEP}\nconst env = { ...${PICK}, ${tail} };`;

export const VECTORS = [
  // whole-object copies, one or more hops away
  { id: 'F1', expect: 'fail', texts: [...both(`const base = { ...process.env };\nconst env = { ...base, ${NOSYS} };`), ...both(`const extra = process.env;\nconst env = { ...extra, ${NOSYS} };`), ...both(`const e = process.env;\nconst env = { ...Object.fromEntries(Object.entries(e)), ${NOSYS} };`)] },
  { id: 'F2', expect: 'fail', texts: both(`const env = { ...Object.fromEntries(Object.entries(process.env)), ${NOSYS} };`) },
  { id: 'F3', expect: 'fail', texts: both(`const env = { ...Object.fromEntries(Object.entries(process.env).filter(() => true)), ${NOSYS} };`) },
  { id: 'F4', expect: 'fail', texts: both(`const env = { ...process['env'], ${NOSYS} };`) },
  { id: 'F5', expect: 'fail', texts: both(`import { env as penv } from 'node:process';\nconst env = { ...penv, ${NOSYS} };`) },
  { id: 'F6', expect: 'fail', texts: [INLINE(`{ ...gitEnv(d), ...process.env }`), ...both('const env = { ...gitEnv(d), ...process.env };')] },
  { id: 'F7', expect: 'fail', texts: both('const base = { ...process.env };\nconst env = { ...gitEnv(d), ...base };') },
  { id: 'F8', expect: 'fail', texts: [INLINE(`{ ${NOSYS}, extra: { ...process.env } }`), ...both(`const env = { ${NOSYS}, extra: { ...process.env } };`)] },
  { id: 'F9', expect: 'fail', texts: both(`const keep = ['PATH'];\nconst env = { ...Object.fromEntries(keep.filter(Boolean).map((k) => [k, process.env[k]]).concat(Object.entries(process.env))), ${NOSYS} };`) },
  { id: 'F10', expect: 'fail', texts: both(`const keep = ['PATH'];\nconst env = { ...Object.fromEntries(keep.filter(Boolean).flatMap(() => Object.entries(process.env))), ${NOSYS} };`) },
  { id: 'F11', expect: 'fail', texts: [INLINE(`{ ${NOSYS}, all: process.env }`), ...both(`const env = { ${NOSYS}, all: process.env };`)] },
  // helpers and aliases
  { id: 'F12', expect: 'fail', texts: both(`function all() { return process.env; }\nconst env = { ...Object.fromEntries(Object.entries(all())), ${NOSYS} };`) },
  { id: 'F13', expect: 'fail', texts: [`function mk(x) { if (x) return { PATH: process.env.PATH, ${NOSYS} }; return process.env; }\n${INLINE('mk(d)')}\n`, ...both('function mk(x) { if (x) return { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: \'1\' }; return process.env; }\nconst env = mk(d);')] },
  { id: 'F14', expect: 'fail', texts: [`${INLINE('sandboxEnv(cwd)')}\n`, `import { sandboxEnv } from './sandbox.mjs';\n${INLINE('sandboxEnv(cwd)')}\n`, ...both('const env = sandboxEnv(cwd);')] },
  // mutation after declaration
  { id: 'F15', expect: 'fail', texts: both(`${PICKENV(NOSYS)}\nObject.assign(env, process.env);`) },
  { id: 'F16', expect: 'fail', texts: both(`const env = { ${NOSYS} };\nfor (const k of Object.keys(process.env)) env[k] = process.env[k];`) },
  { id: 'F17', expect: 'fail', texts: both(`${PICKENV(NOSYS)}\nenv.GIT_DIR = '/elsewhere/.git';`) },
  { id: 'F18', expect: 'fail', texts: both(`const keep = ['PATH'];\nkeep.push('GIT_DIR');\nconst env = { ...${PICK}, ${NOSYS} };`) },
  // the GIT_ names and the NOSYSTEM literal
  { id: 'F19', expect: 'fail', texts: both(`const keep = ['PATH', 'GIT_DIR'];\nconst env = { ...${PICK}, ${NOSYS} };`) },
  { id: 'F20', expect: 'fail', texts: both(`const k2 = ['GIT_DIR'];\nconst keep = ['PATH', ...k2];\nconst env = { ...${PICK}, ${NOSYS} };`) },
  { id: 'F21', expect: 'fail', texts: both(`const keep = ['PATH', 'GIT_' + 'DIR'];\nconst env = { ...${PICK}, ${NOSYS} };`) },
  { id: 'F22', expect: 'fail', texts: both(`const env = { ${NOSYS}, ['GIT' + '_DIR']: process.env['GIT' + '_DIR'] };`) },
  { id: 'F23', expect: 'fail', texts: both(`${KEEP}\nconst env = { ...${PICK}, GIT_CONFIG_NOSYSTEM: '0' };`) },
  { id: 'F24', expect: 'fail', texts: both(`${KEEP}\nconst env = { ...${PICK}, ${NOSYS}, GIT_CONFIG_NOSYSTEM: '0' };`) },
  { id: 'F25', expect: 'fail', texts: both(`${KEEP}\nconst pick = ${PICK};\nconst over = { GIT_CONFIG_NOSYSTEM: '0' };\nconst env = { ${NOSYS}, ...pick, ...over };`) },
  { id: 'F26', expect: 'fail', texts: both(`${KEEP}\nconst env = { ...${PICK}, TEMP: '/t' };`) },
  { id: 'F27', expect: 'fail', texts: both(`${KEEP}\nconst flag = '1';\nconst env = { ...${PICK}, GIT_CONFIG_NOSYSTEM: flag };`) },
  { id: 'F28', expect: 'fail', texts: both(`${KEEP}\n// GIT_CONFIG_NOSYSTEM: '1' is set below\nconst env = { ...${PICK}, TEMP: '/t' };`) },
  { id: 'F29', expect: 'fail', texts: both(`const env = { PATH: process.env.PATH, git_dir: d, ${NOSYS} };`) },
  { id: 'F30', expect: 'fail', texts: both(`const env = { PATH: process.env.PATH, GIT_DIR: d, ${NOSYS} };`) },
  // scope and binding
  { id: 'F31', expect: 'fail', texts: [`function a() { ${ALLOW} return ${SHORT} }\nfunction b() { const env = { ...process.env }; return ${SHORT} }\n`, `function a() { ${ALLOW} return ${KEYED} }\nfunction b() { const env = { ...process.env }; return ${KEYED} }\n`] },
  { id: 'F32', expect: 'fail', texts: [`${ALLOW}\nfunction b() { let env = { ...process.env }; return ${SHORT} }\n`, `${ALLOW}\nfunction b() { let env = { ...process.env }; return ${KEYED} }\n`] },
  { id: 'F33', expect: 'fail', texts: [`${ALLOW}\nfunction run(env) { return ${SHORT} }\n`, `${ALLOW}\nfunction run(env) { return ${KEYED} }\n`, `function run(env) { return ${SHORT} }\n`, `function run(env) { return ${KEYED} }\n`] },
  { id: 'F34', expect: 'fail', texts: [`function a() { const e2 = { PATH: process.env.PATH, ${NOSYS} }; return spawnSync('git', ['a'], { env: e2 }); }\nfunction b() { const e2 = { ...process.env }; return spawnSync('git', ['b'], { env: e2 }); }\n`] },
  // round 2
  { id: 'F35', expect: 'fail', texts: both(`${ALLOW}\nconst alias = env;\nfor (const k in process.env) alias[k] = process.env[k];`) },
  { id: 'F36', expect: 'fail', texts: both(`${ALLOW}\nfunction fill(o) { for (const k in process.env) o[k] = process.env[k]; }\nfill(env);`) },
  { id: 'F37', expect: 'fail', texts: both(`${ALLOW}\nReflect.set(env, 'GIT_DIR', d);`) },
  { id: 'F38', expect: 'fail', texts: both(`${ALLOW}\nconst alias = env;\nalias.GIT_DIR = d;`) },
  { id: 'F39', expect: 'fail', texts: both(`${ALLOW}\nObject.assign(Object(env), { GIT_DIR: d });`) },
  { id: 'F40', expect: 'fail', texts: both(`${ALLOW}\nenv.__defineGetter__('GIT_DIR', () => d);`) },
  { id: 'F41', expect: 'fail', texts: [
    ...both(`const env = { a: /'/, GIT_DIR: d, ${NOSYS} };`),
    ...both(`const env = { a: ${BT}\\${BT}${BT}, GIT_DIR: d, ${NOSYS} };`),
    ...both(`const re = /"/;\nconst env = { PATH: process.env.PATH, GIT_DIR: d, ${NOSYS} };`),
    ...both(`const env = { u: 'http://x', GIT_DIR: d, ${NOSYS} };`),
    ...both(`const env = { u: ${BT}\${'a'}${BT}, p: /[/']/, GIT_DIR: d, ${NOSYS} };`),
  ] },
  { id: 'F42', expect: 'fail', texts: [
    `const gitEnv = () => ({ ...process.env });\n${INLINE('gitEnv()')}\n`,
    `function gitEnv() { return { ...Object.fromEntries(Object.entries(process.env)) }; }\n${INLINE('gitEnv()')}\n`,
    `const gitEnv = () => process.env;\n${INLINE("{ ...gitEnv(), LC_ALL: 'C' }")}\n`,
    `const gitTestEnv = (d) => ({ ...process.env, HOME: d });\n${INLINE('gitTestEnv(d)')}\n`,
    ...both('const gitEnv = () => ({ ...process.env });\nconst env = gitEnv();'),
  ] },
  // recognition: the census must COUNT the spawn, then judge its env
  { id: 'R1', expect: 'fail', texts: [`spawnSync(${BT}git${BT}, ['status'], { env: process.env });\n`] },
  { id: 'R2', expect: 'fail', texts: [`spawnSync('git.exe', ['status'], { env: process.env });\n`, `execFileSync('git.exe', ['status'], { cwd: d });\n`] },
  // room-local candidates found while building the census (not on the witness list; offered to the chief as rows X1-X6)
  { id: 'X1', expect: 'fail', texts: both(`const p = process;\nconst env = { all: p.env, ${NOSYS} };`) },
  { id: 'X2', expect: 'fail', texts: ["spawnSync('git', [{ env: gitEnv(d) }, 'status'], { cwd: d });\n"] },
  { id: 'X3', expect: 'fail', noCount: true, texts: ["import { spawnSync as run } from 'node:child_process';\nrun('git', ['status'], { env: process.env });\n", "const { execFileSync: run } = cp;\nrun('git', ['status'], { env: process.env });\n"] },
  { id: 'X4', expect: 'fail', texts: [...both(`const env = { __proto__: process.env, ${NOSYS} };`), ...both(`import { env as penv } from 'node:process';\nconst env = { __proto__: penv, ${NOSYS} };`)] },
  { id: 'X5', expect: 'fail', texts: ["spawnSync('git', ['status'], { env: gitEnv(d), ...opts });\n", "spawnSync('git', ['status'], { ...opts, env: gitEnv(d) });\n"] },
  { id: 'X6', expect: 'fail', texts: ["spawnSync('git', ['status'], { env: gitEnv(d), env: process.env });\n"] },
  // the controls
  { id: 'P3', expect: 'pass', texts: [INLINE('gitEnv(d)') + '\n', ...both('const env = gitEnv(d);')] },
  { id: 'P4', expect: 'pass', texts: [INLINE("{ PATH: process.env.PATH, HOME: process.env.HOME, GIT_CONFIG_NOSYSTEM: '1' }") + '\n'] },
  { id: 'P5', expect: 'pass', texts: [...both(`${KEEP}\nconst env = { ...Object.fromEntries(keep.filter((k) => k in process.env).map((k) => [k, process.env[k]])), ${NOSYS} };`), ...both(`${PICKENV(NOSYS)}`)] },
  { id: 'P6', expect: 'pass', texts: both(`const keep = ['PATH'];\nconst pick = ${PICK};\nconst env = { ...pick, ${NOSYS}, GIT_TERMINAL_PROMPT: '0', GIT_CEILING_DIRECTORIES: d };`) },
];
