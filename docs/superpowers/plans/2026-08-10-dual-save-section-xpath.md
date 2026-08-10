# Dual-save / duplicate controls section-anchored xpath — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New recordings never silently click the wrong duplicate control, and exported relative `xpath_smart` alone uniquely locates the intended host for the Playwright engine.

**Architecture:** (1) `click_save` skips sticky `_phase_section` when scan shows ≥2 same-label sectioned buttons, forcing `err-save-ambiguous`. (2) Canonical `PAGE_LOCATOR_HELPERS` (`src/cdp/page-locator-helpers.js`) replaces multi-hit occurrence pins with section-anchored relative xpath, then regenerates the Python snippet mirror. (3) Successful `click_save` records `params.section` for logs/gates only — Playwright still uses xpath only.

**Tech Stack:** Python agent (`scripts/controller/actions`), CDP locator helpers JS, characterization scripts, Playwright sync for locator fixture tests.

**Spec:** `docs/superpowers/specs/2026-08-10-dual-save-section-xpath-design.md`

## Global Constraints

- Playwright export locator = relative `xpath_smart` only; do not rely on `params.section` for execute.
- Never export global `(//button[normalize-space()='保存'])[n]` (or equivalent occurrence pin) when a section anchor can uniquely identify the host.
- Multi same-label save + no explicit `section=` → ignore sticky; ambiguous / no click.
- Same-page duplicate-component disambiguation is **in scope** on the shared locator path (not save-only).
- Old traj 73 heal is **out of scope**.
- Edit locator helpers in `src/cdp/page-locator-helpers.js`, then `node scripts/_gen_locator_helpers_py.mjs` — do not hand-edit `_locator_helpers_js.py` as source of truth.
- `scripts/`-only + CDP helpers: no CHANGELOG required unless product API/routes change (this plan does not).

---

## File map

| File | Responsibility |
|------|----------------|
| `scripts/controller/actions/section_scope.py` | `same_label_section_keys(buttons, button_text) -> list[str]`; used to decide sticky skip |
| `scripts/controller/actions/_form.py` | `click_save` resolve order; record `section` in params |
| `src/cdp/page-locator-helpers.js` | `sectionAnchorXPath` + `buildLocatorSnap` prefer section anchor over `[n]` |
| `scripts/controller/actions/js_snippets/_locator_helpers_js.py` | Generated mirror of helpers |
| `scripts/characterization/characterize-dual-save-section.py` | Sticky skip + source order + cue |
| `scripts/characterization/characterize-section-anchored-xpath.py` | Playwright HTML fixture: unique evaluate |
| `scripts/characterization/characterize-phase-runtime.py` | Update click_save order assertion |
| `scripts/prompts/agent-tools-form.md` | One-line: sticky will not auto-pick among multi「保存」 |
| `.gitignore` | Un-ignore `docs/superpowers/plans/**` if committing this plan |

---

### Task 1: `same_label_section_keys` + failing chars

**Files:**
- Create: `scripts/characterization/characterize-dual-save-section.py`
- Modify: `scripts/controller/actions/section_scope.py` (after Task 1 failing run)
- Test: `scripts/characterization/characterize-dual-save-section.py`

**Interfaces:**
- Produces: `same_label_section_keys(buttons: list | None, button_text: str = "保存") -> list[str]` — distinct non-`__root__` section titles/ids for buttons whose label matches needle (same compact match as `unique_button_section`).

- [ ] **Step 1: Write the failing characterization**

