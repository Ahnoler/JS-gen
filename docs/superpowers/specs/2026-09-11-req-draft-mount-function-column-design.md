# 需求草稿向导：挂载功能列（与召回候选分列）— 设计

> 日期：2026-09-11  
> 状态：已实现（Vue commits `90ee152` · `2750958` · `477db1d`）；待 4097 重启 + product-mgmt 湿测  
> 计划：[`plans/2026-09-11-req-draft-mount-function-column.md`](../plans/2026-09-11-req-draft-mount-function-column.md)  
> 决策来源：用户确认现有「功能」列实为召回候选；需**另加一列**选择草稿交易挂在模块下哪个功能叶子  
> 相关：`specs/2026-09-09-req-draft-wizard-function-candidates-design.md`（§6.4 召回下拉，保留）；Vue `req-draft-wizard`；`utils/hierarchy.ts`

## 1. 目标

向导「候选与勾选」表同时具备：

1. **召回候选**：展示引擎 `functionIdCandidates` / `suggestedFunctionId`（匹配提示，可含 reason）。  
2. **挂载功能**：人选「这笔草稿挂在哪个功能叶子下」；选项 = **左侧当前模块下的功能叶子**（与任务目录同级，如「产品管理」下各功能）；写入 commit 的 `functionIdOverrides`。

成功终点：

- 表上两列并存，列名不混淆。  
- 挂载列选项来自模块叶子，**不是**全树召回打分列表。  
- 勾选创建时 overrides 只取自挂载列 pick。  
- 召回列不单独决定挂载（仅可作默认种子，见 §4）。

## 2. 范围

### In

- Vue：`req-draft-wizard/index.vue` 双列；`fn-pick.ts`（或拆出 mount 助手）挂载选项/默认/overrides。  
- 从系统树解析「当前选中功能所属模块」下的叶子列表（复用 `getSystemTree` + `hierarchy` 工具，可新增 `listSiblingFunctionsUnderModule`）。  
- 重命名现列标签为「召回候选」（或等价）；新列标签「挂载功能」。  
- `canCreate` 门闩改为依赖挂载 pick。  
- 自检 / 短自测：选项只含模块叶子；overrides 来自挂载 map。  
- 文档：本 spec；交叉引用更新 §6.4 设计「挂载另列」。

### Out

- 不改 JS-gen `computeFunctionIdCandidates` 算法。  
- 不做跨模块全树搜索挂载。  
- 不改 prepare/record / flow 卡切分。  
- 假流式进度条另单。

## 3. 列契约

| 列名 | 数据 | UI | commit |
|------|------|-----|--------|
| 召回候选 | `suggestedFunctionId` + `functionIdCandidates` | 只读展示 **或** 只读下拉/标签列表（本版推荐：**只读文本**，最高分候选一行 + 可选展开；避免与挂载列双选混淆）。若保留可编辑选中仅作「采纳到挂载」按钮——**本版采用只读**：展示 `name · reason`，不单独存 pick。 | 不写 overrides |
| 挂载功能 | 人选 functionId | `el-select` 可过滤；选项 = 模块下叶子 `{ id, name }`，**无** reason 后缀 | → `functionIdOverrides[atomKey]` |

> 若产品后续要「一点召回即写入挂载」，可加小按钮；本版不做。

## 4. 挂载选项与默认

### 4.1 选项来源

- 输入：`selectedFunction.id`（或 `aggregatedNode` 若用户停在模块节点）。  
- 解析：在系统树中找到该叶子的**父模块节点**，`collectLeafFunctionIds` / 列出直接或递归叶子（与侧栏「模块下功能」一致：通常为模块 children 中的 function 叶子）。  
- 若当前为聚合模块节点：选项 = 该节点 `ids` 对应名称。  
- 若无法解析模块（无选中 / 树未载入）：挂载列选项空，placeholder「请先在左侧选择模块或功能」。

### 4.2 默认 pick（每 atom 初始化）

1. 若 `suggestedFunctionId` 落在模块叶子集合内 → 用它。  
2. 否则若召回最高分候选 id 落在集合内 → 用它。  
3. 否则若左侧当前是叶子且在集合内 → 用左侧 id。  
4. 否则不设（须人手选）。

左侧变更：**不**覆盖用户已改过的挂载 pick（与 §6.4 简策略一致）；仅初始化时读一次。

### 4.3 canCreate

- `proposeDone && !proposing`  
- 至少勾选一行  
- `systemAccountId`  
- 每个勾选 atom 的挂载 pick 为有限 number 且属于当前模块选项集（防脏 id）

## 5. 与 §6.4 关系

| | 2026-09-09 §6.4 | 本版 |
|--|-----------------|------|
| 单列「功能」= 召回+overrides | 是 | **拆开** |
| overrides 来源 | 该列 pick | **仅挂载列** |
| 召回 candidates API | 不变 | 不变 |

§6.4 文档标注：功能列语义变更为召回展示；挂载见本 spec。

## 6. 测试与验收

- [x] 单元/selfcheck：给定模块叶子 [A,B,C] 与 candidates 含库外 D → 挂载选项仅 A,B,C；默认优先集合内 suggested（`90ee152` hierarchy · `2750958` fn-pick selfcheck）。  
- [x] 双列 UI + canCreate ∈ moduleFns + overrides 来自挂载 map（`477db1d` index.vue）。  
- [ ] 湿测：左侧「产品管理→产品库管理」；挂载列可见同模块兄弟功能名（无 `· page_code`）；改两行不同挂载 → commit overrides 两键两值；召回列仍可见 page_code/menu_path 类文案。

## 7. 决策记录

- 双列；召回 ≠ 挂载（用户 2026-09-11）。  
- 挂载选项 = 模块下功能叶子。  
- 本版召回列只读展示，避免双下拉混淆。
