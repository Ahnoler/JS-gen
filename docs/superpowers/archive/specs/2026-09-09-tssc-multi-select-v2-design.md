# Design: `tssc_multi_select` v2 — table 模式三阶段（P0→P1→P2）

**日期**：2026-09-09  
**状态**：已批准（2026-09-09）；实现计划 [`../plans/2026-09-09-tssc-multi-select-v2.md`](../plans/2026-09-09-tssc-multi-select-v2.md)  
**前置**：[`2026-09-08-tssc-multi-select-action-design.md`](./2026-09-08-tssc-multi-select-action-design.md)（v1 已实现）  
**湿测**：2026-09-09 Playwright MCP @ 产品要素库「选择要素」→「要素名称」；对公客户评级申请「客户名称」（同为 `TsscMultiSelect` + `.select-table`）  
**用户裁决**：P2 故意兜底任意第一项（A）；无/`first` 文案跳过 P1；**仅 table 模式**走本 v2；实现取向=**单次 JS 内跑完三阶段**；**agent 面只暴露 `select_option`，内部转调本实现（D6）**

## 1. 问题

v1 在单次注入里混做「搜索 / 精确匹配 / first / el-option 回退」，agent 难以从返回码判断卡在哪一步；湿测还暴露：

| 现象 | 证据 |
|---|---|
| 「精确查询」**默认开** | 搜「部署」→ `.el-table__empty-text`「暂无数据」；关掉后 → `部署方式` / `部署进度` |
| 搜索无结果时仍可清空恢复列表 | 清空后首页 5 行可点；点首行 → 触发器=`部署方式`，编码联动=`deplMod`，下拉关闭 |
| 同组件两种弹层 | table：`.select-table`；dict：仅 `.el-select-dropdown__item`（如「要素类型」） |
| 客户名称同族 | 对公评级申请弹窗：`TsscMultiSelect` + `.select-table`；历史轨迹用 `select_option` 录过，**从未**录到 agent 直调 `tssc_multi_select` |

Agent 语义需要更直白：

- 有具体文案 → 先搜再选；搜不到 → **清空后仍填上「当前列表第一项」**（只关心「填了」，可接受与目标文案无关）。
- 无文案 / `first` → agent 只关心字段非空 → 开门后直接选第一项。
- 清空后仍无行 → **失败**，并建议 agent **自行真实点击**完成该字段（勿空转重试本动作）。

另：**不要让 agent 学习第二个选值动作名**。`select_option` 已是下拉/选项类的统一入口；`tssc_multi_select` 应降为引擎内部子分支（现行 `lookup_field_kind == 'tssc-multi-select'` 时的 handoff 方向正确，v2 把它做完整）。

## 2. 目标 / 非目标

### In

1. **Table 模式**（可见下拉含 `.select-table`）改为显式三阶段：**P0 开门 → P1 搜索选首（可选）→ P2 清空选首 / 失败建议**。
2. 仍为**一次** `page.evaluate` / 同一 `JS_TSSC_MULTI_SELECT` 注入（不拆 Python 三次调用）。
3. 返回码带阶段前缀，便于 characterize pin 与日志；对 agent 仍包装在 `select_option` 成功/失败语义下。
4. 成功路径继续 **stamp 具体展示文案**（禁止落库字面 `"first"`）；export 映射保持 `select:click`。
5. **Agent / controller 对外面：只保留 `select_option`**（见 §2.1）；凡 `tssc-multi-select` kind（及 live DOM 检出 `.tssc-multi-select`）一律经 `select_option` → 内部实现完成。
6. Prompt / 扫描文案：教 agent 对「要素名称 / 客户名称」类字段继续调 `select_option`；删除「必须调用 `tssc_multi_select`」的 agent 指引。

### Out

- 不改 dict / `el-option` 路径的既有逻辑（「要素类型」等）——开下拉后若**无** `.select-table`，走 v1 dict 分支，**不**套 P0/P1/P2。
- 不引入多选、不分页爬全量、**不**向 agent 新增/保留独立动作名。
- 不改外层「选择要素」/「对公客户评级申请」弹窗的确定/取消（仍由 agent `click_save` 等）。
- 不做常驻 MutationObserver / 新通知 hook（与本线无关）。
- 不把「精确查询」暴露为动作参数。

