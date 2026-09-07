# JSDoc 注释规范

本项目（JS-gen）的函数注释规范。核心原则：**核心公开函数必须有 JSDoc，内部小函数可省略**。

---

## 1. 适用范围

### 必须写 JSDoc
- **导出函数**（`export function` / `export const x = () =>` / `export default function`）
- **路由端点**（`app.METHOD(path, handler)` 每个端点上方）
- **公开 service / dao 方法**
- **类方法**（公开接口）

### 可省略
- 私有 helper（未导出、仅文件内部使用）
- 回调函数、Promise `.then/catch` 内联箭头函数
- 一行纯转发函数（如 `export function isScriptExecuting() { return _isExecuting; }`）

---

## 2. 文件头规范

每个 `src/` 文件**必须有文件头 JSDoc**，描述模块职责。

```js
/**
 * Shared Playwright script execution for /api/test/run and trajectory replay.
 */
```

路由文件可附带 URL prefix：

```js
/**
 * Export / batch-push management — legacy-engine + partner transaction push.
 *
 * Prefix: /api/v2/export/*
 */
```

> 参考：`src/dedup.js:1-9`、`src/routes/v2/export-mgmt.js:1-5`、`src/runtime/script-runner.js:1-3`

---

## 3. 函数 JSDoc 模板

### 模板 A — 简单单行

逻辑简单、参数自解释时用单行：

```js
/** Broadcast the current session list (sessions:updated) to all WS clients. */
export function broadcastSessions() {
```

> 参考：`src/routes/browser-session/broadcasts.js:12`

### 模板 B — 标准多行（含 @param / @returns）

```js
/**
 * Call the LLM chat-completions endpoint and return the assistant message content.
 * @param {string} text user prompt text
 * @param {string|object} [model] model id or model object; falls back to LLM_MODEL
 * @returns {Promise<string>} assistant message content (empty string if none)
 */
export async function callLLM(text, model) {
```

要点：可选参数用 `[name]`，类型标注 `{Type}` 必带。

> 参考：`src/llm-utils.js:15-20`

### 模板 C — 复杂 opts 解构（嵌套 @param）

参数为解构对象时，逐字段标注：

```js
/**
 * Close a session on the executor and release its control-plane lease.
 * @param {object} opts 会话关闭选项
 * @param {string} opts.nodeUuid 节点UUID
 * @param {string} opts.sessionId 会话ID
 * @param {boolean} [opts.keepBrowser] 是否保留Chrome用于CDP复用（默认false）
 * @param {number} [opts.timeoutMs] timeout ms
 * @returns {Promise<void>} 无返回值
 */
export async function closeSession({
  nodeUuid,
  sessionId,
  keepBrowser = false,
  timeoutMs = 15000,
```

要点：`@param {object} opts` 先声明根对象，再 `@param {string} opts.nodeUuid` 逐字段；可选字段加 `[]`；回调类型用函数签名标注。

> 参考：`src/executor-session-client.js:312-320`

### 模板 D — DAO / Service 带 Promise 返回类型

```js
/**
 * 五档统计：与行查询同基准过滤（functionId/keyword/recordStatus/batchTaskName）。
 * @returns {Promise<{ total: number, draft: number, recording: number, failed: number, recorded: number, completed: number }>}
 */
export async function countByRecordStatus({ functionId = null, ... } = {}) {
```

要点：`async` 函数用 `@returns {Promise<{...}>}`；中文描述允许，但同一文件内保持一致。

> 参考：`src/dao/trajectory-dao.js:91-103`

---

## 4. 路由 handler 规范

- 文件头 JSDoc 描述模块职责 + URL prefix
- 每个 `app.METHOD(path, handler)` 上方加**单行 JSDoc** 说明端点用途
- **不强制**标注 `@param req/res`（Express 类型重复，项目惯例省略）

```js
/** AI 分析：需求描述 -> { phases }（不落库；阶段数跟用户分步；业务数据附在各阶段描述后） */
app.post('/api/v2/trajectories/analyze', asyncHandler(async (req, res) => {
```

> 参考：`src/routes/v2/trajectory.js:15`

---

## 5. 类型标注要点

| 场景 | 写法 |
|---|---|
| 基本类型 | `@param {string} name`、`@param {number} id`、`@param {boolean} flag` |
| 可空 | `@param {number\|null} code` |
| 可选参数 | `@param {string} [logSuffix]` |
| 数组 | `@param {string[]} list`、`@param {object[]} entries` |
| 对象解构 | 先 `@param {object} opts`，再 `@param {string} opts.field` 逐字段 |
| Promise 返回 | `@returns {Promise<{ total: number }>}` |
| 无返回值 | `@returns {void}` |
| 回调/函数 | `@param {(line: string) => void} onLine` |
| 动态导入类型 | `@type {import('ws').WebSocket\|null}` |

---

## 6. 语言策略

- 中文、英文均可，但**同一文件内保持一致**
- 现有代码中英混排常见（如 `trajectory-dao.js` 用中文描述），新增注释跟随所在文件的风格
