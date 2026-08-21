# Design: T5 前刀 — 信贷页可见可编辑漏扫清单（Playwright MCP）

**Date:** 2026-08-10  
**Status:** Approved 2026-08-10 — execute gap pass then decide T5 impl  
**Backlog:** T5（本刀**不实现**自定义网格扫描；只产出差分，再决定是否开 T5 实现）  
**Related:** `docs/superpowers/backlog-visible-editable-controls.md`（α 业务控件定稿）

## Goal

在**一个**信贷业务页上，对照：

1. 产品扫描基线：`scan_editable_summary`（Source A/B/C 摘要），与  
2. Playwright MCP 枚举的「可见 + 已分类可编辑」控件，

输出**漏扫差分表**，回答：缺口主要在**容器**（如非 `el-table` 网格）还是**类型/label**，再决定下一刀是否做 T5 Source B 扩展。

## Non-goals

- 不写新的 Source B / 自定义网格扫描代码  
- 不用 chrome-devtools；探查工具为 **Playwright MCP**（若会话未接入，经用户同意可用 Cursor `cursor-ide-browser` 等价操作，结果格式相同）  
- 不把壳层顶栏/侧栏导航计入「应扫」集合（定稿：壳层不进清单）  
- 不触发清单 auto-fill；不改 Agent 写路径  
- 不做多交易普查（那是方案 B）

## Target page

- **Default:** 对公客户评级相关已登录业务页（与近期 CDP 复现同系，如 `…/rtgMgt/cpctRtg/…`）  
- **Override:** 用户指定 URL / 交易名则改用指定页  
- 前置：控制面 + 有头浏览器可用；页面已登录并停在可扫的业务表面

## Control taxonomy（应对齐的「可见可编辑」）

与 backlog α 一致，本刀只统计已分类：

| Kind | Notes |
|------|--------|
| input | 文本/数字等 |
| select | `el-select` 等 |
| date | 日期/日期时间 |
| radio / checkbox | 含表格内 |
| button | 普通按钮（含「多按钮」组内每一个） |
| icon | 图标按钮（tooltip / aria） |
| tree | 树节点可点区域 |

**Excluded from “should scan”:** 壳层菜单/顶栏/侧栏；纯展示文本；disabled 且不可交互（可在差分里单列「见但不可编」）。

## Method

```text
[业务页就绪]
    → (1) 跑 scan_editable_summary（或同页等价扫描），保存 JSON 摘要
    → (2) Playwright MCP：按 taxonomy 收集可见可交互节点（选择器/role/可见文本）
    → (3) 归一化后做集合差分
    → (4) 写入本 spec「Results」或同目录短报告；更新 backlog 推荐下一刀
```

### Baseline (1)

- 调用现有 Agent/工具路径上的 `scan_editable_summary`（多根模式若页面有 overlay 则按现状）  
- 记录：`pending_labels` / filled / `buttons[{text,section}]` / container / counts  
- 若工具不可用：退化为同页 `JS_SCAN_FORM_FIELDS` 表征级导出（须在结果中注明）

### Playwright MCP pass (2)

- 按 kind 查询可见控件；每个条目尽量带：tag/role、简短 name/label、是否在 `.el-table` / 疑似自定义网格、大致位置  
- **禁止**把壳层导航算进「页面有、应扫」一侧  
- 不要求一次点完所有控件；本刀以**枚举+抽样点击验证 1～2 个漏项是否可操作**为限

### Diff (3)

| Column | Meaning |
|--------|---------|
| label / name | 归一化可见名 |
| kind | taxonomy |
| in_scan | 基线是否出现 |
| in_mcp | MCP 是否可见可编 |
| container_hint | `el-table` / `el-form` / `custom-grid?` / other |
| gap_class | `ok` / `scan_miss` / `mcp_only_shell` / `unclassified` / `no_label` |

**Decision rule (informal):**

- 多数 `scan_miss` 且 `container_hint=custom-grid` → 下一刀 **T5 实现**  
- 多数 `no_label` / `unclassified` → 下一刀偏定位/命名，而非 T5  
- 几乎无 `scan_miss` → T5 降优先级；转向 T1r 或质量项

