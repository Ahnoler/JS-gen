# Form scan control-first (+ el-table) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scan discovers editable controls (el-form-item + el-table cells), dedupes by relative `xpath_smart`, and assistant/fill execute xpath-first so rating-style tables and placeholder-only fields work for both auto-fill and form snapshots.

**Architecture:** Extend `JS_SCAN_FORM_FIELDS` with Source B (el-table) + xpath emission; extend `ScannedField` / `TaskItem` with `xpath_smart`; wire `_auto_fill_pending` to fill/select via xpath (reuse/adapt `_JS_FILL_BY_XPATH` from `_replay.py`); keep label/placeholder as display names only. Out of scope then: full-page inventory → now **T4**（α 业务控件，见 `2026-08-09-scan-editable-summary`）；multi-`click_save` tracked separately.

**Tech Stack:** Python 3 agent (`scripts/actions`), JS strings in `_js_snippets.py`, Pydantic models, Node/Python characterization scripts, optional CDP E2E against headed Chromium on 9242.

**Spec:** `docs/superpowers/archive/specs/2026-08-07-form-scan-control-first-design.md`

## Global Constraints

- Dual consumers: `run_form_assistant` + `save_form_snapshot` / replay (same `ScannedField[]`).
- v1 table adapter: **Element UI `el-table` only** (not custom grids).
- Table displayName: row-leading text; multi-control row → `行首|列头` / placeholder / `#n`.
- Dedup key: **relative `xpath_smart` only** (not displayName) — e.g. two「保存」in different collapses stay distinct.
- Execute: **xpath-first**; label fallback only when xpath missing (legacy).
- Placeholder-only form controls (no label): include; displayName = placeholder; execute via xpath.
- Do **not** implement in this plan: full-page inventory（→ **T4**）；`click_save` multi-button defect TODO.
- Prefer TDD: characterization fails before production change.
- `docs/` is gitignored — commit code under `scripts/` / `src/` / `CHANGELOG.md` only when user asks; plans/specs stay local unless relocated.

## File map

| File | Role |
|------|------|
| `scripts/models/field.py` | Add `xpath_smart` (and optional `source`) on `ScannedField` |
| `scripts/models/task.py` | Carry `xpath_smart` on `TaskItem`; mark_done prefers xpath when present |
| `scripts/models/form_snapshot.py` | Fingerprint includes xpath so same displayName ≠ one field |
| `scripts/actions/_js_snippets.py` | Source B scan + xpath builders + dedup; shared fill/select-by-xpath helpers |
| `scripts/actions/_form.py` | Auto-fill / fill actions xpath-first; pass xpath into evaluate |
| `scripts/actions/_replay.py` | Prefer importing shared fill-by-xpath from snippets if extracted (avoid drift) |
| `scripts/characterization/characterize-form-scan-control-first.py` | New characterization (TDD gate) |
| `CHANGELOG.md` | Note scan/assistant semantic change (scripts-heavy; brief Unreleased) |

---

### Task 1: Model — `xpath_smart` on ScannedField + TaskItem

**Files:**
- Modify: `scripts/models/field.py`
- Modify: `scripts/models/task.py`
- Test: `scripts/characterization/characterize-form-scan-control-first.py` (create)

**Interfaces:**
- Produces: `ScannedField.xpath_smart: str = ""`; `TaskItem.xpath_smart: str = ""`; `TaskItem.from_scanned` copies `xpath_smart` from dict; `TaskList.mark_done` matches by xpath when `xpath` kwarg or item has xpath_smart

- [ ] **Step 1: Write failing characterization**

Create `scripts/characterization/characterize-form-scan-control-first.py`:

```python
#!/usr/bin/env python3
"""Characterize control-first form scan (xpath on models + scan cues)."""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scripts.models.field import ScannedField
from scripts.models.task import TaskItem, TaskList


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> int:
    f = ScannedField(label="请输入账号", xpath_smart="//input[@placeholder='请输入账号']")
    assert_true(hasattr(f, "xpath_smart") and f.xpath_smart.startswith("//"), "ScannedField.xpath_smart")
    item = TaskItem.from_scanned({
        "label": "请输入账号",
        "kind": "input",
        "currentValue": "",
        "disabled": False,
        "required": False,
        "hasButton": "",
        "placeholder": "请输入账号",
        "xpath_smart": "//input[@placeholder='请输入账号']",
    })
    assert_true(item is not None and item.xpath_smart.startswith("//"), "TaskItem carries xpath_smart")
    print("characterize-form-scan-control-first models: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `python scripts/characterization/characterize-form-scan-control-first.py`  
Expected: FAIL (`xpath_smart` unexpected / validation error)

- [ ] **Step 3: Add fields to models**

In `ScannedField` add:

```python
xpath_smart: str = Field(
    default="",
    description="Relative xpath for the operable control (dedup + execute key)",
)
```

In `TaskItem` add the same field; in `from_scanned` / force-refill rebuild paths copy `xpath_smart=field.get("xpath_smart", "")`.

- [ ] **Step 4: Re-run — expect PASS**

Run: `python scripts/characterization/characterize-form-scan-control-first.py`  
Expected: `models: OK`

- [ ] **Step 5: Commit** (when user allows)

```bash
git add scripts/models/field.py scripts/models/task.py scripts/characterization/characterize-form-scan-control-first.py
git commit -m "feat(scan): add xpath_smart on ScannedField and TaskItem"
```

---

### Task 2: Snapshot fingerprint includes xpath

**Files:**
- Modify: `scripts/models/form_snapshot.py`
- Modify: `scripts/characterization/characterize-form-scan-control-first.py`

**Interfaces:**
- Consumes: scan dicts may include `xpath_smart`
- Produces: `fields_fingerprint` → `(label, is_required, xpath_smart)` so two same labels stay distinct; `from_scan_fields` keeps fields with empty label if `placeholder` or `xpath_smart` present (use display label = label or placeholder)

- [ ] **Step 1: Extend characterization**

```python
from scripts.models.form_snapshot import FormSnapshot

def test_fingerprint_distinguishes_same_label():
    a = FormSnapshot.from_scan_fields("main", [
        {"label": "保存", "required": False, "xpath_smart": "//div[@id='a']//button"},
        {"label": "保存", "required": False, "xpath_smart": "//div[@id='b']//button"},
    ])
    assert len(a.fields) == 2
    assert a.fields_fingerprint[0] != a.fields_fingerprint[1]
```

Add call into `main()` of the characterization file.

- [ ] **Step 2: Run — expect FAIL** (fingerprint tuples equal or second field dropped)

- [ ] **Step 3: Implement**

Update `fields_fingerprint` to include xpath; update `from_scan_fields` to:

```python
label = (f.get("label") or f.get("placeholder") or "").strip()
xpath = (f.get("xpath_smart") or "").strip()
if not label and not xpath:
    continue
# ... SnapshotField may need optional xpath_smart field for fingerprint only
```

If `SnapshotField` only has `label`/`is_required`, either add `xpath_smart: str = ""` to `SnapshotField` or encode into fingerprint from scan before drop. Prefer adding `xpath_smart` on `SnapshotField` (optional in API dump for Type B if unused).

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit** (when user allows)

---

### Task 3: JS scan — el-table Source B + xpath + dedup

**Files:**
- Modify: `scripts/actions/_js_snippets.py` (`JS_SCAN_FORM_FIELDS`)
- Modify: `scripts/characterization/characterize-form-scan-control-first.py` (static string cues)

**Interfaces:**
- Produces: each field JSON includes `xpath_smart`; table fields use row displayName rules; dedupe map keyed by `xpath_smart`; placeholder-only form-items included with `label` set to placeholder when label empty

- [ ] **Step 1: Failing cues in characterization**

```python
js = (ROOT / "scripts/actions/_js_snippets.py").read_text(encoding="utf-8")
assert "el-table" in js and "xpath_smart" in js  # will fail until implemented inside JS_SCAN_FORM_FIELDS body
# Stronger: assert a unique marker comment we will add:
# /* SCAN_SOURCE_B_EL_TABLE */
assert "SCAN_SOURCE_B_EL_TABLE" in js
assert "SCAN_DEDUP_BY_XPATH" in js
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement scan extensions inside `JS_SCAN_FORM_FIELDS`**

