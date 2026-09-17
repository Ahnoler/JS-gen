# STC First-Row / First-Leaf XPath Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After STC (search-then-click) succeeds in a phase, table/tree locate clicks execute and record as first row / first leaf with `row_text="first"` plus a structural relative `xpath_smart` (no business keys), so partner data-replacement replay stays stable.

**Architecture:** Reuse existing `wantFirst` execution and STC flags. Add `stc_satisfied()` helper. On STC-satisfied `click_table_row_radio` (then tree), force first-row match, normalize recorded params, and **synthesize** structural xpath via new locator-builders (do not reuse content-anchored `buildTableRowRadioXPathSmart`). Override enrich xpath before `_record_action`. Leave query-button container anchoring as code TODO only.

**Tech Stack:** Python agent actions (`scripts/controller/actions/`), JS locator-builders (`src/cdp/locator-builders/`), characterization cold pins, thin prompt edits.

**Spec:** [`docs/superpowers/specs/2026-09-17-stc-first-row-xpath-design.md`](../specs/2026-09-17-stc-first-row-xpath-design.md)

## Global Constraints

- No new actionType / no new compound action.
- Do not change default content-anchored builders used by old trajectories.
- Do not implement query-anchor container binding (TODO comments only).
- Do not rewrite historical steps that store business-key `row_text`.
- Characterization: RED pin first, then minimal impl; register new pins in `verify-all.sh` when adding new files.
- Do not edit generated `_locator_helpers_js.py` by hand; if live helpers need parity, follow existing gen chain from `page-locator-helpers.js` (or override only on the Python record path for this feature — prefer builders + record override to avoid gen churn unless Task 2 requires live parity).
- AGENTS.md: no commit/push unless the user asks; plan commit steps are optional checkpoints when user requests commits.

## File map

| File | Role |
|------|------|
| `scripts/controller/actions/search_then_click_guard.py` | `stc_satisfied(store, snapshot) -> bool` |
| `scripts/controller/actions/_table.py` | STC first-row force + record normalize + xpath stamp + TODO |
| `scripts/controller/actions/click_action_engine.py` | TODO comment on 查询 success path only |
| `scripts/controller/actions/replay_table.py` | Prefer structural xpath before semantic when present |
| `src/cdp/locator-builders/controls.js` | `buildTableRowRadioFirstXPathSmart`, `buildTreeFirstLeafXPathSmart` |
| `src/cdp/locator-builders/dispatcher.js` | Optional dispatch when `rowText` is first-alias / `firstLeaf` flag — only if needed; otherwise call builders directly from tests + Python |
| `scripts/characterization/cold/characterize-search-then-click-guard.py` | Pin `stc_satisfied` + table source needles |
| `scripts/characterization/cold/characterize-locator-candidates.mjs` | Pin first-row / first-leaf xpath shapes |
| `scripts/prompts/agent-tools-table.md`, `agent-core.md` | STC → pass `first` |
| `scripts/characterization/cold/characterize-search-then-click-prompts.py` | Prompt needles if strings change |

---

### Task 1: `stc_satisfied` helper

**Files:**
- Modify: `scripts/controller/actions/search_then_click_guard.py`
- Test: `scripts/characterization/cold/characterize-search-then-click-guard.py`

**Interfaces:**
- Consumes: `SearchUiSnapshot`, `should_block_locate`, `STC_*` flags
- Produces: `stc_satisfied(store: dict | None, snapshot: SearchUiSnapshot) -> bool`  
  True iff `(snapshot.has_search_input or snapshot.has_query_button)` and `should_block_locate(...)` is False.

- [ ] **Step 1: Write failing pin assertions**

In `characterize-search-then-click-guard.py`, after existing imports, import `stc_satisfied` and add:

```python
    # stc_satisfied: has UI + not blocked
    from scripts.controller.actions.search_then_click_guard import stc_satisfied
    snap_q = SearchUiSnapshot(has_search_input=True, has_query_button=True)
    if stc_satisfied({"_stc_query_clicked": True}, snap_q) is not True:
        print("FAIL: stc_satisfied should be True after query click")
        return 1
    if stc_satisfied({}, snap_q) is not False:
        print("FAIL: stc_satisfied should be False before query")
        return 1
    snap_none = SearchUiSnapshot(has_search_input=False, has_query_button=False)
    if stc_satisfied({"_stc_query_clicked": True}, snap_none) is not False:
        print("FAIL: no search UI → stc_satisfied False even if flags set")
        return 1
```

(Use the real constant names `STC_QUERY_CLICKED` / `STC_SEARCH_FILLED` as store keys, not string literals, if that matches existing pin style.)

- [ ] **Step 2: Run pin — expect FAIL (import / missing symbol)**

