# Overlay container trigger|title naming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record `dialog:`/`drawer:` containers as `<按钮>|<标题>` for LLM readability while `verifyFormStructure` matches on title only (legacy ids unchanged).

**Architecture:** DOM identify stays title/`unnamed`. Python composes display ids via `_last_trigger_button` + first-seen alias map. CTRL and agent verify parse `|` and ignore the button segment before `matchTitle`.

**Tech Stack:** Python agent (`scripts/controller/actions/`), CTRL (`src/ctrl-actions/structure.js`), characterization scripts, CHANGELOG.

**Spec:** `docs/superpowers/specs/2026-08-09-overlay-container-trigger-naming-design.md`

## File map

| File | Responsibility |
|------|----------------|
| Create: `scripts/controller/actions/container_naming.py` | Pure helpers: compose, title extract, remember/clear trigger, alias freeze |
| Create: `scripts/characterization/characterize-container-naming.py` | Truth tables + source wiring asserts |
| Modify: `scripts/controller/actions/form_scan_utils.py` | Compose before `_save_form_snapshot` / switch; clear on `main` |
| Modify: `scripts/controller/actions/_misc.py` | Remember trigger on click success; clear on `close_dialog` |
| Modify: `scripts/controller/actions/_table.py` | Remember trigger on `click_table_row_button` success |
| Modify: `scripts/controller/actions/js_snippets/misc.py` | Verify: `|` → title before `matchTitle` |
| Modify: `src/ctrl-actions/structure.js` | Same verify parse (CTRL parity) |
| Modify: `scripts/characterization/characterize-verify-form-structure.mjs` | `|` / `|unnamed` parse asserts |
| Modify: `CHANGELOG.md` | `[Unreleased]` Fixed/Changed for CTRL + agent verify |

```
L1 container_naming helpers ──► L2 recording (trigger + compose + clear)
         │
         └──► L3 verify parse (CTRL + JS_VERIFY)
                    │
                    ▼
              L4 characterize + CHANGELOG
```

## Global Constraints

- Separator is ASCII pipe `|` only (not fullwidth `：`).
- Type prefix remains `dialog:` / `drawer:` / `main`.
- Trigger + empty DOM title → `dialog:<btn>|unnamed` (never bare `dialog:<btn>`).
- Verify: with `|`, match **only** the segment after first `|`; without `|`, legacy title/`unnamed` rules; bare `dialog:新增` is **not** empty-title.
- No DB migration; `JS_IDENTIFY_CONTAINER` unchanged.
- Compose failures silent → keep raw id; never abort recording.
- First composed id per raw root frozen in `_overlay_container_alias` until leave overlay / clear.

---

### Task 1: Pure naming helpers + characterization truth table

**Files:**
- Create: `scripts/controller/actions/container_naming.py`
- Create: `scripts/characterization/characterize-container-naming.py`

**Interfaces:**
- Produces:
  - `OVERLAY_SEP = '|'`
  - `overlay_title_from_container_id(container_id: str) -> str` — strip type prefix; if `|` in rest, return after first `|`; else return rest (may be `unnamed` or legacy title)
  - `compose_overlay_container(raw_id: str, trigger: str | None) -> str`
  - `normalize_trigger_button(text: str | None) -> str` — empty / noise → `''`
  - `remember_trigger_button(store: dict, text: str | None) -> None` — sets `_last_trigger_button` only if normalize non-empty
  - `clear_trigger_button(store: dict) -> None` — pops `_last_trigger_button` and `_overlay_container_alias`
  - `resolve_display_container(raw_id: str, store: dict) -> str` — alias freeze + compose

- [ ] **Step 1: Write failing characterization**

Create `scripts/characterization/characterize-container-naming.py`:

```python
#!/usr/bin/env python3
"""Characterization: overlay container trigger|title naming helpers."""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.controller.actions.container_naming import (  # noqa: E402
    compose_overlay_container,
    overlay_title_from_container_id,
    normalize_trigger_button,
    remember_trigger_button,
    clear_trigger_button,
    resolve_display_container,
)


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_compose_truth() -> None:
    assert_true(
        compose_overlay_container('dialog:新增客户校验', '新增') == 'dialog:新增|新增客户校验',
        'trigger + title',
    )
    assert_true(
        compose_overlay_container('dialog:unnamed', '新增') == 'dialog:新增|unnamed',
        'trigger + unnamed',
    )
    assert_true(
        compose_overlay_container('dialog:', '新增') == 'dialog:新增|unnamed'
        or compose_overlay_container('dialog:unnamed', '新增') == 'dialog:新增|unnamed',
        'empty title uses unnamed sentinel',
    )
    assert_true(
        compose_overlay_container('dialog:选择客户', '') == 'dialog:选择客户',
        'no trigger keeps raw',
    )
    assert_true(
        compose_overlay_container('dialog:unnamed', None) == 'dialog:unnamed',
        'no trigger unnamed',
    )
    assert_true(
        compose_overlay_container('main', '新增') == 'main',
        'main untouched',
    )
    assert_true(
        compose_overlay_container('drawer:unnamed', '筛选') == 'drawer:筛选|unnamed',
        'drawer compose',
    )


def test_title_extract() -> None:
    assert_true(
        overlay_title_from_container_id('dialog:新增|新增客户校验') == '新增客户校验',
        'pipe title',
    )
    assert_true(
        overlay_title_from_container_id('dialog:新增|unnamed') == 'unnamed',
        'pipe unnamed',
    )
    assert_true(
        overlay_title_from_container_id('dialog:选择客户') == '选择客户',
        'legacy title',
    )
    assert_true(
        overlay_title_from_container_id('dialog:unnamed') == 'unnamed',
        'legacy unnamed',
    )
    assert_true(
        overlay_title_from_container_id('dialog:新增') == '新增',
        'bare dialog:新增 is legacy title NOT empty',
    )


def test_normalize_and_remember() -> None:
    assert_true(normalize_trigger_button('') == '', 'empty')
    assert_true(normalize_trigger_button('  新增  ') == '新增', 'trim')
    assert_true(normalize_trigger_button('12') == '', 'day noise')
    assert_true(normalize_trigger_button('2024-01-01') == '', 'date noise')
    long = '法人投资' * 20
    assert_true(normalize_trigger_button(long) == '', 'too long')
    store: dict = {}
    remember_trigger_button(store, '新增')
    assert_true(store.get('_last_trigger_button') == '新增', 'remember')
    remember_trigger_button(store, '')
    assert_true(store.get('_last_trigger_button') == '新增', 'empty does not clear via remember')
    clear_trigger_button(store)
    assert_true('_last_trigger_button' not in store, 'clear trigger')
    assert_true('_overlay_container_alias' not in store, 'clear alias')


def test_alias_freeze() -> None:
    store = {'_last_trigger_button': '新增'}
    a = resolve_display_container('dialog:unnamed', store)
    assert_true(a == 'dialog:新增|unnamed', f'first compose got {a}')
    store['_last_trigger_button'] = '引入'  # would wrongly change without freeze
    b = resolve_display_container('dialog:unnamed', store)
    assert_true(b == a, f'alias freeze got {b}')


def main() -> None:
    test_compose_truth()
    test_title_extract()
    test_normalize_and_remember()
    test_alias_freeze()
    print('PASS characterize-container-naming')


if __name__ == '__main__':
    main()
```

- [ ] **Step 2: Run test — expect FAIL (module missing)**

Run: `python scripts/characterization/characterize-container-naming.py`  
Expected: `ModuleNotFoundError` or `ImportError` for `container_naming`

- [ ] **Step 3: Implement `container_naming.py`**

