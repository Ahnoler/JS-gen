/**
 * 统一的 replay_actions 会话编排：等待 replay_done 完成事件 + 向 executor 会话下发动作 + 结果提取。
 *
 * 取代各调用方复制的
 * `waitForSessionEvent('replay_done') + forwardStdin({ event: 'replay_actions', … })`
 * 样板。调用方只传会话三元组（execSession/sessionId/nodeUuid）与动作参数，
 * 超时、stop_on_fail、is_replay 逐处显式声明；其后的结果判定逻辑（如 okCount>=2）
 * 仍保留在调用方，不在此处复制业务口径。
 *
 * 孤儿 rejection 免疫：内部对等待 promise 预挂 no-op catch——forwardStdin 同步抛错
 * （executor 未连接）时调用方可能永远不 await 等待 promise，孤儿超时 rejection
 * 不能成为 unhandledRejection 打崩进程（2026-08-29 事故根因；executor-event-hub
 * 已在内部预挂，这里对非 hub 的测试替实现再兜一层）。
 */

/**
 * 在 executor 会话上执行一次 replay_actions 并等待其完成。
 * @param {object} opts 参数对象
 * @param {object} opts.execSession executor 会话客户端（需提供 waitForSessionEvent / forwardStdin）
 * @param {string} opts.sessionId executor 会话 id
 * @param {string} opts.nodeUuid executor 节点 UUID
 * @param {Array<object>} opts.actions replay 动作数组（每项形如 { action, params }）
 * @param {number} [opts.timeoutMs] 等待完成事件（与可选错误事件）的超时毫秒数，默认 120000
 * @param {boolean} [opts.stopOnFail] 透传给 replay_actions 的 stop_on_fail，默认 true
 * @param {boolean} [opts.isReplay] 透传给 replay_actions 的 is_replay，默认 true
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
  errorEvent = null,
}) {
  // 1. 先建等待 promise 再下发：保证不会错过 forwardStdin 之后立刻回来的事件。
  const doneP = execSession.waitForSessionEvent(sessionId, 'replay_done', timeoutMs);
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
  execSession.forwardStdin({
    nodeUuid,
    sessionId,
    event: 'replay_actions',
    data: {
      actions,
      is_replay: isReplay,
      stop_on_fail: stopOnFail,
    },
  });

  // 4. errorEvent 时竞速：先结算者为赢，输家经 promise.cancel 释放（清定时器 + 摘监听）。
  let donePayload;
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

  // 5. 统一结果形态；ok/failed/error 的取值口径与既有调用方逐字一致（Number(x||0)）。
  return {
    result: donePayload ?? null,
    results: donePayload?.results || [],
    ok: Number(donePayload?.ok || 0),
    failed: Number(donePayload?.failed || 0),
    error: donePayload?.error || null,
  };
}
