# TsscMultiSelect Dedicated Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register `tssc_multi_select(label_text, option_text, xpath_smart='')` — component-gated remote table-row picker for `TsscMultiSelect`, mirroring `select_tree_option`.

**Architecture:** New JS snippet opens the field, waits for `.select-table` rows, matches any cell / `params.text` column (not first-cell-only), clicks the row, verifies echo. Python `SelectEngine.tssc_multi_select` records with `target_kind=form_tssc_multi_select`. Scan classifies `.tssc-multi-select` before `.el-select`. Prompt pack + autofill route agents away from `select_option` for these fields.

**Tech Stack:** Playwright `page.evaluate` JS snippets, browser-use controller actions, characterization cold pins, agent prompt packs in `scripts/prompts/`.

**Spec:** [`docs/superpowers/specs/2026-09-08-tssc-multi-select-action-design.md`](../specs/2026-09-08-tssc-multi-select-action-design.md)

## Global Constraints

- Signature must stay `tssc_multi_select(label_text, option_text, xpath_smart="")` — same shape as `select_tree_option`.
- Gate on `TsscMultiSelect` / `.tssc-multi-select` only; never treat bare dropdown `el-table` as success.
- Match **any cell** or `params.text` column; **forbid** first-non-numeric-cell-only labeling (要素库 英文|中文 bug).
- Do **not** delete `SELECT_TABLE_ROW_OPTIONS` inside `select_option` (compat).
- Do **not** change introduce_pick success gates / `dialog_close` rules.
- Do **not** touch unrelated WIP: `config/update-db-whitelist.ps1`, `data/kb/req/**/.draft-traj-propose.json`, trajectory-dao.
- Locator JS source of truth is `src/cdp/page-locator-helpers.js`; regenerate `_locator_helpers_js.py` via `node scripts/_gen_locator_helpers_py.mjs` — never hand-edit the generated file.
- New public Python handlers need JSDoc only on JS side if touching `src/`; Python actions follow existing docstring style on `@controller.action`.
- Characterization: add cold pin; keep existing tree/select pins green.
- Commits: only when the user (or this plan step) asks; prefer one commit per completed task after green verify.

## File map

| File | Role |
|---|---|
| `scripts/controller/actions/js_snippets/tssc_multi_select.py` | `JS_TSSC_MULTI_SELECT` |
| `scripts/controller/actions/_js_snippets.py` | re-export |
| `scripts/controller/actions/js_snippets/scan_utils.py` | `JS_CLASSIFY_FIELD` kind before `.el-select` |
| `scripts/controller/actions/js_snippets/scan_form.py` | bare-control kind when host is `.tssc-multi-select` |
| `scripts/controller/actions/form_action_engines.py` | `SelectEngine.tssc_multi_select` |
| `scripts/controller/actions/_form.py` | `@controller.action` register |
| `scripts/controller/actions/autofill_round.py` | KIND_ORDER + capture/dispatch for `tssc-multi-select` |
| `scripts/prompts/agent-tools-tssc-multi-select.md` | agent contract |
| `scripts/prompts/agent-prompt.md` | include pack |
| `scripts/agent_utils.py` | assemble pack for create/modify/**introduce_pick**/full |
| `scripts/prompts/agent-tools-form.md` | remove “use select_option for table rows” |
| `scripts/controller/actions/phase/prompts.py` | wizard hint fix |
| `scripts/models/action.py`, `scripts/state.py`, `scripts/event_dispatch.py` | action registry |
| `src/models/action-name.js`, `src/models/element.js`, `src/dedup.js`, `src/services/legacy-engine-export.js`, heal/export touchpoints as needed | canonical name + export |
| `src/cdp/page-locator-helpers.js` (+ gen) | `form_tssc_multi_select` before `.el-select` |
| `scripts/characterization/cold/characterize-tssc-multi-select.py` | pins |

---

### Task 1: Cold characterization pin (fail first)

**Files:**
- Create: `scripts/characterization/cold/characterize-tssc-multi-select.py`
- Test: same file (self-running like `characterize-tree-picker-click.py`)

