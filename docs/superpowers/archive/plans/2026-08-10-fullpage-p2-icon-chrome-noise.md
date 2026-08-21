# Full-page L2 P2 — icon / chrome noise filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hard-exclude portal chrome menus (layout/theme/close-tab) and decorative icons from fullpage L2 inventory and `scan_editable_summary.buttons`, while keeping business nav menus and named toolbar icons.

**Architecture:** Dual layer (spec approach C). Primary gate in `JS_SCAN_FORM_FIELDS` fullpage menu/icon collectors (`isChromeNoise` before `pushField`). Safety net in Python `build_editable_summary` when projecting `menu_item`/`icon` → `buttons`, using the same label-blocklist seed. Do **not** blanket-drop all `.el-dropdown-menu__item`. Do **not** change `filter_fillable_scan_fields`.

**Tech Stack:** `scripts/controller/actions/js_snippets/scan_form.py`, `form_scan_utils.py`, characterization scripts, optional CDP wet-run script.

**Spec:** `docs/superpowers/specs/2026-08-10-fullpage-p2-icon-chrome-noise-design.md`

## Global Constraints

- Hard-exclude chrome noise from L2 + summary buttons; keep business nav + named toolbar icons.
- Chrome detection = label blocklist **OR** chrome-scoped structural host (not every dropdown).
- Do not exclude solely for being under `.el-aside .el-menu`.
- Sidebar fold chevrons (`el-icon-arrow-left` / unnamed) follow normal decorative rules — no special case.
- `filter_fillable_scan_fields` unchanged; no naming polish; no Fact Pack; no LLM/vision.
- Do not regress `pending_items` / `readonly_items` / `buttons` + `xpath_smart` summary shape.
- TDD: characterization fail → implement → green.
- Commit only if user asks.
- Optional wet-run on 9242 after green chars.

## How we 改造 (current → target)

| Today | P2 target |
|-------|-----------|
| Fullpage admits layout/主题/关页签 as `menu_item` | JS skips before `pushField` |
| Summary projects all menu_item/icon labels into `buttons` | Python skips blocklisted labels |
| Icon: skip empty name + arrow/caret/close/loading | Keep; also skip chrome-host icons |

```text
fullpage menu/icon collect
  → isChromeNoise(el, kind, label)? skip
  → else pushField
build_editable_summary
  → project menu/icon → buttons
  → is_chrome_menu_label(text)? skip
```

## File map

| File | Role |
|------|------|
| `scripts/controller/actions/form_scan_utils.py` | `is_chrome_menu_label(text)` + use in menu/icon→buttons projection |
| `scripts/controller/actions/js_snippets/scan_form.py` | `isChromeNoise` + gate fullpage menu/icon loops; markers for char |
| `scripts/characterization/characterize-scan-fullpage-p2.py` | Unit + JS cue + summary projection tests |
| `scripts/characterization/wet-fullpage-p1-scan.py` or thin p2 wet helper | Optional wet assert chrome gone from buttons |
| `docs/superpowers/backlog-visible-editable-controls.md` | Mark P2 done when green |
| `docs/superpowers/specs/2026-08-10-fullpage-p2-icon-chrome-noise-design.md` | Status → Implemented |
| Parent phased table | P2 row → 已实施 |

---

### Task 1: Characterization — fail first

**Files:**
- Create: `scripts/characterization/characterize-scan-fullpage-p2.py`
- Test: same

**Interfaces:**
- Consumes: (none yet — asserts against missing APIs / cues)
- Produces: failing tests that define `is_chrome_menu_label` + JS markers + summary behavior

- [x] **Step 1: Write failing characterization**

