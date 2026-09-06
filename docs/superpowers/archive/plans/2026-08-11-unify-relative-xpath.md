# Unify Relative XPath Recording Contract — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make recorded `params.xpath_smart` always equal DOM-authoritative relative xpath (never LLM-invented), then converge live/offline builders onto `page-locator-helpers.js`.

**Architecture:** Milestone 1 hardens recording (lookup-only resolve, capture rebuild instead of echo, stamp/weak-xpath gate, prompt). Milestone 2 makes `src/cdp/page-locator-helpers.js` the sole algorithm source with characterization locking helpers↔builders parity. Replay stays params-first.

**Tech Stack:** Python 3.12 controller actions, Playwright `page.evaluate`, `PAGE_LOCATOR_HELPERS` (generated from `src/cdp`), Node characterization (`.mjs`), source characterization (`.py`).

**Spec:** `docs/superpowers/specs/2026-08-11-unify-relative-xpath-design.md`

## Global Constraints

- Do **not** change replay `_resolve_replay_xpath` params-first priority.
- Do **not** remove agent tool argument `xpath_smart` (lookup only).
- Prefer empty `params.xpath_smart` over persisting invented/weak hints.
- `scripts/`-only work needs no `CHANGELOG.md` (AGENTS.md); if M2 touches `src/cdp/locator-builders` semantics for aligned APIs, add CHANGELOG `[Unreleased]` only when product-facing Node contracts change.
- Extend existing WIP (`_resolve_control` inventory prefer, `stamp_recorded_xpath_smart`, manual overlay scope); do not invent a parallel stamp system.
- Do not push unless the user asks.
- TDD: failing characterization before each code change.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `scripts/controller/actions/form_scan_utils.py` | `_resolve_control` lookup-only (no invented last-resort) |
| `scripts/controller/actions/js_snippets/fill_core.py` | `JS_CAPTURE_FROM_XPATH` rebuild via helpers |
| `scripts/controller/actions/js_snippets/_locator_helpers_js.py` | Generated `PAGE_LOCATOR_HELPERS` (M2 regen only) |
| `scripts/controller/actions/_helpers.py` | `stamp_recorded_xpath_smart` + weak-xpath reject |
| `scripts/controller/actions/_form.py` | Label-fallback gated on resolved (not raw hint); stamp after capture |
| `scripts/manual_recorder/mapper.py` | Already stamps + overlay scope — verify only in M1 |
| `scripts/prompts/agent-tools-form.md` | Forbid inventing any xpath (incl. placeholder) |
| `scripts/characterization/characterize-xpath-primary-ops.py` | Resolve lookup-only contract |
| `scripts/characterization/characterize-capture-element-xpath.py` | Capture rebuild ≠ echo |
| `scripts/characterization/characterize-manual-dialog-scope.py` | Manual params stamp (exists) |
| `scripts/characterization/characterize-locator-parity.mjs` | M2 helpers↔builders parity |
| `src/cdp/page-locator-helpers.js` | Canonical algorithms (M2) |
| `src/cdp/locator-builders/*` | Offline thin/shared (M2) |
| `scripts/_gen_locator_helpers_py.mjs` | Regen Python helpers from canonical JS |
| `scripts/characterization/repair-traj-params-xpath.py` | Ops repair (exists — document in Task 5 only) |

---

## Milestone 1 — Recording gate

### Task 1: Resolve — never persist invented hint

**Files:**
- Modify: `scripts/controller/actions/form_scan_utils.py` (`_resolve_control`)
- Modify: `scripts/characterization/characterize-xpath-primary-ops.py`
- Modify: `scripts/controller/actions/_form.py` (`fill_form_field` label-fallback gate)

**Interfaces:**
- Consumes: `_scan_fields`, `task_list`, agent `xpath_hint`
- Produces: `ResolvedControl` — on invented hint with no unique label inventory: `xpath_smart=""` and `error="xpath-not-found"` (not the hint string)

- [ ] **Step 1: Extend failing characterization for last-resort discard**

In `characterize-xpath-primary-ops.py`, add (or replace the old “hint wins when inventory empty” expectation):

