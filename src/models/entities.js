/**
 * Entity type definitions — align with MySQL tables (camelCase in JS, snake_case in DB).
 * Use with dao/helpers.js toDbRow() / fromDbRow() for persistence.
 */

/**
 * @typedef {Object} System
 * @property {number} [id]
 * @property {string} systemId
 * @property {string} name
 * @property {string} [description]
 * @property {string} createdAt
 * @property {string} [updatedAt]
 */

/**
 * @typedef {Object} Process
 * @property {number} [id]
 * @property {string} processId
 * @property {number} systemId
 * @property {string} name
 * @property {string} [description]
 * @property {number} [sortOrder]
 * @property {string} createdAt
 * @property {string} [updatedAt]
 */

/**
 * @typedef {Object} FunctionDef
 * @property {number} [id]
 * @property {string} functionId
 * @property {number} processId
 * @property {string} name
 * @property {string} [description]
 * @property {number} [sortOrder]
 * @property {string} createdAt
 * @property {string} [updatedAt]
 */

/**
 * @typedef {Object} RemoteSession
 * @property {number} [id]
 * @property {string} sessionUuid
 * @property {string} [browserContextId]
 * @property {string} [targetId]
 * @property {import('./constants.js').RemoteSessionIsolation} [isolation]
 * @property {number} [viewportW]
 * @property {number} [viewportH]
 * @property {number|string} [deviceScaleFactor]
 * @property {string} [url]
 * @property {import('./constants.js').RemoteSessionStatus} [status]
 * @property {string} createdAt
 * @property {string|null} [closedAt]
 */

/**
 * @typedef {Object} Trajectory
 * @property {number} [id]
 * @property {string} trajectoryId
 * @property {string} [task]
 * @property {string} [model]
 * @property {number} [stepCount]
 * @property {number} [actionCount]
 * @property {boolean|null} [isDone]
 * @property {boolean|null} [isSuccessful]
 * @property {string} [url]
 * @property {number|null} [functionId]
 * @property {number|null} [remoteSessionId]
 * @property {string} createdAt
 * @property {string} [updatedAt]
 * @property {TrajectoryStep[]} [steps]
 * @property {TrajectoryPhase[]} [phases]
 * @property {Screenshot[]} [screenshots]
 */

/**
 * @typedef {Object} TrajectoryPhase
 * @property {number} [id]
 * @property {string} phaseId
 * @property {number} trajectoryId
 * @property {number} phaseNumber
 * @property {string} [description]
 * @property {'running'|'completed'|'failed'} [status]
 * @property {string} createdAt
 * @property {string|null} [completedAt]
 */

/**
 * @typedef {Object} LocatorCandidate
 * @property {import('./constants.js').LocatorCandidateType} type
 * @property {string} value
 */

/**
 * @typedef {Object} ElementJson
 * @property {string} [tag]
 * @property {string} [xpath]
 * @property {string} [cssSelector]
 * @property {Record<string, string>} [attributes]
 * @property {string} [text]
 * @property {string} [id]
 * @property {string} [class]
 * @property {string} [placeholder]
 * @property {LocatorCandidate[]} [candidates]
 */

/**
 * @typedef {Object} TrajectoryStep
 * @property {number} [id]
 * @property {number} trajectoryId
 * @property {number} stepNumber
 * @property {number} [phaseNumber]
 * @property {number} [actionIndex]
 * @property {string} [actionType]
 * @property {string} [description]
 * @property {Record<string, unknown>|null} [params]
 * @property {ElementJson|null} [element]
 * @property {boolean|null} [success]
 * @property {string|null} [error]
 * @property {string} [extractedContent]
 * @property {number|null} [trajectoryPhaseId]
 * @property {import('./constants.js').StepSource} [source]
 * @property {string} createdAt
 */

/**
 * @typedef {Object} CaseData
 * @property {number} [id]
 * @property {string} recordId
 * @property {string} [sessionId]
 * @property {string} [model]
 * @property {string} [description]
 * @property {number} [keyCount]
 * @property {Record<string, unknown>|null} [rawJson]
 * @property {string} createdAt
 * @property {CaseDataEntry[]} [entries]
 * @property {FormSnapshot[]} [formSnapshots]
 */

/**
 * @typedef {Object} CaseDataEntry
 * @property {number} [id]
 * @property {number} caseDataId
 * @property {string} fieldKey
 * @property {string|null} [fieldValue]
 * @property {string} createdAt
 */

/**
 * @typedef {Object} FormSnapshot
 * @property {number} [id]
 * @property {string} container
 * @property {number} [fieldCount]
 * @property {number} [requiredCount]
 * @property {number} [optionalCount]
 * @property {number} [actionIndex]
 * @property {number|null} [caseDataId]
 * @property {number|null} [trajectoryId]
 * @property {string} createdAt
 * @property {SnapshotField[]} [fields]
 */

/**
 * @typedef {Object} SnapshotField
 * @property {number} [id]
 * @property {number} formSnapshotId
 * @property {string} label
 * @property {boolean} [isRequired]
 * @property {string} createdAt
 */

/**
 * @typedef {Object} Screenshot
 * @property {number} [id]
 * @property {string} fileName
 * @property {Buffer} imageData
 * @property {number} [fileSize]
 * @property {string} [mimeType]
 * @property {number|null} [trajectoryId]
 * @property {number} [stepIndex]
 * @property {string} createdAt
 */

/**
 * @typedef {Object} ApiOverride
 * @property {number} [id]
 * @property {string} name
 * @property {string} urlPattern
 * @property {import('./constants.js').ApiOverrideMatchType} [matchType]
 * @property {string} [httpMethod]
 * @property {boolean} [enabled]
 * @property {number} [respStatus]
 * @property {Record<string, string>|null} [respHeaders]
 * @property {string|null} [respBody]
 * @property {import('./constants.js').ApiOverrideScope} [scope]
 * @property {number|null} [scopeRefId]
 * @property {number} [sortOrder]
 * @property {string} createdAt
 * @property {string} [updatedAt]
 */

export {};
