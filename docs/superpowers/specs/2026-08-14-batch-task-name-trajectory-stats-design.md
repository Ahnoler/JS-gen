# Design: 批量导入任务名称 + 轨迹列表统计（batchTaskName）

**Date:** 2026-08-14
**Status:** Approved — 待实现计划
**Trigger:** 产品需求（批量导入任务管理）：① 批量导入任务增加「任务名称」，默认格式 `导入文件名+月日-时分`（例：`批量录制导入模板_0814-1251`）；② `trajectory` 增加列绑定批量任务外键（可空）；③ `GET /api/v2/trajectories` 增加 `batchTaskName` 查询字段（模糊）+ 行返回所属任务名（空=手动创建）+ 返回「共 n 条（含草稿 a 条，占用中 b 条……）」统计。
**Related:** [batch task progress](2026-08-13-batch-task-progress-phase-done-design.md)；[batch import sys-msg](2026-08-13-batch-import-sys-msg-design.md)；[batch draft mode](2026-08-07-batch-draft-mode-design.md)；`docs/superpowers/todo-list.md`（PR-BATCH）；Vue `BatchImportDialog.vue` / `stores/batchImport.ts` / `api/recording.ts` / `messageDrawer.vue`（另仓 `D:\dev\ui-auto-recording-agent-vue-master`）

## Problem

1. 批量导入任务无名称：前端任务卡只显示 `functionName + mode + 截断 batchId`（`BatchImportDialog.vue:236-241`），同模板多次导入无法区分。
2. 轨迹列表无「所属批量任务」维度：不能按任务名查询，也不能区分批量创建与手动创建。
3. 轨迹列表无状态统计：产品要「共 n 条（含草稿 a 条，占用中 b 条……）」的分布概览。

## Goals

1. `batch_recording_job` 增加 `name` 列（默认公式生成），存量回填；创建时可选自定义、创建后不可改。
2. `trajectory` 增加 `batch_job_id` 外键（可空，→ `batch_recording_job.id`）；批量链路创建的轨迹自动绑定；手动创建为 NULL。
3. `GET /api/v2/trajectories`：新增查询参数 `batchTaskName`（模糊）、每行返回 `batchTaskName`、响应新增 `stats` 五档统计。
4. 不破坏现有 `sys_msg` 批量导入终态消息展示。
5. Vue 另仓：任务卡显示名称、可选名称输入框、修复消息深链 bug。

## Non-goals

- 不新建 `batch_task` 表（用户拍板 C 方案：在 `batch_recording_job` 上加列）。
- 不改 `record_status` 枚举与流转（未来演进见「Future work」TODO）。
- 任务名称创建后不可改（无改名端点）。
- 不改 sys_msg 正文/标题/`source_id`；新 `name` 不进消息正文。
- 轨迹列表 stats 只按 record_status 五档统计；不做时间区间/按人维度。
- 不做用户隔离（PR-BATCH ①，等 PR-USER / PR-SSO-ADMIN）。

## Locked decisions

| # | Decision |
|---|----------|
| 1 | 实体方案 C：不建 `batch_task` 表；`batch_recording_job` 加 `name` 列；`trajectory` 加 `batch_job_id` 外键。 |
| 2 | API 字段 camelCase `batchTaskName`（查询参数与行字段同名）；DB 列名 `name` / `batch_job_id`。 |
| 3 | 名称生命周期：创建时可选传 `name`，缺省用默认公式；创建后不可改（Idempotency-Key 重放 first-wins）。 |
| 4 | 默认公式：去扩展名文件名 + `_MMDD-HHmm`（服务器本地时区，取 job `created_at`）。 |
| 5 | 存量回填：迁移内对现有 job 行按同一公式补 `name`，历史任务无空名。 |
| 6 | 轨迹列表 stats：`{ total, draft, live, recording, recorded, completed }` 五档全出；与行查询同基准过滤、忽略 recordStatus 维度；单次 GROUP BY，不随分页。 |
| 7 | Vue 消息深链 bug（`messageDrawer.vue:80` 引用未定义的 `batchIdFromLink`）本次一并修复（另仓）。 |
| 8 | sys_msg 消息内容/格式/触发逻辑完全不动；`characterize-sys-msg.mjs` 不改。 |
| 9 | `init.sql` 只补 `trajectory.batch_job_id` 列+索引；FK 约束不写入 init.sql（batch 表至今不在 init.sql，写 FK 会导致新库初始化失败——已知债务，如实记录）。 |
| 10 | `name VARCHAR(512) NOT NULL DEFAULT ''`（对齐 `original_filename` 512 + 后缀 11 字符，文件名部分截断 501）。 |