```python
def test_resolve_invented_hint_without_inventory_is_not_found() -> None:
    """Lookup-only: invented hint must not become resolved.xpath_smart."""
    store = {"task_list": TaskList().to_store(), "_scan_fields": []}
    invented = "//input[@placeholder='请输入'][1]"
    r = _resolve_control(store, "核心产品编号", invented)
    assert_true(r.xpath_smart == "", f"must not keep invented hint, got {r.xpath_smart!r}")
    assert_true(r.error == "xpath-not-found", f"expected xpath-not-found, got {r.error!r}")


def test_resolve_hint_wins_still_requires_inventory() -> None:
    """Rename/retire test_resolve_hint_wins: empty inventory + hint → not-found."""
    store = {"task_list": TaskList().to_store(), "_scan_fields": []}
    r = _resolve_control(store, "任意", xpath_hint="//div[@id='x']//input")
    assert_true(r.xpath_smart == "" and r.error == "xpath-not-found", "no last-resort hint")
```

Keep `test_resolve_invented_hint_falls_back_to_inventory` and `test_resolve_inventory_hint_still_wins`.

- [ ] **Step 2: Run to verify fail**

```bash
python scripts/characterization/characterize-xpath-primary-ops.py
```

Expected: FAIL on `test_resolve_invented_hint_without_inventory_is_not_found` (current code returns hint as last resort at `form_scan_utils.py` ~776).

- [ ] **Step 3: Implement lookup-only resolve**

In `_resolve_control`, replace the last-resort branch:

```python
        by_label = _resolve_control_by_label(case_data_store, label_text)
        if not by_label.error and by_label.xpath_smart:
            return by_label
        # Spec: never return invented hint for write/persist.
        return ResolvedControl(
            xpath_smart="",
            label=label or label_text or "",
            error="xpath-not-found",
        )
```

- [ ] **Step 4: Fix fill_form_field label-fallback gate**

In `_form.py` `fill_form_field`, gate label-DOM fallback on **resolved** emptiness, not the raw agent hint (otherwise invented hint blocks fallback):

```python
        use_label_fallback = (
            (not strict_xpath)
            and bool(resolved.error)
            and not (resolved.xpath_smart or "").strip()
        )
```

On label-fallback success, keep `stamp_recorded_xpath_smart(element, "")` (empty if capture cannot rebuild without write xpath).

- [ ] **Step 5: Re-run characterization**

```bash
python scripts/characterization/characterize-xpath-primary-ops.py
```

Expected: `characterize-xpath-primary-ops: OK`

- [ ] **Step 6: Commit**

```bash
git add scripts/controller/actions/form_scan_utils.py scripts/controller/actions/_form.py scripts/characterization/characterize-xpath-primary-ops.py
git commit -m "fix: resolve treats agent xpath_smart as inventory lookup only"
```

---

### Task 2: Capture rebuild — stop echoing write xpath

**Files:**
- Modify: `scripts/controller/actions/js_snippets/fill_core.py`
- Modify: `scripts/characterization/characterize-capture-element-xpath.py`

**Interfaces:**
- Consumes: write xpath + label + `target_kind`; `PAGE_LOCATOR_HELPERS` (`formFieldXpathSmartOf`, `normalizeFormLabel`, `normalizeTargetRoot`, `absXPath` if present)
- Produces: capture dict with `xpath_smart` = **rebuilt** relative xpath (not the write `xp`)

- [ ] **Step 1: Write failing capture-rebuild characterization**

Add to `characterize-capture-element-xpath.py`:

```python
def test_capture_snippet_rebuilds_not_echo() -> None:
    from scripts.controller.actions import _js_snippets as sn

    js = sn.JS_CAPTURE_FROM_XPATH
    assert_true("PAGE_LOCATOR_HELPERS" in js or "formFieldXpathSmartOf" in js, "helpers embedded for rebuild")
    assert_true("formFieldXpathSmartOf" in js, "rebuild via formFieldXpathSmartOf")
    # Must not be the only assignment of xpath_smart to the write arg.
    # After rebuild, returned xpath_smart should prefer rebuilt smart.
    assert_true(
        "xpath_smart: smart" in js.replace(" ", "")
        or "xpath_smart:smart" in js.replace(" ", "")
        or "xpath_smart: rebuilt" in js.replace(" ", "")
        or "xpath_smart:rebuilt" in js.replace(" ", ""),
        "return rebuilt smart, not echo xp alone",
    )
```

Adjust the assertion string to match the exact local variable name you choose in Step 3 (`smart` recommended).

- [ ] **Step 2: Run to verify fail**

```bash
python scripts/characterization/characterize-capture-element-xpath.py
```

