---
name: req-doc-to-kb
description: >-
  模块级需求分册导入 KB 作业区：登记 data/kb/req/<moduleKey>、
  officecli 切片 chapters + through-chains、可选 drafts。
  禁止写 data/kb/flows、禁止 promote。
---

# 需求文档 → KB 作业区

## 何时使用

用户要求导入/切片某模块需求分册、建 req 作业区时。

触发示例：「导入/切片某某模块需求分册」「按需求建模块作业区」。

## 作业区目录树

登记成功后，模块作业区位于 `data/kb/req/<moduleKey>/`：

```
data/kb/req/<moduleKey>/
├── manifest.json          # 模块元数据与 status
├── source.link.json       # 源文档路径登记
├── chapters/              # 视图1：章节保真（Agent 填）
│   └── *.md
├── through-chains.md      # 视图2：可贯通主链清单
└── drafts/                # 可选：流程卡草稿（非正式 flows/）
    └── *.json
```

- `moduleKey`：`^[a-z0-9]+(-[a-z0-9]+)*$`（如 `product-mgmt`）；中文名写在 manifest。
- `manifest.status` 枚举：`registered` | `sliced` | `drafted`（见下文状态流转）。

## 步骤

1. **登记作业区** — `POST /api/v2/kb/req-modules`（或按契约手建目录）。Body：`moduleKey`、`moduleName`、`sourcePath`、可选 `note`。API 不可用时手建目录并注明。
2. **读源** — officecli 读 `sourcePath`；剥 `RQM_META` 噪声；不改源文件。
3. **视图1：章节保真** — 填 `chapters/`：按文档目录拆章；含标题路径、ZJJK（若有）、要点摘要；文档口径与 SUT 差异单列「待湿测」。
4. **视图2：主链清单** — 写 `through-chains.md`：候选主链（闭环目标、步骤、前置、章节出处）；旁路/Out 单列；可建议挂载叶子/functionId。
5. **可选草稿** — 仅当用户明示「出草稿卡」时写 `drafts/*.json`（`draftFrom: "req"`、`moduleKey`、`sourceRefs`；schema 同正式 flows）。
6. **收工** — 更新 `manifest.status` → `sliced` 或 `drafted`；列章节数、主链条数、草稿数、建议下一湿测主链；收工汇报。

### 状态流转

| status | 含义 |
|--------|------|
| `registered` | 已登记作业区，尚未切片 |
| `sliced` | 已完成 chapters + through-chains |
| `drafted` | 在 sliced 基础上已写 drafts |

## 禁区

- **禁止**写 `data/kb/flows/**`
- **禁止**调用 `promote.py` / **禁止**写 `staging`
- **禁止**一次多模块；**禁止**做手册/接口/案例/计划导入（见 spec §3.1）
- 不改 `_kb.py` / `promote.py` / 正式 `flows/` / `staged_flows.jsonl`（除非另开任务且声明）
- 不以需求原文覆盖湿测铁证

## 检查清单

- [ ] manifest 字段齐全（moduleKey、中文名、源路径、时间、status）
- [ ] chapters 非空或显式说明失败原因
- [ ] through-chains 有候选或「无闭环主链」
- [ ] 未触碰正式 flows
- [ ] 未调用 promote / 未写 staging
