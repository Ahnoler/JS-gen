# 客户管理 KB 贯通（对公建档）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对公客户建档主链可召回 KB + 本产品「新增交易→analyze→按阶段录制」贯通，列表可见 stamp 客户。

**Architecture:** 回写既有 `customer_onboarding.json`（挂 functionId=**7**）→ 任务文案 → analyze/create/prepare/record → source 回填与 through-report。对标产品管理方案 1。

**Tech Stack:** `data/kb/flows/customer_onboarding.json`，`POST /api/v2/trajectories/analyze|` CRUD + `record/prepare|start`，可选遗留 traj 只读 API。

## Global Constraints

- 挂载 **functionId=7**（对公客户管理；非 9000001478）。
- OCR/影像禁入；成功判据=列表 stamp，不强制全字段。
- 勿改 `_kb.py` / promote / prompts（除非召回强制且声明）。
- 勿碰用信/授信/产品 WIP；Python 用 Anaconda/`./python`。
- 证据目录：`tmp/customer-mgmt/`（gitignore）。
- 设计：`docs/superpowers/specs/2026-09-05-customer-mgmt-kb-design.md`。

---

## File map

| Path | Role |
|------|------|
| `data/kb/flows/customer_onboarding.json` | 主卡回写 |
| `tmp/customer-mgmt/task-requirement.md` | 任务文案 |
| `tmp/customer-mgmt/through-report.md` | 贯通报告 |
| `tmp/customer-mgmt/function-anchors.md` | 锚点快照（fid=7 等） |
| `docs/superpowers/agent-log.md` / `todo-list.md` | 开工收工 |

---

### Task 1: 功能锚点快照

**Deliverable:** `tmp/customer-mgmt/function-anchors.md`

- [x] `GET /api/v2/processes/4/functions`：确认对公客户管理 **id=7**、xpath、pageId；记下 intermediate 旧名勿挂。
- [x] 可选：`GET .../trajectories?functionId=7` 摘要条数/代表交易名（只读）。

**Verify:** 文件写明 `functionId=7` 与 `RES000000101` / `ZJJK00066153`。

---

### Task 2: 回写 customer_onboarding.json

**Depends:** Task 1

**Deliverable:** 更新后的 `data/kb/flows/customer_onboarding.json`

- [x] `menu_path` → `客户管理→对公客户管理（functionId=7；…）`。
- [x] 加强 `hash_markers`（含 `cstMgt` 及湿测可得 page/hash 段；避免过短误召）。
- [x] preconditions/rules：挂 **7**；OCR 禁入；成功=列表 stamp。
- [x] `find_flow_for_task(..., page_hash=...)` 抽查命中本卡。

**Verify:** Python 召回命中「对公客户建档」；JSON 可 parse。

---

### Task 3: 任务文案 + analyze + 建交易

**Depends:** Task 2

**Deliverable:** `tmp/customer-mgmt/task-requirement.md` + 交易 id

- [x] 定稿编号步骤 + stamp（客户名称 / 证件号策略：测试环境可用假号且不与现网冲突）。
- [x] `POST /analyze`（functionId=7）→ 审 phases。
- [x] `POST /trajectories`：name 含 stamp、requirement、phases、systemAccountId=2、functionId=7。

**Verify:** 交易 draft；phaseCount≥1；task 非空。

---

### Task 4: 贯通录制

**Depends:** Task 3

**Deliverable:** recorded（或明确失败根因）+ `through-report.md`

- [x] prepare → start（空闲槽；不抢用信）。
- [x] 监控阶段；必要时 CDP 核对列表 stamp。
- [x] detach；写 through-report（traj id、fid=7、stamp、阶段表）。

**Verify:** 列表可见 stamp **或** 报告写明阻塞与下一步。

---

### Task 5: 卡 source 回填 + Lead 收工

**Depends:** Task 4

- [x] `customer_onboarding.json` source 挂湿测 traj（#515 + 复录 #524）。
- [x] agent-log 收工；todo「⑦」标档位 A 闭环（#524 stepCount=9 / 列表 stamp）。
- [x] commit（Lead 收工单元）。

**Verify:** source 含 traj id；收工回链开工。
