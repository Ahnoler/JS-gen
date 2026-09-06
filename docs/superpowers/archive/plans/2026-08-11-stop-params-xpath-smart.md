# Stop Persisting params.xpath_smart — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New recordings omit `params.xpath_smart`; **every consumer** that used `params_json.xpath_smart` for locate/readback switches to `element_json.xpath_smart`; `_record_action` strips any stray params xpath.

**Architecture:** Dual-write ends at the source (form/manual stop putting xpath in params) plus a choke-point strip in `scripts/state.py` `_record_action`. Replay already prefers element (WIP on branch — commit first if uncommitted). Batch push / assemble already read element — verify only. Ops/wet/audit scripts that still call `_params_xpath_smart` must use `_element_xpath_smart` instead; then delete `_params_xpath_smart`.

**Tech Stack:** Python controller (`_form.py`, `mapper.py`, `state.py`, `_replay.py`), characterization scripts, optional ops repair rewrite.

**Spec:** `docs/superpowers/specs/2026-08-11-stop-params-xpath-smart-design.md`

## Global Constraints

- Do **not** remove agent tool argument `xpath_smart` (runtime inventory lookup only).
- Do **not** clear scan / `task_list` inventory `xpath_smart`.
- Do **not** force DB wipe of historical `params.xpath_smart` (optional ops strip only).
- Replay locate: `element.xpath_smart` → label → `element.xpath_full`; never params xpath.
- **Consumer rule:** any code that reads step `params.xpath_smart` / `_params_xpath_smart` for locate, readback, audit hit-count, or wet verify must switch to `element.xpath_smart` / `_element_xpath_smart` (then remove `_params_xpath_smart`).
- Batch push / legacy-engine export already use `element` via `pickExportTarget` — do not switch them to params.
- `scripts/`-only → no `CHANGELOG.md` unless api-docs claim params xpath is required (then docs-only).
- TDD: failing characterization before each behavior change.
- Do not push unless the user asks.
- Work on current branch (`V2.1_dev`); leave unrelated WIP unstaged.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `scripts/state.py` | `_record_action` choke-point: strip `xpath_smart` from params copy |
| `scripts/controller/actions/_form.py` | Stop putting `xpath_smart` in `_record_action` params dicts |
| `scripts/manual_recorder/mapper.py` | Remove `_stamp_params` xpath into params; keep element smart |
| `scripts/controller/actions/_replay.py` | Element-first `_resolve_replay_xpath`; **delete** `_params_xpath_smart` after readers migrate |
| `scripts/characterization/wet-traj-xpath-replay.py` | Readback xpath from element, not params |
| `scripts/characterization/audit-traj-xpath-dry.py` | Hit-count / chosen xpath from element, not params |
| `scripts/characterization/repair-traj-params-xpath.py` | Strip leftover params keys (do not copy element → params) |
| `scripts/controller/actions/_helpers.py` | Retire params-oriented `stamp_recorded_xpath_smart` usage or delete if unused |
| `scripts/characterization/characterize-record-params-no-xpath.py` | **Create** — `_record_action` omits params xpath |
| `scripts/characterization/characterize-replay-params-xpath.py` | Keep element-first traj-130 cases; assert `_params_xpath_smart` gone |
| `scripts/characterization/characterize-manual-dialog-scope.py` | Expect params **omit** xpath; element still scoped |
| `scripts/characterization/characterize-capture-element-xpath.py` | Retarget stamp/source asserts away from params stamp |
| `docs/superpowers/specs/2026-08-11-stop-params-xpath-smart-design.md` | Mark Approved when executing |

---

### Task 1: Commit / lock element-first replay

**Files:**
- Modify (if uncommitted): `scripts/controller/actions/_replay.py`
- Modify (if uncommitted): `scripts/characterization/characterize-replay-params-xpath.py`

**Interfaces:**
- Produces: `_resolve_replay_xpath(entry, params) -> (xpath, source)` with `source in {'element','full',''}` — never `'params'`