**Interfaces:**
- Consumes: nothing yet (expects strings that Task 2–6 will add)
- Produces: failing pin that later tasks turn green

- [ ] **Step 1: Write the pin script**

```python
"""Pin tssc_multi_select contract: snippet markers, classify-before-el-select,
registration, prompt pack, action registries."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def needle(path, *texts):
    src = (ROOT / path).read_text(encoding="utf-8")
    for t in texts:
        if t not in src:
            print("MISSING %s :: %r" % (path, t))
            return False
    return True


def classify_before_el_select():
    src = (ROOT / "scripts/controller/actions/js_snippets/scan_utils.py").read_text(
        encoding="utf-8"
    )
    marker = "tssc-multi-select"
    el = "if (item.querySelector('.el-select')) return 'select'"
    i_m = src.find("tssc-multi-select")
    i_e = src.find(el)
    if i_m < 0 or i_e < 0 or i_m > i_e:
        print("FAIL: tssc-multi-select classify must appear before .el-select → select")
        return False
    return True


checks = [
    ("scripts/controller/actions/js_snippets/tssc_multi_select.py", (
        "JS_TSSC_MULTI_SELECT",
        "no-tssc-multi-select",
        "err-no-echo",
        "ok-already",
        "TsscMultiSelect",
        ".tssc-multi-select",
        ".select-table",
        "el-table__row",
    )),
    ("scripts/controller/actions/_js_snippets.py", ("tssc_multi_select", "JS_TSSC_MULTI_SELECT")),
    ("scripts/controller/actions/_form.py", (
        "tssc_multi_select(label_text, option_text",
        "tssc_multi_select",
    )),
    ("scripts/controller/actions/form_action_engines.py", (
        "async def tssc_multi_select",
        "form_tssc_multi_select",
        "JS_TSSC_MULTI_SELECT",
    )),
    ("scripts/prompts/agent-tools-tssc-multi-select.md", (
        "tssc_multi_select(label_text, option_text)",
        "no-tssc-multi-select",
        "err-no-echo",
        "TsscMultiSelect",
    )),
    ("scripts/prompts/agent-prompt.md", ("agent-tools-tssc-multi-select.md",)),
    ("scripts/agent_utils.py", ("agent-tools-tssc-multi-select.md",)),
    ("scripts/models/action.py", ("tssc_multi_select",)),
    ("scripts/event_dispatch.py", ("tssc_multi_select",)),
    ("scripts/state.py", ("tssc_multi_select",)),
    ("src/models/action-name.js", ("tssc_multi_select",)),
    ("src/cdp/page-locator-helpers.js", ("form_tssc_multi_select", ".tssc-multi-select")),
]

ok = all(needle(path, *texts) for path, texts in checks) and classify_before_el_select()
# form.md must NOT still tell agents to use select_option for TsscMultiSelect table rows
form = (ROOT / "scripts/prompts/agent-tools-form.md").read_text(encoding="utf-8")
if "远程表格型下拉" in form and "select_option" in form.split("远程表格型下拉", 1)[1][:200]:
    # allow mention only if tssc_multi_select appears in the same bullet
    chunk = form.split("tssc-multi-select", 1)
    if "必须用 select_option" in form or (
        "表格行" in form and "必须用 select_option" in form
    ):
        print("FAIL: agent-tools-form.md still steers table-row remote to select_option")
        ok = False
if not ok:
    print("FAILED: characterize-tssc-multi-select")
    sys.exit(1)
print("ok: characterize-tssc-multi-select")
```

Simplify the form.md assertion in the actual file to:

```python
form = (ROOT / "scripts/prompts/agent-tools-form.md").read_text(encoding="utf-8")
if "必须用 select_option" in form and "TsscMultiSelect" in form:
    print("FAIL: form prompt still steers TsscMultiSelect to select_option")
    ok = False
if "tssc_multi_select" not in form and "TsscMultiSelect" in (
    ROOT / "scripts/prompts/agent-tools-tssc-multi-select.md"
).read_text(encoding="utf-8"):
    pass  # dedicated pack is enough; form must not contradict
bad = "远程表格型下拉（弹层内 `el-table` 行" in form and "只能用 `select_option`" in form
if bad:
    print("FAIL: stale select_option table-row guidance in form.md")
    ok = False
```

