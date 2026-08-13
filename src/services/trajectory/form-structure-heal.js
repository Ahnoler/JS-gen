/**
 * Type B form-structure checkpoint handling for steps/replay (extracted from
 * trajectory-session-replay.js — move-only).
 *
 * When a recorded save_form_snapshot step is replayed, the live scan result is
 * compared against the stored snapshot: missing labels are deleted from the
 * trajectory, added labels are AI-filled and inserted as structured steps
 * (confirmed=0, picked up by the next batch). Unsafe scans never mutate.
 */
import { getDB } from '../../../config/database.js';
import * as execSession from '../../executor-session-client.js';
import * as formSnapshotDao from '../../dao/form-snapshot-dao.js';
import * as trajectoryStepDao from '../../dao/trajectory-step-dao.js';
import {
  REPLAY_TIMEOUT_MS,
  USER_ABORT_CODE,
  isUserAbort,
  trajScope,
  emitReplay,
  toNumericStepId,
  runHealStep,
} from './replay-heal-shared.js';
import {
  buildFormStructureHealInstruction,
} from '../../routes/browser-session/heal-instruction.js';
import { broadcast } from '../../ws-server.js';
import {
  markConsumedActionLog,
} from '../trajectory-runtime.js';
import {
  markStepReplayFailed,
  markStepReplayOk,
  insertStepsAfter,
  refreshTrajectoryCounts,
} from '../trajectory-step-service.js';
import * as trajectoryDao from '../../dao/trajectory-dao.js';

/** Type B may fill several new fields. */
const FORM_STRUCTURE_HEAL_MAX_STEPS = 24;

const FILL_ACTION_TYPES = new Set([
  'fill_form_field',
  'fill_date_field',
  'select_option',
  'click_radio',
  'select_tree_option',
]);

