# XPath-primary control ops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Locate and operate visible editable controls by relative `xpath_smart`; keep synthesized semantic label (`label || placeholder`) only for value generation, rules, and recording — delivered as Phase A (execution hard-cut) then Phase B (Agent optional `xpath_smart`).

**Architecture:** Introduce `_resolve_control(label, xpath_hint, store) → ResolvedControl`. All write paths resolve first, then call xpath-only JS helpers; never locate via DOM label on success paths. Scan continues to emit `{xpath_smart, label}` pairs (label already `label||placeholder` in Source A; verify/harden). Phase B adds optional `xpath_smart` on Agent actions + prompt.

**Tech Stack:** Python 3 agent (`scripts/actions/_form.py`), `_js_snippets.py`, Pydantic models, characterization scripts, `scripts/prompts/agent-prompt.md`.

**Spec:** `docs/superpowers/archive/specs/2026-08-07-xpath-primary-control-ops-design.md`

## 分层总览（LV）

| 层 | 中文名 | 交付物 | Task |
|----|--------|--------|------|
| **L1** | Resolve gate | `_resolve_control` + 错误码 + 表征 | Task 1 |
| **L2** | Scan 语义名 | `display_label = label \|\| placeholder` 门禁 | Task 2 |
| **L3** | Phase A 写路径 | fill/select/date/radio/checkbox + 助手回合硬切 xpath | Task 3 |
| **L4** | Phase B Agent | 可选 `xpath_smart` 参数 + 录制双键 | Task 4 |
| **L5** | Prompt / 验收 | agent-prompt + CHANGELOG + 全表征绿 | Task 5 |

```
L1 resolve ──► L3 Phase A writes
L2 scan label ─┘         │
                         ▼
                   L4 Phase B API
                         │
                         ▼
                   L5 prompt / CHANGELOG
```

## Global Constraints

- Public action **names** unchanged (`fill_form_field`, `select_option`, …).
- Locate key = relative `xpath_smart`; semantic key = synthesized `display_label`.
- Exact label match only; **no** fuzzy short-label match; **no** DOM label locate after resolve.
- Same semantic label + distinct xpaths → `ambiguous-label` (do not click).
- Placeholder is **not** a second resolve channel; it folds into `display_label` at scan (Option A).
- Login hardcoded fills: leave unless they block tests.
- `CTRL.selectOption` lazy-load: out of scope.
- `docs/` is gitignored — commit only `scripts/` / `CHANGELOG.md` / prompts when user asks.
- TDD: characterization red → green per task.
- Scripts-only: CHANGELOG optional but record under Changed for Agent/prompt contract (match recent practice).

## File map

| File | Role |
|------|------|
| `scripts/actions/_form.py` | `_resolve_control`, hard-cut writes, Phase B params |
| `scripts/actions/_js_snippets.py` | Scan `displayLabel` assert/harden if gaps; no new locate-by-label |
| `scripts/actions/_llm_values.py` | Put `xpath_smart` on generated actions |
| `scripts/prompts/agent-prompt.md` | Prefer xpath from scan/task |
| `scripts/characterization/characterize-xpath-primary-ops.py` | New gate (create) |
| `scripts/characterization/characterize-xpath-fill-select.py` | Extend markers |
| `CHANGELOG.md` | Unreleased Changed entry |

---

### Task 1（L1）：`_resolve_control` resolve gate

**Files:**
- Modify: `scripts/actions/_form.py` (replace `_task_xpath_smart` callers gradually; keep thin wrapper if needed)
- Create: `scripts/characterization/characterize-xpath-primary-ops.py`

**Interfaces:**
- Produces:
```python
@dataclass(frozen=True)
class ResolvedControl:
    xpath_smart: str
    label: str
    error: str = ""  # "", "xpath-not-found", "ambiguous-label"
```
- `def _resolve_control(case_data_store, label_text: str, xpath_hint: str = "") -> ResolvedControl`
- Consumes: `case_data_store["task_list"]`, `case_data_store["_scan_fields"]` items with `.label` / `xpath_smart`

- [ ] **Step 1: Write failing characterization**

Create `scripts/characterization/characterize-xpath-primary-ops.py`:

```python
#!/usr/bin/env python3
"""Characterize xpath-primary resolve gate + write hard-cut markers."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.actions._form import ResolvedControl, _resolve_control  # noqa: E402
from scripts.models.task import TaskItem, TaskList  # noqa: E402


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_resolve_hint_wins() -> None:
    store = {"task_list": TaskList().to_store(), "_scan_fields": []}
    r = _resolve_control(store, "任意", xpath_hint="//div[@id='x']//input")
    assert_true(r.error == "" and r.xpath_smart.endswith("input"), "hint wins")
    assert_true(isinstance(r, ResolvedControl), "ResolvedControl type")


def test_resolve_unique_label() -> None:
    tl = TaskList(
        pending=[
            TaskItem(label="手机号", kind="input", xpath_smart="//form//input[1]"),
        ]
    )
    store = {"task_list": tl.to_store(), "_scan_fields": []}
    r = _resolve_control(store, "手机号")
    assert_true(r.error == "" and r.xpath_smart == "//form//input[1]", "unique ok")
    assert_true(r.label == "手机号", "label preserved")


def test_resolve_not_found() -> None:
    store = {"task_list": TaskList().to_store(), "_scan_fields": []}
    r = _resolve_control(store, "不存在")
    assert_true(r.error == "xpath-not-found", "missing → xpath-not-found")


def test_resolve_ambiguous() -> None:
    tl = TaskList(
        pending=[
            TaskItem(label="评级", kind="select", xpath_smart="//div[@id='a']//div[contains(@class,'el-select')]"),
            TaskItem(label="评级", kind="select", xpath_smart="//div[@id='b']//div[contains(@class,'el-select')]"),
        ]
    )
    store = {"task_list": tl.to_store(), "_scan_fields": []}
    r = _resolve_control(store, "评级")
    assert_true(r.error == "ambiguous-label", "dup labels → ambiguous-label")


def test_resolve_duplicate_same_xpath() -> None:
    xp = "//div[@id='same']//input"
    tl = TaskList(
        pending=[
            TaskItem(label="备注", kind="input", xpath_smart=xp),
            TaskItem(label="备注", kind="input", xpath_smart=xp),
        ]
    )
    store = {"task_list": tl.to_store(), "_scan_fields": []}
    r = _resolve_control(store, "备注")
    assert_true(r.error == "" and r.xpath_smart == xp, "identical xpath not ambiguous")


def main() -> int:
    test_resolve_hint_wins()
    test_resolve_unique_label()
    test_resolve_not_found()
    test_resolve_ambiguous()
    test_resolve_duplicate_same_xpath()
    form = (ROOT / "scripts/actions/_form.py").read_text(encoding="utf-8")
    assert_true("def _resolve_control" in form, "_resolve_control defined")
    print("characterize-xpath-primary-ops: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
python scripts/characterization/characterize-xpath-primary-ops.py
```

Expected: `ImportError` or `AssertionError` (`_resolve_control` missing).

- [ ] **Step 3: Implement `_resolve_control`**

In `scripts/actions/_form.py` near current `_task_xpath_smart` (~375):

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class ResolvedControl:
    xpath_smart: str
    label: str
    error: str = ""


def _resolve_control(case_data_store, label_text: str, xpath_hint: str = "") -> ResolvedControl:
    label = (label_text or "").strip()
    hint = (xpath_hint or "").strip()
    if hint:
        resolved_label = label
        for f in case_data_store.get("_scan_fields") or []:
            if isinstance(f, dict) and (f.get("xpath_smart") or "").strip() == hint:
                resolved_label = (f.get("label") or label).strip() or label
                break
        if resolved_label == label:
            tl = TaskList.from_store(case_data_store.get("task_list"))
            for item in list(tl.pending) + list(tl.done):
                if (item.xpath_smart or "").strip() == hint and (item.label or "").strip():
                    resolved_label = item.label.strip()
                    break
        return ResolvedControl(xpath_smart=hint, label=resolved_label or label, error="")

    matches: list[tuple[str, str]] = []
    seen_xp: set[str] = set()
    tl = TaskList.from_store(case_data_store.get("task_list"))
    for item in list(tl.pending) + list(tl.done):
        if item.label == label_text and (item.xpath_smart or "").strip():
            xp = item.xpath_smart.strip()
            if xp not in seen_xp:
                seen_xp.add(xp)
                matches.append((xp, item.label))
    for f in case_data_store.get("_scan_fields") or []:
        if not isinstance(f, dict):
            continue
        if f.get("label") != label_text:
            continue
        xp = (f.get("xpath_smart") or "").strip()
        if xp and xp not in seen_xp:
            seen_xp.add(xp)
            matches.append((xp, str(f.get("label") or label_text)))

    if not matches:
        return ResolvedControl(xpath_smart="", label=label_text or "", error="xpath-not-found")
    if len(matches) == 1:
        xp, lab = matches[0]
        return ResolvedControl(xpath_smart=xp, label=lab, error="")
    return ResolvedControl(xpath_smart="", label=label_text or "", error="ambiguous-label")


