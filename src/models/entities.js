/**
 * Entity type definitions — align with MySQL tables (camelCase in JS, snake_case in DB).
 * Use with dao/helpers.js toDbRow() / fromDbRow() for persistence.
 */

/**
 * @typedef {object} System
 * Hierarchy node in unified `system` table.
 * @property {number} [id] 主键
 * @property {string} systemId UUID 业务标识（各级节点共用此列）
 * @property {1|2|3} type 1=系统 2=模块 3=功能
 * @property {number} [parentId] 系统根为 0；模块/功能指向父节点 id
 * @property {string} name 节点名称
 * @property {string} [description] 描述
 * @property {string} [url] 系统地址（仅 type=1）
 * @property {number} [sortOrder] 排序号
 * @property {string} [processId] type=2 时的 UUID 别名（= systemId）
 * @property {string} [functionId] type=3 时的 UUID 别名（= systemId）
 * @property {string} createdAt 创建时间
 * @property {string} [updatedAt] 更新时间
 */

/**
 * @typedef {object} SystemAccount
 * @property {number} [id] 主键
 * @property {number} systemId 归属 type=1 的系统节点 id
 * @property {string} name 角色名（管理员/测试人员/…）
 * @property {string} [loginUrl] 登录网址（已迁移到 system.url，保留兼容）
 * @property {string} [account] 测试账号
 * @property {string} [password] 测试密码
 * @property {string} [remark] 备注
 * @property {number} [sortOrder] 排序号
 * @property {string} createdAt 创建时间
 * @property {string} [updatedAt] 更新时间
 */

/**
 * @typedef {object} Process
 * Legacy: 已合并进 System（type=2）；保留 typedef 兼容旧注释
 * @property {number} [id] 主键
 * @property {string} processId 流程 UUID
 * @property {number} systemId 归属系统节点 id
 * @property {string} name 流程名称
 * @property {string} [description] 描述
 * @property {number} [sortOrder] 排序号
 * @property {string} createdAt 创建时间
 * @property {string} [updatedAt] 更新时间
 */

/**
 * @typedef {object} FunctionDef
 * Legacy: 已合并进 System（type=3）；保留 typedef 兼容旧注释
 * @property {number} [id] 主键
 * @property {string} functionId 功能 UUID
 * @property {number} processId 归属流程 id
 * @property {string} name 功能名称
 * @property {string} [description] 描述
 * @property {number} [sortOrder] 排序号
 * @property {string} createdAt 创建时间
 * @property {string} [updatedAt] 更新时间
 */

/**
 * @typedef {object} RemoteSession
 * @property {number} [id] 主键
 * @property {string} sessionUuid 会话 UUID
 * @property {string} [browserContextId] 浏览器上下文 ID
 * @property {string} [targetId] CDP target ID
 * @property {import('./constants.js').RemoteSessionIsolation} [isolation] 隔离模式
 * @property {number} [viewportW] 视口宽
 * @property {number} [viewportH] 视口高
 * @property {number|string} [deviceScaleFactor] 设备缩放比
 * @property {string} [url] 当前页面 URL
 * @property {import('./constants.js').RemoteSessionStatus} [status] 会话状态
 * @property {number|null} [executorNodeId] FK → executor_node.id
 * @property {number|null} [slotIndex] 执行机内槽位号
 * @property {string|null} [clientKey] 前端会话/用户标识（亲和调度）
 * @property {string|null} [agentSessionId] Python/执行机 agent session UUID
 * @property {number|null} [trajectoryId] 当前挂载交易；断开画面后可空
 * @property {string} createdAt 创建时间
 * @property {string|null} [closedAt] 关闭时间
 */