Run: `python scripts/characterization/cold/characterize-search-then-click-guard.py`  
Expected: FAIL mentioning `stc_satisfied` or import error.

- [ ] **Step 3: Implement helper**

```python
def stc_satisfied(store: dict | None, snapshot: SearchUiSnapshot) -> bool:
    """True when page has search UI and this phase has completed the STC gate."""
    if not snapshot.has_search_input and not snapshot.has_query_button:
        return False
    filled = bool((store or {}).get(STC_SEARCH_FILLED))
    clicked = bool((store or {}).get(STC_QUERY_CLICKED))
    block, _ = should_block_locate(
        snapshot=snapshot,
        search_filled=filled,
        query_clicked=clicked,
    )
    return not block
```

- [ ] **Step 4: Re-run pin — expect PASS**

Run: `python scripts/characterization/cold/characterize-search-then-click-guard.py`  
Expected: exit 0 / OK.

- [ ] **Step 5: Commit (only if user asked)**

```bash
git add scripts/controller/actions/search_then_click_guard.py \
  scripts/characterization/cold/characterize-search-then-click-guard.py
git commit -m "feat(stc): add stc_satisfied helper for first-row locate mode"
```

---

### Task 2: Structural xpath builders (table first-row + tree first-leaf)

**Files:**
- Modify: `src/cdp/locator-builders/controls.js`
- Modify: `scripts/characterization/cold/characterize-locator-candidates.mjs`
- Optional: export from package entry if tests import named builders already from `controls.js`

**Interfaces:**
- Produces:
  - `buildTableRowRadioFirstXPathSmart({ xpathFull='', className='', container='' } = {}) -> string`
  - `buildTreeFirstLeafXPathSmart({ xpathFull='', className='', container='' } = {}) -> string`
- Shapes must match spec §5 (body-wrapper `tr[1]` radio; tree `is-leaf` `[1]` content). Use existing `scopedXPath`, `detectContainerKind`, `classTokenPred`.

- [ ] **Step 1: Write failing builder pins**

Append to `characterize-locator-candidates.mjs`:

```javascript
import {
  buildTableRowRadioFirstXPathSmart,
  buildTreeFirstLeafXPathSmart,
} from '../../../src/cdp/locator-builders/controls.js';

function testFirstRowRadioXPath() {
  const xp = buildTableRowRadioFirstXPathSmart({ container: 'dialog' });
  assert.ok(xp.includes("el-dialog") || xp.includes('el-message-box'), xp);
  assert.ok(xp.includes('el-table__body-wrapper'), xp);
  assert.ok(/el-table__row/.test(xp) && /\[1\]/.test(xp), xp);
  assert.ok(/el-radio/.test(xp), xp);
  assert.equal(xp.includes("normalize-space()="), false, 'must not embed business text');
}

function testFirstLeafXPath() {
  const xp = buildTreeFirstLeafXPathSmart({ container: 'drawer' });
  assert.ok(xp.includes('el-drawer'), xp);
  assert.ok(xp.includes('el-tree'), xp);
  assert.ok(xp.includes('is-leaf'), xp);
  assert.ok(xp.includes('el-tree-node__content'), xp);
  assert.equal(xp.includes("starts-with(normalize-space()"), false, xp);
}

testFirstRowRadioXPath();
testFirstLeafXPath();
```

Wire into the file’s existing runner the same way other tests are invoked.

- [ ] **Step 2: Run pin — expect FAIL**

Run: `node scripts/characterization/cold/characterize-locator-candidates.mjs`  
Expected: FAIL (export missing).

- [ ] **Step 3: Implement builders**

In `controls.js`, after `buildTableRowRadioXPathSmart`:

```javascript
export function buildTableRowRadioFirstXPathSmart({
  xpathFull = '',
  className = '',
  container = '',
} = {}) {
  const kind = detectContainerKind(xpathFull, className, container);
  const local =
    `div[${classTokenPred('el-table__body-wrapper')}]`
    + `//tr[${classTokenPred('el-table__row')}][1]`
    + `//*[${classTokenPred('el-radio')} or ${classTokenPred('el-radio-button')} or ${classTokenPred('el-checkbox')}]`;
  return scopedXPath(local, kind);
}

export function buildTreeFirstLeafXPathSmart({
  xpathFull = '',
  className = '',
  container = '',
} = {}) {
  const kind = detectContainerKind(xpathFull, className, container);
  const local =
    `div[${classTokenPred('el-tree')}]`
    + `//div[${classTokenPred('el-tree-node')}]`
    + `[.//span[${classTokenPred('el-tree-node__expand-icon')} and ${classTokenPred('is-leaf')}]][1]`
    + `/div[${classTokenPred('el-tree-node__content')}]`;
  return scopedXPath(local, kind);
}
```

Do **not** change `buildTableRowRadioXPathSmart` / `buildTreeNodeXPathSmart` default behavior.

- [ ] **Step 4: Re-run pin — expect PASS**

Run: `node scripts/characterization/cold/characterize-locator-candidates.mjs`  
Expected: OK.

- [ ] **Step 5: Commit (only if user asked)**

```bash
git add src/cdp/locator-builders/controls.js \
  scripts/characterization/cold/characterize-locator-candidates.mjs
