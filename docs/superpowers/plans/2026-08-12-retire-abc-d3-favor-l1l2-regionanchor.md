# Retire A/B/C + D3; L1/L2 + regionAnchor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make fullpage scan speak only **L2 admission + L1 `region_*` assignment**, delete SOURCE A/B/C as admission gates and D3 `sectionOf`/`attachSection` as product partition, while keeping **`regionAnchor*`** for xpath 消歧 (R0 already landed).

**Architecture:** Extract named `collectL2*` / `discoverL1*` / assign-via-`assignRegion` inside `JS_SCAN_FORM_FIELDS` (fullpage first). Demote A/B/C loops to thin projections, then delete markers. Demote D3 attach to dual-write shim, then delete product judgment. Xpath 消歧 stays in `page-locator-helpers.js` (`regionAnchor*`); do not conflate with L1.

**Tech Stack:** `scan_form.py`, `scan_utils.py`, `form_scan_utils.py`, `page-locator-helpers.js` (+ regen `_locator_helpers_js.py`), characterization under `scripts/characterization/`.

**Spec:** `docs/superpowers/specs/2026-08-12-retire-abc-d3-favor-l1l2-regionanchor-design.md`

## Global Constraints

- Algorithm **B**: L2 admission = visible ∧ taxonomy ∧ operable; **never** require `.el-form-item` / `.el-table` / SOURCE_* to exist for admission.
- **`regionAnchor*`** = xpath 消歧 only (comments already say so). Not product「分块」. Do not remove capability.
- Agent tool arg `section=` alias removal is **out of scope** here (see `docs/superpowers/plans/2026-08-12-retire-section-favor-region.md` Phase E). Keep dual-read until that plan’s Phase E.
- Do not rename CDP enum `region_role: "section"` in this plan (optional follow-up → `block`).
- TDD: characterization fail → implement → green. Prefer Playwright fixture chars for P0 todo acceptance where possible.
- Pure `scripts/` changes: CHANGELOG optional. If `src/cdp/` behavior changes beyond comments/aliases, append `CHANGELOG.md` `[Unreleased]` with Python sync hint when control-plane-facing.
- **Commit only when the user explicitly asks** (skip Task commit steps otherwise).

## File map

| File | Role |
|------|------|
| `src/cdp/page-locator-helpers.js` | `regionAnchor*`, `assignRegion`, todo taxonomy (R0 done; R4 drop aliases) |
| `scripts/_gen_locator_helpers_py.mjs` | Regen Python mirror after helpers edits |
| `scripts/controller/actions/js_snippets/_locator_helpers_js.py` | Generated; never hand-edit |
| `scripts/controller/actions/js_snippets/scan_form.py` | `JS_SCAN_FORM_FIELDS`: L2/L1/assign; retire SOURCE_* |
| `scripts/controller/actions/js_snippets/scan_utils.py` | `JS_SECTION_ATTACH_BLOCK`: D3 `sectionOf`/`attachSection` demote→delete |
| `scripts/controller/actions/form_scan_utils.py` | Summary prefers `region_label`; stop teaching SOURCE |
| `scripts/controller/actions/_form.py` | `scan_editable_summary` stays `mode:'fullpage'` |
| `scripts/characterization/characterize-section-anchored-xpath.py` | regionAnchor + xpath 消歧 |
| `scripts/characterization/characterize-todo-item-action.py` | P0 待办「处理」admission + region |
| `scripts/characterization/characterize-scan-editable-summary.py` | L2/L1 markers + collectL2 cues |
| `scripts/characterization/characterize-form-scan-control-first.py` | SOURCE_B → retire assertions in R2 |
| `scripts/characterization/characterize-control-ops-closed-loop.py` | SOURCE_C / sectionOf → update in R2/R3 |
| `scripts/characterization/characterize-scan-assign-region-once.py` | Exactly one `assignRegion` decl |

## How we 改造 (current → target)

| Today | Target |
|-------|--------|
| SOURCE A/B/C sequential gates + fullpage extras | Named **`collectL2*`** taxonomy walks; A/B/C gone |
| `attachSection`/`sectionOf` product partition | **`assignRegion(el)`** stamps `region_*`; D3 gone from scan |
| `ASSIGN_L2_TO_L1` projects from `section_title` | Assign at collect time from `assignRegion` |
| `sectionAnchor*` aliases | Removed in R4 after chars retargeted (R0 already renamed) |

