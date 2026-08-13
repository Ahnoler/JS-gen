# Design: 批量导入终态消息（sys_msg，第一种消息类型）

**Date:** 2026-08-13  
**Status:** Awaiting user review before implementation plan  
**Trigger:** Vue 消息抽屉已接 `message.ts`（`GET /v2/messages`、未读数、全部已读）；批量导入提示改到消息模块。用户管理未做，相关字段挂起。  
**Related:** [batch draft mode](2026-08-07-batch-draft-mode-design.md)；[batch task progress](2026-08-13-batch-task-progress-phase-done-design.md)；Vue `vue-project/src/api/message.ts`、`messageDrawer.vue`；公司消息样例（`msgType` 字典、`belongItemName`）

## Problem

批量导入结束只有弹窗/本机任务列表能看到结果。产品消息抽屉已画好，控制面没有消息表和 `/v2/messages*`。需要第一种类型：**批量导入任务**，终态一条，展示文件名、交易概况统计、任务状态、所属功能。

## Goals

1. 建 `sys_msg` 表；`msgType` 进现有 `sys_dict_*`（`sys_msg_type`）。  
2. 批量任务第一次进入终态时插入一条消息。  
3. 正文只含：功能名、上传文件名、任务状态、概况统计。标题固定「批量导入任务」。  
4. `linkUrl` 打开该任务：`/ui-recording?batchId=<uuid>`。  
5. 列表 / 未读数 / 单条已读 / 全部已读，对齐现有抽屉。  
6. `user_id` 等用户字段可空；现阶段全员同一份列表、同一份已读。

## Non-goals

- Vue 改动（类型标签、点消息 POST 已读、`?batchId=` 打开弹窗）——另仓跟进。  
- 用户隔离 / 按人已读（等任务管理 / PR-USER）。  
- 历史已结束任务补写消息。  
- 第二种及以后的消息类型。  
- 上传文件下载链（文件未必落盘）。  
- 进度中更新同一条消息；开始+结束两条流水。  
- 消息创建/删除管理 API。

## Locked decisions

| # | Decision |
|---|----------|
| 1 | 落库方案：独立 `sys_msg` 表；不从 `batch_recording_job` 虚拟拼列表。 |
| 2 | 写入时机：任务终态插一条（`completed` / `completed_with_errors` / `failed` / `cancelled`）。进度不写。 |
| 3 | 标题：`msgTitle` = `workItemName` = 字典标签「批量导入任务」。四块业务信息全在 `msgContent`。 |
| 4 | 正文两行（见下）；卡片点击走 `linkUrl`，正文不嵌「查看执行结果」。 |
| 5 | `linkUrl` = `/ui-recording?batchId=<job.id>`（相对路径；前端用路由跳，不要 `window.open` 到错误 host）。 |
| 6 | 已读：`msg_status` `0` 未读 / `2` 已读（对齐抽屉 `=== 2`）。点一条 `POST /v2/messages/:id/read`；另有全部已读。 |
| 7 | 可见性：用户管理前全员同一份列表；点已读改这一行 = 全员已读。以后再拆按人已读。 |
| 8 | `msg_type` 字典：`dict_type=sys_msg_type`，第一条 `dict_value=1`、`dict_label=批量导入任务`。列表多返回 `msgTypeLabel`。 |
| 9 | 统计只读 `summarizeJob` + job 行（文件名、`function_id`、`status`），不扫 item 明细。 |
| 10 | 幂等：`UNIQUE(source_type, source_id)`，`source_type=batch_import`，`source_id=batchId`。 |
| 11 | 写消息失败只打日志，不回滚任务、不挡 `batch:done`。 |
| 12 | 历史终态任务不补写。 |

## Architecture

```text
maybeFinalizeJob 第一次把 job.status 写成终态
  → try insertSysMsgFromBatchJob(job, summary)
       lookup 功能名 (system.id = function_id)
       lookup 字典标签 sys_msg_type / 1
       compose msgContent
       INSERT sys_msg  (ignore duplicate source)

GET  /api/v2/messages            → { rows, total }
GET  /api/v2/messages/unread-count → { count }
POST /api/v2/messages/:id/read
POST /api/v2/messages/read-all
```