```python
"""Overlay container display naming: trigger|title for LLM; title-only for verify."""
from __future__ import annotations
import re

OVERLAY_SEP = '|'
_TRIGGER_KEY = '_last_trigger_button'
_ALIAS_KEY = '_overlay_container_alias'

_DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
_DAY_RE = re.compile(r'^\d{1,2}$')
_MAX_TRIGGER_LEN = 40


def _split_type(container_id: str) -> tuple[str, str]:
    s = (container_id or '').strip()
    for prefix in ('dialog:', 'drawer:'):
        if s.startswith(prefix):
            return prefix, s[len(prefix):]
    return '', s


def overlay_title_from_container_id(container_id: str) -> str:
    """Title segment used by verifyFormStructure (ignores trigger before |)."""
    prefix, rest = _split_type(container_id)
    if not prefix:
        return (container_id or '').strip()
    if OVERLAY_SEP in rest:
        return rest.split(OVERLAY_SEP, 1)[1].strip()
    return rest.strip()


def normalize_trigger_button(text: str | None) -> str:
    t = re.sub(r'\s+', '', (text or '').strip())
    if not t:
        return ''
    if _DAY_RE.match(t) or _DATE_RE.match(t):
        return ''
    if len(t) > _MAX_TRIGGER_LEN:
        return ''
    # Exclude routine submit/query labels (YAGNI: not treated as overlay openers)
    if t in ('保存', '提交', '查询', '搜索', '查找', '重置'):
        return ''
    return t


def compose_overlay_container(raw_id: str, trigger: str | None) -> str:
    try:
        prefix, rest = _split_type(raw_id)
        if not prefix:
            return (raw_id or '').strip() or 'main'
        btn = normalize_trigger_button(trigger)
        title = (rest or '').strip() or 'unnamed'
        if not btn:
            return f'{prefix}{title}'
        if title == 'unnamed':
            return f'{prefix}{btn}{OVERLAY_SEP}unnamed'
        return f'{prefix}{btn}{OVERLAY_SEP}{title}'
    except Exception:
        return (raw_id or '').strip() or 'main'
- [ ] **Step 4: Run characterization — expect PASS**

Run: `python scripts/characterization/characterize-container-naming.py`  
Expected: `PASS characterize-container-naming`

- [ ] **Step 5: Commit**

```bash
git add scripts/controller/actions/container_naming.py scripts/characterization/characterize-container-naming.py
git commit -m "feat: overlay container naming helpers (trigger|title)"
```

---

### Task 2: Wire recording — remember, compose, clear

**Files:**
- Modify: `scripts/controller/actions/_misc.py` (`click_icon_button`, `click_element_by_index`, `close_dialog`)
- Modify: `scripts/controller/actions/_table.py` (`click_table_row_button`)
- Modify: `scripts/controller/actions/form_scan_utils.py` (`_switch_task_list_container`, `_save_form_snapshot` callers path)
- Modify: `scripts/controller/actions/_form.py` (`_ensure_scanned` / `_rebuild_task_list_from_dom` container ids)
- Modify: `scripts/characterization/characterize-container-naming.py` (add source-wire asserts)

**Interfaces:**
- Consumes: `remember_trigger_button`, `clear_trigger_button`, `resolve_display_container` from Task 1
- Produces: snapshots / `_active_container` use composed ids

- [ ] **Step 1: Extend characterization with source wires (fail until wired)**

Append to `characterize-container-naming.py`:

```python
def test_source_wires() -> None:
    misc = (ROOT / 'scripts/controller/actions/_misc.py').read_text(encoding='utf-8')
    form = (ROOT / 'scripts/controller/actions/_form.py').read_text(encoding='utf-8')
    scan = (ROOT / 'scripts/controller/actions/form_scan_utils.py').read_text(encoding='utf-8')
    table = (ROOT / 'scripts/controller/actions/_table.py').read_text(encoding='utf-8')
    assert_true('remember_trigger_button' in misc, 'misc remembers trigger')
    assert_true('clear_trigger_button' in misc, 'misc clears on close_dialog')
    assert_true('remember_trigger_button' in table, 'table remembers trigger')
    assert_true('resolve_display_container' in form or 'resolve_display_container' in scan, 'compose on scan/save path')
    assert_true('clear_trigger_button' in scan or 'clear_trigger_button' in form, 'clear on main switch')
```

Call it from `main()`.

- [ ] **Step 2: Run — expect FAIL on missing wires**

Run: `python scripts/characterization/characterize-container-naming.py`  
Expected: FAIL assertion on remember/resolve wires

- [ ] **Step 3: Remember trigger on successful clicks**

In `_misc.py` after successful `click_icon_button` `_record_action`:

```python
            if case_data_store is not None:
                from scripts.controller.actions.container_naming import remember_trigger_button
                remember_trigger_button(case_data_store, button_text)
```

After successful `click_element_by_index` `_record_action` (where text is recorded):

```python
                if case_data_store is not None:
                    from scripts.controller.actions.container_naming import remember_trigger_button
                    remember_trigger_button(
                        case_data_store,
                        (element_info or {}).get('text') or elem_text or '',
                    )
