/**
 * Smoke: appendRecordedStep idempotency via trajectory_step.action_id.
 * Run: node scripts/smoke/smoke-trajectory-step-idempotent.mjs
 */
import { randomUUID } from 'crypto';
import '../../config/config.js';
import { getDB, closeDB } from '../../config/database.js';
import { appendRecordedStep } from '../../src/services/trajectory-persist-service.js';
import * as systemDao from '../../src/dao/system-dao.js';

const ACTION_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

async function main() {
  const defaultFn = await systemDao.getDefaultFunctionId();
  if (!defaultFn) throw new Error('Default function_def missing — run seed first');

  const db = getDB();
  let trajectoryId = null;
  let phaseId = null;

  try {
    [trajectoryId] = await db('trajectory').insert({
      name: 'smoke idempotent step',
      task: 'smoke',
      model: 'smoke',
      function_id: defaultFn,
      record_status: 'draft',
    });

    [phaseId] = await db('trajectory_phase').insert({
      phase_id: randomUUID(),
      trajectory_id: trajectoryId,
      phase_number: 1,
      status: 'running',
    });

    const entry = {
      id: ACTION_ID,
      action: 'fill_form_field',
      params: { label_text: '姓名', value: '测试' },
      phase: 1,
      success: true,
    };

    const r1 = await appendRecordedStep(trajectoryId, entry, {
      source: 'agent',
      trajectoryPhaseId: phaseId,
    });
    const r2 = await appendRecordedStep(trajectoryId, entry, {
      source: 'agent',
      trajectoryPhaseId: phaseId,
    });

    if (!r1 || !r2) throw new Error('appendRecordedStep returned null');

    const rows = await db('trajectory_step')
      .where({ trajectory_id: trajectoryId, action_id: ACTION_ID });

    if (rows.length !== 1) {
      throw new Error(`Expected 1 row, got ${rows.length}`);
    }
    if (r1.dbId !== r2.dbId || r1.stepNumber !== r2.stepNumber) {
      throw new Error(`Mismatch: r1=${JSON.stringify(r1)} r2=${JSON.stringify(r2)}`);
    }

    console.log('smoke-trajectory-step-idempotent: OK');
    process.exit(0);
  } catch (err) {
    console.error('smoke-trajectory-step-idempotent: FAIL:', err.message);
    process.exit(1);
  } finally {
    if (trajectoryId != null) {
      await db('trajectory_step').where({ trajectory_id: trajectoryId }).del().catch(() => null);
      await db('trajectory_phase').where({ trajectory_id: trajectoryId }).del().catch(() => null);
      await db('trajectory').where({ id: trajectoryId }).del().catch(() => null);
    }
    await closeDB();
  }
}

main();