After existing form-item loop (Source A):

1. For each form-item field, set `field.xpath_smart` via a small helper (prefer label-scoped form xpath consistent with `locator-candidates` form field pattern, or absolute-enough relative path from container). If label empty and placeholder present: `field.label = placeholder`.
2. Marker comments: `/* SCAN_SOURCE_B_EL_TABLE */`, `/* SCAN_DEDUP_BY_XPATH */`.
3. Source B: for each visible `el-table` in `container` (skip pagination bars):
   - each data row `tr`
   - rowText = first meaningful cell text (skip checkbox-only cells)
   - if !rowText → skip row controls (per spec)
   - each operable `input/textarea/.el-select` in row (visible, in tbody)
   - build displayName per §2 rules
   - build relative xpath for that control (row text + control kind; or table-scoped path)
   - push field `{ label: displayName, kind, currentValue, ..., xpath_smart, disabled }`
4. Dedup: `const seen = new Set();` push only if `xpath_smart` not in seen (prefer keeping earlier Source A entry).

Keep Phase 2 Vue options read for selects (including table selects if trigger available).

- [ ] **Step 4: Run characterization cues — PASS**

- [ ] **Step 5: Optional CDP smoke** (if 9242 open on rating page)

```bash
# evaluate JS_SCAN_FORM_FIELDS via playwright connect_over_cdp; assert editable count >> 3
```

Document script under `scripts/characterization/` only if reusable; else one-off in task notes.

- [ ] **Step 6: Commit** (when user allows)

---

### Task 4: Shared fill/select-by-xpath helpers

**Files:**
- Modify: `scripts/actions/_js_snippets.py` (add `JS_FILL_BY_XPATH`, `JS_SELECT_OPTION_BY_XPATH` or select-trigger-by-xpath)
- Modify: `scripts/actions/_replay.py` (optional: import/reuse to avoid drift)
- Test: characterization asserts snippet markers exist

**Interfaces:**
- Produces: `JS_FILL_BY_XPATH = '''([xpath, val, placeholderHint]) => { ... }'''` adapted from `_replay._JS_FILL_BY_XPATH` (must work for el-table fixed columns visibility)
- Produces: helper to open `.el-select` by xpath then reuse existing option picker, **or** evaluate that finds trigger via xpath then calls existing select logic

- [ ] **Step 1: Characterization**

```python
assert "JS_FILL_BY_XPATH" in (ROOT / "scripts/actions/_js_snippets.py").read_text(encoding="utf-8")
```

- [ ] **Step 2: FAIL → implement export in `_js_snippets.py` → PASS**

- [ ] **Step 3: Wire `_form.py` imports** of the new constants

- [ ] **Step 4: Commit** (when user allows)

---

### Task 5: Assistant + fill actions xpath-first

**Files:**
- Modify: `scripts/actions/_form.py` (`_execute_round`, optionally `fill_form_field` / `select_option`)
- Modify: `scripts/characterization/characterize-form-assistant.py` (cue: auto-fill uses xpath when present)

**Interfaces:**
- Consumes: pending item dicts with `xpath_smart`
- Produces: when `xpath_smart` non-empty, `_execute_round` calls `JS_FILL_BY_XPATH` / select-by-xpath instead of label-only `JS_FILL_FORM_FIELD`; `_record_action` still records label for humans + element xpath from capture when possible
- `fill_form_field(label_text, value)`: if caller later passes xpath via internal store lookup, prefer xpath; public signature can stay label-based for Agent while assistant uses internal path `_fill_field(item_dict, value)`

