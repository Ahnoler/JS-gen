# 需求草稿向导：功能候选下拉（§6.4 前端派单）— 设计

> 日期：2026-09-09  
> 状态：已实现（Vue commits `a1ac7d1` · `587f30c`）；待 4097 重启 + product-mgmt 湿测（多行不同功能 overrides）  
> 计划：[`../plans/2026-09-09-req-draft-wizard-function-candidates.md`](../plans/2026-09-09-req-draft-wizard-function-candidates.md)  
> 前置：[`2026-09-08-kb-remediation-design.md`](./2026-09-08-kb-remediation-design.md) §6.4；向导假流式 [`2026-09-08-req-draft-keydata-and-streaming-ux-design.md`](./2026-09-08-req-draft-keydata-and-streaming-ux-design.md)  
> 仓库：Vue `vue-project`（`dev`）；后端契约已就绪，本版不改 JS-gen 运行时

## 1. 问题

加固线已在 propose 原子上返回 `functionIdCandidates`（及既有 `suggestedFunctionId`）。向导仍把左侧选中的**同一个**功能 ID 写入所有勾选原子的 `functionIdOverrides`，人看不见候选，也无法按原子改绑。

`canProposeAtoms` 门控已在向导落地，本派单只补候选展示与按行 overrides。

## 2. 目标

- 候选表展示每行可选功能（下拉）。
- 创建草稿时 `functionIdOverrides` **按 atomKey** 提交用户（或默认规则）选定的 id。
- 不引入 validate / truncated UI / paasUserId（Out）。

成功终点：

- 有 `functionIdCandidates` 或 `suggestedFunctionId` 的行，下拉可见对应选项。
- 勾选多行且改绑不同功能后，commit body 中 overrides 键值互不相同且与 UI 一致。
- 无候选且左侧也未选功能时，该行不可作为可创建状态（见 §4.3）。

## 3. 交互（方案：表列下拉）

在「候选与勾选」表增加 **功能** 列（`el-select`，可过滤）：

| 选项来源 | 规则 |
|----------|------|
| `suggestedFunctionId` | 若非 null，作为一项（标签优先用候选里同 id 的 name，否则 `功能 {id}`） |
| `functionIdCandidates` | 去重合并；展示 `name`（副文案可带 reason：page_code / name_match / menu_path） |
| 左侧当前功能 | 若 `appStore.selectedFunction` 有 id，且尚未在上列，追加一项「左侧：{name}」 |

默认选中（初始化 / 重新生成 / 新揭示行）：

1. `suggestedFunctionId`（若有）  
2. 否则 `functionIdCandidates` 按 `score` 降序第一条  
3. 否则左侧 `selectedFunction.id`  
4. 否则该行 pick 为空

用户改下拉只更新该 `atomKey` 的 pick，不影响其他行。

## 4. 状态与提交

### 4.1 前端类型

`DraftAtom` 增加：

```ts
functionIdCandidates?: Array<{
  id: number
  name: string
  score: number
  reason: 'page_code' | 'name_match' | 'menu_path' | string
}>
kind?: 'write' | 'nav'  // 契约已有；本版可不展示列
```

### 4.2 状态

- `fnPickByAtomKey: Record<string, number>`  
- propose 成功开始揭示前：对 `allAtoms` 按 §3 默认规则填满（可覆盖旧 pick）。  
- 左侧功能变更时：仅对「当前 pick 仍等于旧左侧 id、或 pick 为空」的行，可重刷为新左侧 id（避免覆盖用户已选手动候选）。实现时取简：左侧变更不自动改已有 pick；仅空 pick 行在下次打开下拉前用左侧补默认——**推荐更简：左侧变更不重写任何已有 pick；仅初始化时读左侧一次。**

### 4.3 canCreate

在假流式既有门控上增加：

- `selectedKeys.length ≥ 1`
- `proposeDone && !proposing`
- `systemAccountId` 已选
- **每个** `selectedKeys` 在 `fnPickByAtomKey` 中有有限数字 id  

不再要求「必须先选左侧功能」作为硬条件；左侧仅作默认种子。若某行无 suggested/candidates 且从未选左侧，则该行 pick 空 → 勾选它时 `canCreate=false`（可 toast「请为已勾选原子选择功能」）。

### 4.4 runCommit

```ts
functionIdOverrides[key] = fnPickByAtomKey[key]
```

禁止再统一赋值为左侧单一 id。

## 5. 范围

### In

- `src/api/kb.ts` 类型  
- `req-draft-wizard/index.vue`：功能列、pick 状态、canCreate、runCommit  
- 必要时一行文案提示  

### Out

- `draft-traj/validate`、truncated 条、paasUserId  
- 改 JS-gen propose/commit  
- SSE、改 `canProposeAtoms` 既有逻辑（保持）  
- 展示 `kind` 列（可选后续）

## 6. 验收

- [x] 类型含 `functionIdCandidates`（`a1ac7d1` `kb.ts` + `fn-pick.ts`）  
- [x] 表列下拉可见候选；默认符合 §3（`587f30c` 功能列 + `initFnPicks`）  
- [ ] 两行绑不同功能 → commit overrides 两键两值（**湿测**：重启 4097 + product-mgmt 向导）  
- [x] 无 pick 的勾选行阻止创建（`canCreate` + `buildFunctionIdOverrides` 错误 toast）  
- [x] 不调用 validate；不传 paasUserId（静态 grep / Task 2 checklist）  

## 7. 实现分期

1. ~~类型 + pick 初始化 helper~~ ✓ `a1ac7d1`  
2. ~~表列 UI + canCreate + runCommit~~ ✓ `587f30c`  
3. 湿测 / 静态验收勾选 — 静态 ✓；湿测待 4097 + product-mgmt  

---

**审阅请确认**：§3 表列方案、§4.3 不再强制左侧功能、§5 Out。确认后出实现计划。
