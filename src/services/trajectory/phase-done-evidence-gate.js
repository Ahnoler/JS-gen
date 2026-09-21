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
 * @param {{ explicitSuccess: boolean|null, phaseStepCount: number, donePayload?: object|null }} args
 *   explicitSuccess = phase_done 负载解析出的显式成败（缺失为 null）；phaseStepCount =
 *   本阶段已落库业务步数（runtime.phaseStepCounts 真源）；donePayload = phase_done 事件负载。
 * @returns {{ success: boolean|null, text: string, zeroStepPhase: boolean, registerPerRun: boolean }} outcome shape + flags
 */
export function evaluatePhaseOutcome({ explicitSuccess, phaseStepCount, donePayload }) {
  const zeroStepPhase = Number(phaseStepCount) === 0;
  const downgraded = zeroStepPhase && explicitSuccess === true;
  const textFromDone = String(donePayload?.text || donePayload?.summary || '').trim();
  const fallbackText = (explicitSuccess == null
    ? '见页面当前状态'
    : String(donePayload?.name || '').trim())
    || '见页面当前状态';
  return {
    success: downgraded ? null : explicitSuccess,
    text: zeroStepPhase ? `[0步完成] ${textFromDone || fallbackText}` : (textFromDone || fallbackText),
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
 * 终局成败裁决（v3 同步终局收敛）：任一显式失败阶段 / QUALITY FAIL / G3 聚合失败
 * → failure 收官（宁误拒不假绿）；判定序：qualityFails 决定 failedReason 取值，
 * failedPhases/qualityFails 任一非空或聚合为 false 即 failure。
 * @param {{ failedPhases: Array<number|string>, qualityFails: Array<object>, trajSuccess: boolean }} args
 *   failedPhases = collectFailedPhases 输出（显式失败阶段号）；qualityFails = phase_end
 *   QUALITY FAIL 清单；trajSuccess = aggregateTrajectorySuccessful 聚合结果。
 * @returns {{ success: boolean, failKind: string|null }} final verdict; failKind is
 *   'quality_failed' | 'phase_failed' | null（null = success 收官，不写失败原因）
 */
export function evaluateFinalVerdict({ failedPhases, qualityFails, trajSuccess }) {
  const qualityFailsList = Array.isArray(qualityFails) ? qualityFails : [];
  const failedList = Array.isArray(failedPhases) ? failedPhases : [];
  if (failedList.length || qualityFailsList.length || trajSuccess === false) {
    return { success: false, failKind: qualityFailsList.length ? 'quality_failed' : 'phase_failed' };
  }
  return { success: true, failKind: null };
}
