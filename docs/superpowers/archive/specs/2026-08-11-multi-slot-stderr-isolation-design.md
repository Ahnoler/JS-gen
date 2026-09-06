# 多 slot Agent stderr 隔离与导出设计

**日期：** 2026-08-11  
**状态：** Implemented 2026-08-11 — plan `docs/superpowers/plans/2026-08-11-multi-slot-stderr-isolation.md`  
**动机：** 缺陷 1448052（AI 录制循环重复）等需要按 slot / session 读日志；多 slot 共用 stderr 时难定位。  
**参照：** `tmp/提取日志/logAnalysis.py`（按 `[slot:N]` 滤行）。

## 1. 目标与非目标

### 目标

- 执行机每行 stderr 带稳定前缀：`[slot:N sid:<sessionId前8位>]`
- 经现有执行机 WS 转发到控制面，**控面落盘**（方案 B2）
- 提供活动会话目录：查 `remote_session` 占用中的远程连接 → 看到 slot 上正在跑的交易
- 按 `slot` / `sid` / `sessionId` / `trajectoryId` 导出过滤后的日志（对齐 logAnalysis 语义）
- 接口进入 **API Docs「交易录制」分组**（`GROUP_RECORDING`）

### 非目标

- 不改产品录制主流程 UI
- 不替代业务操作日志（`log_{ts}.txt` / trajectory_log）
- 不做无限期归档（清理策略可后补）
- 本刀不修 1448052 合约本身（本刀只解决「能定位」）

## 2. 现状

| 点 | 现状 |
|----|------|
| 执行机 stderr | `SessionSlot` 已写 `[slot:N] ${chunk}`，但 chunk 多行时只有首行有前缀 |
| 多 slot | 全部打进执行机同一 `process.stderr`，交织 |
| sessionId | 事件里有，stderr 前缀没有 |
| remote_session | 已有 `status`（active/idle/…）、`slot_index`、`agent_session_id`、`trajectory_id`、`executor_node_id` |
| lease | 内存 `slotIndex` ↔ `sessionId` ↔ `trajectoryId` |
| 导出 | 仅本地脚本硬过滤 `[slot:0]` |

## 3. 数据流

```
Python agent stderr
  → executor SessionSlot 行缓冲 + 前缀
  → 本地 stderr（盯屏）
  → WS session.agent_stderr { sessionId, slotIndex, lines[] }  （批量/限流）
  → 控制面追加 logs/agent-stderr/{sessionId}.log
  → GET 交易录制分组接口：active 目录 / 按 slot|sid|… 导出
```

## 4. 前缀与落盘

### 4.1 行前缀

```
[slot:1 sid:a1b2c3d4] <original line>
```

- `N` = `slotIndex`（整数）
- `sid` = `sessionId` 去掉连字符后的前 8 位小写 hex（或 UUID 前 8 字符，实现时固定一种并文档化）
- **每行**都带前缀（行缓冲后再写/上报）

### 4.2 WS 事件

```json
{
  "type": "session.agent_stderr",
  "payload": {
    "sessionId": "完整 uuid",
    "slotIndex": 1,
    "lines": ["[slot:1 sid:a1b2c3d4] ...", "..."]
  }
}
```

限流：约每 200ms 或满 50 行 flush；丢弃策略：背压时丢最旧缓冲（诊断可接受）。

### 4.3 控面文件

- 目录：`logs/agent-stderr/`（gitignore；可用 env 覆盖根路径）
- 文件：`{sessionId}.log`（一行一条，已含前缀）
- session close 后文件保留，便于事后查 1448052；清理另议

## 5. HTTP 接口（交易录制分组）

路径挂在录制域；**编入** `src/dashboard/api-docs/groups/recording.js` 的 `GROUP_RECORDING`（与 `/api/v2/executors` 同类工程辅助接口同组）。

避免与 `/api/v2/trajectories/:id` 抢路由：集合接口用 `/api/v2/recording/agent-stderr*`；单交易快捷用 `/{id}/agent-stderr`。

