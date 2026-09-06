# 淼一协作工作流 · 开发计划（Roadmap）

> **For humans / planning:** 将产品 **PR-*** 映射到工程 backlog。需求纪要：[brief](../specs/2026-08-12-product-requirements-miaoyi-brief.md)。  
> **Not** 单特性 TDD 实施计划；各波次落地时再开专刀 design/plan。

**Goal:** 产品需求与工程债对齐；先分区 → 分层/stitch → 批量增强与数据捞取；登录权限等会议。

**Source of truth:** [`todo-list.md`](../todo-list.md)「产品排期」+ [brief](../specs/2026-08-12-product-requirements-miaoyi-brief.md)。

---

## 1. 映射总表（2026-08-12 需求梳理后）

| 产品 ID | 工作内容 | 工程关联 | 现状 |
|---------|----------|----------|------|
| **PR-PUSH** | 推送自动化 | 1448068 · export-push-gate | **已完成** |
| **PR-PART** | 元素分区算法 | unify-partition · L1c · picker · 1448067 | **进行中** |
| **PR-LAYER** | 元素分层树 | 依赖 PR-PART；L1 产品树 | 待办（分区后） |
| **PR-LOC** | phase 整页 stitch | `trajectory_phase` 新字段 | 待办 |
| **PR-LOC-HL** | 操作后高亮截图 | — | **挂起** |
| **PR-DATA** | 静态目录 + 录制中捞报文 | case-data 软文本 | 待办（需 design） |
| **PR-BATCH** | 批量导入：本人可见 / 行进度 / done→trajectory_log | Vue BatchImport · batch API | 待办 |
| **PR-SSO** / **PR-USER** | 公司 HTTP 登录 + 树/交易权限 | — | 待办；**PR-SSO-ADMIN 挂起等 8.13 会** |
| **PR-EXEC** | 脚本执行产品 | — | **挂起**（只供 actions/操作设计） |

```text
已完成     当前          随后              中后期           等会议
PR-PUSH → PR-PART → PR-LAYER / PR-LOC → PR-BATCH / PR-DATA → PR-SSO/USER
          （分区）    （分层 / stitch）     （导入 / 捞数）    （PR-SSO-ADMIN）
```

---

## 2. 波次计划

### Wave 0 — 已完成（对照）

- [x] **MY-06 / 1448068**：仅 `recorded`/`completed` 可推送；草稿 409。
- [x] 相关：export-push-gate、推送契约（见 CHANGELOG Unreleased / 已落条目）。

**验收：** 草稿交易不可推；录制完成可推。

---

### Wave 1 — 分区主线（对准 MY-02 · 目标 ~8.25）**当前优先**

**目标：** 同页同名控件靠 L1 `region_*` / `display_group` 可区分；人工 / 自动抓取 / AI scan 共用准入+分区内核。

| 步骤 | 工程项 | 动作 | 已有文档 |
|------|--------|------|----------|
| 1.1 | unify-partition U1→U2 | 跟完 [unify plan](2026-08-12-unify-partition-locator-architecture.md)；表征绿 | [design](../specs/2026-08-12-unify-partition-locator-architecture-design.md) |
| 1.2 | **1448067** 残余 | 多「处理」歧义选择器：互异 `region_label` / `display_group` 湿测 | todo-list 已记 |
| 1.3 | **L1c-scan-py** + **L1c-wet** | Python scan 接 classify；`L1C_LLM=1` BiB | [L1c design](../specs/2026-08-10-l1c-llm-region-classify-design.md) |
| 1.4 | **L1-picker-wet** / **page-state-wet** | 多「新增」+ dialog 同文案碰撞（依赖执行机重载） | backlog 湿测表 |

**退出标准：**

1. 待办多「处理」：AG/resolve 列表分组标题可读且互异（非纯 xpath）。
2. 表征：`characterize-unify-partition-locator` / todo-item-action / L1c 相关绿。
3. 至少一轮 BiB：L1-picker 或 page-state 湿测有结论（过或记缺陷）。

**非本波：** 历史报文回填、登录模块、交易列表加任务 UI。

---

### Wave 2 — 截图与元素位置（对准 MY-01 · 目标 ~8.21）

**目标：** 录制/抓取时稳定留下「页截图 + 元素定位（xpath_smart / bbox）」契约，供执行组件节点展示与人工核查。

| 步骤 | 工程项 | 动作 |
|------|--------|------|
| 2.1 | 契约盘点 | 列清：步骤截图、`element`/`params` 定位字段、resolve inventory 已有字段；缺什么写短 design |
| 2.2 | **AG-fullpage-wet** | 自动抓取全页 inventory 冒烟；确认选中项带齐定位 |
| 2.3 | **T3r** | 活录 CDP 对拍残余（element ≡ params） |
| 2.4 | **L1-vision**（可选 P2+） | 争议容器裁图辅助定角色——仅当规则分区不够 |
| 2.5 | 边界 | 与执行组件/前端约定：JS-gen 出什么 JSON；节点渲染不在本仓则出契约+CHANGELOG |