```

In `_table.py` after successful `click_table_row_button` record:

```python
            if case_data_store is not None:
                from scripts.controller.actions.container_naming import remember_trigger_button
                remember_trigger_button(case_data_store, button_text)
```

(`_register_table_actions` must receive `case_data_store` if not already — match existing pattern from `_misc`.)

- [ ] **Step 4: Clear on `close_dialog` success**

In `_misc.py` `close_dialog` after successful `_record_action`:

```python
            if case_data_store is not None:
                from scripts.controller.actions.container_naming import clear_trigger_button
                clear_trigger_button(case_data_store)
```

- [ ] **Step 5: Compose in `_ensure_scanned` / rebuild before switch & snapshot**

In `_form.py` `_ensure_scanned`, after `container_id = await page.evaluate(JS_IDENTIFY_CONTAINER)`:

```python
        from scripts.controller.actions.container_naming import resolve_display_container, clear_trigger_button
        display_id = resolve_display_container(container_id, case_data_store)
        if display_id == 'main' or not str(display_id).startswith(('dialog:', 'drawer:')):
            if (case_data_store.get('_active_container') or '').startswith(('dialog:', 'drawer:')):
                clear_trigger_button(case_data_store)
        container_id = display_id
```

In `_rebuild_task_list_from_dom`, after reading `cid` from scan result:

```python
            from scripts.controller.actions.container_naming import resolve_display_container
            cid = resolve_display_container(
                result.get('container', container_id) if isinstance(result, dict) else container_id,
                case_data_store,
            )
```

(Ensure `_save_form_snapshot(cid, ...)` uses this composed `cid`.)

Also in `form_scan_utils._switch_task_list_container`: when `container_id == 'main'` (or not overlay), call `clear_trigger_button(case_data_store)` after switch settles — only when **leaving** an overlay:

```python
    from scripts.controller.actions.container_naming import clear_trigger_button
    ...
    prev = active
    ...
    case_data_store['_active_container'] = container_id
    if (
        prev
        and str(prev).startswith(('dialog:', 'drawer:'))
        and not str(container_id).startswith(('dialog:', 'drawer:'))
    ):
        clear_trigger_button(case_data_store)
```

Note: `clear_trigger_button` clears aliases — call it **after** saving `by[prev]` so the leaving overlay's task_list remains keyed by the composed id already stored in `prev`.

- [ ] **Step 6: Run characterization — expect PASS**

Run: `python scripts/characterization/characterize-container-naming.py`  
Expected: `PASS characterize-container-naming`

- [ ] **Step 7: Commit**

```bash
git add scripts/controller/actions/_misc.py scripts/controller/actions/_table.py scripts/controller/actions/_form.py scripts/controller/actions/form_scan_utils.py scripts/characterization/characterize-container-naming.py
git commit -m "feat: compose overlay containers from last trigger button"
```

---

### Task 3: Verify parse — CTRL + agent JS (title after `|`)

**Files:**
- Modify: `src/ctrl-actions/structure.js` (`matchTitle` / drawer+dialog `want` assignment)
- Modify: `scripts/controller/actions/js_snippets/misc.py` (`JS_VERIFY_FORM_STRUCTURE`)
- Modify: `scripts/characterization/characterize-verify-form-structure.mjs`

**Interfaces:**
- Consumes: naming rules from Task 1 (`overlay_title_from_container_id` semantics)
- Produces: verify matches title after `|`; `|unnamed` → empty-title match

- [ ] **Step 1: Extend verify characterization (fail until JS updated)**

In `characterize-verify-form-structure.mjs`, add (mirror helper + source asserts):

```javascript
function overlayTitleFromContainerId(id) {
  const s = String(id || '').trim();
  let rest = s;
  if (s.startsWith('dialog:')) rest = s.slice(7);
  else if (s.startsWith('drawer:')) rest = s.slice(7);
  else return s;
  const i = rest.indexOf('|');
  if (i >= 0) return rest.slice(i + 1).trim();
  return rest.trim();
}

assert(overlayTitleFromContainerId('dialog:新增|新增客户校验') === '新增客户校验', 'pipe title extract');
assert(overlayTitleFromContainerId('dialog:新增|unnamed') === 'unnamed', 'pipe unnamed extract');
assert(overlayTitleFromContainerId('dialog:选择客户') === '选择客户', 'legacy title extract');

