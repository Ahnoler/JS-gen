/**
 * Characterization: partner push recordStatus gate (1448068).
 * Run: node scripts/characterization/characterize-export-push-gate.mjs
 */
import assert from 'node:assert/strict';
import {
  assertPushableForPartner,
  getRecordStatus,
  isPushableRecordStatus,
  PUSHABLE_RECORD_STATUSES,
} from '../../src/services/export-push-gate.js';

assert.deepEqual([...PUSHABLE_RECORD_STATUSES], ['recorded', 'completed']);

assert.equal(isPushableRecordStatus('recorded'), true);
assert.equal(isPushableRecordStatus('completed'), true);
assert.equal(isPushableRecordStatus('draft'), false);
assert.equal(isPushableRecordStatus('live'), false);
assert.equal(isPushableRecordStatus('recording'), false);
assert.equal(isPushableRecordStatus(null), false);

assert.equal(getRecordStatus({ recordStatus: 'draft' }), 'draft');
assert.equal(getRecordStatus({ record_status: 'recorded' }), 'recorded');

assertPushableForPartner({ recordStatus: 'recorded' });
assertPushableForPartner({ recordStatus: 'completed' });

let threw = false;
try {
  assertPushableForPartner({ recordStatus: 'draft' });
} catch (err) {
  threw = true;
  assert.equal(err.statusCode, 409);
  assert.equal(err.code, 'not_pushable_status');
  assert.equal(err.recordStatus, 'draft');
  assert.match(err.message, /录制完成/);
}
assert.equal(threw, true);

console.log('characterize-export-push-gate: OK');
