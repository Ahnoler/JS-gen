# Capture element from write xpath Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make recorded `element.xpath_smart` identical to the write-path `params.xpath_smart` by capturing from the xpath-hit DOM node (`xpath_full` via `absXPath`), never regenerating form-item xpath via `JS_SMART_LOCATOR(label)`.

**Architecture:** Add `JS_CAPTURE_FROM_XPATH` that evaluates a relative xpath, stamps it verbatim, and computes `xpath_full` only. Rewrite `_capture_element` to require `xpath_smart` (else `None`). Wire all `_form.py` write/capture call sites to pass the resolved/round xpath.

**Tech Stack:** Python 3 agent (`scripts/actions/_helpers.py`, `_form.py`), `_js_snippets.py`, characterization scripts.

**Spec:** `docs/superpowers/specs/2026-08-08-capture-element-from-xpath-design.md`

## Global Constraints

- Invariant: when both present after xpath-based write, `params.xpath_smart == element.xpath_smart`.
- `_capture_element` with non-empty xpath must **not** call `JS_SMART_LOCATOR`.
- Empty `xpath_smart` → return `None` (no blind smart generation).
- Absolute field is **`xpath_full` only** — do **not** write `xpath_abs`.
- No DB backfill; no replay read-order changes; no T4 full-page DOM; no action renames.
- TDD: characterization red → green per task.
- Commit only `scripts/` (+ optional CHANGELOG); `docs/` gitignored unless user asks `git add -f`.

## File map

| File | Responsibility |
|------|----------------|
| `scripts/actions/_js_snippets.py` | `JS_CAPTURE_FROM_XPATH` (+ export) |
| `scripts/actions/_helpers.py` | `_capture_element` new contract |
| `scripts/actions/_form.py` | Pass `xpath_smart=` at every capture call site |
| `scripts/characterization/characterize-capture-element-xpath.py` | Gate tests |
| `CHANGELOG.md` | Brief Unreleased note (scripts behavior) |

---

### Task 1: `JS_CAPTURE_FROM_XPATH` + characterization skeleton

**Files:**
- Modify: `scripts/actions/_js_snippets.py`
- Create: `scripts/characterization/characterize-capture-element-xpath.py`

**Interfaces:**
- Produces: `JS_CAPTURE_FROM_XPATH` string constant (evaluate args: `[xpath_smart, label, target_kind]`)
- Returns JSON object or empty/`null` when miss

- [ ] **Step 1: Write failing characterization**