Create `scripts/characterization/characterize-dual-save-section.py`:

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Dual 保存: sticky must not win when ≥2 sectioned same-label buttons."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scripts.controller.actions.section_scope import (  # noqa: E402
    same_label_section_keys,
    preferred_submit_cue,
)


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> int:
    buttons = [
        {"label": "保存", "section_id": "系统评级结论", "section_title": "系统评级结论"},
        {"label": "保存", "section_id": "客户综合评价", "section_title": "客户综合评价"},
    ]
    keys = same_label_section_keys(buttons, "保存")
    assert_true(len(keys) == 2, f"expect 2 sections, got {keys!r}")
    assert_true("系统评级结论" in keys and "客户综合评价" in keys, f"keys={keys!r}")

    one = [{"label": "保存", "section_id": "系统评级结论", "section_title": "系统评级结论"}]
    assert_true(same_label_section_keys(one, "保存") == ["系统评级结论"], "single section")

    # Source: click_save must count same-label sections before applying sticky memory
    form = (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
    cs = form.find("async def click_save")
    assert_true(cs >= 0, "click_save present")
    body = form[cs : cs + 5000]
    assert_true("same_label_section_keys" in body, "click_save uses same_label_section_keys")
    multi_pos = body.find("same_label_section_keys")
    mem_pos = body.find("_phase_section")
    assert_true(multi_pos >= 0 and mem_pos >= 0, "both present")
    assert_true(multi_pos < mem_pos, "multi-section check before sticky memory read")

    store = {
        "_scan_buttons": buttons,
        "_phase_section": "系统评级结论",
    }
    cue = preferred_submit_cue(store, section="")
    # After Task 3/5 cue may still include memory section; dual-save prompt task covers explicit section=
    assert_true("click_save" in cue, "cue mentions click_save")

    print("characterize-dual-save-section: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `python scripts/characterization/characterize-dual-save-section.py`

Expected: `ImportError` or `AssertionError` (`same_label_section_keys` missing / not in `_form.py`).

- [ ] **Step 3: Implement `same_label_section_keys`**

In `scripts/controller/actions/section_scope.py`, next to `unique_button_section`:

```python
def same_label_section_keys(buttons: list | None, button_text: str = "保存") -> list[str]:
    """Distinct section titles/ids for visible scan buttons matching ``button_text``.

    Empty / __root__ sections omitted. Order = first-seen in ``buttons``.
    """
    needle = re.sub(r"\s+", "", norm_sec(button_text) or "保存") or "保存"
    keys: list[str] = []
    seen: set[str] = set()
    for b in buttons or []:
        if not isinstance(b, dict):
            continue
        lab = re.sub(r"\s+", "", norm_sec(b.get("label") or ""))
        if not lab:
            continue
        if needle not in lab and lab not in needle:
            continue
        key = norm_sec(b.get("section_title") or "") or norm_sec(b.get("section_id") or "")
        if not key or key == "__root__":
            continue
        if key not in seen:
            seen.add(key)
            keys.append(key)
    return keys
```

Optionally refactor `unique_button_section` to call this and return `keys[0] if len(keys)==1 else None`.

- [ ] **Step 4: Re-run — expect still FAIL on `_form.py` wiring**

Run: `python scripts/characterization/characterize-dual-save-section.py`

Expected: FAIL on `same_label_section_keys` not in `click_save` body (helper import OK).

- [ ] **Step 5: Commit helper + failing char (optional checkpoint)**

```bash
git add scripts/controller/actions/section_scope.py scripts/characterization/characterize-dual-save-section.py
git commit -m "test: add same_label_section_keys and dual-save char scaffold"
```

---

### Task 2: Wire `click_save` to skip sticky when multi-section

**Files:**
- Modify: `scripts/controller/actions/_form.py` (`async def click_save` section resolve ~1396–1419)
- Modify: `scripts/characterization/characterize-phase-runtime.py` (`test_click_save_section_order_in_source`)
- Test: `characterize-dual-save-section.py`, `characterize-phase-runtime.py`

**Interfaces:**
- Consumes: `same_label_section_keys`, `refresh_scan_buttons`, `unique_button_section`, `remember_phase_section`
- Produces: `click_save` resolve order: explicit → (refresh + multi-check) → sticky only if not multi → unique → `''`

- [ ] **Step 1: Update phase-runtime order characterization (TDD)**

Replace `test_click_save_section_order_in_source` assertions so they match the new policy:

```python
def test_click_save_section_order_in_source() -> None:
    form = (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
    cs = form.find("async def click_save")
    assert_true(cs >= 0, "click_save present")
    body = form[cs : cs + 5000]
    assert_true("same_label_section_keys" in body, "multi-section gate")
    assert_true("unique_button_section" in body, "unique path kept")
    multi_pos = body.find("same_label_section_keys")
    mem_pos = body.find("_phase_section")
    uniq_pos = body.find("unique_button_section")
    assert_true(multi_pos < mem_pos, "multi check before sticky")
    assert_true(mem_pos < uniq_pos or uniq_pos > multi_pos, "unique still after gate")
```

Run: `python scripts/characterization/characterize-phase-runtime.py`  
Expected: FAIL until `_form.py` wired.

- [ ] **Step 2: Implement resolve block in `click_save`**

Replace the current “explicit → memory → unique” block with:

```python
        sec = (section or "").strip()
        explicit_sec = bool((section or "").strip())
        # Resolve: explicit → multi-save gate → sticky memory → unique → ""
        if not sec and not explicit_sec:
            try:
                await refresh_scan_buttons(page, case_data_store)
            except Exception:
                pass
            try:
                from .section_scope import same_label_section_keys, norm_sec
                keys = same_label_section_keys(
                    case_data_store.get("_scan_buttons"), compact_btn
                )
                if len(keys) >= 2:
                    sys.stderr.write(
                        f'[click_save] skip sticky; multi-section {compact_btn!r} keys={keys!r}\n'
                    )
                    sys.stderr.flush()
                    # leave sec empty → JS_CLICK_SAVE_BUTTON returns ambiguous
                else:
                    mem = norm_sec(str(case_data_store.get("_phase_section") or ""))
                    if mem:
                        sec = mem
                        sys.stderr.write(f'[click_save] phase section={sec!r} from memory\n')
                        sys.stderr.flush()
                    if not sec:
                        from .section_scope import unique_button_section
                        auto_sec = unique_button_section(
                            case_data_store.get("_scan_buttons"), compact_btn
                        )
                        if auto_sec:
                            sec = auto_sec
                            sys.stderr.write(
                                f'[click_save] auto section={auto_sec!r} from unique button\n'
                            )
                            sys.stderr.flush()
            except Exception:
                pass
        elif not sec:
            # explicit empty string already handled; keep legacy memory only if caller omitted?
            pass
        if sec:
            from .section_scope import remember_phase_section
            remember_phase_section(case_data_store, sec)
```

Keep existing `if not info.get('ok')` / `err-save-ambiguous` path unchanged.

Note: when `keys >= 2`, do **not** call `remember_phase_section` with sticky leftovers.

- [ ] **Step 3: Run characterizations**

```bash
python scripts/characterization/characterize-dual-save-section.py
python scripts/characterization/characterize-phase-runtime.py
```

Expected: both OK (dual-save cue assert may be weak; OK).

- [ ] **Step 4: Commit**

```bash
git add scripts/controller/actions/_form.py scripts/controller/actions/section_scope.py \
  scripts/characterization/characterize-dual-save-section.py \
  scripts/characterization/characterize-phase-runtime.py
git commit -m "fix: skip sticky section when multiple same-label saves exist"
```

---

### Task 3: Section-anchored xpath in canonical locator helpers

**Files:**
- Modify: `src/cdp/page-locator-helpers.js` (`pinOccurrence` / `buildLocatorSnap`)
- Regenerate: `scripts/controller/actions/js_snippets/_locator_helpers_js.py` via `node scripts/_gen_locator_helpers_py.mjs`
- Create: `scripts/characterization/characterize-section-anchored-xpath.py`
- Test: that characterization (Playwright + minimal HTML)

**Interfaces:**
- Produces: `sectionAnchorXPath(host, leafLocalExpr) -> string` inside `PAGE_LOCATOR_HELPERS`
- Produces: `buildLocatorSnap` prefers section-anchored xpath when `pinOccurrence` would set `occurrence >= 1` (or `evalXpathAll(smart).length >= 2`) and host has collapse/tab/card section

- [ ] **Step 1: Write failing characterization (Playwright fixture)**

Create `scripts/characterization/characterize-section-anchored-xpath.py`:

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Exported xpath_smart must section-anchor duplicate buttons (Playwright-only locate)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from playwright.sync_api import sync_playwright  # noqa: E402
from scripts.controller.actions.js_snippets._locator_helpers_js import (  # noqa: E402
    PAGE_LOCATOR_HELPERS,
)


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


HTML = """<!DOCTYPE html><html><body>
<div class="el-collapse-item">
  <div class="el-collapse-item__header">系统评级结论</div>
  <div class="el-collapse-item__wrap"><button>保存</button></div>
</div>
<div class="el-collapse-item">
  <div class="el-collapse-item__header">客户综合评价</div>
  <div class="el-collapse-item__wrap"><button id="target">保存</button></div>
</div>
</body></html>"""

SNAP_JS = (
    "() => {\n"
    + PAGE_LOCATOR_HELPERS
    + """
  const host = document.getElementById('target');
  const abs = absXPath(host);
  return buildLocatorSnap(host, '保存', abs, '', { targetKind: 'button' });
}
"""
)


def main() -> int:
    helpers = (ROOT / "src/cdp/page-locator-helpers.js").read_text(encoding="utf-8")
    assert_true("sectionAnchorXPath" in helpers, "canonical helpers define sectionAnchorXPath")
    assert_true("sectionAnchorXPath" in PAGE_LOCATOR_HELPERS, "Python mirror regenerated")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.set_content(HTML)
        loc = page.evaluate(SNAP_JS)
        browser.close()

    smart = (loc or {}).get("xpath_smart") or ""
    assert_true(smart, f"xpath_smart missing: {loc!r}")
    assert_true(
        "el-collapse-item" in smart and "客户综合评价" in smart,
        f"must section-anchor 客户综合评价, got {smart!r}",
    )
    assert_true(
        "[1]" not in smart and "[2]" not in smart,
        f"must not use occurrence pin, got {smart!r}",
    )

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.set_content(HTML)
        n = page.evaluate(
            """(xp) => {
              const snap = document.evaluate(xp, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
              return snap.snapshotLength;
            }""",
            smart,
        )
        hit = page.evaluate(
            """(xp) => {
              const node = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
              return node && node.id === 'target';
            }""",
            smart,
        )
        browser.close()

    assert_true(n == 1, f"evaluate count must be 1, got {n} for {smart!r}")
    assert_true(hit, f"must hit #target, xpath={smart!r}")
    print("characterize-section-anchored-xpath: OK")
    print(json.dumps({"xpath_smart": smart}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run — expect FAIL**

Run: `python scripts/characterization/characterize-section-anchored-xpath.py`

Expected: FAIL (`sectionAnchorXPath` missing) or FAIL (xpath still `(//button…)[2]`).

- [ ] **Step 3: Implement `sectionAnchorXPath` + `buildLocatorSnap` change**

In `src/cdp/page-locator-helpers.js`, add before `pinOccurrence` (or near `xpathSmartOf`):

```javascript
  function sectionAnchorOf(host) {
    if (!host || !host.closest) return null;
    const collapse = host.closest('.el-collapse-item');
    if (collapse) {
      const header = collapse.querySelector('.el-collapse-item__header');
      const title = normalizeControlText((header && (header.innerText || header.textContent)) || '');
      if (!title) return null;
      return {
        kind: 'collapse',
        title: title,
        prefix: "//div[" + classTokenPred('el-collapse-item') + "][.//*[ " + classTokenPred('el-collapse-item__header') + " and contains(normalize-space(.)," + xpathLiteral(title) + ")]]",
      };
    }
    const pane = host.closest('.el-tab-pane');
    if (pane) {
      const tabs = pane.closest && pane.closest('.el-tabs');
      let tabLabel = '';
      if (tabs) {
        const paneId = pane.getAttribute('id') || '';
        if (paneId) {
          const tabItem = tabs.querySelector('.el-tabs__item[aria-controls="' + paneId + '"]');
          if (tabItem) tabLabel = normalizeControlText(tabItem.innerText || tabItem.textContent || '');
        }
      }
      if (!tabLabel) return null;
      // Scope: tabs root that owns this label, then the pane controlled by that tab item.
      return {
        kind: 'tab',
        title: tabLabel,
        prefix: "//*[ " + classTokenPred('el-tabs') + "][.//*[ " + classTokenPred('el-tabs__item')
          + " and normalize-space()=" + xpathLiteral(tabLabel) + "]]//*[ "
          + classTokenPred('el-tab-pane') + "]",
      };
    }
    const card = host.closest('.el-card');
    if (card) {
      const h = card.querySelector('.el-card__header');
      const title = normalizeControlText((h && (h.innerText || h.textContent)) || '');
      if (!title) return null;
      return {
        kind: 'card',
        title: title,
        prefix: "//div[" + classTokenPred('el-card') + "][.//*[ " + classTokenPred('el-card__header') + " and contains(normalize-space(.)," + xpathLiteral(title) + ")]]",
      };
    }
    return null;
  }

  function sectionAnchorXPath(host, leafLocal) {
    const leaf = String(leafLocal || '').replace(/^\/+/, '');
    if (!host || !leaf) return '';
    const sec = sectionAnchorOf(host);
    if (!sec || !sec.prefix) return '';
    return sec.prefix + '//' + leaf;
  }
```

**Tab branch (concrete, use this in the real edit):** if `sectionOf`-style tab label is known, use:

```javascript
prefix: "//*[ " + classTokenPred('el-tab-pane') + "][not(contains(@class,'is-hidden')) or @aria-hidden!='true']"
```

Better concrete approach for tabs — mirror collapse style using pane id when present; if fragile, **P0 acceptance is collapse** (traj dual-save). Document tab/card as best-effort in code comments; characterization fixture is collapse-only.

In `buildLocatorSnap`, after computing `smart` via `xpathSmartOf`, **before or instead of blind pin**:

```javascript
    let smart = xpathSmartOf(host, t, formLbl, kind);
    let occurrence = 0;
    let verified = false;
    if (smart) {
      const nodes = evalXpathAll(smart);
      if (nodes.length >= 2) {
        // Strip leading // from smart for leaf reuse when smart is simple scopedXPath local
        let leaf = smart.replace(/^\/\//, '');
        // If smart was already '(//…)[n]', unwrap — prefer leaf from xpathSmartOf path:
        const localLeaf = (function () {
          const tagL = (host.tagName || '').toLowerCase();
          const lit = xpathLiteral(t);
          const cls = String(host.className || '');
          if (tagL === 'a') return 'a[normalize-space()=' + lit + ']';
          if (/(^| )el-button( |$)/.test(cls) && tagL !== 'button') {
            return '*[' + classTokenPred('el-button') + ' and normalize-space()=' + lit + ']';
          }
          return 'button[normalize-space()=' + lit + ']';
        })();
        const anchored = sectionAnchorXPath(host, localLeaf);
        if (anchored) {
          const anodes = evalXpathAll(anchored);
          let idx = -1;
          for (let i = 0; i < anodes.length; i++) {
            if (anodes[i] === host) { idx = i; break; }
          }
          if (anodes.length === 1 && idx === 0) {
            smart = anchored;
            occurrence = 0;
            verified = true;
          }
        }
      }
      if (!verified) {
        const pinned = pinOccurrence(smart, host);
        smart = pinned.xpath;
        occurrence = pinned.occurrence;
        verified = pinned.verified;
        // Spec: do not export occurrence pin when section anchor exists but failed uniqueness —
        // if occurrence>=1 and sectionAnchorOf(host), prefer leaving verified=false so strategy falls to xpath_full
        // rather than shipping [n] as xpath_smart. Product prefers fail-loud over wrong [n].
        if (occurrence >= 1 && sectionAnchorOf(host)) {
          smart = '';
          verified = false;
          occurrence = 0;
        }
      }
    }
```

Clarify product preference from spec §3 step 4: **do not fall back to global `[n]` as exported smart**. Empty smart + `xpath_full` abs is acceptable for rare fail; primary path must succeed for collapse dual-save fixture.

- [ ] **Step 4: Regenerate Python mirror**

Run: `node scripts/_gen_locator_helpers_py.mjs`

Expected: `ok: wrote _locator_helpers_js.py (…)`.

- [ ] **Step 5: Run characterization — expect PASS**

Run: `python scripts/characterization/characterize-section-anchored-xpath.py`

Expected: `characterize-section-anchored-xpath: OK` and xpath containing `客户综合评价`.

- [ ] **Step 6: Commit**

```bash
git add src/cdp/page-locator-helpers.js \
  scripts/controller/actions/js_snippets/_locator_helpers_js.py \
  scripts/characterization/characterize-section-anchored-xpath.py
git commit -m "fix: section-anchor relative xpath for duplicate on-page controls"
```

---

### Task 4: Record `params.section` on successful `click_save`

**Files:**
- Modify: `scripts/controller/actions/_form.py` (`_record_action` call after enrich ~1581)
- Modify: `scripts/characterization/characterize-dual-save-section.py` (source assert)

**Interfaces:**
- Produces: recorded params include `'section': sec` when `sec` non-empty (and optionally always key present)

- [ ] **Step 1: Extend dual-save char**

Add to `characterize-dual-save-section.py`:

```python
    assert_true(
        "section" in body[body.find("_record_action") : body.find("_record_action") + 800]
        or "'section':" in body
        or '"section":' in body,
        "click_save records section in params",
    )
```

Safer: search within `click_save` body for `_record_action` block containing `section`:

```python
    rec = body.find("_record_action")
    assert_true(rec >= 0, "records action")
    rec_block = body[rec : rec + 600]
    assert_true("section" in rec_block, "params include section")
```

Run — expect FAIL.

- [ ] **Step 2: Implement**

Change record params to:

```python
        _record_action(
            'click_element_by_index',
            {
                'index': -1,
                'tag_name': (element_info or {}).get('tag_name') or tag_name,
                'text': btn_text,
                'section': sec or info.get('section') or '',
            },
            f'ok-clicked-save:{btn_text}',
            element=element_info,
        )
```

(`info.get('section')` already returned by `JS_CLICK_SAVE_BUTTON` on success.)

- [ ] **Step 3: Run chars — PASS**

```bash
python scripts/characterization/characterize-dual-save-section.py
```

- [ ] **Step 4: Commit**

```bash
git add scripts/controller/actions/_form.py scripts/characterization/characterize-dual-save-section.py
git commit -m "fix: persist section on click_save recorded params"
```

---

### Task 5: Prompt / cue nudge (minimal)

**Files:**
- Modify: `scripts/prompts/agent-tools-form.md` (click_save bullet)
- Optional: `scripts/controller/actions/section_scope.py` `preferred_submit_cue` — if `_scan_buttons` has `len(same_label_section_keys(...))>=2` and no section arg, cue must say pass `section=` and must **not** imply bare `click_save()` is OK

- [ ] **Step 1: Prompt line**

In `agent-tools-form.md` click_save bullet, append:

`无 section 时若页上多区块同名保存按钮，系统不会使用上一区块记忆自动点保存，会返回 err-save-ambiguous — 必须显式 section=。`

- [ ] **Step 2: Cue when multi**

In `preferred_submit_cue`:

```python
    keys = same_label_section_keys((store or {}).get("_scan_buttons"), btn)
    if len(keys) >= 2 and not sec:
        return (
            f"Multiple '{btn}' buttons in {keys!r}. "
            f"Call click_save(button_text='{btn}', section='…') with the phase block title. "
            f"Do NOT call bare click_save() — sticky section is ignored when ambiguous."
        )
```

- [ ] **Step 3: Extend dual-save char for cue**

```python
    cue2 = preferred_submit_cue(
        {"_scan_buttons": buttons, "_phase_section": "系统评级结论"},
        section="",
    )
    assert_true("err-save-ambiguous" in cue2 or "section=" in cue2, f"multi cue: {cue2}")
    assert_true("sticky" in cue2.lower() or "不会" in cue2 or "Multiple" in cue2, f"warn multi: {cue2}")
```

- [ ] **Step 4: Run + commit**

```bash
python scripts/characterization/characterize-dual-save-section.py
python scripts/characterization/characterize-preferred-submit.py
git add scripts/prompts/agent-tools-form.md scripts/controller/actions/section_scope.py \
  scripts/characterization/characterize-dual-save-section.py
git commit -m "docs: require explicit section= when multiple save buttons"
```

---

### Task 6: Wet verify on CDP 9242 (manual gate)

**Files:** none (manual / one-off probe; delete after)

- [ ] **Step 1:** Open 对公评级编辑页 with dual「保存」on `127.0.0.1:9242`.

- [ ] **Step 2:** From a short probe, call enrich/`buildLocatorSnap` on 客户综合评价 保存; assert `xpath_smart` contains `客户综合评价` and `evaluate` count === 1.

- [ ] **Step 3:** Simulate store sticky=`系统评级结论` + empty section path: confirm agent would get ambiguous (or unit already covers). Optional: call `JS_CLICK_SAVE_BUTTON` with `['保存','']` → ambiguous.

- [ ] **Step 4:** No commit unless probe scripts kept under `scripts/characterization/`.

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Skip sticky when ≥2 same-label saves | Task 2 |
| `err-save-ambiguous` unchanged | Task 2 (existing JS path) |
| Section-anchored relative xpath | Task 3 |
| Never export `[n]` when section available | Task 3 |
| Duplicate components general (not save-only) | Task 3 (`buildLocatorSnap`) |
| Playwright-only locate success | Task 3 + 6 |
| `params.section` recorded (not locate contract) | Task 4 |
| Prompt / cue | Task 5 |
| Old traj heal | Non-goal — no task |

## Self-review notes

- Canonical locator file is `src/cdp/page-locator-helpers.js` + codegen — plan forbids editing only the `.py` mirror.
- Tab section-anchor is best-effort; collapse is P0 (matches product dual-save).
- `characterize-phase-runtime` order test **must** be updated or it will false-fail after Task 2.