assert(/overlayTitleFromContainerId|indexOf\('\|'\)|split\(.*,\s*1\)/.test(misc), 'agent verify parses pipe');
// after CTRL section:
assert(/overlayTitleFromContainerId|indexOf\('\|'\)/.test(ctrl), 'CTRL verify parses pipe');
```

- [ ] **Step 2: Run — expect FAIL on missing pipe parse in sources**

Run: `node scripts/characterization/characterize-verify-form-structure.mjs`  
Expected: FAIL agent/CTRL pipe parse assert

- [ ] **Step 3: Patch agent `JS_VERIFY_FORM_STRUCTURE`**

In `misc.py`, after `matchTitle`, add:

```javascript
    const overlayTitleFromContainerId = (id) => {
        const s = String(id || '').trim();
        let rest = s;
        if (s.startsWith('dialog:')) rest = s.slice(7);
        else if (s.startsWith('drawer:')) rest = s.slice(7);
        else return s;
        const i = rest.indexOf('|');
        if (i >= 0) return rest.slice(i + 1).trim();
        return rest.trim();
    };
```

Change drawer/dialog branches from:

```javascript
        const want = idRaw.slice(7);
```

to:

```javascript
        const want = overlayTitleFromContainerId(idRaw);
```

(Both `drawer:` and `dialog:` branches.)

- [ ] **Step 4: Patch CTRL `structure.js` identically**

Same `overlayTitleFromContainerId` helper and `want = overlayTitleFromContainerId(idRaw)` for drawer/dialog branches (keep existing `matchTitle` unnamed empty-title behavior).

- [ ] **Step 5: Run characterizations — expect PASS**

```bash
node scripts/characterization/characterize-verify-form-structure.mjs
node scripts/characterization/characterize-ctrl.mjs
python scripts/characterization/characterize-container-naming.py
```

Expected: all PASS / ok

- [ ] **Step 6: Commit**

```bash
git add src/ctrl-actions/structure.js scripts/controller/actions/js_snippets/misc.py scripts/characterization/characterize-verify-form-structure.mjs
git commit -m "fix: verifyFormStructure matches title after trigger|"
```

---

### Task 4: CHANGELOG + final green

**Files:**
- Modify: `CHANGELOG.md` `[Unreleased]`

- [ ] **Step 1: Add Unreleased entry**

Under `### Changed` or `### Fixed`:

```markdown
- 2026-08-09: **Overlay 容器命名带触发按钮（`dialog:<按钮>|<标题>`）。** 录制用最近成功点击文案合成 display id（无标题 → `|unnamed`）；`verifyFormStructure` / `JS_VERIFY_FORM_STRUCTURE` 只匹配 `|` 后标题，兼容旧 `dialog:标题` / `dialog:unnamed`。
  影响范围：录制 snapshot container、steps/replay Type B 校验、assembled CTRL。
  文件：scripts/controller/actions/container_naming.py, _form.py, form_scan_utils.py, _misc.py, _table.py, js_snippets/misc.py, src/ctrl-actions/structure.js
  Python 同步提示：无（scripts + CTRL；Python 控制面无对等逻辑）。
```

- [ ] **Step 2: Re-run all related characterizations**

```bash
python scripts/characterization/characterize-container-naming.py
node scripts/characterization/characterize-verify-form-structure.mjs
node scripts/characterization/characterize-ctrl.mjs
```

Expected: all green

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: CHANGELOG for overlay container trigger|title naming"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| `dialog:btn\|title` / `\|unnamed` compose | Task 1–2 |
| Trigger from last successful click | Task 2 |
| Exclude 查询/保存/noise | Task 1 `normalize_trigger_button` |
| Alias freeze first composed id | Task 1 `resolve_display_container` + Task 2 |
| Clear on main / close_dialog | Task 2 |
| Verify title-only + legacy | Task 3 |
| No JS_IDENTIFY change / no DB migrate | (non-goals; no task) |
| Characterization + CHANGELOG | Tasks 1–4 |

## Manual verify (optional after implement)

1. Restart executor so Python loads new snippets.
2. Re-record open 「新增」→ untitled dialog → snapshot container should be `dialog:新增|unnamed`.
3. Replay checkpoint should pass title match (empty title), not `container_not_found`.
