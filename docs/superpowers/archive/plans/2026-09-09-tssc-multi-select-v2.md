# TsscMultiSelect v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Table-mode TsscMultiSelect fills via P0→P1→P2 inside one JS evaluate; agent only ever calls `select_option`, which handoffs to the internal implementation and records `select_option` (D6).

**Architecture:** Keep `JS_TSSC_MULTI_SELECT` + `SelectEngine.tssc_multi_select` as an **internal** subroutine. Rewrite the table branch to P0 open → optional P1 search (exact-switch OFF) → P2 clear+first / `err-no-options`. Remove `@controller.action` + prompt registration so the LLM cannot call `tssc_multi_select`. Strengthen `select_option` handoff + autofill to use the internal method while `_record_action('select_option', …)` with `target_kind=form_tssc_multi_select`. Dict / el-option path stays on the v1 branch inside the same snippet.

**Tech Stack:** Playwright `page.evaluate` JS snippets, Python `SelectEngine`, cold characterization pins, agent prompt packs.

**Spec:** [`docs/superpowers/specs/2026-09-09-tssc-multi-select-v2-design.md`](../specs/2026-09-09-tssc-multi-select-v2-design.md)

## Global Constraints

- D1–D6 from spec are binding (P2 any-first fallback; skip P1 when empty/`first`; table-only v2; single JS; exact OFF when switch exists; **select_option sole agent entry**).
- Do **not** delete `JS_TSSC_MULTI_SELECT` or the Python method — only un-register from agent tools.
- Do **not** remove historical replay aliases in `src/models/action-name.js` / `event_dispatch` for old `action_type=tssc_multi_select` rows (compat); **new** recordings must write `select_option`.
- Do **not** change introduce_pick / dialog_close gates, tree actions, or `SELECT_TABLE_ROW_OPTIONS` deletion.
- Do **not** touch: `config/update-db-whitelist.ps1`, kb drafts, deadcode/engine P0 lines.
- Characterization: update existing cold pin + add v2 markers; keep `verify-all` green.
- Commits: one per completed task after green pin (user asked to commit when done).

## File map

| File | Role |
|---|---|
| `scripts/controller/actions/js_snippets/tssc_multi_select.py` | Table P0/P1/P2 rewrite; dict branch keep |
| `scripts/controller/actions/form_action_engines.py` | Handoff; record as `select_option`; error copy; stamp `ok-p1`/`ok-p2` |
| `scripts/controller/actions/_form.py` | Remove `@controller.action` for `tssc_multi_select` |
| `scripts/controller/actions/autofill_round.py` | Dispatch tssc kind via `select_option` / internal method; record select_option |
| `scripts/prompts/agent-tools-tssc-multi-select.md` | Retarget: “via select_option, engine handoff” (or delete + fold into form) |
| `scripts/prompts/agent-tools-form.md` | Teach select_option for `.tssc-multi-select` |
| `scripts/prompts/agent-prompt.md` / `scripts/agent_utils.py` | Stop injecting dedicated tssc tool pack **or** inject rewritten guidance only |
| `scripts/models/action.py` | Keep name for replay compat **or** document; agent discovery must not list it as callable — prefer keep in registry for replay, remove controller.action only |
| `scripts/characterization/cold/characterize-tssc-multi-select.py` | Pin D6 + v2 markers |
| `scripts/characterization/characterize-select-option-stamp.py` | Stamp `ok-p1`/`ok-p2`; record action name |
| `scripts/refactor/verify-all.sh` | Already registers characterize-tssc; extend if new pin file |

---

### Task 1: Red pin — v2 markers + D6 agent surface

**Files:**
- Modify: `scripts/characterization/cold/characterize-tssc-multi-select.py`
- Test: same

**Interfaces:**
- Consumes: nothing
- Produces: failing assertions that later tasks turn green

- [ ] **Step 1: Extend the cold pin**

Add / replace checks so the pin requires:

```python
# v2 table phases + codes
("scripts/controller/actions/js_snippets/tssc_multi_select.py", (
    "JS_TSSC_MULTI_SELECT",
    "ok-p1:",
    "ok-p2:",
    "err-no-options",
    "精确",  # exact-switch OFF path
    "select-table",
    "el-select-dropdown__item",  # dict still present
)),

# D6: no agent-facing @controller.action for tssc_multi_select
# Assert _form.py does NOT contain:
#   @controller.action(...)\n    async def tssc_multi_select
# Helper:
def no_agent_tssc_action():
    src = (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
    if "async def tssc_multi_select" in src and "@controller.action" in src:
        # fail if a @controller.action decorator immediately precedes tssc_multi_select
        import re
        if re.search(
            r"@controller\.action\([^)]*\)\s*\n\s*async def tssc_multi_select\b",
            src,
        ):
            print("FAIL: tssc_multi_select still registered as @controller.action")
            return False
    return True

# D6: select_option handoff still present
("scripts/controller/actions/form_action_engines.py", (
    "lookup_field_kind(self.business_data_store, label_text) == 'tssc-multi-select'",
    "return await self.tssc_multi_select(",
)),

# D6: handoff success records select_option (not tssc_multi_select)
# Pin a distinctive nearby comment or the record call site change:
#   _record_action(\n                'select_option',
# inside async def tssc_multi_select

# Prompt: agent must not be told to call tssc_multi_select(
# Prefer: agent-tools-form.md contains select_option + tssc-multi-select / .tssc-multi-select
# and agent-tools-tssc-multi-select.md either gone from agent_utils packs OR rewritten
# without teaching `tssc_multi_select(label_text` as the call shape.
```

Also update any existing pin lines that currently **require** `@controller.action` / `tssc_multi_select(label_text, option_text)` in the prompt pack — flip them to D6 expectations.

- [ ] **Step 2: Run pin — expect RED**

```bash
D:\anaconda3\python.exe scripts/characterization/cold/characterize-tssc-multi-select.py
```

Expected: FAIL on missing `ok-p1:` / still-registered `@controller.action` / record action name / prompt.

- [ ] **Step 3: Commit pin-only (red allowed in message)**

```bash
git add scripts/characterization/cold/characterize-tssc-multi-select.py
git commit -m "test: pin tssc v2 P0-P2 and select_option-only agent surface"
```

---

### Task 2: JS table P0→P1→P2

**Files:**
- Modify: `scripts/controller/actions/js_snippets/tssc_multi_select.py`
- Test: cold pin from Task 1 (partial green on snippet needles)

**Interfaces:**
- Consumes: same evaluate args `[label, option]`
- Produces: return strings `ok-p1:…` / `ok-p2:…` / `err-no-options:…` (plus existing `ok-already` / dict `ok:` / `ok-first:`)

- [ ] **Step 1: Restructure table branch (keep dict branch)**

After open + wait, detect mode:

```javascript
const hasTable = openDropdowns().some(dd => dd.querySelector('.select-table'));
if (!hasTable) {
  // existing dict/el-option path (unchanged logic) → return ok: / ok-first: / …
}
// --- table v2 ---
const isFirstAlias = (s) => { /* first/1st/第一个/第一项/empty */ };
const forceExactOff = (dd) => {
  for (const sw of dd.querySelectorAll('.el-switch')) {
    const lbl = (sw.innerText || sw.getAttribute('aria-label') || '');
    if (lbl.includes('精确') && sw.classList.contains('is-checked')) sw.click();
  }
};
const findSearchInput = (dd) =>
  dd.querySelector('.search input.el-input__inner, .search input, .select-table input.el-input__inner');
const setSearch = (input, val) => {
  if (!input) return;
  const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  proto.set.call(input, val);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
};
const visibleRows = () => /* tr.el-table__row in open .select-table, height>0 */;
const clickFirstRow = async () => { /* click td/tr; return readback */ };

// P0 already opened
if (!isFirstAlias(optNorm)) {
  // P1
  for (const dd of openDropdowns()) {
    if (!dd.querySelector('.select-table')) continue;
    forceExactOff(dd);
    setSearch(findSearchInput(dd), optNorm);
  }
  await sleep(/* existing short poll */);
  if (visibleRows().length) {
    const echo = await clickFirstRow();
    if (echo) return 'ok-p1:' + echo;
    return 'err-no-echo: …';
  }
}
// P2
for (const dd of openDropdowns()) {
  if (!dd.querySelector('.select-table')) continue;
  setSearch(findSearchInput(dd), '');
}
await sleep(/* poll */);
if (visibleRows().length) {
  const echo = await clickFirstRow();
  if (echo) return 'ok-p2:' + echo;
  return 'err-no-echo: …';
}
return 'err-no-options: table empty after clear. Prefer real_click / click_element to fill this field; do NOT blindly retry select_option.';
```

Opener: prefer `.el-select` click when trigger `readonly` (客户名称).

- [ ] **Step 2: Run pin — snippet needles GREEN; D6 still RED**

```bash
D:\anaconda3\python.exe scripts/characterization/cold/characterize-tssc-multi-select.py
```

- [ ] **Step 3: Commit**

```bash
git add scripts/controller/actions/js_snippets/tssc_multi_select.py
git commit -m "feat(js): tssc table select P0-P1-P2 with ok-p1/ok-p2"
```

---

### Task 3: Engine — record as `select_option`, stamp, error copy

**Files:**
- Modify: `scripts/controller/actions/form_action_engines.py` (`tssc_multi_select` method ~1561–1633; fill_form_field next_action ~397–408; any `tssc_multi_select(` in agent-facing next_action strings)
- Modify: `scripts/characterization/characterize-select-option-stamp.py` if needed
- Test: cold pins

**Interfaces:**
- Consumes: JS results `ok-p1:` / `ok-p2:`
- Produces: `_record_action('select_option', {label_text, option_text: stamped}, …)` with `target_kind=form_tssc_multi_select` on element

- [ ] **Step 1: Change record action name**

In `async def tssc_multi_select`:

```python
_record_action(
    'select_option',  # was 'tssc_multi_select' — D6
    {'label_text': label_text, 'option_text': stamped},
    result,
    element=element,
)
```

Ensure `resolve_recorded_option_text` already strips any `ok-*:` prefix (extend if `ok-p1`/`ok-p2` not handled — usually split on first `:`).

- [ ] **Step 2: Rewrite agent-facing error / next_action strings**

Replace every `tssc_multi_select(label_text=...)` suggestion with `select_option(label_text=..., option_text=...)`.  
`fill_form_field` `err-use-tssc-multi-select` may keep error **code** for pins, but `next_action` must be `select_option(...)`.

- [ ] **Step 3: Update stamp pin**

In `characterize-select-option-stamp.py` `test_tssc_multi_select_stamps_concrete`: assert `_record_action(` uses `'select_option'` inside the `tssc_multi_select` method body; assert `ok-p1`/`ok-p2` appear in engines or snippet.

- [ ] **Step 4: Run pins GREEN for engine parts**

```bash
D:\anaconda3\python.exe scripts/characterization/cold/characterize-tssc-multi-select.py
D:\anaconda3\python.exe scripts/characterization/characterize-select-option-stamp.py
```

- [ ] **Step 5: Commit**

```bash
git add scripts/controller/actions/form_action_engines.py scripts/characterization/characterize-select-option-stamp.py
git commit -m "fix(engine): record tssc handoff as select_option; stamp ok-p1/p2"
```

---

### Task 4: Unregister agent tool + prompt/autofill

**Files:**
- Modify: `scripts/controller/actions/_form.py` — remove `@controller.action` + `async def tssc_multi_select` wrapper (keep engine method only)
- Modify: `scripts/controller/actions/autofill_round.py` — where it dispatches `'tssc_multi_select'`, call `select_option` or `_select_engine.tssc_multi_select` but ensure recorded path is select_option (engine already records)
- Modify: `scripts/prompts/agent-tools-form.md` — line ~114 and select_option bullet: TsscMultiSelect fields use **`select_option`** (engine handoff); `option_text="first"` ok; do not invent a second action
- Modify: `scripts/prompts/agent-tools-tssc-multi-select.md` — rewrite as **engine note** (not a callable), OR delete and remove includes from `agent-prompt.md` + `agent_utils.py`
- Modify: `scripts/prompts/agent-prompt.md`, `scripts/agent_utils.py` — drop pack include if file deleted / keep if rewritten as non-callable guidance
- Keep: `scripts/models/action.py`, `event_dispatch.py`, `state.py`, `action-name.js` entries for **replay** of old steps (document in pin comment)

**Interfaces:**
- Autofill: for kind `tssc-multi-select`, invoke the same code path as `select_option` handoff (preferred: `await select_engine.select_option(...)` so live kind lookup + handoff run)

- [ ] **Step 1: Remove controller.action registration**

Delete the `@controller.action` / `async def tssc_multi_select` block in `_form.py` (~175–182). Do not delete `SelectEngine.tssc_multi_select`.

- [ ] **Step 2: Autofill dispatch**

Change autofill branch that calls action `'tssc_multi_select'` to call `'select_option'` with the same label/option (engine handoff will run).

- [ ] **Step 3: Prompt rewrite**

Minimal `agent-tools-form.md` addition near `select_option`:

```markdown
- **TsscMultiSelect**（扫描 kind=`tssc-multi-select`，如「要素名称」「客户名称」）：仍只调 **`select_option(label_text, option_text, xpath_smart)`**。引擎自动走远程表行/字典子路径；`option_text="first"` 表示任意首项。失败且提示真实点击时，改 `click_element`/`real_click`，勿盲重试，勿 fill_form_field。
```

Remove “须用 tssc_multi_select” from form.md line 114.

- [ ] **Step 4: Run cold pin — expect ALL GREEN**

```bash
D:\anaconda3\python.exe scripts/characterization/cold/characterize-tssc-multi-select.py
```

- [ ] **Step 5: Commit**

```bash
git add scripts/controller/actions/_form.py scripts/controller/actions/autofill_round.py \
  scripts/prompts/agent-tools-form.md scripts/prompts/agent-tools-tssc-multi-select.md \
  scripts/prompts/agent-prompt.md scripts/agent_utils.py \
  scripts/characterization/cold/characterize-tssc-multi-select.py
git commit -m "refactor(agent): tssc fill only via select_option handoff (D6)"
```

---

### Task 5: Gate verify-all + agent-log close

**Files:**
- Modify: `docs/superpowers/agent-log.md` (收工)
- Possibly: `scripts/refactor/verify-all.sh` (only if new pin file added; existing line OK)

- [ ] **Step 1: Run verify subset then full gate**

```bash
D:\anaconda3\python.exe scripts/characterization/cold/characterize-tssc-multi-select.py
D:\anaconda3\python.exe scripts/characterization/characterize-select-option-stamp.py
bash scripts/refactor/verify-all.sh
```

Expected: ALL GREEN (or document any unrelated known flakes).

- [ ] **Step 2: Agent-log 收工** — list commits, pin evidence, note **restart executor** for wet record.

- [ ] **Step 3: Commit log**

```bash
git add docs/superpowers/agent-log.md
git commit -m "docs(agent-log): close tssc v2 implementation"
```

---

## Spec coverage self-check

| Spec item | Task |
|---|---|
| Table P0/P1/P2 + `ok-p1`/`ok-p2`/`err-no-options` | T2 |
| Skip P1 when first/empty | T2 |
| Exact switch OFF when present | T2 |
| Dict path unchanged | T2 |
| D6 select_option only / no agent register | T1, T4 |
| Record `select_option` + `target_kind=form_tssc_multi_select` | T3 |
| Prompt / fill next_action | T3, T4 |
| Stamp concrete option | T3 |
| Pins + verify-all | T1, T5 |
| Readonly opener (客户名称) | T2 |
| Historical replay alias keep | T4 (explicit keep) |

## Placeholder scan

No TBD / “similar to Task N” without code. Autofill exact line numbers left as “kind branch” (file has clear markers `tssc-multi-select`).

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-09-09-tssc-multi-select-v2.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session, executing-plans style with checkpoints  

Which approach?