- [ ] **Step 1: Confirm characterization**

```bash
python scripts/characterization/characterize-replay-params-xpath.py
```

Expected: `characterize-replay-params-xpath: OK` (includes traj-130 style: wrong params 编号, element 名称 → element).

If tests fail because WIP is incomplete, finish `_resolve_replay_xpath` to:

```python
def _resolve_replay_xpath(entry, params) -> tuple[str, str]:
    if not relative_xpath_primary_enabled():
        full = _element_xpath_full(entry)
        return (full, 'full') if full else ('', '')
    ex = _element_xpath_smart(entry)
    if ex:
        return ex, 'element'
    full = _element_xpath_full(entry)
    if full:
        return full, 'full'
    return '', ''
```

Do not call `_params_xpath_smart` from resolve or fill/select locate/readback.

- [ ] **Step 2: Commit only these two files (if dirty)**

```bash
git add scripts/controller/actions/_replay.py scripts/characterization/characterize-replay-params-xpath.py
git commit -m "fix: replay locates via element.xpath_smart, ignores params"
```

If already committed, skip commit and note SHA in the task report.

---

### Task 2: Migrate all params.xpath_smart consumers → element

**Files:**
- Modify: `scripts/controller/actions/_replay.py` (delete `_params_xpath_smart` when unused)
- Modify: `scripts/characterization/wet-traj-xpath-replay.py`
- Modify: `scripts/characterization/audit-traj-xpath-dry.py`
- Modify: `scripts/characterization/characterize-replay-params-xpath.py`
- Modify: `scripts/characterization/repair-traj-params-xpath.py`

**Interfaces:**
- Consumes: `_element_xpath_smart(entry)`, `_element_xpath_full(entry)`
- Produces: zero production/ops readers of step `params.xpath_smart` for locate/readback/audit

**Known consumers (must migrate):**

| Location | Old | New |
|----------|-----|-----|
| `_replay.py` resolve/fill/select | `_params_xpath_smart` | already element — delete helper |
| `wet-traj-xpath-replay.py` | `_params_xpath_smart(...) or el_xp` | `_element_xpath_smart(entry)` only |
| `audit-traj-xpath-dry.py` | params hit-count / `params_xp` | element smart (+ full fallback); drop “no params.xpath_smart” as failure |
| `repair-traj-params-xpath.py` | copy element → params | **strip** `params.xpath_smart` key |

Non-consumers (no change): `legacy-engine-export.pickExportTarget`, assemble/codegen, batch push — already element.

- [ ] **Step 1: Failing assert — helper must disappear**

Add to `characterize-replay-params-xpath.py`:

```python
def test_params_xpath_helper_removed() -> None:
    assert not hasattr(R, "_params_xpath_smart"), "_params_xpath_smart must be deleted"
```

Also:

```bash
rg "_params_xpath_smart|params\.get\(['\"]xpath_smart" scripts/ --glob '!**/characterize-replay-params-xpath.py'
```

After this task, ripgrep must show **no** locate/readback uses (repair may still *delete* the key).

- [ ] **Step 2: Run — expect FAIL** (helper still exists)

```bash
python scripts/characterization/characterize-replay-params-xpath.py
```

- [ ] **Step 3: Patch wet + audit**

`wet-traj-xpath-replay.py` — replace readback:

```python
el_xp = _element_xpath_smart(fill_entry)
before = await _read_value_by_xpath(page, el_xp) if el_xp else ""
# ...
after = await _read_value_by_xpath(page, el_xp) if el_xp else ""
```

Remove `_params_xpath_smart` import.

`audit-traj-xpath-dry.py` — use element xpath for hit counts / chosen locator; treat missing element smart as note, not “no params.xpath_smart”.

- [ ] **Step 4: Rewrite repair to strip**