```python
#!/usr/bin/env python3
"""Characterize capture-from-xpath (no JS_SMART_LOCATOR on xpath path)."""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_snippet_exported() -> None:
    from scripts.actions import _js_snippets as sn
    assert_true(hasattr(sn, "JS_CAPTURE_FROM_XPATH"), "JS_CAPTURE_FROM_XPATH exported")
    js = sn.JS_CAPTURE_FROM_XPATH
    assert_true("absXPath" in js or "xpath_full" in js, "computes xpath_full")
    assert_true("JS_SMART_LOCATOR" not in js, "snippet must not embed SMART_LOCATOR")
    assert_true("xpath_abs" not in js or "xpath_abs:" not in js.replace(" ", ""), "do not write xpath_abs")


def main() -> int:
    test_snippet_exported()
    print("characterize-capture-element-xpath: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

Adjust the `xpath_abs` assert to: returned object construction must not set `xpath_abs:` key (allow mentioning absXPath function name).

- [ ] **Step 2: Run — expect FAIL**

```bash
set PYTHONPATH=.
python scripts/characterization/characterize-capture-element-xpath.py
```

- [ ] **Step 3: Implement `JS_CAPTURE_FROM_XPATH`**

Near other evaluate helpers in `_js_snippets.py` (after `JS_FILL_BY_XPATH` / locator helpers). Pseudocode:

```javascript
JS_CAPTURE_FROM_XPATH = r'''([xpath_smart, label, target_kind]) => {
  const xp = String(xpath_smart || '').trim();
  if (!xp) return null;
  // reuse visibility + dialog/drawer lastVisibleHost patterns from JS_FILL_BY_XPATH / locate
  const node = /* evaluate xp → preferred visible node */;
  if (!node) return null;
  const abs = absXPath(node);  // inline or share PAGE helper block
  const tag = (node.tagName || '').toLowerCase();
  const attrs = {};
  for (const a of node.attributes || []) attrs[a.name] = a.value;
  return {
    xpath: xp,
    xpath_smart: xp,
    xpath_full: abs,
    // NO xpath_abs
    css_sel: '',
    tag,
    attrs,
    text: (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
    formLabel: String(label || ''),
    target_kind: String(target_kind || ''),
    candidates: [
      { type: 'xpath_smart', value: xp },
      { type: 'xpath_full', value: abs },
    ],
  };
}'''
```

Inline a minimal `absXPath` (copy from existing snippet ~2349) or factor a tiny shared block — prefer copy-minimal to avoid large refactors.

Export in module `__all__` / imports used by `_helpers.py`.

- [ ] **Step 4: Run characterization — PASS**

- [ ] **Step 5: Commit**

```bash
git add scripts/actions/_js_snippets.py scripts/characterization/characterize-capture-element-xpath.py
git commit -m "feat: JS_CAPTURE_FROM_XPATH for DOM-based element stamp"
```

---

### Task 2: Rewrite `_capture_element` contract

**Files:**
- Modify: `scripts/actions/_helpers.py` (`_capture_element` ~212–243)
- Modify: `scripts/characterization/characterize-capture-element-xpath.py`

**Interfaces:**
- Produces:
```python
async def _capture_element(
    page,
    label_text,
    *,
    xpath_smart: str = "",
    target_kind: str = "",
) -> dict | None:
```

- [ ] **Step 1: Extend failing tests**

```python
def test_helpers_source_no_smart_on_xpath_path() -> None:
    src = (ROOT / "scripts/actions/_helpers.py").read_text(encoding="utf-8")
    # After rewrite: body must call JS_CAPTURE_FROM_XPATH; must not call JS_SMART_LOCATOR
    assert_true("JS_CAPTURE_FROM_XPATH" in src, "helpers uses CAPTURE_FROM_XPATH")
    assert_true("JS_SMART_LOCATOR" not in src.split("async def _capture_element")[1].split("\nasync def ")[0],
                "_capture_element must not use JS_SMART_LOCATOR")


def test_capture_signature_has_xpath_smart() -> None:
    import inspect
    from scripts.actions._helpers import _capture_element
    sig = inspect.signature(_capture_element)
    assert_true("xpath_smart" in sig.parameters, "xpath_smart kw-only param")
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```python
async def _capture_element(page, label_text, *, xpath_smart: str = "", target_kind: str = ""):
    xp = (xpath_smart or "").strip()
    if not xp:
        return None
    try:
        from ._js_snippets import JS_CAPTURE_FROM_XPATH
        raw = await page.evaluate(JS_CAPTURE_FROM_XPATH, [xp, label_text or "", target_kind or ""])
        if not raw:
            return None
        info = json.loads(raw) if isinstance(raw, str) else raw
        if not isinstance(info, dict):
            return None
        if not (info.get("xpath_smart") or info.get("xpath_full")):
            return None
        return {
            "xpath": info.get("xpath") or info.get("xpath_smart") or "",
            "css_selector": info.get("css_sel") or info.get("css_selector") or "",
            "tag_name": info.get("tag") or info.get("tag_name") or "input",
            "attributes": info.get("attrs") or info.get("attributes") or {},
            "text": info.get("text") or "",
            "xpath_smart": info.get("xpath_smart") or xp,
            "xpath_full": info.get("xpath_full") or "",
            # do NOT set xpath_abs
            "candidates": info.get("candidates") if isinstance(info.get("candidates"), list) else [],
            "formLabel": info.get("formLabel") or label_text or "",
            "target_kind": info.get("target_kind") or target_kind or "",
        }
    except Exception:
        return None
```

Remove old `JS_SMART_LOCATOR` import usage from this function (keep import elsewhere if still needed by `_enrich_click_element`).

- [ ] **Step 4: PASS characterization**

- [ ] **Step 5: Commit**

```bash
git commit -am "fix: _capture_element stamps from xpath, never SMART_LOCATOR"
```

---