Expected: FAIL — current snippet returns `xpath_smart: xp`.

- [ ] **Step 3: Prepend helpers and rebuild after hit**

In `fill_core.py`, change assembly to match `scan_form.py` pattern:

```python
from ._locator_helpers_js import PAGE_LOCATOR_HELPERS

JS_CAPTURE_FROM_XPATH = (
    r'''([xpath_smart, label, target_kind]) => {
'''
    + PAGE_LOCATOR_HELPERS
    + r'''
  // ... keep existing locate / label disambig / drillWriteHit ...
  // AFTER node is resolved and drilled:
  const formLbl = normalizeFormLabel(String(label || '')) || (function () {
    const item = node.closest && node.closest('.el-form-item');
    const lbl = item && item.querySelector('.el-form-item__label, label');
    return normalizeFormLabel(lbl && lbl.textContent);
  })();
  const host = (typeof normalizeTargetRoot === 'function' ? (normalizeTargetRoot(node) || node) : node);
  const smart = (typeof formFieldXpathSmartOf === 'function'
    ? (formFieldXpathSmartOf(host, formLbl) || '')
    : '');
  const abs = absXPath(host);
  const primary = smart || abs;
  return {
    xpath: primary,
    xpath_smart: smart,
    xpath_full: abs,
    css_sel: '',
    tag: (host.tagName || '').toLowerCase(),
    attrs: /* collect from host */,
    text: /* ... */,
    formLabel: formLbl || String(label || ''),
    target_kind: String(target_kind || ''),
    candidates: [
      ...(smart ? [{ type: 'xpath_smart', value: smart }] : []),
      ...(abs ? [{ type: 'xpath_full', value: abs }] : []),
    ],
  };
}'''
)
```

Keep locate/`[last()]` fallback logic; only change the **return** payload to prefer rebuild.

Note: `absXPath` may already exist inline in the snippet — if helpers also define it, rename the inline one or remove duplicate to avoid `const` redeclare errors inside the same function scope. Prefer deleting the local `absXPath` if helpers export it, or wrap helpers in a block. Safest pattern used elsewhere: inject helpers at the **start of the arrow function body** once, and delete the duplicate local `absXPath` implementation.

- [ ] **Step 4: Run characterization**

```bash
python scripts/characterization/characterize-capture-element-xpath.py
```

Expected: OK

- [ ] **Step 5: Optional wet check on CDP 9242**

If headed Chromium is up:

```bash
node scripts/characterization/characterize-live-xpath-e2e.mjs --cdp=http://127.0.0.1:9242
```

Expected: `live-xpath-e2e: OK`

- [ ] **Step 6: Commit**

```bash
git add scripts/controller/actions/js_snippets/fill_core.py scripts/characterization/characterize-capture-element-xpath.py
git commit -m "fix: capture rebuilds durable xpath_smart instead of echoing write path"
```

---

### Task 3: Stamp gate — weak xpath cannot win

**Files:**
- Modify: `scripts/controller/actions/_helpers.py`
- Modify: `scripts/characterization/characterize-capture-element-xpath.py` (or new small characterize file)

**Interfaces:**
- Produces: `is_weak_xpath_smart(xp: str) -> bool`
- Produces: `stamp_recorded_xpath_smart(element, fallback="", *, inventory_validated=False) -> str`
  - Prefer non-empty capture `element.xpath_smart` when not weak
  - Else fallback only if `inventory_validated` or fallback is non-weak
  - Else `""`

- [ ] **Step 1: Failing tests for weak stamp**

```python
def test_stamp_rejects_weak_fallback() -> None:
    from scripts.controller.actions._helpers import stamp_recorded_xpath_smart, is_weak_xpath_smart

    weak = "//input[@placeholder='请输入'][1]"
    durable = (
        "//div[contains(@class,'el-dialog') or contains(@class,'el-message-box')]"
        "//div[contains(@class,'el-form-item')]"
        "[.//label[contains(normalize-space(.),'核心产品编号')]]//input"
    )
    assert_true(is_weak_xpath_smart(weak), "placeholder occurrence is weak")
    assert_true(not is_weak_xpath_smart(durable), "dialog+label is durable")
    assert_true(
        stamp_recorded_xpath_smart({"xpath_smart": durable}, weak) == durable,
        "capture durable wins",
    )
    assert_true(
        stamp_recorded_xpath_smart(None, weak) == "",
        "weak fallback alone → empty",
    )
    assert_true(
        stamp_recorded_xpath_smart({"xpath_smart": weak}, durable) == durable,
        "weak capture loses to durable inventory fallback when capture weak",
    )
```