**写入主路径：** `src/services/trajectory/trajectory-batch-service.js` 的 `maybeFinalizeJob`，在 `forceUpdateJob` 终态成功之后调用共享 helper。取消分支（`status=cancelled`）同样调用。

**禁止写入：** `batch:progress`、import 受理、item 状态变化。

Helper 建议拆：

- `src/services/sys-msg-compose.js` — 纯函数：状态中文 + 两行正文（便于 characterization）。  
- `src/services/sys-msg-service.js` — 插入 / 列表 / 已读。  
- `src/dao/sys-msg-dao.js` — 表访问。  
- `src/routes/v2/messages.js` — 四条 HTTP；`unread-count`、`read-all` 注册在 `/:id/read` 之前。

## Storage

### `sys_msg`

```sql
CREATE TABLE `sys_msg` (
  `id`               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `msg_title`        VARCHAR(128) NOT NULL DEFAULT '' COMMENT '展示标题；第一种=批量导入任务',
  `msg_content`      TEXT NOT NULL COMMENT '两行 HTML：功能·文件·状态 / 统计；用户字段已转义',
  `msg_type`         INT NOT NULL COMMENT 'sys_dict_data.dict_value (sys_msg_type)',
  `msg_status`       TINYINT NOT NULL DEFAULT 0 COMMENT '0未读 2已读（现阶段全局）',
  `link_url`         VARCHAR(512) NOT NULL DEFAULT '',
  `belong_item_name` VARCHAR(255) NOT NULL DEFAULT '' COMMENT '功能名',
  `belong_item_id`   BIGINT UNSIGNED NULL COMMENT 'system.id type=3',
  `source_type`      VARCHAR(32) NOT NULL DEFAULT '' COMMENT 'batch_import',
  `source_id`        VARCHAR(64) NOT NULL DEFAULT '' COMMENT 'batch UUID',
  `product_code`     VARCHAR(64) NULL COMMENT '挂起',
  `create_by`        VARCHAR(64) NOT NULL DEFAULT '系统',
  `user_id`          BIGINT UNSIGNED NULL COMMENT '挂起',
  `user_flag`        TINYINT NULL COMMENT '挂起',
  `rule_id`          BIGINT UNSIGNED NULL COMMENT '挂起',
  `remark`           VARCHAR(500) NULL,
  `create_time`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `update_time`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY `uk_sys_msg_source` (`source_type`, `source_id`),
  KEY `idx_sys_msg_created` (`create_time`),
  KEY `idx_sys_msg_status` (`msg_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='产品消息';
