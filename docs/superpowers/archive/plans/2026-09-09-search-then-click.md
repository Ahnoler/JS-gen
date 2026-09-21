# Search-Then-Click (树/列表先查再点) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a visible search/query UI is present, block tree-node clicks and table-row selection until the current phase has filled the search box and (if a 查询 button exists) clicked 查询; return `err-search-first:…` with recovery text; wire prompts, analyze enrichment, and product KB rules.

**Architecture:** Add a pure helper module `search_then_click_guard.py` that decides block/allow from a page snapshot + phase flags in `business_data_store`. Recording actions mark `_stc_search_filled` / `_stc_query_clicked`; gated click entrypoints call `check_search_then_click_allowed` before DOM work. Product replay of table radios keeps existing xpath fallback if the semantic path returns `err-search-first`. No new composite action type.

**Tech Stack:** Python 3 (repo `./python/python.exe`), Playwright `page.evaluate`, cold characterization pins, existing controller actions / prompts / analyze LLM prompt string.

**Spec:** [`docs/superpowers/specs/2026-09-09-search-then-click-design.md`](../specs/2026-09-09-search-then-click-design.md)

## Global Constraints

- Spec decisions binding: layer **C**; trigger **visible search**; satisfied query **A** (查询 button if present else fill-only); path **1** (guards on existing actions); search step **need not** be `source=manual`.
- Phase keys (locked): `business_data_store['_stc_search_filled']` (bool), `business_data_store['_stc_query_clicked']` (bool). Clear both in `_clear_phase_form_state` (same list as `_query_ui` / `_query_ready`).
- Error prefix (locked): results must start with `err-search-first:` (for dup-failure prescription + agent recovery).
- **v1 does not gate `scroll_to_text`** — only click / row-select entrypoints (locks spec §7 open item).
- Tree detection (locked): `page.evaluate` — target node `closest('.el-tree-node')` (or `.el-tree-node__content`) → treat as tree click.
- Do **not**: add composite locate actions; change replay actionType; rewrite historical trajectories; edit `.cursor/`; weaken el-select index-click gate.
- Repo Python: `./python/python.exe` (Windows: `D:\dev\JS-gen\python\python.exe`).
- Main session commits; subagents do not commit.

## File map

| File | Role |
|---|---|
| `scripts/controller/actions/search_then_click_guard.py` | Pure snapshot + allow/block + err string; phase mark helpers |
| `scripts/characterization/cold/characterize-search-then-click-guard.py` | Pure unit pins + wiring needles |
| `scripts/controller/actions/_table.py` | Gate `click_table_row_radio` / `click_table_row_button` |
| `scripts/controller/actions/_misc.py` | Gate tree-bound `click_element_by_index`; mark 查询 on `click_button` |
| `scripts/controller/actions/form_action_engines.py` (or fill success path) | Mark `_stc_search_filled` after successful search-box fill |
| `scripts/controller/actions/phase/intent_contract.py` | Clear `_stc_*` on phase apply |
| `scripts/controller/actions/duplicate_failure_cue.py` | Prescription for `err-search-first` |
| `scripts/prompts/agent-core.md` | CRITICAL bullet |
| `scripts/prompts/agent-tools-table.md` | Row-click discipline |
| `scripts/prompts/agent-tools-common.md` | No expand_all+blind click when search exists |
| `scripts/prompts/phase-reviewer-prompt.md` | brief_plan must include search→click |
| `src/services/trajectory/trajectory-meta-service.js` | analyze prompt enrichment sentence |
| `scripts/characterization/characterize-search-then-click-prompts.mjs` (or `.py`) | Pin prompt + analyze substrings |
| `data/kb/flows/product_library.json` | Force search-tree rule |
| `data/kb/flows/product_element.json` | Force tree + list search rules |
| `scripts/prompts/skills/req-doc-to-kb/SKILL.md` | One-line task template cue |
| `scripts/refactor/verify-all.sh` | Register cold pins |
| Spec status line | Point to this plan after Task 1 |

---

### Task 1: Pure guard module + red cold pin