### 5.1 活动目录 — 谁在跑

`GET /api/v2/recording/agent-stderr/active`

**数据源（交叉）：**

1. `remote_session` 中 `status ∈ {active, idle}`（`REMOTE_SESSION_OCCUPIED`）
2. 内存 lease（补 `nodeUuid` / 校验 slot）
3. `trajectory` 元数据（名称 / recordStatus，可选）

**响应示例：**

```json
{
  "rows": [
    {
      "slotIndex": 1,
      "sid": "a1b2c3d4",
      "sessionId": "a1b2c3d4-....",
      "trajectoryId": 42,
      "trajectoryName": "客户引入",
      "recordStatus": "recording",
      "remoteSessionId": 7,
      "remoteStatus": "active",
      "executorNodeId": 3,
      "executorNodeUuid": "node-uuid",
      "hasStderrLog": true
    }
  ]
}
```

用法：先看 active → 再按 `slot` / `sid` 导出。

### 5.2 按条件导出日志

`GET /api/v2/recording/agent-stderr`

| Query | 含义 |
|-------|------|
| `slot` | 整数；滤前缀 `[slot:N` |
| `sid` | 短 id；滤 `sid:xxxx` |
| `sessionId` | 完整 agent session；直接打开对应文件（再可选叠加 slot 滤） |
| `trajectoryId` | 经 remote_session / lease 解析出 sessionId 再读 |
| `format` | `text`（默认，`text/plain`）或 `json`（`{ lines, count, filter }`） |

规则（对齐 logAnalysis）：

- **至少**提供 `slot` / `sid` / `sessionId` / `trajectoryId` 之一，否则 **400**（禁止裸全量）
- 多条件 AND
- 无匹配文件 → 200 空正文或 `{ lines: [], count: 0 }`

### 5.3 单交易快捷

`GET /api/v2/trajectories/{id}/agent-stderr`

等价于 `?trajectoryId={id}`；同属交易录制分组。可选 `slot`/`sid` 再收窄（一般不需要）。

## 6. 实现落点（预估）

| 层 | 文件（预期） |
|----|----------------|
| 执行机行缓冲+上报 | `executor/session-slot.js`（+ 小 helper） |
| WS 入站 | `src/executor-ws.js` / event hub 路由 |
| 落盘 + 过滤 | 新 `src/services/agent-stderr-log-service.js` |
| active 组装 | 同上：remote-session-dao + lease + trajectory |
| 路由 | `src/routes/v2/`（recording 相关模块或独立小文件，注册顺序：静态路径先于 `:id`） |
| 契约 | `recording.js` GROUP_RECORDING + CHANGELOG（routes 变更） |

本地 `USE_EXECUTOR=false`：若本地 agent stderr 也接同一服务则一并前缀；否则本刀可只保证执行机路径，本地旁路另记。

## 7. 验收

1. 两 slot 同时跑：控台每行可见不同 `[slot:N sid:…]`，且两文件互不串行
2. `GET .../active` 能列出当前 remote 占用中的交易 + slot + sid
3. `GET .../agent-stderr?slot=0` 仅含 slot 0 行（logAnalysis 行为）
4. `?sid=` / `?trajectoryId=` / `/{id}/agent-stderr` 能命中同一份日志
5. `/api/docs` 交易录制分组可见上述端点

## 8. 与缺陷关系

| 项 | 关系 |
|----|------|
| 1448052 循环 | 本刀是定位前置；合约调整等新缺陷 + 可过滤日志后再做 |
| logAnalysis.py | 语义升格为控面 API；脚本可改为调 API 或读落盘文件 |

## 9. 决议摘要

- 架构：**B2**（执行机前缀转发 → 控面落盘 → 导出）
- 目录：`remote_session` occupied + lease + trajectory
- 文档分组：**交易录制**（非独立 debug 分组）
- 路径：`/api/v2/recording/agent-stderr*` + `/api/v2/trajectories/{id}/agent-stderr`