**退出标准：** 人工可从一步骤还原「哪一页哪一块哪个控件」；执行侧能消费定位字段画节点（或契约已冻结）。

**依赖：** Wave 1 分区稳定后，节点上的「分区标签」才有产品意义。

---

### Wave 3 — 录制测试数据（对准 MY-07 · 目标 ~8.30）

**目标：** 录制过程能用「真实业务数据」填表，而不仅是随机 form_rules / 半截案例 KV。

| 层 | 内容 | 状态 |
|----|------|------|
| 已有底座 | 案例 KV 软挂 agent_task；助手读 flat KV（**1448066/1448064**） | 本仓库已修，勿重做 |
| **增量（需新 design）** | 历史请求报文 → 映射字段 → 填写；日志/数据文件解析 | **未开刀** |
| 协作 | 杨烽：报文来源/存储；淼一：控面/agent 接入 | — |

**建议顺序：**

1. 开 brainstorm → `docs/superpowers/specs/YYYY-MM-DD-recording-testdata-from-payload-design.md`（锁定：报文从哪来、字段映射谁做、是否进 case-data）。
2. 实现计划单独写；**禁止**在未 design 前把「解析日志」塞进 form assistant。
3. Characterization：给定 fixture 报文 → 指定 label 填值；无报文时行为与今日一致。

**退出标准：** 选定交易录制时可从历史报文/文件注入字段值；无数据时降级路径明确（跳过/申报/随机规则）。

---

### Wave 4 — 执行机 / 执行引擎（对准 MY-09 / MY-08 · 目标 ~8.25 协作）

| 产品 | JS-gen 侧可交付 | 说明 |
|------|-----------------|------|
| **MY-09** 执行机 | **session-lifecycle-commit** + **session-lifecycle-wet**；slot 租约已有 | 支撑 Wave1/2 湿测；主责杨烽调度产品面 |
| **MY-08** 执行引擎 | **T9** 产品 `steps/replay` 常态；**heal-locate** 禁 scroll 猎场 | 调度编排若在他仓，本仓保 replay/自愈质量 |

**退出标准：** attach/detach/grace 湿测有结论；回放主路径可运维验收；自愈不再滚屏猎场（heal-locate 专节）。

---

### Wave 5 — 产品旁路（MY-03 / MY-04 / MY-05）

| ID | 建议 |
|----|------|
| **MY-05** | 先出「要不要独立登录模块」结论；否 → 关项；是 → 再开 design |
| **MY-03** | 系统树账号/角色：对齐现有 `accounts` / system-mgmt；缺字段再补 API+CHANGELOG |
| **MY-04** | 交易列表加任务：SPA 为主；若要持久化阶段任务则补 trajectories 契约 |

不插入 Wave 1–2 关键路径，除非阻塞录制取数（MY-07）或登录场景（MY-03）。

---

## 3. 推荐下一刀（工程）

1. **收口 MY-02 / Wave 1**：unify-partition 未完成任务 + L1c-scan-py；穿插 1448067 湿测。  
2. **并行轻量**：session-lifecycle-commit（解锁执行机湿测，服务 MY-09 / picker-wet）。  
3. **MY-01 前**：写 1 页契约（截图+bbox/xpath → 执行节点），再开 AG-fullpage-wet。  
4. **MY-07**：8.25 分区稳定后立刻 brainstorm「报文回填」，赶 8.30。

---

## 4. 风险与边界

| 风险 | 缓解 |
|------|------|
| 把 MY-07 当成「案例 KV 没做完」重做 | 已修项保持；增量单独 design |
| MY-01 在执行组件仓、本仓空转 | 先冻结 JSON 契约再两边排期 |
| 湿测全卡在执行机 | Wave 4 的 lifecycle 与 Wave 1 湿测绑在一起排 |
| MY-05 未决却开登录工程 | 保持挂起 |

---

## 5. 文档索引

| 文档 | 用途 |
|------|------|
| [todo-list.md](../todo-list.md) | MY-* 状态 + 缺陷/Backlog 权威清单 |
| [unify-partition design](../specs/2026-08-12-unify-partition-locator-architecture-design.md) / [plan](2026-08-12-unify-partition-locator-architecture.md) | MY-02 主实施计划 |
| [retire regionAnchor](../specs/2026-08-12-retire-abc-d3-favor-l1l2-regionanchor-design.md) | 分区术语/xpath 消歧 |
| [backlog-visible-editable-controls](../backlog-visible-editable-controls.md) | L1/L2 目标线地图 |
| [agent-task case KV](../specs/2026-08-11-agent-task-case-kv-full-catalog-design.md) | MY-07 已有底座（非报文） |

---

## 更新

| 日期 | 变更 |
|------|------|
| 2026-08-12 | 对齐产品梳理：MY→PR-*；PR-SSO-ADMIN 挂起等会议；见 brief |
| 2026-08-12 | 初版：MY-01..09 ↔ todo-list 映射；Wave 0–5；MY-06 已完成 |
