# Assistant mission context + Agent final check — Design

**Date:** 2026-08-08  
**Status:** Approved for planning  
**Note:** `docs/` is gitignored in this repo (local-only).  
**Trigger:** Phase「系统评级结论」中 `run_form_assistant` 将「此次评级建议等级」填为 AA，而页内只读「系统评级等级=A」；保存报「超出范围」。根因：助手无任务背景、主 Agent 默认助手正确并直接保存。

**Related:** phase-section-scope；xpath-primary；form assistant `_llm_generate_values` / `form-prompt.md` / `agent-prompt.md`.

## Decisions (locked)


| Topic                  | Choice                                        |
| ---------------------- | --------------------------------------------- |
| Approach               | **甲** — 双 prompt + 助手上下文注入 + `needs_agent` 回告 |
| Main-agent final check | **A** — 纯提示词终检（无代码强制拦 `click_save`）           |
| Assistant context      | **C** — 阶段任务 + 【业务数据】+ 同区只读/已填快照              |
| When unsure            | **B+** — 不写入；列入 `needs_agent` 并说明原因，交主 Agent  |
| Prompt hygiene         | 本次一并清理主 Agent prompt 中与现状冲突的过时条款              |




## Goals

1. Form assistant fills only what it can justify from mission + business data + related field snapshot.
2. Uncertain fields are **skipped** and reported to the main Agent (`needs_agent`).
3. Main Agent treats assistant output as a **draft**: verify against the phase task, fix/fill gaps, then save.
4. Update `agent-prompt.md` so new features (section scope, xpath-primary, unique-save auto section, 业务数据≠案例数据) are consistent — remove outdated “assistant done → click_save immediately” style guidance.



## Non-goals

- Hard gate blocking `click_save` until a structured checklist passes.
- Regex / contract hard-parse of phase NL into field mappings.
- Hardcoded rule “建议等级 := 系统评级等级” (generalize via context + prompts instead).
- Full rewrite of `agent-prompt.md` (surgical conflict cleanup + new contract only).
- Control-plane API / schema changes.



## Roles


| Role                                                           | Responsibility                                                                                               |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Form assistant** (`_llm_generate_values` + `form-prompt.md`) | Batch-fill editable fields in scope using injected mission context; skip + declare `needs_agent` when unsure |
| **Main Agent** (`agent-prompt.md`)                             | Call assistant → read result → final check vs task → handle `needs_agent` → `click_save`                     |
| **Code** (`_form.py`, `_llm_values.py`)                        | Assemble context; parse assistant skip list; surface `needs_agent` on `run_form_assistant` response          |




## Assistant context (§2)

Inject **before** the field list in the HumanMessage to the form LLM:

1. **Current phase task** — phase title/body + expected result (from session / `case_data_store`).
2. **【业务数据】** block when present.
3. **Related snapshot** — for the active `section` filter (or whole form if unscoped): readonly/disabled and already-filled fields as `label → currentValue` (e.g. `系统评级等级=A`), so alignment judgments are possible.

Also change default `instruction` away from bare「生成合理的测试数据」toward「按任务背景填写；不确定则跳过并申报」.

### Assistant behavior (`form-prompt.md`)

- If task / business data / snapshot supports a value → fill (option text must stay verbatim from `options`).
- If **cannot** judge → **do not write**; add `{ "label", "reason" }` to `needs_agent`.
- Do **not** pick a “plausible” option (e.g. AA) when the mission implies aligning to another field and that value is available in the snapshot.
- `commandValue` / `match_rule` paths remain for clear rule/user presets; they must not override explicit mission constraints when those are present in context.



### Response shape

`run_form_assistant` JSON gains:

```json
{
  "needs_agent": [
    { "label": "此次评级建议等级", "reason": "需按系统评级等级对齐，助手未在可编辑列表中代填" }
  ]
}
```

(Exact reason strings are free-form from the model or code; characterization asserts presence/shape.)

Skipped labels remain in `task_list.pending` (or equivalent) so the main Agent still sees them as unfinished.

## Main Agent final check (§3)

**Workflow** (when `allow_form_assistant=true`):

1. `run_form_assistant(section=…)` (section when phase names a block).
2. Read return: status, `needs_agent[]`, sections summary.
3. **Final check (prompt-only):**
  - Task-named relationships (e.g. 建议等级 vs 系统评级等级) satisfied?
  - 【业务数据】named fields correct?
  - For each `needs_agent` entry: explicit `select_option` / `fill_form_field` / `click_radio`.
  - Optional `check_field_value` when unsure of DOM state.
4. `click_save(..., section=…)` (honor `NEXT_ACTION` / unique-save auto section).
5. `ok-save-*` → `done`.

**Mindset in prompt:** Assistant = batch draft; **not trusted by default**; Agent owns mission compliance.

No new code gate on `click_save` for this checklist.

## Prompt hygiene (main Agent)

While adding the final-check contract, scan and fix conflicting / outdated lines, including at least:

- 「`run_form_assistant` 完成后（pending≈0）：直接调用 `click_save()`」→ replace with final-check-then-save.
- Residual examples implying bare `click_save()` whenever `ambiguous_buttons` is empty (conflict with section / `NEXT_ACTION`).
- Duplicate or stale wording vs xpath-primary, `section=`, unique-save auto section, 业务数据 vs 案例数据 — merge or delete, do not leave contradictions.

Keep useful long-standing rules (save-only via `click_save`, no `input_text` for el-form, etc.).

## Data flow

```
case_data_store (phase task, 业务数据, _scan_fields, section filter)
        │
        ▼
_llm_generate_values HumanMessage: 任务 + 业务 + 只读快照 + 待填字段
        │
        ▼
form LLM → actions (certain only) + needs_agent[]
        │
        ├── execute fills for actions
        └── run_form_assistant return JSON includes needs_agent
                │
                ▼
Main Agent (agent-prompt): 终检 → 补填 → click_save
```



## Error handling

- Prefer preventing bad values before save via assistant skip + Agent check.
- Existing `err-save-validation` / `err-save-notification` paths unchanged; Agent still repairs from toasts after failed save.
- If assistant wrongly fills despite prompt, Agent final check is the backstop (no code interceptor in this design).



## Testing

Characterization / prompt markers:

1. Form LLM call / prompt assembly includes phase task text and readonly snapshot labels when available.
2. Uncertain field path produces `needs_agent` and does **not** record an auto-fill for that label (unit-level where possible).
3. `agent-prompt.md` contains final-check language and **does not** contain the obsolete “assistant complete → direct click_save” CRITICAL line.
4. Existing section-scope / form-assistant characterizations still green.



## File map


| File                              | Change                                                            |
| --------------------------------- | ----------------------------------------------------------------- |
| `scripts/prompts/form-prompt.md`  | Mission-first; skip when unsure; `needs_agent`                    |
| `scripts/prompts/agent-prompt.md` | Final check; distrust assistant defaults; hygiene                 |
| `scripts/actions/_llm_values.py`  | Context injection; parse `needs_agent` / skip                     |
| `scripts/actions/_form.py`        | Supply context sources; surface `needs_agent` on assistant result |
| `scripts/characterization/*`      | New/extended markers                                              |
| `CHANGELOG.md`                    | Unreleased                                                        |




## Success criteria (this bug class)

On a page with `系统评级等级=A` (readonly) and empty `此次评级建议等级`:

- Assistant either selects **A** (from snapshot + task) **or** skips with `needs_agent` naming that field — **not** an unjustified AA.
- Main Agent prompt requires checking before save; Agent path fills A if skipped / wrong.
- No reliance on server “超出范围” as the primary correction mechanism.