Implement the last case explicitly: if capture is weak and fallback is durable, return fallback.

- [ ] **Step 2: Run — expect FAIL**

```bash
python scripts/characterization/characterize-capture-element-xpath.py
```

- [ ] **Step 3: Implement helpers**

```python
def is_weak_xpath_smart(xp: str) -> bool:
    s = (xp or "").strip()
    if not s:
        return True
    if "el-form-item" in s and "label" in s:
        return False
    if "placeholder" in s.lower() and "el-form-item" not in s:
        return True
    if re.fullmatch(r"//input(\[@placeholder=[^\]]+\])?(\[\d+\])?", s, re.I):
        return True
    return False


def stamp_recorded_xpath_smart(element, fallback: str = "") -> str:
    cap = ""
    if isinstance(element, dict):
        cap = (element.get("xpath_smart") or "").strip()
    fb = (fallback or "").strip()
    if cap and not is_weak_xpath_smart(cap):
        return cap
    if fb and not is_weak_xpath_smart(fb):
        return fb
    return ""
```

Ensure all `_form.py` call sites still use `stamp_recorded_xpath_smart(...)` (already wired).

- [ ] **Step 4: Run — expect OK**

```bash
python scripts/characterization/characterize-capture-element-xpath.py
python scripts/characterization/characterize-manual-dialog-scope.py
```

- [ ] **Step 5: Commit**

```bash
git add scripts/controller/actions/_helpers.py scripts/characterization/characterize-capture-element-xpath.py
git commit -m "fix: stamp rejects weak placeholder xpath_smart for params"
```

---

### Task 4: Prompt — forbid inventing any xpath

**Files:**
- Modify: `scripts/prompts/agent-tools-form.md`
- Modify: `scripts/prompts/agent-core.md` (one line if it only mentions dialog/drawer)

- [ ] **Step 1: Update form tools prompt**

Replace/extend the “禁止自造 dialog / drawer xpath” lines to:

```markdown
- **禁止自造任何 `xpath_smart`**（含 placeholder、`[n]` occurrence、dialog/drawer）。只能从扫描 / `get_pending_tasks` / `pending_items` **逐字复制**；省略 hint 时由工具解析 inventory。
```

- [ ] **Step 2: Add characterization cue (optional source assert)**

In `characterize-xpath-primary-ops.py` or a tiny assert in an existing prompt characterize:

```python
def test_prompt_forbids_invented_xpath() -> None:
    text = (ROOT / "scripts/prompts/agent-tools-form.md").read_text(encoding="utf-8")
    assert_true("禁止自造任何" in text or "禁止自造任何 `xpath_smart`" in text, "forbid all invented xpath")
    assert_true("placeholder" in text.lower() or "逐字复制" in text, "mentions copy-verbatim / placeholder")
```

- [ ] **Step 3: Commit**

```bash
git add scripts/prompts/agent-tools-form.md scripts/prompts/agent-core.md scripts/characterization/characterize-xpath-primary-ops.py
git commit -m "docs: prompt forbids inventing any xpath_smart including placeholder"
```

---

### Task 5: M1 verification + ops script note

**Files:**
- Verify only: `scripts/characterization/repair-traj-params-xpath.py` (already present)

- [ ] **Step 1: Run M1 suite**

```bash
python scripts/characterization/characterize-xpath-primary-ops.py
python scripts/characterization/characterize-capture-element-xpath.py
python scripts/characterization/characterize-manual-dialog-scope.py
python scripts/characterization/characterize-xpath-fill-select.py
python scripts/characterization/characterize-replay-params-xpath.py
```

Expected: all print `*: OK`

- [ ] **Step 2: Document ops repair in plan completion note (no code)**

Ops (already shipped):  
`python scripts/characterization/repair-traj-params-xpath.py --traj <id> [--apply]`

- [ ] **Step 3: Milestone 1 done checkpoint**

Do not start M2 until M1 suite is green and capture no longer echoes write xpath.

---

## Milestone 2 — Single algorithm source

### Task 6: Parity characterization (helpers vs builders)