**Files:**
- Create: `scripts/controller/actions/search_then_click_guard.py`
- Create: `scripts/characterization/cold/characterize-search-then-click-guard.py`
- Modify: `scripts/refactor/verify-all.sh` (register pin)
- Modify: `docs/superpowers/specs/2026-09-09-search-then-click-design.md` (status → plan linked)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `SearchUiSnapshot` dataclass or TypedDict: `has_search_input: bool`, `has_query_button: bool`
  - `def build_err_search_first(why: str) -> str` → starts with `err-search-first:`
  - `def should_block_locate(*, snapshot: SearchUiSnapshot, search_filled: bool, query_clicked: bool) -> tuple[bool, str]`
  - `def mark_search_filled(store: dict | None) -> None`
  - `def mark_query_clicked(store: dict | None) -> None`
  - `def clear_stc_flags(store: dict | None) -> None`
  - `def is_search_field_label(label: str) -> bool` — True if label/placeholder matches `关键字|过滤|搜索` (same idea as `_TREE_FILTER_LABEL_RE`)
  - `STC_SEARCH_FILLED = '_stc_search_filled'`, `STC_QUERY_CLICKED = '_stc_query_clicked'`

- [ ] **Step 1: Write cold pin (expect FAIL until module exists / logic wrong)**

```python
"""Pin search_then_click_guard: visible search → block locate until phase query done."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

def main() -> int:
    path = ROOT / "scripts/controller/actions/search_then_click_guard.py"
    if not path.is_file():
        print("FAIL: missing search_then_click_guard.py")
        return 1
    from scripts.controller.actions.search_then_click_guard import (
        SearchUiSnapshot,
        should_block_locate,
        build_err_search_first,
        is_search_field_label,
        mark_search_filled,
        mark_query_clicked,
        clear_stc_flags,
        STC_SEARCH_FILLED,
        STC_QUERY_CLICKED,
    )
    err = build_err_search_first("need-fill")
    if not err.startswith("err-search-first:"):
        print(f"FAIL: bad err prefix {err!r}")
        return 1
    # no search → never block
    block, _ = should_block_locate(
        snapshot=SearchUiSnapshot(has_search_input=False, has_query_button=False),
        search_filled=False, query_clicked=False,
    )
    if block:
        print("FAIL: blocked with no search UI")
        return 1
    # search input only → need fill
    block, why = should_block_locate(
        snapshot=SearchUiSnapshot(has_search_input=True, has_query_button=False),
        search_filled=False, query_clicked=False,
    )
    if not block or why != "need-fill-search":
        print(f"FAIL: expected block need-fill-search, got {block!r} {why!r}")
        return 1
    block2, _ = should_block_locate(
        snapshot=SearchUiSnapshot(has_search_input=True, has_query_button=False),
        search_filled=True, query_clicked=False,
    )
    if block2:
        print("FAIL: should allow after fill when no query button")
        return 1
    # query button → need click even if filled
    block3, why3 = should_block_locate(
        snapshot=SearchUiSnapshot(has_search_input=True, has_query_button=True),
        search_filled=True, query_clicked=False,
    )
    if not block3 or why3 != "need-query-click":
        print(f"FAIL: expected need-query-click, got {block3!r} {why3!r}")
        return 1
    block4, _ = should_block_locate(
        snapshot=SearchUiSnapshot(has_search_input=True, has_query_button=True),
        search_filled=True, query_clicked=True,
    )
    if block4:
        print("FAIL: should allow after fill+query")
        return 1
    if not is_search_field_label("搜索关键字"):
        print("FAIL: is_search_field_label")
        return 1
    store = {}
    mark_search_filled(store)
    mark_query_clicked(store)
    if not store.get(STC_SEARCH_FILLED) or not store.get(STC_QUERY_CLICKED):
        print("FAIL: mark helpers")
        return 1
    clear_stc_flags(store)
    if store.get(STC_SEARCH_FILLED) or store.get(STC_QUERY_CLICKED):
        print("FAIL: clear_stc_flags")
        return 1
    print("OK search-then-click-guard")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
```

**Note:** Task 1 pin is **pure-only**. Task 3 appends wiring asserts (`should_block_locate` / `guard_locate_or_err` in `_table.py` + `_misc.py`, `_stc_search_filled` in `intent_contract.py`).

- [ ] **Step 2: Run pin — expect FAIL (missing module)**

Run: `D:\dev\JS-gen\python\python.exe scripts/characterization/cold/characterize-search-then-click-guard.py`  
Expected: FAIL missing `search_then_click_guard.py`

