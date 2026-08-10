/**
 * Live step append for persisted trajectories: appendRecordedStep (generic
 * CDP/manual/agent action) + appendRecordedFormSnapshot (save_form_snapshot
 * checkpoint dual-write with fingerprint dedupe).
 * Extracted from trajectory-persist-service.js — move-only, no logic changes.
 */
import * as trajectoryDao from '../../dao/trajectory-dao.js';
import * as trajectoryStepDao from '../../dao/trajectory-step-dao.js';
import * as formSnapshotDao from '../../dao/form-snapshot-dao.js';
import { getDB } from '../../../config/database.js';
import { stepFromActionLog } from '../../models/helpers.js';
import { touchTrajectoryRuntimeActivity } from '../trajectory-runtime.js';
import { refreshTrajectoryCounts } from '../trajectory-step-service.js';
import { resolvePhaseIdForPersist } from './trajectory-persist-service.js';

/**
 * Append a single recorded action (CDP/manual/agent) to an existing trajectory immediately.
 * Always prefers an explicit trajectory_phase.id; falls back to last phase.
 * Special-case: save_form_snapshot → checkpoint step + form_snapshot dual-write (fingerprint dedupe).
 * @returns {{ stepNumber: number, actionId: string|null, trajectoryPhaseId: number|null, dbId?: number|null }|null}
 */
export async function appendRecordedStep(trajectoryDbId, entry, { source, trajectoryPhaseId } = {}) {
  const tid = Number(trajectoryDbId);
  if (!Number.isFinite(tid) || tid <= 0 || !entry) return null;

  const actionName = String(entry.action || entry.actionType || '').trim();
  if (actionName === 'save_form_snapshot') {
    return appendRecordedFormSnapshot(tid, entry, { source, trajectoryPhaseId });
  }

  const actionId = entry.id ? String(entry.id).trim() : null;
  if (actionId) {
    const existing = await getDB()('trajectory_step')
      .where({ trajectory_id: tid, action_id: actionId })
      .first();
    if (existing) {
      return {
        stepNumber: Number(existing.step_number),
        actionId,
        trajectoryPhaseId: existing.trajectory_phase_id != null
          ? Number(existing.trajectory_phase_id)
          : null,
        dbId: Number(existing.id),
      };
    }
  }

  const resolvedSource = source || entry.source || 'agent';
  const phaseNumberHint = Number(entry.phase ?? entry.phaseNumber ?? 0) || 0;
  const maxStep = await trajectoryDao.getMaxStepNumber(tid);
  const stepNumber = maxStep + 1;

  const { id: resolvedPhaseId, phaseNumber: resolvedPhaseNumber } = await resolvePhaseIdForPersist(tid, {
    phaseId: trajectoryPhaseId ?? entry.trajectoryPhaseId ?? null,
    phaseNumber: phaseNumberHint || null,
    fallbackLast: true,
  });

  let phaseNumber = phaseNumberHint;
  if (resolvedPhaseNumber != null) phaseNumber = resolvedPhaseNumber;

  const step = stepFromActionLog(entry, {
    trajectoryId: tid,
    stepNumber,
    phaseNumber,
    source: resolvedSource,
  });
  step.trajectoryId = tid;
  step.stepNumber = stepNumber;
  step.trajectoryPhaseId = resolvedPhaseId;

  try {
    await trajectoryStepDao.batchSave([step]);
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY' && actionId) {
      const dup = await getDB()('trajectory_step')
        .where({ trajectory_id: tid, action_id: actionId })
        .first();
      if (dup) {
        return {
          stepNumber: Number(dup.step_number),
          actionId,
          trajectoryPhaseId: dup.trajectory_phase_id != null
            ? Number(dup.trajectory_phase_id)
            : null,
          dbId: Number(dup.id),
        };
      }
    }
    throw err;
  }

  const row = await getDB()('trajectory_step')
    .where({ trajectory_id: tid, step_number: stepNumber })
    .orderBy('id', 'desc')
    .first();
  const dbId = row?.id != null ? Number(row.id) : null;

  const counts = await refreshTrajectoryCounts(tid);
  await trajectoryDao.updateMeta(tid, {
    stepCount: counts.stepCount,
    phaseCount: counts.phaseCount,
  });

  touchTrajectoryRuntimeActivity(tid);

  return {
    stepNumber,
    actionId: entry.id || null,
    trajectoryPhaseId: resolvedPhaseId,
    dbId,
  };
}

/**
 * Atomic checkpoint: trajectory_step (save_form_snapshot) + form_snapshot with trigger_step_id.
 * Fingerprint dedupe: same phase + root container + fields → update existing, no new step.
 */