- [ ] **Step 2: Run pin — expect FAIL**

```powershell
cd D:\dev\JS-gen
python scripts/characterization/cold/characterize-tssc-multi-select.py
```

Expected: `MISSING ...` / non-zero exit.

- [ ] **Step 3: Commit pin only** (after user allows commits, or with plan execution)

```powershell
git add scripts/characterization/cold/characterize-tssc-multi-select.py
git commit -m "test: pin tssc_multi_select action contract (failing)"
```

---

### Task 2: JS snippet `JS_TSSC_MULTI_SELECT`

**Files:**
- Create: `scripts/controller/actions/js_snippets/tssc_multi_select.py`
- Modify: `scripts/controller/actions/_js_snippets.py` (add import + export alongside `select_tree`)

**Interfaces:**
- Consumes: `JS_GET_CONTAINER`, `JS_FIELD_DISABLED` from existing snippets (same pattern as `select_tree.py`)
- Produces: `JS_TSSC_MULTI_SELECT` — `async ([label, option]) => string`

- [ ] **Step 1: Implement snippet** (mirror `select_tree.py` structure)

Create `tssc_multi_select.py` with module docstring stating: single-select row pick for `TsscMultiSelect`; not `select_option`; not tree; confirm dialog is caller’s job.

Core evaluate body requirements (must appear as source substrings for the pin):

1. Find `.el-form-item` by label (body then visible `.el-dialog`/`.el-drawer`).
2. Resolve host: `fieldItem.querySelector('.tssc-multi-select')` or walk `__vue__` for name including `TsscMultiSelect`; else return `no-tssc-multi-select | Not TsscMultiSelect. Do NOT retry tssc_multi_select.`
3. `disabled` via `JS_FIELD_DISABLED` → `disabled`.
4. `readback()` = trigger input value OR `vm.selectName || vm.myValue || vm.chosenValue`.
5. If option not in `first/第一个/1st` and readback already matches (exact or `startsWith(option)+digit`) → `ok-already:` + value.
6. Click trigger (`.el-select .el-input__inner` or visible input); poll ≤12×250ms for rows under open `.el-select-dropdown` / `.select-table`: `tr.el-table__row`.
7. `rowLabels(tr)` = all non-empty cell texts; match exact any cell → else if panel search input exists, set value + input/change, optionally toggle 精确查询 switch when label text includes 精确, re-collect → fuzzy shortest `includes` on any cell or full row text.
8. Click cell then row (`mousedown`+`click`); sleep 250; verify readback → `ok:` / `ok-first:` / `ok-echo:` or `err-no-echo:`.
9. Empty after wait → `no-items`; rows but no match → `option-not-found:` + up to 5 row summaries.

Import pattern at top of file (copy from `select_tree.py`):

```python
from .base import JS_FIELD_DISABLED
from .container import JS_GET_CONTAINER

JS_TSSC_MULTI_SELECT = '''async ([label, option]) => {
    const isDisabled = ''' + JS_FIELD_DISABLED + ''';
    const container = ''' + JS_GET_CONTAINER + ''';
    // ... full body per requirements above ...
}'''
```

- [ ] **Step 2: Re-export in `_js_snippets.py`**

Add:

```python
from .js_snippets.tssc_multi_select import JS_TSSC_MULTI_SELECT
```

and ensure any `__all__` / star-export list used by engines includes it (match how `JS_SELECT_TREE_OPTION` is exported).

- [ ] **Step 3: Re-run pin** — still FAIL on register/prompt, but snippet needles should pass.

```powershell
python scripts/characterization/cold/characterize-tssc-multi-select.py
```

- [ ] **Step 4: Commit**

```powershell
git add scripts/controller/actions/js_snippets/tssc_multi_select.py scripts/controller/actions/_js_snippets.py
git commit -m "feat(actions): add JS_TSSC_MULTI_SELECT snippet"
```

---

### Task 3: Scan classify before `.el-select`