```text
fullpage:
  collectL2(document) → fields + buttons (incl. .todo-item-action)
  discoverL1(document) → regions[] feature cards (incl. .todo-item)
  for each control: Object.assign(ctrl, assignRegion(el))  // L1
  return { fields, buttons, regions, scope: 'fullpage' }

xpath export (unchanged capability):
  regionAnchorXPath(host, leaf)  // xpath 消歧
```

---

### Task 0: Verify R0 (regionAnchor rename) — already landed

**Files:**
- Verify: `src/cdp/page-locator-helpers.js`
- Verify: `scripts/controller/actions/js_snippets/_locator_helpers_js.py`
- Test: `scripts/characterization/characterize-section-anchored-xpath.py`

**Interfaces:**
- Consumes: N/A (verification only)
- Produces: Confirmation that `regionAnchorOf` / `regionAnchorXPath` exist with **xpath 消歧** comments; `sectionAnchor*` are deprecated aliases only

- [ ] **Step 1: Run characterization**

```powershell
$env:PYTHONPATH="."
node --input-type=module -e "import { PAGE_LOCATOR_HELPERS } from './src/cdp/locator-candidates.js'; new Function(PAGE_LOCATOR_HELPERS); console.log('parse OK');"
python scripts/characterization/characterize-section-anchored-xpath.py
python scripts/characterization/characterize-dual-save-section.py
```

Expected: `parse OK`; both characterize scripts print `OK`.

- [ ] **Step 2: Spot-check comments**

```powershell
rg -n "xpath 消歧|regionAnchorOf|function sectionAnchor" src/cdp/page-locator-helpers.js
```

Expected: comments on `regionAnchor*`; `sectionAnchor*` only as `@deprecated` wrappers.

- [ ] **Step 3: Mark R0 complete in spec**

In `docs/superpowers/specs/2026-08-12-retire-abc-d3-favor-l1l2-regionanchor-design.md`, set Status to `Approved` and tick R0 exit in Success criteria / Phased table if unchecked.

---

### Task 1: Characterization — L2-first + todo P0 acceptance cues (R1 gate)

**Files:**
- Modify: `scripts/characterization/characterize-scan-editable-summary.py`
- Modify: `scripts/characterization/characterize-todo-item-action.py`
- Create: `scripts/characterization/characterize-l2-todo-region.py` (Playwright fixture — P0 wet-like)

**Interfaces:**
- Consumes: `JS_SCAN_FORM_FIELDS` string + Playwright DOM
- Produces: Failing asserts until Task 2–3 land

- [ ] **Step 1: Extend scan-editable-summary for named L2/L1 functions**

Append to `characterize-scan-editable-summary.py`:

```python
def test_collect_l2_named() -> None:
    scan = SCAN_FORM_PY.read_text(encoding="utf-8")
    assert_true(
        "function collectL2" in scan or "const collectL2" in scan or "collectL2(" in scan,
        "fullpage must expose named collectL2 (not only SOURCE_* loops)",
    )
    assert_true(
        "COLLECT_L2" in scan,
        "COLLECT_L2 marker for characterization",
    )
    assert_true(
        "function discoverL1" in scan or "const discoverL1" in scan or "discoverL1(" in scan,
        "fullpage must expose named discoverL1",
    )
    assert_true(
        "ASSIGN_VIA_ASSIGN_REGION" in scan or "assignRegion(el)" in scan,
        "L2→L1 must call assignRegion(el), not only section_title projection",
    )
```

Wire `test_collect_l2_named` into `main()`.

- [ ] **Step 2: Retarget todo char — admission must not require SOURCE_C forever**

In `characterize-todo-item-action.py`, change `test_scan_admits_todo_item_action_buttons` to:

```python
def test_scan_admits_todo_item_action_buttons() -> None:
    """Auto-grab / scan_editable_summary must inventory 处理 as a button via L2."""
    scan = (ROOT / "scripts/controller/actions/js_snippets/scan_form.py").read_text(
        encoding="utf-8"
    )
    assert_true(".todo-item-action" in scan, "scan must mention .todo-item-action")
    # Prefer L2 collector; SOURCE_C may still exist until R2
    l2_ok = "collectL2" in scan and ".todo-item-action" in scan
    src_c_ok = "SCAN_SOURCE_C_BUTTONS" in scan and ".todo-item-action" in scan.split(
        "SCAN_SOURCE_C_BUTTONS", 1
    )[-1][:800]
    assert_true(l2_ok or src_c_ok, "L2 or interim SOURCE_C must admit .todo-item-action")
```

