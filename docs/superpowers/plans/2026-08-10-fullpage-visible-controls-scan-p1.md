# Full-page L2 rebase for Source A/B/C (P1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `scan_form_fields` / form-assistant / first-touch rescan consume the same full-page L2 pool + L1 assignment as `scan_editable_summary`, projecting into existing A/B/C-shaped `fields`/`buttons` so TaskList and fill ops keep working — with shell **visible in inventory** but **not auto-filled**.

**Architecture:** Today only `scan_editable_summary` passes `mode:'fullpage'`; other callers use container-scoped or `multi` roots while still running Source A (`.el-form-item`) / B (`.el-table`) / C (buttons) collectors. P1 wires those callers to `fullpage` (or shared opts) so one document-wide collect + section/region attach feeds everyone. Autofill / TaskList pending **filters out** `region_role` in `{shell-header,shell-aside}` and kinds `{menu_item,icon}` so shell does not become fill targets. LLM L1 classify stays **out of this plan** (optional follow-up).

**Tech Stack:** `scripts/controller/actions/js_snippets/scan_form.py`, `_form.py`, `form_scan_utils.py`, characterization scripts, prompts if needed.

**Spec:** `docs/superpowers/specs/2026-08-10-fullpage-visible-controls-scan-design.md` (P1 row + A/B/C reuse L2)

## Global Constraints

- Algorithm **B**: L2 admission stays visibility + taxonomy; containers assign only.
- Shell **in** scan inventory; **never** auto-fill from shell / menu_item / decorative icon.
- `scan_editable_summary` shape already approved: `pending_items` / `readonly_items` / `buttons` with `xpath_smart` — do not regress.
- TaskList / `ScannedField` / fill path continue to use `fields[].xpath_smart` + label.
- No auto-fill from summary; no `task_list` write inside `scan_editable_summary`.
- TDD: characterization fail → implement → green.
- Commit only if user asks.
- LLM L1 classify **not** in this plan.

## How we 改造 (current → target)

| Today | P1 target |
|-------|-----------|
| `scan_editable_summary` → `mode:'fullpage'` | unchanged |
| `scan_form_fields` / `_ensure_scanned` / assistant → default container or ad-hoc | same evaluate with `{'mode':'fullpage'}` (or equivalent shared mode) |
| TaskList pending may include anything scanned | exclude shell + menu_item/icon from **fillable** pending (still in `_scan_fields` optional / or filtered before `TaskList.from_scan`) |
| Source A/B/C code paths duplicated by root | keep collectors; root = `document` under fullpage; project region onto fields |

```text
scan_form_fields / run_form_assistant / first-touch
  → JS_SCAN_FORM_FIELDS([quick, kw, {mode:'fullpage'}])
  → fields/buttons with section + region_* + xpath_smart
  → filter fillable → TaskList.from_scan / autofill
scan_editable_summary (already)
  → build_editable_summary → pending_items[+xpath_smart]
```

## File map

| File | Role |
|------|------|
| `scripts/controller/actions/_form.py` | Pass `mode:'fullpage'` on product scan call sites (not every debug path if unsafe); filter shell before TaskList/autofill |
| `scripts/controller/actions/form_scan_utils.py` | Helper `filter_fillable_scan_fields(fields)` (or equivalent) |
| `scripts/controller/actions/js_snippets/scan_form.py` | Only if needed: ensure default fullpage markers / region on A/B/C fields stable |
| `scripts/characterization/characterize-scan-editable-summary.py` and/or new `characterize-scan-fullpage-p1.py` | Wiring + filter cues |
| `scripts/prompts/agent-tools-form.md` | One line: form scan now fullpage; shell not for fill |
| `docs/superpowers/backlog-visible-editable-controls.md` | Mark P1 progress when done |

---

### Task 1: Characterization — P1 wiring + shell excluded from fillable

**Files:**
- Modify or add: `scripts/characterization/characterize-scan-editable-summary.py` **or** `scripts/characterization/characterize-scan-fullpage-p1.py`
- Test: same

- [x] **Step 1: Write failing tests**

