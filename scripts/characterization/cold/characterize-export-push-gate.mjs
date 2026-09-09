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
} from '../../../src/services/export-push-gate.js';

assert.deepEqual([...PUSHABLE_RECORD_STATUSES], ['completed']);

assert.equal(isPushableRecordStatus('completed'), true);
assert.equal(isPushableRecordStatus('recorded'), false);
assert.equal(isPushableRecordStatus('failed'), false);
assert.equal(isPushableRecordStatus('draft'), false);
assert.equal(isPushableRecordStatus('recording'), false);
assert.equal(isPushableRecordStatus(null), false);

assert.equal(getRecordStatus({ recordStatus: 'draft' }), 'draft');
assert.equal(getRecordStatus({ record_status: 'recorded' }), 'recorded');
// 2026-09-09：判定源改为持久基线 persistent_record_status，record_status 仅作旧行回退
assert.equal(
  getRecordStatus({ persistentRecordStatus: 'completed', recordStatus: 'recording' }),
  'completed',
);
assert.equal(
  getRecordStatus({ persistent_record_status: 'completed', record_status: 'recording' }),
  'completed',
);

assertPushableForPartner({ recordStatus: 'completed' });
assertPushableForPartner({ persistentRecordStatus: 'completed', recordStatus: 'recording' });

for (const status of ['recorded', 'failed', 'draft', 'recording']) {
  let threw = false;
  try {
    assertPushableForPartner({ recordStatus: status });
    assertPushableForPartner({ persistentRecordStatus: status });
  } catch (err) {
    threw = true;
    assert.equal(err.statusCode, 409);
    assert.equal(err.code, 'not_pushable_status');
    assert.equal(err.recordStatus, status);
    assert.match(err.message, /已确认/);
  }
  assert.equal(threw, true, `must reject recordStatus=${status}`);
}

console.log('characterize-export-push-gate: OK');
