# 批量推送 V3 数据结构去重优化 · 实施计划

日期：2026-08-18 · 前置：spec `docs/superpowers/specs/2026-08-18-batch-push-v3-dedup-design.md`
基线：当前分支 `uara_V1.2` 已存在 V3 代码/端点/文档，直接基于当前工作区改造。

## 目标

将当前 V3 的 `result.groups` 合并进 `transcationProperties`，去掉双轨结构，降低推送体体积：

- 保留 `transcationProperties` 作为唯一业务事件数组。
- 新增 `payload.screenshots` 统一存放页面/弹窗截图。
- 每条 `transcationProperty` 增加：
  - `scanIndex`（全局顺序）
  - `type`
  - `id`
  - `pid`
  - `label`
  - `regionId`
  - `regionLabel`
  - `rect`
- 不在属性里重复输出 `url`，通过 `pid` 关联 `payload.screenshots`。
- 删除 `result` / `result.groups`。
- 删除无用字段：`recorded`、`manualRecord`、`targetType`、`group`、`anchorTarget`、`anchorPropertiesName`、`placeholder`、`title`、`disabled`、`required`、`readonly`、`value`。
- 保留 V2 五个核心字段 + `options` / `mothed` / `transcationType`。
- `bucket` 通过 `.env` 配置，不写死。

---

## 任务拆分（TDD：先 characterization 后实现）

### Task 0: 确认 V3 基线

- 确认当前工作区已存在：
  - `src/services/transaction-export-v3.js`
  - `src/routes/v2/export-mgmt.js` 中的 V3 端点
  - `src/dashboard/api-docs/groups/export-mgmt.js` 中的 V3 文档
  - `scripts/characterization/characterize-export-v3.mjs`
- 验证：
  - `node --check` 上述文件通过。
  - `grep` 确认 V3 端点存在。

### Task 1: 配置项

- `config/config.js` 新增：
  - `PUSH_V3_SCREENSHOT_BUCKET`
  - `PUSH_V3_SCREENSHOT_EXPIRES`
- `config/.env.example` 增加示例。
- 验证：`node --check`，配置可读取。

### Task 2: 新 V3 服务层改造

修改 `src/services/transaction-export-v3.js`：

- 移除 `buildGroupsResult` 返回的 `result` 结构，改为构建：
  - `payload.screenshots`
  - 合并后的 `transcationProperties`
- 新增/调整函数：
  - `buildV3Screenshots(phases, phaseScreenshots, dialogScreenshots?)`
  - `buildV3Properties(traj, phases, phaseScreenshots, stepsByPhase?)`
  - `buildTransactionEntryV3` / `buildTransactionPayloadV3` / `wrapTransactionListV3`
- `transcationProperties` 每条合并：
  - `scanIndex`：全局从 0 开始
  - `type: 'ele'`
  - `id: step-<stepNumber>`
  - `pid: page-<n>` 或弹窗 key
  - `label`：原始控件标签
  - `regionId` / `regionLabel`：从 `element_json.region_id` / `region_label` 读取
  - `rect`：从 `element_json.bbox` 读取，合法才输出
- 删除字段：`recorded`、`manualRecord`、`targetType`、`group`、`anchorTarget`、`anchorPropertiesName`、`placeholder`、`title`、`disabled`、`required`、`readonly`、`value`
- 保留 `transcationProperties` 的 V2 字段：`options`、`elementType`、`eventTypeName`、`eventTypeValue`、`transcationType`、`objectValue`、`propertiesName`、`mothed`
- 新增 `payload.screenshots`：
  - `phaseNumber`
  - `bucket`（来自配置）
  - `type`：`page` / `dialog`
  - `key`
  - `name`
  - `url`
  - `expires`
- 弹窗截图：
  - 结构支持 `type:'dialog'`
  - 当前若没有弹窗截图数据，则不输出 dialog 截图条目

验证：
- characterization 纯函数断言：
  - `transcationProperties` 包含 `id/pid/label/regionId/regionLabel/rect/scanIndex`
  - 不再包含 `result`
  - 不再包含 `url`、`recorded`、`manualRecord` 等删除字段
  - `payload.screenshots` 结构正确
  - `scanIndex` 全局递增
  - `pid` 与 `screenshots.key` 对应

### Task 3: 路由与 API 文档

- 恢复/修改 `src/routes/v2/export-mgmt.js` 中 V3 端点：
  - `GET /api/v2/export/trajectories/:id/transaction-v3`
  - `POST /api/v2/export/trajectories/:id/transaction-v3`
  - `POST /api/v2/export/transactions-v3`
- 修改 `src/dashboard/api-docs/groups/export-mgmt.js`：
  - 更新 V3 文档为新的单轨结构
  - 说明 `payload.screenshots` 与 `transcationProperties` 合并后的字段
- 验证：
  - 路由可访问
  - API 文档包含新结构

### Task 4: characterization 更新

更新 `scripts/characterization/characterize-export-v3.mjs`：

- 纯函数：
  - V2 五个核心字段保留
  - 新字段 `label` / `regionId` / `regionLabel` / `rect` / `scanIndex` / `pid` 输出正确
  - 删除字段不再输出
  - `payload.screenshots` 生成正确
  - `bucket` 来自配置
- 真实数据（traj 38 / traj 157）：
  - `transcationProperties` 数量与步骤数一致
  - `rect` 与 DB `element_json.bbox` 一致
  - `pid` 归属正确
  - `payload.screenshots` 包含页面截图
  - 体积相比旧 V3 下降

验证：
- `node scripts/characterization/characterize-export-v3.mjs`
- 注册到 `scripts/refactor/verify-all.sh`

### Task 5: CHANGELOG 与收尾

- `CHANGELOG.md` `[Unreleased]` 新增条目：
  - V3 结构优化：合并 result 到 transcationProperties，新增 payload.screenshots
  - 配置新增 `PUSH_V3_SCREENSHOT_BUCKET` / `PUSH_V3_SCREENSHOT_EXPIRES`
  - Python 同步提示
- 运行：
  - `node --check` 所有新增/修改文件
  - `bash scripts/refactor/verify-all.sh`

---

## 验收标准

1. `transcationProperties` 不再依赖 `result`，单轨输出。
2. `payload.screenshots` 提供页面/弹窗截图元数据。
3. 每条属性包含 `id` / `pid` / `label` / `regionId` / `regionLabel` / `rect` / `scanIndex`。
4. 属性中不包含 `url`、`recorded`、`manualRecord`、`targetType`、`group`、`anchorTarget` 等冗余字段。
5. `bucket` 通过 `.env` 配置。
6. 旧 V3 的 `result.groups` 不再输出。
7. 单条 V3 JSON 体积相比旧版明显下降。
8. `verify-all.sh` 全绿。

---

## 实施方式

主线程实现，按 Task 0 → Task 5 顺序推进。每个 Task 先写/更新 characterization，再实现，最后跑绿。
涉及文件：

- `src/services/transaction-export-v3.js`
- `src/routes/v2/export-mgmt.js`
- `src/dashboard/api-docs/groups/export-mgmt.js`
- `scripts/characterization/characterize-export-v3.mjs`
- `scripts/refactor/verify-all.sh`
- `config/config.js`
- `config/.env.example`
- `CHANGELOG.md`
