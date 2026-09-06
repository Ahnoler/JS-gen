# Select Option State Boundary Implementation Plan

> **Status:** Done 2026-08-11 on `V2.1_dev` (`79a8e92`). Branch `fix/select-option-state-boundary` was parallel granular history — **do not merge** (would regress later xpath/region/select-substr work). Retired 2026-08-12.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent an `option-not-found` select attempt from leaking open Element UI state into the next action, and recover once from a runtime-missing explicit xpath by using the unique scanned xpath.

**Architecture:** Add one shared browser-side select reset primitive and a Python wrapper used by recording and replay. Keep `_resolve_control` unchanged; direct recording performs a single, action-local fallback only after an actual `xpath-not-found`. Prompt rules serialize select operations so the code path is deterministic even before recovery is needed.

**Tech Stack:** Python 3.12, browser-use controller actions, Playwright `page.evaluate`, Element UI/Vue DOM snippets, source-based characterization scripts.

## Global Constraints

- Execute in an isolated worktree based on commit `8ba0d02`; do not copy parent-worktree table-row or first-stamp WIP into the task branch.
- Preserve public tool names, parameters, `ok:*` / `no-items` / `option-not-found:*` values, and replay exact-option semantics.
- Never substitute `params.options[0]` for a requested value.
- Do not change `_resolve_control`'s explicit-hint-wins contract.
- Recording xpath fallback is attempted only after `JS_SELECT_TRIGGER_BY_XPATH` returns `xpath-not-found`, and at most once.
- A select reset must not emit a bubbling Escape or a business `click` that could close the containing dialog/drawer.
- Changes are confined to `scripts/`; no `CHANGELOG.md` entry is required by `AGENTS.md`.
- Do not push.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `scripts/controller/actions/js_snippets/select_trigger.py` | Browser-side reset, trigger, and current-value primitives |
| `scripts/controller/actions/_js_snippets.py` | Compatibility re-export of `JS_RESET_SELECT_UI` |
| `scripts/controller/actions/_helpers.py` | Async `reset_select_ui(page)` wrapper |
| `scripts/controller/actions/_form.py` | Recording/autofill select boundaries and one runtime xpath fallback |
| `scripts/controller/actions/_replay.py` | Replay select boundaries without locator/value drift |
| `scripts/controller/actions/form_scan_utils.py` | Pure action-local fallback candidate resolver |
| `scripts/prompts/agent-tools-form.md` | One-select-per-step and recovery rules |
| `scripts/characterization/characterize-select-state-boundary.py` | Reset, orchestration, and prompt contracts |
| `scripts/characterization/characterize-xpath-primary-ops.py` | Runtime fallback candidate tests while retaining hint-wins |

---

### Task 1: Shared Select UI Reset Primitive

**Files:**
- Create: `scripts/characterization/characterize-select-state-boundary.py`
- Modify: `scripts/controller/actions/js_snippets/select_trigger.py`
- Modify: `scripts/controller/actions/_js_snippets.py`
- Modify: `scripts/controller/actions/_helpers.py`

**Interfaces:**
- Produces: `JS_RESET_SELECT_UI: str`
- Produces: `async reset_select_ui(page) -> dict`
- `reset_select_ui` result keys: `before: int`, `after: int`, `closed: bool`; on evaluation failure also `error: str`

- [ ] **Step 1: Write the failing reset-contract characterization**

Create `scripts/characterization/characterize-select-state-boundary.py`:

```python
#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_reset_js_contract() -> None:
    from scripts.controller.actions._js_snippets import JS_RESET_SELECT_UI

    js = JS_RESET_SELECT_UI
    assert_true("KeyboardEvent" in js and "Escape" in js, "non-business Escape reset")
    assert_true("bubbles: false" in js, "Escape must not bubble to dialog manager")
    assert_true("blur()" in js, "trigger blur")
    assert_true("mousedown" in js and "mouseup" in js, "Element UI clickoutside events")
    assert_true("document.body.click()" not in js, "must not issue business click")
    assert_true("window.__last_select_trigger = null" in js, "stale trigger cleared")
    assert_true("await sleep" in js, "condition polling")


def test_python_reset_wrapper() -> None:
    from scripts.controller.actions._helpers import reset_select_ui
    from scripts.controller.actions._js_snippets import JS_RESET_SELECT_UI

    class FakePage:
        async def evaluate(self, js):
            assert js == JS_RESET_SELECT_UI
            return {"before": 1, "after": 0, "closed": True}

    result = asyncio.run(reset_select_ui(FakePage()))
    assert_true(result == {"before": 1, "after": 0, "closed": True}, "wrapper result")


def main() -> int:
    test_reset_js_contract()
    test_python_reset_wrapper()
    print("characterize-select-state-boundary: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run the characterization and verify RED**

Run:

```bash
python scripts/characterization/characterize-select-state-boundary.py
```

Expected: FAIL importing `JS_RESET_SELECT_UI`.

- [ ] **Step 3: Add the browser-side reset primitive**

In `scripts/controller/actions/js_snippets/select_trigger.py`, immediately before `JS_SELECT_TRIGGER_BY_XPATH`, add:

```python
JS_RESET_SELECT_UI = r'''async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visibleDropdowns = () => [...document.querySelectorAll('.el-select-dropdown')]
    .filter((dd) => {
      if (dd.classList.contains('is-hidden')) return false;
      const style = getComputedStyle(dd);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = dd.getBoundingClientRect();
      return rect.width > 0;
    });

  const before = visibleDropdowns().length;
  const trigger = window.__last_select_trigger || null;
  if (trigger) {
    try {
      trigger.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
        which: 27,
        bubbles: false,
        cancelable: true,
      }));
    } catch (e) {}
    try { trigger.blur(); } catch (e) {}
  }

  const outside = document.body || document.documentElement;
  if (outside) {
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    outside.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }
  window.__last_select_trigger = null;

  for (let i = 0; i < 10 && visibleDropdowns().length > 0; i += 1) {
    await sleep(50);
  }
  const after = visibleDropdowns().length;
  return { before, after, closed: after === 0 };
}'''
```

In `scripts/controller/actions/_js_snippets.py`, extend the select-trigger import:

```python
from .js_snippets.select_trigger import (
    JS_FIND_LABELED_SELECT,
    JS_FIND_VISIBLE_DROPDOWN,
    JS_RESET_SELECT_UI,
    JS_SELECT_TRIGGER_BY_XPATH,
    JS_SELECT_VALUE_BY_XPATH,
)
```

- [ ] **Step 4: Add the Python reset wrapper**

In `scripts/controller/actions/_helpers.py`, import `JS_RESET_SELECT_UI`:

```python
from ._js_snippets import (
    JS_CHECK_LOADING, JS_WAIT_LOADING,
    JS_ENRICH_CLICK_LOCATOR,
    JS_READ_SELECT_OPTIONS,
    JS_RESET_SELECT_UI,
)
```

Add after `read_select_options`:

```python
async def reset_select_ui(page) -> dict:
    """Close Element UI select state without issuing a business click."""
    try:
        raw = await page.evaluate(JS_RESET_SELECT_UI)
        if isinstance(raw, dict):
            return {
                'before': int(raw.get('before', 0) or 0),
                'after': int(raw.get('after', 0) or 0),
                'closed': bool(raw.get('closed')),
            }
        return {'before': -1, 'after': -1, 'closed': False, 'error': 'invalid-reset-result'}
    except Exception as exc:
        return {'before': -1, 'after': -1, 'closed': False, 'error': str(exc)}