```

`schemas/init.sql` 同步。不建 FK 到 `batch_recording_job`（任务删了消息仍可留着）。

### 字典种子

`sys_dict_type`：`dict_name=消息类型`，`dict_type=sys_msg_type`。  
`sys_dict_data`：`dict_type=sys_msg_type`，`dict_value=1`，`dict_label=批量导入任务`，`dict_sort=1`，`status=0`。

迁移对已有库 `INSERT` 种子；`dict_type` 已存在则跳过类型行。

## 正文

任务状态中文（代码表，不做第二本字典）：

| `batch_recording_job.status` | 文案 |
|---|---|
| `completed` | 已完成 |
| `completed_with_errors` | 已完成（有失败） |
| `failed` | 失败 |
| `cancelled` | 已取消 |

统计数字来自现有 `summarizeJob`：`total`、`accepted`（= total − rejected）、`rejected`、`drafted`、`recorded`、`failed`。缺字段当 0。

模板（两行）。抽屉 `v-html` + 两行截断，行间用 `<br>`；功能名、文件名做 HTML 转义，禁止未转义拼接。

```
{功能名} · {文件名} · {任务状态}<br>共 {total} 条 · 受理 {accepted} · 拒绝 {rejected} · 已存草稿 {drafted} · 已录制 {recorded} · 失败 {failed}
```

例：

```
对公客户管理 · 客户导入.xlsx · 已完成
共 3 条 · 受理 3 · 拒绝 0 · 已存草稿 0 · 已录制 3 · 失败 0
```

缺功能名或文件名：该段省略，不要留下 `· ·`。`mode=draft` 同一套统计（已录制常为 0）。

`create_time` 接口格式 `YYYY-MM-DD HH:mm:ss`（与公司样例一致）。

## HTTP

统一 `/api/v2` 信封 `{ code, message, data }`。Vue `baseURL=/api`，路径与 `message.ts` 一致。`pageNum`（不是 `page`），默认 `pageSize=20`。

列表 `data`：

```json
{
  "rows": [
    {
      "msgId": 1,
      "msgTitle": "批量导入任务",
      "workItemName": "批量导入任务",
      "msgContent": "对公客户管理 · 客户导入.xlsx · 已完成<br>共 3 条 · 受理 3 · 拒绝 0 · 已存草稿 0 · 已录制 3 · 失败 0",
      "msgType": 1,
      "msgTypeLabel": "批量导入任务",
      "msgStatus": 0,
      "createTime": "2026-08-13 16:00:00",
      "createBy": "系统",
      "belongItemName": "对公客户管理",
      "linkUrl": "/ui-recording?batchId=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
    }
  ],
  "total": 1
}
```

| 方法 | 路径 | data | 备注 |
|------|------|------|------|
| GET | `/api/v2/messages` | `{ rows, total }` | `pageNum` + `pageSize`；`create_time DESC` |
| GET | `/api/v2/messages/unread-count` | `{ count }` | `msg_status <> 2` |
| POST | `/api/v2/messages/:id/read` | `{ success: true }` | 已是已读仍 200；无此 id → HTTP 404 |
| POST | `/api/v2/messages/read-all` | `{ success: true }` | 把未读改为 2 |

空表：`rows=[]` / `count=0`，不要 500。无创建/删除接口。

## Error handling

- 插入冲突（重复 `source`）：视为成功，不更新已有正文（终态快照保持第一次）。  
- 功能节点查不到：`belong_item_name` 空，正文省略功能名。  
- 字典缺失：`msg_title` 回退字面量「批量导入任务」，`msg_type` 仍写 `1`。  
- 写消息抛错：`console.warn`，`maybeFinalizeJob` 照常返回。

## Frontend follow-up（本仓不改 Vue）

抽屉现状：类型标签写死 `1=系统`；点消息只改本地 `msgStatus`；`window.open(linkUrl)`。需要另仓：

1. 类型标签优先 `msgTypeLabel`。  
2. 点消息调用 `POST /v2/messages/:id/read`。  
3. `linkUrl` 用 `router.push`（或等价）；解析 `?batchId=` → 打开 `BatchImportDialog` 并 `GET /v2/trajectories/batch/:id`（本机 localStorage 没有该任务也能看）。

## Testing

Characterization（无浏览器）：

1. 正文模板：完整字段、缺文件名、缺功能名、draft 统计。  
2. 状态文案四态。  
3. HTML 转义（文件名含 `<`）。  
4. 终态才插入；重复 finalize 不双插。  
5. 写消息抛错不影响 finalize 返回值。  
6. 四条 HTTP 形状（可用现有 v2 信封测试手法）。

跑：相关 characterize 脚本 + `node --check` 改动的 js。迁移本地可执行时跑一次。

## Docs / sync

- `CHANGELOG.md` `[Unreleased]` Fixed/Added：消息表 + 四条 API + 字典 `sys_msg_type`。  
- `/api/docs` 新分组或挂系统管理旁。  
- Python 同步提示：新表 `sys_msg`、字典种子、`/api/v2/messages*`；无用户过滤。

## File sketch

| File | Role |
|------|------|
| `migrations/YYYYMMDDHHMMSS_sys_msg.js` | 表 + 字典种子 |
| `schemas/init.sql` | 同步 DDL + 种子 |
| `src/dao/sys-msg-dao.js` | CRUD |
| `src/services/sys-msg-compose.js` | 纯函数正文 |
| `src/services/sys-msg-service.js` | 插入 + 列表 + 已读 |
| `src/routes/v2/messages.js` | 四条路由 |
| `src/routes/v2/__init__.js` | 注册 |
| `src/services/trajectory/trajectory-batch-service.js` | `maybeFinalizeJob` 挂钩 |
| `src/dashboard/api-docs/groups/*.js` | 文档 |
| `scripts/characterization/characterize-sys-msg.mjs` | 钉模板与幂等 |