**Files:**
- Create: `scripts/characterization/characterize-locator-parity.mjs`
- Read: `src/cdp/page-locator-helpers.js`, `src/cdp/locator-builders/controls.js`

**Interfaces:**
- Fixture cases: labeled input in dialog; labeled select in drawer; placeholder-only input (no label); bare page form-item

- [ ] **Step 1: Write failing parity harness**

Create `characterize-locator-parity.mjs` that:

1. Imports `buildFormFieldXPathSmart` / `scopedXPath` from `locator-builders`.
2. Evaluates the same cases through `PAGE_LOCATOR_HELPERS` + `formFieldXpathSmartOf` in Playwright (ephemeral page or CDP).
3. Asserts string equality for each case (normalize whitespace only).

Start with at least:

| Case | Expected family |
|------|-----------------|
| dialog + label `核心产品编号` + input | dialog scope + form-item + label + `//input` |
| drawer + label `证件类型` + select leaf | drawer scope + form-item + `el-select` |
| no label + placeholder `请输入账号` | scoped placeholder xpath (legitimate weak-less: has distinctive placeholder) |

- [ ] **Step 2: Run — expect FAIL if builders/`[last()]`/scope differ**

```bash
node scripts/characterization/characterize-locator-parity.mjs
```

- [ ] **Step 3: Align offline builders to helpers rules**

Modify `src/cdp/locator-builders/scope.js` / `controls.js` so `buildFormFieldXPathSmart` matches helpers for the fixture matrix (dialog/drawer prefix **without** `[last()]`, same label predicate). Prefer extracting shared predicate strings from one module imported by both, or generating builders from helpers — pick the **smallest** change that makes parity pass (YAGNI: shared `scopePrefix` + form-item template first; full codegen only if still drifting).

- [ ] **Step 4: Regenerate Python helpers if `page-locator-helpers.js` changed**

```bash
node scripts/_gen_locator_helpers_py.mjs
```

- [ ] **Step 5: Re-run parity + live e2e**

```bash
node scripts/characterization/characterize-locator-parity.mjs
node scripts/characterization/characterize-live-xpath-e2e.mjs
```

- [ ] **Step 6: Commit**

```bash
git add src/cdp/page-locator-helpers.js src/cdp/locator-builders scripts/controller/actions/js_snippets/_locator_helpers_js.py scripts/characterization/characterize-locator-parity.mjs
git commit -m "refactor: align offline form xpath builders with page-locator-helpers"
```

If `src/cdp` product-facing locator contract changed, also update `CHANGELOG.md` `[Unreleased]` per AGENTS.md.

---

### Task 7: M2 freeze — no hand-edit generated helpers

**Files:**
- Modify: `scripts/characterization/characterize-locator-parity.mjs` or add `characterize-locator-helpers-generated.py`

- [ ] **Step 1: Assert generated file header / regen cue**

```python
def test_locator_helpers_py_is_generated() -> None:
    p = ROOT / "scripts/controller/actions/js_snippets/_locator_helpers_js.py"
    text = p.read_text(encoding="utf-8")
    assert_true("Auto-generated" in text, "header marks generated")
    assert_true("_gen_locator_helpers_py" in text, "points to regen script")
```

- [ ] **Step 2: Commit**

```bash
git add scripts/characterization/characterize-locator-helpers-generated.py
git commit -m "test: lock PAGE_LOCATOR_HELPERS as generated from canonical JS"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Lookup-only resolve; no invented persist | Task 1 |
| Capture rebuild not echo | Task 2 |
| Stamp / weak xpath gate; params≡element | Task 3 |
| Prompt forbid invent any xpath | Task 4 |
| Ops repair script | Task 5 (verify) |
| Canonical `page-locator-helpers.js` | Task 6–7 |
| Offline builders converge | Task 6 |
| Replay params-first unchanged | Global constraint (no task edits `_resolve_replay_xpath` priority) |
| Keep agent `xpath_smart` arg | Global constraint |
| Characterization + wet | Tasks 1–6 |
| Two milestones | M1 = Tasks 1–5; M2 = Tasks 6–7 |

## Self-review notes

- Removed last-resort hint keep — matches spec “Forbidden” section (Task 1).
- Capture must embed helpers — documented duplicate `absXPath` hazard (Task 2).
- Weak stamp: empty preferred over dirty (Task 3).
- No TBD placeholders in steps.
- M2 deliberately smaller than a full codegen rewrite; parity-first.
