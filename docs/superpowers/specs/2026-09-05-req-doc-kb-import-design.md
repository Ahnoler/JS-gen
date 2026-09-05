# 需求文档导入 → KB 作业区 — 设计

> 日期：2026-09-05  
> 状态：已批准（brainstorming：方案 1；§1–§4；**补充 A：资料包地图仅文档化，第一版仍只导入需求**）  
> Lead：本会话

## 1. 目标

把「读信贷需求分册 → 模块级知识沉淀」从临时会话习惯，固化为：

1. **Agent Skill**（编排规程：怎么切、产出什么、禁区）  
2. **产品薄 API**（模块作业区登记/查询；解析仍由 Agent 执行）

成功终态（最小集）：

1. Skill 落在 `scripts/prompts/skills/req-doc-to-kb/SKILL.md`，步骤/禁区/检查清单完备。  
2. `POST/GET /api/v2/kb/req-modules` 可登记与查询模块作业区；上传端点占位未实现。  
3. 按契约可得到 `data/kb/req/<moduleKey>/`：章节保真 + 可贯通主链清单；可选 `drafts/`，且**不**写入正式 `data/kb/flows/`、不调用 `promote.py`。

## 2. 决策摘要（brainstorming）

| 项 | 选择 |
|----|------|
| 交付形态 | Skill 定契约 + 产品薄导入（方案 1） |
| 导入层次 | **模块**（一次一个模块） |
| 模块内结构 | **双视图**：章节保真 + 可贯通主链清单 |
| 写卡边界 | 允许 `drafts/` 草稿卡；禁止 promote；禁止覆盖正式 `flows/` |
| 输入 | 先 **路径登记**；multipart 上传占位 |
| Skill 路径 | `scripts/prompts/skills/req-doc-to-kb/`（靠近 `scripts/prompts/`，非引擎注入提示） |

## 3. 范围

### In

- 目录契约 `data/kb/req/<moduleKey>/`  
- Skill 工作流（officecli 读源、切片、检查清单）  
- 薄 API：登记 / 列表 / 详情；上传 stub  
- api-docs catalog 同步  
- 最小验收（幂等登记；Skill 文件存在）

### Out（本轮不做）

- 服务端自动 LLM/officecli 切片  
- multipart 真上传与落盘拷贝策略定稿  
- 需求 → `staged_flows.jsonl` 自动桥接  
- 写入或覆盖 `data/kb/flows/**`、调用 `promote.py`  
- 晋升工作台 UI  
- 恢复 `.opencode/skills/`  
- **操作手册 / 接口文档 / 测试案例 / 执行计划** 的登记与切片（见 §3.1；仅预留类型地图）

## 3.1 共享资料包地图（非本版实现）

来源示例：共享文件夹「信贷V5自动化测试」下的分类目录（前缀为盘内约定，非本系统枚举硬编码）：

| 目录前缀（示例） | 含义 | 与 KB / 贯通的关系 | 本版 |
|------------------|------|-------------------|------|
| **X_需求文档** | 需求分册 | 模块导入主路径 → `data/kb/req/` 双视图 + 可选 drafts | **In** |
| **C_操作手册** | 操作说明 | 可校正菜单文案、按钮路径；宜对照湿测，不单独 promote | Out |
| **J_接口文档** | 接口说明 | 贴近报文/字段；可服务 xhr 核对与落库铁证，另线设计 | Out |
| **C_测试案例** | 测试案例 | 可作贯通步骤/验收来源；可与 through-chains 交叉引用 | Out |
| **Z_执行计划** | 执行计划 | 排期与范围，一般不进流程卡 | Out |

后续若扩展：优先在 manifest 增加 `sourceKind`（如 `req` / `manual` / `api` / `case` / `plan`），目录仍按 **模块** 聚合，而不是按资料类型拆顶层作业区。第一版 API/Skill **只接受需求（req）**。

## 4. 架构与目录契约

```
需求分册.docx（本机路径）
        │
        ▼  POST /api/v2/kb/req-modules（登记）
 data/kb/req/<moduleKey>/
   ├── manifest.json
   ├── source.link.json
   ├── chapters/                 # 视图1：章节保真（Agent 填）
   ├── through-chains.md         # 视图2：可贯通主链清单
   └── drafts/                   # 可选：流程卡草稿（非正式 flows/）
        └── *.json
        │
        ├─► Skill：officecli 读源 → chapters + through-chains
        └─► Skill：用户明示后 → drafts/；禁止正式 flows/ 与 promote
```

与现有 KB：

| 路径 | 角色 |
|------|------|
| `data/kb/req/` | 需求作业区（本设计新增） |
| `data/kb/flows/` | 正式流程卡（本功能只读） |
| `data/kb/staging/` | 湿测候选（本功能不写） |
| `scripts/kb/promote.py` | 本功能不调用 |
| `scripts/prompts/*.md` | 引擎 Agent 提示（与本 Skill 分目录） |

