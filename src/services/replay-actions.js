/**
 * 统一的 replay_actions 会话编排：等待 replay_done 完成事件 + 向 executor 会话下发动作 + 结果提取。
 *
 * 取代各调用方复制的
 * `waitForSessionEvent('replay_done') + forwardStdin({ event: 'replay_actions', … })`
 * 样板。调用方只传会话三元组（execSession/sessionId/nodeUuid）与动作参数，
 * 超时、stop_on_fail、is_replay 逐处显式声明；其后的结果判定逻辑（如 okCount>=2）
 * 仍保留在调用方，不在此处复制业务口径。
 *
 * P1-6：每次下发铸造 replayId，Python 回带到 replay_done；等待按归属过滤，避免旧
 * replay 的迟到 done 误满足新等待。超时发 cancel_step 叫停仍在跑的 Python。
 *
 * 孤儿 rejection 免疫：内部对等待 promise 预挂 no-op catch——forwardStdin 同步抛错
 * （executor 未连接）时调用方可能永远不 await 等待 promise，孤儿超时 rejection
 * 不能成为 unhandledRejection 打崩进程（2026-08-29 事故根因；executor-event-hub
 * 已在内部预挂，这里对非 hub 的测试替实现再兜一层）。
 */

import { randomUUID } from 'node:crypto';

/**
 * Decide whether a replay_done payload belongs to the expected replayId.
 * Missing replayId → legacy accept (old Python / executor).
 * @param {object|null|undefined} payload replay_done hub payload
 * @param {string} replayId expected id minted for this wait
 * @returns {{ decision: 'accept'|'ignore'|'legacy', reason: string }} ownership decision
 */
export function replayDoneOwnership(payload, replayId) {
  const got = payload?.replayId ?? payload?.replay_id;
  if (got == null || got === '') {
    return { decision: 'legacy', reason: 'missing_replayid' };
  }
  if (String(got) !== String(replayId)) {
    return { decision: 'ignore', reason: 'replayid_mismatch' };
  }
  return { decision: 'accept', reason: '' };
}

/**
 * Wait for replay_done matching replayId (ignore mismatches; legacy if absent).
 * @param {object} execSession must provide onSessionEvent(sessionId, type, handler) → unsub
 * @param {string} sessionId session id
 * @param {string} replayId expected replay id
 * @param {number} timeoutMs timeout
 * @returns {Promise<object>} matching payload; promise has .cancel()
 */
export function waitForOwnedReplayDone(execSession, sessionId, replayId, timeoutMs) {
  let cancel = () => {};
  const promise = new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    /** @type {(() => void)|null} */
    let unsub = null;
    function finish(fn) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { unsub?.(); } catch {}
      fn();
    }
    unsub = execSession.onSessionEvent(sessionId, 'replay_done', (payload) => {
      const { decision, reason } = replayDoneOwnership(payload, replayId);
      if (decision === 'ignore') {
        console.warn(
          `[replay] replay_done_ignored_${reason} session=${sessionId}`
          + ` got=${payload?.replayId ?? payload?.replay_id} expect=${replayId}`,
        );
        return;
      }
      if (decision === 'legacy') {
        console.warn(
          `[replay] replay_done_missing_replayid session=${sessionId} expect=${replayId}`,
        );
      }
      finish(() => resolve(payload));
    });
    if (timeoutMs != null && Number.isFinite(Number(timeoutMs))) {
      timer = setTimeout(() => {
        finish(() => reject(new Error('Timeout waiting for replay_done')));
      }, Number(timeoutMs));
    }
    cancel = () => finish(() => {});
  });
  promise.cancel = cancel;
  promise.catch(() => {});
  return promise;
}

