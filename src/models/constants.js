/** @typedef {'agent'|'manual'|'cdp'} StepSource */

/** @typedef {'active'|'closed'|'crashed'} RemoteSessionStatus */

/** @typedef {'context'|'target'} RemoteSessionIsolation */

/** @typedef {'exact'|'prefix'|'regex'} ApiOverrideMatchType */

/** @typedef {'global'|'system'|'process'|'function'} ApiOverrideScope */

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
