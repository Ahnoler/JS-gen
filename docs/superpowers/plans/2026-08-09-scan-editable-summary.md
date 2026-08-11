# scan_editable_summary (T4-P0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Agent a read-only summary of visible classified business controls (`scan_editable_summary`) without writing `task_list` or triggering auto-fill.

**Architecture:** New controller action aggregates existing `JS_SCAN_FORM_FIELDS` (Source A/B/C) over a root set (visible overlays ∪ main content sans shell), dedupes by `xpath_smart`, returns summary JSON with `buttons: [{text, section}]`. Prompt steers Agent to inventory-before-write.

**Tech Stack:** Python agent (`scripts/controller/actions/`), `js_snippets/scan_form.py`, characterization scripts, `scripts/prompts/agent-tools-form.md`.

**Spec:** `docs/superpowers/specs/2026-08-09-scan-editable-summary-design.md`

## Global Constraints

- α inventory only (classified controls); no raw DOM dump; no MCP a11y as primary path (P4 later).
- Classified kinds only: input / select / date / radio / checkbox / button / tree (as scan emits).
- Shell (aside/menu) excluded from roots.
- **Never** call auto-fill; **never** write `task_list` / `_scan_fields`.
- Buttons shape: `{text, section}` only (no `kind`).
- Do not change global `JS_GET_CONTAINER` semantics.
- TDD: characterization red → green per task.
- Commit `scripts/` (+ CHANGELOG if needed); force-add docs only if committing specs/plans.

## File map

| File | Responsibility |
|------|----------------|
| `scripts/controller/actions/form_scan_utils.py` (or small new helper module) | Root-set builder + summary aggregator from scan JSON |
| `scripts/controller/actions/_form.py` | Register `scan_editable_summary` action |
| `scripts/controller/actions/js_snippets/scan_form.py` | Only if root-set needs a tiny JS helper (prefer Python-driven multi-evaluate first) |
| `scripts/prompts/agent-tools-form.md` | Document inventory-before-write; never autofill |
| `scripts/characterization/characterize-scan-editable-summary.py` | Gate tests |
| `CHANGELOG.md` | Unreleased note (scripts-only → Python sync: 无) |
| `docs/superpowers/backlog-visible-editable-controls.md` | Mark T4-P0 progress when done |

---

### Task 1: Characterization skeleton (failing)

**Files:**
- Create: `scripts/characterization/characterize-scan-editable-summary.py`

**Steps:**

- [ ] **Step 1: Write failing characterization**

Assert (source-level for P0):

1. `_form.py` defines `async def scan_editable_summary`
2. Body must **not** contain `_auto_fill_pending` / `allow_autofill=True`
3. Body must **not** assign `case_data_store['task_list']` or `['_scan_fields']`
4. Returned summary construction includes `"buttons"` and projects `text` + `section` (not `kind`)
5. Prompt `agent-tools-form.md` mentions `scan_editable_summary`

- [ ] **Step 2: Run — expect fail**

```bash
$env:PYTHONPATH="."; python scripts/characterization/characterize-scan-editable-summary.py
```

- [ ] **Step 3: Commit**

```
test: characterize scan_editable_summary (T4-P0 red)
```

---

### Task 2: Summary aggregator helper

**Files:**
- Modify: `scripts/controller/actions/form_scan_utils.py` (preferred) **or** create `editable_summary.py` beside it if `_form.py` / utils already huge

**Interfaces:**

```python
def build_editable_summary(
    scan_results: list[dict],
    *,
    primary_container: str,
) -> dict:
    """Merge A/B/C scan JSON dicts → summary. No store side effects."""
```

Rules:

- Merge `fields` + `buttons` across results; dedupe fields by `xpath_smart` (non-empty)
- `pending_labels`: labels where not disabled and empty `currentValue` (select: treat selected/currentValue)
- `buttons`: `[{"text": b["label"], "section": b.get("section_title") or ""}]` — drop xpath/kind
- Reuse `_build_section_summary` where practical for `sections`
- Filter out fields with `kind` outside known set if any unknowns appear (ignore unknown for pending)