```

- [ ] **Step 5: Run Task 1 tests**

Run:

```bash
python scripts/characterization/characterize-select-state-boundary.py
python scripts/characterization/characterize-xpath-fill-select.py
```

Expected:

```text
characterize-select-state-boundary: OK
characterize-xpath-fill-select: OK
```

- [ ] **Step 6: Commit Task 1**

```bash
git add scripts/characterization/characterize-select-state-boundary.py scripts/controller/actions/js_snippets/select_trigger.py scripts/controller/actions/_js_snippets.py scripts/controller/actions/_helpers.py
git commit -m "feat: add shared select UI reset boundary"
```

---

### Task 2: Apply Reset Boundaries to Recording, Autofill, and Replay

**Files:**
- Modify: `scripts/characterization/characterize-select-state-boundary.py`
- Modify: `scripts/controller/actions/_form.py`
- Modify: `scripts/controller/actions/_replay.py`

**Interfaces:**
- Consumes: `async reset_select_ui(page) -> dict` from Task 1
- Produces: select paths that reset before opening and before returning final failure
- Preserves: all existing external action result strings

- [ ] **Step 1: Extend the characterization with failing orchestration assertions**

Add to `characterize-select-state-boundary.py`:

```python
def test_recording_and_replay_use_reset_boundary() -> None:
    form = (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
    replay = (ROOT / "scripts/controller/actions/_replay.py").read_text(encoding="utf-8")

    direct = form.split("async def select_option(", 1)[1].split(
        "async def click_adjacent_button", 1
    )[0]
    autofill = form.split("async def _select_by_xpath", 1)[1].split(
        "KIND_ORDER", 1
    )[0]
    replay_select = replay.split("if action_name == 'select_option':", 1)[1].split(
        "return f'unknown-form-action", 1
    )[0]

    assert_true("reset_select_ui" in direct, "direct recording reset")
    assert_true("reset_select_ui" in autofill, "autofill reset")
    assert_true("reset_select_ui" in replay_select, "replay reset")
    assert_true("_JS_CLOSE_SELECT_POPPERS" not in replay_select, "remove CSS-only replay close")
    assert_true("dd.style.display = 'none'" not in direct, "remove CSS-only recording close")
```

Call it from `main()`.

- [ ] **Step 2: Run the characterization and verify RED**

Run:

```bash
python scripts/characterization/characterize-select-state-boundary.py
```

Expected: FAIL at `direct recording reset`.

- [ ] **Step 3: Wire the direct recording select boundary**

In `_form.py`, add `reset_select_ui` to the `_helpers` import.

Within direct `select_option`, call:

```python
reset_diag = await reset_select_ui(page)
if not reset_diag.get('closed', False) and reset_diag.get('after', 0):
    sys.stderr.write(f'[select] preflight reset incomplete: {reset_diag}\n')
    sys.stderr.flush()
```

Place this before `JS_SELECT_VALUE_BY_XPATH`. Delete the existing block that writes
`dd.style.display = 'none'` and calls `document.body.click()`.

Before every final failure return, reset and log without changing the result:

```python
async def _final_select_failure(result_text: str) -> str:
    diag = await reset_select_ui(page)
    sys.stderr.write(
        f'[select] final failure label={label_text!r} option={option_text!r} '
        f'xpath={xp!r} result={result_text!r} reset={diag}\n'
    )
    sys.stderr.flush()
    return result_text
```

Use it as follows:

```python
if trigger_result in (
    'label-not-found',
    'no-select-found',
    'select-disabled',
    'xpath-not-found',
    'xpath-empty',
    'field-disabled',
):
    failed = await _final_select_failure(str(trigger_result))
    if trigger_result == 'no-select-found':
        return _err(failed + ' | field may be radio — use click_radio')
    return failed
```

For `no-items`, keep the existing current-value recheck; only if that recheck is not
`ok-already:*`:

```python
failed = await _final_select_failure('no-items')
return _err(failed)
```

For `option-not-found`, do not reset before the existing fuzzy attempt. Use these
exact final branches:

```python
if retries >= 3:
    first_result = await page.evaluate(JS_SELECT_OPTION, 'first')
    if _is_ok_result(first_result):
        matched_text = (
            first_result.split(':', 1)[1] if ':' in first_result else first_result
        )
        case_data_store.pop(f'_sel_retry_{label_text}', None)
        params['option_text'] = matched_text or option_text
        params['xpath_smart'] = xp
        _record_action('select_option', params, matched_text, element=element)
        _task_done_impl(
            label_text,
            case_data_store,
            value=matched_text or option_text,
            xpath_smart=xp,
        )
        return _ok(_with_submit_cue(f'ok | {matched_text}', case_data_store))
    failed = await _final_select_failure(str(first_result))
    return _err(failed)
failed = await _final_select_failure(str(select_result))
return _err(failed)
```

The generic final `else` branch uses the same helper.

- [ ] **Step 4: Wire autofill select boundaries**

In nested `_select_by_xpath`:

```python
await reset_select_ui(page)
```

must run before the current-value read and trigger.

After the in-place `option-not-found → first` attempt and the `no-items` current-value
recheck, reset only if the final result is non-`ok`:

```python
if not _is_ok_result(str(result)):
    diag = await reset_select_ui(page)
    sys.stderr.write(
        f'[auto-fill] select failure xpath={xp!r} result={result!r} reset={diag}\n'
    )
    sys.stderr.flush()
return result
```

In the generic fill-then-select fallback, call `_select_by_xpath(page, fill_val,
xpath_smart)` instead of duplicating trigger / option logic:

```python
sel_result = await _select_by_xpath(page, fill_val, xpath_smart)
if _is_ok_result(sel_result):
    result = sel_result
    kind = 'select_option'
    field_kind = 'select'
    capture_kind = 'form_select'
    element = await _capture_element(
        page, label, target_kind='form_select', xpath_smart=xpath_smart,
    )
```

- [ ] **Step 5: Wire replay select boundaries**

In `_replay.py`, import `reset_select_ui` from `_helpers`. Remove
`_JS_CLOSE_SELECT_POPPERS` and `_close_select_poppers`.

In both `_select_by_xpath` and `_select_by_label`:

```python
await reset_select_ui(page)
```

runs before opening a target.

For each `no-items` retry, reset before re-triggering:

```python
if result == 'no-items' and attempt < 2:
    await reset_select_ui(page)
    retrigger = await page.evaluate(JS_SELECT_TRIGGER_BY_XPATH, [xpath])
    if not _is_ok_result(str(retrigger)):
        result = str(retrigger)
        break
```

Use `JS_FIND_LABELED_SELECT` instead of the xpath trigger in the label variant.

Before returning a final non-`ok` result from either helper:

```python
diag = await reset_select_ui(page)
sys.stderr.write(
    f'[replay-select] final failure label={label!r} option={pick!r} '
    f'result={result!r} reset={diag}\n'
)
sys.stderr.flush()
return str(result)
```

Do not alter exact-only `[pick, True]`, `option-mismatch`, value confirmation, or
locator order.

- [ ] **Step 6: Run Task 2 tests**

Run:

```bash
python scripts/characterization/characterize-select-state-boundary.py
python scripts/characterization/characterize-xpath-fill-select.py
python scripts/characterization/characterize-select-lazy-load.py
```

Expected: all three print `OK`.

- [ ] **Step 7: Commit Task 2**

```bash
git add scripts/characterization/characterize-select-state-boundary.py scripts/controller/actions/_form.py scripts/controller/actions/_replay.py
git commit -m "fix: reset select state at action boundaries"
```

---

### Task 3: Add One Runtime XPath Fallback for Direct Recording

**Files:**
- Modify: `scripts/characterization/characterize-xpath-primary-ops.py`
- Modify: `scripts/controller/actions/form_scan_utils.py`
- Modify: `scripts/controller/actions/_form.py`

**Interfaces:**
- Produces: `resolve_select_fallback(case_data_store, label_text: str, failed_xpath: str) -> ResolvedControl | None`
- Consumes: existing `_resolve_control(case_data_store, label_text, "")`
- Direct recording writes the fallback xpath only when that xpath actually triggers successfully

- [ ] **Step 1: Write failing fallback-candidate tests**

In `characterize-xpath-primary-ops.py`, import `resolve_select_fallback` and add:

```python
def test_select_runtime_fallback_unique_inventory() -> None:
    drawer_xp = (
        "//div[contains(@class,'el-drawer')]"
        "//div[contains(@class,'el-form-item')][.//label[contains(.,'证件类型')]]"
        "//div[contains(@class,'el-select')]"
    )
    bad_dialog_xp = drawer_xp.replace("el-drawer", "el-dialog")
    store = {
        "task_list": TaskList(
            pending=[TaskItem(label="证件类型", kind="select", xpath_smart=drawer_xp)]
        ).to_store(),
        "_scan_fields": [],
    }
    fallback = resolve_select_fallback(store, "证件类型", bad_dialog_xp)
    assert_true(fallback is not None, "unique inventory fallback")
    assert_true(fallback.xpath_smart == drawer_xp, "drawer xpath returned")


def test_select_runtime_fallback_rejects_same_or_ambiguous() -> None:
    xp = "//form//div[contains(@class,'el-select')]"
    same_store = {
        "task_list": TaskList(
            pending=[TaskItem(label="证件类型", kind="select", xpath_smart=xp)]
        ).to_store(),
        "_scan_fields": [],
    }
    assert_true(resolve_select_fallback(same_store, "证件类型", xp) is None, "same xpath")

    ambiguous_store = {
        "task_list": TaskList(
            pending=[
                TaskItem(label="证件类型", kind="select", xpath_smart=xp + "[1]"),
                TaskItem(label="证件类型", kind="select", xpath_smart=xp + "[2]"),
            ]
        ).to_store(),
        "_scan_fields": [],
    }
    assert_true(
        resolve_select_fallback(ambiguous_store, "证件类型", "//bad") is None,
        "ambiguous inventory",
    )
```

Call both tests from `main()`. Do not change `test_resolve_hint_wins`.

- [ ] **Step 2: Run the characterization and verify RED**

Run:

```bash
python scripts/characterization/characterize-xpath-primary-ops.py
```

Expected: FAIL importing `resolve_select_fallback`.

- [ ] **Step 3: Implement the pure fallback resolver**

In `form_scan_utils.py`, immediately after `_resolve_control`, add:

```python
def resolve_select_fallback(
    case_data_store,
    label_text: str,
    failed_xpath: str,
) -> ResolvedControl | None:
    """Return one inventory xpath after an explicit xpath actually missed."""
    failed = (failed_xpath or "").strip()
    candidate = _resolve_control(case_data_store, label_text, "")
    if candidate.error or not candidate.xpath_smart:
        return None
    if candidate.xpath_smart.strip() == failed:
        return None
    return candidate
```

- [ ] **Step 4: Wire one fallback into direct `select_option`**

Import `resolve_select_fallback` in `_form.py`.

Replace the single trigger call with:

```python
trigger_result = await page.evaluate(JS_SELECT_TRIGGER_BY_XPATH, [xp])
if trigger_result == 'xpath-not-found':
    fallback = resolve_select_fallback(case_data_store, label_text, xp)
    if fallback is not None:
        await reset_select_ui(page)
        xp = fallback.xpath_smart
        label_text = fallback.label or label_text
        trigger_result = await page.evaluate(JS_SELECT_TRIGGER_BY_XPATH, [xp])
        if _is_ok_result(str(trigger_result)):
            element = await _capture_element(
                page,
                label_text,
                target_kind='form_select',
                xpath_smart=xp,
            )
            sys.stderr.write(
                f'[select] xpath fallback success label={label_text!r} xpath={xp!r}\n'
            )
            sys.stderr.flush()
```

Do not loop. The existing trigger-failure branch handles a failed fallback. The later
`params['xpath_smart'] = xp`, `_record_action`, and `_task_done_impl` calls must use the
updated `xp`.

- [ ] **Step 5: Extend source wiring characterization**

In `characterize-select-state-boundary.py`, add:

```python
def test_direct_select_wires_runtime_fallback_only() -> None:
    form = (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
    utils = (ROOT / "scripts/controller/actions/form_scan_utils.py").read_text(
        encoding="utf-8"
    )
    direct = form.split("async def select_option(", 1)[1].split(
        "async def click_adjacent_button", 1
    )[0]
    assert_true("resolve_select_fallback" in direct, "direct select fallback")
    assert_true("trigger_result == 'xpath-not-found'" in direct, "runtime-miss gate")
    assert_true("def resolve_select_fallback" in utils, "pure fallback helper")
```

Call it from `main()`.

- [ ] **Step 6: Run Task 3 tests**

Run:

```bash
python scripts/characterization/characterize-xpath-primary-ops.py
python scripts/characterization/characterize-select-state-boundary.py
python scripts/characterization/characterize-xpath-fill-select.py
```

Expected: all three print `OK`, including the unchanged `hint wins` assertion.

- [ ] **Step 7: Commit Task 3**

```bash
git add scripts/characterization/characterize-xpath-primary-ops.py scripts/characterization/characterize-select-state-boundary.py scripts/controller/actions/form_scan_utils.py scripts/controller/actions/_form.py
git commit -m "fix: recover select from one runtime xpath miss"
```

---

### Task 4: Serialize Agent Select Calls and Run Full Regression

**Files:**
- Modify: `scripts/prompts/agent-tools-form.md`
- Modify: `scripts/characterization/characterize-select-state-boundary.py`

**Interfaces:**
- Produces: explicit one-select-per-step policy
- Produces: recovery wording for `xpath-not-found` and `no-items`

- [ ] **Step 1: Write failing prompt assertions**

Add to `characterize-select-state-boundary.py`:

```python
def test_prompt_serializes_select_and_forbids_invented_xpath() -> None:
    prompt = (ROOT / "scripts/prompts/agent-tools-form.md").read_text(encoding="utf-8")
    assert_true("每步最多 1 个 select_option" in prompt, "one select per step")
    assert_true("禁止自造 dialog / drawer xpath" in prompt, "no invented container xpath")
    assert_true("禁止用 `click_element_by_index` 点 el-option" in prompt, "no index option")
```

Call it from `main()`.

- [ ] **Step 2: Run the characterization and verify RED**

Run:

```bash
python scripts/characterization/characterize-select-state-boundary.py
```

Expected: FAIL at `one select per step`.

- [ ] **Step 3: Replace the contradictory prompt rule**

In `scripts/prompts/agent-tools-form.md`, replace the “2～3 个 select_option” line with:

```markdown
- **每步最多 1 个 select_option**：下拉打开/关闭会改变页面状态，禁止在同一 action 列表中连续选择多个字段。`xpath-not-found` 后只能复制新 scan 中的 `xpath_smart`，或省略 hint 让工具解析；**禁止自造 dialog / drawer xpath**。`no-items` 后禁止用 `click_element_by_index` 点 el-option；重新扫描后最多再调用一次 `select_option`。
```

- [ ] **Step 4: Run the complete isolated regression suite**

Run:

```bash
python scripts/characterization/characterize-select-state-boundary.py
python scripts/characterization/characterize-select-lazy-load.py
python scripts/characterization/characterize-xpath-primary-ops.py
python scripts/characterization/characterize-xpath-fill-select.py
node scripts/characterization/characterize-ctrl.mjs
```

Expected: every command exits `0` and prints `OK` / PASS. The parent-only
`characterize-select-table-row.py` does not exist at base `8ba0d02` and is intentionally
deferred to Task 5 after integration.

- [ ] **Step 5: Run syntax/import checks**

Run:

```bash
python -m py_compile scripts/controller/actions/js_snippets/select_trigger.py scripts/controller/actions/_js_snippets.py scripts/controller/actions/_helpers.py scripts/controller/actions/form_scan_utils.py scripts/controller/actions/_form.py scripts/controller/actions/_replay.py
```

Expected: exit `0`, no output.

- [ ] **Step 6: Commit Task 4**

```bash
git add scripts/prompts/agent-tools-form.md scripts/characterization/characterize-select-state-boundary.py
git commit -m "docs: serialize agent select operations"
```

---

### Task 5: Review, Parent-WIP Compatibility, and Wet-Test Handoff

**Files:**
- No new implementation files
- Parent worktree compatibility checks only after reviewing the isolated branch

**Interfaces:**
- Consumes: the four isolated commits from Tasks 1–4
- Produces: reviewed patch and explicit wet-test status

- [ ] **Step 1: Verify the isolated branch contains only scoped files**

Run:

```bash
git status --short
git log --oneline 8ba0d02..HEAD
git diff --stat 8ba0d02...HEAD
```

Expected: clean status; focused task commits plus reviewed fix commits; only files listed by Tasks 1–4.

- [ ] **Step 2: Review invariants in the final diff**

Run:

```bash
git diff 8ba0d02...HEAD -- scripts/controller/actions/js_snippets/select_trigger.py scripts/controller/actions/_helpers.py scripts/controller/actions/_form.py scripts/controller/actions/_replay.py scripts/controller/actions/form_scan_utils.py scripts/prompts/agent-tools-form.md
```

Confirm:

- no `options[0]` substitution;
- no edit to `_resolve_control`;
- no bubbling Escape or `document.body.click()`;
- no replay locator fallback;
- final failures reset state;
- direct recording records the successful fallback xpath.

- [ ] **Step 3: Report wet-test availability**

Check:

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:9242/json/version' -TimeoutSec 3
```

If unavailable, report wet test as deferred without changing code.

If available, run these product actions manually:

1. Open a form with a stable el-select.
2. Request one impossible value; expect `option-not-found:*`.
3. Immediately request a valid value; expect `ok`, not `no-items`.
4. On a drawer select, pass a wrong dialog xpath while the scan has one drawer xpath;
   expect one fallback and an action log containing the drawer xpath.
5. Re-run the new-customer phase and confirm no index el-option click and no
   `pending_fields:证件类型`.

- [ ] **Step 4: Parent-worktree compatibility after patch integration**

After the parent agent merges the reviewed patch while preserving table-row / first-stamp
WIP, run:

```bash
python scripts/characterization/characterize-select-option-stamp.py
python scripts/characterization/characterize-select-table-row.py
python scripts/characterization/characterize-select-state-boundary.py
python scripts/characterization/characterize-xpath-primary-ops.py
python scripts/characterization/characterize-xpath-fill-select.py
node scripts/characterization/characterize-ctrl.mjs
```

Expected: every available command exits `0`. If the parent-only stamp characterization is
not present in the isolated worktree, that is expected; it is required only after integration.

---

## Execution Notes

- Use one fresh subagent per task and review each commit before starting the next task.
- The implementer must not “clean up” unrelated `_form.py` code; the separate
  `form-actions-split` backlog owns that refactor.
- Automated characterizations prove wiring and contracts. The two-step
  `option-not-found → valid option` live sequence is the final evidence that Vue state is
  actually reset.
