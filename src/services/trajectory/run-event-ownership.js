/**
 * Run-scoped event ownership for AI recording (phase_done 跨 run 串台修复，
 * spec: docs/spec-phase-done-cross-run-fix.md)。
 *
 * 每轮录制生成 runId 随 step 下发，执行机回带；控制面按归属过滤事件。
 * 兼容规则：payload 无 runId 字段 → legacy 放行（旧执行机）；不匹配才丢。
 */
/** @typedef {{ decision: 'accept'|'ignore'|'legacy', reason: string }} OwnershipVerdict */

/**
 * Judge whether an executor session event belongs to the current recording run.
 * @param {object|null} payload event payload (runId / phase / canceled fields)
 * @param {{ runId: string|null, phaseNumber?: number|null }} opts - current run id; phaseNumber given only for phase_done/phase_error waits (null for persist events)
 * @returns {OwnershipVerdict} accept = ours; ignore = foreign/filtered; legacy = old executor (allow)
 */
export function phaseEventOwnership(payload, { runId, phaseNumber = null } = {}) {
  const pRunId = payload?.runId;
  // phase 校验先于 legacy 放行（终审 M1）：phase 号只收窄接受面、零兼容成本——
  // 否则旧执行机（payload 无 runId）的僵尸 phase_done（错误阶段号）仍会被误吃，
  // 即原缺陷 B 场景在兼容期复活。
  if (phaseNumber != null && Number(payload?.phase) !== Number(phaseNumber)) {
    return { decision: 'ignore', reason: 'phase_mismatch' };
  }
  if (pRunId == null || pRunId === '') {
    return { decision: 'legacy', reason: 'missing_runid' };
  }
  if (runId != null && String(pRunId) !== String(runId)) {
    return { decision: 'ignore', reason: 'runid_mismatch' };
  }
  return { decision: 'accept', reason: '' };
}

/**
 * Wait for the next OWNED session event (ownership-filtered waitForSessionEvent).
 * Foreign payloads (runid/phase mismatch) are ignored with onIgnored logging; a
 * payload flagged `canceled: true` is ignored too (spec 4.3.2: canceled phase_done
 * 不计入阶段完成). Legacy payloads (no runId, old executor) resolve per spec 4.4
 * 兼容期放行, with an onIgnored observation log.
 * No timeout here — the caller's idle watchdog is the only timeout (runner race).
 * @param {{ addListener: (type: string, handler: (payload: object) => void) => () => void,
 *           type: string, runId: string|null, phaseNumber?: number|null,
 *           onIgnored?: (payload: object, reason: string) => void }} opts - wait options: session listener factory, event type, current run id, expected phase (null for persist waits), ignored-event logger
 * @returns {Promise<object>} first owned payload; promise.cancel() detaches silently
 */
export function waitForSessionEventOwned({ addListener, type, runId, phaseNumber = null, onIgnored }) {
  let cancel = () => {};
  let settled = false;
  const promise = new Promise((resolve) => {
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const unsub = addListener(type, (payload) => {
      const own = phaseEventOwnership(payload, { runId, phaseNumber });
      if (own.decision === 'ignore') {
        onIgnored?.(payload, own.reason);
        return;
      }
      if (own.decision === 'legacy') {
        onIgnored?.(payload, own.reason); // phase_done_missing_runid observation log (spec 4.4)
      }
      if (payload?.canceled === true) {
        onIgnored?.(payload, 'canceled');
        return;
      }
      unsub();
      settle(payload);
    });
    // cancel silently discards the wait (no rejection); settle(undefined) so a
    // late `await` does not hang (differs from waitForSessionEvent, which stays pending).
    cancel = () => {
      unsub();
      settle(undefined);
    };
  });
  promise.cancel = cancel;
  promise.catch(() => {});
  return promise;
}
