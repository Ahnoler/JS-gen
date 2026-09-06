# Unify Partition & Locator Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One admission + partition + snap kernel for manual record, auto-grab / resolve-element, and AI scan — so「处理」is never inventoriable in one path and invisible in another, and multi-hit AG lists show card-level `region_label` humans can pick.

**Architecture:** U1 extracts `normalizeHost` + `classifyOperable` in `PAGE_LOCATOR_HELPERS` and wires inventory / L2 / snap to them; guarantees distinct todo `region_label` on resolve matches and documents SPA grouping by label (not `region_role`). U2 makes `collectL2`-equivalent the sole page collector; inventory becomes a projection (`kindsForAction` + text filter).

**Tech Stack:** `src/cdp/page-locator-helpers.js`, `scripts/_gen_locator_helpers_py.mjs`, `_locator_helpers_js.py`, `resolve-by-label.js`, `scan_form.py`, characterization under `scripts/characterization/`, api-docs recording group.

**Spec:** `docs/superpowers/specs/2026-08-12-unify-partition-locator-architecture-design.md`

## Global Constraints

- Algorithm **B**: L1 failure must not drop L2 / matches; `kindsForAction` only shrinks projections.
- Replay stays **xpath_smart-first**; this plan unifies host/kind/region, not replay priority.
- Do **not** hard-delete `section=` (favor-region Phase E) or rename CDP `region_role: "section"` enum in this plan.
- Product SPA is **external**; JS-gen owns API payload + docs. If UI still groups by `region_role` (“section”), fix contract fields here and CHANGELOG Python/SPA sync hint — do not assume SPA repo access.
- TDD: characterization fail → implement → green. Regen helpers after every `page-locator-helpers.js` edit: `node scripts/_gen_locator_helpers_py.mjs`.
- `src/cdp/` behavior changes → append `CHANGELOG.md` `[Unreleased]` with Python sync hint.
- **Commit only when the user explicitly asks** (skip commit steps otherwise).

## File map

| File | Role |
|------|------|
| `src/cdp/page-locator-helpers.js` | Canonical `normalizeHost`, `classifyOperable`, `assignRegion`, `collectInventoryHosts` / future `collectL2Hosts` |
| `scripts/_gen_locator_helpers_py.mjs` | Regen Python mirror |
| `scripts/controller/actions/js_snippets/_locator_helpers_js.py` | Generated — never hand-edit |
| `src/cdp/resolve-by-label.js` | Inventory / needle; ambiguity `preview` + match grouping fields |
| `scripts/controller/actions/js_snippets/scan_form.py` | `collectL2Buttons` must call shared classify (not ad-hoc admit) |
| `src/dashboard/api-docs/groups/recording.js` | Document: group/display by `region_label` / `display_group` |
| `scripts/characterization/characterize-todo-item-action.py` | Extend: shared classify + multi-todo distinct labels |
| `scripts/characterization/characterize-unify-partition-locator.py` | New cross-path contract char (optional if folded into todo char — prefer **new** file for U1/U2 clarity) |
| `CHANGELOG.md` | Unreleased entries for resolve / helpers |

## How we 改造 (current → target)

| Today | Target |
|-------|--------|
| `normalizeTargetRoot` + separate `inventoryKindOf` ladders | `normalizeHost` + `classifyOperable`; old names thin aliases |
| Inventory CSS list ∥ `collectL2Buttons` CSS list | U1: same classify; U2: one `collectL2Hosts` (or alias) |
| AG UI groups under `region_role` “section” | Payload guarantees distinct `region_label`; `display_group` = label for SPA |
| Todo `assignRegion` may already extract PJ/DGSX | Char + wet prove labels on **inventory matches**; fix if empty/collision |

```text
U1:  node → normalizeHost → classifyOperable → assignRegion → buildLocatorSnap
U2:  page → collectL2Hosts → (same) → project(inventory | scan)
```

---

### Task 0: Baseline green

**Files:**
- Verify: existing chars only
- Test: `scripts/characterization/characterize-todo-item-action.py`