```python
# plan_repairs: if "xpath_smart" in params → new_params without that key
new_params = {k: v for k, v in params.items() if k != "xpath_smart"}
```

Do **not** write element xpath into params.

- [ ] **Step 5: Delete `_params_xpath_smart` from `_replay.py`**

- [ ] **Step 6: Re-run**

```bash
python scripts/characterization/characterize-replay-params-xpath.py
rg "_params_xpath_smart" scripts/
```

Expected: characterize OK; `rg` only hits comments/history or zero.

- [ ] **Step 7: Commit**

```bash
git add scripts/controller/actions/_replay.py \
  scripts/characterization/wet-traj-xpath-replay.py \
  scripts/characterization/audit-traj-xpath-dry.py \
  scripts/characterization/characterize-replay-params-xpath.py \
  scripts/characterization/repair-traj-params-xpath.py
git commit -m "refactor: consumers use element.xpath_smart; drop params xpath helper"
```

---

### Task 3: `_record_action` choke-point strip

**Files:**
- Create: `scripts/characterization/characterize-record-params-no-xpath.py`
- Modify: `scripts/state.py` (`_record_action`)

**Interfaces:**
- Consumes: `ActionEntry.from_record`, `_ACTION_LOG`
- Produces: every appended log entry’s `params` dict has no `xpath_smart` key

- [ ] **Step 1: Write failing characterization**

```python
#!/usr/bin/env python3
"""Recorded step params must omit xpath_smart (element carries locator)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_record_action_strips_params_xpath_smart() -> None:
    from scripts import state as S

    S._ACTION_LOG.clear()
    S._CURRENT_PHASE = 1
    S._CURRENT_SOURCE = "agent"
    element = {
        "xpath_smart": (
            "//div[contains(@class,'el-form-item')]"
            "[.//label[contains(.,'名称')]]//input"
        ),
        "tag": "input",
    }
    S._record_action(
        "fill_form_field",
        {
            "label_text": "核心产品名称",
            "value": "x",
            "xpath_smart": (
                "//div[contains(@class,'el-form-item')]"
                "[.//label[contains(.,'编号')]]//input"
            ),
        },
        "ok",
        element=element,
    )
    assert_true(len(S._ACTION_LOG) >= 1, "entry appended")
    entry = S._ACTION_LOG[-1]
    params = entry.get("params") or {}
    assert_true("xpath_smart" not in params, f"params must omit xpath_smart, got {params!r}")
    el = entry.get("element") or {}
    assert_true("名称" in str(el.get("xpath_smart") or ""), "element xpath preserved")


def main() -> int:
    test_record_action_strips_params_xpath_smart()
    print("characterize-record-params-no-xpath: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run — expect FAIL**

```bash
python scripts/characterization/characterize-record-params-no-xpath.py
```

Expected: FAIL — params still contain `xpath_smart`.

- [ ] **Step 3: Strip in `_record_action`**

In `scripts/state.py` `_record_action`, immediately after `params_dict = dict(params) if params else {}`:

```python
    params_dict = dict(params) if params else {}
    params_dict.pop("xpath_smart", None)