export async function appendRecordedFormSnapshot(trajectoryDbId, entry, { source, trajectoryPhaseId } = {}) {
  const tid = Number(trajectoryDbId);
  if (!Number.isFinite(tid) || tid <= 0 || !entry) return null;

  const params = entry.params && typeof entry.params === 'object' ? entry.params : {};
  const container = params.container || 'main';
  const fields = Array.isArray(params.fields) ? params.fields : [];
  const fieldCount = params.count ?? params.fieldCount ?? fields.length;
  const requiredCount = params.required_count ?? params.requiredCount
    ?? fields.filter((f) => f.is_required || f.isRequired).length;
  const optionalCount = params.optional_count ?? params.optionalCount
    ?? Math.max(0, fieldCount - requiredCount);
  const actionIndex = params.action_index ?? params.actionIndex ?? 0;

  const phaseNumberHint = Number(entry.phase ?? entry.phaseNumber ?? 0) || 0;
  const { id: resolvedPhaseId, phaseNumber: resolvedPhaseNumber } = await resolvePhaseIdForPersist(tid, {
    phaseId: trajectoryPhaseId ?? entry.trajectoryPhaseId ?? null,
    phaseNumber: phaseNumberHint || null,
    fallbackLast: true,
  });

  const existing = await formSnapshotDao.findForDedupe(
    tid,
    resolvedPhaseId,
    container,
    fields,
  );
  if (existing) {
    await formSnapshotDao.updateFields(existing.id, {
      fieldCount,
      requiredCount,
      optionalCount,
      fields,
      actionIndex,
      container: existing.container || container,
    });
    if (existing.triggerStepId) {
      await trajectoryStepDao.update(existing.triggerStepId, {
        params: {
          ...params,
          container: existing.container || container,
          fields,
          count: fieldCount,
          required_count: requiredCount,
          optional_count: optionalCount,
        },
      }).catch(() => null);
    }
    touchTrajectoryRuntimeActivity(tid);
    const trigger = existing.triggerStepId
      ? await trajectoryStepDao.getById(existing.triggerStepId)
      : null;
    return {
      stepNumber: trigger?.stepNumber ?? 0,
      actionId: entry.id || null,
      trajectoryPhaseId: resolvedPhaseId,
      dbId: existing.triggerStepId ?? null,
      formSnapshotId: existing.id,
      deduped: true,
    };
  }

  const resolvedSource = source || entry.source || 'agent';
  let phaseNumber = phaseNumberHint;
  if (resolvedPhaseNumber != null) phaseNumber = resolvedPhaseNumber;

  const maxStep = await trajectoryDao.getMaxStepNumber(tid);
  const stepNumber = maxStep + 1;
  const step = stepFromActionLog(
    {
      ...entry,
      action: 'save_form_snapshot',
      params: {
        container,
        fields,
        count: fieldCount,
        required_count: requiredCount,
        optional_count: optionalCount,
        action_index: actionIndex,
      },
    },
    {
      trajectoryId: tid,
      stepNumber,
      phaseNumber,
      source: resolvedSource,
    },
  );
  step.trajectoryId = tid;
  step.stepNumber = stepNumber;
  step.trajectoryPhaseId = resolvedPhaseId;

  const db = getDB();
  const result = await db.transaction(async (trx) => {
    const stepRow = {
      trajectory_id: tid,
      step_number: stepNumber,
      phase_number: phaseNumber,
      action_index: step.actionIndex ?? 0,
      action_type: 'save_form_snapshot',
      params_json: step.params,
      element_json: step.element,
      success: step.success ?? null,
      error: step.error ?? null,
      extracted_content: step.extractedContent || '',
      trajectory_phase_id: resolvedPhaseId,
      source: resolvedSource,
      confirmed: true,
    };
    const [stepId] = await trx('trajectory_step').insert(stepRow);
    const [snapId] = await trx('form_snapshot').insert({
      container,
      field_count: fieldCount,
      required_count: requiredCount,
      optional_count: optionalCount,
      action_index: actionIndex,
      trigger_step_id: stepId,
      case_data_id: null,
      trajectory_id: tid,
    });
    if (fields.length) {
      await trx('snapshot_field').insert(fields.map((f) => ({
        form_snapshot_id: snapId,
        label: f.label,
        is_required: f.isRequired ?? f.is_required ?? false,
      })));
    }
    await trajectoryDao.markExportDirty(tid, trx);
    return { stepId, snapId };
  });

  const counts = await refreshTrajectoryCounts(tid);
  await trajectoryDao.updateMeta(tid, {
    stepCount: counts.stepCount,
    phaseCount: counts.phaseCount,
  });
  touchTrajectoryRuntimeActivity(tid);

  return {
    stepNumber,
    actionId: entry.id || null,
    trajectoryPhaseId: resolvedPhaseId,
    dbId: result.stepId,
    formSnapshotId: result.snapId,
    deduped: false,
  };
}