**Files:**
- Modify: `scripts/controller/actions/js_snippets/scan_utils.py` (`JS_CLASSIFY_FIELD`)
- Modify: `scripts/controller/actions/js_snippets/scan_form.py` (bare selectWrap kind ~503–505)
- Modify: `src/cdp/page-locator-helpers.js` (`detectTargetKind` — **before** `if (node.closest('.el-select'))`)
- Run: `node scripts/_gen_locator_helpers_py.mjs`

**Interfaces:**
- Produces: classify kind string `tssc-multi-select`; locator kind `form_tssc_multi_select`

- [ ] **Step 1: `scan_utils.py` — insert after tree-select block, before `.el-select`**

```javascript
    if (item.querySelector('.tssc-multi-select')) return 'tssc-multi-select';
    {
        const hosts = item.querySelectorAll('[class*="tssc"], .el-select');
        for (const host of hosts) {
            let v = host.__vue__;
            while (v) {
                const n = (v.$options && v.$options.name) ? String(v.$options.name) : '';
                if (n.includes('TsscMultiSelect')) return 'tssc-multi-select';
                v = v.$parent;
            }
        }
    }
```

- [ ] **Step 2: `scan_form.py` selectWrap kind**

Replace the ternary that only checks tree markers:

```javascript
            const kind = selectWrap
                ? (host.closest('.tssc-multi-select') || host.querySelector('.tssc-multi-select')
                    ? 'tssc-multi-select'
                    : (host.querySelector('.tree-popover, .tsscTree, .el-tree-select, [class*="tsscmultitree"]')
                        ? 'tree-select' : 'select'))
                : ((ctrl.closest && ctrl.closest('.el-date-editor, .tsscdatepicker, [class*="date-picker"], [class*="datepicker"]')) ? 'date' : 'input');
```

Also extend `if (kind === 'select' || kind === 'tree-select')` to include `tssc-multi-select` wherever options are collected for selects.

- [ ] **Step 3: `page-locator-helpers.js` `detectTargetKind`**

Immediately **before** `if (node.closest('.el-select')) return 'form_select';`:

```javascript
    if (node.closest('.tssc-multi-select')) return 'form_tssc_multi_select';
```

Add `form_tssc_multi_select` to the allowlists that already list `form_tree_select` (same functions ~1128–1130, ~1212, ~1372) so xpath_smart / heal treat it as a form control kind.

- [ ] **Step 4: Regenerate Python locator helpers**

```powershell
node scripts/_gen_locator_helpers_py.mjs
```

Confirm generated file contains `form_tssc_multi_select`.

- [ ] **Step 5: Commit**

```powershell
git add scripts/controller/actions/js_snippets/scan_utils.py scripts/controller/actions/js_snippets/scan_form.py src/cdp/page-locator-helpers.js scripts/controller/actions/js_snippets/_locator_helpers_js.py
git commit -m "feat(scan): classify TsscMultiSelect before el-select"
```

---

### Task 4: Python engine + controller registration

**Files:**
- Modify: `scripts/controller/actions/form_action_engines.py` (`SelectEngine`)
- Modify: `scripts/controller/actions/_form.py`
- Modify: `scripts/models/action.py`, `scripts/state.py`, `scripts/event_dispatch.py`
- Modify: `src/models/action-name.js`, `src/models/element.js`, `src/dedup.js`
- Modify: `src/services/legacy-engine-export.js` (map `tssc_multi_select: 'select:tssc-multi'`, case branches parallel to `select_tree_option`)
- Modify: `src/services/trajectory/heal-contract.js` / `form-structure-heal.js` if they list select actions (add name alongside `select_tree_option`)
- Modify: `scripts/agent/recorder_emitters.py` if the field-write allowlist should include the new action

**Interfaces:**
- Consumes: `JS_TSSC_MULTI_SELECT`
- Produces: `SelectEngine.tssc_multi_select(label_text, option_text, xpath_smart="") -> str`

- [ ] **Step 1: Engine method** (place after `select_option` / near end of `SelectEngine`, modeled on `TreeEngine.select_tree_option`)

