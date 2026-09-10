/**
 * Cold pin: batch item lease renewal during long prepare+record.
 * Run: node scripts/characterization/cold/characterize-batch-item-lease-renew.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const {
  leaseRenewIntervalMs,
  startItemLeaseRenewal,
} = await import(
  pathToFileURL(join(ROOT, 'src/services/trajectory/batch-record.js')).href
);

function testRenewIntervalIsLeaseThirdWithFloor() {
  assert.equal(leaseRenewIntervalMs(600_000), 200_000);
  assert.equal(leaseRenewIntervalMs(60_000), 30_000, 'floor 30s');
  assert.equal(leaseRenewIntervalMs(90_000), 30_000);
}

async function testStartRenewalTicksAndStops() {
  const calls = [];
  const stop = startItemLeaseRenewal({
    itemId: 42,
    workerToken: 'tok-a',
    leaseMs: 90_000,
    renewEveryMs: 40,
    renew: async (id, opts) => {
      calls.push({ id, ...opts });
    },
  });
  await new Promise((r) => setTimeout(r, 110));
  stop();
  await new Promise((r) => setTimeout(r, 80));
  assert.ok(calls.length >= 2, `expected >=2 renew ticks, got ${calls.length}`);
  assert.equal(calls[0].id, 42);
  assert.equal(calls[0].expectedWorkerToken, 'tok-a');
  assert.equal(calls[0].leaseMs, 90_000);
  const afterStop = calls.length;
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(calls.length, afterStop, 'no ticks after stop');
}

function testDaoExportsRenewHelper() {
  const dao = readFileSync(join(ROOT, 'src/dao/batch-recording-dao.js'), 'utf8');
  assert.match(dao, /export async function renewItemLease\b/);
  assert.match(dao, /lease_expires_at/);
  assert.match(dao, /expectedWorkerToken/);
}

function testRunRecordWiresRenewal() {
  const src = readFileSync(join(ROOT, 'src/services/trajectory/batch-record.js'), 'utf8');
  assert.match(src, /startItemLeaseRenewal\s*\(/);
  assert.match(src, /stopRenew\s*\(\)/);
  assert.match(src, /renewItemLease/);
}

testRenewIntervalIsLeaseThirdWithFloor();
await testStartRenewalTicksAndStops();
testDaoExportsRenewHelper();
testRunRecordWiresRenewal();
console.log('characterize-batch-item-lease-renew: OK');
