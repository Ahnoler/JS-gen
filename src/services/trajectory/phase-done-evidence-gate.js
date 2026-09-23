/**
 * G3 control-plane helpers: reject zero-step fake phase_done success and
 * aggregate trajectory isSuccessful from per-phase outcomes.
 */
import { META_STEP_ACTIONS } from '../../models/meta-step-actions.js';

/**
 * Count business (non-meta) steps in a step list.
 * @param {Array<{ actionType?: string, action_type?: string }>} steps step rows
 * @param {readonly string[]} [metaActions] meta action names to exclude
 * @returns {number} business step count
 */
export function countBusinessSteps(steps, metaActions = META_STEP_ACTIONS) {
  const meta = new Set(metaActions || []);
  let n = 0;
  for (const s of steps || []) {
    const action = String(s?.actionType || s?.action_type || '').trim();
    if (!action || meta.has(action)) continue;
    n += 1;
  }
  return n;
}

/**
 * If agent claimed success with zero business steps, override to failure.
 * @param {{ stepCount: number, donePayload?: object|null }} args gate inputs
 * @returns {{ success: boolean|null, text: string, rejectedZeroStep: boolean }} gated outcome
 */
export function applyZeroStepFakeSuccessGate({ stepCount, donePayload }) {
  const explicitSuccess = donePayload?.success === true || donePayload?.success === false
    ? donePayload.success
    : null;
  const textFromDone = String(donePayload?.text || donePayload?.summary || '').trim();
  const baseText = textFromDone
    || (explicitSuccess == null ? '见页面当前状态' : String(donePayload?.name || '').trim())
    || '见页面当前状态';

  if (Number(stepCount) === 0 && explicitSuccess === true) {
    return {
      success: false,
      text: `zero_step_rejected: ${baseText}`.slice(0, 500),
      rejectedZeroStep: true,
    };
  }
  return {
    success: explicitSuccess,
    text: baseText,
    rejectedZeroStep: false,
  };
}

/**
 * Aggregate trajectory isSuccessful from phase outcomes.
 * Any explicit false → false; otherwise true (null/unknown does not block success).
 * G3 pin: zero-step fake success is rewritten to false before aggregation.
 * @param {Record<string|number, { success?: boolean|null }>|null|undefined} phaseOutcomes per-phase outcomes
 * @returns {boolean} trajectory isSuccessful
 */
export function aggregateTrajectorySuccessful(phaseOutcomes) {
  const byRef = new Set();
  for (const outcome of Object.values(phaseOutcomes || {})) {
    if (!outcome || typeof outcome !== 'object') continue;
    if (byRef.has(outcome)) continue;
    byRef.add(outcome);
    if (outcome.success === false) return false;
  }
  return true;
}

/**
 * 阶段收尾判定（假成功防线 v1 阶段级，从 recordPhaseResult 内联逻辑收敛）：
 * 解析 phase_done 负载为 phaseOutcome 形状——0 落库步阶段自报 success=true 时
 * 降级 unknown（success=null）并加 `[0步完成]` 前缀；纯判定无副作用，调用方
 * （runner）负责 perRunZeroSuccessPhases 登记、appendPhaseDoneLog、DAO 写入。
 *
 * 行为等价契约（characterize-phase-done-evidence-gate.mjs 钉死）：
 * - success 字段：zeroStep && explicitSuccess===true → null；否则 explicitSuccess
 *   （仅显式 true/false，缺失 → null unknown）。
 * - text 字段：zeroStep 时加 `[0步完成] ` 前缀；文本源优先级 text/summary →
 *   （success 缺失时 name）→ '见页面当前状态'，与旧内联三元逐字一致。
 *
 * 零步 navigate 豁免（A/B 移交 ②，733/741/742 登录回放代导航）：`phaseIsNavigateOnly`
 * 为 true 且 zeroStep && explicitSuccess===true 时该阶段视为正常成功——不降级
 * （success 保持 true）、text 不加 `[0步完成] ` 前缀（避免前端误读）、
 * registerPerRun=false（不进 perRun 嫌疑清单）。默认 false=现行为逐字不变；
 * 豁免面仅限该 flag 三条件同真，非 navigate 零步仍降级（假成功防线不松）。
 * @param {{ explicitSuccess: boolean|null, phaseStepCount: number, donePayload?: object|null, phaseIsNavigateOnly?: boolean }} args
 *   explicitSuccess = phase_done 负载解析出的显式成败（缺失为 null）；phaseStepCount =
 *   本阶段已落库业务步数（runtime.phaseStepCounts 真源）；donePayload = phase_done 事件负载；
 *   phaseIsNavigateOnly = 本阶段是否为 navigate-only（登录回放代导航合法零步形态）。
 * @returns {{ success: boolean|null, text: string, zeroStepPhase: boolean, registerPerRun: boolean }} outcome shape + flags
 */
