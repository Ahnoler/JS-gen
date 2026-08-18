/** @typedef {'agent'|'manual'|'cdp'} StepSource */

/** @typedef {'active'|'idle'|'closed'|'crashed'} RemoteSessionStatus */

/** @typedef {'context'|'target'} RemoteSessionIsolation */

/** @typedef {'exact'|'prefix'|'regex'} ApiOverrideMatchType */

/** @typedef {'global'|'system'|'process'|'function'} ApiOverrideScope */

/** @typedef {'online'|'draining'|'offline'} ExecutorNodeStatus */

/** @typedef {'draft'|'recording'|'failed'|'recorded'|'completed'} TrajectoryRecordStatus */

/** @typedef {'pending'|'running'|'completed'|'failed'} TrajectoryPhaseStatus */

/** @typedef {'phase'|'step_seq'} OperationComponentGrain */

/** @typedef {'draft'|'confirmed'|'deprecated'} OperationComponentStatus */

/** @type {readonly OperationComponentGrain[]} */
export const OPERATION_COMPONENT_GRAINS = Object.freeze(['phase', 'step_seq']);

/** @type {readonly OperationComponentStatus[]} */
export const OPERATION_COMPONENT_STATUSES = Object.freeze(['draft', 'confirmed', 'deprecated']);

/** @typedef {'css'|'xpath_full'|'xpath_smart'} LocatorCandidateType */

/** @type {readonly StepSource[]} */
export const STEP_SOURCES = Object.freeze(['agent', 'manual', 'cdp']);

/** @type {readonly RemoteSessionStatus[]} */
export const REMOTE_SESSION_STATUSES = Object.freeze(['active', 'idle', 'closed', 'crashed']);

/** Statuses that still occupy an executor slot / browser. */
export const REMOTE_SESSION_OCCUPIED = Object.freeze(['active', 'idle']);

/** @type {readonly RemoteSessionIsolation[]} */
export const REMOTE_SESSION_ISOLATIONS = Object.freeze(['context', 'target']);

/** @type {readonly ApiOverrideMatchType[]} */
export const API_OVERRIDE_MATCH_TYPES = Object.freeze(['exact', 'prefix', 'regex']);

/** @type {readonly ApiOverrideScope[]} */
export const API_OVERRIDE_SCOPES = Object.freeze(['global', 'system', 'process', 'function']);

/** @type {readonly LocatorCandidateType[]} */
export const LOCATOR_CANDIDATE_TYPES = Object.freeze(['css', 'xpath_full', 'xpath_smart']);

/** @typedef {'xpath_smart'|'xpath_full'} LocatorStrategy */

/** @type {readonly LocatorStrategy[]} */
export const LOCATOR_STRATEGIES = Object.freeze(['xpath_smart', 'xpath_full']);

/** @type {readonly ExecutorNodeStatus[]} */
export const EXECUTOR_NODE_STATUSES = Object.freeze(['online', 'draining', 'offline']);

/** @type {readonly TrajectoryRecordStatus[]} */
export const TRAJECTORY_RECORD_STATUSES = Object.freeze(['draft', 'recording', 'failed', 'recorded', 'completed']);

/**
 * 持久记录状态：未录制/待确认/已确认/录制异常。
 * 这些状态不会因为一次「录制中」(recording) 会话而被覆盖/降级。
 */
export const PERSISTENT_RECORD_STATUSES = Object.freeze(['draft', 'recorded', 'completed', 'failed']);

/** 是否持久状态（非录制中）。 */
export function isPersistentRecordStatus(status) {
  return PERSISTENT_RECORD_STATUSES.includes(status);
}

