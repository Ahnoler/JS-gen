/**
 * Smoke test: dual-write trajectory + case_data into MySQL.
 * Run: node scripts/smoke/smoke-db-write.mjs
 */
import { randomUUID } from 'crypto';
import { persistSessionTrajectory } from '../../src/services/trajectory-service.js';
import { persistSessionCaseData } from '../../src/services/case-data-service.js';
import { getDB, closeDB } from '../../config/database.js';
import * as functionDefDao from '../../src/dao/function-def-dao.js';

const trajId = `traj_smoke_${Date.now()}`;
const recordId = `cdata_smoke_${Date.now()}`;

try {
  const defaultFn = await functionDefDao.getDefaultFunctionId();
  console.log('[smoke] default function_def.id =', defaultFn);
  if (!defaultFn) throw new Error('Default function_def missing — run seed first');

  const dbTrajId = await persistSessionTrajectory({
    trajectoryId: trajId,
    task: 'smoke test trajectory',
    model: 'smoke-model',
    url: 'http://example.com',
    isDone: true,
    isSuccessful: true,
    flow: [
      {
        stepNumber: 1,
        phaseNumber: 1,
        type: 'fill_form_field',
        description: 'fill name',
        params: { label_text: '姓名', value: '测试' },
        element: { tag: 'input', xpath: '//input', cssSelector: 'input' },
        success: true,
      },
      {
        stepNumber: 2,
        phaseNumber: 1,
        type: 'click_menu_item',
        description: 'click menu',
        params: { menu_text: '客户管理' },
        success: true,
      },
    ],
  });
  console.log('[smoke] trajectory db id =', dbTrajId);

  const caseDbId = await persistSessionCaseData({
    record: {
      recordId,
      sessionId: 'smoke-session',
      model: 'smoke-model',
      description: 'smoke case data',
    },
    data: {
      姓名: '测试',
      手机号: '13800138000',
      form_snapshots: [
        {
          container: 'main',
          count: 2,
          required_count: 1,
          optional_count: 1,
          action_index: 1,
          fields: [
            { label: '姓名', is_required: true },
            { label: '手机号', is_required: false },
          ],
        },
      ],
    },
  });
  console.log('[smoke] case_data db id =', caseDbId);

  const db = getDB();
  const traj = await db('trajectory').where({ trajectory_id: trajId }).first();
  const steps = await db('trajectory_step').where({ trajectory_id: dbTrajId });
  const phases = await db('trajectory_phase').where({ trajectory_id: dbTrajId });
  const cdata = await db('case_data').where({ record_id: recordId }).first();
  const entries = await db('case_data_entry').where({ case_data_id: caseDbId });
  const snaps = await db('form_snapshot').where({ case_data_id: caseDbId });
  const fields = snaps.length
    ? await db('snapshot_field').where({ form_snapshot_id: snaps[0].id })
    : [];

  console.log('[smoke] verify', {
    trajectory: !!traj,
    stepCount: steps.length,
    phaseCount: phases.length,
    caseData: !!cdata,
    entryCount: entries.length,
    snapshotCount: snaps.length,
    fieldCount: fields.length,
    stepSource: steps[0]?.source,
  });

  const ok =
    traj &&
    steps.length === 2 &&
    phases.length >= 1 &&
    cdata &&
    entries.length === 2 &&
    snaps.length === 1 &&
    fields.length === 2;

  if (!ok) throw new Error('Smoke verification failed');
  console.log('[smoke] PASS');
} catch (err) {
  console.error('[smoke] FAIL:', err.message);
  process.exitCode = 1;
} finally {
  await closeDB();
}
