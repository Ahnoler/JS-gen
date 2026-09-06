# 产品管理 KB 贯通 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 产品库主链可召回 KB + 本产品「新增交易（含任务）→ AI 分析 → 按阶段录制」贯通验证。

**Architecture:** 遗留轨迹与需求分册只读提炼 → 同构流程卡入库 → analyze/create/prepare/record 产品路径湿测 → 卡点回灌。Lead 编排；R1–R3 并行研究后 I1→I2。

**Tech Stack:** `data/kb/flows/*.json`，`POST /api/v2/trajectories/analyze|` CRUD + `record/prepare|start`，officecli 读需求 docx，MySQL `js_gen`（DB 经 `.env`）。

## Global Constraints

- 勿触碰信贷线未提交：`scripts/controller/actions/js_snippets/error_notify.py`、`guarantee_intro_snippet.py`、`table_cell.py`、`replay_timing.py` 及根目录 batch_*.png 等。
- 勿改共享：`data/kb/staging/staged_flows.jsonl`、`scripts/controller/actions/_kb.py`、`scripts/kb/promote.py`、`scripts/prompts/**`（除非 Lead 在 agent-log 声明）。
- 本机 Python：`D:/anaconda3/python.exe` 或 `./python/python.exe`。
- **不要 git commit**，除非用户/Lead 明确要求。
- 卡 schema 对齐 `data/kb/flows/limit.json` / `loan.json`；`source` 须注明遗留轨迹 id + 需求分册章节。
- 设计依据：`docs/superpowers/specs/2026-09-04-product-mgmt-kb-design.md`；交接：`docs/superpowers/research/2026-09-04-kb-build-handover.md`。

---

## File map

| Path | Role |
|------|------|
| `tmp/product-mgmt/legacy-traj-digest.md` | R1 产出 |
| `tmp/product-mgmt/req-mainchain.md` | R2 产出 |
| `tmp/product-mgmt/function-anchors.md` | R3 产出 |
| `tmp/product-mgmt/task-requirement.md` | 任务内容定稿 |
| `tmp/product-mgmt/through-report.md` | 贯通报告 |
| `data/kb/flows/product_library.json` | 产品库主链卡 |
| `docs/superpowers/agent-log.md` | Lead 收工条 |

---

### Task 1: R1 遗留交易挖掘

**Deliverable:** `tmp/product-mgmt/legacy-traj-digest.md`

- [ ] 定位产品管理相关 `function` / 模块节点（名称含 产品信息管理、产品库管理、查询产品信息、产品要素库、产品要素管理）。
- [ ] 列出各 function 下轨迹：id、name、recordStatus、phaseCount、stepCount、task 是否空、updated 时间。
- [ ] 精读优先集：`completed`（已确认）+ phaseCount 最高（如产品库管理主页 ~12/44）；导出各 phase description 摘要与代表性步骤动作（菜单/按钮文案）。
- [ ] 输出：可复用菜单路径、按钮词典、阶段切分建议、**不可直接复用**处（任务空、页面碎片）。

**Verify:** 文件存在；至少 3 条轨迹有 phase 摘要；注明查询方式（API/SQL）。

**Forbidden:** 修改任何业务代码；删除/改轨迹。

---

### Task 2: R2 需求分册主链抽取

**Deliverable:** `tmp/product-mgmt/req-mainchain.md`

- [ ] 源文件：`c:\Users\water\Desktop\K01天阳信贷管理系统-产品管理需求分册.docx`（officecli view/get）。
- [ ] 抽取「配置产品信息 / 产品库管理」主链：新增一级分类→分类→产品→刷新树→启用/禁用→克隆→配置视图（深度以启用闭环为界）。
- [ ] 记录 ZJJK 页面号、关键按钮规则名、业务规则要点（保存/启用前置）。
- [ ] 映射到 KB `nodes`/`rules`/`preconditions` 草稿条目（尚未写正式 JSON）。

**Verify:** 主链步骤有序列表 ≥8 步；含启用相关规则摘录。

**Forbidden:** 改 docx；写 `data/kb/**`。

---

### Task 3: R3 功能锚点

**Deliverable:** `tmp/product-mgmt/function-anchors.md`

- [ ] 从 DB 或 `/api/v2` 层级 API 解析：系统 → 产品管理 → 子功能 的 **functionId**、pageId/uml 若有。
- [ ] 推荐新建交易挂载节点（默认 **产品库管理**）；列出备选与理由。
- [ ] 记录可用 systemAccount（录制账号）线索（勿输出密码）。

**Verify:** 至少一个确定的数字 functionId + 名称。

**Forbidden:** 改账号/权限数据。

---

### Task 4: I1 写入产品库流程卡

**Depends:** Task 1–3

**Deliverable:** `data/kb/flows/product_library.json`

- [ ] 合并 digest + req-mainchain + anchors 写成完整卡。
- [ ] `json.load` 校验；`find_flow("产品库")` 或别名可命中（用 `D:/anaconda3/python.exe -c` + `scripts.kb.store`）。
- [ ] 可选：极简 characterize 断言 flow 名存在（仅当不触碰共享 pin 契约时）。

**Verify:** Python `find_flow` 命中；字段含 menu_path、nodes、rules、source。

---

### Task 5: I2 贯通录制

**Depends:** Task 4（卡可召回）+ Task 3（functionId）

**Deliverable:** `tmp/product-mgmt/through-report.md` + `tmp/product-mgmt/task-requirement.md`

- [ ] 定稿任务内容（编号分步 + 关键数据 stamp，如产品名 `KB测-YYYYMMDD-HHMM`）。
- [ ] `POST .../analyze` → 审阶段 → `POST .../trajectories`（requirement + phases + functionId + systemAccountId）。
- [ ] `record/prepare` → `record/start`；监控 phase_done / 失败；必要时 stop/detach 释放槽。
- [ ] 报告：trajectoryId、各阶段结果、SUT 证据（截图路径或产品编号/启用态）、KB 是否被 agent 召回（若日志可见）。

**Verify:** 新交易 task 非空；phaseCount≥1；有录制步骤或明确失败根因+下一步。

**Note:** 执行机争用时 Lead 协调窗口；勿杀信贷线会话。

---

### Task 6: Lead 收工

- [ ] 审 I1/I2；缺口列入 staging 说明（若写 staging 须声明）。
- [ ] `docs/superpowers/agent-log.md` 顶部插条。
- [ ] 更新 `docs/superpowers/todo-list.md` 若需挂产品管理线（可选）。