/**
 * 一台已注册的执行机节点。业务层据此过滤/选机/占槽。
 * 占用量不落列（由 active|idle remote_session 计数派生）。
 * @typedef {object} ExecutorNode
 * @property {number} [id] 主键
 * @property {string} nodeUuid UUID（执行机自报，稳定标识；register 以此 upsert）
 * @property {string} name 显示名
 * @property {string} [host] 内网标识/备注（非公网 CDP 地址）
 * @property {import('./constants.js').ExecutorNodeStatus} status 节点状态
 * @property {number} capacity 最大槽位数（配置量）
 * @property {object|null} [labels] 能力标签 { os, headed, chrome, ... }
 * @property {string} [agentVersion] Agent 版本（灰度用）
 * @property {string|null} [lastHeartbeatAt] 最近心跳时间
 * @property {string} createdAt 创建时间
 * @property {string} [updatedAt] 更新时间
 * @property {number} [inUse] 派生字段：active|idle remote_session 计数（不落库）
 */

/**
 * @typedef {object} Trajectory
 * @property {number} [id] 主键
 * @property {string} [name] 交易名称
 * @property {string|null} [trajectoryLog] operation log text (same as log_{ts}.txt)
 * @property {string} [task] 需求描述
 * @property {string} [model] 使用的模型名
 * @property {number} [stepCount] 步骤数
 * @property {number} [phaseCount] 阶段数
 * @property {boolean|null} [isDone] 是否完成
 * @property {boolean|null} [isSuccessful] 是否成功
 * @property {string} [url] 被测系统 URL
 * @property {number|null} [functionId] 归属功能节点 id
 * @property {number|null} [remoteSessionId] 关联远程会话 id
 * @property {import('./constants.js').TrajectoryRecordStatus} [recordStatus] 录制状态
 * @property {string} createdAt 创建时间
 * @property {string} [updatedAt] 更新时间
 * @property {TrajectoryStep[]} [steps] 关联步骤列表
 * @property {TrajectoryPhase[]} [phases] 关联阶段列表
 * @property {Screenshot[]} [screenshots] 关联截图列表
 */

/**
 * @typedef {object} TrajectoryPhase
 * @property {number} [id] 主键
 * @property {string} phaseId 阶段 UUID
 * @property {number} trajectoryId 归属轨迹 id
 * @property {number} phaseNumber 阶段序号
 * @property {string} [description] 阶段描述
 * @property {import('./constants.js').TrajectoryPhaseStatus} [status] 阶段状态
 * @property {number|null} [componentId] 预留 → operation_component.id；Phase1 业务不写入
 * @property {string} createdAt 创建时间
 * @property {string|null} [completedAt] 完成时间
 */

/**
 * Phase-level operation component (atomic step library asset).
 * @typedef {object} OperationComponent
 * @property {number} [id] 主键
 * @property {string} name 组件名称
 * @property {string|null} [key] 组件键
 * @property {string|null} [description] 描述
 * @property {'phase'|'step_seq'} [grain] 粒度（阶段级或步骤序列级）
 * @property {number} systemId 归属系统节点 id
 * @property {'draft'|'confirmed'|'deprecated'} [status] 状态
 * @property {Record<string, unknown>|null} [paramSchema] 参数 schema
 * @property {Array<{actionType: string, params: object|null, elementJson: object|null}>} [stepsJson] 步骤 JSON
 * @property {string} signature 组件签名（内容哈希）
 * @property {number|null} [sourceTrajectoryId] 来源轨迹 id
 * @property {number|null} [sourcePhaseId] 来源阶段 id
 * @property {number} [occurrenceCount] 出现次数
 * @property {number|null} [confidence] 置信度
 * @property {string} [createdBy] 入库人（暂可空串）
 * @property {string} [createdAt] 创建时间
 * @property {string} [updatedAt] 更新时间
 * @property {OperationComponentOccurrence[]} [occurrences] 关联出现记录
 */