def _task_xpath_smart(case_data_store, label_text: str, xpath_hint: str = "") -> str:
    """Compat wrapper — prefer _resolve_control; returns xpath or '' (not error codes)."""
    r = _resolve_control(case_data_store, label_text, xpath_hint)
    return r.xpath_smart if not r.error else ""
```

Note: keep `_task_xpath_smart` as thin wrapper for `_task_done_impl` until Task 3 migrates call sites; **do not** use wrapper alone for write paths (loses error codes).

- [ ] **Step 4: Run test — expect PASS**

```bash
python scripts/characterization/characterize-xpath-primary-ops.py
```

Expected: `characterize-xpath-primary-ops: OK`

- [ ] **Step 5: Commit** (only if user asked)

```bash
git add scripts/actions/_form.py scripts/characterization/characterize-xpath-primary-ops.py
git commit -m "feat: add _resolve_control for xpath-primary field ops"
```

---

### Task 2（L2）：Scan synthesized `display_label`

**Files:**
- Modify: `scripts/actions/_js_snippets.py` (only if Source B / edge gaps)
- Modify: `scripts/characterization/characterize-xpath-primary-ops.py`

**Interfaces:**
- Consumes: existing Source A `displayLabel = label || placeholder` (~2006–2022)
- Produces: characterization asserting Source A and table path can use placeholder when label empty

- [ ] **Step 1: Extend characterization**

Append to `characterize-xpath-primary-ops.py`:

```python
def test_scan_display_label_markers() -> None:
    js = (ROOT / "scripts/actions/_js_snippets.py").read_text(encoding="utf-8")
    assert_true(
        "const displayLabel = label || placeholder || ''" in js
        or "displayLabel = label || placeholder" in js,
        "Source A synthesizes displayLabel from placeholder",
    )
    assert_true(
        "buildTableDisplayName" in js and "placeholder" in js,
        "table display name can use placeholder",
    )
```

Call it from `main()`.

- [ ] **Step 2: Run — expect PASS if already present, else FAIL**

```bash
python scripts/characterization/characterize-xpath-primary-ops.py
```

- [ ] **Step 3: Fix gaps only if FAIL**

If Source A marker drifts, restore:

```javascript
const displayLabel = label || placeholder || '';
const field = { label: displayLabel, kind, /* ... */, placeholder, xpath_smart };
```

If a path still pushes empty `label` when placeholder exists, set `label: displayLabel` before `pushField`.

Do **not** add a second resolve key on raw placeholder.

- [ ] **Step 4: Re-run — PASS**

- [ ] **Step 5: Commit** (if user asked)

```bash
git add scripts/actions/_js_snippets.py scripts/characterization/characterize-xpath-primary-ops.py
git commit -m "fix: ensure scan display_label uses placeholder fallback"
```

---

### Task 3（L3）：Phase A — write-path hard-cut

**Files:**
- Modify: `scripts/actions/_form.py` (`fill_form_field`, `fill_date_field`, `select_option`, `click_radio`, `_execute_round` / `_select_by_xpath_or_label`)
- Modify: `scripts/actions/_llm_values.py` (attach `xpath_smart` on each generated action)
- Modify: `scripts/characterization/characterize-xpath-primary-ops.py`
- Modify: `scripts/characterization/characterize-xpath-fill-select.py` (optional marker)

**Interfaces:**
- Consumes: `_resolve_control` → on `error` return that string; on ok use `r.xpath_smart` / `r.label`
- Produces: no `JS_FILL_FORM_FIELD` / `JS_FIND_LABELED_*` / `JS_CLICK_RADIO` / `JS_FILL_DATE_FIELD` on **resolved success paths** for those kinds (tree-select / login exempt)

- [ ] **Step 1: Add hard-cut markers to characterization**

```python
def test_phase_a_hardcut_markers() -> None:
    form = (ROOT / "scripts/actions/_form.py").read_text(encoding="utf-8")
    assert_true(
        "ambiguous-label" in form and "xpath-not-found" in form,
        "write paths surface resolve errors",
    )
    assert_true("JS_FILL_BY_XPATH" in form, "xpath fill used")