function parseFormStructureResult(raw) {
  const s = String(raw || '');
  const jsonPart = s.startsWith('form-structure:') ? s.slice('form-structure:'.length) : s;
  try {
    const obj = typeof jsonPart === 'object' ? jsonPart : JSON.parse(jsonPart);
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

function needsTypeB(report) {
  if (!report) return false;
  if (report.error === 'container_not_found') return false;
  return !!(
    report.hasRequiredChange
    || (Array.isArray(report.missing_required) && report.missing_required.length)
    || (Array.isArray(report.added_required) && report.added_required.length)
    || (Array.isArray(report.added_optional) && report.added_optional.length)
    || (Array.isArray(report.missing_optional) && report.missing_optional.length)
  );
}

/**
 * Guard Type B mutations: wrong-scope / collapsed scans must not delete steps or rewrite snapshots.
 * Classic failure: expected main ~70 fields, scanned drawer ~6 → mass missing → wipe trajectory.
 * @returns {{ unsafe: boolean, reason?: string }}
 */
function assessFormStructureDiffSafety(report, snap) {
  if (!report) return { unsafe: true, reason: 'no_report' };
  if (report.error === 'container_not_found') {
    return { unsafe: true, reason: 'container_not_found' };
  }
  const expected = Number(report.expected_count);
  const actual = Number(report.count);
  const exp = Number.isFinite(expected) && expected > 0
    ? expected
    : (Array.isArray(snap?.fields) ? snap.fields.length : 0);
  const act = Number.isFinite(actual) && actual >= 0 ? actual : 0;
  const missingN = (report.missing_required?.length || 0)
    + (report.missing_optional?.length || 0);

  if (exp >= 8) {
    if (act === 0) return { unsafe: true, reason: 'empty_scan' };
    if (act / exp < 0.4) return { unsafe: true, reason: 'count_collapse' };
    if (exp - act >= 15) return { unsafe: true, reason: 'count_gap' };
    if (missingN / exp >= 0.5) return { unsafe: true, reason: 'missing_mass' };
  }
  // Either direction: sets look like different forms (drawer vs main)
  if (exp >= 5 && act >= 5) {
    const ratio = Math.min(exp, act) / Math.max(exp, act);
    if (ratio < 0.4 && Math.abs(exp - act) >= 10) {
      return { unsafe: true, reason: 'count_mismatch' };
    }
  }
  return { unsafe: false };
}

export async function handleFormStructureCheckpoint({
  tid,
  runtime,
  doSuppress,
  entry,
  stepId,
  stepNum,
  total,
  actions,
  skippedIds,
  snapshotsByTrigger,
}) {
  const results = [];
  const healed = [];
  const snap = stepId != null ? snapshotsByTrigger.get(stepId) : null;

  // No bound snapshot (legacy) → skip Type B, treat as success no-op
  if (!snap) {
    if (stepId != null) {
      try { await markStepReplayOk(stepId); } catch { /* ignore */ }
    }
    emitReplay('replay:step', tid, {
      stepId,
      status: 'success',
      index: stepNum,
      total,
      action: entry.action,
      healType: 'form_structure',
      skipped: 'no_trigger_snapshot',
    });
    results.push({
      index: stepNum,
      action: entry.action,
      params: entry.params,
      result: 'ok-skip-no-snapshot',
      ok: true,
      id: entry.id,
      confirmed: true,
    });
    return { ok: true, aborted: false, results, healed };
  }

  let result;
  try {
    const doneP = execSession.waitForSessionEvent(runtime.sessionId, 'replay_done', REPLAY_TIMEOUT_MS);
    execSession.forwardStdin({
      nodeUuid: runtime.executorNodeUuid,
      sessionId: runtime.sessionId,
      event: 'replay_actions',
      data: {
        actions: [{
          ...entry,
          params: {
            ...(entry.params || {}),
            fields: (snap.fields || []).map((f) => ({
              label: f.label,
              is_required: !!(f.isRequired ?? f.is_required),
            })),
            container: snap.container,
          },
        }],
        is_replay: doSuppress,
        stop_on_fail: true,
      },
    });
    result = await doneP;
    await markConsumedActionLog(runtime);
  } catch (e) {
    const msg = e?.message || String(e);
    if (stepId != null) {
      try { await markStepReplayFailed(stepId); } catch { /* ignore */ }
    }
    emitReplay('replay:step', tid, {
      stepId,
      status: 'failed',
      error: msg,
      index: stepNum,
      total,
      action: entry.action,
      healType: 'form_structure',
    });
    results.push({
      index: stepNum,
      action: entry.action,
      params: entry.params,
      result: msg,
      ok: false,
      id: entry.id,
    });
    return { ok: false, aborted: true, error: msg, results, healed };
  }

  const batchResults = Array.isArray(result?.results) ? result.results : [];
  const row = batchResults[0] || null;
  const report = parseFormStructureResult(row?.result || '');

  // Unsafe scan (missing container / count collapse / mass missing) — fail; never delete or rewrite snapshot
  const safety = assessFormStructureDiffSafety(report, snap);
  if (safety.unsafe) {
    const msg = safety.reason === 'container_not_found'
      ? `form structure: container not found (${report?.container || snap.container || 'unknown'})`
      : `form structure: unsafe diff (${safety.reason}; expected=${report?.expected_count ?? '?'} actual=${report?.count ?? '?'}) — skip mutate`;
    if (stepId != null) {
      try { await markStepReplayFailed(stepId); } catch { /* ignore */ }
    }
    emitReplay('replay:step', tid, {
      stepId,
      status: 'failed',
      error: msg,
      index: stepNum,
      total,
      action: entry.action,
      healType: 'form_structure',
      reason: safety.reason,
    });
    results.push({
      index: stepNum,
      action: entry.action,
      params: entry.params,
      result: msg,
      ok: false,
      id: entry.id,
      healType: 'form_structure',
      reason: safety.reason,
    });
    /* FORM_STRUCTURE_UNSAFE_CONTINUE */
    return { ok: false, aborted: false, error: msg, results, healed };
  }

  if (!needsTypeB(report)) {
    if (stepId != null) {
      try { await markStepReplayOk(stepId); } catch { /* ignore */ }
    }
    emitReplay('replay:step', tid, {
      stepId,
      status: 'success',
      index: stepNum,
      total,
      action: entry.action,
      healType: 'form_structure',
    });
    results.push({
      index: stepNum,
      action: entry.action,
      params: entry.params,
      result: row?.result || 'ok',
      ok: true,
      id: entry.id,
      confirmed: true,
    });
    return { ok: true, aborted: false, results, healed };
  }

  const container = snap.container || entry.params?.container || 'main';
  emitReplay('replay:form_structure', tid, {
    stepId,
    healType: 'form_structure',
    container,
    missing_required: report.missing_required || [],
    missing_optional: report.missing_optional || [],
    added_required: report.added_required || [],
    added_optional: report.added_optional || [],
    hasRequiredChange: !!report.hasRequiredChange,
    hasOptionalChange: !!report.hasOptionalChange,
    reordered: !!report.reordered,
  });

  // Delete missing-label fill steps in same phase
  const missingLabels = new Set([
    ...(report.missing_required || []),
    ...(report.missing_optional || []),
  ]);
  const deletedIds = [];
  if (missingLabels.size) {
    const phaseId = entry.trajectoryPhaseId != null ? Number(entry.trajectoryPhaseId) : null;
    const db = getDB();
    let q = db('trajectory_step').where({ trajectory_id: tid });
    if (Number.isFinite(phaseId) && phaseId > 0) {
      q = q.andWhere({ trajectory_phase_id: phaseId });
    } else if (entry.phaseNumber) {
      q = q.andWhere({ phase_number: Number(entry.phaseNumber) });
    }
    const candidates = await q.select('*');
    for (const r of candidates) {
      const actionType = r.action_type || '';
      if (!FILL_ACTION_TYPES.has(actionType)) continue;
      let params = r.params_json;
      if (typeof params === 'string') {
        try { params = JSON.parse(params); } catch { params = {}; }
      }
      const label = String(params?.label_text || '').trim();
      if (!label || !missingLabels.has(label)) continue;
      const sid = Number(r.id);
      if (sid === stepId) continue; // never delete checkpoint
      await trajectoryStepDao.removeById(sid);
      deletedIds.push(sid);
      skippedIds.add(sid);
      // Also drop from remaining in-memory queue
      for (let j = 0; j < actions.length; j += 1) {
        if (toNumericStepId(actions[j].id) === sid) {
          skippedIds.add(sid);
        }
      }
    }
    if (deletedIds.length) {
      await trajectoryStepDao.reorderByTrajectory(tid);
      const counts = await refreshTrajectoryCounts(tid);
      await trajectoryDao.updateMeta(tid, {
        stepCount: counts.stepCount,
        phaseCount: counts.phaseCount,
      });
    }
  }

  const addingLabels = [
    ...(report.added_required || []),
    ...(report.added_optional || []),
  ];

  if (addingLabels.length) {
    const instruction = buildFormStructureHealInstruction({
      container,
      added_required: report.added_required || [],
      added_optional: report.added_optional || [],
      missing_required: report.missing_required || [],
      missing_optional: report.missing_optional || [],
    });
    broadcast('recording:replay_heal', {
      ...trajScope(tid),
      stepId,
      phase: 'start',
      action: entry.action,
      healType: 'form_structure',
      message: `form structure: fill ${addingLabels.length} added field(s)`,
    });

    try {
      const beforeIds = await peekActionLogIds(runtime);
      await runHealStep(runtime, instruction, FORM_STRUCTURE_HEAL_MAX_STEPS, 'form_structure');
      const afterEntries = await fetchActionLogEntries(runtime);
      const newEntries = afterEntries.filter((e) => {
        const id = e?.id != null ? String(e.id) : '';
        if (!id || beforeIds.has(id)) return false;
        const a = e.action || '';
        if (!FILL_ACTION_TYPES.has(a)) return false;
        const label = String(e.params?.label_text || '').trim();
        return addingLabels.includes(label);
      });

      if (stepId != null && newEntries.length) {
        await insertStepsAfter(stepId, newEntries.map((e) => ({
          actionType: e.action,
          params: e.params || {},
          element: e.element || null,
          source: 'agent',
          confirmed: false,
          trajectoryPhaseId: entry.trajectoryPhaseId ?? null,
          phaseNumber: entry.phaseNumber ?? 0,
        })));
      }

      // Require coverage of added_required at minimum
      const filledLabels = new Set(
        newEntries.map((e) => String(e.params?.label_text || '').trim()).filter(Boolean),
      );
      const missingRequiredAdds = (report.added_required || []).filter((l) => !filledLabels.has(l));
      await markConsumedActionLog(runtime);

      if (missingRequiredAdds.length) {
        const err = `Type B incomplete: missing fills for ${missingRequiredAdds.join(', ')}`;
        broadcast('recording:replay_heal', {
          ...trajScope(tid),
          stepId,
          phase: 'error',
          action: entry.action,
          healType: 'form_structure',
          message: err,
        });
        if (stepId != null) {
          try { await markStepReplayFailed(stepId); } catch { /* ignore */ }
        }
        // Still update snapshot to current DOM truth where possible
        await updateSnapshotFromReport(snap, report).catch(() => null);
        results.push({
          index: stepNum,
          action: entry.action,
          params: entry.params,
          result: err,
          ok: false,
          id: entry.id,
          healType: 'form_structure',
          deletedStepIds: deletedIds,
        });
        return { ok: false, aborted: true, error: err, results, healed };
      }

      broadcast('recording:replay_heal', {
        ...trajScope(tid),
        stepId,
        phase: 'done',
        action: entry.action,
        healType: 'form_structure',
        inserted: newEntries.length,
      });
      healed.push({
        stepId,
        action: entry.action,
        index: stepNum,
        confirmed: false,
        healType: 'form_structure',
        inserted: newEntries.length,
        deletedStepIds: deletedIds,
      });
    } catch (healErr) {
      const msg = healErr?.message || String(healErr);
      if (isUserAbort(healErr) || runtime.abortReplay) {
        broadcast('recording:replay_heal', {
          ...trajScope(tid),
          stepId,
          phase: 'error',
          action: entry.action,
          healType: 'form_structure',
          message: USER_ABORT_CODE,
          aborted: true,
        });
        results.push({
          index: stepNum,
          action: entry.action,
          params: entry.params,
          result: USER_ABORT_CODE,
          ok: false,
          id: entry.id,
          healType: 'form_structure',
          deletedStepIds: deletedIds,
          aborted: true,
        });
        return {
          ok: false,
          aborted: true,
          userAbort: true,
          error: USER_ABORT_CODE,
          results,
          healed,
        };
      }
      broadcast('recording:replay_heal', {
        ...trajScope(tid),
        stepId,
        phase: 'error',
        action: entry.action,
        healType: 'form_structure',
        message: msg,
      });
      if (stepId != null) {
        try { await markStepReplayFailed(stepId); } catch { /* ignore */ }
      }
      results.push({
        index: stepNum,
        action: entry.action,
        params: entry.params,
        result: msg,
        ok: false,
        id: entry.id,
        healType: 'form_structure',
        deletedStepIds: deletedIds,
      });
      return {
        ok: false,
        aborted: true,
        error: `form_structure heal failed: ${msg}`,
        results,
        healed,
      };
    }
  }

  // Update snapshot fields in place to post-heal DOM truth
  await updateSnapshotFromReport(snap, report).catch(() => null);

  if (stepId != null) {
    try { await markStepReplayOk(stepId); } catch { /* ignore */ }
  }
  emitReplay('replay:step', tid, {
    stepId,
    status: 'success',
    index: stepNum,
    total,
    action: entry.action,
    healType: 'form_structure',
    deletedStepIds: deletedIds,
  });
  results.push({
    index: stepNum,
    action: entry.action,
    params: entry.params,
    result: row?.result || 'ok-form-structure-healed',
    ok: true,
    id: entry.id,
    confirmed: true,
    healType: 'form_structure',
    deletedStepIds: deletedIds,
  });
  return { ok: true, aborted: false, results, healed };
}

async function updateSnapshotFromReport(snap, report) {
  if (!snap?.id || !report) return;
  const actualLabels = Array.isArray(report.fields) ? report.fields : [];
  const missing = new Set([
    ...(report.missing_required || []),
    ...(report.missing_optional || []),
  ]);
  const prevByLabel = new Map(
    (snap.fields || []).map((f) => [f.label, !!(f.isRequired ?? f.is_required)]),
  );
  const fields = [];
  for (const label of actualLabels) {
    if (missing.has(label)) continue;
    let isReq = prevByLabel.has(label) ? prevByLabel.get(label) : false;
    if ((report.added_required || []).includes(label)) isReq = true;
    if ((report.added_optional || []).includes(label)) isReq = false;
    fields.push({ label, isRequired: isReq });
  }
  const requiredCount = fields.filter((f) => f.isRequired).length;
  await formSnapshotDao.updateFields(snap.id, {
    fieldCount: fields.length,
    requiredCount,
    optionalCount: fields.length - requiredCount,
    fields,
  });
}

async function peekActionLogIds(runtime) {
  const entries = await fetchActionLogEntries(runtime);
  return new Set(entries.map((e) => (e?.id != null ? String(e.id) : '')).filter(Boolean));
}

async function fetchActionLogEntries(runtime) {
  if (!runtime?.sessionId || !runtime?.executorNodeUuid) return [];
  try {
    const resultP = execSession.waitForSessionEvent(runtime.sessionId, 'get_action_log_result', 5000);
    execSession.forwardStdin({
      nodeUuid: runtime.executorNodeUuid,
      sessionId: runtime.sessionId,
      event: 'get_action_log',
      data: {},
    });
    const result = await resultP.catch(() => null);
    return Array.isArray(result?.entries) ? result.entries : [];
  } catch {
    return [];
  }
}
