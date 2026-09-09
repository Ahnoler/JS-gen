# Design: `click_radio` 录制/回放统一（直接 Phase B）

**日期**：2026-09-09  
**状态**：已落地（RadioEngine mode=replay）— 计划 [`../plans/2026-09-09-radio-record-replay-unify.md`](../plans/2026-09-09-radio-record-replay-unify.md)  
**前置**：[`2026-09-09-select-record-replay-unify-design.md`](./2026-09-09-select-record-replay-unify-design.md)、[`2026-09-09-fill-record-replay-unify-design.md`](./2026-09-09-fill-record-replay-unify-design.md)（A+B 已落地，为本 spec 样板）  
**契约**：[`2026-09-05-engine-actions-contract.md`](./2026-09-05-engine-actions-contract.md) §2.4  
**用户裁决**：表单写动作经引擎管线；`click_radio` **不做**独立 `radio_dispatch`，直接 Phase B。

---

## 1. 问题

### 1.1 表象

| 路径 | 行为 |
|---|---|
| 录制 / Agent | `RadioEngine.click_radio`：scan、`_resolve_control`、`JS_CLICK_RADIO_BY_XPATH`、`_record_action` / `_task_done`、absent skip |
| 产品回放 | `_replay_form_action` 的 `click_radio` 分支：`_with_xpath_first` 包裹后直接 `page.evaluate(JS_CLICK_RADIO, [label, value])`（**label 版 JS**，与录制 xpath 版不同） |

两端复用「点 radio」意图，但 **两套 JS 常量 + Python 编排双线**。select/fill 已证明：只改引擎不改回放 →「录得过、放不过」；radio 结构同构，属可预期债务。本轮收完表单四件套写动作双线。

### 1.2 目标 / 非目标

**In**

1. `RadioEngine` 增加 `mode='record'|'replay'` 与/或 `click_radio_for_replay(page, …)`（复用 `_ReplayPageAdapter` / `_ReplayAutofillStub`）。
2. 引擎吸收 xpath vs label JS：有可用 xpath → `JS_CLICK_RADIO_BY_XPATH`；无 xpath 或 xpath 失败 → 回退 `JS_CLICK_RADIO`（label）。
3. 回放主路径禁止直接 `page.evaluate(JS_CLICK_RADIO*)`（除引擎内部）；只供参 + locate 注解。
4. cold pin + 契约 §2.4 `click_radio` 行注明经 `RadioEngine`。
5. 保留 absent-field skip；replay 关录制副作用。

**Out**

- **不做**独立 `radio_dispatch` Phase A（用户选 B）。
- 不改点击族（`click_element_by_index` / button / menu / close）。
- 不强制本轮改 autofill `_execute_round` 对 `JS_CLICK_RADIO_BY_XPATH` 的直调（登记后续，与 login-fill 同类）。
- 不改 `click_table_row_radio`（表格行 radio，属 §2.3 / replay_table，非表单四件套）。

---

## 2. 目标架构

```
                 ┌──────────────────────────────────┐
                 │  RadioEngine（唯一 evaluate 出口）   │
                 │  xpath → JS_CLICK_RADIO_BY_XPATH    │
                 │  else  → JS_CLICK_RADIO (label)     │
                 └────────────────┬─────────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                   ▼
         record path         replay path         (autofill 直调暂留 Out)
         mode=record         mode=replay
         + stamp/task_done   无 stamp；纯字符串
```

对齐 fill/select Phase B：

| select / fill | radio（本 spec） |
|---|---|
| `SelectEngine` / `FillEngine` + `mode=replay` | `RadioEngine` + `mode=replay` |
| `*_for_replay(page, …)` | `click_radio_for_replay(page, …)` |
| 回放禁直接 `JS_SELECT_*` / `JS_FILL_*` | 回放禁直接 `JS_CLICK_RADIO*` |
| 可选 `*_dispatch` Phase A | **跳过**（无第三份阶梯副本可抽） |

---

## 3. Phase B — 回放复用 RadioEngine

### 3.1 交付物