```

Pass `params_dict` into `ActionEntry.from_record` (already does). Ensure any later use of `params` for coalesce also uses the stripped dict (today uses `params_dict`).

- [ ] **Step 4: Run — expect OK**

```bash
python scripts/characterization/characterize-record-params-no-xpath.py
```

Expected: `characterize-record-params-no-xpath: OK`

- [ ] **Step 5: Commit**

```bash
git add scripts/state.py scripts/characterization/characterize-record-params-no-xpath.py
git commit -m "fix: strip xpath_smart from recorded action params"
```

---

### Task 4: Stop writing params xpath in `_form.py`

**Files:**
- Modify: `scripts/controller/actions/_form.py`
- Modify: `scripts/characterization/characterize-capture-element-xpath.py`

**Interfaces:**
- Consumes: `_capture_element`, `_record_action` (strip already live)
- Produces: call sites pass params **without** `'xpath_smart'` key; element still captured with durable xpath

- [ ] **Step 1: Extend failing source asserts**

In `characterize-capture-element-xpath.py`, replace / add:

```python
def test_form_record_params_omit_xpath_smart() -> None:
    form = (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
    # After this task: no params dict literal should stamp xpath_smart into _record_action
    # Allow inventory/task_done xpath_smart= kwargs; forbid params['xpath_smart'] and
    # 'xpath_smart': xp_out inside record payloads.
    assert_true(
        "params['xpath_smart']" not in form and 'params["xpath_smart"]' not in form,
        "no params['xpath_smart'] assignment",
    )
    # Count remaining "'xpath_smart': xp_out" near _record_action — must be 0
    import re
    hits = re.findall(
        r"_record_action\([\s\S]{0,400}?'xpath_smart'\s*:\s*xp_out",
        form,
    )
    assert_true(len(hits) == 0, f"_record_action still stamps xp_out: {len(hits)}")
```

Keep capture-pass and element-related asserts. Retire or rewrite `test_form_resolved_paths_stamp_xpath_smart` / `test_select_option_stamps_xpath_smart` so they no longer require `stamp_recorded_xpath_smart` on the **params** path (stamp may disappear from form). Prefer asserting `_capture_element` still runs and `_record_action` gets `element=`.

- [ ] **Step 2: Run — expect FAIL**

```bash
python scripts/characterization/characterize-capture-element-xpath.py
```

- [ ] **Step 3: Edit `_form.py` record payloads**

For every `_record_action` / `params['xpath_smart'] = …` used for **step params**:

- Remove `'xpath_smart': xp_out` from dict literals.
- Remove `params['xpath_smart'] = xp_out` assignments.
- Keep `xp_out = stamp_recorded_xpath_smart(...)` **only** if still needed for `_task_done_impl(..., xpath_smart=xp_out)` inventory; if so, compute from `element.get('xpath_smart')` or `stamp_recorded_xpath_smart(element, resolved.xpath_smart)` for task_done only — do not put into params.
- Prefer: `xp_inv = (element or {}).get('xpath_smart') or ''` then `_task_done_impl(..., xpath_smart=xp_inv)`.

Do not remove tool arg `xpath_smart: str = ""` or `_resolve_control` / write-via-xpath behavior.

- [ ] **Step 4: Run characterizations**

```bash
python scripts/characterization/characterize-capture-element-xpath.py
python scripts/characterization/characterize-record-params-no-xpath.py
python scripts/characterization/characterize-xpath-primary-ops.py
```

Expected: all OK.

- [ ] **Step 5: Commit**

```bash
git add scripts/controller/actions/_form.py scripts/characterization/characterize-capture-element-xpath.py
git commit -m "fix: form recording omits xpath_smart from params"
```

---

### Task 5: Manual mapper — no params xpath stamp

**Files:**
- Modify: `scripts/manual_recorder/mapper.py`
- Modify: `scripts/characterization/characterize-manual-dialog-scope.py`

**Interfaces:**
- Produces: `map_*` returns `(action, params, element)` where params has no `xpath_smart`; element keeps overlay-scoped smart

- [ ] **Step 1: Update characterization expectations**

Replace asserts like `params.get("xpath_smart") == smart` with:

```python
assert_true("xpath_smart" not in params, f"params must omit xpath_smart: {params}")
assert_true(
    (element or {}).get("xpath_smart") == smart
    or smart in str((element or {}).get("xpath_smart") or ""),
    "element keeps durable/scoped xpath",
)
```

Update module docstring (no longer “params stamp”).

- [ ] **Step 2: Run — expect FAIL**

```bash
python scripts/characterization/characterize-manual-dialog-scope.py
```

- [ ] **Step 3: Remove `_stamp_params` xpath**

In `mapper.py`, delete `_stamp_params` or make it a no-op identity:

```python
def _stamp_params(params: dict) -> dict:
    """Params must not carry xpath_smart; element snap holds the locator."""
    return params
```

Or inline return params without adding `xpath_smart`. Keep building `element['xpath_smart'] = smart`.

- [ ] **Step 4: Run — expect OK**

```bash
python scripts/characterization/characterize-manual-dialog-scope.py
python scripts/characterization/characterize-record-params-no-xpath.py
```

- [ ] **Step 5: Commit**

```bash
git add scripts/manual_recorder/mapper.py scripts/characterization/characterize-manual-dialog-scope.py
git commit -m "fix: manual recorder omits xpath_smart from params"
```

---

### Task 6: Clean unused stamp helper

**Files:**
- Modify: `scripts/controller/actions/_helpers.py`
- Modify: `scripts/characterization/characterize-capture-element-xpath.py` (if stamp tests become dead)

**Interfaces:**
- After Tasks 3–5, `stamp_recorded_xpath_smart` may have zero callers — delete or keep with docstring “unused”.

- [ ] **Step 1: Grep callers**

```bash
rg "stamp_recorded_xpath_smart" scripts/
```

If only characterizations remain, remove helper + tests, or keep minimal unit test of “prefer capture over weak” only if still useful for inventory. Prefer delete if unused.

- [ ] **Step 2: Commit if changed**

```bash
git add scripts/controller/actions/_helpers.py scripts/characterization/characterize-capture-element-xpath.py
git commit -m "chore: remove unused stamp_recorded_xpath_smart for params"
```

---

### Task 7: Verification suite + docs status

**Files:**
- Modify: `docs/superpowers/specs/2026-08-11-stop-params-xpath-smart-design.md` (Status → Approved / Implemented)

- [ ] **Step 1: Run suite**

```bash
python scripts/characterization/characterize-record-params-no-xpath.py
python scripts/characterization/characterize-replay-params-xpath.py
python scripts/characterization/characterize-manual-dialog-scope.py
python scripts/characterization/characterize-capture-element-xpath.py
python scripts/characterization/characterize-xpath-primary-ops.py
python scripts/characterization/characterize-xpath-fill-select.py
```

Expected: all `*: OK`.

Spot-check (no code): `pickExportTarget` in `src/services/legacy-engine-export.js` still reads `el.xpath_smart` only — batch push unaffected.

Also:

```bash
rg "_params_xpath_smart" scripts/
rg "params\.get\(['\"]xpath_smart" scripts/controller scripts/characterization --glob '!**/characterize-*.py'
```

Expected: no locate/readback consumers left (repair may only delete the key).

- [ ] **Step 2: Optional wet**

Replay traj 130 phase 4 step 23 (名称) after executor restart — should fill 名称 without DB repair.

- [ ] **Step 3: Mark spec status**

Set design doc Status to `Implemented` (or `Approved` if only plan landed).

- [ ] **Step 4: Commit docs if changed**

```bash
git add docs/superpowers/specs/2026-08-11-stop-params-xpath-smart-design.md
git commit -m "docs: mark stop-params-xpath-smart design implemented"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| New records omit params.xpath_smart | 3, 4, 5 |
| `_record_action` strip choke-point | 3 |
| Replay element-only locate | 1 |
| **All consumers → element.xpath_smart** | **2** |
| Delete `_params_xpath_smart` | 2 |
| Consumers use element (batch push already) | 2 verify + 7 |
| Keep agent tool arg + inventory | Global / Task 4 note |
| No forced DB wipe; optional strip | 2 (repair) |
| Characterization | 1–5, 7 |
| Manual mapper | 5 |

## Self-review notes

- No TBD placeholders.
- Batch push explicitly verified as element-based (not a code change).
- `_task_done_impl(xpath_smart=)` remains for inventory — not params_json.
- Element-first replay may already be WIP — Task 1 commits it before strip work.
