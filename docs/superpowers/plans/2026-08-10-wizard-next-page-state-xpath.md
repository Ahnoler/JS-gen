# Wizard next/prev page-state xpath — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「下一步」/「上一步」export relative `xpath_smart` that embeds wizard page state so consecutive clicks on different steps are not coalesced and Playwright can locate each step uniquely.

**Architecture:** Add `pageStateOf` / `pageStateNavXPath` in canonical `src/cdp/page-locator-helpers.js`. For nav button labels only, prefer a verified page-state-anchored smart xpath over the bare `//button[normalize-space()='下一步']`. Recording coalesce and assemble dedup keep using `xpath:{xpath_smart}` and automatically diverge. Regenerate the Python mirror via `_gen_locator_helpers_py.mjs`.

**Tech Stack:** CDP locator helpers JS, Python characterization + Playwright sync fixtures, existing `_element_identity` / `elementDedupKey`.

**Spec:** `docs/superpowers/specs/2026-08-10-wizard-next-page-state-xpath-design.md`

## Global Constraints

- Playwright export locator = relative `xpath_smart` only.
- This cut: only normalized text exactly `下一步` or `上一步`.
- Page state order: active `el-step` title → breadcrumb → short main title → else bare xpath (fail-soft).
- Do not hand-edit `scripts/controller/actions/js_snippets/_locator_helpers_js.py` as source of truth — edit `src/cdp/page-locator-helpers.js` then `node scripts/_gen_locator_helpers_py.mjs`.
- Do not heal old traj 73 steps.
- Do not implement general “any clickable same-xpath different page-state” in this cut (spec §4 TODO).
- Prefer fail-soft: unverified page-state anchor → keep bare button xpath (no invented wrong title).
- `scripts/` + CDP helpers only: no CHANGELOG unless product API routes change (this plan does not).

---

## File map

| File | Responsibility |
|------|----------------|
| `src/cdp/page-locator-helpers.js` | `pageStateOf`, `pageStateNavXPath`, wire in `buildLocatorSnap` |
| `scripts/controller/actions/js_snippets/_locator_helpers_js.py` | Generated mirror |
| `scripts/characterization/characterize-wizard-next-page-state.py` | Fixture + identity asserts |
| `scripts/characterization/characterize-dedup.mjs` | Consecutive next with different xpath keep both |
| `scripts/state.py` | No change if xpath diverges; only touch if bare fallback still coalesces wrongly |

---

### Task 1: Failing characterization (Playwright fixture)

**Files:**
- Create: `scripts/characterization/characterize-wizard-next-page-state.py`
- Test: same

**Interfaces:**
- Produces: failing test that expects `pageStateOf` / `pageStateNavXPath` in helpers and two distinct smart xpaths on a dual-step fixture

- [ ] **Step 1: Write the failing characterization**

Create `scripts/characterization/characterize-wizard-next-page-state.py`:

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Wizard 下一步 must embed page-state in relative xpath_smart."""
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
from scripts.state import _element_identity  # noqa: E402


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


HTML_A = """<!DOCTYPE html><html><body>
<div class="wrap">
  <div class="el-steps">
    <div class="el-step is-process"><div class="el-step__title">基本信息</div></div>
    <div class="el-step"><div class="el-step__title">影像资料</div></div>
  </div>
  <form><button id="next-a">下一步</button></form>
</div>
</body></html>"""

HTML_B = """<!DOCTYPE html><html><body>
<div class="wrap">
  <div class="el-steps">
    <div class="el-step is-finish"><div class="el-step__title">基本信息</div></div>
    <div class="el-step is-process"><div class="el-step__title">影像资料</div></div>
  </div>
  <form><button id="next-b">下一步</button></form>
