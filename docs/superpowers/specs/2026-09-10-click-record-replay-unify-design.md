# Design: `click_element_by_index` / `click_button` 录制/回放统一（直接 Phase B）

**日期**：2026-09-10  
**状态**：设计获批（用户选 **A 范围** = index+button；**B 深度** = 跳过 `click_dispatch`，经 `ClickEngine`）— 计划待 writing-plans  
**前置**：[`2026-09-09-radio-record-replay-unify-design.md`](./2026-09-09-radio-record-replay-unify-design.md)、[`2026-09-09-fill-record-replay-unify-design.md`](./2026-09-09-fill-record-replay-unify-design.md)  
**契约**：[`2026-09-05-engine-actions-contract.md`](./2026-09-05-engine-actions-contract.md) §2.2–2.3  
**用户裁决**：产品回放写动作/主点击经引擎 `mode=replay`；本轮只交付 **index + button**；menu/close 等另开。

---

## 1. 问题

### 1.1 表象

| 路径 | `click_element_by_index` | `click_button` |
|---|---|---|
| 录制 / Agent | `_misc.py`：enrich、护栏、Playwright `_click_element_node`、树/el-select 改道 | `_misc.py`：container 内联 JS / `JS_CLICK_ICON_BUTTON` + aria stamp |
| 产品回放 | `_replay_click_by_index` → `page.evaluate(_JS_CLICK_DURABLE)` + Playwright text fallback；**忽略 ephemeral index** | 多经 close 组映射 text 后同样走 `_replay_click_by_index` / durable |

两端意图同为「稳定点控件」，但 **Python 编排双线**；回放已收敛到 `replay_click.py`，录制仍散落。战略目标（回放只供参/注解/批调度）要求这两步的 **evaluate 出口进引擎**。

### 1.2 目标 / 非目标

**In**

1. 新增 `ClickEngine`（名可微调）：`click_element_by_index` / `click_button` 支持 `mode='record'|'replay'`，及 `*_for_replay(page, …)`（复用 `_ReplayPageAdapter` 模式或 page-only 构造）。
2. 回放主路径：这两动作经引擎；**禁止** `_replay.py` 主分支直接 `page.evaluate(_JS_CLICK_DURABLE)` / 直调 `_replay_click_by_index` 作为唯一出口（可把现有逻辑 **搬进引擎内部**）。
3. Replay：关 `_record_action`；纯字符串；保留 ephemeral-index 语义（定位靠 xpath_smart/text，不用 highlight index）。
4. Record：默认保留现有行为（index 可用 node click；button 可用 container/icon JS）；不借本轮强行把录制改成 durable-only。
5. cold pin + 契约 §2.2–2.3 注明经 `ClickEngine`。

**Out**

- **不做**独立 `click_dispatch` Phase A（用户选 B）。
- **不做**：`click_menu_item`、`close_dialog`、`switch_tab`、`click_adjacent_button`、`click_table_row_button`、`click_menu_xpath`（仍可暂时调用旧 `_replay_click_by_index`；下一 design 再迁）。
- 不改 search-then-click 录制护栏；不改 `click_table_row_radio`。
- 不强制本轮让回放 `click_button` 复制录制 container-first 阶梯（登记为后续；本轮 replay = durable 权威）。

---

## 2. 目标架构

```
                 ┌──────────────────────────────────┐
                 │  ClickEngine（本轮两动作 evaluate） │
                 │  replay: _JS_CLICK_DURABLE (+ PW)  │
                 │  record: 现有 misc 路径（可委托）   │
                 └────────────────┬─────────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                   ▼
         mode=record         mode=replay         (menu/close 暂留 _replay)
         stamp/护栏开         无 stamp；纯字符串
```

对齐 radio：

| radio | click（本 spec） |
|---|---|
| `RadioEngine` + `mode=replay` | `ClickEngine` + `mode=replay` |
| `click_radio_for_replay` | `click_element_by_index_for_replay` / `click_button_for_replay` |
| 回放禁直接 `JS_CLICK_RADIO*` | 回放禁直接 `_JS_CLICK_DURABLE`（主路径） |
| 跳过 dispatch | 跳过 `click_dispatch` |

---

## 3. Phase B — 回放复用 ClickEngine

### 3.1 交付物