/**
 * @typedef {object} OperationComponentOccurrence
 * @property {number} [id] 主键
 * @property {number} componentId 归属组件 id
 * @property {number} trajectoryId 归属轨迹 id
 * @property {number} trajectoryPhaseId 归属阶段 id
 * @property {number|null} [similarity] 相似度
 * @property {number|null} [stepStart] 起始步骤序号
 * @property {number|null} [stepEnd] 结束步骤序号
 * @property {string} [createdAt] 创建时间
 * @property {number|null} [phaseNumber] 阶段序号
 * @property {string|null} [phaseDescription] 阶段描述
 * @property {string|null} [trajectoryName] 轨迹名称
 */

/**
 * @typedef {object} LocatorCandidate
 * @property {import('./constants.js').LocatorCandidateType} type 定位器类型
 * @property {string} value 定位器值
 */

/**
 * @typedef {object} ElementJson
 * @property {string} [tag] 标签名
 * @property {string} [xpath] XPath
 * @property {string} [cssSelector] CSS 选择器
 * @property {Record<string, string>} [attributes] 属性表
 * @property {string} [text] 文本
 * @property {string} [id] 元素 id
 * @property {string} [class] class 名
 * @property {string} [placeholder] 占位文本
 * @property {string} [xpath_smart] 智能 XPath
 * @property {string} [xpath_full] 完整 XPath
 * @property {string} [xpath_abs] 绝对 XPath
 * @property {LocatorCandidate[]} [candidates] 定位候选列表
 * @property {string} [target_kind] 目标类型
 * @property {string} [locator_scope] 定位作用域
 * @property {number} [locator_occurrence] 定位出现序号
 * @property {boolean} [locator_verified] 是否已验证
 * @property {string} [locator_strategy] 定位策略
 * @property {string} [locator_fallback_reason] 回退原因
 * @property {string} [formLabel] 表单标签
 */

/**
 * @typedef {object} TrajectoryStep
 * @property {number} [id] 主键
 * @property {number} trajectoryId 归属轨迹 id
 * @property {number} stepNumber 步骤序号
 * @property {number} [phaseNumber] 阶段序号
 * @property {number} [actionIndex] 动作序号
 * @property {string} [actionType] 动作类型
 * @property {Record<string, unknown>|null} [params] 动作参数
 * @property {ElementJson|null} [element] 元素 JSON
 * @property {boolean|null} [success] 是否成功
 * @property {string|null} [error] 错误信息
 * @property {string} [extractedContent] 提取的内容
 * @property {number|null} [trajectoryPhaseId] 归属阶段 id
 * @property {import('./constants.js').StepSource} [source] 步骤来源
 * @property {boolean} [confirmed] 回放确认（1/true=通过，0/false=不通过含触发自愈）
 * @property {string|null} [confirmedAt] 回放确认时间
 * @property {string} createdAt 创建时间
 */

/**
 * @typedef {object} BusinessData
 * @property {number} [id] 主键
 * @property {string} recordId 记录 UUID
 * @property {string} [sessionId] 会话标识
 * @property {string} [model] 模型名
 * @property {string} [description] 描述
 * @property {number} [keyCount] 键值对数量
 * @property {Record<string, unknown>|null} [rawJson] 原始 JSON
 * @property {string} createdAt 创建时间
 * @property {BusinessDataEntry[]} [entries] 关联条目
 * @property {FormSnapshot[]} [formSnapshots] 关联表单快照
 * @deprecated Legacy store. Prefer SystemRefData for target-system verified fill references.
 *   User 业务数据 stays in trajectory.task / phase 【业务数据】blocks — do not conflate.
 */

/**
 * @typedef {object} BusinessDataEntry
 * @property {number} [id] 主键
 * @property {number|null} [businessDataId] 归属业务数据 id
 * @property {number|null} [trajectoryId] 归属轨迹 id
 * @property {string} fieldKey 字段键
 * @property {string|null} [fieldValue] 字段值
 * @property {string} createdAt 创建时间
 * @deprecated Legacy KV. Prefer SystemRefEntry.
 */