```python
#!/usr/bin/env python3
"""Characterize P2: chrome menu / decorative icon noise filter."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

SCAN_FORM = ROOT / "scripts/controller/actions/js_snippets/scan_form.py"
UTILS = ROOT / "scripts/controller/actions/form_scan_utils.py"


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_is_chrome_menu_label() -> None:
    from scripts.controller.actions.form_scan_utils import is_chrome_menu_label

    assert_true(is_chrome_menu_label("水平布局") is True, "布局")
    assert_true(is_chrome_menu_label("垂直布局") is True, "布局")
    assert_true(is_chrome_menu_label("白色主题") is True, "主题")
    assert_true(is_chrome_menu_label("关闭当前页签") is True, "关闭+页签")
    assert_true(is_chrome_menu_label("关闭其他页签") is True, "关闭+页签")
    assert_true(is_chrome_menu_label("关闭非固定页签") is True, "关页签")
    assert_true(is_chrome_menu_label("客户管理") is False, "business nav")
    assert_true(is_chrome_menu_label("新增") is False, "toolbar")
    assert_true(is_chrome_menu_label("") is False, "empty")


def test_summary_skips_chrome_projected_buttons() -> None:
    from scripts.controller.actions.form_scan_utils import build_editable_summary

    scan = {
        "fields": [
            {
                "label": "水平布局",
                "kind": "menu_item",
                "xpath_smart": "//a[1]",
                "region_role": "shell-aside",
            },
            {
                "label": "客户管理",
                "kind": "menu_item",
                "xpath_smart": "//a[2]",
                "region_role": "shell-aside",
            },
            {
                "label": "新增",
                "kind": "icon",
                "xpath_smart": "//i[1]",
                "region_role": "main",
            },
        ],
        "buttons": [],
        "scope": "fullpage",
    }
    summary = build_editable_summary([scan], primary_container="main")
    texts = [b["text"] for b in summary["buttons"]]
    assert_true("水平布局" not in texts, "chrome excluded from buttons")
    assert_true("客户管理" in texts, "business menu kept")
    assert_true("新增" in texts, "named icon kept")


def test_js_noise_gate_cues() -> None:
    src = SCAN_FORM.read_text(encoding="utf-8")
    assert_true("CHROME_NOISE_FILTER" in src or "isChromeNoise" in src, "JS noise gate marker")
    assert_true("布局" in src or "主题" in src, "JS label seed present")


def main() -> int:
    try:
        test_is_chrome_menu_label()
        test_summary_skips_chrome_projected_buttons()
        test_js_noise_gate_cues()
    except Exception as exc:
        print(f"characterize-scan-fullpage-p2: FAIL {exc}")
        return 1
    print("characterize-scan-fullpage-p2: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [x] **Step 2: Run — expect FAIL**

```powershell
$env:PYTHONPATH="."
python scripts/characterization/characterize-scan-fullpage-p2.py
```

Expected: FAIL (`is_chrome_menu_label` missing and/or JS cues missing).

- [x] **Step 3: Stop** — implement Task 2–3

---

### Task 2: Python `is_chrome_menu_label` + summary safety net

**Files:**
- Modify: `scripts/controller/actions/form_scan_utils.py`
- Test: `scripts/characterization/characterize-scan-fullpage-p2.py`

**Interfaces:**
- Produces: `is_chrome_menu_label(text: str) -> bool`
- Consumes: used by `build_editable_summary` menu/icon projection loop

- [x] **Step 1: Implement helper**

Add near other filter helpers in `form_scan_utils.py`:

```python
def is_chrome_menu_label(text: str | None) -> bool:
    """True when label matches portal chrome menu noise (layout/theme/close-tab)."""
    t = (text or "").strip()
    if not t:
        return False
    if "布局" in t:
        return True
    if "主题" in t:
        return True
    if "页签" in t and ("关闭" in t or "固定" in t):
        return True
    return False
```

- [x] **Step 2: Gate summary projection**

In `build_editable_summary`, where menu_item/icon are appended to `projected_buttons`, skip when `is_chrome_menu_label(text)`:

```python
        text = (f.get('label') or '').strip()
        if not text or len(text) > 40:
            continue
        if is_chrome_menu_label(text):
            continue
        projected_buttons.append({...})