def test_llm_actions_carry_xpath() -> None:
    src = (ROOT / "scripts/actions/_llm_values.py").read_text(encoding="utf-8")
    assert_true("xpath_smart" in src, "_llm_values attaches xpath_smart to actions")
```

- [ ] **Step 2: Run — expect FAIL** (markers / missing xpath in `_llm_values`)

- [ ] **Step 3: Wire `fill_form_field` / `fill_date_field`**

```python
async def fill_form_field(label_text: str, value: str, xpath_smart: str = ""):
    page = await browser_context.get_current_page()
    await _wait_if_loading(page)
    await _ensure_scanned(label_text)
    resolved = _resolve_control(case_data_store, label_text, xpath_smart)
    if resolved.error:
        return resolved.error
    element = await _capture_element(page, resolved.label, target_kind='form_input')
    result = await page.evaluate(JS_FILL_BY_XPATH, [resolved.xpath_smart, value, resolved.label])
    if _is_ok_result(result):
        _record_action(
            'fill_form_field',
            {'label_text': resolved.label, 'value': value, 'xpath_smart': resolved.xpath_smart},
            result,
            element=element,
        )
        if not _is_query_mode(case_data_store):
            _task_done_impl(
                resolved.label, case_data_store, value=value, xpath_smart=resolved.xpath_smart,
            )
        return _ok(_with_submit_cue(result, case_data_store))
    return _with_submit_cue(result, case_data_store)
```

Same for `fill_date_field` with `JS_FILL_DATE_BY_XPATH` only (no `JS_FILL_DATE_FIELD` fallback).

- [ ] **Step 4: Hard-cut `select_option`**

1. `resolved = _resolve_control(...)`; if error, return it.
2. Do not use `JS_FIND_LABELED_SELECT` for locate/trigger.
3. `trigger_result = await page.evaluate(JS_SELECT_TRIGGER_BY_XPATH, [resolved.xpath_smart])`
4. For `no-items` recheck, do not use labeled check.
5. Record params include `xpath_smart`.

- [ ] **Step 5: Hard-cut `click_radio`**

```python
resolved = _resolve_control(case_data_store, label_text, xpath_smart)
if resolved.error:
    return resolved.error
result = await page.evaluate(JS_CLICK_RADIO_BY_XPATH, [resolved.xpath_smart, option_text])
# NO fallback to JS_CLICK_RADIO
```

- [ ] **Step 6: Hard-cut `_execute_round`**

- If no `xpath_smart` after field lookup → return `'xpath-not-found'` (do not call `_select_by_label` / label fill JS).
- Input/date/radio/checkbox: xpath-only.
- Tree-select: leave existing path; if fill after `no-tree-component`, prefer resolve+xpath when store has xpath.

- [ ] **Step 7: `_llm_values.py` attach xpath**

```python
xp = item.get('xpath_smart', '') if isinstance(item, dict) else getattr(item, 'xpath_smart', '')
actions.append({
    'action': action_name,
    'label': label,
    'value': val,
    'xpath_smart': xp or '',
})
```

Update `_field_dict_for_action` to prefer `action['xpath_smart']` match before label-only.

When executing: `xpath_smart = (a.get('xpath_smart') or field_dict.get('xpath_smart') or '').strip()`.

- [ ] **Step 8: Run characterizations**

```bash
python scripts/characterization/characterize-xpath-primary-ops.py
python scripts/characterization/characterize-xpath-fill-select.py
python scripts/characterization/characterize-form-assistant.py
```

Expected: all OK.

- [ ] **Step 9: Commit** (if user asked)

```bash
git add scripts/actions/_form.py scripts/actions/_llm_values.py scripts/characterization/
git commit -m "feat: Phase A xpath-only writes after _resolve_control"
```

---

### Task 4（L4）：Phase B — Agent optional `xpath_smart`

**Files:**
- Modify: `scripts/actions/_form.py` (ensure all listed actions expose `xpath_smart: str = ""`)
- Modify: `scripts/characterization/characterize-xpath-primary-ops.py`

**Interfaces:**
- Produces: Agent may pass `xpath_smart` on fill/select/date/radio
- Recording params prefer both keys when resolved

- [ ] **Step 1: Characterization for signatures**

```python
def test_phase_b_action_signatures() -> None:
    form = (ROOT / "scripts/actions/_form.py").read_text(encoding="utf-8")
    for name in ("fill_form_field", "fill_date_field", "select_option", "click_radio"):
        chunk = form.split(f"async def {name}", 1)[1][:400]
        assert_true("xpath_smart" in chunk, f"{name} accepts xpath_smart")
