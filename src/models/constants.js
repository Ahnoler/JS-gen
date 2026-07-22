/** @typedef {'agent'|'manual'|'cdp'} StepSource */

/** @typedef {'active'|'closed'|'crashed'} RemoteSessionStatus */

/** @typedef {'context'|'target'} RemoteSessionIsolation */

/** @typedef {'exact'|'prefix'|'regex'} ApiOverrideMatchType */

/** @typedef {'global'|'system'|'process'|'function'} ApiOverrideScope */

/** @typedef {'online'|'draining'|'offline'} ExecutorNodeStatus */

/** @typedef {'draft'|'live'|'recording'|'recorded'|'completed'} TrajectoryRecordStatus */

/** @typedef {'pending'|'running'|'completed'|'failed'} TrajectoryPhaseStatus */

/** @typedef {'css'|'xpath_full'|'xpath_smart'} LocatorCandidateType */

/** @type {readonly StepSource[]} */
export const STEP_SOURCES = Object.freeze(['agent', 'manual', 'cdp']);

/** @type {readonly RemoteSessionStatus[]} */
export const REMOTE_SESSION_STATUSES = Object.freeze(['active', 'closed', 'crashed']);

/** @type {readonly RemoteSessionIsolation[]} */
export const REMOTE_SESSION_ISOLATIONS = Object.freeze(['context', 'target']);

/** @type {readonly ApiOverrideMatchType[]} */
export const API_OVERRIDE_MATCH_TYPES = Object.freeze(['exact', 'prefix', 'regex']);

/** @type {readonly ApiOverrideScope[]} */
export const API_OVERRIDE_SCOPES = Object.freeze(['global', 'system', 'process', 'function']);

/** @type {readonly LocatorCandidateType[]} */
export const LOCATOR_CANDIDATE_TYPES = Object.freeze(['css', 'xpath_full', 'xpath_smart']);

/** @type {readonly ExecutorNodeStatus[]} */
export const EXECUTOR_NODE_STATUSES = Object.freeze(['online', 'draining', 'offline']);

/** @type {readonly TrajectoryRecordStatus[]} */
export const TRAJECTORY_RECORD_STATUSES = Object.freeze(['draft', 'live', 'recording', 'recorded', 'completed']);

/** @type {readonly TrajectoryPhaseStatus[]} */
export const TRAJECTORY_PHASE_STATUSES = Object.freeze(['pending', 'running', 'completed', 'failed']);
