---
name: draft-traj-coach
description: >-
  OpenCode/Cursor sidecar SOP for 需求作业区 → 原子草稿交易（draft-traj）：
  register/upload/parse（可选）→ propose 多轮纠偏 → 人确认 atomKeys 后 validate/commit。
  Use whenever the user asks for 需求生成草稿交易、draft-traj coach、原子草稿、
  propose/commit 需求原子、through-chains 改链再 propose，或要对齐 recording-coach
  旁路模式跑 KB req-modules 管线——even if they only say「从需求出 draft」or
  「product-mgmt 勾选提交」。Does NOT run prepare/record; does NOT promote flows.
---

# Draft-Traj Coach（需求 → 原子草稿交易）

旁路操作员 skill：用 OpenCode（或同等 Agent）+ 控制面 `/api/v2/kb/*`，把需求模块作业区收成**可勾选原子**并在人确认后建成 `recordStatus=draft` 交易。

产品契约以控制面 `/api/docs` 的 KB 组为准（parse / draft-traj/propose|validate|commit）。  
兄弟线：切片湿测用 `req-doc-to-kb`；真机录制用 recording-coach——本 skill 不替代二者。

## 三个角色

| 角色 | 职责 |
|------|------|
| **编排者** | 给 moduleKey、源文档或已有作业区、勾选 `atomKeys`（及可选 functionId） |
| **操作员** | 本进程。调预留工具或 HTTP；可改 `through-chains.md`；写证据目录；**不**自动 commit；**不**打开浏览器点业务；**不** git commit |
| **控制面** | parse / propose / validate / commit 与 MySQL 轨迹真源 |

## 何时使用

- 「从需求文档出原子草稿交易」「draft-traj coach」「对 product-mgmt propose 再勾选 commit」
- 需要多轮纠正 `rejected`（能力内聚 / 依赖图），而不是单次 atomize 提示词碰运气
- 已有 `data/kb/req/<module>/`，要跑 propose → 人审 → commit，且暂不录制

**不要用本 skill：** 只做章节保真/湿测叶表 → `req-doc-to-kb`；要真机录制验收 → recording-coach。

## 输入两份（勿混写）

模板见 `templates/dispatch-brief.md`。

1. **dispatch-brief**（给操作员）：moduleKey、控制面 URL、是否有源文档、目标链 `chainIds`、禁区、成功判据。
2. **pick-list**（给人审后回填）：`atomKeys[]` + 可选 `functionIdOverrides` / `flowRefOverrides`。未收到 pick-list 前相位停在 `AwaitingPick`。

## 相变（权威态将落 `workflow.json`；工具未实现前用证据目录手记）

```
CollectInputs → SourceReady → Sliced → Proposed → AwaitingPick
  → Validated → Committed → Done
       │              │
       └─ RefineChains ←┘
```

| 相 | 进入 | 操作员行为 | 退出 |
|----|------|------------|------|
| CollectInputs | 开场 | 收齐 moduleKey、baseUrl、源或「已 sliced」声明 | → SourceReady 或直接 Sliced |
| SourceReady | 已登记且有 localCopy / 可读 sourcePath | 可 `parse_module` | → Sliced |
| Sliced | `canProposeAtoms=true` | `propose_atoms` | → Proposed |
| Proposed | propose 返回 | 按金样五条分拣 atoms；写 pick-list | → AwaitingPick；thin 占比高可 → RefineChains |
| RefineChains | 编排者同意改链 | **只改** `through-chains.md`，留 diff；废旧 propose 缓存后重 propose | → Proposed |
| AwaitingPick | 已给出建议清单 | **等待人确认 atomKeys**；禁止 commit | 收到 pick-list → Validated 路径 |
| Validated | `validate_atoms` 全 ok 或可解释 problems | 人确认后 `commit_drafts` | → Committed |
| Committed / Done | commit 返回 | `write_through_report` + `close.txt` | 终局 |

人未勾选即收工 → 结论 `PROPOSED_`，合法 Done。

## 预留工具顺序（实现前用等价 HTTP）

工具名固定，便于日后 plugin 接线；HTTP 对照见 `references/api-map.md`。

| # | 工具 | 说明 |
|---|------|------|
| 1 | `register_module` | 可选；`POST …/req-modules` |
| 2 | `upload_source` | 可选；`POST …/source` multipart |
| 3 | `parse_module` | 有源时；同步 LLM，超时放宽（≥300s） |
| 4 | `read_workspace` | GET 模块详情 + 读 through-chains/chapters 摘要 |
| 5 | `propose_atoms` | `POST …/draft-traj/propose`；可带 chainIds/maxAtoms |
| 6 | `rewrite_through_chains` | 仅 RefineChains；备份旧文件到证据目录 |
| 7 | `present_pick_list` | 按 `taskdraft-quality.md` 分拣 near_gold / thin；写出建议勾选 |
| 8 | `validate_atoms` | 须已有人确认的 atomKeys |
| 9 | `commit_drafts` | **硬闸：无确认 atomKeys 则拒绝调用** |
| 10 | `write_through_report` | through-report.md + close.txt |