</div>
</body></html>"""

SNAP_JS = (
    "() => {\n"
    + PAGE_LOCATOR_HELPERS
    + """
  const host = document.querySelector('button');
  const abs = absXPath(host);
  return buildLocatorSnap(host, '下一步', abs, '', { targetKind: 'button' });
}
"""
)


def enrich(html: str) -> dict:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.set_content(html)
        loc = page.evaluate(SNAP_JS)
        n = page.evaluate(
            """(xp) => {
              const snap = document.evaluate(xp, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
              return snap.snapshotLength;
            }""",
            (loc or {}).get("xpath_smart") or "",
        )
        browser.close()
    return {"loc": loc or {}, "eval_count": n}


def main() -> int:
    helpers = (ROOT / "src/cdp/page-locator-helpers.js").read_text(encoding="utf-8")
    assert_true("pageStateOf" in helpers, "canonical helpers define pageStateOf")
    assert_true("pageStateNavXPath" in helpers, "canonical helpers define pageStateNavXPath")
    assert_true("pageStateOf" in PAGE_LOCATOR_HELPERS, "Python mirror regenerated")

    a = enrich(HTML_A)
    b = enrich(HTML_B)
    sa = (a["loc"].get("xpath_smart") or "")
    sb = (b["loc"].get("xpath_smart") or "")
    assert_true(sa and sb, f"missing smart a={sa!r} b={sb!r}")
    assert_true("基本信息" in sa, f"A must anchor 基本信息: {sa!r}")
    assert_true("影像资料" in sb, f"B must anchor 影像资料: {sb!r}")
    assert_true(sa != sb, "page-state xpaths must differ")
    assert_true(sa != "//button[normalize-space()='下一步']", "A must not be bare next xpath")
    assert_true(
        a["eval_count"] == 1 and b["eval_count"] == 1,
        f"eval counts {a['eval_count']},{b['eval_count']}",
    )

    id_a = _element_identity(
        "click_element_by_index",
        {"text": "下一步"},
        {"xpath_smart": sa},
    )
    id_b = _element_identity(
        "click_element_by_index",
        {"text": "下一步"},
        {"xpath_smart": sb},
    )
    assert_true(id_a and id_b and id_a != id_b, f"identity must diverge: {id_a!r} vs {id_b!r}")

    print("characterize-wizard-next-page-state: OK")
    print(json.dumps({"a": sa, "b": sb}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run — expect FAIL**

Run: `python scripts/characterization/characterize-wizard-next-page-state.py`

Expected: FAIL (`pageStateOf` missing) or FAIL (bare xpath / identical smart).

- [ ] **Step 3: Commit failing char (optional TDD checkpoint)**

```bash
git add scripts/characterization/characterize-wizard-next-page-state.py
git commit -m "test: add wizard next page-state xpath characterization (red)"
```

---

### Task 2: Implement page-state nav xpath in locator helpers

**Files:**
- Modify: `src/cdp/page-locator-helpers.js`
- Regenerate: `scripts/controller/actions/js_snippets/_locator_helpers_js.py`
- Test: `characterize-wizard-next-page-state.py`

**Interfaces:**
- Produces: `pageStateOf() -> {kind, title} | null`
- Produces: `pageStateNavXPath(host, leafLocal, pageState) -> string`
- Produces: `isWizardNavLabel(text) -> boolean`
- Consumes: `normalizeControlText`, `classTokenPred`, `xpathLiteral`, `evalXpathAll`, `buildLocatorSnap`

- [ ] **Step 1: Add helpers near `sectionAnchorOf`**

```javascript
  function pageStateOf() {
    try {
      const stepsRoot = document.querySelector('.el-steps');
      if (stepsRoot) {
        const steps = stepsRoot.querySelectorAll('.el-step');
        for (let i = 0; i < steps.length; i++) {
          const s = steps[i];
          const process = s.classList.contains('is-process')
            || s.classList.contains('is-active')
            || !!(s.querySelector && s.querySelector('.is-process, .is-active, .el-step__head.is-process'));
          if (!process) continue;
          const titleEl = s.querySelector('.el-step__title');
          const title = normalizeControlText((titleEl && (titleEl.innerText || titleEl.textContent)) || s.innerText || '');
          if (title) return { kind: 'wizard_step', title: title };
        }
      }
      const bc = document.querySelector('.el-breadcrumb');
      if (bc) {
        const title = normalizeControlText(bc.innerText || bc.textContent || '');
        if (title) return { kind: 'breadcrumb', title: title.slice(0, 40) };
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function isWizardNavLabel(text) {
    const t = normalizeControlText(text);
    return t === '下一步' || t === '上一步';
  }

  function pageStateNavXPath(host, leafLocal, pageState) {
    const leaf = String(leafLocal || '').replace(/^\/+/, '');
    if (!host || !leaf || !pageState || !pageState.title) return '';
    const lit = xpathLiteral(pageState.title);
    if (pageState.kind === 'wizard_step') {
      return "//*[" + classTokenPred('el-steps') + "][.//*[(contains(@class,'is-process') or contains(@class,'is-active')) and contains(normalize-space(.)," + lit + ")]]"
        + "/ancestor::*[.//" + leaf + "][1]//" + leaf;
    }
    if (pageState.kind === 'breadcrumb') {
      return "//*[" + classTokenPred('el-breadcrumb') + " and contains(normalize-space(.)," + lit + ")]"
        + "/ancestor::*[.//" + leaf + "][1]//" + leaf;
    }
    return '';
  }
```

- [ ] **Step 2: Wire into `buildLocatorSnap`**

After `let smart = xpathSmartOf(host, t, formLbl, kind);` and **before** the multi-hit section-anchor block, when `isWizardNavLabel(t)`:

```javascript
    if (isWizardNavLabel(t)) {
      const ps = pageStateOf();
      const leafNav = (function () {
        const lit = xpathLiteral(t);
        const tagL = (host.tagName || '').toLowerCase();
        const cls = String(host.className || '');
        if (tagL === 'a') return 'a[normalize-space()=' + lit + ']';
        if (/(^| )el-button( |$)/.test(cls) && tagL !== 'button') {
          return '*[' + classTokenPred('el-button') + ' and normalize-space()=' + lit + ']';
        }
        return 'button[normalize-space()=' + lit + ']';
      })();
      const navXp = pageStateNavXPath(host, leafNav, ps);
      if (navXp) {
        const nodes = evalXpathAll(navXp);
        let idx = -1;
        for (let i = 0; i < nodes.length; i++) {
          if (nodes[i] === host) { idx = i; break; }
        }
        if (nodes.length === 1 && idx === 0) {
          smart = navXp;
          occurrence = 0;
          verified = true;
        }
      }
    }
```

If not verified, fall through to existing section-anchor / `pinOccurrence` (fail-soft bare path). Do not apply page-state wrap to other labels in this cut.

- [ ] **Step 3: Regenerate mirror**

Run: `node scripts/_gen_locator_helpers_py.mjs`

Expected: `ok: wrote _locator_helpers_js.py`.

- [ ] **Step 4: Run characterization — PASS**

Run: `python scripts/characterization/characterize-wizard-next-page-state.py`

Expected: `characterize-wizard-next-page-state: OK`.

- [ ] **Step 5: Commit**

```bash
git add src/cdp/page-locator-helpers.js \
  scripts/controller/actions/js_snippets/_locator_helpers_js.py \
  scripts/characterization/characterize-wizard-next-page-state.py
git commit -m "fix: page-state relative xpath for wizard next/prev buttons"
```

---

### Task 3: Dedup characterization for divergent next xpaths

**Files:**
- Modify: `scripts/characterization/characterize-dedup.mjs`
- Test: `characterize-dedup.mjs`, `characterize-wizard-next-page-state.py`

**Interfaces:**
- Consumes: page-state xpath strings (use realistic shapes matching Task 2 output)
- Produces: assert `deduplicateByXPath([nextA, nextB]).length === 2`

- [ ] **Step 1: Extend `characterize-dedup.mjs`**

```javascript
const nextA = {
  action: 'click_element_by_index',
  params: { text: '下一步' },
  element: {
    xpath_smart:
      "//*[contains(concat(' ',normalize-space(@class),' '),' el-steps ')][.//*[(contains(@class,'is-process') or contains(@class,'is-active')) and contains(normalize-space(.),'基本信息')]]/ancestor::*[.//button[normalize-space()='下一步']][1]//button[normalize-space()='下一步']",
  },
};
const nextB = {
  action: 'click_element_by_index',
  params: { text: '下一步' },
  element: {
    xpath_smart:
      "//*[contains(concat(' ',normalize-space(@class),' '),' el-steps ')][.//*[(contains(@class,'is-process') or contains(@class,'is-active')) and contains(normalize-space(.),'影像资料')]]/ancestor::*[.//button[normalize-space()='下一步']][1]//button[normalize-space()='下一步']",
  },
};
const keptNext = deduplicateByXPath([nextA, nextB]);
assert(keptNext.length === 2, 'consecutive next with different page-state xpath must both keep');
assert(
  elementDedupKey(nextA) !== elementDedupKey(nextB),
  'page-state next keys must differ',
);
```

If Task 2 emits a slightly different classTokenPred shape, copy **exact** strings from the Python char JSON print into these fixtures.

- [ ] **Step 2: Run**

```bash
python scripts/characterization/characterize-wizard-next-page-state.py
node scripts/characterization/characterize-dedup.mjs
```

Expected: both OK.

- [ ] **Step 3: Commit**

```bash
git add scripts/characterization/characterize-dedup.mjs
git commit -m "test: assert page-state next xpaths do not consecutive-dedup"
```

---

### Task 4: Wet verify on CDP 9242 (manual gate)

**Files:** none kept (delete temp probes)

- [ ] **Step 1:** Open rating apply wizard on `127.0.0.1:9242` at **基本信息**.

- [ ] **Step 2:** `buildLocatorSnap` on「下一步」→ smart contains `基本信息`, `eval_count===1`.

- [ ] **Step 3:** Click「下一步」→ wait → on **影像资料** enrich again → smart contains `影像资料`, differs from step 2, `eval_count===1`.

- [ ] **Step 4:** No code commit required for probe-only.

---

### Task 5: Mark spec implemented

**Files:**
- Modify: `docs/superpowers/specs/2026-08-10-wizard-next-page-state-xpath-design.md`

- [ ] **Step 1:** Set status to `Implemented` with date.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-08-10-wizard-next-page-state-xpath-design.md
git commit -m "docs: mark wizard next page-state xpath design implemented"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Page-state relative xpath for 下一步/上一步 | Task 2 |
| Order C: step → breadcrumb → fail-soft | Task 2 |
| Record coalesce keeps two steps via divergent xpath | Task 1–3 |
| Playwright-only locate (unique evaluate) | Task 1, 4 |
| General clickable TODO deferred | Spec §4 — no impl |
| Regenerate py mirror | Task 2 |

## Self-review notes

- Do not break dual-save section-anchor for「保存」.
- `ancestor::*[.//leaf][1]` must uniquely hit host on fixture and wet; tighten only if wet fails.
- No `_record_action` whitelist unless page-state xpath cannot be made to work on live DOM.