- [ ] **Step 3: Implement pure module**

```python
# scripts/controller/actions/search_then_click_guard.py
from __future__ import annotations
from dataclasses import dataclass
import re

STC_SEARCH_FILLED = "_stc_search_filled"
STC_QUERY_CLICKED = "_stc_query_clicked"
_SEARCH_LABEL_RE = re.compile(r"关键字|过滤|搜索")

@dataclass(frozen=True)
class SearchUiSnapshot:
    has_search_input: bool
    has_query_button: bool

def is_search_field_label(label: str) -> bool:
    return bool(_SEARCH_LABEL_RE.search(label or ""))

def build_err_search_first(why: str) -> str:
    return (
        f"err-search-first:{why} | "
        "先填写搜索关键字（有「查询」按钮则再点查询），然后再点击树节点或选中列表行；"
        "禁止盲点。"
    )

def should_block_locate(
    *,
    snapshot: SearchUiSnapshot,
    search_filled: bool,
    query_clicked: bool,
) -> tuple[bool, str]:
    if not snapshot.has_search_input and not snapshot.has_query_button:
        return False, ""
    if snapshot.has_query_button:
        if query_clicked:
            return False, ""
        # Spec A: button present → must click 查询 (fill alone insufficient)
        if not search_filled:
            return True, "need-fill-and-query"
        return True, "need-query-click"
    if search_filled:
        return False, ""
    return True, "need-fill-search"

def mark_search_filled(store: dict | None) -> None:
    if store is not None:
        store[STC_SEARCH_FILLED] = True

def mark_query_clicked(store: dict | None) -> None:
    if store is not None:
        store[STC_QUERY_CLICKED] = True

def clear_stc_flags(store: dict | None) -> None:
    if not store:
        return
    store.pop(STC_SEARCH_FILLED, None)
    store.pop(STC_QUERY_CLICKED, None)
```

- [ ] **Step 4: Run pin — expect PASS (pure-only version)**

- [ ] **Step 5: Register in verify-all.sh + link plan in spec header**

Add after fill-dispatch line:
`run "characterize-search-then-click-guard" "$PY" scripts/characterization/cold/characterize-search-then-click-guard.py`

Spec status line example: `状态：已批准；计划 docs/superpowers/plans/2026-09-09-search-then-click.md`

- [ ] **Step 6: Commit**

```bash
git add scripts/controller/actions/search_then_click_guard.py \
  scripts/characterization/cold/characterize-search-then-click-guard.py \
  scripts/refactor/verify-all.sh \
  docs/superpowers/specs/2026-09-09-search-then-click-design.md
git commit -m "feat(stc): pure search-then-click guard + cold pin"
```

---

### Task 2: Phase clear + mark on fill / 查询 click

**Files:**
- Modify: `scripts/controller/actions/phase/intent_contract.py` (`_clear_phase_form_state` ~227–232)
- Modify: fill success path — prefer `form_action_engines.py` `FillEngine.fill_form_field` after ok result (record mode), or the thin wrapper that `_form.py` uses; if only one call site, mark there
- Modify: `scripts/controller/actions/_misc.py` `click_button` success path when `button_text` normalizes to `查询`

**Interfaces:**
- Consumes: `clear_stc_flags`, `mark_search_filled`, `mark_query_clicked`, `is_search_field_label`
- Produces: phase reset + marks set during recording

- [ ] **Step 1: Clear flags on phase contract**

In `_clear_phase_form_state`, either call `clear_stc_flags(business_data_store)` or add `'_stc_search_filled', '_stc_query_clicked'` to the same `pop` loop as `'_query_ui', '_query_ready', '_submit_ready'`.

- [ ] **Step 2: Mark search fill**

After a successful `fill_form_field` (result starts with `ok`), if `is_search_field_label(label_text)` **or** placeholder/label from element matches the same regex, call `mark_search_filled(business_data_store)`.

- [ ] **Step 3: Mark 查询 click**

When `click_button` / toolbar click succeeds and normalized button text is `查询` (strip spaces), call `mark_query_clicked(business_data_store)`.

- [ ] **Step 4: Extend cold pin with intent_contract needle**

Assert `intent_contract.py` contains `_stc_search_filled` or `clear_stc_flags`.