## 铁律

1. **人未确认 atomKeys → 禁止 `commit_drafts`**（也禁止手搓等价 POST）。
2. **禁止** `prepare` / `record` / `record/start`；本线终点是 draft 交易。
3. **禁止**写 `data/kb/flows` 或 promote；流程卡晋升另线。
4. **`chapters/` 只读**。原子化卡在链太粗时改 `through-chains.md`（须备份 + diff），改后必须重新 propose。
5. parse / 改链后旧 `.draft-traj-propose.json` 作废；commit 遇 `STALE_PROPOSE_CACHE` → 重 propose，勿强行 commit。
6. 不编造 ZJJK / 按钮文案 / 章节路径；切片无效 → `BLOCKED_`，可移交 `req-doc-to-kb`。
7. 默认不 `force` commit；重复 atom → skip/`duplicate_draft`，除非编排者明示 force。
8. **闸门通过 ≠ 质量达标。** 建议勾选只收「较接近金样」的 atom（见下节）；薄稿不得默认推进 commit。
9. **文案真值：SUT 湿测 ≥ 需求文档 ≥ 派生物。** `read_workspace` 必读同目录 `wet-test.md` 与可选 `sut-settled.md`；propose 已注入 `sutSettledHints`。改链时按钮/查询口径跟定案，勿把过期总览旧词拷回 `through-chains`。

## 草稿质量标准（操作员必读）

本包内自洽，只读：

- `references/taskdraft-quality.md` — 金样五条、标签、分拣规则  
- `references/taskdraft-gold-examples.md` — 较密正向全文  
- `references/taskdraft-thin-examples.md` — 薄稿反面全文  

### 金样五条（建议勾选须同时满足）

1. **进页 / 定位** — 进入功能页并等待加载；有依赖则搜索/选中；禁止系统菜单面包屑作第 1 步。
2. **单一业务能力** — 一笔只做新增 / 维护 / 删除 / 查询 / 设置…之一。
3. **可执行步骤 + 断言收尾** — 【保存】/【确定】成功，或查询「列表展示…」。
4. **多步编号** — 禁止单行「标题（页面），操作：【A】/【B】」跟表薄稿。
5. **业务名 produces/depends** — 禁止 `…产物` 占位或与 title 雷同刷空字段。

### 薄稿标签（命中任一 → 建议暂缓）

`thin_one_liner` · `button_list_only` · `no_locate` · `menu_nav` · `produces_placeholder` · `no_assert` · `multi_cap_in_chain`

`present_pick_list` 必须分两栏：**建议勾选（near_gold）** / **建议暂缓（thin + flags）**。编排者强行勾选 thin 时，报告注明「覆盖质量建议」。

## 纠偏策略

1. 读 `rejected[]`（见 `references/reject-reasons.md`）。`multi_capability` / `multi_persist` **优先当真阳性**：RefineChains 拆步，勿松闸门。
2. 闸门通过但 thin → 先评估能否靠改链补进页/拆 OR 写能力；改链后重 propose；仍 thin 则暂缓勾选。
3. 同批依赖断裂 → 拆 atom 或 `preset`，再决定 RefineChains。
4. 空转同一 propose 参数超过 2 次且 near_gold 无增量 → `BLOCKED_需人工改链或调 atomize`，停手。

杠杆顺序：① through-chains 拆步与去菜单导航 → ② 逼多步 taskDraft（禁单行操作列表）→ ③ 才考虑移交改线上 atomize prompt（本 skill 不擅自改 `scripts/prompts/`，除非编排者授权）。

## 管线验收 vs 质量验收

见 `references/acceptance.md`。

| 层 | 过关含义 |
|----|----------|
| 管线 `PROPOSED_` / `COMMITTED_` | API/人闸/证据齐全 |
| 质量 `near_gold` | 满足金样五条；可建议人勾选 |
| 质量终裁 | 编排者人工确认；操作员不宣布「业务已达标」 |

人未勾选但已按标准分拣 → `PROPOSED_` 合法 Done。

## close.txt

`write_through_report` 后，**最后一条助手消息必须与 `close.txt` 完全相同**。形态见 `templates/close.txt`。结论前缀只允许：`PROPOSED_`、`COMMITTED_`、`BLOCKED_`、`REJECTED_`、`ERROR`。

## 脚手架（后置）

旁路工程 `tools/draft-traj-coach/src/`（OpenCode plugin + workflow）**尚未实现**；本 skill 先约束行为。实现后工具成功回调才推相，与 recording-coach 同构。

脚手架脚本位预留：`skill/scripts/`（init-evidence / present-pick-list dry-run）。