git commit -m "feat(locator): structural first-row radio and first-leaf tree xpath builders"
```

---

### Task 3: `click_table_row_radio` STC first-row record path

**Files:**
- Modify: `scripts/controller/actions/_table.py` (`click_table_row_radio`)
- Modify: `scripts/controller/actions/click_action_engine.py` (TODO comment only near 查询 `mark_query_clicked`)
- Modify: `scripts/characterization/cold/characterize-search-then-click-guard.py` (source needles)

**Interfaces:**
- Consumes: `stc_satisfied`, `detect_search_ui`, `buildTableRowRadioFirstXPathSmart` (via Node subprocess **or** duplicate the minimal xpath string in Python using the same template — prefer calling a tiny shared constant string in Python that mirrors the builder local path + optional dialog/drawer prefix detected the same way as existing table overlay scope)
- Produces: when STC satisfied, evaluate uses first-row semantics; `_record_action('click_table_row_radio', {'row_text': 'first'}, ..., element=...)` with `element['xpath_smart']` = structural xpath; `element['row_text']='first'`

Practical approach (avoid Node from Python): define Python helper next to the action:

```python
_FIRST_ROW_RADIO_LOCAL = (
    "div[contains(@class,'el-table__body-wrapper')]"
    "//tr[contains(@class,'el-table__row')][1]"
    "//*[contains(@class,'el-radio') or contains(@class,'el-radio-button') "
    "or contains(@class,'el-checkbox')]"
)

def _structural_first_row_radio_xpath(scope_kind: str) -> str:
    # scope_kind in ('dialog','drawer','') matching detectContainerKind / scopedXPath
    if scope_kind == 'drawer':
        return "//div[contains(@class,'el-drawer')]//" + _FIRST_ROW_RADIO_LOCAL
    if scope_kind == 'dialog':
        return (
            "//div[contains(@class,'el-dialog') or contains(@class,'el-message-box')]"
            "//" + _FIRST_ROW_RADIO_LOCAL
        )
    return "//" + _FIRST_ROW_RADIO_LOCAL
```

Detect `scope_kind` from the same overlay the evaluate already picked (pass back from JS result, e.g. `ok|scope=dialog`, or probe in Python before evaluate). Keep JS `wantFirst` path; when `stc_satisfied`, set `row_text` argument to `'first'` before evaluate regardless of caller input.

- [ ] **Step 1: RED source needles**

In guard characterization (or a new cold file registered in verify-all if preferred), assert `_table.py` contains:

- `stc_satisfied`
- `row_text': 'first'` or `"row_text": "first"` in record path
- `_structural_first_row_radio_xpath` or `el-table__body-wrapper` in the STC branch
- TODO text mentioning query-button container anchor (Chinese or English phrase from spec §7.1)

Also assert `click_action_engine.py` contains a TODO near query marking referencing the same fallback.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `_table.py` flow**

Pseudo-order inside `click_table_row_radio` after `guard_locate_or_err`:

1. `snap = await detect_search_ui(page)`
2. `force_first = stc_satisfied(business_data_store, snap)`
3. `effective_row = 'first' if force_first else row_text`
4. best-effort: try existing loading wait helper if already imported in module neighborhood (`wait_for_loading` pattern / short evaluate for `.el-loading-mask` gone) — do not invent XHR wait
5. run existing evaluate with `effective_row` (wantFirst already handles first aliases)
6. on ok: build `element` dict; if `force_first`, set `element['xpath_smart'] = _structural_first_row_radio_xpath(scope_kind)`, `element['row_text']='first'`, record params `{'row_text': 'first'}` only
7. if not force_first, keep today’s enrich + `row_text` behavior

Add comment block:

```python
# TODO(stc-query-anchor): If wet tests show main-page query selecting an overlay
# table (or multi-table wrong target), remember the 查询 button's closest
# dialog/drawer/toolbar root on click_button success and restrict first-row
# locate + xpath synthesis to that root. See spec
# docs/superpowers/specs/2026-09-17-stc-first-row-xpath-design.md §7.1
```

Mirror a one-line TODO in `click_action_engine.py` where `mark_query_clicked` runs.

- [ ] **Step 4: Re-run needles + full guard pin — PASS**

- [ ] **Step 5: Commit (only if user asked)**

```bash
git commit -m "feat(table): STC-satisfied click_table_row_radio records first + structural xpath"
```

