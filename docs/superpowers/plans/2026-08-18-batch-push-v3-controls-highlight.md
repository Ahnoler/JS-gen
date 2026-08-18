# 批量推送 V3.0 · 阶段长图控件点亮 · 实施计划

日期：2026-08-18 · 前置：spec `2026-08-18-batch-push-v3-controls-highlight-design.md`（已对齐同事 groups 约定）

## 目标

新增批量推送 V3.0：entry 增加 `result.groups`（对齐消费方约定：组节点 page/dialog + 控件节点
ele，pid 树；**一张长图 = 一个页面组**；弹窗 = 独立页面组附属于触发按钮）；控件带
`rect`（内容坐标，来自 element_json.bbox）+ `target` 等字段；`transcationProperties` 保留；
`phases[].metadata` 全量元素不再推送。V2.0 端点不变。

## 任务拆分（TDD：先 characterization 后实现）

### Task 1: 服务层 `src/services/transaction-export-v3.js`

纯函数 + 组装（导出供 characterization import）：
- `buildGroupsResult({traj, phases, phaseScreenshots, stepsByPhase})` → result 对象：
  - **页面组**：每阶段一个（= 每张长图一个），`id/key = page-<phaseNumber>`，
    `name = 页面<n> · <描述前20字>`，`pid=null`，`screenshots=[{phaseNumber, url}]`（无尺寸）；
  - **弹窗组**：步骤 `region_id` 分层链含 `overlay:` 段 → dialog 组
    （`id/key = page-<n>|dialog:<标题>@@anchor=<anchorXpath>`，name=弹窗标题，
    pid=页面组，screenshots=[]）；
  - **anchor 推断**：按步骤序，弹窗区操作的前置最近 button/click 步骤
    （region 不含该 overlay 段）→ `anchorTarget=xpath_smart`、
    `anchorPropertiesName=formLabel||text`；推断不到省略 anchor；
  - **控件节点**：每步一条（映射表见 spec），`pid` 按归属（页面组/弹窗组），
    `rect` = bbox 合法才输出（否则省略并计入 stats），`group` 弹窗内控件填
    `[{type:'dialog',name,key}]`，`params` = params_json；
- `buildTransactionEntryV3(traj, opts)` / `buildTransactionPayloadV3` / `wrapTransactionListV3`
  （复用 `mapStepToTransactionEvent` 生成 transcationProperties）；
- 读取：`trajectoryDao.getById`（含 steps）、`trajectoryPhaseDao.listByTrajectory`、
  `screenshotDao.listPhaseHighlightsByTrajectory`（每阶段最新一张）。

characterization `scripts/characterization/characterize-export-v3.mjs`：
- 纯函数：页面组生成（id/name/screenshots）、弹窗归属（region_id 含 overlay）、
  anchor 推断（前置按钮步骤）、rect 过滤（非法省略）、kind 映射、pid 归属、params 透传、
  group 字段、无截图阶段容错；
- 真实数据（traj 38）：groups 含 3 个 page 组 + 控件数 = 有 element 步骤数、
  抽 5 个 rect 与 DB bbox 相等、弹窗组存在性（phase 3 有引入弹窗操作）、
  transcationProperties 与 V2.0 一致（对比 buildTransactionPayload 输出）；
- 注册 `verify-all.sh`。

### Task 2: 路由 + api-docs + CHANGELOG

- `src/routes/v2/export-mgmt.js` 追加 3 端点（复用 parseIdList/parseBool/
  resolveSystemProject/maybePushSingle/assertPushableForPartner）：
  - `GET /api/v2/export/trajectories/:id/transaction-v3`（dry-run 组装）
  - `POST /api/v2/export/trajectories/:id/transaction-v3`
  - `POST /api/v2/export/transactions-v3`（批量，body 同 V2.0）
- `src/dashboard/api-docs/groups/export-mgmt.js` 登记 3 端点（镜像 V2.0 条目风格）；
- `CHANGELOG.md` `[Unreleased]` 新增条目（路由 + 服务，Python 同步提示：result.groups
  结构与 rect 语义）。

### Task 3: 端到端验证

- `GET /api/v2/export/trajectories/38/transaction-v3`：检查 groups 树、rect 与 DB 一致、
  screenshots、transcationProperties；
- 9242 点亮验证：临时 HTML 读 V3 payload 的 result → 渲染各页面长图 + rect 画框 +
  勾选任意子集只亮勾选项（复用 lightup 坐标换算）→ 视觉核对对齐；
- `verify-all.sh` 全绿；V2.0 端点回归（`GET .../transaction` 仍正常）。

## 验收

1. V3.0 dry-run：groups 结构与 spec 一致（page-<n> 平级、弹窗组、控件 rect/pid/params）。
2. rect 与 element_json.bbox 一致；无坐标步骤不进 groups（stats 计数）。
3. 9242 渲染验证：任意勾选点亮。
4. verify-all ALL GREEN；V2.0 无回归。

## 实施方式

主线程实现（沿用近期模式：每任务先写 characterization 跑红 → 实现 → 跑绿 →
提交 → 主线程审查）。