Add (still allow D3 until R3):

```python
def test_assign_region_knows_todo_item() -> None:
    helpers = (ROOT / "src/cdp/page-locator-helpers.js").read_text(encoding="utf-8")
    body = helpers.split("function assignRegion", 1)[1][:2500]
    assert_true(".todo-item" in body, "assignRegion must partition .todo-item cards")
    assert_true("PJ" in body or "DGSX" in body, "todo region title prefers business key")
```

- [ ] **Step 3: Create Playwright fixture char for P0 acceptance**

Create `scripts/characterization/characterize-l2-todo-region.py`:

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""P0: 待办「处理」enters L2 buttons with card region_label (PJ…), not main."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from playwright.sync_api import sync_playwright  # noqa: E402
from scripts.controller.actions._js_snippets import JS_SCAN_FORM_FIELDS  # noqa: E402


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


HTML = """<!DOCTYPE html><html><body>
<div class="el-main">
  <div class="todo-item">
    <div class="todo-item__header">
      <span>PJ20260807012042 对公客户评级</span>
      <div class="todo-item-actions">
        <div class="todo-item-action" style="cursor:pointer">处理</div>
      </div>
    </div>
  </div>
  <div class="todo-item">
    <div class="todo-item__header">
      <span>PJ99999999999999 另一笔</span>
      <div class="todo-item-actions">
        <div class="todo-item-action" style="cursor:pointer">处理</div>
      </div>
    </div>
  </div>
</div>
</body></html>"""


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.set_content(HTML)
        raw = page.evaluate(
            JS_SCAN_FORM_FIELDS,
            [True, ["处理", "保存"], {"mode": "fullpage"}],
        )
        browser.close()

    data = raw if isinstance(raw, dict) else json.loads(raw)
    buttons = data.get("buttons") or []
    hits = [b for b in buttons if (b.get("label") or "") == "处理"]
    assert_true(len(hits) >= 2, f"expected ≥2 处理 buttons, got {buttons!r}")
    for b in hits:
        label = b.get("region_label") or ""
        assert_true(
            label.startswith("PJ"),
            f"处理 must have card region_label PJ…, got {b!r}",
        )
        assert_true(
            label != "主区" and (b.get("region_role") or "") != "main",
            f"处理 must not dump into main, got {b!r}",
        )
    print("characterize-l2-todo-region: OK")
    print(json.dumps({"buttons": hits}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run — expect FAIL on new L2-named + fixture**

```powershell
$env:PYTHONPATH="."
python scripts/characterization/characterize-scan-editable-summary.py
python scripts/characterization/characterize-l2-todo-region.py
```

Expected: FAIL on `collectL2` / region_label until Task 2–3.

---

### Task 2: Extract `collectL2` + `discoverL1` (fullpage) — A/B/C become projections (R1)

**Files:**
- Modify: `scripts/controller/actions/js_snippets/scan_form.py` (inside `JS_SCAN_FORM_FIELDS`)
- Test: Task 1 characterizations + existing fullpage chars

**Interfaces:**
- Consumes: `isVisible`, `xpathSmartOf`, `attachSection` (still), `assignRegion` / `regionLabelOf` from `PAGE_LOCATOR_HELPERS`
- Produces:
  - `collectL2(root, { quick, buttonKeywords }) -> { fieldsPartial, buttons, selectFields }` (or equivalent named helpers)
  - `discoverL1(document) -> regions[]`
  - Marker comments: `/* COLLECT_L2 */`, `/* DISCOVER_L1 */`

- [ ] **Step 1: Add `collectL2Buttons` used by fullpage (and optionally by SOURCE_C)**

Near the top of the scan IIFE (after helpers / before scanRoots loops), add:

```javascript
    /* COLLECT_L2 — taxonomy button pool; NO form-item/table gate */
    function collectL2Buttons(root, quick) {
      const out = [];
      const seen = new Set();
      const sels = 'button, .el-button, .todo-item-action';
      for (const el of (root || document).querySelectorAll(sels)) {
        if (quick && !isVisible(el)) continue;
        if (el.disabled || (el.classList && el.classList.contains('is-disabled'))) continue;
        const label = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!label || label.length > 40) continue;
        const xpath_smart = xpathSmartOf(el, label, '', 'button') || '';
        const reg = (typeof assignRegion === 'function') ? assignRegion(el) : null;
        const key = xpath_smart || ((reg && reg.region_id) || '') + '|' + label;
        if (seen.has(key)) continue;
        seen.add(key);
        const row = {
          label,
          xpath_smart,
          disabled: false,
          region_role: reg ? reg.region_role : '',
          region_id: reg ? reg.region_id : '',
          region_label: reg ? reg.region_label : '',
          section_id: '__root__',
          section_title: '',
        };
        // Interim D3 dual-write until R3 (attachSection may overwrite section_* / region_*)
        if (typeof attachSection === 'function') attachSection(row, el);
        // Prefer assignRegion for region_* (algorithm B / L1)
        if (reg) {
          row.region_role = reg.region_role;
          row.region_id = reg.region_id;
          row.region_label = reg.region_label;
        }
        out.push(row);
      }
      return out;
    }
```

**Escape note:** `scan_form.py` embeds JS in a Python string. Match neighboring escape style (`\\s`, etc.) — do **not** copy the template-literal double-escape rules from `page-locator-helpers.js` blindly; follow existing `scan_form.py` patterns in SOURCE_C.

- [ ] **Step 2: Wire fullpage to merge `collectL2Buttons(document)`**

After the scanRoots loop (or replace SOURCE_C body when `isFullpage`):

```javascript
    /* COLLECT_L2 call site */
    if (isFullpage) {
      for (const b of collectL2Buttons(document, quick)) {
        const key = b.xpath_smart || ((b.region_id || '') + '|' + b.label);
        if (btnSeen.has(key)) continue;
        btnSeen.add(key);
        buttons.push(b);
      }
    }
```

Keep non-fullpage SOURCE_C loop for now (calls same helper or duplicates query) so `multi`/default do not regress.

- [ ] **Step 3: Extract `discoverL1` from inline `candSels`**

Wrap the existing fullpage `candSels` block:

```javascript
    /* DISCOVER_L1 — feature cards; seed selectors OK for P0 */
    function discoverL1() {
      const regions = [];
      const candSels = [ /* existing list including .todo-item */ ];
      // ... existing loop body that pushes L1_FEATURE_CARD ...
      return regions;
    }
```

Call: `const regions = isFullpage ? discoverL1() : [];`

- [ ] **Step 4: Stamp fields with `assignRegion` when host element is known**

Wherever `attachSection(field, el)` runs in fullpage path, also:

```javascript
    /* ASSIGN_VIA_ASSIGN_REGION */
    if (isFullpage && typeof assignRegion === 'function') {
      const reg = assignRegion(el);
      field.region_role = reg.region_role;
      field.region_id = reg.region_id;
      field.region_label = reg.region_label;
    }
```

For the post-pass `ASSIGN_L2_TO_L1` button loop: **skip overwrite** when `b.region_label` already set; only fill gaps. Prefer deleting the `section_title ? … : main` overwrite for buttons that came from `collectL2Buttons`.

- [ ] **Step 5: Run chars**

```powershell
$env:PYTHONPATH="."
python scripts/characterization/characterize-scan-assign-region-once.py
python scripts/characterization/characterize-scan-editable-summary.py
python scripts/characterization/characterize-todo-item-action.py
python scripts/characterization/characterize-l2-todo-region.py
python scripts/characterization/characterize-scan-fullpage-p1.py
python scripts/characterization/characterize-scan-fullpage-p2.py
```

Expected: all OK. If fixture fails on `region_label`, fix `assignRegion` todo title vs `attachSection` order (Step 1 already re-applies `assignRegion` after attach).

---

### Task 3: Delete SOURCE A/B/C markers & branch names (R2)

**Files:**
- Modify: `scripts/controller/actions/js_snippets/scan_form.py`
- Modify: `scripts/characterization/characterize-form-scan-control-first.py`
- Modify: `scripts/characterization/characterize-control-ops-closed-loop.py`
- Modify: `scripts/characterization/characterize-todo-item-action.py` (drop SOURCE_C preference)

**Interfaces:**
- Consumes: `collectL2*` / existing form+table collectors refactored as L2 kind walks
- Produces: Grep `SCAN_SOURCE_[ABC]` → 0 in live `scan_form.py`; docs/comments say L2 only

- [ ] **Step 1: Update characterizations first (expect FAIL)**

In `characterize-form-scan-control-first.py`, replace asserts that **require** `SCAN_SOURCE_B_EL_TABLE` with L2 table cues, e.g. `COLLECT_L2_TABLE` or `collectL2Table` / `kind` parity markers you introduce when renaming the table loop.

In `characterize-control-ops-closed-loop.py`, stop requiring `SCAN_SOURCE_C_BUTTONS`.

In `characterize-todo-item-action.py`, require `collectL2` path only:

```python
assert_true("collectL2" in scan and ".todo-item-action" in scan, "L2 admits todo-item-action")
```

- [ ] **Step 2: Rename/restructure loops in `scan_form.py`**

- Delete comment markers `SCAN_SOURCE_B_EL_TABLE`, `SCAN_SOURCE_C_BUTTONS`, `SOURCE_B_*` (or replace with `COLLECT_L2_TABLE` / `COLLECT_L2_FORM` if chars need a stable cue).
- Ensure form-item / table / button collection are clearly under `/* COLLECT_L2 */` narrative.
- Non-fullpage modes may still call the same collectors with a narrower root — **no separate SOURCE_* vocabulary**.

- [ ] **Step 3: Verify grep**

```powershell
rg -n "SCAN_SOURCE_[ABC]|SOURCE_B_" scripts/controller/actions/js_snippets/scan_form.py
```

Expected: no matches (or only inside a deleted-history comment block — prefer zero).

- [ ] **Step 4: Re-run related chars**

```powershell
$env:PYTHONPATH="."
python scripts/characterization/characterize-form-scan-control-first.py
python scripts/characterization/characterize-control-ops-closed-loop.py
python scripts/characterization/characterize-todo-item-action.py
python scripts/characterization/characterize-l2-todo-region.py
python scripts/characterization/characterize-scan-editable-summary.py
```

---

### Task 4: Delete D3 product partition from scan path (R3)

**Files:**
- Modify: `scripts/controller/actions/js_snippets/scan_utils.py` (`JS_SECTION_ATTACH_BLOCK`)
- Modify: `scripts/controller/actions/js_snippets/scan_form.py` (stop calling `attachSection` for partition)
- Modify: `scripts/controller/actions/form_scan_utils.py` (prefer `region_*` only in new summary paths)
- Modify: `scripts/characterization/characterize-todo-item-action.py` (`test_section_attach_partitions_todo_item` → assignRegion)
- Modify: `scripts/characterization/characterize-control-ops-closed-loop.py` if it asserts `sectionOf` as product partition
- Note: `save.py` / `click_save` may still embed `JS_SECTION_ATTACH_BLOCK` for scope — migrate those call sites to `region_label` / `assignRegion` **or** keep a thin compat shim that only fills `region_*` and leaves `section_*` empty/`__root__` until favor-region Phase E

**Interfaces:**
- Consumes: `assignRegion(el)` from helpers
- Produces: Scan fields/buttons carry `region_role` / `region_id` / `region_label` without requiring `section_title` for bucketing

- [ ] **Step 1: Characterization — partition via assignRegion**

Replace `test_section_attach_partitions_todo_item` with:

```python
def test_l1_partitions_todo_item_via_assign_region() -> None:
    helpers = (ROOT / "src/cdp/page-locator-helpers.js").read_text(encoding="utf-8")
    assert_true("function assignRegion" in helpers, "assignRegion exists")
    body = helpers.split("function assignRegion", 1)[1][:3000]
    assert_true(".todo-item" in body, "assignRegion knows .todo-item")
    scan = (ROOT / "scripts/controller/actions/js_snippets/scan_form.py").read_text(
        encoding="utf-8"
    )
    assert_true("assignRegion(" in scan, "scan stamps regions via assignRegion")
```

- [ ] **Step 2: Stop using `attachSection` in `scan_form.py` fullpage (then all modes)**

Remove `attachSection(field, el)` / `attachSection(btnSec, el)` calls from scan. Ensure every push stamps:

```javascript
const reg = assignRegion(el);
field.region_role = reg.region_role;
field.region_id = reg.region_id;
field.region_label = reg.region_label;
// Compat until favor-region Phase E / TaskItem cleanup:
field.section_id = reg.region_id || '__root__';
field.section_title = reg.region_label || '';
```

Keep `section_id`/`section_title` **as mirrors of region** only if `form_scan_utils` / agent still dual-read — document as LEGACY mirror, not D3 judgment.

- [ ] **Step 3: Slim `JS_SECTION_ATTACH_BLOCK`**

Either:
- **(A)** Delete `sectionOf`/`attachSection` from the block and leave only helpers still needed by `click_save`, or
- **(B)** Make `attachSection` a no-op wrapper around `assignRegion` + region→section mirror

Prefer **(B)** for one task if `save.py` still injects the block; delete dead D3 collapse/tab/card title logic only when save path is migrated.

- [ ] **Step 4: Run chars + dual-save**

```powershell
$env:PYTHONPATH="."
python scripts/characterization/characterize-todo-item-action.py
python scripts/characterization/characterize-l2-todo-region.py
python scripts/characterization/characterize-dual-save-section.py
python scripts/characterization/characterize-region-section-alias.py
python scripts/characterization/characterize-phase-section-scope.py
python scripts/characterization/characterize-section-anchored-xpath.py
```

Expected: OK. Dual-save must still work via `region_label` / mirrored `section_title`.

---

### Task 5: Drop `sectionAnchor*` aliases + docs fold (R4)

**Files:**
- Modify: `src/cdp/page-locator-helpers.js` — delete `sectionAnchorOf` / `sectionAnchorXPath`
- Run: `node scripts/_gen_locator_helpers_py.mjs`
- Modify: `scripts/characterization/characterize-section-anchored-xpath.py` — assert aliases **absent**
- Modify: `docs/superpowers/specs/2026-08-12-retire-abc-d3-favor-l1l2-regionanchor-design.md` — tick success criteria
- Optional: rename characterize file to `characterize-region-anchored-xpath.py` and update any docs references

**Interfaces:**
- Consumes: `regionAnchorOf` / `regionAnchorXPath` only
- Produces: Grep `sectionAnchor` → 0 in helpers + generated mirror

- [ ] **Step 1: Fail char if aliases still present**

```python
assert_true("function sectionAnchorOf" not in helpers, "sectionAnchorOf alias removed")
assert_true("function sectionAnchorXPath" not in helpers, "sectionAnchorXPath alias removed")
```

- [ ] **Step 2: Delete alias functions; regen**

```powershell
node scripts/_gen_locator_helpers_py.mjs
python scripts/characterization/characterize-locator-helpers-generated.py
python scripts/characterization/characterize-section-anchored-xpath.py
```

- [ ] **Step 3: Doc pass**

Update design Success criteria checkboxes. Add a one-line pointer in `docs/superpowers/todo-list.md` if this epic is tracked there. Do **not** write separate product API markdown.

---

### Task 6: Wet verification (optional but recommended)

**Files:** none (manual / CDP session)

- [ ] **Step 1:** Attach browser on 待办 list; run agent/tool `scan_editable_summary`.
- [ ] **Step 2:** Confirm JSON `buttons` contains `{ label: "处理", region_label: "PJ…" }` (or equivalent business key).
- [ ] **Step 3:** Manual record click「处理」→ step persists; replay clicks real navigation (regression from earlier recorder/replay fixes — should already be green via `characterize-todo-item-action.py`).

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| R0 regionAnchor rename + xpath 消歧 comments | Task 0 (done in tree; verify) |
| R1 collectL2 + assign; A/B/C projections; P0 处理 | Tasks 1–2 |
| R2 delete SOURCE A/B/C markers | Task 3 |
| R3 delete D3 product judgment; region_* only | Task 4 |
| R4 remove aliases; docs | Task 5 |
| L1 miss keeps control in L2 | Task 2 assign; orphans → `other`/`main` via `assignRegion`, still in buttons/fields |
| Dual-save xpath 消歧 kept | Task 0 + Task 5 (do not delete `regionAnchor*`) |
| `section=` tool alias out of scope | Global Constraints + Task 4 mirror only |

**Placeholder scan:** none intentional.  
**Type consistency:** `assignRegion(el) -> { region_role, region_id, region_label }`; `collectL2Buttons` rows carry those keys; `discoverL1() -> regions[]` feature cards.

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-08-12-retire-abc-d3-favor-l1l2-regionanchor.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — run tasks in this session with executing-plans checkpoints  

Which approach?