```

- [x] **Step 3: Re-run unit parts**

```powershell
$env:PYTHONPATH="."
python scripts/characterization/characterize-scan-fullpage-p2.py
```

Expected: Python tests PASS; if JS cues still missing, script FAILs only on `test_js_noise_gate_cues` until Task 3.

---

### Task 3: JS `isChromeNoise` gate in fullpage collectors

**Files:**
- Modify: `scripts/controller/actions/js_snippets/scan_form.py` (fullpage menu/icon block ~370–426)
- Test: `characterize-scan-fullpage-p2.py`

**Interfaces:**
- Consumes: same label rules as `is_chrome_menu_label`
- Produces: L2 fields without chrome noise; markers `CHROME_NOISE_FILTER` / `isChromeNoise`

- [x] **Step 1: Add helper inside `JS_SCAN_FORM_FIELDS` fullpage section**

Before the menu/icon loops (inside `if (isFullpage) { ... }`):

```javascript
        /* CHROME_NOISE_FILTER — hard-exclude portal chrome menus / decorative icons */
        const isChromeMenuLabel = (label) => {
            const t = String(label || '').trim();
            if (!t) return false;
            if (t.includes('布局')) return true;
            if (t.includes('主题')) return true;
            if (t.includes('页签') && (t.includes('关闭') || t.includes('固定'))) return true;
            return false;
        };
        const isChromeHost = (el) => {
            if (!el || !el.closest) return false;
            // Chrome-scoped only — NOT every .el-dropdown-menu on the page
            if (el.closest('.tags-view-wrapper .contextmenu, .tags-view-item .el-dropdown-menu, .tags-view .contextmenu')) return true;
            if (el.closest('.navbar-right, .right-menu, .header-setting, .layout-setting, .theme-picker')) return true;
            // dropdown items whose popper is clearly settings/theme (best-effort class seeds)
            const dd = el.closest('.el-dropdown-menu');
            if (dd && dd.closest && dd.closest('.right-menu, .navbar-right, .header-setting, .layout-setting')) return true;
            return false;
        };
        const isChromeNoise = (el, kind, label) => {
            if (isChromeMenuLabel(label)) return true;
            if (isChromeHost(el)) return true;
            if (kind === 'icon') {
                const cls = String(el && el.className || '');
                if (/arrow|caret|close|loading/i.test(cls)) return true;
                const name = (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title')) || '').trim();
                if (!name && kind === 'icon') {
                    // collector already requires label; keep defensive
                }
            }
            return false;
        };
```

Tune `isChromeHost` selectors to portal reality if wet-run still shows chrome; **never** return true solely for `.el-aside .el-menu`.

- [x] **Step 2: Call gate before `pushField`**

In menu loop after computing `label`:

```javascript
                if (isChromeNoise(el, 'menu_item', label)) continue;
```

In icon loop after computing `label` (existing arrow skip can stay or fold into `isChromeNoise`):

```javascript
            if (isChromeNoise(el, 'icon', label)) continue;
```

- [x] **Step 3: Run full characterization — expect PASS**

```powershell
$env:PYTHONPATH="."
python scripts/characterization/characterize-scan-fullpage-p2.py
python scripts/characterization/characterize-scan-editable-summary.py
python scripts/characterization/characterize-scan-fullpage-p1.py
```

Expected: all OK.

---

### Task 4: Docs + optional wet-run

**Files:**
- Modify: `docs/superpowers/backlog-visible-editable-controls.md`
- Modify: `docs/superpowers/specs/2026-08-10-fullpage-p2-icon-chrome-noise-design.md` (status Implemented; check success boxes)
- Modify: parent `docs/superpowers/specs/2026-08-10-fullpage-visible-controls-scan-design.md` P2 row
- Optional: extend `scripts/characterization/wet-fullpage-p1-scan.py` or add `--assert-chrome-gone` checks

- [x] **Step 1: Docs**

Mark P2 implemented in backlog「推荐下一刀」; set spec Status to Implemented; tick success criteria that code covers.

- [x] **Step 2: Optional wet-run on 9242**

```powershell
$env:PYTHONPATH="."; $env:PLAYWRIGHT_BROWSERS_PATH="$env:LOCALAPPDATA\ms-playwright"
python scripts/characterization/wet-fullpage-p1-scan.py --cdp http://127.0.0.1:9242 --out .superpowers/sdd/wet-fullpage-p2-results.json
```

Manually confirm report: no `水平布局` / `主题` / `关闭*页签` in sample_shell / summary buttons; business menu or named icon may remain; fillable count not collapsed.

- [x] **Step 3: User-facing summary**

**Done when:** Dual-layer filter live; chars green; chrome noise gone from inventory/summary; business nav kept; no fillable regression.

---

## Out of scope (later)

- Menu naming polish  
- Shell → memory Fact Pack  
- Vision L1 assist  
- Broad `.el-dropdown-menu` ban  

## Execution handoff

Plan: `docs/superpowers/plans/2026-08-10-fullpage-p2-icon-chrome-noise.md`  
After user says **execute** → `executing-plans` or `subagent-driven-development` from Task 1.