`moduleKey`：`^[a-z0-9]+(-[a-z0-9]+)*$`（如 `product-mgmt`）；中文名在 manifest。

## 5. Skill 工作流

**名称：** `req-doc-to-kb`  
**路径：** `scripts/prompts/skills/req-doc-to-kb/SKILL.md`  
**触发：** 「导入/切片某某模块需求分册」「按需求建模块作业区」等。

### 强制步骤

1. **登记作业区** — 调 `POST /api/v2/kb/req-modules`（不可用则按契约手建并注明）。  
2. **读源** — officecli 打开 `sourcePath`；剥 `RQM_META` 类噪声；不改源文件。  
3. **视图1** — `chapters/`：按文档目录拆章；含标题路径、ZJJK（若有）、要点摘要；文档口径与 SUT 差异单列「待湿测」。  
4. **视图2** — `through-chains.md`：候选主链（闭环目标、步骤、前置、章节出处）；旁路/Out 单列；可建议挂载叶子/functionId。  
5. **可选草稿** — 仅用户明示「出草稿卡」时写 `drafts/*.json`。  
6. **收工** — 更新 `manifest.status`（`registered` → `sliced` / `drafted`）；列章节数、主链条数、草稿数、建议下一湿测主链。

### 禁区

- 不改 `_kb.py` / `promote.py` / 正式 `flows/` / `staged_flows.jsonl`（除非另开任务且声明）。  
- 不以需求原文覆盖湿测铁证。  
- 一次只处理一个模块。

### 检查清单

- [ ] manifest 含 moduleKey、中文名、源路径、时间  
- [ ] chapters 非空且有出处标题  
- [ ] through-chains 至少 1 条候选，或显式「无闭环主链」  
- [ ] 未触碰 `data/kb/flows/` 与 promote  

可选：`.cursor/skills/req-doc-to-kb` 短链指向本 Skill（便于 Cursor 自动加载；非必须）。

## 6. API 面

| 方法 | 路径 | 作用 |
|------|------|------|
| `POST` | `/api/v2/kb/req-modules` | 登记模块作业区 |
| `GET` | `/api/v2/kb/req-modules` | 列表 |
| `GET` | `/api/v2/kb/req-modules/:moduleKey` | 详情（manifest + 目录存在性） |
| `POST` | `/api/v2/kb/req-modules/:moduleKey/source` | 上传占位（未实现 / 501） |

### POST 登记

Body：`moduleKey`、`moduleName`、`sourcePath`、可选 `note`。  

行为：建目录与空 `chapters/`、`drafts/`；写 manifest（`status: registered`）与 `source.link.json`；同 key 幂等更新源路径，默认不删已有 chapters（`reset=1` 除外）；可不强制服务端可读该路径（Agent 本机读），可选存在性 warning。

响应：统一 `{ code, message, data }`。

## 7. 草稿卡规则

- 路径：`data/kb/req/<moduleKey>/drafts/<flow_slug>.json`  
- Schema：同正式 flows，另加 `draftFrom: "req"`、`moduleKey`、`sourceRefs`  
- 禁止写入/覆盖 `data/kb/flows/**`；禁止 `promote.py`；禁止写 staging  
- 正式卡已存在：仅 drafts + 提示人工 diff  
- `source` 标明需求章节；待湿测回填  

## 8. 错误与边界

| 情况 | 处理 |
|------|------|
| moduleKey 非法 | 400 |
| 已存在且无 reset | 更新源路径，保留 chapters/drafts |
| 路径本机不存在 | 可登记 + warnings；Skill 读失败停在 registered |
| 要求直接写正式卡 | Skill 拒绝 |
| 一次多模块 | 拒绝 |

## 9. 验收

1. Skill 文件存在且含步骤/禁区/清单。  
2. POST/GET req-modules 可用；catalog 有文档；上传为占位。  
3. 样例模块可登记；Agent 跟跑后可达 `sliced`。  
4. 确认实现路径未写 `data/kb/flows/`（测试或约定检查）。  
5. 本 spec + 后续 implementation plan。  

## 10. 实现分期（供 writing-plans）

| 阶段 | 内容 |
|------|------|
| T1 | 目录约定 + Skill 初稿（可先无 API） |
| T2 | API 登记/列表/详情 + catalog |
| T3 | 上传 stub + 最小 characterize/pin |
| T4 | 用产品管理分册或样例做一次跟跑验收 |

## 11. 参考

- 产品管理先例：`tmp/product-mgmt/req-mainchain.md`、`docs/superpowers/specs/2026-09-04-product-mgmt-kb-design.md`（需求作导航、不直接 promote）  
- KB 交接：`docs/superpowers/research/2026-09-04-kb-build-handover.md`（湿测 → staging → promote）  
- 计划位：`docs/superpowers/plans/2026-09-05-req-doc-kb-import.md`（已写；待执行）
