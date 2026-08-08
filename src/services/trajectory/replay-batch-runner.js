/**
 * Replay batch runner — drives re-execution of recorded steps in a live executor
 * session, including Type A single-step AI heal and Type B form-structure
 * checkpoints (extracted from trajectory-session-replay.js — move-only).
 *
 * Product contract (Recording Studio):
 * - WS: replay:started → replay:step / replay:form_structure → replay:finished
 * - Type A: locator/action fail → confirmed=0 → single-step AI heal → continue
 * - Type B: save_form_snapshot checkpoint → verifyFormStructure → delete missing /
 *   AI-fill adding + structured insert (confirmed=0, next batch) — healType=form_structure
 */
import * as execSession from '../../executor-session-client.js';
import * as memoryService from '../../memory/memory-service.js';
import {
  buildStepHealInstruction,
} from '../../routes/browser-session/heal-instruction.js';
import { broadcast } from '../../ws-server.js';
import {
  markConsumedActionLog,
} from '../trajectory-runtime.js';
import {
  markStepReplayFailed,
  markStepReplayOk,
} from '../trajectory-step-service.js';
import { handleFormStructureCheckpoint } from './form-structure-heal.js';

const REPLAY_TIMEOUT_MS = 300000;
const HEAL_TIMEOUT_MS = 300000;
/** Enough room to redo one failed action only (no extra form diagnosis). */
const HEAL_MAX_STEPS = 12;

/** Sentinel: user stopped replay/heal via cancel_step / steps/replay/stop. */
const USER_ABORT_CODE = 'USER_ABORT';

function makeUserAbortError() {
  const err = new Error(USER_ABORT_CODE);
  err.code = USER_ABORT_CODE;
  return err;
}

function isUserAbort(err) {
  if (!err) return false;
  if (err.code === USER_ABORT_CODE) return true;
  const msg = String(err.message || err || '');
  return msg === USER_ABORT_CODE || /USER_ABORT|Replay aborted/i.test(msg);
}

function emitReplayAborted(tid, { successCount = 0, failedStepIds = [] } = {}) {
  const uniqueFailed = [...new Set(failedStepIds)];
  emitReplay('replay:finished', tid, {
    successCount,
    failedCount: uniqueFailed.length,
    failedStepIds: uniqueFailed,
    aborted: true,
    reason: 'user_stop',
    error: null,
  });
}

function trajScope(tid) {
  return { trajectoryId: tid, trajectoryDbId: tid };
}

function emitReplay(type, tid, extra = {}) {
  broadcast(type, { ...trajScope(tid), ...extra });
}

function toNumericStepId(id) {
  if (id == null || id === '') return null;
  const n = Number(id);
  return Number.isFinite(n) ? n : null;
}