- [ ] **Step 5: Run pin + commit**

```bash
git add scripts/controller/actions/phase/intent_contract.py \
  scripts/controller/actions/form_action_engines.py \
  scripts/controller/actions/_misc.py \
  scripts/characterization/cold/characterize-search-then-click-guard.py
git commit -m "feat(stc): mark/clear search-then-click phase flags"
```

---

### Task 3: Gate table row + tree index click + async snapshot

**Files:**
- Modify: `scripts/controller/actions/search_then_click_guard.py` — add async helpers
- Modify: `scripts/controller/actions/_table.py` — start of `click_table_row_radio` and `click_table_row_button`
- Modify: `scripts/controller/actions/_misc.py` — after el-select dropdown gate in `click_element_by_index`, before real click
- Modify: cold pin wiring needles → must PASS

**Interfaces:**
- Consumes: Task 1–2
- Produces:
  - `async def detect_search_ui(page) -> SearchUiSnapshot`
  - `async def xpath_is_tree_node(page, xpath: str) -> bool`
  - `async def guard_locate_or_err(page, store) -> str | None` — returns err string to return to agent, or None if allowed

Suggested `detect_search_ui` evaluate (illustrative — adjust to match DOM):

```javascript
() => {
  const inputs = [...document.querySelectorAll('input')].filter(el => {
    if (!el.offsetParent && getComputedStyle(el).visibility === 'hidden') return false;
    const ph = el.placeholder || '';
    const lab = (el.closest('.el-form-item')||{}).querySelector?.('label')?.textContent || '';
    return /关键字|过滤|搜索/.test(ph + lab);
  });
  const btns = [...document.querySelectorAll('button, .el-button, a')].filter(el => {
    const t = (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g,'');
    return t === '查询' && el.offsetParent !== null;
  });
  return { has_search_input: inputs.length > 0, has_query_button: btns.length > 0 };
}
```

`xpath_is_tree_node`: evaluate xpath → `!!node.closest('.el-tree-node')`.

`guard_locate_or_err`:

```python
async def guard_locate_or_err(page, store) -> str | None:
    snap = await detect_search_ui(page)
    filled = bool((store or {}).get(STC_SEARCH_FILLED))
    clicked = bool((store or {}).get(STC_QUERY_CLICKED))
    block, why = should_block_locate(snapshot=snap, search_filled=filled, query_clicked=clicked)
    if not block:
        return None
    return build_err_search_first(why)
```

- [ ] **Step 1: Implement async helpers on the module**

- [ ] **Step 2: Wire `_table.py`**

At the top of `click_table_row_radio` / `click_table_row_button` (after page fetch, before strip/click):

```python
from .search_then_click_guard import guard_locate_or_err
err = await guard_locate_or_err(page, business_data_store)
if err:
    return err  # or err_with(...) if that helper is the local convention — must still start with err-search-first:
```

- [ ] **Step 3: Wire `_misc.py` `click_element_by_index`**

After dropdown gate, if `element_info` xpath is tree node (`await xpath_is_tree_node(page, gate_xp)`), call `guard_locate_or_err`; on err return `_err(err, include_in_memory=True)`.

- [ ] **Step 4: Enable wiring asserts in cold pin; run PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(stc): gate table row and tree index clicks"
```

---

### Task 4: Duplicate-failure prescription

**Files:**
- Modify: `scripts/controller/actions/duplicate_failure_cue.py`
- Modify: `scripts/characterization/characterize-duplicate-failure-cue.py` (add one assert) **or** extend cold stc pin

- [ ] **Step 1: Add prescription tuple**

```python
(
    'err-search-first',
    _PREFIX + '先 fill 搜索关键字；若页面有「查询」则 click_button("查询")；'
    '完成后再点树节点或 click_table_row_radio；禁止原样盲点。',
),
```

- [ ] **Step 2: Assert prescription non-generic for `err-search-first:need-fill-search | …`**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(stc): duplicate-failure cue for err-search-first"
```

---

### Task 5: Prompts + analyze enrichment + prompt pins

