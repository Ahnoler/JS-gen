# Design: `tssc_multi_select` v2 — table 模式三阶段（P0→P1→P2）

**日期**：2026-09-09  
**状态**：待用户审阅（设计已拍板；实现未开始）  
**前置**：[`2026-09-08-tssc-multi-select-action-design.md`](./2026-09-08-tssc-multi-select-action-design.md)（v1 已实现）  
**湿测**：2026-09-09 Playwright MCP @ 产品要素库「选择要素」→「要素名称」（`test.creditv5p2…/elmtgroupOfIndex`）  
**用户裁决**：P2 故意兜底任意第一项（A）；无/`first` 文案跳过 P1；**仅 table 模式**走本 v2；实现取向=**单次 JS 内跑完三阶段**

## 1. 问题

v1 在单次注入里混做「搜索 / 精确匹配 / first / el-option 回退」，agent 难以从返回码判断卡在哪一步；湿测还暴露：

| 现象 | 证据 |
|---|---|
| 「精确查询」**默认开** | 搜「部署」→ `.el-table__empty-text`「暂无数据」；关掉后 → `部署方式` / `部署进度` |
| 搜索无结果时仍可清空恢复列表 | 清空后首页 5 行可点；点首行 → 触发器=`部署方式`，编码联动=`deplMod`，下拉关闭 |
| 同组件两种弹层 | table：`.select-table`；dict：仅 `.el-select-dropdown__item`（如「要素类型」） |

Agent 语义需要更直白：

- 有具体文案 → 先搜再选；搜不到 → **清空后仍填上「当前列表第一项」**（只关心「填了」，可接受与目标文案无关）。
- 无文案 / `first` → agent 只关心字段非空 → 开门后直接选第一项。
- 清空后仍无行 → **失败**，并建议 agent **自行真实点击**完成该字段（勿空转重试本动作）。

## 2. 目标 / 非目标

### In

1. **Table 模式**（可见下拉含 `.select-table`）改为显式三阶段：**P0 开门 → P1 搜索选首（可选）→ P2 清空选首 / 失败建议**。
2. 仍为**一次** `page.evaluate` / 同一 `JS_TSSC_MULTI_SELECT` 注入（不拆 Python 三次调用）。
3. 返回码带阶段前缀，便于 agent 记忆与 characterize pin。
4. 成功路径继续 **stamp 具体展示文案**（禁止落库字面 `"first"`）；export 映射保持 `select:click`。
5. 更新 prompt / characterize：table 路径语义与失败建议文案。

### Out

- 不改 dict / `el-option` 路径的既有逻辑（「要素类型」等）——开下拉后若**无** `.select-table`，走 v1 dict 分支，**不**套 P0/P1/P2。
- 不引入多选、不分页爬全量、不新增动作名（仍 `tssc_multi_select`）。
- 不改外层「选择要素」弹窗的确定/取消（仍由 agent `click_save` 等）。
- 不做常驻 MutationObserver / 新通知 hook（与本线无关）。
- 不把「精确查询」暴露为动作参数。

## 3. 组件识别（门控，不变）

- Host：`.tssc-multi-select` 或 Vue `$options.name` 含 `TsscMultiSelect`。
- 触发器：`.el-select.search-select` / `.el-select .el-input__inner`。
- 非本组件 → `no-tssc-multi-select`（禁止重试本动作）。
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
| 其它非空字符串 | 业务期望显示名（优先中文列） | P0→P1；P1 无行再 P2 |

已选短路（可选保留）：具体文案且 readback 已匹配 → `ok-already:<值>`（不进三阶段）。

## 5. Table 三阶段（单次 JS）

### P0 — 识别并打开

1. 定位 label → 门控 TsscMultiSelect。
2. 点击触发器；轮询直到：
   - 可见 `.el-select-dropdown` 内出现 `.select-table`，或
   - 判定为 dict 模式（无 table，有 option items）→ 转出本设计。
3. P0 本身不单独成功返回；失败才返回（如打不开 / 非 tssc）。

### P1 — 搜索并选第一行（仅具体文案）

1. **强制关闭「精确查询」**（若存在 `.el-switch` 且文案含「精确」且 `is-checked` → click 关掉）。湿测：默认开会导致子串搜空。
2. 向弹层内搜索框（`.search input` / `.select-table` 内 `input.el-input__inner`，**勿**写回触发器）写入 `option_text`（native setter + `input`/`change`）。
3. 等待过滤结果（短轮询）。
4. 若可见 `tr.el-table__row` 数 ≥ 1：点击**第一行** → 回显校验 → 成功  
   `ok-p1:<readback>`（可附带历史兼容别名：引擎仍认 `ok-` / `ok-first:` 前缀为成功亦可，但 **新码以 `ok-p1:` 为准**，pin 钉新码）。
5. 若 0 行（含「暂无数据」）：**不失败**，进入 P2。

### P2 — 清空搜索，选第一行；否则失败建议

1. 清空搜索框（同 P1 写入路径，值为 `''`）；等待列表恢复。
2. 若可见行 ≥ 1：点第一行 → 回显非空 →  
   `ok-p2:<readback>`  
   （语义：**故意兜底**，readback 可与原 `option_text` 无关。）