export function evaluatePhaseOutcome({ explicitSuccess, phaseStepCount, donePayload, phaseIsNavigateOnly = false }) {
  const zeroStepPhase = Number(phaseStepCount) === 0;
  const navigateExempt = zeroStepPhase && explicitSuccess === true && phaseIsNavigateOnly === true;
  const downgraded = zeroStepPhase && explicitSuccess === true && !navigateExempt;
  const textFromDone = String(donePayload?.text || donePayload?.summary || '').trim();
  const fallbackText = (explicitSuccess == null
    ? '见页面当前状态'
    : String(donePayload?.name || '').trim())
    || '见页面当前状态';
  return {
    success: downgraded ? null : explicitSuccess,
    text: zeroStepPhase && !navigateExempt ? `[0步完成] ${textFromDone || fallbackText}` : (textFromDone || fallbackText),
    zeroStepPhase,
    registerPerRun: downgraded,
  };
}

/**
 * 终局门闩双源裁决（假成功防线 v2/v3 收敛）：给定嫌疑阶段的双源复核结果，
 * 决定整轨是否降级。纯判定无副作用——DB/副本复核（zeroPhaseDb/zeroPhaseCopy）
 * 由 runner 完成 IO 后传入。
 *
 * 判定结构与旧内联控制流逐字等价（characterize-phase-done-evidence-gate.mjs 钉死）：
 * - zeroStepGate（v2/v1.5 互斥对，旧 if/else if）：
 *   1. v2 按阶段：存在嫌疑（hasPhaseSuspects）且双源（副本+DB）均为 0 的阶段非空 → downgrade{phases}
 *   2. v1.5 total==0 兜底：仅当**无嫌疑阶段**时进入（旧 else 分支语义），total==0 → downgrade{}（重录掩蔽兜底，保留不删）
 *   3. 否则 keep
 * - perRunGate（v3，旧独立 if——zeroStepGate 降级后仍独立尝试，CAS 失败打 skipped 日志）：
 *   本轮真源 phaseStepCounts 复读仍 0 的嫌疑阶段非空 → downgrade{phases}，否则 null。
 * @param {{ hasPhaseSuspects: boolean, totalCopySteps: number, totalDbSteps: number, zeroPhaseBoth: Array<number|string>, perRunZeroPhases: Array<number|string> }} args
 *   hasPhaseSuspects = v2 快照嫌疑阶段非空（控制 v1.5 兜底是否可见）;
 *   zeroPhaseBoth = v2 suspects failing BOTH copy+DB recount;
 *   perRunZeroPhases = per-run suspects still 0 in phaseStepCounts after drain.
 * @returns {{ zeroStepGate: { verdict: 'downgrade', kind: 'zeroPhase'|'total', phases?: Array<number|string> }
 *   | { verdict: 'keep', kind: null }, perRunGate: { verdict: 'downgrade', kind: 'perRun', phases: Array<number|string> } | null }}
 *   zeroStepGate 与 perRunGate 各自独立分派副作用（CAS+broadcast 留 runner）
 */
export function evaluateFinalizeGate({
  hasPhaseSuspects,
  totalCopySteps,
  totalDbSteps,
  zeroPhaseBoth,
  perRunZeroPhases,
}) {
  let zeroStepGate = { verdict: 'keep', kind: null };
  if (hasPhaseSuspects && Array.isArray(zeroPhaseBoth) && zeroPhaseBoth.length) {
    zeroStepGate = { verdict: 'downgrade', kind: 'zeroPhase', phases: zeroPhaseBoth };
  } else if (!hasPhaseSuspects && Number(totalCopySteps) === 0 && Number(totalDbSteps) === 0) {
    zeroStepGate = { verdict: 'downgrade', kind: 'total' };
  }
  const perRunGate = Array.isArray(perRunZeroPhases) && perRunZeroPhases.length
    ? { verdict: 'downgrade', kind: 'perRun', phases: perRunZeroPhases }
    : null;
  return { zeroStepGate, perRunGate };
}