**Files:**
- Modify: `scripts/prompts/agent-core.md` — add CRITICAL item 7 (or next number)
- Modify: `scripts/prompts/agent-tools-table.md` — paragraph before `click_table_row_button`
- Modify: `scripts/prompts/agent-tools-common.md` — near `expand_all_el_tree`
- Modify: `scripts/prompts/phase-reviewer-prompt.md` — under brief_plan / navigate rules
- Modify: `src/services/trajectory/trajectory-meta-service.js` — add rule under 阶段拆分规则
- Create: `scripts/characterization/cold/characterize-search-then-click-prompts.py`
- Modify: `verify-all.sh`

**Exact analyze prompt sentence to add** (keep phase count rule intact):

```text
8. 若某步描述「定位/选中」侧栏树节点或列表行：在同一 phase 字符串内写明「先在搜索框填写关键字（若有查询按钮则点查询）再点击」，不要为此增删 phase 条数。
```

**Exact agent-core bullet:**

```text
7. **树/列表先查再点** — 页面有搜索关键字/查询时，禁止盲点树节点或直接选行；遇 `err-search-first` 按指引先填搜索（有则点查询）再点，禁止原样重试。
```

- [ ] **Step 1: Edit the four prompt files + analyze prompt**

- [ ] **Step 2: Cold pin reads files and asserts needles** (`err-search-first`, `先在搜索框填写关键字`, `树/列表先查再点`, phase-reviewer `先搜索`)

- [ ] **Step 3: Run pin PASS + commit**

```bash
git commit -m "docs(stc): prompts + analyze enrichment for search-then-click"
```

---

### Task 6: KB rules + req-doc task template

**Files:**
- Modify: `data/kb/flows/product_library.json` — elevate/add rule keyword `搜索` / `树定位`
- Modify: `data/kb/flows/product_element.json` — two rules: tree locate + list row
- Modify: `scripts/prompts/skills/req-doc-to-kb/SKILL.md` — one bullet under 贯通/任务文案

**Example KB rule text (element):**

```json
{
  "keyword": "先查再点",
  "rule": "左树定位组件或右侧产品要素列表选行前：先填「搜索关键字」（有「查询」则点查询），再点击节点/选行；禁止 expand_all 后盲点（对齐 traj #709）"
}
```

Library: force existing note about 搜索关键字 into `rules[]` with keyword `先查再点`.

SKILL one-liner under task drafting: `树或表定位步骤须写「搜索→（查询）→点击」。`

- [ ] **Step 1: Edit JSON + SKILL**

- [ ] **Step 2: Smoke — `node -e "JSON.parse(fs.readFileSync('data/kb/flows/product_element.json'))"`** (and library)

- [ ] **Step 3: Commit**

```bash
git commit -m "docs(kb): product lib/element search-then-click rules + task cue"
```

---

### Task 7: Agent-log 收工 + optional wet-test note

**Files:**
- Modify: `docs/superpowers/agent-log.md` — 收工回链开工；列出 commit hashes; 遗留=可选湿测 #709 步序
- Modify: spec status if needed (`已实现` partial)

- [ ] **Step 1: Run `bash scripts/refactor/verify-all.sh`** (or at least the new cold pins + duplicate-failure + fill/select greens if touched)

Expected: ALL GREEN (or document any pre-existing red unrelated to this plan)

- [ ] **Step 2: 收工条目 + commit**

```bash
git commit -m "docs(agent-log): close search-then-click implementation"
```

Optional wet-test (not required to close): product element library — blind tree click → `err-search-first`; fill 搜索关键字 → click node → ok. Evidence under `tmp/product-mgmt/search-then-click/` if run.

---

## Spec coverage (self-review)

| Spec item | Task |
|---|---|
| Runtime soft guard + `err-search-first` | 1, 3, 4 |
| Visible search trigger / query-button rule | 1 (`should_block_locate`) |
| Phase-scoped marks + clear | 2 |
| Gate tree index + table row | 3 |
| Prompts (core/table/common/reviewer) | 5 |
| analyze enrichment | 5 |
| KB product_library / product_element | 6 |
| Task template req-doc | 6 |
| Characterization pins | 1, 3, 5 |
| No composite action / no forced manual | Global Constraints |
| scroll_to_text not gated v1 | Global Constraints |
| Optional wet-test | 7 |

## Placeholder / consistency check

- Keys `_stc_search_filled` / `_stc_query_clicked` used consistently across tasks.
- Error prefix `err-search-first:` consistent with dup-failure and prompts.
- No TBD left in task steps.