### 2.1 Agent 面：`select_option` 唯一入口（D6）

**原则**：把 `tssc_multi_select` **完全**做成 `select_option` 的子分支。

| 层 | 行为 |
|---|---|
| Agent tools / prompt | **不**列出、不教、不要求调用 `tssc_multi_select(...)`。选值统一 `select_option(label_text, option_text, xpath_smart="")`。 |
| Controller 对 agent 注册 | **取消**（或不注册）面向 agent 的 `tssc_multi_select` 工具/动作条目（`scripts/models/action.py`、event_dispatch 白名单、state 字段类表、prompt 包挂载等**对外注册面**）。内部 Python 方法与 JS snippet **可保留**，仅供 `select_option` 转调。 |
| `select_option` 引擎 | 保持并强化既有 handoff：`lookup_field_kind == 'tssc-multi-select'`（或 live 检出 host）→ 调用内部 `tssc_multi_select` / `JS_TSSC_MULTI_SELECT`（v2 三阶段）。普通 `el-select` 仍走 `JS_SELECT_OPTION`。 |
| 录制落库 | 经该 handoff 成功的步骤，**记作 `select_option`**（与 agent 调用面一致）；`target_kind` 仍可为 `form_tssc_multi_select` 以便回放定位。历史库中已有的 `action_type=tssc_multi_select` 行保留兼容（replay/export 已映射 `select:click`）。 |
| 失败建议文案 | 禁止「请改调 `tssc_multi_select`」；应写「勿盲重试 `select_option`；改真实点击 / `click_element`」等。 |
| 扫描 kind | 仍识别 `tssc-multi-select`（用于路由与 `fill_form_field` 拒绝直填），但推荐 next_action **只给** `select_option(...)`。 |

```
agent: select_option(label, option, xpath?)
           │
           ├─ kind/live == tssc-multi-select ──► 内部 tssc 实现（JS v2 P0–P2 / dict）
           │                                      record: select_option + target_kind=form_tssc_multi_select
           └─ 普通 el-select ──────────────────► JS_SELECT_OPTION
                                                  record: select_option
```

v1 曾把 `tssc_multi_select` 注册成独立 agent 动作；**本 v2 明确撤回该产品面**（实现文件可留作子程序）。

## 3. 组件识别（门控，不变）

- Host：`.tssc-multi-select` 或 Vue `$options.name` 含 `TsscMultiSelect`。
- 触发器：`.el-select.search-select` / `.el-select`（含 **readonly** 触发器，如客户名称——要点 select 外壳，勿依赖可输入 trigger）。
- 非本组件 → 内部返回 `no-tssc-multi-select`；`select_option` 应回退或报「非 tssc / 用普通 select 路径」，**不**让 agent 改调已下线的动作名。
- `disabled` → `disabled`（跳过）。

**模式分流（开门后）**

```
P0 打开下拉后：
  若存在可见 .select-table → table v2（本设计）
  否则若存在可见 .el-select-dropdown__item → dict（v1 保持）
  否则 → no-items / 等行超时（既有语义）
```

## 4. `option_text` 语义

| 输入 | 含义 | 阶段 |
|---|---|---|
| 空 / `"first"` / `"1st"` / `"第一个"` / `"第一项"` | 只关心是否填写，不关心填什么 | **跳过 P1**，P0→P2 |
| 其它非空字符串 | 业务期望显示名（优先中文/名称列） | P0→P1；P1 无行再 P2 |

已选短路（可选保留）：具体文案且 readback 已匹配 → `ok-already:<值>`（不进三阶段）。

Agent 侧仍只传 `select_option` 的 `option_text`；语义与上表相同。

## 5. Table 三阶段（单次 JS）

### P0 — 识别并打开

1. 定位 label → 门控 TsscMultiSelect。
2. 点击触发器（readonly 时点 `.el-select` / caret）；轮询直到：
   - 可见 `.el-select-dropdown` 内出现 `.select-table`，或
   - 判定为 dict 模式（无 table，有 option items）→ 转出本设计。
