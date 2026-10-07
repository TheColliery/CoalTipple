// The child spawn plan of scripts/test.mjs (CWK-199's class). `node --test` spawns one child per test
// file, so the heap cap rides NODE_OPTIONS in the ENV (a --max-old-space-size flag on the argv would cap
// the runner and none of the files it runs) and the files run one at a time. Zone rule: CoalWorks
// dispatch-transport.md, ninth amendment. A caller's own heap flag is kept as set (their cap wins,
// never doubled); any other NODE_OPTIONS value is kept and the cap appended.
export const HEAP_FLAG = '--max-old-space-size=2048';

export function testSpawnPlan(tests, baseEnv) {
  const caller = baseEnv.NODE_OPTIONS || '';
  const nodeOptions = /(^|\s)--max-old-space-size[= ]/.test(caller) ? caller : `${caller} ${HEAP_FLAG}`.trim();
  return { args: ['--test', '--test-concurrency=1', ...tests], env: { ...baseEnv, NODE_OPTIONS: nodeOptions } };
}