**Interfaces:**
- Consumes: N/A
- Produces: Confirmed baseline before U1 renames

- [ ] **Step 1: Run baseline**

```powershell
cd d:\dev\JS-gen
$env:PYTHONPATH = "."
node --input-type=module -e "import { PAGE_LOCATOR_HELPERS } from './src/cdp/locator-candidates.js'; new Function(PAGE_LOCATOR_HELPERS); console.log('parse OK');"
python scripts/characterization/characterize-todo-item-action.py
```

Expected: `parse OK` and `characterize-todo-item-action: OK`

- [ ] **Step 2: Note any red** — fix only unrelated breakage that blocks this plan; do not start U1 until baseline is green.

---

### Task 1: Failing char — shared `normalizeHost` + `classifyOperable`

**Files:**
- Create: `scripts/characterization/characterize-unify-partition-locator.py`
- Test: same

**Interfaces:**
- Consumes: `PAGE_LOCATOR_HELPERS` string from `src/cdp/page-locator-helpers.js` (and generated py after later tasks)
- Produces: Assertions that named functions exist and inventory/L2/snap share todo≻checkbox order via classify

- [ ] **Step 1: Write the failing characterization**

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""U1/U2: unified partition/locator kernel contracts."""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def helpers_src() -> str:
    return (ROOT / "src/cdp/page-locator-helpers.js").read_text(encoding="utf-8")


def test_normalize_host_and_classify_operable_exist() -> None:
    h = helpers_src()
    assert_true("function normalizeHost" in h, "normalizeHost must exist")
    assert_true("function classifyOperable" in h, "classifyOperable must exist")


def test_inventory_kind_delegates_to_classify() -> None:
    h = helpers_src()
    body = h.split("function inventoryKindOf", 1)[1].split("function inventoryPickControl", 1)[0]
    assert_true(
        "classifyOperable" in body,
        "inventoryKindOf must call classifyOperable (no parallel kind ladder)",
    )


def test_normalize_target_root_aliases_or_calls_normalize_host() -> None:
    h = helpers_src()
    # Either normalizeTargetRoot body calls normalizeHost, or normalizeHost wraps normalizeTargetRoot once.
    assert_true(
        "function normalizeHost" in h and "normalizeTargetRoot" in h,
        "both normalizeHost and normalizeTargetRoot present",
    )
    # Prefer: normalizeHost is the documented entry; TargetRoot delegates or is alias.
    host_i = h.find("function normalizeHost")
    # After U1, snap/inventory comments should mention normalizeHost
    assert_true(host_i != -1, "normalizeHost declared")


def main() -> int:
    test_normalize_host_and_classify_operable_exist()
    test_inventory_kind_delegates_to_classify()
    test_normalize_target_root_aliases_or_calls_normalize_host()
    print("characterize-unify-partition-locator: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run — expect FAIL**

```powershell
$env:PYTHONPATH = "."
python scripts/characterization/characterize-unify-partition-locator.py
```

Expected: `AssertionError: normalizeHost must exist` (or classifyOperable)

---

### Task 2: Implement U1 kernel (`normalizeHost` + `classifyOperable`)

**Files:**
- Modify: `src/cdp/page-locator-helpers.js` (near `normalizeTargetRoot` / `inventoryKindOf`)
- Regen: `scripts/controller/actions/js_snippets/_locator_helpers_js.py` via gen script
- Test: `scripts/characterization/characterize-unify-partition-locator.py`, `characterize-todo-item-action.py`

**Interfaces:**
- Consumes: existing `normalizeTargetRoot`, `detectTargetKind`
- Produces:
  - `normalizeHost(node) -> Element|null` — same behavior as today’s `normalizeTargetRoot` (todo-action before checkbox-group)
  - `classifyOperable(el) -> string` — inventory kind or `''` if not admitted; **must** check `.todo-item-action` before `.el-checkbox-group`
  - `inventoryKindOf(el)` → `return classifyOperable(el);` (or equivalent one-liner)
  - Keep `normalizeTargetRoot` as alias calling `normalizeHost` **or** implement logic once in `normalizeHost` and `function normalizeTargetRoot(n){ return normalizeHost(n); }`

- [ ] **Step 1: Add `classifyOperable` and thin `inventoryKindOf`**

In `page-locator-helpers.js`, replace the body of `inventoryKindOf` with a shared classifier:

```javascript
    function classifyOperable(el) {
      if (!el) return '';
      // Todo card actions before form checkbox — portal 待办 wraps cards in el-checkbox-group.
      if (el.closest && el.closest('.todo-item-action')) return 'button';
      if (el.closest && el.closest('.el-checkbox-group, .el-checkbox')) return 'form_checkbox';
      const k = detectTargetKind(el);
      if (k === 'form_input' || k === 'form_select' || k === 'form_date' || k === 'form_radio'
        || k === 'form_checkbox' || k === 'form_tree_select') return k;
      if (k === 'menu' || k === 'submenu') return 'menu';
      if (k === 'icon') return 'icon';
      if (k === 'button' || k === 'adjacent_button' || k === 'link' || k === 'table_row_button'
        || k === 'tab' || k === 'generic') return 'button';
      return '';
    }
    function inventoryKindOf(el) {
      return classifyOperable(el);
    }
```

(If `inventoryKindOf` already has the todo-action early return, move that logic into `classifyOperable` and leave no duplicate ladder.)

- [ ] **Step 2: Add `normalizeHost`**

Immediately before or after `normalizeTargetRoot`:

```javascript
  function normalizeHost(node) {
    return normalizeTargetRoot(node);
  }
```

**Preferred shape (single implementation):** rename the current function body to `normalizeHost`, then:

```javascript
  function normalizeTargetRoot(node) {
    return normalizeHost(node);
  }
```

Do **not** duplicate the todo≻checkbox logic in two bodies.

- [ ] **Step 3: Regen + green**

```powershell
node scripts/_gen_locator_helpers_py.mjs
$env:PYTHONPATH = "."
python scripts/characterization/characterize-unify-partition-locator.py
python scripts/characterization/characterize-todo-item-action.py
```

Expected: both OK

- [ ] **Step 4: Commit** (only if user asks)

```bash
git add src/cdp/page-locator-helpers.js scripts/controller/actions/js_snippets/_locator_helpers_js.py scripts/characterization/characterize-unify-partition-locator.py
git commit -m "feat: unify normalizeHost + classifyOperable for L2 admit"
```

---

### Task 3: Failing char — multi-todo inventory distinct `region_label`

**Files:**
- Modify: `scripts/characterization/characterize-unify-partition-locator.py`
- Test: same (Playwright fixture)

**Interfaces:**
- Consumes: `PAGE_LOCATOR_HELPERS`, `collectInventoryHosts`, `assignRegion`, `kindsForAction`, `buildLocatorSnap` (via evaluate)
- Produces: Runtime proof that two「处理」get two different readable `region_label`s

- [ ] **Step 1: Add runtime test to the unify char**

```python
def test_multi_todo_inventory_region_labels_distinct() -> None:
    from playwright.sync_api import sync_playwright
    from scripts.controller.actions.js_snippets._locator_helpers_js import (
        PAGE_LOCATOR_HELPERS,
    )

    html = """<!DOCTYPE html><html><body>
