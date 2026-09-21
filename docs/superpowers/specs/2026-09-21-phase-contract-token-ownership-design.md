# 阶段合约令牌归属设计（实际逻辑流程·开发备注）

> **状态**：已落地（`be21aafd`，合并 `5639541c`）。
> **用途**：为后续同类开发留档——把「开弹窗/纯填写/跨阶段」三类录制越界问题的实际判定流程与必须遵循的规则写清楚，避免再次把「后续阶段的终态令牌」签给当前阶段。
> **关联 pin**：`scripts/characterization/characterize-cross-phase-token-guard.py`、`scripts/characterization/cold/characterize-phase-boundary.py`、`scripts/characterization/cold/characterize-phase-intent.py`、`scripts/characterization/characterize-phase-reviewer.py`。
> **关联 prompt**：`src/services/trajectory/trajectory-meta-service.js`（阶段拆分规则 3.2 / 3.3、示例 7 / 8）、`scripts/prompts/phase-reviewer-prompt.md`（规则 6 / 8 / 9）。

---

## 0. 背景与一句话结论

- **现象**：多阶段录制时出现「P4 吃掉 P5、P6 吃掉 P7」——本阶段的 agent 把下一阶段的保存/确认动作提前执行，导致后续阶段零动作，整轨 `quality_failed` / 录制中断。
- **根因**：阶段开始时一次性签出的合约，向**本阶段流程产不出令牌**的阶段索要了终态令牌（保存 / 确认 / 选择器关闭）。`done` 被门禁拒绝后，recovery 处方又把 agent 推向「补点保存/确认」，于是越过阶段边界。
- **修法（方案 C）**：合约编译按「**终态动作实际发生在哪个阶段**」分配令牌——
  1. 仅打开选择器/弹窗/页面的阶段 → `navigate`，令牌 = 窗口/页面打开；
  2. 纯填写/选择阶段（保存动作在后续阶段）→ `maintain`（仍全量采集可写元素），但**不索要保存令牌**；
  3. 保存/确认动作真正所在的阶段才持有终态令牌；
  4. 跨阶段归属兜底：当后续阶段持有终态动作时，当前阶段自动丢弃终态令牌要求。
- **不改**：阶段拆分主体（meta-service 规则 1–10、3.1）、门禁 `phase_done_ok` 语义、既有仲裁/熔断逻辑。

---

## 1. 实际逻辑流程（编译期，单阶段视角）

```
meta-service 拆分产出阶段文本 description
  │
  ├─ classification_task_text(desc)          # 剥掉尾部【业务数据】块，分类不看业务数据
  │
  ├─ classify_task_mode(t)                   # login / query / other / form_modify / form_fill
  │
  ├─ compile_boundary(t, all_phases, current_phase_number)   # 规则编译器（canonical shape）
  │    分支优先级（命中即止，见 §4）：
  │      login > introduce > query > open-only(navigate)
  │            > form_fill / form_modify(maintain) > wizard-nav > other
  │
  ├─ boundary_to_legacy_intent(boundary)     # role → legacy intent 形状
  │      maintain → mode=create/modify, refill=all_editable, submit 视 save terminal
  │      introduce → mode=introduce_pick, submit.required=true
  │      query/navigate/other → submit.required=false
  │
  ├─ apply_phase_contract(store, contract, boundary_override=…, all_phases, current_phase_number)
  │     ├─ 写入 _phase_boundary（门禁唯一读取源）+ _phase_intent（recovery / prompt 装配源）
  │     └─ _apply_cross_phase_token_guard(...)     # L1c：按全阶段目录修正令牌归属
  │
  ├─ done 门禁 phase_done_ok 只读 _phase_boundary.success_when
  │
  └─ recovery（intent_gates.recovery_prescription_message）
        仅当 submit.required=true 才推荐 click_save；纯填写/导航阶段推荐 done(success=true)
```

要点：
- `_phase_boundary` 与 `_phase_intent` 是**同一次编译**的两个投影，二者必须一致；`done` 门禁只认 `_phase_boundary`。
- 门禁被拒**不会**重跑 classify；因此编译期一旦签错令牌，后续每次 done 都在放大同一错误（见 `2026-09-18-phase-contract-conflict-survey.md` §1）。
- `all_phases` / `current_phase_number` 是跨阶段归属的输入；调用方必须透传，否则退化为「单阶段视角」（仅在文本自身能判定时才安全）。

---

## 2. 三条核心规则（后续开发必须遵守）