| 项 | 说明 |
|---|---|
| 引擎入口 | `click_radio(..., mode='record'\|'replay', …)` 和/或 `RadioEngine.click_radio_for_replay(page, label_text, option_text, *, xpath_smart=…)` |
| JS 选用 | **单源在引擎内**：`xpath_smart` 非空 → 先 `JS_CLICK_RADIO_BY_XPATH`；失败或无 xpath → `JS_CLICK_RADIO([label, option])` |
| 回放主路径 | `click_radio` → 解析 entry/params（`option_text` / `value`）→ 调引擎 replay 入口 → 注解 `locate=` |
| 禁止 | `replay_form_action` 主路径直接 `page.evaluate(JS_CLICK_RADIO\|JS_CLICK_RADIO_BY_XPATH)` |
| locate | 可保留 `_with_xpath_first` **仅作 locate 注解**（与 tree 同形：引擎执行，外壳标注 `ok-xpath-smart` / label），或并进引擎；pin 要求仍可区分 xpath_smart / xpath_full / label |

### 3.2 副作用参数化

| 副作用 | record | replay |
|---|---|---|
| `_record_action` / stamp | 开 | **关** |
| `_task_done_impl` | 开 | **关** |
| `_ensure_scanned` | 全量 | **弱**（与 select/fill `_maybe_ensure_scanned` 同形） |
| absent-field skip | 开 | **开**（返回 skip 结果字符串，不抬失败） |
| `err_with` / `_ok` envelope | 可 | 映射为纯 result 字符串（与 fill/select replay 一致） |

### 3.3 验收

- cold pin：`replay_form_action` 的 `click_radio` 分支调用 `click_radio_for_replay` / `RadioEngine` + `mode=replay`；主路径无直接 `JS_CLICK_RADIO*` evaluate。
- 既有 form / select / fill characterization 不受损；新增 `characterize-radio-replay-engine.py`（或等价名）纳入 verify-all。
- 可选湿测：有 xpath 的 radio 组 + 仅 label 的历史步。

### 3.4 风险与回滚

| 风险 | 缓解 |
|---|---|
| 回放原只用 label JS，引擎优先 xpath，行为差 | 钉死「xpath 优先、失败再 label」；cold pin + 湿测对照 |
| `_with_xpath_first` 语义丢失 | pin / 契约要求 locate 注解仍可区分 xpath_smart / full / label |
| autofill 仍直调 xpath JS | Out；路线图 later；不阻塞本交付 |

回滚：feature-flag 或短时恢复 replay 分支直调 `JS_CLICK_RADIO`（不推荐长期保留双线）。

---

## 4. 契约与协作约定

1. **表单写动作**（fill / select / tree / radio）：执行以 Engine 为单源；禁止只改引擎或只改 `replay_form_action`。
2. 更新 `engine-actions-contract` §2.4 `click_radio`：经 `RadioEngine`（`mode=replay` / `click_radio_for_replay`）；xpath→`JS_CLICK_RADIO_BY_XPATH`，否则 label `JS_CLICK_RADIO`。
3. fill unify §8 路线图：`click_radio` 标 **done**（本交付完成后）；下一为点击族。

---

## 5. 实施顺序

1. Spec 审阅通过 → writing-plans → `docs/superpowers/plans/2026-09-09-radio-record-replay-unify.md`
2. Red pin（cold）→ 实现 RadioEngine replay 入口 → 接线 `replay_form_action` → 契约 + verify-all
3. 收工：agent-log + 关闭本 design 状态

---

## 6. 成功标准

| ID | 标准 |
|---|---|
| R1 | 回放 `click_radio` 的 JS 仅由 `RadioEngine` 发出 |
| R2 | xpath / label 选用单源；漏改被 cold pin 挡住 |
| R3 | absent skip 与纯字符串结果在 replay mode 仍正确 |
| R4 | select / fill / radio 表征不无故失败 |

---

## 7. 路线图（本 spec 不实现）

```
done:  select_option / tssc / tree（select unify A+B）
done:  fill_form_field（fill unify A+B）
now:   click_radio（本文；表单四件套收尾）
then:  click_element_by_index / click_button / menu / close 组（点击族；单独 design）
later: autofill 内嵌 radio/fill 直调收敛；login 内嵌 fill（可选）
```

---

## 8. 开放问题（默认）

| # | 问题 | 默认 |
|---|---|---|
| O1 | locate 留在 `_with_xpath_first` 还是引擎内 | **优先保留外壳 `_with_xpath_first`**（与 tree 同形，改动面小）；若实现中证明重复，可并进引擎 |
| O2 | autofill 直调 | **本轮不动** |
| O3 | 是否补 `radio_dispatch` | **否**（用户选 B） |

---

## 9. 自检

- [x] 与 select/fill Phase B 同形，无矛盾
- [x] 明确跳过 Phase A / 无 `radio_dispatch`
- [x] 点击族与 autofill 直调明确 Out + 路线图
- [x] 开放问题已给默认
- [x] 无 TBD / 占位未决项