3. 若仍 0 行：  
   `err-no-options: table empty after clear. Prefer real_click / click_element to fill this field; do NOT blindly retry tssc_multi_select.`  
   （中英文可压缩，但必须含「真实点击 / real_click」类建议，禁止暗示再盲重试本动作。）

无文案/`first`：P0 成功后**直接 P2**（此时搜索框通常已空，等价「选当前页第一行」）。

### 回显与点行

- 点 `tr.el-table__row` 或首个可见 `td`（与 v1 一致）。
- 成功条件：触发器 `value` 或 `vm.selectName|myValue|chosenValue` 非空；P1 不要求与 `option_text` 全等（过滤后的「第一个」即可）；P2 同理。
- 点了但回显仍空 → `err-no-echo:…`（勿盲目重试；可一次 real_click 兜底若 v1 已有，保持一次上限）。

## 6. 返回码汇总（table v2）

| 码 | 含义 | Agent |
|---|---|---|
| `ok-already:…` | 已是目标 | 停 |
| `ok-p1:…` | 搜索后选中首行 | 信任 |
| `ok-p2:…` | 清空后（或无文案）选中首行 | 信任；知可能非目标文案 |
| `ok-first:…` / `ok:…` | **兼容**：dict 或迁移期；新 table 路径优先发 `ok-p1`/`ok-p2` | 同 ok |
| `label-not-found` / `disabled` / `no-tssc-multi-select` | 同 v1 | 同 v1 |
| `err-no-options:…` | P2 后仍空 | **改真实点击**；勿盲重试 |
| `err-no-echo:…` | 点了无回显 | 勿盲重试 |
| `no-items` | 开门后既无 table 也无 option | 有限重试后上报 |

Dict 路径继续可用既有 `ok:` / `ok-first:` / `option-not-found:` 等，本设计不强制改名。

## 7. 录制 / 导出

- `_record_action('tssc_multi_select', {label_text, option_text}, …)` 不变。
- 成功时 `resolve_recorded_option_text`：从 `ok-p1:` / `ok-p2:` / `ok-first:` / `ok:` / `ok-echo:` / `ok-already:` 解析具体文案写入 params（**永不**保留 `"first"`）。
- Legacy export：`tssc_multi_select` → `select:click`（已有，保持）。

## 8. Prompt / 扫描

- `agent-tools-tssc-multi-select.md`（或等价节）：说明 table 三阶段与「无文案=任意第一项」「失败请真实点击」。
- 扫描 kind `tssc-multi-select` 不变；仍禁止用 `click_element_by_index` 点远程表行作为**首选**（失败建议除外）。

## 9. 验收（实现时）

| # | 验收 | 方式 |
|---|---|---|
| C1 | 源码含 P0/P1/P2 阶段注释或函数边界 + `ok-p1`/`ok-p2`/`err-no-options` | cold pin |
| C2 | 精确查询：P1 路径强制关 `is-checked` 精确开关 | cold 字符串 / 单测式 stub 可选 |
| C3 | `wantFirst` → 不写搜索（跳过 P1） | pin |
| C4 | stamp 识别 `ok-p1:`/`ok-p2:` | 既有 select-option-stamp 类 pin 扩展 |
| C5 | dict 分支关键词仍在（`.el-select-dropdown__item` fallback） | 既有 characterize-tssc pin |
| C6 | `verify-all` 注册新/更新 pin | bash gate |

湿测（可选、非门禁）：要素名称搜「部署」在默认精确开时 v2 仍能经关精确→P1 选中；故意搜无匹配词 → `ok-p2` 非空。

## 10. 实现落点（供 plan）

- 主改：`scripts/controller/actions/js_snippets/tssc_multi_select.py`
- 引擎 stamp：`form_action_engines.py`（若前缀列表需扩）
- Prompt：`scripts/prompts/**` 中 tssc 专节
- Pin：`scripts/characterization/cold/characterize-tssc-multi-select*.py`（或新建 v2 pin）+ `verify-all.sh`
- **不改**：dict 专用逻辑文件集以外的死代码清理 / whitelist / kb 线

## 11. 决议记录

| # | 议题 | 决议 |
|---|---|---|
| D1 | P1 无结果后 P2 | **A**：清空后选列表第一项（可与目标无关） |
| D2 | 无/`first` | 跳过 P1，P0→P2（只关心填了） |
| D3 | 模式范围 | **仅 table**；dict 保持 v1 |
| D4 | 编排 | **单次 JS** 内三阶段（非 Python 拆三次） |
| D5 | 精确查询 | P1 强制 OFF；不暴露参数 |

## 12. Spec 自检

- [x] 无 TBD/占位实现细节未标出（湿测等待时长留给 plan 用现有 sleep/轮询常量）
- [x] 与 v1 文档关系：table 交互序列以本文件为准；门控/签名/扫描/dict 仍服从 v1
- [x] 无「既要精确匹配目标文案又要 P2 任意第一项」的矛盾（P2 明确为兜底）
- [x] 范围：不扩多选/分页爬取/新动作名