### Task 3: Wire `_form.py` call sites

**Files:**
- Modify: `scripts/actions/_form.py` (all `_capture_element(` sites)
- Modify: `scripts/characterization/characterize-capture-element-xpath.py`

**Interfaces:**
- Consumes: `_capture_element(..., xpath_smart=resolved.xpath_smart | xpath_smart)`
- Every successful xpath write that records `element=` must pass the same xp as in params

**Call sites (exact):**

| Location | Pass |
|----------|------|
| `fill_form_field` ~874 | `xpath_smart=resolved.xpath_smart` |
| `fill_date_field` ~898 | `xpath_smart=resolved.xpath_smart` |
| `_execute_round` ~1416 | `xpath_smart=xpath_smart` (round variable) |
| tree fallback captures ~1463/1480/1494 | pass `xpath_smart` when available; else omit → `None` |
| `select_option` ~2303 | `xpath_smart=resolved.xpath_smart` |
| `click_radio` ~2491 | `xpath_smart=resolved.xpath_smart` |
| `select_tree_option` ~2515 | no xpath → accept `None` (or resolve if store has xp — optional; default `None`) |
| tree fill fallback ~2533 | if resolve/xpath known pass it; else `None` |

Prefer capture **after** successful write when easy (so failed ops don't need element); if current code captures before write, passing xpath is still correct (same node). Minimal change: add kwarg at existing call sites.

- [ ] **Step 1: Failing source assertion**

```python
def test_form_fill_passes_xpath_to_capture() -> None:
    form = (ROOT / "scripts/actions/_form.py").read_text(encoding="utf-8")
    # fill_form_field block must pass xpath_smart=
    chunk = form.split("async def fill_form_field", 1)[1].split("async def fill_date_field", 1)[0]
    assert_true("xpath_smart=resolved.xpath_smart" in chunk or "xpath_smart=resolved.xpath_smart" in chunk.replace(" ", ""),
                "fill_form_field passes resolved xpath into capture")
```

Add similar checks for `select_option` / `click_radio` / `_execute_round` capture line containing `xpath_smart=`.

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Wire all sites**

- [ ] **Step 4: PASS + import smoke**

```bash
python -c "from scripts.actions._helpers import _capture_element; from scripts.actions._form import *"
python scripts/characterization/characterize-capture-element-xpath.py
python scripts/characterization/characterize-xpath-primary-ops.py
```

- [ ] **Step 5: Commit**

```bash
git commit -am "fix: pass write xpath into _capture_element at form call sites"
```

---

### Task 4: Verification + CHANGELOG

**Files:**
- Modify: `CHANGELOG.md` (optional Unreleased Fixed/Changed)
- Run characterizations

- [ ] **Step 1: Full regression**

```bash
set PYTHONPATH=.
python scripts/characterization/characterize-capture-element-xpath.py
python scripts/characterization/characterize-xpath-primary-ops.py
python scripts/characterization/characterize-form-scan-control-first.py
python scripts/characterization/characterize-xpath-fill-select.py
python scripts/characterization/characterize-control-ops-closed-loop.py
```

Expected: all OK

- [ ] **Step 2 (optional CDP):** On rating page, one assistant/table fill; assert recorded step `element.xpath_smart == params.xpath_smart`

- [ ] **Step 3: CHANGELOG** under `[Unreleased]` — Fixed: recording `element.xpath_smart` now mirrors write `params.xpath_smart` (no label SMART_LOCATOR overwrite). Python sync: 无.

- [ ] **Step 4: Update spec Status → Implemented** (local docs; `git add -f` if committing docs)

- [ ] **Step 5: Commit**

```bash
git commit -am "docs: CHANGELOG for capture-from-xpath element stamp"
```

---

## Spec coverage checklist

| Spec item | Task |
|-----------|------|
| `JS_CAPTURE_FROM_XPATH` + absXPath | T1 |
| `_capture_element` no SMART_LOCATOR; empty → None | T2 |
| Only `xpath_full` (no `xpath_abs`) | T1–T2 |
| Wire fill/select/date/radio/round | T3 |
| Tree no-xpath → None | T3 |
| Characterization + regression | T4 |
| No DB backfill / no replay change | Constraints |
