# Task 8 Report: Prompt redesign (agent + planner)

## Status

DONE

## Commits

| SHA | Message |
|-----|---------|
| a30c2b7 | docs: rewrite agent/planner prompts for explicit form assistant and phase contract |

## What was implemented

### `scripts/prompts/agent-prompt.md`

- Replaced implicit first-fill autofill with explicit `run_form_assistant()` gated by 【阶段意图合约】`allow_form_assistant=true`.
- Documented that single-field `fill_*` / `select_*` never trigger batch scan.
- Added 【阶段目录】 / `out_of_scope` discipline for navigate/query phases.
- Updated task-type table, task-list actions, form-assistant section, workflow example, and stage-boundary wording.
- Removed `fill_form_fields_batch` / implicit-trigger references.

### `scripts/prompts/planner-prompt.md`

- Added evaluation rules 8 (phase contract / 【阶段目录】) and 9 (`run_form_assistant` only when allowed).
- Added `run_form_assistant` to Domain Vocabulary table.

### `scripts/actions/_phase_context.py` (hint fix)

- `form_fill_hint()` — `run_form_assistant()` instead of first fill/select trigger.
- `force_refill_hint()` — optional `run_form_assistant()` when contract allows.

## Tests / verification

```bash
python scripts/characterization/characterize-form-assistant.py
# characterize-form-assistant: OK

python scripts/characterization/characterize-case-data.py
# characterize-case-data: OK
```

Manual grep: no remaining「第一次 fill」「隐式」in agent-prompt / planner-prompt / `_phase_context.py` hints.

## Concerns / follow-ups

1. ~~**`heal-prompt.md`** still mentions implicit fill/select autofill~~ — resolved in follow-up commit.
2. **Recording quality vs assistant** — agent prompt still requires per-field write actions for recording; `run_form_assistant` batch fill may need follow-up tuning if traces lack per-field steps.
3. No CHANGELOG (scripts-only per brief).

## Review follow-up (Task 8)

| SHA | Message |
|-----|---------|
| 2eb82ca | docs: align heal-prompt and hints with explicit form assistant |

- `heal-prompt.md` — implicit fill/select → explicit `run_form_assistant()` when contract allows, else per-field fill.
- `_phase_context.py` — module docstring `form_fill` mode + `form_modify_partial_hint()` forbids `run_form_assistant`.
- `agent-prompt.md` — workflow step: after `run_form_assistant`, override 【业务数据】/task-named fields before `click_save`.

## Files touched

- `scripts/prompts/agent-prompt.md` (modified)
- `scripts/prompts/planner-prompt.md` (modified)
- `scripts/actions/_phase_context.py` (modified)
