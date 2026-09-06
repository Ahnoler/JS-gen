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
import { runReplayActions } from '../replay-actions.js';
import { REPLAY_STEP_TIMEOUT_MS } from '#config/config.js';
import {
  HEAL_MAX_STEPS,
  USER_ABORT_CODE,
  isUserAbort,
  trajScope,
  emitReplay,
  toNumericStepId,
  runHealStep,
} from './replay-heal-shared.js';
import {
  buildStepHealInstruction,
} from '../../routes/browser-session/heal-instruction.js';
import { buildHealContract } from './heal-contract.js';
import { healDecisionEnabled, routeSuggestedAction } from './heal-decision.js';
import { broadcast } from '../../ws-server.js';
import {
  markConsumedActionLog,
} from './trajectory-runtime.js';
import {
  markStepReplayFailed,
  markStepReplayOk,
} from './trajectory-step-service.js';
import { handleFormStructureCheckpoint } from './form-structure-heal.js';
import * as trajectoryDao from '../../dao/trajectory-dao.js';
import { navigateToFunctionMenu } from './menu-navigation.js';

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

async function forwardReplayEntry(runtime, entry, doSuppress) {
  return runReplayActions({
    execSession,
    sessionId: runtime.sessionId,
    nodeUuid: runtime.executorNodeUuid,
    actions: [entry],
    timeoutMs: REPLAY_STEP_TIMEOUT_MS,
    stopOnFail: true,
    isReplay: doSuppress,
  });
}

/**
 * Run the full replay batch: execute each step, handle Type A heal and Type B form-structure.
 * @param {object} root0 replay batch context
 * @param {number} root0.tid trajectory DB id
 * @param {Array<number>} root0.orderedStepIds ordered step DB ids
 * @param {boolean} root0.doSuppress whether to suppress step persist
 * @param {object} root0.runtime trajectory runtime object
 * @param {object} root0.session executor session state
 * @param {Array<object>} root0.actions action entries to replay
 * @param {Array<object>} root0.rows DB step rows
 * @param {Map<number, object>} root0.snapshotsByTrigger form snapshots keyed by trigger step id
 * @returns {Promise<object>} replay batch result with success/failed counts
 */
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

  // ── 执行前菜单导航（同菜单跳过/空菜单直接执行/失败不阻断）──
  try {
    const trajRow = await trajectoryDao.getById(tid);
    if (trajRow?.functionId) {
      const nav = await navigateToFunctionMenu({ runtime, functionId: Number(trajRow.functionId), execSession });
      if (!nav.navigated) console.log(`[menu-nav] skip: ${nav.reason}`);
    }
  } catch (navErr) {
    console.warn(`[menu-nav] unexpected: ${navErr?.message || navErr}`);
  }

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
        /* FORM_STRUCTURE_SOFT_FAIL_CONTINUE */
        if (!typeB.ok && !typeB.aborted) {
          if (stepId != null) failedStepIds.push(stepId);
          allResults.push(...typeB.results);
          if (typeB.healed) healed.push(...typeB.healed);
          continue;
        }
        if (typeB.ok) successCount += 1;
        allResults.push(...typeB.results);
        if (typeB.healed) healed.push(...typeB.healed);
        continue;
      }

      let result;
      try {
        result = await runReplayActions({
          execSession,
          sessionId: runtime.sessionId,
          nodeUuid: runtime.executorNodeUuid,
          actions: [entry],
          timeoutMs: REPLAY_STEP_TIMEOUT_MS,
          stopOnFail: true,
          isReplay: doSuppress,
        });
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
        const previousAction = i > 0 ? actions[i - 1]?.action || '' : '';
        const contract = buildHealContract({
          failedEntry: entry,
          errorResult: failResult,
          healType: 'step',
          maxSteps: HEAL_MAX_STEPS,
          retryCount: 1,
          context: { previousAction },
        });
        const instruction = buildStepHealInstruction(entry, failResult, { contract });
        const route = routeSuggestedAction({
          suggestedAction: contract.reason.suggestedAction,
          enabled: healDecisionEnabled(),
        });

        if (route === 'skip') {
          broadcast('recording:replay_heal', {
            ...trajScope(tid),
            stepId,
            phase: 'done',
            action: entry.action,
            message: `skip-by-decision (was: ${failResult})`,
            confirmed: false,
            healType: 'step',
            decision: 'skip',
          });
          const last = allResults[allResults.length - 1];
          if (last) {
            last.decision = 'skip';
            last.result = `skipped-by-decision (was: ${failResult})`;
          }
          continue;
        }

        if (route === 'fail') {
          const msg = `heal decision: fail (${contract.reason.category}) for step ${stepNum} (${entry.action})`;
          broadcast('recording:replay_heal', {
            ...trajScope(tid),
            stepId,
            phase: 'error',
            action: entry.action,
            message: msg,
            confirmed: false,
            healType: 'step',
            decision: 'fail',
          });
          emitReplay('replay:finished', tid, {
            successCount,
            failedCount: failedStepIds.length,
            failedStepIds: [...new Set(failedStepIds)],
            error: msg,
            healType: 'step',
          });
          return buildPayload(tid, doSuppress, rows, allResults, healed, msg, {
            successCount,
            failedCount: failedStepIds.length,
            failedStepIds: [...new Set(failedStepIds)],
          });
        }

        if (route === 'retry') {
          const retryLimit = Math.max(1, Math.min(Number(contract.runtime?.retry_count) || 1, 3));
          let retriedOk = false;
          let retryResultText = String(failResult);
          for (let attempt = 0; attempt < retryLimit; attempt += 1) {
            if (runtime.abortReplay) break;
            try {
              const retryDone = await forwardReplayEntry(runtime, entry, doSuppress);
              await markConsumedActionLog(runtime);
              const retryResults = Array.isArray(retryDone?.results) ? retryDone.results : [];
              const retryRow = retryResults[0] || null;
              retriedOk = Number(retryDone?.failed || 0) === 0
                && (retryRow ? !!retryRow.ok : Number(retryDone?.ok || 0) > 0);
              retryResultText = retryRow?.result || retryDone?.error || String(failResult);
              if (retriedOk) break;
            } catch (retryErr) {
              retriedOk = false;
              retryResultText = retryErr?.message || String(retryErr);
            }
          }

          if (retriedOk) {
            if (stepId != null) {
              try { await markStepReplayOk(stepId); } catch { /* ignore */ }
              const failedIndex = failedStepIds.indexOf(stepId);
              if (failedIndex !== -1) failedStepIds.splice(failedIndex, 1);
            }
            successCount += 1;
            emitReplay('replay:step', tid, {
              stepId,
              status: 'success',
              index: stepNum,
              total: actions.length,
              action: entry.action,
              decision: 'retry',
            });
            const last = allResults[allResults.length - 1];
            if (last) {
              last.ok = true;
              last.confirmed = true;
              last.decision = 'retry';
              last.result = `retried-ok (was: ${failResult})`;
            }
            broadcast('recording:replay_heal', {
              ...trajScope(tid),
              stepId,
              phase: 'done',
              action: entry.action,
              confirmed: false,
              healType: 'step',
              decision: 'retry',
            });
            continue;
          }

          if (!runtime.abortReplay) {
            const last = allResults[allResults.length - 1];
            if (last) {
              last.retried = true;
              last.result = `retry-failed (was: ${failResult}; last: ${retryResultText})`;
            }
          }
        }

        await runHealStep(runtime, instruction, HEAL_MAX_STEPS, 'step', contract);
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