3. P0 本身不单独成功返回；失败才返回（如打不开 / 非 tssc）。

### P1 — 搜索并选第一行（仅具体文案）

1. **强制关闭「精确查询」**（若存在 `.el-switch` 且文案含「精确」且 `is-checked` → click 关掉）。无开关（如客户名称）→ 跳过。湿测：要素名称默认开会导致子串搜空。
2. 向弹层内搜索框（`.search input` / `.select-table` 内 `input.el-input__inner`，**勿**写回触发器）写入 `option_text`（native setter + `input`/`change`）。
3. 等待过滤结果（短轮询）。
4. 若可见 `tr.el-table__row` 数 ≥ 1：点击**第一行** → 回显校验 → 成功  
   `ok-p1:<readback>`（引擎仍认 `ok-` / `ok-first:` 前缀为成功亦可，但 **新码以 `ok-p1:` 为准**，pin 钉新码）。
5. 若 0 行（含「暂无数据」）：**不失败**，进入 P2。

### P2 — 清空搜索，选第一行；否则失败建议

1. 清空搜索框（同 P1 写入路径，值为 `''`）；等待列表恢复。
2. 若可见行 ≥ 1：点第一行 → 回显非空 →  
   `ok-p2:<readback>`  
   （语义：**故意兜底**，readback 可与原 `option_text` 无关。）
3. 若仍 0 行：  
   `err-no-options: table empty after clear. Prefer real_click / click_element to fill this field; do NOT blindly retry select_option.`  
   （必须含「真实点击 / real_click」类建议；**禁止**提及已下线的 agent 动作名 `tssc_multi_select`。）

无文案/`first`：P0 成功后**直接 P2**（此时搜索框通常已空，等价「选当前页第一行」）。

### 回显与点行

- 点 `tr.el-table__row` 或首个可见 `td`（与 v1 一致）。
- 成功条件：触发器 `value` 或 `vm.selectName|myValue|chosenValue` 非空；P1 不要求与 `option_text` 全等（过滤后的「第一个」即可）；P2 同理。
- 点了但回显仍空 → `err-no-echo:…`（勿盲目重试；可一次 real_click 兜底若 v1 已有，保持一次上限）。

## 6. 返回码汇总（table v2）

| 码 | 含义 | Agent（经 select_option） |
|---|---|---|
| `ok-already:…` | 已是目标 | 停 |
| `ok-p1:…` | 搜索后选中首行 | 信任 |
| `ok-p2:…` | 清空后（或无文案）选中首行 | 信任；知可能非目标文案 |
| `ok-first:…` / `ok:…` | **兼容**：dict 或迁移期；新 table 路径优先发 `ok-p1`/`ok-p2` | 同 ok |
| `label-not-found` / `disabled` / `no-tssc-multi-select` | 同 v1 | 跳过或改策略；勿发明第二动作名 |
| `err-no-options:…` | P2 后仍空 | **改真实点击**；勿盲重试 `select_option` |
| `err-no-echo:…` | 点了无回显 | 勿盲重试 |
| `no-items` | 开门后既无 table 也无 option | 有限重试后上报 |

Dict 路径继续可用既有 `ok:` / `ok-first:` / `option-not-found:` 等，本设计不强制改名。

## 7. 录制 / 导出

- 经 `select_option` handoff 成功：`_record_action('select_option', {label_text, option_text}, …)`，`target_kind='form_tssc_multi_select'`（若已捕获）。
- 成功时 `resolve_recorded_option_text`：从 `ok-p1:` / `ok-p2:` / `ok-first:` / `ok:` / `ok-echo:` / `ok-already:` 解析具体文案写入 params（**永不**保留 `"first"`）。
- Legacy export：`select_option` → `select:click`；历史 `tssc_multi_select` → `select:click`（已有，保持）。
- 内部若仍存在直调 `tssc_multi_select` 的测试/兼容入口：实现期可改为同样记 `select_option`，或仅保留给 cold pin；**产品录制路径不得再写出新的 `action_type=tssc_multi_select`**。