### R1 — 仅打开选择器/弹窗/页面 → `navigate`
- 判据：预期结果是「打开/进入/弹出 … 页面/界面/弹窗/对话框/向导页/**窗口/选择窗/选择框**」，且**动作子句没有终态动作**（选中/确定/保存/回填）。
- 令牌：`['url_change', 'page_opened']`（any-of）。
- **禁止**把这种阶段判成 `introduce_pick` 并索要 `picker_closed` / `confirm_click`。
- 反例保护：`点击保存。预期结果：保存成功并进入列表页` 不是 open-only（`_OPEN_PAGE_EXCLUDE_RE` 命中 保存/提交），仍走 click_save。

### R2 — 纯填写/选择（保存动作在后续阶段）→ `maintain` 但不索要保存令牌
- 判据：`task_mode ∈ {form_fill, form_modify}` 且 `_has_save_terminal(t) == false`。
- 行为：`role=maintain`、`refill=all_editable`（保留采集可写元素的能力），但 `success_when=[]`、`submit.required=false`。
- **禁止**无条件给 maintain 阶段附加 `toast_ok` / `url_change` 保存令牌。

### R3 — 终态令牌归「执行终态动作的阶段」
- 判据（`_apply_cross_phase_token_guard`，L1c）：
  - `mode == 'introduce_pick'` 且本阶段无引入终态、后续阶段有 → 降级 `navigate` / 无令牌；
  - `mode ∈ {create, modify}` 且本阶段无保存终态、后续阶段有 → 丢弃 `submit` 要求与 `success.kinds`（`role` 仍 `maintain`、`refill` 仍 `all_editable`）。
- 前提：调用点传入了 `all_phases` + `current_phase_number`。

---

## 3. 关键判定函数与语义（改动前先读）

| 函数 / 正则 | 位置 | 扫描范围 | 语义 |
|---|---|---|---|
| `is_open_page_task` | `classify.py:194` | 全文（含预期结果） | 预期结果只是打开页面/弹窗/窗口；`保存/提交` 排除 |
| `_OPEN_PAGE_EXPECT_RE` / `_OPEN_PAGE_ACTION_RE` | `classify.py:49/59` | — | 2026-09-21 补 `窗口/选择窗/选择框`，否则「打开客户选择窗口」不被识别为开页 |
| `_is_open_only_dialog_or_page` | `boundary_contract.py:125` | 动作子句 + 后续阶段 | 动作子句无终态动作，且（有 catalog 时）后续阶段含终态动作 |
| `_is_introduce_primary` | `boundary_contract.py:178` | — | 纯开窗阶段**不判** introduce；须本阶段有选/确定/回填 |
| `_has_terminal_action` | `boundary_contract.py:72` | **动作子句** | 终态动作（选中/确定/保存…）是否在本阶段动作里 |
| `_has_introduce_terminal` | `boundary_contract.py:77` | **动作子句** | 引入/选人终态动作是否在本阶段动作里 |
| `_has_save_terminal` | `boundary_contract.py:82` | **全文（动作子句 + 预期结果）** | 「修改 X。预期结果：保存成功」也算本阶段有保存终态 |
| `_terminal_action_in_later_phase` | `boundary_contract.py:87` | 全阶段目录 | 后续阶段是否承接本阶段主题（引入/保存）的终态动作 |
| `_apply_cross_phase_token_guard` | `intent_contract.py:328` | contract + boundary + catalog | R3 的落点，直接原地改写 contract/boundary |

> **易踩坑**：`_has_save_terminal` 必须扫全文——若只看动作子句，「修改客户名称。预期结果：保存成功」会丢掉保存令牌（`characterize-phase-reviewer.py:239` 钉死此行为）。反过来，`_has_introduce_terminal` / `_has_terminal_action` 只看动作子句，避免预期结果里的名词性描述误判为终态动作。

---

## 4. 分支优先级与令牌对照表（`compile_boundary`）

| 优先级 | 命中条件 | `role` | `mode` | `refill` | `submit.required` | `success_when` |
|---|---|---|---|---|---|---|
| 1 | `is_login_task` | `other` | `login` | `none` | `false` | `[]` |
| 2 | `_is_introduce_primary` | `introduce` | `introduce_pick` | `none` | `true` | `picker_closed/dialog_confirmed/introduced_backfilled` |
| 3 | `is_query_task` | `query` | `query` | `none` | `false` | `query_clicked` |
| 4 | `_is_open_only_dialog_or_page` | `navigate` | `navigate` | `none` | `false` | `url_change/page_opened` |
| 5 | `task_mode == form_fill` 且 `has_save_terminal` | `maintain` | `create` | `all_editable` | `true` | `toast_ok/url_change/saved_navigation` |
| 5′ | `task_mode == form_fill` 且**无** save terminal | `maintain` | `create` | `all_editable` | `false` | `[]` |
| 6 | `task_mode == form_modify` 且 `has_save_terminal` | `maintain` | `modify` | `all_editable` | `true` | `toast_ok/url_change/saved_navigation` |
| 6′ | `task_mode == form_modify` 且**无** save terminal | `maintain` | `modify` | `all_editable` | `false` | `[]` |
| 7 | `is_wizard_nav_task` | `navigate` | `navigate` | `none` | `false` | `nav_next_clicked/url_change/page_opened` |
| 8 | 其余 | `other` | `other` | `none` | `false` | `[]` |

混合场景（引入 + 保存同阶段，`_requires_introduce_then_save`）：`success_when` 同时含引入终态与保存终态，须两项证据齐备。

---

## 5. 后续同类开发 Checklist

- [ ] **先问「终态动作发生在哪个阶段」**，再决定令牌归谁；不要按阶段文本里的名词想当然。
- [ ] 新增/修改分类分支时，保持 §4 的优先级与令牌对照一致；**不要 blanket navigate**（只有真开窗才降级），**不要无条件保存令牌**（只有本阶段真保存才要）。
- [ ] 改 `classify.py` / `boundary_contract.py` / `intent_contract.py` 后，必须复跑：
  - `python scripts/characterization/cold/characterize-phase-boundary.py`
  - `python scripts/characterization/cold/characterize-phase-intent.py`
  - `python scripts/characterization/characterize-cross-phase-token-guard.py`
  - `python scripts/characterization/characterize-phase-reviewer.py`
- [ ] 新增调用 `compile_boundary` / `apply_phase_contract` 的调用点，必须透传 `all_phases` + `current_phase_number`（否则跨阶段归属失效）。
- [ ] 改 prompt 的拆分规则 / reviewer 规则时，保持与引擎判据一致（open-only → navigate；fill-only → 无保存令牌）。
- [ ] 新增 pin 必须登记进 `scripts/refactor/verify-all.sh` 的域注册表（跨域 pin 可登记多域，拿不准进 core/phase）。
- [ ] `done` 门禁只读 `_phase_boundary`；若发现「合约对了但门禁还索要旧令牌」，检查 `apply_phase_contract` 是否同笔更新了 `boundary.success_when`。

---

## 6. 改动落点（供定位）

| 文件 | 职责 |
|---|---|
| `scripts/controller/actions/phase/classify.py` | 开页识别（含 窗口/选择窗/选择框）、task_mode 四分类 |
| `scripts/controller/actions/phase/boundary_contract.py` | `compile_boundary` 分支与令牌、`_has_*_terminal` 判定、`boundary_to_legacy_intent` |
| `scripts/controller/actions/phase/intent_contract.py` | 规则回退编译器 `compile_phase_intent`、`apply_phase_contract` 写点、`_apply_cross_phase_token_guard` |
| `scripts/controller/actions/phase/intent_gates.py` | recovery 处方：仅 `submit.required` 时推荐 click_save |
| `scripts/agent/service.py` | prepare / replay 路径透传 `all_phases` + `current_phase_number` |
| `src/services/trajectory/trajectory-meta-service.js` | 阶段拆分规则 3.2/3.3 + 示例 7/8（open-picker-only / fill-only） |
| `scripts/prompts/phase-reviewer-prompt.md` | reviewer 规则 6/8/9（open-only → navigate；fill-only → 无保存令牌） |

---

## 7. 边界与非目标

- **未做**：方案 D（把 `mode/success_when/submit_required` 结构随阶段持久化到 DB，runtime 分类退化为 fallback）——见 `docs/superpowers/todo-list.md` 的 `phase-structured-contract` 行。
- **正交**：ZCode 引擎线的 `verify-phase-token`（核验型阶段门侧豁免，`verification_gate.py`）处理的是「核验型阶段无保存动作」的另一条腿；本文的跨阶段归属处理「终态动作在别的阶段」。两修不冲突。
- **不动**：阶段拆分主体规则（1–10 / 3.1）、门禁 `phase_done_ok` 的 pass/fail 语义、既有 LLM/规则仲裁与熔断。