/**
 * v3 同步终局：从 phaseOutcomes + phases 收集显式失败阶段的 phaseNumber 清单。
 * phaseOutcomes 以 phase.id / phaseNumber 双键同写同一对象，按 phase.id 取判定、
 * 报 phase.phaseNumber（P2-#6：避免把 DB id 混进载荷误导前端诊断）。
 * @param {Record<string|number, { success?: boolean|null }>|null|undefined} phaseOutcomes per-phase outcomes
 * @param {Array<{ id: number|string, phaseNumber: number|string }>} phases ordered phase rows
 * @returns {Array<number|string>} phaseNumbers of phases with outcome.success === false
 */
export function collectFailedPhases(phaseOutcomes, phases) {
  const failed = [];
  for (const phase of phases || []) {
    const outcome = phaseOutcomes?.[phase.id];
    if (outcome?.success === false) failed.push(phase.phaseNumber);
  }
  return failed;
}

/**
 * phase_blocked 区分判定（#909 移交项②）：判定终局输入是否为「诚实受阻」形态——
 * 质量标记全部为受阻必然推论（missing_success_token）且只出现在已显式失败的阶段。
 * 纯函数无副作用、不碰输入；任一条件不满足即非受阻（保守面：宁判 quality_failed
 * 不假绿，红线不松）。
 *
 * 三条件（全满足才 true）：
 * 1. failedPhases 非空（存在显式 success=false 阶段）；
 * 2. qualityFails 非空，且每条的 reasons 非空并逐条精确等于 'missing_success_token'
 *    （pending_fields / semantic_doubt_fields 等其余 reason 一律视为真质量信号，无前缀匹配）；
 * 3. qualityFails 附着的 phase 全部落在 failedPhases 集合内。
 * @param {{ failedPhases: Array<number|string>, qualityFails: Array<{ phase?: number|string, reasons?: string[] }> }} args
 *   failedPhases = collectFailedPhases 输出（显式失败阶段号）；qualityFails = phase_end
 *   QUALITY FAIL 清单（runner 捕获的 { phase, reasons } 形状）。
 * @returns {boolean} true = blocked-only 形态（failKind 应降级为 'phase_blocked'）
 */
export function isBlockedOnlyFailure({ failedPhases, qualityFails }) {
  const failedList = Array.isArray(failedPhases) ? failedPhases : [];
  const qualityFailsList = Array.isArray(qualityFails) ? qualityFails : [];
  if (!failedList.length || !qualityFailsList.length) return false;
  const failedSet = new Set(failedList);
  for (const q of qualityFailsList) {
    const reasons = Array.isArray(q?.reasons) ? q.reasons : [];
    if (!reasons.length) return false;
    for (const reason of reasons) {
      if (reason !== 'missing_success_token') return false;
    }
    if (q?.phase == null || !failedSet.has(q.phase)) return false;
  }
  return true;
}

/**
 * 终局成败裁决（v3 同步终局收敛）：任一显式失败阶段 / QUALITY FAIL / G3 聚合失败
 * → failure 收官（宁误拒不假绿）；判定序：qualityFails 决定 failedReason 取值，
 * failedPhases/qualityFails 任一非空或聚合为 false 即 failure。
 * blocked 区分（#909 移交项②）：failedPhases 非空且 isBlockedOnlyFailure 三条件
 * 全满足（质量标记全为 missing_success_token 且只附着于已显式失败阶段）→
 * failKind 降级 'phase_blocked'（诚实受阻，非录制质量差）；任一条件不满足维持
 * 现行二分（'quality_failed' | 'phase_failed'）。
 * @param {{ failedPhases: Array<number|string>, qualityFails: Array<object>, trajSuccess: boolean }} args
 *   failedPhases = collectFailedPhases 输出（显式失败阶段号）；qualityFails = phase_end
 *   QUALITY FAIL 清单；trajSuccess = aggregateTrajectorySuccessful 聚合结果。
 * @returns {{ success: boolean, failKind: string|null }} final verdict; failKind is
 *   'phase_blocked' | 'quality_failed' | 'phase_failed' | null（null = success 收官，
 *   不写失败原因）
 */
export function evaluateFinalVerdict({ failedPhases, qualityFails, trajSuccess }) {
  const qualityFailsList = Array.isArray(qualityFails) ? qualityFails : [];
  const failedList = Array.isArray(failedPhases) ? failedPhases : [];
  if (failedList.length || qualityFailsList.length || trajSuccess === false) {
    if (isBlockedOnlyFailure({ failedPhases: failedList, qualityFails: qualityFailsList })) {
      return { success: false, failKind: 'phase_blocked' };
    }
    return { success: false, failKind: qualityFailsList.length ? 'quality_failed' : 'phase_failed' };
  }
  return { success: true, failKind: null };
}
