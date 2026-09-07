# Design: click_save 幽灵 pending 活体剪枝

**日期**：2026-09-07  
**状态**：待用户审阅 spec 后实施  
**触发**：#614 重录阶段 4 — sticky `task_list` 含「法人机构」，可见基本信息页无该字段；`click_save` 报 `err-pending-fields`，同时 `scan_editable_summary` 已 `pending=0`。  
**方案**：A（闸门侧活体剪枝），不做扫描准入收紧（B）或闸门改信 live summary（C）。

## 目标

`click_save` 在 `requires_write_all_editable` 闸门失败时，除现有「disabled 无按钮」剪枝外，剔除 **DOM 中找不到** 或 **不可见** 的 sticky pending，再重跑闸门；使可见表单已填满时可提交，不被幽灵字段永久卡住。

## 非目标

- 不改 L2 / `scan_form_fields` 准入规则（方案 B）
- 不把 `check_pending_write_gate` 改成只信 `scan_editable_summary`（方案 C）
- 不修 `QUALITY FAIL` 后轨迹仍 `isSuccessful=1`（另单）
- 不改 `done()` / premature-done 路径（本单仅 `click_save`；若剪枝后保存成功，done 侧自然解除）
- 本单不重录 #614（合入后另开湿测）

## 现状锚点

| 位置 | 行为 |
|---|---|
| `scripts/controller/actions/form_save.py` ~139–168 | 闸门失败后对 `tl.pending` 调 `JS_CHECK_SINGLE_FIELD`；仅 `disabled && !hasButton` 移入 done |
| `scripts/controller/actions/js_snippets/scan_form.py` `JS_CHECK_SINGLE_FIELD` | 命中返回 JSON；未命中返回字符串 `'label-not-found'`（剪枝未消费） |
| 无 `visible` 字段 | `check_field_value` 可命中隐藏 tab/幽灵 form-item，导致「找到但不可选」仍卡闸门 |

## 设计

### 1. `JS_CHECK_SINGLE_FIELD` 增加 `visible`

命中 `.el-form-item` 后，在既有 `disabled` / `required` 等字段旁增加布尔 `visible`：

- 对 **form-item 根节点**（或主控件：`input` / `textarea` / `.el-select` 触发器）判定
- `visible === false` 当且仅当任一成立：
  - 自身或祖先计算样式 `display === 'none'` 或 `visibility === 'hidden'`
  - `getBoundingClientRect()` 宽或高 ≤ 0
- **不**仅因「滚出视口」判不可见（避免折叠外但仍在可滚动主区内的真字段被误剔）
- 未命中仍返回 `'label-not-found'`（字符串，行为不变）

### 2. `form_save.py` 扩展剪枝规则

在现有 prune 循环中，对每个非 `needs_intervention` 的 pending：

| 条件 | 动作 | stderr 分类 |
|---|---|---|
| 返回 `'label-not-found'`，或解析后无有效 `label` | 移出 pending（可 append done 或丢弃；与现 disabled 一致：标入 done 以免反复扫描回灌则优先 done） | `pruned ghost pending` reason=`not-found` |
| JSON 且 `visible === false` | 同上 | reason=`not-visible` |
| 现有：`disabled && !hasButton` | 保持 | 现有 `pruned disabled pending` |
| 其余 | 保留 pending | — |

剪枝后若 `pruned` 非空：写回 `task_list`，再调用一次 `check_pending_write_gate`。仍失败则原样 `err-pending-fields`。

**安全边界**：可见且可交互的空字段继续拦截；只踢「找不到 / 不可见」。

### 3. 测试

新增或扩 `scripts/characterization/`（优先扩既有 form_save / check-single-field 相关；若无则小文件 pin）：

1. `JS_CHECK_SINGLE_FIELD` 源串含 `visible` 与 `label-not-found` 消费路径 cue  
2. `form_save.py` prune 循环含对 `label-not-found` / `visible` 的分支 cue（及 stderr `pruned ghost pending`）  
3. 不削弱现有 disabled prune pin  

跑：`bash scripts/refactor/verify-all.sh`（或至少相关 characterize + 既有 form 相关门禁）。

### 4. 验收（湿测，可后置）

清 #614（或等价基本信息阶段）重录：可见字段填齐后 `click_save` 不再因「法人机构」类幽灵 pending 永久 `err-pending-fields`；stderr 可见 `pruned ghost pending`；保存 toast / success token 可达。

## 文件集

| 路径 | 变更 |
|---|---|
| `scripts/controller/actions/js_snippets/scan_form.py` | `JS_CHECK_SINGLE_FIELD` +`visible` |
| `scripts/controller/actions/form_save.py` | ghost prune 分支 + 日志 |
| `scripts/characterization/*`（相关） | pin |
| `docs/superpowers/agent-log.md` | 开工/收工 |
| 本文件 | spec |

禁入：`scripts/session_runner.py` 他线 WIP；`src/dao/trajectory-dao.js` 等当前工作区未提交轨迹查询改动；方案 B/C；`isSuccessful` 假成功单。

## 风险与回退

- **误剔**：仅 `display:none` / `visibility:hidden` / 零尺寸；不用「是否在视口内」  
- **回退**：revert 上述两文件 + characterize；行为回到仅 disabled prune  

## 决议记录

- 用户选定方案 A（2026-09-07）  
- 用户确认按本设计推进（2026-09-07）