export async function runReplayBatch({
  tid,
  orderedStepIds,
  doSuppress,
  runtime,
  session,
  actions,
  rows,
  snapshotsByTrigger,
}) {
  const allResults = [];
  const healed = [];
  const failedStepIds = [];
  let successCount = 0;
  /** @type {Set<number>} step ids removed mid-batch (Type B missing) */
  const skippedIds = new Set();

  emitReplay('replay:started', tid, { stepIds: orderedStepIds });

  try {
    for (let i = 0; i < actions.length; i += 1) {
      if (runtime.abortReplay) {
        emitReplayAborted(tid, { successCount, failedStepIds });
        return buildPayload(tid, doSuppress, rows, allResults, healed, null, {
          successCount,
          failedCount: [...new Set(failedStepIds)].length,
          failedStepIds: [...new Set(failedStepIds)],
          aborted: true,
          reason: 'user_stop',
        });
      }

      const entry = actions[i];
      const stepId = toNumericStepId(entry.id);
      if (stepId != null && skippedIds.has(stepId)) continue;

      const stepNum = i + 1;

      emitReplay('replay:step', tid, {
        stepId,
        status: 'running',
        index: stepNum,
        total: actions.length,
        action: entry.action,
      });

      // ── Type B: form structure checkpoint (before Type A) ──
      if (entry.action === 'save_form_snapshot') {
        const typeB = await handleFormStructureCheckpoint({
          tid,
          runtime,
          doSuppress,
          entry,
          stepId,
          stepNum,
          total: actions.length,
          actions,
          skippedIds,
          snapshotsByTrigger,
        });
        if (typeB.userAbort || isUserAbort(typeB.error)) {
          allResults.push(...typeB.results);
          emitReplayAborted(tid, { successCount, failedStepIds });
          return buildPayload(tid, doSuppress, rows, allResults, healed, null, {
            successCount,
            failedCount: [...new Set(failedStepIds)].length,
            failedStepIds: [...new Set(failedStepIds)],
            aborted: true,
            reason: 'user_stop',
          });
        }
        if (typeB.aborted) {
          if (stepId != null) failedStepIds.push(stepId);
          allResults.push(...typeB.results);
          emitReplay('replay:finished', tid, {
            successCount,
            failedCount: failedStepIds.length,
            failedStepIds: [...new Set(failedStepIds)],
            error: typeB.error,
            healType: 'form_structure',
          });
          return buildPayload(tid, doSuppress, rows, allResults, healed, typeB.error, {
            successCount,
            failedCount: failedStepIds.length,
            failedStepIds: [...new Set(failedStepIds)],
          });
        }
        if (typeB.ok) successCount += 1;
        allResults.push(...typeB.results);
        if (typeB.healed) healed.push(...typeB.healed);
        continue;
      }

      let result;
      try {
        const doneP = execSession.waitForSessionEvent(runtime.sessionId, 'replay_done', REPLAY_TIMEOUT_MS);
        execSession.forwardStdin({
          nodeUuid: runtime.executorNodeUuid,
          sessionId: runtime.sessionId,
          event: 'replay_actions',
          data: {
            actions: [entry],
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
          failedStepIds.push(stepId);
        }
        emitReplay('replay:step', tid, {
          stepId,
          status: 'failed',
          error: msg,
          index: stepNum,
          total: actions.length,
          action: entry.action,
        });
        allResults.push({
          index: stepNum,
          action: entry.action,
          params: entry.params,
          result: msg,
          ok: false,
          id: entry.id,
        });
        emitReplay('replay:finished', tid, {
          successCount,
          failedCount: failedStepIds.length,
          failedStepIds: [...new Set(failedStepIds)],
          error: msg,
        });
        return buildPayload(tid, doSuppress, rows, allResults, healed, msg, {
          successCount,
          failedCount: failedStepIds.length,
          failedStepIds: [...new Set(failedStepIds)],
        });
      }

      if (runtime.abortReplay) {
        emitReplayAborted(tid, { successCount, failedStepIds });
        return buildPayload(tid, doSuppress, rows, allResults, healed, null, {
          successCount,
          failedCount: [...new Set(failedStepIds)].length,
          failedStepIds: [...new Set(failedStepIds)],
          aborted: true,
          reason: 'user_stop',
        });
      }

      const batchResults = Array.isArray(result?.results) ? result.results : [];
      const row = batchResults[0] || null;
      const ok = Number(result?.failed || 0) === 0 && (row ? !!row.ok : Number(result?.ok || 0) > 0);
      const failResult = row?.result || result?.error || 'unknown';

      if (ok) {
        successCount += 1;
        if (stepId != null) {
          try { await markStepReplayOk(stepId); } catch { /* ignore */ }
        }
        emitReplay('replay:step', tid, {
          stepId,
          status: 'success',
          index: stepNum,
          total: actions.length,
          action: entry.action,
        });
        allResults.push({
          index: stepNum,
          action: entry.action,
          params: entry.params,
          result: row?.result || 'ok',
          ok: true,
          id: entry.id,
          confirmed: true,
        });
        continue;
      }

      // Type A — single-step heal
      if (stepId != null) {
        try { await markStepReplayFailed(stepId); } catch { /* ignore */ }
        failedStepIds.push(stepId);
      }
      emitReplay('replay:step', tid, {
        stepId,
        status: 'failed',
        error: String(failResult),
        index: stepNum,
        total: actions.length,
        action: entry.action,
        healType: 'step',
      });
      allResults.push({
        index: stepNum,
        action: entry.action,
        params: entry.params,
        result: failResult,
        ok: false,
        id: entry.id,
        confirmed: false,
      });

      broadcast('recording:replay_heal', {
        ...trajScope(tid),
        stepId,
        phase: 'start',
        action: entry.action,
        message: String(failResult),
        confirmed: false,
        healType: 'step',
      });

      try {
        const instruction = buildStepHealInstruction(entry, failResult);
        await runHealStep(runtime, instruction, HEAL_MAX_STEPS, 'step');
        await markConsumedActionLog(runtime);
        if (runtime.abortReplay) {
          broadcast('recording:replay_heal', {
            ...trajScope(tid),
            stepId,
            phase: 'error',
            action: entry.action,
            message: USER_ABORT_CODE,
            confirmed: false,
            healType: 'step',
            aborted: true,
          });
          emitReplayAborted(tid, { successCount, failedStepIds });
          return buildPayload(tid, doSuppress, rows, allResults, healed, null, {
            successCount,
            failedCount: [...new Set(failedStepIds)].length,
            failedStepIds: [...new Set(failedStepIds)],
            aborted: true,
            reason: 'user_stop',
          });
        }
        broadcast('recording:replay_heal', {
          ...trajScope(tid),
          stepId,
          phase: 'done',
          action: entry.action,
          confirmed: false,
          healType: 'step',
        });
        healed.push({
          stepId,
          action: entry.action,
          index: stepNum,
          confirmed: false,
          healType: 'step',
        });
        const last = allResults[allResults.length - 1];
        if (last) {
          last.healed = true;
          last.result = `healed-by-ai (was: ${failResult})`;
        }
      } catch (healErr) {
        const msg = healErr?.message || String(healErr);
        if (isUserAbort(healErr) || runtime.abortReplay) {
          broadcast('recording:replay_heal', {
            ...trajScope(tid),
            stepId,
            phase: 'error',
            action: entry.action,
            message: USER_ABORT_CODE,
            confirmed: false,
            healType: 'step',
            aborted: true,
          });
          emitReplayAborted(tid, { successCount, failedStepIds });
          return buildPayload(tid, doSuppress, rows, allResults, healed, null, {
            successCount,
            failedCount: [...new Set(failedStepIds)].length,
            failedStepIds: [...new Set(failedStepIds)],
            aborted: true,
            reason: 'user_stop',
          });
        }
        broadcast('recording:replay_heal', {
          ...trajScope(tid),
          stepId,
          phase: 'error',
          action: entry.action,
          message: msg,
          confirmed: false,
          healType: 'step',
        });
        emitReplay('replay:finished', tid, {
          successCount,
          failedCount: failedStepIds.length,
          failedStepIds: [...new Set(failedStepIds)],
          error: `AI heal failed for step ${stepNum} (${entry.action}): ${msg}`,
          healType: 'step',
        });
        return buildPayload(
          tid,
          doSuppress,
          rows,
          allResults,
          healed,
          `AI heal failed for step ${stepNum} (${entry.action}): ${msg}`,
          {
            successCount,
            failedCount: failedStepIds.length,
            failedStepIds: [...new Set(failedStepIds)],
          },
        );
      }
    }

    const uniqueFailed = [...new Set(failedStepIds)];
    emitReplay('replay:finished', tid, {
      successCount,
      failedCount: uniqueFailed.length,
      failedStepIds: uniqueFailed,
    });

    return buildPayload(tid, doSuppress, rows, allResults, healed, null, {
      successCount,
      failedCount: uniqueFailed.length,
      failedStepIds: uniqueFailed,
    });
  } finally {
    runtime.suppressStepPersist = false;
    runtime.isReplay = false;
    runtime.formStructureHealLabels = null;
    runtime.abortReplay = false;
    if (session) session.busy = false;
  }
}

function buildPayload(tid, doSuppress, rows, allResults, healed, error, counts = {}) {
  const okCount = allResults.filter((r) => r.ok && !r.healed).length;
  const failCount = allResults.filter((r) => !r.ok || r.healed || r.confirmed === false).length;
  return {
    trajectoryId: tid,
    trajectoryDbId: tid,
    isReplay: doSuppress,
    stepIds: rows.map((r) => r.id),
    count: allResults.length,
    ok: counts.successCount ?? okCount,
    failed: counts.failedCount ?? failCount,
    successCount: counts.successCount ?? okCount,
    failedCount: counts.failedCount ?? failCount,
    failedStepIds: counts.failedStepIds || [],
    error: counts.aborted ? null : (error || null),
    aborted: !!counts.aborted,
    reason: counts.reason || null,
    healed: Array.isArray(healed) ? healed : [],
    results: allResults,
  };
}

async function runHealStep(runtime, instruction, maxSteps = HEAL_MAX_STEPS, healType = 'step') {
  // P2-1: record replay-heal decision (deterministic instruction template, not LLM-generated)
  try {
    await memoryService.ingestEvents([{
      eventType: 'decision',
      trajectoryId: runtime.trajectoryDbId ?? runtime.trajectoryId ?? null,
      sessionId: runtime.sessionId,
      payload: { kind: 'heal', healType },
      decision: {
        decisionType: 'heal',
        model: '',
        temperature: 0.0,
        inputPreview: String(instruction || '').slice(0, 500),
        outputJson: { healType, maxSteps },
        policyChecks: [{ check: 'instruction_present', pass: Boolean(instruction) }],
        auditStatus: instruction ? 'passed' : 'failed',
      },
    }]);
  } catch (err) {
    console.warn('[replay] heal decision ingest skipped:', err?.message || err);
  }

  await new Promise((resolve, reject) => {
    let settled = false;
    let sawAgentStopped = false;

    const rejectAbort = () => {
      cleanup();
      reject(makeUserAbortError());
    };

    const unsubDone = execSession.onSessionEvent(runtime.sessionId, 'phase_done', () => {
      if (settled) return;
      if (runtime.abortReplay || sawAgentStopped) {
        rejectAbort();
        return;
      }
      cleanup();
      resolve();
    });
    const unsubErr = execSession.onSessionEvent(runtime.sessionId, 'phase_error', (payload) => {
      if (settled) return;
      if (runtime.abortReplay || sawAgentStopped) {
        rejectAbort();
        return;
      }
      cleanup();
      reject(new Error(payload?.message || 'phase_error'));
    });
    const unsubStopped = execSession.onSessionEvent(runtime.sessionId, 'agent_stopped', () => {
      if (settled) return;
      sawAgentStopped = true;
      runtime.abortReplay = true;
      rejectAbort();
    });
    const timer = setTimeout(() => {
      if (settled) return;
      if (runtime.abortReplay || sawAgentStopped) {
        rejectAbort();
        return;
      }
      cleanup();
      reject(new Error('Timeout waiting for heal phase_done'));
    }, HEAL_TIMEOUT_MS);

    function cleanup() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { unsubDone(); } catch { /* ignore */ }
      try { unsubErr(); } catch { /* ignore */ }
      try { unsubStopped(); } catch { /* ignore */ }
    }

    if (runtime.abortReplay) {
      rejectAbort();
      return;
    }

    execSession.forwardStdin({
      nodeUuid: runtime.executorNodeUuid,
      sessionId: runtime.sessionId,
      event: 'step',
      data: {
        instruction,
        max_steps: maxSteps,
        phase_number: 0,
        heal_type: healType,
        healType,
      },
    });
  });
}
