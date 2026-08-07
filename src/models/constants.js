/** @typedef {'agent'|'manual'|'cdp'} StepSource */

/** @typedef {'active'|'idle'|'closed'|'crashed'} RemoteSessionStatus */

/** @typedef {'context'|'target'} RemoteSessionIsolation */

/** @typedef {'exact'|'prefix'|'regex'} ApiOverrideMatchType */

/** @typedef {'global'|'system'|'process'|'function'} ApiOverrideScope */

/** @typedef {'online'|'draining'|'offline'} ExecutorNodeStatus */

/** @typedef {'draft'|'live'|'recording'|'recorded'|'completed'} TrajectoryRecordStatus */

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
export const TRAJECTORY_RECORD_STATUSES = Object.freeze(['draft', 'live', 'recording', 'recorded', 'completed']);

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
