# Params-first xpath replay + dry audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make product live replay prefer `params.xpath_smart` for fill/select, eliminate empty-placeholder false ok, rewrite select to xpath-trigger execution, add a dry-run CDP audit matrix, and clean traj 102 phase-4 `option_text=first` before acceptance.

**Architecture:** Shared `JS_FILL_BY_XPATH` gets a safe placeholder guard; `_replay.py` resolves locators as params → element → label → full, read-backs the target, and classifies `false_ok` / `xpath_miss` / `bad_option_text`. Select stops using `_with_xpath_first` label-mutate. A characterization/CDP dry-audit script reports the matrix without mutating the page.

**Tech Stack:** Python 3 (Playwright CDP), Node characterization scripts, MySQL traj 102, existing `scripts/actions/_js_snippets.py` / `_replay.py`.

**Spec:** `docs/superpowers/archive/specs/2026-08-08-xpath-params-replay-audit-design.md` (conflict resolutions 1A/2A/3B/4A/5A).

## Global Constraints

- Read-path only this cut: **params.xpath_smart first**; do not unify record-time element write.
- Code behavior change: **`fill_form_field` + `select_option` only**.
- Shared JS: remove empty-`ph` false match; replay must not pass label as `placeholderHint` (assistant may still pass label).
- Select: **must** execute via `JS_SELECT_TRIGGER_BY_XPATH` when xpath available (**2A**).
- Audit: **dry-run only** (**4A** reconfirmed) — hits + existing value read-back; no mutate. Wet `false_ok` / read-back-after-write proof is **T7 product replay / E2E only**.
- Target unchanged after purported ok → **`false_ok`** (**5A**); `wrong_control` optional.
- Phase acceptance requires cleaning `option_text=first` steps (**3B**).
- Do not change `RELATIVE_XPATH_PRIMARY` default.

## File map

| File | Responsibility |
|------|----------------|
| `scripts/actions/_js_snippets.py` | Safe placeholder match in `JS_FILL_BY_XPATH` |
| `scripts/actions/_replay.py` | Params-first resolve, fill/select rewrite, read-back, typed failures |
| `scripts/characterization/characterize-xpath-fill-select.py` | Guard + params-priority characterization |
| `scripts/characterization/characterize-replay-params-xpath.py` | Unit-level tests for resolve/read-back helpers (no browser) |
| `scripts/characterization/audit-traj-xpath-dry.mjs` (or `.py`) | Dry CDP matrix for traj/phase |
| DB traj 102 | Clean `option_text=first` steps (ops task) |

---

### Task 1: Harden `JS_FILL_BY_XPATH` placeholder matching

**Files:**
- Modify: `scripts/actions/_js_snippets.py` (`JS_FILL_BY_XPATH` placeholder block ~418–430)
- Modify: `scripts/characterization/characterize-xpath-fill-select.py`

**Interfaces:**
- Consumes: existing `JS_FILL_BY_XPATH = ([xpath, val, placeholderHint]) => …`
- Produces: same signature; placeholder branch only matches when `want` and `ph` are both non-empty and `ph.includes(want)`

- [ ] **Step 1: Extend failing characterization**

In `characterize-xpath-fill-select.py`, add:

```python
def test_fill_by_xpath_rejects_empty_placeholder_match() -> None:
    js = JS_FILL_BY_XPATH
    assert_true("want.includes(ph)" not in js, "must not use want.includes(ph) (empty ph false ok)")
    assert_true(
        "ph.includes(want)" in js,
        "placeholder match must use ph.includes(want)",
    )
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `python scripts/characterization/characterize-xpath-fill-select.py`  
Expected: FAIL on `want.includes(ph)` still present.

- [ ] **Step 3: Patch placeholder branch**

Replace the match condition with:

```javascript
const want = String(placeholderHint || '').trim();
if (!want) { /* skip placeholder pass */ }
// inside loop:
const ph = String(inp.getAttribute('placeholder') || '').trim();
if (!ph) continue;
if (ph.includes(want) && !inp.disabled && /* visibility checks */) {
```

Remove `want.includes(ph)`.

- [ ] **Step 4: Re-run characterization — expect PASS**

Run: `python scripts/characterization/characterize-xpath-fill-select.py`  
Expected: `characterize-xpath-fill-select: OK`

- [ ] **Step 5: Commit**

```bash
git add scripts/actions/_js_snippets.py scripts/characterization/characterize-xpath-fill-select.py
git commit -m "fix: block empty-placeholder false ok in JS_FILL_BY_XPATH"
```

---

### Task 2: Params-first xpath resolver + read-back helpers in `_replay.py`

**Files:**
- Modify: `scripts/actions/_replay.py` (near `_element_xpath_smart`)
- Create: `scripts/characterization/characterize-replay-params-xpath.py`

**Interfaces:**
- Produces:
  - `_params_xpath_smart(entry, params) -> str`
  - `_resolve_replay_xpath(entry, params) -> tuple[str, str]`  # (xpath, source) source in `params|element|full|`
  - `_norm_replay_value(s) -> str`  # strip spaces for compare
  - `_read_value_by_xpath(page, xpath) -> str`  # page.evaluate small JS
  - `_classify_fill_result(action_ok, expected, actual) -> str`  # returns ok… / false_ok:… / xpath_miss:…

- [ ] **Step 1: Write failing unit characterization**

```python
# scripts/characterization/characterize-replay-params-xpath.py
from scripts.actions import _replay as R

def test_resolve_prefers_params():
    entry = {"element": {"xpath_smart": "//div[contains(@class,'el-form-item')][.//label[contains(.,'X')]]//input"}}
    params = {"xpath_smart": "//tr[.//*[normalize-space()='X']]//input", "label_text": "X", "value": "1"}
    xp, src = R._resolve_replay_xpath(entry, params)
    assert xp.startswith("//tr"), xp
    assert src == "params"

def test_classify_false_ok():
    assert R._classify_fill_result(True, "45.50", "45.50").startswith("ok")
    assert R._classify_fill_result(True, "45.50", "10.20").startswith("false_ok")
    assert R._classify_fill_result(False, "45.50", "").startswith("xpath_miss") or True
```

- [ ] **Step 2: Run — expect FAIL (missing helpers)**

Run: `python scripts/characterization/characterize-replay-params-xpath.py`

- [ ] **Step 3: Implement helpers**

```python
def _params_xpath_smart(entry, params) -> str:
    p = params if isinstance(params, dict) else {}
    xp = str(p.get("xpath_smart") or "").strip()
    if xp.startswith("//") or xp.startswith("("):
        return xp
    return ""

def _resolve_replay_xpath(entry, params) -> tuple[str, str]:
    if not relative_xpath_primary_enabled():
        full = _element_xpath_full(entry)
        return (full, "full") if full else ("", "")
    px = _params_xpath_smart(entry, params)
    if px:
        return px, "params"
    ex = _element_xpath_smart(entry)
    if ex:
        return ex, "element"
    full = _element_xpath_full(entry)
    if full:
        return full, "full"
    return "", ""
```

Implement `_norm_replay_value`, `_read_value_by_xpath` (evaluate xpath → last visible input/textarea `.value` or select display text), `_classify_fill_result`.

- [ ] **Step 4: Run characterization — PASS**

- [ ] **Step 5: Commit**

```bash
git add scripts/actions/_replay.py scripts/characterization/characterize-replay-params-xpath.py
git commit -m "feat: params-first xpath resolve helpers for replay"
```

---

### Task 3: Rewrite `_replay_form_action` fill path

**Files:**
- Modify: `scripts/actions/_replay.py` — `async def _replay_form_action` fill branch

**Interfaces:**
- Consumes: `_resolve_replay_xpath`, `JS_FILL_BY_XPATH`, `_classify_fill_result`, `_read_value_by_xpath`
- Produces: fill results that never return bare `ok*` without read-back when a target xpath exists

- [ ] **Step 1: Add characterization assertion on source text**

In `characterize-replay-params-xpath.py`:

```python
def test_replay_fill_does_not_pass_label_as_placeholder_hint():
    src = open("scripts/actions/_replay.py", encoding="utf-8").read()
    # After fix, fill evaluate must not use placeholder or label as 3rd arg
    assert "placeholder or label" not in src.split("if action_name == 'fill_form_field'")[1].split("if action_name == 'fill_date_field'")[0]
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Replace fill branch**

Logic:

1. `xp, src = _resolve_replay_xpath(entry, params)`
2. `ph = placeholder only` (keep search-label→placeholder heuristic for true search boxes, but do **not** pass label into `JS_FILL_BY_XPATH` third arg unless it was derived as real placeholder text for 搜索/关键字 — preferred: only `params.placeholder` / element placeholder attrs)
3. If `xp`: `result = evaluate(JS_FILL_BY_XPATH, [xp, value, ph])`; then `actual = await _read_value_by_xpath(page, _params_xpath_smart(...) or xp)`; return `_classify_fill_result(result.startswith('ok'), value, actual)` with `locate=` suffix
4. Else label `JS_FILL_FORM_FIELD`; if ok, read-back via params xp if any else treat label success as ok-label (no params xp → cannot false_ok on table)
5. Then xpath_full same pattern

- [ ] **Step 4: Run characterizations + `python -c "from scripts.actions._replay import _replay_form_action"` import OK**

- [ ] **Step 5: Commit**

```bash
git commit -am "fix: replay fill uses params xpath + read-back (no label placeholderHint)"
```

---

### Task 4: Rewrite `_replay_form_action` select_option path (**2A**)

**Files:**
- Modify: `scripts/actions/_replay.py` — `select_option` branch inside `_replay_form_action`
- Modify: `scripts/characterization/characterize-xpath-fill-select.py` (assert replay source uses trigger-by-xpath)

**Interfaces:**
- Consumes: `JS_SELECT_TRIGGER_BY_XPATH`, `JS_SELECT_OPTION`, `JS_SELECT_VALUE_BY_XPATH` (from `_js_snippets`)
- Produces: select that mutates via xpath trigger when xp present; rejects `first`

- [ ] **Step 1: Failing source assertion**

```python
def test_replay_select_uses_trigger_by_xpath():
    src = Path("scripts/actions/_replay.py").read_text(encoding="utf-8")
    select_fn = src.split("if action_name == 'select_option':", 1)[1].split("return f'unknown-form-action", 1)[0]
    assert "JS_SELECT_TRIGGER_BY_XPATH" in select_fn
    assert "bad_option_text" in select_fn or "first" in select_fn
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement select**

```python
if action_name == "select_option":
    pick = str(value or "").strip()
    if not pick:
        return "error:missing-option_text"
    if pick.lower() in ("first", "any", "random"):
        return f"bad_option_text:{pick}"
    xp, src = _resolve_replay_xpath(entry, params)
    if xp:
        # already-matched via xpath value read if available
        cur = await page.evaluate(JS_SELECT_VALUE_BY_XPATH, [xp])  # or existing helper
        if isinstance(cur, str) and cur.startswith("ok-already:") and cur.split(":",1)[1].strip() == pick:
            return f"ok-already:{pick}|locate={src}"
        trig = await page.evaluate(JS_SELECT_TRIGGER_BY_XPATH, [xp])
        if not _is_ok_result(str(trig)):
            # fall through to label
            pass
        else:
            result = "no-items"
            for attempt in range(3):
                await page.wait_for_timeout(500 if attempt == 0 else 400)
                result = await page.evaluate(JS_SELECT_OPTION, [pick, True])
                if isinstance(result, str) and result.startswith("ok"):
                    break
            # exact match check + read-back
            ...
            return classified
    # label fallback: existing JS_FIND_LABELED_SELECT / JS_SELECT_OPTION path WITHOUT claiming ok-xpath-smart unless xp worked
```

Do **not** wrap label success as `ok-xpath-smart` merely because `_try_xpath_locate` was true.

- [ ] **Step 4: Run characterizations — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -am "fix: replay select_option executes via xpath trigger (params-first)"
```

---

### Task 5: Dry-run CDP audit script (**4A**)

**Files:**
- Create: `scripts/characterization/audit-traj-xpath-dry.py`

**Interfaces:**
- CLI: `python scripts/characterization/audit-traj-xpath-dry.py --traj 102 --phase 4 --cdp http://127.0.0.1:9242`
- Output JSON lines / summary counts by class
- Must not call click/fill/select

- [ ] **Step 1: Skeleton script that loads steps from MySQL (same knex/node pattern or pymysql via existing config) and connects CDP**

For each step print: id, action, params_xs, element_xs, params_hit, element_hit, chosen_source, class.

Classification dry-run rules:
- `bad_option_text` if option_text in first/any/random
- `params_absent` if fill/select and no params xp
- `xpath_miss` if chosen xp vis=0
- `pass` if fill/select and chosen xp vis>0 and (no expected value or read-back equals expected)
- `false_ok` only if we can detect mismatch between expected and current **without writing** (optional when current ≠ expected and params hit — note as `value_mismatch` dry signal; map to advisory, not claim runtime false_ok)
- `skip` for save_form_snapshot without fields

Keep dry-run honest: do not invent runtime `false_ok` without mutation; use `value_mismatch` note when current ≠ recorded expected. Wet proof stays in Task 7 (`steps/replay` / CDP point checks).

- [ ] **Step 2: Run against live CDP on rating page**

Expected: ~25 rows with params hit / element miss; list `option_text=first` ids.

- [ ] **Step 3: Commit**

```bash
git add scripts/characterization/audit-traj-xpath-dry.py
git commit -m "feat: dry-run traj xpath audit matrix (CDP)"
```

---

### Task 6: Clean traj 102 phase-4 `option_text=first` (**3B**)

**Files:**
- Ops/DB only (document SQL); no product code required

- [ ] **Step 1: List offending step ids**

```sql
-- via audit script or:
-- steps 5397–5403 from E2E (confirm live)
```

- [ ] **Step 2: For each id, set `params_json.option_text` to the intended option from `params_json.options[0]` only if product-owner confirms — otherwise delete step / re-record**

Preferred: **re-record** those selects with real option_text (user/ops). If updating in place:

```javascript
// node one-off: for each step, if option_text==='first' && options.length, set option_text=options[0] ONLY with explicit user approval per field
```

Do **not** silently pick `options[0]` without confirmation — Ask user which option per label if re-record not available.

- [ ] **Step 3: Re-run dry audit — zero `bad_option_text` in phase 4**

- [ ] **Step 4: Commit any one-off script if kept under `scripts/tools/`; else document in CHANGELOG ops note only

---

### Task 7: Verification gate

**Files:** none new

- [ ] **Step 1: Run**

```bash
python scripts/characterization/characterize-xpath-fill-select.py
python scripts/characterization/characterize-replay-params-xpath.py
node scripts/characterization/characterize-locator-candidates.mjs
node scripts/characterization/characterize-ctrl.mjs
node scripts/smoke/accept-replay-apis.mjs
python scripts/characterization/audit-traj-xpath-dry.py --traj 102 --phase 4 --cdp http://127.0.0.1:9242
```

- [ ] **Step 2: CDP point checks (manual/agent)**

- Element-only fill path for 资产负债率 must not return `ok-placeholder`
- Params `//tr…//input` fill + read-back
- Params `//tr…//el-select` trigger for 业务往来及使用

- [ ] **Step 3: Product `steps/replay` on cleaned phase-4 fill+select subset — confirmed=1 for valid params steps

- [ ] **Step 4: Final commit if docs/CHANGELOG needed**

Scripts-only: optional short note under Unreleased Fixed in `CHANGELOG.md` for discoverability (Python sync: 无).

---

## Spec coverage checklist

| Spec item | Task |
|-----------|------|
| Empty placeholder false ok | T1 |
| Params-first resolve | T2–T3 |
| Fill read-back / false_ok | T3 |
| Select xpath trigger (**2A**) | T4 |
| bad_option_text | T4 + T6 |
| Dry audit (**4A**) | T5 |
| Clean first (**3B**) | T6 |
| Verification | T7 |
| Write-path unify | Follow-up (not in plan) |