| 项 | 说明 |
|---|---|
| 引擎模块 | 优先 `scripts/controller/actions/click_action_engine.py`（或并入合适现有文件；避免继续膨胀 `_misc.py`） |
| 入口 | `click_element_by_index(..., mode=…)` / `click_button(..., mode=…)` + classmethod `*_for_replay` |
| 回放接线 | `_replay.py`：独立 `click_element_by_index` 分支 → 引擎；`click_button` 若仍走 close 组，则组内对该动作改调引擎（close 幂等探测仍属 close，本轮不动） |
| 内部复用 | 可将 `_replay_click_by_index` / `_JS_CLICK_DURABLE` **迁入或委托**引擎，避免第三份副本 |
| `_form` / controller | Agent 注册仍调引擎 `mode=record`（从 `_misc` 薄委托） |

### 3.2 副作用参数化

| 副作用 | record | replay |
|---|---|---|
| `_record_action` / enrich stamp | 开 | **关** |
| search-then-click / el-select / tree 改道护栏 | 开 | **开**（有等价则保留；无则文档说明回放不改道） |
| Playwright node click vs durable JS | record 可 node | **replay 只用 durable（+ 现有 PW text fallback）** |
| 结果 envelope | `_ok` 可 | 纯字符串 |

### 3.3 验收

- cold pin：`_replay.py`（或抽出的 replay 接线文件）对 `click_element_by_index` / `click_button` 调用 `*_for_replay` / `mode=replay`；主路径无裸 `_JS_CLICK_DURABLE` evaluate。
- 既有 close-dialog / click 相关 characterization 不无故失败；必要时更新 needles。
- 可选湿测：图标按钮、带 xpath_smart 的列表行点击。

### 3.4 风险与回滚

| 风险 | 缓解 |
|---|---|
| close 组仍 import 旧 `_replay_click_by_index` | 引擎内保留函数；close 组未迁前继续调引擎或内部 helper，避免双实现漂移 |
| button 录/放阶梯差 | 本轮接受；路线图登记「button attempt order」 |
| index 录制 node vs 回放 JS | mode 分支钉死；pin 分 mode |

回滚：短时恢复 `_replay` 直调 `_replay_click_by_index`（不推荐长期）。

---

## 4. 契约与协作约定

1. **本轮两动作**：执行以 `ClickEngine` 为单源；禁止只改引擎或只改 `_replay.py`。
2. 更新 `engine-actions-contract` §2.2（`click_button`）与 §2.3（`click_element_by_index`）。
3. `AGENTS.md` 一句指针；fill/radio §8 路线图：index+button → **now/done**，menu/close → **then**。

---

## 5. 实施顺序

1. Spec 审阅通过 → writing-plans → `docs/superpowers/plans/2026-09-10-click-record-replay-unify.md`
2. Red pin → `ClickEngine` → 接线 `_replay` / `_misc` 薄委托 → 契约 + verify-all
3. 收工：agent-log + design 状态 landed

---

## 6. 成功标准

| ID | 标准 |
|---|---|
| C1 | 回放 `click_element_by_index` / `click_button` 的 durable evaluate 仅由 `ClickEngine` 发出 |
| C2 | ephemeral index 语义不回退（仍靠 xpath/text） |
| C3 | record 默认路径行为不无故回归；cold pin 挡住漏改 |
| C4 | menu/close 等 Out 动作本轮不强制经引擎 |

---

## 7. 路线图（本 spec 不实现）

```
done:  select / fill / click_radio（表单写动作）
now:   click_element_by_index + click_button（本文）
then:  click_menu_item / close_dialog / switch_tab / adjacent / table-row-button
later: button container-first 回放对齐；login/autofill 直调收敛
```

---

## 8. 开放问题（默认）

| # | 问题 | 默认 |
|---|---|---|
| O1 | 引擎文件位置 | **`click_action_engine.py`**（新文件）；`_misc` 薄委托 |
| O2 | `click_button` 是否仍经 `_replay_close_dialog_idempotent` 外壳 | **是**（只换内核为引擎）；close 幂等逻辑不动 |
| O3 | 录制 index 是否改 durable | **否**（本轮） |

---

## 9. 自检

- [x] 与 radio Phase B 同形，无矛盾
- [x] 范围 A（仅 index+button）与深度 B（无 dispatch）明确
- [x] menu/close Out + 路线图
- [x] 开放问题已给默认
- [x] 无 TBD
