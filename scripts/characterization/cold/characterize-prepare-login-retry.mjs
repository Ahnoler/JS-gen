/**
 * Cold pin: prepare login cold-start retry — settle + exponential backoff (not fixed 8s).
 * Run: node scripts/characterization/cold/characterize-prepare-login-retry.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const { runPrepareLoginWithColdStartRetry } = await import(
  pathToFileURL(join(ROOT, 'src/services/trajectory/prepare-login-retry.js')).href
);

function sleepSpy(log) {
  return async (ms) => { log.push(ms); };
}

async function testSucceedsFirstAttemptNoSleep() {
  const sleeps = [];
  const settles = [];
  const out = await runPrepareLoginWithColdStartRetry({
    runLogin: async () => {},
    settle: async () => { settles.push(1); },
    sleep: sleepSpy(sleeps),
    maxAttempts: 3,
    initialDelayMs: 1000,
  });
  assert.equal(out.attempts, 1);
  assert.deepEqual(sleeps, []);
  assert.deepEqual(settles, []);
}

async function testBackoffAndSettleBetweenFailures() {
  const sleeps = [];
  const settles = [];
  let n = 0;
  const out = await runPrepareLoginWithColdStartRetry({
    runLogin: async () => {
      n += 1;
      if (n < 3) throw new Error(`fail-${n}`);
    },
    settle: async () => { settles.push(n); },
    sleep: sleepSpy(sleeps),
    maxAttempts: 3,
    initialDelayMs: 1000,
    maxDelayMs: 8000,
    budgetMs: 60000,
  });
  assert.equal(out.attempts, 3);
  assert.deepEqual(settles, [1, 2], 'settle before each retry');
  assert.deepEqual(sleeps, [1000, 2000], 'exponential backoff 1s then 2s');
}

async function testExhaustsAndRethrows() {
  const sleeps = [];
  await assert.rejects(
    () => runPrepareLoginWithColdStartRetry({
      runLogin: async () => { throw new Error('always'); },
      settle: async () => {},
      sleep: sleepSpy(sleeps),
      maxAttempts: 2,
      initialDelayMs: 500,
      budgetMs: 60000,
    }),
    /always/,
  );
  assert.deepEqual(sleeps, [500]);
}

function testAttachRunnerWiresHelper() {
  const src = readFileSync(
    join(ROOT, 'src/services/trajectory/trajectory-attach-runner.js'),
    'utf8',
  );
  assert.match(src, /runPrepareLoginWithColdStartRetry/, 'attach-runner uses helper');
  assert.match(src, /wait_for_loading/, 'settle uses wait_for_loading');
  assert.doesNotMatch(
    src,
    /retry once after \$\{retryDelayMs\}ms/,
    'old fixed-delay warn message gone',
  );
}

async function main() {
  await testSucceedsFirstAttemptNoSleep();
  console.log('  ✓ first attempt success → no settle/sleep');
  await testBackoffAndSettleBetweenFailures();
  console.log('  ✓ settle + exponential backoff between failures');
  await testExhaustsAndRethrows();
  console.log('  ✓ exhaust rethrows last error');
  testAttachRunnerWiresHelper();
  console.log('  ✓ attach-runner wiring');
  console.log('characterize-prepare-login-retry: OK');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
