# 需求切片 → 原子草稿交易 — 设计

> 日期：2026-09-07  
> 状态：已实现（SDD `a029bb03..c044387f`，characterize OK 19）；待 migrate + 湿测  
> Lead：Cursor brainstorming（会话确认）  
> 相关：`scripts/prompts/skills/req-doc-to-kb/`；`/api/v2/kb/req-modules`；`analyzeRequirementToPhases`

## 1. 目标

用 **需求文档切片作业区**（+ 可选 KB `flows` 护栏）生成 **原子粒度草稿交易**，替代用户手工「新增交易」写任务文案。

本版成功终点：

1. `propose` 给出带出处的原子候选清单；
2. 人勾选后 `commit` 仅创建 `draft` 轨迹（task / phases / businessEntries / functionId）；
3. 每条草稿可追溯：**哪份需求文档 + 哪一章**（结构化字段，不可仅写进正文）。

本版 **不开** 自动录制（避免粒度未审就烧执行机）。

## 2. 范围

### In

- 输入：`data/kb/req/<moduleKey>/`（`through-chains.md`、`chapters/`、可选 `wet-test.md`、`source.link.json`）。
- 两段式 API：`draft-traj/propose` → 人勾选 → `draft-traj/commit`。
- 轨迹出处列：`req_module_key` / `req_source_path` / `req_chapter_ref` / `req_atom_key`。
- 专用生成 prompt（原子化拆解助手）；复用现有 `analyzeRequirementToPhases` + 建轨迹路径。
- `api-docs` catalog 登记；characterization / fixture 覆盖出处拒绝与幂等。
- 切片入口本版维持现有：`POST/GET /api/v2/kb/req-modules` + Agent Skill；源上传仍可为 501。

### Out（本版不做）

- 自动 `prepare` / `record` / 批量录制。
- 从已确认交易扫描沉淀操作组件；批量推送改推原子组件（见 §7 未来方向）。
- 产品 SPA 切片页 / 生成页（后补；本版 API + Agent 贯通）。
- 新 RBAC「角色」；生成「角色」= service + prompt，非权限模型。
- 直接从整本 docx 生成（必须先有切片作业区）。

## 3. 粒度原则

- 目标形态对齐 **原子化组件**（参照登录组件）：伙伴平台将来可随意组合。
- 本版落点仍是 **细粒度 draft trajectory**；组件层属后续版本。
- `propose` 偏向原子闭环（如：新增一级分类 / 新增子分类 / 新增产品），**禁止**默认把整条业务主链打成一笔交易。
- 人未勾选的原子不得建交易。

## 4. 架构与数据流

```
需求分册.docx
    │  既有登记 + Agent 切片（req-doc-to-kb）
    ▼
data/kb/req/<moduleKey>/
  chapters/ · through-chains.md · wet-test.md? · source.link.json
    │
    │  POST /api/v2/kb/req-modules/:moduleKey/draft-traj/propose
    │  （可选召回 data/kb/flows 作按钮/前置护栏，不代替出处）
    ▼
原子候选（未落库）
  atomKey · title · suggestedFunctionId
  sourceDoc · sourceChapter · taskDraft · phaseHints · wetTestHint?
    │
    │  人勾选 atomKeys
    │  POST .../draft-traj/commit
    ▼
逐条：补全 task → analyzeRequirementToPhases → 建 draft 轨迹
  写入四处出处字段；recordStatus=draft
  本版不调用 prepare/record
```

`propose` 可反复调用；仅 `commit` 写交易。

## 5. 出处字段（硬约束）

迁移扩展 `trajectory`：

| 字段 | 含义 |
|------|------|
| `req_module_key` | 作业区 key（如 `product-mgmt`） |
| `req_source_path` | 源文档路径或登记名（`source.link.json`） |
| `req_chapter_ref` | 章节定位（建议 `chapters/<file>.md` + 章标题） |
| `req_atom_key` | propose 稳定键（幂等 / 对账） |

- 任务正文可附「来源：…」展示行，**不得替代**结构化字段。
- 缺任一出处 → 不得进入 propose 的 `atoms`；若仍被塞进 commit → 该条 `skipped`。
- 列表/详情 API 回传上述字段。

## 6. API 契约

### 6.1 Propose

`POST /api/v2/kb/req-modules/:moduleKey/draft-traj/propose`

- Body（可选）：`{ chainIds?, maxAtoms? }`
- 200：`{ atoms: [{ atomKey, title, suggestedFunctionId, sourceDoc, sourceChapter, taskDraft, phaseHints, wetTestHint? }], rejected?: [{ atomKey?, reason }] }`
- `atoms` 仅含出处齐全、可勾选的候选；出处不可解析的进 `rejected`，不得出现在 `atoms`。
- 模块未登记 / 缺 `through-chains.md` → 400。

### 6.2 Commit

`POST /api/v2/kb/req-modules/:moduleKey/draft-traj/commit`

- Body：`{ atomKeys: string[], systemAccountId?, functionIdOverrides?, force? }`
- 行为：仅勾选原子 → analyze → 建 draft；写出处字段。
- 200：`{ created: [{ trajectoryId, atomKey, name }], skipped: [{ atomKey, reason }] }`
- 默认同 `req_atom_key` 已有草稿则 skip；`force=true` 可再建。
- analyze 失败 → 该原子 skipped，其余继续。
- **不**暴露/不调用 prepare、record。

## 7. 未来方向（写入总 TODO，非本版）

| 阶段 | 内容 |
|------|------|
| 下个版本 · 需求评审提出 | 已确认交易扫描 → 沉淀原子化操作组件；批量推送改为可推组件（伙伴组合） |
| 下下个版本 · 开始开发 | 实现扫描/组件晋升与推送契约改造 |

本版只贯通「切片 → 人审原子 → 草稿交易」。

## 8. 错误处理摘要

| 情况 | 行为 |
|------|------|
| 模块/chains 缺失 | propose 400 |
| 出处不可解析 | 原子不可选 / skipped |
| 未知 atomKey | skipped |
| 重复 atomKey | 默认 skip（除非 force） |
| analyze 失败 | 该原子 skipped |

## 9. 验收

1. 已 sliced 模块 propose ≥1 可选原子，且每条含 `sourceDoc` + `sourceChapter`。
2. 勾选子集 commit → 仅这些轨迹为 draft，四处出处非空，可反查章节。
3. 未勾选不建交易；全程无自动录制。
4. catalog 已登记两接口；characterization 覆盖出处拒绝与幂等。

## 10. 测试策略

- Fixture：最小 `data/kb/req/<fixture>/` 或 `tmp` 拷贝。
- 单测/characterization：出处缺失拒绝、幂等 skip、propose 解析。
- 湿测：选一真实 sliced 模块，propose → 勾 1～2 → commit，人工核出处。

## 11. 风险

- `through-chains` 若仍是「粗主链」，propose 的原子化依赖 prompt + 人工勾选纠偏；长期应修订 chains 写法偏向原子。
- `suggestedFunctionId` 可能猜错 → 允许 `functionIdOverrides`。
- 与批量 Excel 录制（`trajectory-batch`）正交：本版不合并，避免误开 record。