## Deliverables

1. 本设计文档（方法 + 事后 Results 表）  
2. 可选：原始扫描 JSON / MCP 摘录进 `docs/superpowers/` 或 `tmp/`（不提交密钥）  
3. backlog「推荐下一刀」一句更新（T5 做 / 缓 / 改刀）

## Success criteria

- [x] 单页基线扫描结果可复述（counts + 代表 labels/buttons）  
- [x] MCP 侧有按 taxonomy 的可见可编清单（或明确工具阻塞原因）— browser MCP 替代  
- [x] 差分表至少标出：**有无 scan_miss**、**是否像非 el-table**  
- [x] 书面结论：是否开 T5 实现刀（是/否/需另一页）— **否，需另一页**

## Out of scope follow-ups

| ID | After this knife |
|----|------------------|
| T5 impl | Source B 扩展自定义网格 — **仅当差分支持** |
| T1r | tree / replay label |
| T4-P4 | Playwright MCP a11y 对照（灰度）— 与本刀不同：本刀是漏扫业务差分，不是 a11y 替换主路径 |

## Open before run

- [x] Playwright MCP 已接入本会话，或用户书面同意用 `cursor-ide-browser` 代替 — **本跑使用 cursor-ide-browser**（会话无 Playwright MCP）  
- [x] 确认目标页（默认对公评级）与登录态 — 账号登录后打开 `…/FS00005854HostCstmgrIttCpctRtgAply`，并点击右侧「3. 评级等级测算」

## Results（执行后填写）

页面：对公客户评级申请（已登录）。MCP 工具：`cursor-ide-browser`。

| label / name | kind | in_scan | in_mcp | container_hint | gap_class |
|--------------|------|---------|--------|----------------|-----------|
| 业务编号 / 客户名称 / 评级发生类型 等 ~23 表单项 | input/select/date | yes (Source A) | yes | el-form | ok |
| 测算 / 暂存 / 保存 / 下一步 / 返回 等 | button | yes (buttons) | yes | el-form | ok |
| 5× `.el-table`（征信对象/指标/历史/实控人/股东） | table | Source B=0 rows w/ editors | tables visible | el-table | ok（展示表，无单元格编辑器） |
| vxe-table / ag-grid | custom-grid | n/a | **0 on page** | — | ok（本页无自定义网格） |
| el-icon caret / collapse arrow 等 | icon | no | yes (noisy) | other/el-form | unclassified（装饰/展开箭头，非业务图标钮） |
| 空 name 的 mini `el-select` | select | partial | yes | el-form | no_label |
| 右侧 `plugin-nav`「3. 评级等级测算」 | nav | no（非 α 表单控件） | yes（若未当壳层过滤） | other | ok / 产品定稿壳层-ish |

**Counts:** MCP taxonomy≈67（含嘈杂 icon）；Source A 对齐扫描 fields=23、buttons=14、Source B=0；`el_table=5`、`vxe_table=0`。

**Conclusion:** **Defer T5 实现（自定义网格族）。** 只读/未进修改态时看不到单元格编辑器；**进入 `viewType=modify` 编辑页后**，评级测算表仍是 **`.el-table` + `tssc-multiple-table-content` / `myTable` 包装**，未发现独立 TableNet/vxe/ag 根节点。Source B 对齐枚举可得约 **27** 个单元格控件（select/input/radio，如资产负债率、业务往来及使用）。本页缺口不是「缺 TableNet 扫描器」，而是**要进真实编辑态**；T5 自定义网格仍需另页证据。

### Follow-up look (2026-08-10, user navigated to edit)

| Observation | Value |
|-------------|--------|
| URL flag | `viewType=modify` + bsnPk |
| TableNet / vxe / ag | **0** |
| Wrapper classes | `tssc-multiple-table-content`, `myTable`, `tssc-*` |
| Editable cells (el-table) | table#2 ≈ 指标名称/指标值 rows; Source B-like count ≈ 27 |
| Implication | Keep Source B on `.el-table`; do not invent TableNet selector without a real non-el-table root |
