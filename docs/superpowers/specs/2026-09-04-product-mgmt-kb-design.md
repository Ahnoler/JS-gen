# 产品管理知识库贯通 — 设计

> 日期：2026-09-04  
> 状态：已选方案 1（先卡后录）+ 验证路径 C（遗留参考 → 新增交易 AI 分析 → 按阶段录制）  
> Lead：本会话；执行：agent team 并行

## 1. 目标

在信贷 SUT（`test.creditv5p2`）**产品管理**模块，打通「产品库主链」并沉淀可召回 KB；贯通证据必须走本产品路径：

**遗留交易参考 → 新增交易录制（含任务内容）→ AI analyze 拆阶段 → prepare → record/start 按阶段执行**。

成功终态（最小集）：

1. ≥1 张产品流程卡可被 `kb_flow` 召回（同构 `data/kb/flows/*.json`）。
2. 新建一条交易：`task`/`requirement` 非空，phases 来自 analyze，按阶段录制产生步骤。
3. 被测侧可核对：新建或克隆产品并 **启用**（或等价落库/UI 证据：产品编号 + 状态）。

## 2. 范围

### In

- 产品库主链：菜单进入产品库 → 新增/克隆产品 → 基本信息/公共要素（按需）→ 个性化阶段（可浅）→ **启用**。
- 遗留交易只读挖掘（产品管理功能树下 19 条量级）。
- 需求分册《K01…产品管理需求分册》作导航与草稿，**不**直接 promote。
- KB 卡写入 `data/kb/flows/`（建议文件名 `product_library.json`；可选后续 `product_element.json`）。

### Out（本轮不做）

- 全模块普查（要素库/核心映射/查询导出）——可后补。
- 改 `_kb.py` / `promote.py` / prompts（共享文件；除非卡召回缺口强制，且先 agent-log 声明）。
- 触碰信贷线工作区未提交改动（`error_notify` / `guarantee_intro_snippet` / `table_cell` / `replay_timing` 等）。
- 与用信/授信链业务对接（方案 C 的「配一条住房开发贷款」延后）。

## 3. 架构与数据流

```
遗留轨迹(只读) + 需求分册
        │
        ▼
  任务文案 + 阶段草稿 + KB 卡草稿
        │
        ├─► data/kb/flows/product_*.json  (kb_flow 召回)
        │
        └─► POST /api/v2/trajectories/analyze
                │
                ▼
            POST /api/v2/trajectories  (functionId=产品库管理, requirement+phases)
                │
                ▼
            record/prepare → record/start (按 phase 引擎操作 SUT)
                │
                ▼
            湿测卡点 → staging → promote（如需）
```

卡 schema 对齐既有信贷卡：`flow` / `aliases` / `menu_path` / `hash_markers` / `preconditions` / `nodes` / `rules` / `exceptions` / `source`。

## 4. 验证路径（模拟用户）

1. 在产品 SPA：产品管理 → **产品库管理**（或 Lead 裁定的功能节点）→ **+ 添加交易录制**。
2. 填写交易名称 + **任务内容**（含关键数据：产品名称 stamp、分类路径等）。
3. AI 分析 → 人工/Lead 确认阶段（可微调）。
4. 选择系统账号 → prepare → 开始录制；引擎按阶段执行。
5. stop → 待确认；核对步骤与 SUT 启用态。

API 等价路径允许（调试用），但最终报告须证明「含任务内容的新交易 + 阶段执行」成立。

## 5. 双开与环境纪律

- **禁写**：信贷线未提交文件；共享 `staged_flows.jsonl` / `_kb.py` / `promote.py` / prompts（改前声明）。
- Python：`D:/anaconda3/python.exe` 或 `./python/python.exe`（勿用 WindowsApps 桩）。
- 改 js_snippets 须重启 executor（本线尽量不改引擎）。
- 收工：`docs/superpowers/agent-log.md` 顶部插条；commit 仅用户明确要求时。

## 6. Agent team 分工（Lead 编排）

| 角色 | 职责 | 产出 | 并行性 |
|------|------|------|--------|
| R1 遗留挖掘 | 列出产品管理下功能与轨迹；摘要高价值（已确认 / 高阶段数）phases | `tmp/product-mgmt/legacy-traj-digest.md` | 与 R2 并行 |
| R2 需求主链 | 从需求分册抽产品库主链操作步骤/按钮/规则 | `tmp/product-mgmt/req-mainchain.md` | 与 R1 并行 |
| R3 功能锚点 | 解析本仓/DB 中「产品库管理」等 functionId、菜单路径 | `tmp/product-mgmt/function-anchors.md` | 与 R1/R2 并行 |
| I1 建卡 | 合并 R1–R3 写 `product_library.json`（+ 可选 pin） | KB 卡文件 | R1–R3 完成后 |
| I2 贯通录制 | 写任务文案 → analyze → 建交易 → 按阶段录制；报告 | `tmp/product-mgmt/through-report.md` | I1 后（可与卡微调重叠） |
| Lead | 裁定挂载节点、审卡、合并冲突、写 agent-log、最终验收 | — | 全程 |

## 7. 风险

- 遗留交易多为页面级碎片，「所属任务」空 → 任务文案须 Lead/R1 重写，不能直接复制交易名。
- 产品树/启用禁用可能有权限或静默校验 → 对照实验 + read_xhr_log 类手段（优先复用已有动作，不新开引擎债）。
- 执行机槽位与信贷线争用 → 录制窗口与并行会话错开。