```python
    async def tssc_multi_select(self, label_text: str, option_text: str, xpath_smart: str = ""):
        page = await self.browser_context.get_current_page()
        await _wait_if_loading(page)
        await self._ensure_scanned(label_text)
        resolved = _resolve_control(self.business_data_store, label_text, xpath_smart)
        label_text = (resolved.label or label_text or '').strip() or label_text
        xp = '' if resolved.error else (resolved.xpath_smart or '').strip()
        element = await _capture_element(
            page, label_text, target_kind='form_tssc_multi_select', xpath_smart=xp,
        )
        result = await page.evaluate(JS_TSSC_MULTI_SELECT, [label_text, option_text])
        if _is_ok_result(result):
            if element is None and xp:
                element = await _capture_element(
                    page, label_text, target_kind='form_tssc_multi_select', xpath_smart=xp,
                )
            if element is None:
                element = {
                    'tag_name': 'div',
                    'xpath': xp or '',
                    'xpath_smart': xp or '',
                    'formLabel': label_text,
                    'target_kind': 'form_tssc_multi_select',
                    'text': (option_text or '')[:80],
                    'attributes': {},
                    'candidates': (
                        [{'type': 'xpath_smart', 'value': xp}] if xp else []
                    ),
                }
            xp_inv = stamp_recorded_xpath_smart(element, xp)
            _record_action(
                'tssc_multi_select',
                {'label_text': label_text, 'option_text': option_text},
                result,
                element=element,
            )
            _task_done_impl(
                label_text, self.business_data_store,
                value=option_text, xpath_smart=xp_inv,
            )
            return _ok(result)
        res_s = str(result or '')
        if res_s == 'disabled' or res_s.startswith('disabled'):
            return (
                f'disabled | Field "{label_text}" is read-only (TsscMultiSelect). '
                f'Do NOT retry tssc_multi_select or select_option — skip this field.'
            )
        if res_s.startswith('no-tssc-multi-select'):
            return (
                res_s + ' Do NOT retry tssc_multi_select. '
                'Use select_option for plain el-select, or report.'
            )
        if res_s.startswith('err-no-echo'):
            # one CDP real_click retry on matched row is optional; v1 may return as-is
            return (
                res_s + ' Do NOT blindly retry. check_field_value or report.'
            )
        return res_s
```

Import `JS_TSSC_MULTI_SELECT` in `form_action_engines.py` the same way `JS_SELECT_TREE_OPTION` is imported.

**Optional echo fallback (same task if time):** if `err-no-echo`, call existing `_real_click_via_cdp` on `option_text` once, re-evaluate a tiny echo helper, then record — only if `_real_click_via_cdp` is already imported for tree; do not invent a new CDP stack.

- [ ] **Step 2: Register in `_form.py`** immediately after `select_tree_option`:

```python
    @controller.action(
        'Select a row in a TsscMultiSelect remote table dropdown (e.g. 要素名称, 客户名称). '
        'Opens the select, matches option_text against any table cell (not el-option), '
        'verifies trigger echo. If result starts with no-tssc-multi-select, do NOT retry — '
        'use select_option for plain el-select. Do not click the outer dialog 确定; only fill the field.'
    )
    async def tssc_multi_select(label_text: str, option_text: str, xpath_smart: str = ""):
        return await _select_engine.tssc_multi_select(label_text, option_text, xpath_smart)
```

- [ ] **Step 3: Registries**

- `scripts/models/action.py`: add `"tssc_multi_select"` to the known-actions list; `ACTION_TO_COMMAND["tssc_multi_select"] = "select"`.
- `scripts/event_dispatch.py`: `"tssc_multi_select": {"label_text", "option_text"}`.
- `scripts/state.py`: map `'tssc_multi_select': 'select'` next to `select_tree_option`; include in the field-write action frozenset that lists `select_option`, `select_tree_option`, `click_radio`.
- `src/models/action-name.js`: add to `CANONICAL`; aliases e.g. `tsscMultiSelect`, `select_tssc_multi`.
- `src/models/element.js`: map action → `form_tssc_multi_select` like tree → `form_tree_select`.
- `src/dedup.js`: include action name in consecutive-dedup allowlist if select_tree is listed.
- `legacy-engine-export.js`: `tssc_multi_select: 'select:tssc-multi'` + case branches copying tree’s param shape (`label_text` / `option_text`).