---

### Task 4: Replay order for table row radio

**Files:**
- Modify: `scripts/controller/actions/replay_table.py`
- Test: extend cold pin that reads `replay_table.py` **or** add assertions to an existing replay characterization if one already pins this file; otherwise source-needle in a small cold pin registered in verify-all

**Interfaces:**
- When `_element_xpath_smart(entry)` is non-empty, try durable/xpath path **before** semantic `click_table_row_radio(row_text)`; if xpath fails and `row_text` is first-alias or any text, fall back to semantic.

- [ ] **Step 1: RED pin** — assert `replay_table.py` calls xpath/durable before `_replay_controller_action` for row radio when smart xpath present (reorder code; pin the relative order with two needles / comment marker `locate=xpath-first`).

- [ ] **Step 2: Implement reorder** matching spec §6.

- [ ] **Step 3: PASS + commit if asked**

```bash
git commit -m "fix(replay): prefer structural xpath before row_text for table row radio"
```

---

### Task 5: Prompts (thin)

**Files:**
- Modify: `scripts/prompts/agent-tools-table.md`
- Modify: `scripts/prompts/agent-core.md` (one line under 树/列表先查再点 if needed)
- Modify: `scripts/characterization/cold/characterize-search-then-click-prompts.py`

- [ ] **Step 1: Update prompts**

Add explicit rule: after filling search and clicking 查询 in this phase, call `click_table_row_radio(row_text="first")` (do not pass customer number / name); engine records structural xpath.

- [ ] **Step 2: Adjust prompt pin needles** to the new substring(s); RED then GREEN.

- [ ] **Step 3: Commit if asked**

```bash
git commit -m "docs(prompts): STC phase select first table row with row_text=first"
```

---

### Task 6: Tree first-leaf (same contract, second wiring)

**Files:**
- Identify the tree click path used under STC (`click_element_by_index` tree node / dedicated tree action). Prefer the path already gated by `guard_locate_or_err` / `xpath_is_tree_node`.
- Modify that path similarly: when `stc_satisfied`, force first-leaf click semantics if an API exists; else record `buildTreeFirstLeafXPathSmart` / Python mirror xpath and instruct agent via prompt to use first. Minimum viable: when recording a tree node click under STC, **override** `xpath_smart` to first-leaf template and clear business text from params where safe.

- [ ] **Step 1: Locate exact gate** (read `click_action_engine.py` tree branch + `_tree.py`); document in PR/commit body which function was wired.

- [ ] **Step 2: RED needles** for first-leaf xpath stamp under STC.

- [ ] **Step 3: Minimal wiring** — if full first-leaf **click** automation is too large, ship **record override only** when the click already hit a leaf after query (still set xpath to first-leaf template + param first), and note residual in agent-log. Prefer full click-to-first-leaf if a small evaluate can DFS first `is-leaf` content click.

- [ ] **Step 4: Pins PASS; commit if asked**

```bash
git commit -m "feat(tree): STC-satisfied tree locate records first-leaf structural xpath"
```

---

### Task 7: Gate + self-check

- [ ] **Step 1: Run**

```bash
python scripts/characterization/cold/characterize-search-then-click-guard.py
python scripts/characterization/cold/characterize-search-then-click-prompts.py
node scripts/characterization/cold/characterize-locator-candidates.mjs
bash scripts/refactor/verify-all.sh
```

Expected: new pins green; verify-all no **new** reds beyond known baseline (step-highlight / layer-tree / confirm-notification / network-capture or current baseline).

- [ ] **Step 2: Spec coverage checklist**

| Spec § | Task |
|--------|------|
| §3 table contract | Task 1 + 3 |
| §5.1 xpath shape | Task 2 + 3 |
| §5.2 tree xpath | Task 2 + 6 |
| §6 replay order | Task 4 |
| §7.1 TODO only | Task 3 comments |
| §9 characterization | Tasks 1–4, 6 |
| Prompts | Task 5 |

- [ ] **Step 3: Hand off wet-test note** — dialog picker: query → first row; change query value → replay still first row; old business-key traj unchanged.

---

## Spec self-review (plan author)

1. **Coverage:** Query-anchor deferred as TODO — Tasks 3 comments. Loading best-effort — Task 3 step. Empty table `err-no-row-match` — existing path retained when wantFirst finds nothing.  
2. **Placeholders:** None intentional; tree Task 6 allows record-override MVP if click-first-leaf is large — residual must be written to agent-log, not left as TBD in code.  
3. **Consistency:** `stc_satisfied` name shared Tasks 1/3/6; xpath local template must stay aligned between JS builders and Python mirror (Task 2 pin + Task 3 string).

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-17-stc-first-row-xpath.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session executes tasks with checkpoints  

Which approach?
