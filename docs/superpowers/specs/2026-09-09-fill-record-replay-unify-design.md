# Design: `fill_form_field` 录制/回放统一（A→B）

**日期**：2026-09-09  
**状态**：A+B 已落地（`fill_dispatch` + 回放经 `FillEngine.fill_form_field_for_replay`）— 计划 [`../plans/2026-09-09-fill-record-replay-unify.md`](../plans/2026-09-09-fill-record-replay-unify.md)  
**前置**：[`2026-09-09-select-record-replay-unify-design.md`](./2026-09-09-select-record-replay-unify-design.md)（select 已 A+B 落地，为本 spec 样板）  
**契约**：[`2026-09-05-engine-actions-contract.md`](./2026-09-05-engine-actions-contract.md) §2.4  
**用户裁决**：fill 采用与 select **同形的 A→B**；战略目标为「录制与回放写动作经引擎管线」——本 spec **只交付 fill**；点击族另开。

---

## 1. 问题

### 1.1 表象

| 路径 | 行为 |
|---|---|
| 录制 / Agent | `FillEngine.fill_form_field`：scan、`_resolve_control`、tssc/tree **拒绝直填**、Z2/Z4 守卫、`JS_FILL_BY_XPATH` / `JS_FILL_FORM_FIELD`、`_record_action` |
| 产品回放 | `_replay_form_action` 的 `fill_form_field` 分支：自建 xpath→label→placeholder→xpath_full 阶梯，直接 `page.evaluate(JS_FILL_*)`，再 `_classify_fill_result` / `locate=` |

两端复用 **JS 常量**，但 **Python 编排双线**。select 在 D6 后已用事实证明：只改引擎、不改回放 →「录得过、放不过」。fill 目前未爆出同等事故，但结构同构，属于可预期债务。

### 1.2 战略对齐

用户确认：以后录制与回放的 actions **都应走引擎管线**。select 已完成；本 spec 为下一动作族（fill）。点击族、radio 等见 §8 路线图，不在本交付内实现。

### 1.3 目标 / 非目标

**In**

1. Phase A：共享 fill **locate / JS 选用策略**（薄模块），`FillEngine` 与 replay fill 分支都必须经此，消除第三份阶梯副本。
2. Phase B：回放经 `FillEngine`（`mode=replay` 或 `fill_form_field_for_replay(page, …)`），主路径禁止直接 `evaluate(JS_FILL_*)`。
3. cold pin + 契约条款（与 select_dispatch 并列）。
4. 保留引擎侧：tssc/tree 禁止 `fill_form_field` 直填；回放 false_ok / 空 actual 兜底语义不丢。

**Out**

- 不实现点击族 / `click_element_by_index` 统一（§8 仅路线图）。
- 不强制本轮改 `login` 内部对 `JS_FILL_FORM_FIELD` 的直调（可登记为后续）。
- 不改变产品「录制 value 权威、回放回读校验」语义。
- 不重写 autofill `_execute_round` 的填值规划（仍调 FillEngine 即可）。

---

## 2. 目标架构

```
                 ┌──────────────────────────────────┐
                 │  fill 策略层（Phase A）             │
                 │  locate 阶梯 + 选用 JS_FILL_*       │
                 └────────────────┬─────────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                   ▼
         path=xpath          path=label         path=placeholder
         JS_FILL_BY_XPATH    JS_FILL_FORM_FIELD  JS_FILL_* (+ hint)
              ▲                   ▲                   ▲
   Phase A: 两端经策略层决定 path，仍可各自 evaluate
   Phase B: 仅 FillEngine（replay mode）evaluate；回放只供参/注解
```

对齐 select：

| select | fill（本 spec） |
|---|---|
| `select_dispatch.resolve_select_dispatch` | `fill_dispatch`（或等价名）策略 / path 枚举 |
| `SelectEngine` + `mode=replay` | `FillEngine` + `mode=replay` |
| `select_option_for_replay(page, …)` | `fill_form_field_for_replay(page, …)` |
| 回放禁直接 `JS_SELECT_*` / `JS_TSSC_*` | 回放禁直接 `JS_FILL_*` |

---

## 3. Phase A — 共享 fill 策略

### 3.1 交付物

| 项 | 说明 |
|---|---|
| 新模块 | `scripts/controller/actions/fill_dispatch.py`（名可微调；职责：locate 阶梯 + path 枚举，**不**返回巨型 JS 字符串拼装亦可，但须单源） |
| API（示意） | `resolve_fill_attempt_order(entry, params, *, use_relative) -> list[FillAttempt]` 或逐步 `resolve_next_fill_path(...)`；`FillAttempt.path ∈ {xpath, label, placeholder}` + xpath/hint 载荷 |
| 接线-引擎 | `FillEngine.fill_form_field` 在选用 `JS_FILL_BY_XPATH` vs label 填时走同一优先级（与回放一致） |
| 接线-回放 | `_replay_form_action` fill 分支删除内联阶梯副本，改调策略层后再 `evaluate` |
| 语义钉死 | 与现回放一致：`element.xpath_smart` → label `JS_FILL_FORM_FIELD` → placeholder → `xpath_full`；`params.xpath_smart` **仍忽略**（历史脏参） |
| 文档 | `engine-actions-contract` §2.4 `fill_form_field` 行注明经 fill_dispatch |

### 3.2 回放外壳（A 阶段保留）