/**
 * System reference header — values captured from the *target system*
 * (and optionally verified for reuse). Not user requirement 业务数据.
 * @typedef {object} SystemRefData
 * @property {number} [id] 主键
 * @property {number|null} [trajectoryId] 归属轨迹 id
 * @property {string} [sessionId] 会话标识
 * @property {string} recordId 记录 UUID
 * @property {'system_capture'|'manual'|'import'} [source] 来源
 * @property {'raw'|'verified'|'rejected'} [verificationStatus] 校验状态
 * @property {string} [description] 描述
 * @property {number} [keyCount] 键值对数量
 * @property {Record<string, unknown>|null} [rawJson] 原始 JSON
 * @property {string} [createdAt] 创建时间
 * @property {string} [updatedAt] 更新时间
 * @property {SystemRefEntry[]} [entries] 关联条目
 */

/**
 * @typedef {object} SystemRefEntry
 * @property {number} [id] 主键
 * @property {number} [systemRefDataId] 归属引用数据 id
 * @property {number|null} [trajectoryId] 归属轨迹 id
 * @property {string} fieldKey 字段键
 * @property {string|null} [fieldValue] 字段值
 * @property {'system_capture'|'manual'|'import'} [source] 来源
 * @property {'raw'|'verified'|'rejected'} [verificationStatus] 校验状态
 * @property {string|null} [verifiedAt] 校验时间
 * @property {string} [createdAt] 创建时间
 */

/**
 * @typedef {object} FormSnapshot
 * @property {number} [id] 主键
 * @property {string} container 表单容器标识
 * @property {number} [fieldCount] 字段总数
 * @property {number} [requiredCount] 必填字段数
 * @property {number} [optionalCount] 可选字段数
 * @property {number} [actionIndex] 动作序号
 * @property {number|null} [triggerStepId] 触发步骤 id
 * @property {number|null} [businessDataId] 关联业务数据 id
 * @property {number|null} [trajectoryId] 归属轨迹 id
 * @property {string} createdAt 创建时间
 * @property {SnapshotField[]} [fields] 字段列表
 */

/**
 * @typedef {object} SnapshotField
 * @property {number} [id] 主键
 * @property {number} formSnapshotId 归属快照 id
 * @property {string} label 字段标签
 * @property {boolean} [isRequired] 是否必填
 * @property {string} createdAt 创建时间
 */

/**
 * @typedef {object} Screenshot
 * @property {number} [id] 主键
 * @property {'db'|'minio'|'local'} [storageType] 存储类型
 * @property {number} [retryCount] 重试次数
 * @property {string|null} [lastRetryAt] 最近重试时间
 * @property {string|null} [storagePath] 存储路径
 * @property {string|null} [imageUrl] 图片 URL
 * @property {number} [fileSize] 文件大小
 * @property {string} [mimeType] MIME 类型
 * @property {number|null} [trajectoryId] 归属轨迹 id
 * @property {number|null} [trajectoryStepId] 归属步骤 id
 * @property {number|null} [trajectoryPhaseId] 归属阶段 id
 * @property {'before'|'after'|'phase_highlight'|'page_level'} [kind] 截图类型
 * @property {string} createdAt 创建时间
 */

/**
 * @typedef {object} ApiOverride
 * @property {number} [id] 主键
 * @property {string} name 规则名称
 * @property {string} urlPattern URL 匹配模式
 * @property {import('./constants.js').ApiOverrideMatchType} [matchType] 匹配方式
 * @property {string} [httpMethod] HTTP 方法
 * @property {boolean} [enabled] 是否启用
 * @property {number} [respStatus] 响应状态码
 * @property {Record<string, string>|null} [respHeaders] 响应头
 * @property {string|null} [respBody] 响应体
 * @property {import('./constants.js').ApiOverrideScope} [scope] 作用域
 * @property {number|null} [scopeRefId] 作用域引用 id
 * @property {number} [sortOrder] 排序号
 * @property {string} createdAt 创建时间
 * @property {string} [updatedAt] 更新时间
 */

export {};