## Architecture

```text
POST /api/v2/trajectories/batch/import  (multipart + 可选 name)
  → importBatchFromExcel({ ..., name })
    → batchDao.createJob({ ..., name: name || defaultJobName(originalFilename, createdAt) })
        INSERT batch_recording_job (含 name)

批量分析链路（batch-analyze.js:176）
  → createTransactionWithPhases({ ..., batchJobId: job.id })
    → trajectoryDao.save({ ..., batchJobId })   -- trajectory.batch_job_id = job.id
  （手动创建轨迹不传 batchJobId → NULL）

GET /api/v2/trajectories?batchTaskName=xxx
  LEFT JOIN batch_recording_job bj ON bj.id = t.batch_job_id
  WHERE bj.name LIKE %xxx%（可空跳过）
  rows[].batchTaskName = bj.name | null
  stats: 同基准（忽略 recordStatus）GROUP BY record_status + total
```

## Data model

### 迁移 1：`batch_recording_job.name` + 存量回填

- `ALTER TABLE batch_recording_job ADD COLUMN name VARCHAR(512) NOT NULL DEFAULT '' COMMENT '任务名称；默认 文件名_MMDD-HHmm'`。
- 迁移 `up()` 内遍历现有行：`name = defaultJobName(row.original_filename, row.created_at)` 逐行 UPDATE。行数规模小（单任务表），无性能风险。
- 公式抽成共享纯函数（如 `src/services/trajectory/batch-job-name.js`），迁移与运行时共用，避免两份实现漂移。

### 迁移 2：`trajectory.batch_job_id` + 索引 + FK

- `ALTER TABLE trajectory ADD COLUMN batch_job_id VARCHAR(36) NULL COMMENT '所属批量导入任务（batch_recording_job.id，UUID）；NULL=手动创建'`，`ADD INDEX idx_batch_job_id`。
- FK：`CONSTRAINT fk_traj_batch_job FOREIGN KEY (batch_job_id) REFERENCES batch_recording_job (id) ON DELETE SET NULL`（MySQL 加 FK 需索引已存在）。
- ⚠️ job.id 是 UUID string(36)（`migrations/20260802140000_batch_recording_jobs.js:9`），`batch_job_id` 必须同类型。
- `schemas/init.sql`：trajectory 表定义补 `batch_job_id` 列 + `idx_batch_job_id` 索引；**不写 FK**（init.sql 无 batch 表）。

## Default name formula

```
defaultJobName(originalFilename, createdAt):
  base = stripExtension(originalFilename)          // 去掉最后一个 .xlsx/.xls 等扩展名
  base = base || '批量导入'                          // 文件名为空兜底
  base = base.slice(0, 501)                          // 截断，给后缀留位
  ts = formatLocal(createdAt, 'MMDD-HHmm')           // 服务器本地时区，如 0814-1251
  return `${base}_${ts}`
```

- 示例：`批量录制导入模板.xlsx` + 2026-08-14 12:51 → `批量录制导入模板_0814-1251`。
- 时区：与库内 `created_at`（`knex.fn.now(3)`，服务器本地）语义一致，直接用创建时间格式化。
- 幂等：Idempotency-Key 重放返回已有 job（现状行为），名称 first-wins。
- 同名不设唯一约束（同分钟同文件两次上传允许同名，靠 batchId 区分）。

## Creation chain & batch view

- `POST /api/v2/trajectories/batch/import`（`src/routes/v2/trajectory-batch.js:36-66`）：multipart 增加可选字段 `name`（`req.body?.name`），透传 `importBatchFromExcel`。
- `src/dao/batch-recording-dao.js:37 createJob`：写入 `name: job.name || defaultJobName(...)`。
- `GET /api/v2/trajectories/batch/:batchId` → `getBatchJobView`：响应顶层加 `name`。WS `batch:progress` 事件**不动**（前端轮询拿 job 视图，YAGNI）。
- `src/services/sys-msg-compose.js` 与 `notifyBatchTerminalMessage` **不动**：继续读 `original_filename`/summary/status，name 不进消息。

## Trajectory list API

`GET /api/v2/trajectories`（`src/routes/v2/trajectory.js:57-92`）：

- 新查询参数 `batchTaskName`（string，可空）：转 `LIKE %值%` 模糊；空值跳过该条件。
- 查询改造：`trajectoryDao.list` 与 `trajectoryService.listByFunction` 两条路径共用同一套助手（join + 过滤 + stats），避免行为分叉。
- 响应行新增：`batchTaskName: string | null`（NULL = 手动创建）。
- 响应新增 `stats`：

