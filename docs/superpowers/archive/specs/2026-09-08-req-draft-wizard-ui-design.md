# 前端：需求生成草稿交易向导 — 设计

> 日期：2026-09-08  
> 状态：已确认（2026-09-08 用户批准）  
> Lead：Cursor brainstorming（会话确认：方案 B + 录制侧向导）  
> 后端规格：[`2026-09-07-req-to-draft-traj-design.md`](./2026-09-07-req-to-draft-traj-design.md)  
> 前端仓库：`D:\dev\ui-auto-recording-agent-vue-master\vue-project`  
> 相关 API：`GET/POST /api/v2/kb/req-modules*`、`draft-traj/propose|commit`（契约以 `/api/docs` 为准）

## 1. 目标

让业务用户在 **录制列表** 侧，从已切片的 **需求作业区** 生成 **原子粒度草稿交易**，替代手工「添加交易录制」逐条写任务。

成功终点：

1. 用户选作业区 → propose 看到带出处的原子候选；
2. **人勾选**子集 → commit 仅创建 `recordStatus=draft` 轨迹；
3. 结果页可打开新建草稿；全程 **不** prepare / record。

## 2. 范围

### In（本版）

- 入口：录制列表顶栏按钮「需求生成草稿」。
- 子路由向导：选作业区 → 生成候选 → 勾选原子 → 确认创建 → 结果。
- 对接现有 KB draft-traj API；`functionId` 用左侧树当前功能或向导内补选，经 `functionIdOverrides` 提交。
- 空态 / 错误文案 / rejected 只读展示。

### Out（本版不做）

- 系统树配置页入口；以系统树「模块节点」当作作业区。
- 系统树 ↔ 需求作业区映射表（未来轻量 C）。
- 需求切片上传 / 登记 UI（仍 Agent + 现有 API）。
- 自动录制、批量 Excel 录制合并。
- 多作业区一次串行 propose/commit（本版单选作业区）。
- 操作组件扫描 / 批量推送改推组件（todo ⑧′）。

## 3. 入口与信息架构

| 项 | 决定 |
|----|------|
| 入口页 | `ui-recording` 录制列表，与「添加交易录制」「批量导入」并列 |
| 按钮文案 | **需求生成草稿**（强调 draft、非开录） |
| 向导路由 | 建议 `/ui-recording/req-draft-wizard`（全屏子页，可刷新） |
| 不放 | 「系统管理 → 系统树配置」顶栏 |

数据语义：**需求作业区**（`moduleKey`，如 `product-mgmt`）≠ 系统树菜单模块节点。

## 4. 向导四步

```
① 选作业区 → ② propose 候选表 → ③ 勾选 + 挂功能/账号 → ④ commit 结果
```

### ① 选作业区

- 数据：`GET /api/v2/kb/req-modules`。
- 展示：`moduleName`、`moduleKey`、是否具备 `through-chains`（无则禁用）。
- **单选**一个作业区。
- 高级（折叠）：`chainIds` 多选（有主链元数据时）；`maxAtoms` 默认 20。
- 主按钮：「生成候选」→ ②。

### ② 生成候选

- 调用：`POST /api/v2/kb/req-modules/:moduleKey/draft-traj/propose`  
  body：`{ chainIds?, maxAtoms? }`。
- 表格列：勾选框预览态可只读、标题、缩短的 `sourceChapter`、文档名。
- 行展开：`taskDraft`、`phaseHints`。
- `rejected[]`：折叠只读（atomKey + reason）。
- 文案：「尚未创建交易；请进入下一步勾选后再确认。」
- 「重新生成」可再次 propose；「下一步」→ ③。

### ③ 勾选原子

- 默认 **全不选**；提供「全选 / 清空」。
- 至少勾 1 条方可提交。
- **功能节点**：优先录制页左侧树当前 `functionId`；若无则本步必选「挂到功能」。
- **账号**：`systemAccountId` 可选，有默认则预填。
- 高级：`force`（允许同 `req_atom_key` 再建草稿），默认关。
- 主按钮：「创建草稿交易」→ ④。

### ④ 结果

- 调用：`POST .../draft-traj/commit`  
  body：
  - `atomKeys`: 勾选列表
  - `functionIdOverrides`: 每个 atomKey → 选定的 functionId（**即使** propose 返回了 suggestedFunctionId，本版也统一 override，避免 null/幻觉）
  - `systemAccountId?`、`force?`
- 成功：`created[]` 展示名称、trajectoryId、「打开」→ 交易详情。
- 跳过：`skipped[]` 展示原因。
- 「返回录制列表」（刷新）；「继续生成」回 ①。

## 5. API 与前端硬规则

1. 必须先 propose 再 commit；更换 `moduleKey` 必须重新 propose。
2. `suggestedFunctionId` 常为 `null`（FK guard）→ 不依赖其建交易，一律 override。
3. 绝不调用 `prepare` / `record/start` / `detach`。
4. 错误与空态见 §6；HTTP/业务码以控制面现约为准。

## 6. 异常、空态与文案（§3）

| 场景 | 行为 / 文案要点 |
|------|-----------------|
| 作业区列表为空 | 空态：「暂无已登记需求作业区；请先完成需求切片登记。」不提供假数据 |
| 作业区无 through-chains | 行禁用 + tooltip：「缺少贯通主链，无法生成」 |
| propose 400（缺 chains 等） | Message：后端 message；留在 ① 或 ② 可重试 |
| propose 超时/5xx | 「生成失败，请重试」；保留上次成功候选（若有） |
| atoms 为空且 rejected 有 | 表空 + 展开 rejected；禁止进 ③ |
| 未勾选点创建 | 按钮 disabled 或校验：「请至少勾选一个原子」 |
| 未选 functionId | 「请选择要挂载的功能节点」 |
| commit 部分 skipped | ④ 同时展示 created 与 skipped，不整单当失败 |
| duplicate_draft | skipped 文案：「已存在同原子草稿」；提示可开 force |
| missing_function_id / unknown_function_id | 应被 override 避免；若仍出现，提示检查功能节点 |
| propose cache missing | 「请先重新生成候选」并回 ② |
| 权限 | 与录制列表「添加交易」同级；无单独 RBAC 本版 |

## 7. 与草图差异（决策记录）

| 草图 | 本设计 |
|------|--------|
| 系统树配置顶栏「交易生成」 | 录制列表「需求生成草稿」 |
| 选系统 + 多选菜单模块 | 选 **需求作业区**（单选） |
| 直接生成草稿 | **勾选原子** 后再 commit |
| — | 明确不自动录制 |

## 8. 验收（前端）

1. 从录制列表进入向导，对已切片模块（如 product-mgmt）propose 出 ≥1 原子且展示出处。
2. 未勾选无法 commit；勾选子集后仅这些轨迹出现在 created。
3. 新建轨迹为 draft，详情可见；列表可刷出。
4. 网络面板无 prepare/record 调用。
5. 缺功能节点时有阻断，不静默 400/skip 整单无提示。

## 9. 实现落点（指导，非本规格实现）

- 前端：`vue-project` 路由 + `api` 封装 KB 三接口 + 向导页/组件。
- 后端：无新接口需求（本版）；若列表缺 `hasThroughChains` 字段，前端可用详情探测或后续小补字段（实现计划里定）。

## 10. 风险

- 作业区名与系统树模块名不一致 → 靠文案与禁用态教育；映射表留待下版。
- propose 较慢（LLM）→ ② 需明确 loading，禁止重复狂点（按钮 loading 锁）。
- 旧草稿 duplicate → 默认 force=false；高级开放。
