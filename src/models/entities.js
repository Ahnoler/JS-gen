/**
 * Entity type definitions — align with MySQL tables (camelCase in JS, snake_case in DB).
 * Use with dao/helpers.js toDbRow() / fromDbRow() for persistence.
 */

/**
 * @typedef {Object} System
 * Hierarchy node in unified `system` table.
 * @property {number} [id]
 * @property {string} systemId UUID 业务标识（各级节点共用此列）
 * @property {1|2|3} type 1=系统 2=模块 3=功能
 * @property {number} [parentId] 系统根为 0；模块/功能指向父节点 id
 * @property {string} name
 * @property {string} [description]
 * @property {string} [url] 系统地址（仅 type=1）
 * @property {number} [sortOrder]
 * @property {string} [processId] type=2 时的 UUID 别名（= systemId）
 * @property {string} [functionId] type=3 时的 UUID 别名（= systemId）
 * @property {string} createdAt
 * @property {string} [updatedAt]
 */

/**
 * @typedef {Object} SystemAccount
 * @property {number} [id]
 * @property {number} systemId 归属 type=1 的系统节点 id
 * @property {string} name 角色名（管理员/测试人员/…）
 * @property {string} [loginUrl] 登录网址（已迁移到 system.url，保留兼容）
 * @property {string} [username] 测试账号
 * @property {string} [password] 测试密码
 * @property {string} [remark] 备注
 * @property {number} [sortOrder]
 * @property {string} createdAt
 * @property {string} [updatedAt]
 */

/**
 * @typedef {Object} Process
 * @deprecated 已合并进 System（type=2）；保留 typedef 兼容旧注释
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
 * @deprecated 已合并进 System（type=3）；保留 typedef 兼容旧注释
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
 * @property {number|null} [executorNodeId] FK → executor_node.id
 * @property {number|null} [slotIndex] 执行机内槽位号
 * @property {string|null} [clientKey] 前端会话/用户标识（亲和调度）
 * @property {string} createdAt
 * @property {string|null} [closedAt]
 */

/**
 * 一台已注册的执行机节点。业务层据此过滤/选机/占槽。
 * 占用量不落列（由 active remote_session 计数派生）。
 *
 * @typedef {Object} ExecutorNode
 * @property {number} [id]
 * @property {string} nodeUuid UUID（执行机自报，稳定标识；register 以此 upsert）
 * @property {string} name 显示名
 * @property {string} [host] 内网标识/备注（非公网 CDP 地址）
 * @property {import('./constants.js').ExecutorNodeStatus} status 节点状态
 * @property {number} capacity 最大槽位数（配置量）
 * @property {Object|null} [labels] 能力标签 { os, headed, chrome, ... }
 * @property {string} [agentVersion] Agent 版本（灰度用）
 * @property {string|null} [lastHeartbeatAt] 最近心跳时间
 * @property {string} createdAt
 * @property {string} [updatedAt]
 * @property {number} [inUse] 派生字段：active remote_session 计数（不落库）
 */

/**
 * @typedef {Object} Trajectory
 * @property {number} [id]
 * @property {string} [name] 交易名称
 * @property {string|null} [trajectoryLog] operation log text (same as log_{ts}.txt)
 * @property {string} [task] 需求描述
 * @property {string} [model]
 * @property {number} [stepCount]
 * @property {number} [phaseCount]
 * @property {boolean|null} [isDone]
 * @property {boolean|null} [isSuccessful]
 * @property {string} [url]
 * @property {number|null} [functionId]
 * @property {number|null} [remoteSessionId]
 * @property {import('./constants.js').TrajectoryRecordStatus} [recordStatus]
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
 * @property {import('./constants.js').TrajectoryPhaseStatus} [status]
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
 * @property {Record<string, unknown>|null} [params]
 * @property {ElementJson|null} [element]
 * @property {boolean|null} [success]
 * @property {string|null} [error]
 * @property {string} [extractedContent]
 * @property {number|null} [trajectoryPhaseId]
 * @property {import('./constants.js').StepSource} [source]
 * @property {boolean} [confirmed] 人工确认
 * @property {string|null} [confirmedAt]
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