/**
 * 计算录制会话结束后的持久状态。
 *
 * 核心规则：临时状态（recording）不能覆盖/降级持久状态；成功录制不会把已确认降级。
 * - outcome='success'：
 *    - base draft/failed → recorded（首次成功→待确认；异常后重录成功→待确认，可恢复）
 *    - base recorded → recorded（保持待确认）
 *    - base completed → completed（已确认保持，绝不降级）
 * - outcome='failure'：
 *    - base draft → failed（录制异常）
 *    - base ∈ {recorded, completed, failed} → 保持 base（不降级）
 * - outcome='restore'（非终结性：关浏览器/断开/回收）：一律恢复到 base。
 *
 * @param {string} base 录制前的持久状态（persistent_record_status）
 * @param {'success'|'failure'|'restore'} outcome
 * @returns {import('./constants.js').TrajectoryRecordStatus}
 */
export function resolvePostRecordingStatus(base, outcome) {
  const b = isPersistentRecordStatus(base) ? base : 'draft';
  if (outcome === 'success') {
    // 已确认保持已确认；其余（draft/failed/recorded）成功录制 → 待确认。
    return b === 'completed' ? 'completed' : 'recorded';
  }
  if (outcome === 'failure') {
    // 首次失败 → 录制异常；已确立持久状态不因失败而降级。
    return b === 'draft' ? 'failed' : b;
  }
  // restore：非终结性恢复，回到录制前持久状态。
  return b;
}

/** 轨迹状态中文文案（产品/文档/Vue 对齐的单一事实源） */
export const TRAJECTORY_RECORD_STATUS_LABELS = Object.freeze({
  draft: '未录制',
  recording: '录制中',
  failed: '录制异常',
  recorded: '待确认',
  completed: '已确认',
});

/** @type {readonly TrajectoryPhaseStatus[]} */
export const TRAJECTORY_PHASE_STATUSES = Object.freeze(['pending', 'running', 'completed', 'failed']);

/** @typedef {'accepted'|'running'|'waiting_executor'|'cancelling'|'cancelled'|'completed'|'completed_with_errors'|'failed'} BatchJobStatus */

/** @typedef {'record'|'draft'} BatchJobMode */
export const BATCH_JOB_MODES = Object.freeze(['record', 'draft']);

/** @typedef {'pending'|'analyzing'|'analyzed'|'queued'|'waiting_executor'|'preparing'|'recording'|'recorded'|'drafted'|'failed'|'rejected'|'cancelled'} BatchItemStatus */

/** @type {readonly BatchJobStatus[]} */
export const BATCH_JOB_STATUSES = Object.freeze([
  'accepted',
  'running',
  'waiting_executor',
  'cancelling',
  'cancelled',
  'completed',
  'completed_with_errors',
  'failed',
]);

/** @type {readonly BatchItemStatus[]} */
export const BATCH_ITEM_STATUSES = Object.freeze([
  'pending',
  'analyzing',
  'analyzed',
  'queued',
  'waiting_executor',
  'preparing',
  'recording',
  'recorded',
  'drafted',
  'failed',
  'rejected',
  'cancelled',
]);

/** Item statuses that can still be scheduled / recovered after restart. */
export const BATCH_ITEM_RESUMABLE = Object.freeze([
  'pending',
  'analyzing',
  'analyzed',
  'queued',
  'waiting_executor',
]);

/** Item terminal statuses. */
export const BATCH_ITEM_TERMINAL = Object.freeze([
  'recorded',
  'drafted',
  'failed',
  'rejected',
  'cancelled',
]);

/** Job terminal statuses. */
export const BATCH_JOB_TERMINAL = Object.freeze([
  'cancelled',
  'completed',
  'completed_with_errors',
  'failed',
]);

/** sys_msg message constants (moved from models/sys-msg.js). */
export const MSG_TYPE_BATCH_IMPORT = 1;
export const MSG_TITLE_BATCH_IMPORT = '批量导入任务';
export const SOURCE_TYPE_BATCH_IMPORT = 'batch_import';
export const MSG_STATUS_UNREAD = 0;
export const MSG_STATUS_READ = 2;
export const DICT_TYPE_SYS_MSG = 'sys_msg_type';
