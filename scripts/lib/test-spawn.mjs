// The child spawn plan of scripts/test.mjs (CWK-199's class). `node --test` spawns one child per test
// file, so the heap cap rides NODE_OPTIONS in the ENV (a --max-old-space-size flag on the argv would cap
// the runner and none of the files it runs) and the files run one at a time. Zone rule: CoalWorks
// dispatch-transport.md, ninth amendment. A caller's own heap flag is kept as set (their cap wins,
// never doubled), in any spelling Node accepts (dash or underscore per word; measured on Node 24:
// --max_old_space_size=1024 and --max-old_space-size=1024 both give the 1024 MB cap; the space form
// `--max-old-space-size 1024` is refused by Node, so it is not matched); any other NODE_OPTIONS value is kept and the cap appended.
//
// TEST_TIMEOUT_MS is the finite clock testing.md asks of every room's test entry (a hung test must fail,
// not hold the runner). Basis, measured 2026-10-08 on this box, serial: the slowest single test took
// 23.7 s and the slowest file (scripts/verify.test.mjs) 57.4 s wall; 120 s is twice the slowest file, and
// the same value CoalHearth and CoalWash use. It is a per-test deadline: a synchronous block (a spawnSync
// that hangs) is cut by that call's own `timeout`, not by this flag.
export const TEST_TIMEOUT_MS = 120000;
export const HEAP_FLAG = '--max-old-space-size=2048';

export function testSpawnPlan(tests, baseEnv) {
  const caller = baseEnv.NODE_OPTIONS || '';
  const nodeOptions = /(^|\s)--max[-_]old[-_]space[-_]size=/.test(caller) ? caller : `${caller} ${HEAP_FLAG}`.trim();
  return { args: ['--test', '--test-concurrency=1', `--test-timeout=${TEST_TIMEOUT_MS}`, ...tests], env: { ...baseEnv, NODE_OPTIONS: nodeOptions } };
}