- [ ] **Step 4: Run pin + existing select/tree cold pins**

```powershell
python scripts/characterization/cold/characterize-tssc-multi-select.py
python scripts/characterization/cold/characterize-tree-picker-click.py
python scripts/characterization/cold/characterize-tree-select-classify.py
```

- [ ] **Step 5: Commit**

```powershell
git add scripts/controller/actions/form_action_engines.py scripts/controller/actions/_form.py scripts/models/action.py scripts/state.py scripts/event_dispatch.py src/models/action-name.js src/models/element.js src/dedup.js src/services/legacy-engine-export.js src/services/trajectory/heal-contract.js src/services/trajectory/form-structure-heal.js scripts/agent/recorder_emitters.py
git commit -m "feat(actions): register tssc_multi_select engine and registries"
```

---

### Task 5: Autofill routing + prompts

**Files:**
- Modify: `scripts/controller/actions/autofill_round.py`
- Create: `scripts/prompts/agent-tools-tssc-multi-select.md`
- Modify: `scripts/prompts/agent-prompt.md`, `scripts/agent_utils.py`
- Modify: `scripts/prompts/agent-tools-form.md`
- Modify: `scripts/controller/actions/phase/prompts.py`
- Modify: `scripts/characterization/cold/characterize-agent-prompt-packs.py` (assert new pack / action in create + introduce_pick + shim)

**Interfaces:**
- Consumes: field_kind `tssc-multi-select`
- Produces: autofill calls `tssc_multi_select`; prompts document contract

- [ ] **Step 1: Prompt pack** `agent-tools-tssc-multi-select.md`

```markdown
- **tssc_multi_select(label_text, option_text) — 仅用于真正的 TsscMultiSelect（`.tssc-multi-select`，弹层内 `.select-table`/`el-table` 行选，如产品要素「要素名称」、评级「客户名称」）。按任意单元格 / 显示列匹配 `option_text`（不要假设第一列）；`option_text="first"`/`第一个` 选当前页首行。成功码 `ok*` / `ok-already` / `ok-echo`：信任，勿重选。**
- **🚨 `disabled`：只读（如回填的要素编码）— 禁止再调本动作或 select_option，跳过。**
- **🚨 `no-tssc-multi-select`：不是本组件 — 禁止重试；改用 `select_option`（真 el-option）或上报。**
- **🚨 `err-no-echo`：行已点但触发器未回显 — 勿盲目重试；`check_field_value` 或上报。**
- **🚨 `no-items`：工具已尽力等行 — 最多再调一次；禁止 `click_element_by_index` 点表行。**
- **本动作只填字段；外层弹窗「确定/确 定」由你 `click_save` / 任务指定按钮点击。**
- **与 select_option / select_tree_option 分工：TsscMultiSelect 表行选 = tssc_multi_select；普通 el-option = select_option；TsscMultiTree = select_tree_option / tree_picker_click / tree_check_confirm。**
```

- [ ] **Step 2: Wire packs**

`agent-prompt.md` — after tree include:

```markdown
{{prompts/agent-tools-tssc-multi-select.md}}
```

`agent_utils.py` — include for **create, modify, introduce_pick** (要素库选择要素常在 introduce_pick), and full fallback list:

```python
        if mode in ('introduce_pick', 'create', 'modify'):
            packs.append('agent-tools-tssc-multi-select.md')
```

In the full-fallback `packs = [...]` list, append `'agent-tools-tssc-multi-select.md'` after tree.

- [ ] **Step 3: Fix stale form / phase guidance**

In `agent-tools-form.md` EL-SELECT section, replace the bullet that says remote table-row dropdowns must use `select_option` with a pointer to `tssc_multi_select` / the dedicated pack.

In `phase/prompts.py` `wizard_nav_task_hint`, replace:

```python
'   「客户名称」等远程下拉若弹层内是表格行（TsscMultiSelect），必须用 '
'select_option(label_text, option_text 或 \"第一个\")，'
```

with:

```python
'   「客户名称」等远程下拉若弹层内是表格行（TsscMultiSelect），必须用 '
'tssc_multi_select(label_text, option_text 或 \"第一个\")，'
```

- [ ] **Step 4: Autofill**

Extend `KIND_ORDER` / kind_name maps with `'tssc-multi-select': 6` (or insert consistently).

Where `tree-select` branches call `select_tree_option`, add parallel:

```python
elif field_kind == 'tssc-multi-select' or kind in (
    'tssc_multi_select', 'tssc-multi-select',
):
    capture_kind = 'form_tssc_multi_select'
    # ... evaluate / engine call tssc_multi_select(label, value)
```

Prefer calling `await self`-equivalent: the autofill module already has page + engines — follow the exact tree branch structure in the same file (duplicate the tree block and swap names/JS). If autofill currently inlines `page.evaluate(JS_SELECT_TREE_OPTION, ...)`, use `JS_TSSC_MULTI_SELECT` the same way; if it calls into an engine method, call `tssc_multi_select`.

- [ ] **Step 5: Update `characterize-agent-prompt-packs.py`**

Assert `"tssc_multi_select" in form` for create; `"tssc_multi_select" in intro` for introduce_pick; shim includes it.

- [ ] **Step 6: Verify**

```powershell
python scripts/characterization/cold/characterize-tssc-multi-select.py
python scripts/characterization/cold/characterize-agent-prompt-packs.py
```

Expected: both PASS.

- [ ] **Step 7: Commit**

```powershell
git add scripts/controller/actions/autofill_round.py scripts/prompts/agent-tools-tssc-multi-select.md scripts/prompts/agent-prompt.md scripts/agent_utils.py scripts/prompts/agent-tools-form.md scripts/controller/actions/phase/prompts.py scripts/characterization/cold/characterize-agent-prompt-packs.py
git commit -m "feat(prompts): route TsscMultiSelect to tssc_multi_select"
```

---

### Task 6: Spec status + agent-log + dry verification note

**Files:**
- Modify: `docs/superpowers/specs/2026-09-08-tssc-multi-select-action-design.md` — status → 已批准 / 已实现
- Modify: `docs/superpowers/agent-log.md` — 收工 or progress note with commit hashes
- Manual: wet dry-run only if SUT + control plane available (optional checkpoint)

- [x] **Step 1: Mark spec implemented** when Tasks 1–5 green.

- [x] **Step 2: Optional wet check** — SKIP (control plane not verified this session)

With control plane + 选择要素 dialog open:

- Agent or evaluate path: `tssc_multi_select('要素名称', '部署方式')` → `ok*`, trigger shows 部署方式.
- Plain `el-select` field → `no-tssc-multi-select`.

- [x] **Step 3: Agent-log 收工** back-link 17:42 start; list hashes; leave #695/#696 re-record as follow-up.

- [x] **Step 4: Commit docs**

```powershell
git add docs/superpowers/specs/2026-09-08-tssc-multi-select-action-design.md docs/superpowers/agent-log.md
git commit -m "docs: close tssc_multi_select action implementation line"
```

---

## Spec coverage checklist

| Spec § | Task |
|---|---|
| Dedicated action + tree-like signature | 4 |
| Component gate / `no-tssc-multi-select` | 2, 4 |
| Scan before `.el-select` | 3 |
| Echo success / `err-no-echo` | 2, 4 |
| Prompt + autofill route | 5 |
| Characterization pin | 1 |
| Any-cell / params.text match | 2 |
| Keep select_option table path | (no delete — Tasks 2–5) |
| Out: introduce_pick gate / multiple / re-record | Task 6 notes only |

## Placeholder / consistency self-review

- Action name consistent: `tssc_multi_select` everywhere (not `select_tssc_multi` except optional alias).
- Locator kind: `form_tssc_multi_select`.
- Scan kind: `tssc-multi-select`.
- Export command: `select:tssc-multi`.
- `introduce_pick` gets the prompt pack (required for 选择要素).
