# Agent task case KV + full catalog — Implementation Plan

> **For agentic workers:** implement task-by-task; TDD where noted.

**Goal:** Case/业务 KV appears only as text on `agent_task`; 【阶段目录】lists all trajectory phases.

**Architecture:** Soft NL hint via `format_case_data_hint`; catalog payload from unfiltered `allPhases` in recording runner.

**Tech stack:** Python agent helpers + Node recording runner; characterization scripts.

---

### Task 1: Revert hard-bind

**Files:** `scripts/controller/actions/_case_data.py`, `_form.py`, `characterize-case-data.py`

- Remove `apply_case_presets_to_fields` and callers.
- Keep `_select_by_xpath` no-silent-first for concrete values (orthogonal).

### Task 2: Hint = block + KV

**Files:** `_case_data.py`, `characterize-case-data.py`

- `format_case_data_hint`: append block and entries together.
- Test: both present in hint; agent_task path still appends hint when `want_biz`.

### Task 3: Full phase catalog

**Files:** `trajectory-recording-runner.js`, characterization if any

- `stepData.all_phases` mapped from `allPhases`, not filtered `phases`.
- Optionally raise `_PREAMBLE_TOTAL_MAX` or truncate task before catalog.

### Task 4: Verify + CHANGELOG

- Run characterizations; update `CHANGELOG.md` [Unreleased]; update todo-list.