/**
 * 在 executor 会话上执行一次 replay_actions 并等待其完成。
 * @param {object} opts 参数对象
 * @param {object} opts.execSession executor 会话客户端（需提供 onSessionEvent / waitForSessionEvent / forwardStdin）
 * @param {string} opts.sessionId executor 会话 id
 * @param {string} opts.nodeUuid executor 节点 UUID
 * @param {Array<object>} opts.actions replay 动作数组（每项形如 { action, params }）
 * @param {number} [opts.timeoutMs] 等待完成事件（与可选错误事件）的超时毫秒数，默认 120000
 * @param {boolean} [opts.stopOnFail] 透传给 replay_actions 的 stop_on_fail，默认 true
 * @param {boolean} [opts.isReplay] 透传给 replay_actions 的 is_replay，默认 true
 * @param {boolean} [opts.seedActionLog] 透传 seed_action_log（heal 前缀播种），默认 false
 * @param {string|null} [opts.errorEvent] 可选错误事件通道（如 'replay_error'），默认 null：
 *   提供时与 replay_done 用 Promise.race 竞速，先结算者的 payload 即返回值中的 result；
 *   输家经 promise.cancel 释放（executor-event-hub 的 cancel：清定时器 + 摘监听且不再结算），
 *   .finally 兜底保证拒绝（超时）路径上输家同样被释放。
 * @returns {Promise<{ result: object|null, results: Array<object>, ok: number, failed: number, error: string|null }>}
 *   result 为胜出事件的原始 payload（无 errorEvent 时即 replay_done 载荷）；
 *   results 为其 results 数组（非数组时归一为空数组）；ok / failed 为
 *   Number(payload?.ok||0) / Number(payload?.failed||0)；error 为 payload.error || null。
 * @throws {Error} forwardStdin 同步抛错（executor 未连接）或等待超时（Timeout waiting for …）时原样向上抛
 */
export async function runReplayActions({
  execSession,
  sessionId,
  nodeUuid,
  actions,
  timeoutMs = 120000,
  stopOnFail = true,
  isReplay = true,
  seedActionLog = false,
  errorEvent = null,
}) {
  const replayId = randomUUID();

  // 1. 先建等待 promise 再下发：保证不会错过 forwardStdin 之后立刻回来的事件。
  const doneP = waitForOwnedReplayDone(execSession, sessionId, replayId, timeoutMs);
  // 预挂 no-op catch：send 同步抛错时本 promise 可能永远不被 await，
  // 超时 rejection 不能成为 unhandledRejection（不影响后续正常 await，多消费者各自独立处理）。
  doneP.catch(() => {});

  // 2. 可选错误事件通道：同样先建 + 预挂 no-op。
  let errP = null;
  if (errorEvent) {
    errP = execSession.waitForSessionEvent(sessionId, errorEvent, timeoutMs);
    errP.catch(() => {});
  }

  // 3. 下发 replay_actions；forwardStdin 同步抛错（executor 未连接）会正常向上抛——
  //    此时孤儿等待 promise 已被 no-op catch 免疫。
  try {
    execSession.forwardStdin({
      nodeUuid,
      sessionId,
      event: 'replay_actions',
      data: {
        actions,
        is_replay: isReplay,
        stop_on_fail: stopOnFail,
        seed_action_log: seedActionLog,
        replayId,
      },
    });
  } catch (err) {
    doneP.cancel?.();
    errP?.cancel?.();
    throw err;
  }

  // 4. errorEvent 时竞速：先结算者为赢，输家经 promise.cancel 释放（清定时器 + 摘监听）。
  let donePayload;
  try {
    if (errP) {
      donePayload = await Promise.race([
        doneP.finally(() => {
          errP.cancel?.();
        }),
        errP.finally(() => {
          doneP.cancel?.();
        }),
      ]);
    } else {
      donePayload = await doneP;
    }
  } catch (err) {
    // P1-6：超时后叫停仍在跑的 Python，避免迟到 done 污染下一轮等待。
    if (/Timeout waiting for replay_done/i.test(String(err?.message || err || ''))) {
      try {
        execSession.forwardStdin({
          nodeUuid,
          sessionId,
          event: 'cancel_step',
          data: {},
        });
      } catch {}
    }
    throw err;
  }

  // 5. 统一结果形态；ok/failed/error 的取值口径与既有调用方逐字一致（Number(x||0)）。
  return {
    result: donePayload ?? null,
    results: donePayload?.results || [],
    ok: Number(donePayload?.ok || 0),
    failed: Number(donePayload?.failed || 0),
    error: donePayload?.error || null,
  };
}