**Steps:**

- [ ] **Step 1: Unit-style asserts in characterization** — feed fake scan dicts, assert shape
- [ ] **Step 2: Implement `build_editable_summary`**
- [ ] **Step 3: Run characterization subset — pass**
- [ ] **Step 4: Commit**

```
feat: aggregate editable control summary from scan JSON
```

---

### Task 3: Root set + `scan_editable_summary` action

**Files:**
- Modify: `scripts/controller/actions/_form.py`
- Optional JS: only if multi-root needs a list-of-roots evaluate; default approach:

```python
# Pseudocode
roots = await page.evaluate(JS_LIST_VISIBLE_OVERLAY_ROOTS)  # or inline
if not roots:
    roots = [await resolve_main_content_root(page)]  # .el-main else document, skip .el-aside/.el-menu
merged = []
for root in roots:
    # Prefer: pass root handle / xpath into scan; if JS_SCAN_FORM_FIELDS is hard-wired to JS_GET_CONTAINER,
    # add optional container override param OR temporary evaluate wrapper that sets scan container = root.
    raw = await page.evaluate(JS_SCAN_FORM_FIELDS, [True, _button_keywords()])  # quick=true
    ...
summary = build_editable_summary(merged, primary_container=...)
return json.dumps(summary, ensure_ascii=False)
```

**Important implementation note:** Today `JS_SCAN_FORM_FIELDS` embeds `JS_GET_CONTAINER` (single root). P0 options (pick smallest):

1. **Preferred:** Add optional 3rd arg / override in `JS_SCAN_FORM_FIELDS` so evaluate can pass an explicit root element strategy (keep default = current GET_CONTAINER).
2. **Fallback:** If only one overlay exists, call existing scan once with `quick=True` (still an improvement: new read-only action + summary buttons shape); document multi-root as P1 follow-up in CHANGELOG if deferred.

Spec wants multi-root; implement override if ≤ moderate JS change; otherwise ship single-root read-only action + note P1 for true multi-root — **do not silently claim multi-root**.

**Steps:**

- [ ] **Step 1: Decide override vs P1 deferral; document in code comment + characterization**
- [ ] **Step 2: Register action; wire aggregator; zero store writes**
- [ ] **Step 3: Characterization green for action constraints**
- [ ] **Step 4: Commit**

```
feat: add scan_editable_summary agent action (T4-P0)
```

---

### Task 4: Prompt + CHANGELOG + backlog

**Files:**
- Modify: `scripts/prompts/agent-tools-form.md`
- Modify: `CHANGELOG.md` `[Unreleased]`
- Modify: `docs/superpowers/backlog-visible-editable-controls.md` (T4-P0 done / P1 next)
- Modify: spec Status → Implemented

**Prompt bullets:**

- 了解当前可见可编辑控件时调用 `scan_editable_summary()`（只读摘要，不填表、不建任务列表）
- 用 `pending_labels` 与 `buttons[{text,section}]` 决定下一步 fill/select/click_save
- 壳层导航不要依赖本清单
- 需要建任务列表时仍用 `scan_form_fields`；批量填仍用 `run_form_assistant`（合约允许时）

**Steps:**

- [ ] **Step 1: Update prompt**
- [ ] **Step 2: Run full related characterization suite**

```bash
$env:PYTHONPATH="."
python scripts/characterization/characterize-scan-editable-summary.py
python scripts/characterization/characterize-form-scan-control-first.py
python scripts/characterization/characterize-control-ops-closed-loop.py
```

- [ ] **Step 3: CHANGELOG + backlog + spec status**
- [ ] **Step 4: Commit**

```
docs: prompt + CHANGELOG for scan_editable_summary
```

---

## Out of scope for this plan (tracked in backlog)

- T4-P1 multi-root / shell stripping hardening (if deferred in Task 3)
- T4-P2 memory Fact Pack ingest
- T4-P3 T5/T6 / T1r / T8
- T4-P4 Playwright MCP a11y dual-track