<div class="el-checkbox-group" aria-label="checkbox-group">
  <div class="todo-item"><div class="todo-item__header">【对公】DGSX20260812056002
    <div class="todo-item-actions"><div class="todo-item-action">处理</div></div>
  </div></div>
  <div class="todo-item"><div class="todo-item__header">评级 PJ20260807012042
    <div class="todo-item-actions"><div class="todo-item-action">处理</div></div>
  </div></div>
</div>
</body></html>"""

    js = (
        "() => {\n"
        + PAGE_LOCATOR_HELPERS
        + """
  const inv = filterInventoryByKind(collectInventoryHosts(), 'click_element_by_index');
  const hits = inv.filter(function (h) { return h.text === '处理'; });
  return hits.map(function (h) {
    const root = normalizeHost(h.el) || h.el;
    const reg = assignRegion(root);
    const loc = buildLocatorSnap(root, h.text, absXPath(root), '', {
      targetKind: h.kind,
      region: reg,
    });
    return {
      kind: h.kind,
      region_label: loc.region_label || reg.region_label || '',
      region_role: loc.region_role || reg.region_role || '',
    };
  });
}
"""
    )

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.set_content(html)
        rows = page.evaluate(js)
        browser.close()

    assert_true(isinstance(rows, list) and len(rows) >= 2, f"need ≥2 处理 hits, got {rows!r}")
    for r in rows:
        assert_true(r.get("kind") == "button", f"kind button required, got {r!r}")
        assert_true(r.get("region_role") != "main", f"must not dump to main, got {r!r}")
    labels = [str(r.get("region_label") or "") for r in rows]
    assert_true(all(labels), f"region_label must be non-empty, got {rows!r}")
    assert_true(
        len(set(labels)) == len(labels),
        f"region_label must be pairwise distinct, got {labels!r}",
    )
    blob = " ".join(labels)
    assert_true(
        ("DGSX20260812056002" in blob) and ("PJ20260807012042" in blob),
        f"labels must carry business keys, got {labels!r}",
    )
```

Wire it into `main()` before the final print.

- [ ] **Step 2: Run — expect FAIL or PASS**

```powershell
$env:PYTHONPATH = "."
python scripts/characterization/characterize-unify-partition-locator.py
```

- If **PASS**: `assignRegion` already good — keep the test as regression; Task 4 becomes API/`display_group` + docs only.  
- If **FAIL**: proceed to Task 4 to fix label extraction / snap wiring.

---

### Task 4: Readable AG partition — labels + API contract

**Files:**
- Modify (only if Task 3 red): `src/cdp/page-locator-helpers.js` (`assignRegion` todo branch)
- Modify: `src/cdp/resolve-by-label.js` (`toPreview` / `enrichOne`)
- Modify: `src/dashboard/api-docs/groups/recording.js`
- Modify: `CHANGELOG.md`
- Regen helpers if JS helpers changed
- Test: unify char + optional small node assert on `toPreview` fields via reading source

**Interfaces:**
- Consumes: `assignRegion` → `{ region_role, region_id, region_label }`
- Produces: Each ambiguous match exposes:
  - `preview.region_label` / `element.region_label` (existing)
  - **`preview.display_group`** and **`element.display_group`** = non-empty `region_label` (fallback: short `xpath_smart` slice, never bare `region_role` like `"section"`)

- [ ] **Step 1: If labels empty/collision — fix todo `assignRegion`**

Ensure business-key regex and header strip still run **before** generic collapse/table hosts incorrectly win. Todo branch must stay **before** broad `main` fallback. Prefer `region_label: title` when title is PJ/DGSX (do not replace with generic `区块`).

Current pattern (keep / harden):

```javascript
      if (el.closest('.todo-item')) {
        const todo = el.closest('.todo-item');
        const blob = String(todo.innerText || todo.textContent || '');
        const keyM = blob.match(/\\b(?:PJ|DGSX)\\d+\\b/);
        let title = keyM ? keyM[0] : '';
        // ... header fallback without action texts ...
        return {
          region_role: 'section',
          region_id: 'section:' + (title || 'todo'),
          region_label: title || regionLabelOf('section', title),
        };
      }
```

When `title` is the business key, set `region_label` to **`title` directly** (avoid any path that yields empty or `"区块"`).

- [ ] **Step 2: Add `display_group` on resolve enrich**

In `resolve-by-label.js` `toPreview` and `enrichOne` / element copy:

```javascript
function displayGroupOf(el) {
  const label = String(el?.region_label || '').trim();
  if (label) return label;
  const smart = String(el?.xpath_smart || '').trim();
  if (smart) return smart.slice(0, 64);
  return String(el?.region_id || el?.region_role || '').trim();
}
```

Set `display_group: displayGroupOf(enriched)` on both `preview` and normalized `element`.

Hard rule: **`display_group` must not equal `"section"` when `region_label` is non-empty.** Grouping key for SPA = `display_group`.

- [ ] **Step 3: Api-docs cue**

In `src/dashboard/api-docs/groups/recording.js` resolve-element desc, add explicit line:

> 多命中选择器必须按 `preview.display_group`（= `region_label`）分组/展示；禁止用 `region_role`（常为 `section`）作为唯一分组标题。

- [ ] **Step 4: CHANGELOG**

Append under `[Unreleased]` / Fixed or Changed:

```markdown
- 2026-08-12: **分区/定位统一 U1（自动抓取可读分区）**：`classifyOperable`/`normalizeHost` 为唯一准入/host 内核；resolve-element 歧义项增加 `display_group`（= `region_label`），待办多「处理」须带互异卡片业务键。
  影响范围：PAGE_LOCATOR_HELPERS、resolve-element ambiguous matches、api-docs。
  文件：src/cdp/page-locator-helpers.js, src/cdp/resolve-by-label.js, src/dashboard/api-docs/groups/recording.js, …
  Python 同步提示：透传 `display_group`；产品 SPA「选择匹配的控件」按 `display_group`/`region_label` 分组，勿用 `region_role`。
```

- [ ] **Step 5: Regen (if helpers changed) + green**

```powershell
node scripts/_gen_locator_helpers_py.mjs
$env:PYTHONPATH = "."
python scripts/characterization/characterize-unify-partition-locator.py
python scripts/characterization/characterize-todo-item-action.py
```

Expected: OK

- [ ] **Step 6: Commit** (only if user asks)

---

### Task 5: Wire AI `collectL2Buttons` to `classifyOperable`

**Files:**
- Modify: `scripts/controller/actions/js_snippets/scan_form.py` (`collectL2Buttons`)
- Modify: `scripts/characterization/characterize-unify-partition-locator.py` (source cue)
- Test: unify char + `characterize-todo-item-action.py` / `characterize-l2-todo-region.py` if present

**Interfaces:**
- Consumes: `classifyOperable` from injected `PAGE_LOCATOR_HELPERS`
- Produces: L2 buttons only when `classifyOperable(el)` admits a clickable kind (`button` / etc.)

- [ ] **Step 1: Failing cue in unify char**

```python
def test_collect_l2_buttons_mentions_classify_operable() -> None:
    src = (ROOT / "scripts/controller/actions/js_snippets/scan_form.py").read_text(
        encoding="utf-8"
    )
    body = src.split("function collectL2Buttons", 1)[1].split(
        "function discoverL1", 1
    )[0]
    assert_true(
        "classifyOperable" in body,
        "collectL2Buttons must call classifyOperable for admission",
    )
```

Run once — expect FAIL.

- [ ] **Step 2: Minimal wire in `collectL2Buttons`**

After visibility / disabled checks, before push:

```javascript
            const kind = (typeof classifyOperable === 'function')
              ? classifyOperable(el)
              : 'button';
            if (!kind || (kind !== 'button' && kind !== 'icon' && kind !== 'menu')) continue;
```

Keep existing `.todo-item-action` in the selector list (collect still finds candidates; classify is the admit gate).

- [ ] **Step 3: Green**

```powershell
$env:PYTHONPATH = "."
python scripts/characterization/characterize-unify-partition-locator.py
python scripts/characterization/characterize-todo-item-action.py
```

- [ ] **Step 4: Commit** (only if user asks)

---

### Task 6: U2 — inventory as L2 projection

**Files:**
- Modify: `src/cdp/page-locator-helpers.js` (`collectInventoryHosts` / new `collectL2Hosts`)
- Regen: `_locator_helpers_js.py`
- Modify: unify char (assert single host-selector table or inventory calls `collectL2Hosts`)
- Test: unify char + todo-item-action

**Interfaces:**
- Consumes: `classifyOperable`, `normalizeHost`, `assignRegion`
- Produces: `collectL2Hosts()` returns `[{ el, text, kind }, ...]` using **one** selector string; `collectInventoryHosts` becomes:

```javascript
    function collectL2Hosts() {
      const sel = [
        '.el-form-item input:not([type="hidden"])',
        '.el-form-item textarea',
        '.el-form-item .el-select .el-input__inner',
        '.el-form-item .el-date-editor',
        '.el-form-item .el-radio, .el-form-item .el-radio-group .el-radio',
        '.el-form-item .el-checkbox, .el-form-item .el-checkbox-group .el-checkbox',
        'button.el-button, .el-button, button',
        '.todo-item-action',
        '.menu-item, .submenu-item, .el-menu-item, .el-submenu__title, .el-dropdown-menu__item, [role="menuitem"]',
        '[class*="el-icon"][aria-label], .el-tooltip[class*="el-icon"], a[class*="el-icon"]',
      ].join(',');
      // ... same loop as today's collectInventoryHosts, but:
      // host = normalizeHost(el) || el;
      // kind = classifyOperable(host);
      // ...
      return out;
    }
    function collectInventoryHosts() {
      return collectL2Hosts();
    }
```

Move the previous `collectInventoryHosts` body into `collectL2Hosts` (do not leave two divergent selector lists).

- [ ] **Step 1: Failing cue**

```python
def test_inventory_aliases_collect_l2_hosts() -> None:
    h = helpers_src()
    assert_true("function collectL2Hosts" in h, "collectL2Hosts must exist")
    body = h.split("function collectInventoryHosts", 1)[1][:400]
    assert_true(
        "collectL2Hosts" in body,
        "collectInventoryHosts must delegate to collectL2Hosts",
    )
```

- [ ] **Step 2: Implement + regen + green**

```powershell
node scripts/_gen_locator_helpers_py.mjs
$env:PYTHONPATH = "."
python scripts/characterization/characterize-unify-partition-locator.py
python scripts/characterization/characterize-todo-item-action.py
```

- [ ] **Step 3: Optional scan selector note** — `collectL2Buttons` in `scan_form.py` may keep a **button-only** projection selector (`button, .el-button, .todo-item-action`) but must continue using `classifyOperable`. Do not reintroduce a third kind ladder.

- [ ] **Step 4: CHANGELOG** note U2 sole collect + Python sync (SPA/executor reload helpers).

- [ ] **Step 5: Commit** (only if user asks)

---

### Task 7: Wet verification checklist (manual / optional agent)

**Files:**
- None required (ops notes only); optionally append short note under `.superpowers/sdd/` if the team keeps wet logs there

**Interfaces:**
- Consumes: BiB session with reloaded helpers
- Produces: Human confirmation of U1 exit criteria

- [ ] **Step 1: Restart BiB / agent session** so `PAGE_LOCATOR_HELPERS` reload.

- [ ] **Step 2: On 待办 list, auto-grab「处理」**

Expect: ambiguity list ≥2; each row shows **distinct** card key (`DGSX…` / `PJ…`) via `display_group` / `region_label`, not a single header `section`.

- [ ] **Step 3: Pick one card → save step**

Expect: stored `xpath_smart` contains that card’s key (or todo-item anchor); replay clicks the same card.

- [ ] **Step 4: AI `scan_editable_summary`**

Expect: buttons include「处理」with matching `region_label`s.

If SPA still groups by `region_role` after payload fix: file/product follow-up — backend contract is done when `display_group` is present and distinct in HTTP/WS response (verify via api-docs or Network tab).

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Single `normalizeHost` + `classifyOperable` | T1–T2 |
| Inventory / L2 / snap share admission | T2, T5, T6 |
| Multi「处理」readable `region_label` / AG UX | T3–T4, T7 |
| U2 sole collect / inventory projection | T6 |
| Algorithm B / no section= deletion / xpath_smart replay | Global constraints |
| CHANGELOG for src/cdp | T4, T6 |
| Characterization + optional wet | T0–T3, T7 |

No TBD placeholders. `display_group` naming is locked here for SPA sync.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-12-unify-partition-locator-architecture.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute tasks in this session with executing-plans checkpoints  

Which approach?