- `locate=` 注解、`_classify_fill_result`、`_read_value_by_xpath` / label 空 actual 兜底（若未并入策略层，须在 pin 中声明「仍在 replay」并在 B 搬迁）。
- 批调度、`stop_on_fail` 仍在 `_replay.py`。

### 3.3 Phase A 验收

- cold pin：engines + replay 均引用 `fill_dispatch`（或约定符号）。
- 回放 fill 分支不再含完整内联阶梯副本（策略调用可识别）。
- 既有 fill / xpath-fill characterization GREEN。
- 可选湿测：已知易错 placeholder 共 xpath 轨迹（如 traj 130 类）。

### 3.4 Phase A 非目标

- 不引入 `FillEngine.mode=replay`（留给 B）。
- 不删除回放对 `JS_FILL_*` 的直接 evaluate。

---

## 4. Phase B — 回放复用 FillEngine

### 4.1 交付物

| 项 | 说明 |
|---|---|
| 引擎入口 | `fill_form_field(..., mode='record'\|'replay', element=…)` 和/或 `FillEngine.fill_form_field_for_replay(page, …)`（复用 select 的 page adapter 模式） |
| 回放主路径 | fill → 解析 entry/params → 调引擎 replay 入口 → 注解 `locate=` |
| 禁止 | 回放主路径直接 `page.evaluate(JS_FILL_FORM_FIELD\|JS_FILL_BY_XPATH)`（除引擎内部） |
| 策略层 | A 的 fill_dispatch **保留**；由引擎内部调用，回放不再旁路 |

### 4.2 副作用参数化

| 副作用 | record | replay |
|---|---|---|
| `_record_action` / stamp | 开 | **关** |
| `_task_done_impl` | 开 | **关** |
| `_ensure_scanned` | 全量 | **弱**（与 select `_maybe_ensure_scanned` 同形） |
| tssc/tree 拒绝直填 | 开 | **开**（回放误录 fill 打 tssc 字段时应失败而非静默填） |
| Z2/Z4 等 fill 守卫 | 开 | **开**（除非有证据证明回放必须旁路——默认不开旁路） |
| `err_with` envelope | 可 | 映射为纯 result 字符串 |

### 4.3 Phase B 验收

- cold pin：replay fill 分支调用 `FillEngine` / `fill_form_field_for_replay`；主路径无直接 `JS_FILL_*` evaluate。
- `characterize-select-*` 不受损；fill 相关 pin GREEN。
- 湿测：普通输入、日期类（若走同一 fill）、placeholder-only 搜索框；以及「录成 fill 的 tssc 字段」应拒绝或明确失败码。

### 4.4 风险与回滚

- 风险：locate 阶梯搬进引擎后与历史 traj 细差。缓解：A 先钉策略；B feature-flag 可回退「策略 + 回放自 evaluate」。
- 回滚：保留 fill_dispatch；关掉 replay→engine 开关即可。

---

## 5. 契约与协作约定

1. **表单写动作**（fill / select / tree / radio / save…）：执行与分流以 Engine（+ 可选 `*_dispatch`）为单源；禁止只改引擎或只改 `replay_form_action`。
2. **新 handoff**：引擎实现 + 回放经引擎 + cold pin（同 select unify §5）。
3. 更新 `engine-actions-contract` §2.4 `fill_form_field`；AGENTS 一句指向本文（或与 select unify 合并为「录放经引擎」总链）。
4. docstring「same JS path as `_execute_round`」不得再暗示「同一 Python 编排」——以本文 + select unify 为准。

---

## 6. 实施顺序

1. Spec 审阅通过 → writing-plans → `docs/superpowers/plans/2026-09-09-fill-record-replay-unify.md`
2. Phase A 实现 + pin → commit
3. Phase B 另任务单元；A pin 升级为「经 Engine」

---

## 7. 成功标准

| ID | 标准 |
|---|---|
| F1 | fill 策略变更一处，双端同时生效；漏改被 cold pin 挡住 |
| F2 | Phase B 后回放 fill 的 JS 由 FillEngine 发出 |
| F3 | tssc/tree 拒绝直填在 replay mode 仍生效 |
| F4 | 既有 fill / xpath-fill / select 表征不无故失败 |

---

## 8. 路线图（本 spec 不实现）

```
done:  select_option / tssc / tree（select unify A+B）
done:  fill_form_field（本文）
next:  click_radio（表单四件套收尾）— 见 [`2026-09-09-radio-record-replay-unify-design.md`](./2026-09-09-radio-record-replay-unify-design.md)
then:  click_element_by_index / click_button / menu / close 组（点击族；特例多，单独 design）
later: login 内嵌 fill 直调收敛（可选）
```

---

## 9. 开放问题（默认）

| # | 问题 | 默认 |
|---|---|---|
| O1 | 模块名 `fill_dispatch` vs `fill_replay_strategy` | **`fill_dispatch.py`**（与 select_dispatch 对称） |
| O2 | false_ok 空 actual 兜底放策略层还是仅引擎 | A 可留 replay；**B 必须进引擎 replay 路径** |
| O3 | login 内 fill | **本轮不动** |

---

## 10. 自检

- [x] 与 select unify 同形，无矛盾
- [x] A/B 边界清晰，可单独合并 A
- [x] 点击族明确 Out + 路线图
- [x] 开放问题已给默认