```python
def test_form_scan_callers_use_fullpage_mode() -> None:
    form = (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
    # At least scan_form_fields + run_form_assistant / _rebuild path pass mode fullpage
    assert "mode" in form and "fullpage" in form
    # More than scan_editable_summary alone: count evaluate(...fullpage) >= 2 distinct call sites
    ...

def test_filter_fillable_excludes_shell() -> None:
    from scripts.controller.actions.form_scan_utils import filter_fillable_scan_fields
    fields = [
        {"label": "客户名称", "kind": "input", "region_role": "main", "disabled": False},
        {"label": "系统管理", "kind": "menu_item", "region_role": "shell-aside"},
        {"label": "设置", "kind": "icon", "region_role": "shell-header"},
        {"label": "顶栏输入", "kind": "input", "region_role": "shell-header", "disabled": False},
    ]
    out = filter_fillable_scan_fields(fields)
    labels = [f["label"] for f in out]
    assert labels == ["客户名称"]
```

- [x] **Step 2: Run — expect FAIL**

```powershell
$env:PYTHONPATH="."
python scripts/characterization/characterize-scan-fullpage-p1.py
```

- [x] **Step 3: Stop** — implement Task 2–3

---

### Task 2: `filter_fillable_scan_fields` helper

**Files:**
- Modify: `scripts/controller/actions/form_scan_utils.py`

- [x] **Step 1: Implement**

```python
_SHELL_ROLES = frozenset({"shell-header", "shell-aside"})
_NON_FILL_KINDS = frozenset({"menu_item", "icon"})

def filter_fillable_scan_fields(fields: list[dict]) -> list[dict]:
    """Fields eligible for TaskList / autofill (exclude shell + menu/icon)."""
    out = []
    for f in fields or []:
        if not isinstance(f, dict):
            continue
        kind = (f.get("kind") or "").strip()
        if kind in _NON_FILL_KINDS:
            continue
        role = (f.get("region_role") or "").strip()
        if role in _SHELL_ROLES:
            continue
        out.append(f)
    return out
```

- [x] **Step 2: Re-run filter unit test — expect PASS**

---

### Task 3: Wire `_form.py` scan call sites to `fullpage` + filter

**Files:**
- Modify: `scripts/controller/actions/_form.py`

**Call sites to update (product path):**
- `scan_form_fields`
- `_rebuild_task_list_from_dom` / first-touch inside `_ensure_scanned`
- `run_form_assistant` scan evaluate
- Other **same-session form** rescans that build TaskList (raw2/raw3/sync if they feed task list) — prefer fullpage for consistency; leave obscure heal/debug if characterization proves risky

**Pattern:**

```python
raw = await page.evaluate(
    JS_SCAN_FORM_FIELDS,
    [False, _button_keywords(), {"mode": "fullpage"}],
)
# ...
raw_fields = result.get("fields") if isinstance(result, dict) else result
fillable = filter_fillable_scan_fields(raw_fields or [])
# TaskList.from_scan(fillable) / _scan_fields may store fillable OR full+flag — prefer:
case_data_store["_scan_fields"] = fillable  # ops resolve from fillable
# Optionally keep case_data_store["_scan_fields_all"] = raw_fields for inventory — only if needed; YAGNI default = fillable only for task list
```

- [x] **Step 1: Import + apply filter on TaskList build paths**
- [x] **Step 2: Pass `mode:'fullpage'` on those evaluates**
- [x] **Step 3: Run** `characterize-scan-fullpage-p1.py` + `characterize-scan-editable-summary.py` + `characterize-form-scan-control-first.py` — expect PASS
- [x] **Step 4: Smoke** `characterize-form-assistant.py` / `characterize-task-list-container.py` if present and cheap

---

### Task 4: Prompt + backlog

**Files:**
- Modify: `scripts/prompts/agent-tools-form.md` (one bullet: form scans are fullpage; do not fill shell; use `xpath_smart` from scan/pending)
- Modify: `docs/superpowers/backlog-visible-editable-controls.md` (P1 in progress / done)
- Modify: spec P1 success checkbox when green

- [x] **Step 1: Docs**
- [x] **Step 2: Optional wet-run** on edit page: `scan_form_fields` via agent or inject — pending excludes left nav; 评级等级测算 fields still present with xpath
- [x] **Step 3: User-facing summary**

**Done when:** Product form scan/assistant use fullpage L2; fillable filter excludes shell; chars green; summary xpath shape unchanged.

---

## Out of scope (later)

- LLM L1 classify for low-confidence cards
- P2 icon noise filter / menu naming polish
- T5 separate non-el-table TableNet scanner
- Changing `scan_editable_summary` return shape again

## Execution handoff

Plan: `docs/superpowers/plans/2026-08-10-fullpage-visible-controls-scan-p1.md`  
After user says **execute** → `executing-plans` or `subagent-driven-development` from Task 1.
