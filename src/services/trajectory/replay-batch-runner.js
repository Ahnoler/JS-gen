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
import { isMetaStepAction } from '../../models/meta-step-actions.js';
import * as trajectoryDao from '../../dao/trajectory-dao.js';
import { navigateToFunctionMenu } from './menu-navigation.js';

/**
 * 为用户中止的批处理发送终态回放事件。失败步骤 ID 会去重，使事件反映逻辑失败，
 * 而非重复的记账条目。
 * @param {number} tid 交易数据库 ID
 * @param {object} [options] 部分回放计数器
 * @param {number} [options.successCount] 已完成的成功步骤数
 * @param {Array<number>} [options.failedStepIds] 失败步骤 ID
 * @returns {void}
 */
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

/**
 * 用 `***` 替换文本中出现的凭据明文（auth 轨迹的账号/密码）。与
 * `maskTrajectoryStepSecrets` 同口径：按精确值替换，不做正则猜测。
 * @param {string} text 原始文本
 * @param {Array<string>} secrets 需掩码的明文值列表
 * @returns {string} 掩码后的文本
 */
function redactSecrets(text, secrets) {
  let out = String(text ?? '');
  for (const s of secrets || []) {
    const v = String(s ?? '');
    if (v.length < 2 || !out.includes(v)) continue;
    out = out.split(v).join('***');
  }
  return out;
}

/**
 * 汇总单条回放动作的可读描述（动作名 + 关键参数），用于回放计划日志。
 * @param {object} entry 动作条目
 * @param {number} index 0-based 下标
 * @returns {string} 形如 `1. fill_form_field (id=12) {label=客户名称, value=张三}`
 */
function describeReplayStep(entry, index) {
  const p = entry?.params || {};
  const fields = [
    ['label_text', 'label'],
    ['value', 'value'],
    ['option_text', 'option'],
    ['button_text', 'button'],
    ['menu_text', 'menu'],
    ['tab_name', 'tab'],
    ['row_text', 'row'],
    ['text', 'text'],
    ['url', 'url'],
  ];
  const bits = [];
  for (const [key, label] of fields) {
    const v = p[key];
    if (v === undefined || v === null || v === '') continue;
    bits.push(`${label}=${String(v)}`);
  }
  const idPart = entry?.id != null ? ` (id=${entry.id})` : '';
  const suffix = bits.length ? ` {${bits.join(', ')}}` : '';
  return `${index + 1}. ${entry?.action || '?'}${idPart}${suffix}`;
}

/**
 * 回放开始前一次性打印本次要执行的步骤清单：控制面控制台一份，并通过
 * `replay_plan` 事件送给执行机在 stderr 打印一份（执行机逐条下发
 * `replay_actions`，无法自行汇总整批，故由控制面在开跑前提供完整计划）。
 * @param {number} tid 交易数据库 ID
 * @param {Array<number>} orderedStepIds 有序步骤 ID
 * @param {Array<object>} actions 动作条目
 * @param {object} runtime 带执行机会话标识的交易运行时
 * @param {Array<string>} [secretValues] 需掩码的凭据明文（auth 轨迹账号/密码）
 * @returns {void}
 */
function logReplayPlan(tid, orderedStepIds, actions, runtime, secretValues = []) {
  // Mask resolved auth credentials: prepareReplayBatch restores
  // __AUTH_PASSWORD__ before the plan is built, so raw params would leak the
  // plaintext password to the control-plane console and executor stderr.
  const lines = actions.map((a, i) => redactSecrets(describeReplayStep(a, i), secretValues));
  console.log(
    `[replay-batch] traj=${tid} 共 ${actions.length} 步 stepIds=[${orderedStepIds.join(',')}]\n`
    + lines.map((l) => `  ${l}`).join('\n'),
  );
  if (!runtime?.sessionId || !runtime?.executorNodeUuid) return;
  try {
    execSession.forwardStdin({
      nodeUuid: runtime.executorNodeUuid,
      sessionId: runtime.sessionId,
      event: 'replay_plan',
      // secretValues lets the executor redact its per-step stderr log too.
      data: { trajectoryId: tid, steps: lines, secretValues: secretValues || [] },
    });
  } catch (err) {
    console.warn(`[replay-batch] replay_plan forward failed: ${err?.message || err}`);
  }
}