```json
{
  "rows": [ { "...": "...", "batchTaskName": "批量录制导入模板_0814-1251" } ],
  "total": 42,
  "page": 1,
  "pageSize": 20,
  "stats": { "total": 42, "draft": 8, "live": 2, "recording": 5, "recorded": 20, "completed": 7 }
}
```

- stats 口径：与行查询**同基准过滤**（functionId / keyword / batchTaskName），**忽略 recordStatus**（切换状态 Tab 时各档计数保持稳定）；单次 `GROUP BY record_status` 查询；`stats.total` = `total`。
- 兼容：旧前端只读 `rows/total`，新增字段零破坏（Vue 调研确认 `index.vue:63-90` 无同名冲突）。

## Compatibility protections（需求硬约束）

- sys_msg：消息正文两行格式（功能名/文件名/状态/统计）被 `characterize-sys-msg.mjs` 钉死——本次**不碰**该文件与消息链路。
- `characterize-sys-msg.mjs`、`characterize-batch-import.mjs`、`characterize-batch-task-progress.mjs` 回归必须全绿。
- 新增 `scripts/characterization/characterize-batch-task-name.mjs`：断言迁移列存在、公式样例输出、回填逻辑、job 视图含 name、trajectory 行含 `batchTaskName`、stats 五档求和 = total。
- 四件套：迁移 + `schemas/init.sql` + `CHANGELOG.md [Unreleased]` 条目（说明影响范围 + Python 同步提示）+ commit 后 post-commit 同步检查。

## Vue 另仓改动清单（`D:\dev\ui-auto-recording-agent-vue-master\vue-project\src`）

1. `views/ui-recording/components/BatchImportDialog.vue`：可选「任务名称」输入框 → FormData 加 `name`；任务卡显示 `name`（fallback 现有 batchId 截断展示）。
2. `components/Header/components/messageDrawer.vue:80`：修复 `batchIdFromLink` 未定义 bug（相对 linkUrl 解析 batchId 深链），恢复消息→批量任务跳转。
3. `api/recording.ts` + `types/index.ts`：类型补 `name` / `batchTaskName` / `stats`（消费可选）。

## Verification

- `node --check` 全部改动文件。
- 新增 `characterize-batch-task-name.mjs` 通过；`characterize-trajectory.mjs`、`characterize-sys-msg.mjs` 等既有脚本回归全绿。
- `bash scripts/refactor/verify-all.sh` 重构门禁通过。
- 手工冒烟：起服务 → 带/不带 `name` 各导入一次 → 断言 job 视图 `name`；`?batchTaskName=模板` 模糊命中；stats 五档求和 = total；回填后旧任务名非空；消息抽屉展示不变。

## Future work (TODO)

- **轨迹状态枚举演进**：现有 `record_status` 五态（`draft` 空闲 / `live` 推流占用 / `recording` AI录制中 / `recorded` 录制完成 / `completed` 人工确认）将改为：**未录制 / 录制中 / 录制异常 / 待确认 / 已确认**。具体状态流转需求在实际开发时阐明产品需求；本次沿用现有流转。届时 `stats` 键名与前端映射随枚举调整（本次按现枚举出五档，字段名即现枚举值，前端映射层预留文案表）。

## Implementation split（multi-agent，文件集无交集）

| 分工 | 文件集 |
|------|--------|
| A：迁移 + init.sql | `migrations/20260814100000_batch_job_name.js`、`migrations/20260814110000_trajectory_batch_job.js`、`schemas/init.sql` |
| B：后端名称链 | `src/services/trajectory/batch-job-name.js`（新）、`src/dao/batch-recording-dao.js`、`src/services/trajectory/trajectory-batch-service.js`、`src/routes/v2/trajectory-batch.js` |
| C：轨迹绑定 + 列表 join/stats | `src/services/trajectory/trajectory-meta-service.js`、`src/services/trajectory/batch-analyze.js`、`src/dao/trajectory-dao.js`、`src/services/trajectory-service.js`、`src/routes/v2/trajectory.js` |
| D：验证资产 + CHANGELOG | `scripts/characterization/characterize-batch-task-name.mjs`（新）、`CHANGELOG.md` |
| E：Vue 另仓 | `BatchImportDialog.vue`、`messageDrawer.vue`、`api/recording.ts`、`types/index.ts` |

A–E 文件集无交集可并行；主线程收尾：重跑关键验证、审查 CHANGELOG 格式与越界改动、跑 `verify-all.sh`。