- [ ] **Step 1: Failing cue**

In characterize-form-assistant or control-first file:

```python
form_py = (ROOT / "scripts/actions/_form.py").read_text(encoding="utf-8")
assert "JS_FILL_BY_XPATH" in form_py
assert "xpath_smart" in form_py  # used in _execute_round
```

- [ ] **Step 2: Implement `_execute_round` branch**

```python
xp = (d.get("xpath_smart") or "").strip()
if xp and kind in ("fill_input", "fill", "input"):
    result = await page.evaluate(JS_FILL_BY_XPATH, [xp, value, d.get("placeholder") or label])
elif xp and kind in ("select_option", "select", ...):
    result = await page.evaluate(JS_SELECT_BY_XPATH, [xp, value])  # or trigger+JS_SELECT_OPTION
else:
    # existing label path
```

Ensure `_task_done_impl` can match by label; if duplicate labels, pass xpath into mark_done (Task 1 extension):

```python
def mark_done(self, label, value=None, xpath_smart=""):
    if xpath_smart:
        for i, item in enumerate(self.pending):
            if item.xpath_smart == xpath_smart:
                ...
```

- [ ] **Step 3: Run characterizations — PASS**

- [ ] **Step 4: Manual CDP check on 评级 page** (user browser): `run_form_assistant` path or evaluate scan+fill one table select

- [ ] **Step 5: Commit** (when user allows)

---

### Task 6: Docs + CHANGELOG + leave TODOs unfixed

**Files:**
- Modify: `CHANGELOG.md` `[Unreleased]` Fixed/Changed — form scan control-first + el-table; xpath-first fill
- Modify: `docs/superpowers/archive/specs/2026-08-07-form-scan-control-first-design.md` status → `Accepted / implementing`
- Do **not** fix `click_save` multi-button or full-page inventory here（后者 → **T4-P0** `scan_editable_summary`）

- [ ] **Step 1: Append CHANGELOG entry** (scripts + scan semantics; Python sync: 无 or note scripts-only)

- [ ] **Step 2: Update spec status line**

- [ ] **Step 3: Run full related characterizations**

```bash
python scripts/characterization/characterize-form-scan-control-first.py
python scripts/characterization/characterize-form-assistant.py
python scripts/characterization/characterize-case-data.py
node scripts/characterization/characterize-form-snapshot-trigger.mjs
```

Expected: all PASS

- [ ] **Step 4: Commit** (when user allows)

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Source A form-item preserved | 3 |
| Source B el-table | 3 |
| Dedupe by xpath_smart | 3 |
| Table displayName rules | 3 |
| Placeholder-only included | 3 |
| xpath on ScannedField / TaskItem | 1 |
| Snapshot keeps distinct same-label fields | 2 |
| Assistant executes xpath-first | 4–5 |
| No fill_table_* API | 5 (reuse fill/select) |
| Full-page inventory → **T4** | 6 (doc only；现由 T4-P0 接替) |
| click_save multi TODO | 6 (doc only) |
| Characterization / E2E | 1–5, optional CDP in 3/5 |

## Out of scope reminders (do not implement in this plan)

1. Main Agent **α 业务控件** inventory / self-select — **T4**（`scan_editable_summary`），不是裸 DOM。  
2. `click_save` section-scoped / multi-「保存」fix.

---

## Self-review notes

- No TBD placeholders in tasks.  
- Fingerprint change is required for “same displayName, different xpath” — covered in Task 2.  
- `mark_done` by xpath required when duplicate displayNames — covered in Tasks 1 and 5.  
- Replay already xpath-first for recorded steps; this plan focuses recording/assistant scan path.