/**
 * 使用回放超时语义将一条已录制操作转发给执行机。
 * @param {object} runtime 带执行机会话标识的交易运行时
 * @param {object} entry 已录制的操作条目
 * @param {boolean} doSuppress 是否应抑制回放持久化
 * @returns {Promise<object>} 执行机对该单个操作的回放结果
 */
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
 * @param {Array<string>} [root0.secretValues] resolved auth credentials to redact from logs
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
  secretValues = [],
}) {
  const allResults = [];
  const healed = [];
  const failedStepIds = [];
  let successCount = 0;
  /** @type {Set<number>} step ids removed mid-batch (Type B missing) */
  const skippedIds = new Set();

  emitReplay('replay:started', tid, { stepIds: orderedStepIds });
  logReplayPlan(tid, orderedStepIds, actions, runtime, secretValues);

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
      // Auto-injected meta checkpoints (prepareReplayBatch fills the selected
      // range with META_STEP_ACTIONS) must not inflate the user-facing step
      // counts: the product lists/counts only business steps. A meta checkpoint
      // success stays silent; a meta checkpoint failure still counts as failed.
      const entryIsMeta = isMetaStepAction(entry.action);
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
        if (typeB.ok && !entryIsMeta) successCount += 1;
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
        // #4 stop×步超时竞态：stop 置位与步超时撞车时（runReplayActions 已补发
        // cancel_step 并 reject），用户预期终态是 aborted 而非 {error}——本步确已
        // 失败，上方 markStepReplayFailed / failedStepIds / allResults 落库口径
        // 不变，步级 failed 终态事件已发；这里只把批级终态收敛为 emitReplayAborted
        // + aborted 载荷（对齐循环头中止分支的载荷形状）。
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
        // #12 中止步终态：本步 running 已广播、replay_done 已成功返回，但 abort
        // 使下方 status:'success' 终态不可达——补发 failed 终态（error=user_stop
        // + aborted 标记），前端条目不再悬挂在 running。结果按中止口径丢弃：不计
        // successCount、不入 allResults/failedStepIds（对齐既有 mid-batch abort pin）。
        emitReplay('replay:step', tid, {
          stepId,
          status: 'failed',
          error: 'user_stop',
          index: stepNum,
          total: actions.length,
          action: entry.action,
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

      const batchResults = Array.isArray(result?.results) ? result.results : [];
      const row = batchResults[0] || null;
      const ok = Number(result?.failed || 0) === 0 && (row ? !!row.ok : Number(result?.ok || 0) > 0);
      const failResult = row?.result || result?.error || 'unknown';

      if (ok) {
        if (!entryIsMeta) successCount += 1;
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
            successCount += entryIsMeta ? 0 : 1;
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

/**
 * 组装回放完成、失败或用户取消后返回的稳定响应载荷，将原始结果与汇总计数器结合。
 * @param {number} tid 交易数据库 ID
 * @param {boolean} doSuppress 是否抑制了回放持久化
 * @param {Array<object>} rows 用于 stepIds 的持久化步骤行
 * @param {Array<object>} allResults 各操作的回放结果
 * @param {Array<object>} healed 由 AI 修复处理的操作
 * @param {string|null} error 终态错误消息
 * @param {object} [counts] 部分或中止运行的显式计数器
 * @returns {object} 回放 API 结果载荷
 */
function buildPayload(tid, doSuppress, rows, allResults, healed, error, counts = {}) {
  // Meta checkpoints (auto-injected save_form_snapshot / scan_* / task_* …) are
  // hidden internal steps: exclude their successes from the user-facing counts
  // and `count`, but keep their failures in `failCount` (a broken checkpoint is
  // still surfaced). Explicit `counts.*` win, as before.
  const businessResults = allResults.filter((r) => !isMetaStepAction(r.action));
  const okCount = businessResults.filter((r) => r.ok && !r.healed).length;
  const failCount = allResults.filter((r) => !r.ok || r.healed || r.confirmed === false).length;
  return {
    trajectoryId: tid,
    trajectoryDbId: tid,
    isReplay: doSuppress,
    stepIds: rows.map((r) => r.id),
    count: businessResults.length,
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