## 8. Prompt / 扫描

- **移除或改写** `agent-tools-tssc-multi-select.md` 的 agent 挂载：不再作为独立工具包注入；必要语义并入 `select_option` / form 工具说明（远程表行、可用 `option_text=first`、失败改真实点击）。
- 扫描 kind `tssc-multi-select` 不变；推荐动作一律 `select_option`。
- 仍禁止用 `click_element_by_index` 点远程表行作为**首选**（失败建议除外）。
- `fill_form_field` 遇 tssc：继续拒绝直填；`next_action` 改为 `select_option(...)`（不要再写 `tssc_multi_select(...)`）。

## 9. 验收（实现时）

| # | 验收 | 方式 |
|---|---|---|
| C1 | 源码含 P0/P1/P2 阶段注释或函数边界 + `ok-p1`/`ok-p2`/`err-no-options` | cold pin |
| C2 | 精确查询：P1 路径强制关 `is-checked` 精确开关（无开关则跳过） | cold 字符串 |
| C3 | `wantFirst` → 不写搜索（跳过 P1） | pin |
| C4 | stamp 识别 `ok-p1:`/`ok-p2:`；handoff 录制 action=`select_option` | pin |
| C5 | dict 分支关键词仍在（`.el-select-dropdown__item` fallback） | 既有 characterize-tssc pin 调整 |
| C6 | Agent 注册面：**无**面向 LLM 的 `tssc_multi_select` 工具条目；prompt 不要求直调 | pin + prompt 文本断言 |
| C7 | `select_option` 在 kind=tssc 时仍转调内部实现 | pin（已有 handoff 行可加强） |
| C8 | `verify-all` 注册新/更新 pin | bash gate |

湿测（可选、非门禁）：要素名称搜「部署」在默认精确开时 v2 仍能经关精确→P1 选中；故意搜无匹配词 → `ok-p2` 非空；客户名称完整名 / `first` 经 `select_option` 可填。

## 10. 实现落点（供 plan）

- 主改：`scripts/controller/actions/js_snippets/tssc_multi_select.py`（v2 三阶段）
- 引擎：`form_action_engines.py` — handoff、录制改 `select_option`、错误文案、取消 agent 直调路径
- **反注册**：`scripts/models/action.py`、`event_dispatch.py`、`state.py`、prompt 挂载（`agent-tools-tssc-multi-select.md` / `agent-prompt.md` / `agent_utils.py`）等对外面；`src/models/action-name.js` 可保留别名仅兼容旧轨迹
- Pin：更新 `characterize-tssc-multi-select*.py`（改为「内部子分支 + select_option 入口」叙事）+ `verify-all.sh`
- **不改**：whitelist / kb / 死代码清理线

## 11. 决议记录

| # | 议题 | 决议 |
|---|---|---|
| D1 | P1 无结果后 P2 | **A**：清空后选列表第一项（可与目标无关） |
| D2 | 无/`first` | 跳过 P1，P0→P2（只关心填了） |
| D3 | 模式范围 | **仅 table**；dict 保持 v1 |
| D4 | 编排 | **单次 JS** 内三阶段（非 Python 拆三次） |
| D5 | 精确查询 | P1 强制 OFF（无开关则跳过）；不暴露参数 |
| D6 | Agent / 注册面 | **`select_option` 唯一对外**；`tssc_multi_select` 仅为内部子分支；controller **不向 agent 注册**该动作；新录制不写 `action_type=tssc_multi_select` |

## 12. Spec 自检

- [x] 无 TBD/占位实现细节未标出（湿测等待时长留给 plan 用现有 sleep/轮询常量）
- [x] 与 v1 文档关系：table 交互序列以本文件为准；门控/扫描/dict 仍服从 v1；**v1「独立 agent 动作」产品面由 D6 撤回**
- [x] 无「既要精确匹配目标文案又要 P2 任意第一项」的矛盾（P2 明确为兜底）
- [x] 无「agent 仍要直调 tssc_multi_select」与 D6 的矛盾
- [x] 范围：不扩多选/分页爬取；不向 agent 新增动作名