```

- [ ] **Step 2: Run — FAIL if signatures missing**

- [ ] **Step 3: Add `xpath_smart: str = ""` where missing; pass into `_resolve_control`**

```python
params = {
    'label_text': resolved.label,
    'option_text': option_text,
    'xpath_smart': resolved.xpath_smart,
}
```

- [ ] **Step 4: Run characterizations — PASS**

- [ ] **Step 5: Commit** (if user asked)

```bash
git add scripts/actions/_form.py scripts/characterization/characterize-xpath-primary-ops.py
git commit -m "feat: Phase B optional xpath_smart on fill/select/radio actions"
```

---

### Task 5（L5）：Prompt + CHANGELOG + full green

**Files:**
- Modify: `scripts/prompts/agent-prompt.md`
- Modify: `CHANGELOG.md`
- Modify: `scripts/characterization/characterize-xpath-primary-ops.py`

- [ ] **Step 1: Prompt marker test**

```python
def test_agent_prompt_xpath_primary() -> None:
    prompt = (ROOT / "scripts/prompts/agent-prompt.md").read_text(encoding="utf-8")
    assert_true("xpath_smart" in prompt, "prompt mentions xpath_smart")
    assert_true(
        "ambiguous-label" in prompt or "相对 xpath" in prompt,
        "prompt steers Agent to xpath / ambiguity",
    )
```

- [ ] **Step 2: Update agent-prompt.md** near fill/select bullets

- Scan/task include `xpath_smart` + label; prefer passing `xpath_smart` on fill/select/date/radio.
- Label is semantic (rules/values); use exact scan names, not short guesses.
- On `ambiguous-label`, retry with exact `xpath_smart` from scan.
- On `xpath-not-found`, re-scan or copy exact label from scan (no fuzzy guess).

- [ ] **Step 3: CHANGELOG under `[Unreleased]` → `### Changed`**

```markdown
- 2026-08-08: **XPath-primary 控件操作：** 写路径经 `_resolve_control` 后仅用相对 `xpath_smart` 定位；语义名 `label||placeholder` 仅用于取值/规则/录制。同 label 多 xpath → `ambiguous-label`。Agent 动作可选 `xpath_smart`；prompt 要求优先带 xpath。
  影响范围：Agent fill/select/date/radio、run_form_assistant、scan 语义名。
  文件：scripts/actions/_form.py, scripts/actions/_llm_values.py, scripts/prompts/agent-prompt.md, scripts/characterization/characterize-xpath-primary-ops.py
  Python 同步提示：无（scripts 子进程）；若控制面复述 Agent 工具 schema 需增加可选 xpath_smart。
```

- [ ] **Step 4: Full characterization suite**

```bash
python scripts/characterization/characterize-xpath-primary-ops.py
python scripts/characterization/characterize-xpath-fill-select.py
python scripts/characterization/characterize-form-assistant.py
python scripts/characterization/characterize-form-rules.py
node scripts/characterization/characterize-ctrl.mjs
```

Expected: all OK.

- [ ] **Step 5: Commit** (if user asked)

```bash
git add scripts/prompts/agent-prompt.md CHANGELOG.md scripts/characterization/characterize-xpath-primary-ops.py
git commit -m "docs: xpath-primary Agent prompt and CHANGELOG"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| xpath locate / label semantic split | 1, 3 |
| `display_label = label \|\| placeholder` | 2 |
| `_resolve_control` exact / ambiguous / hint | 1 |
| Phase A no DOM label fallback | 3 |
| Phase B optional `xpath_smart` | 4 |
| Agent sees xpath from scan | 2 (emit), 5 (prompt) |
| Recording both keys | 3, 4 |
| Non-goals (rename, fuzzy, login, CTRL lazy) | omitted |

## Self-review notes

- No TBD placeholders in steps.
- `ResolvedControl` name consistent across tasks.
- `_task_xpath_smart` remains compat wrapper returning `""` on error — write paths must use `_resolve_control` directly.
- Tree-select / login left as specified non-goals.
