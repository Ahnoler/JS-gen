# Phase Reviewer + Explicit Form Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop AI recording overreach by (1) fixing open-page classification, (2) replacing implicit full-form autofill with explicit `run_form_assistant`, (3) adding a per-phase LLM Phase Reviewer that writes a single authoritative contract, and (4) injecting a short all-phase catalog into the Agent.

**Architecture:** Control plane sends `all_phases` on each recording step. Python `session_runner` runs Phase Reviewer LLM (or rules fallback), then `apply_phase_contract` atomically writes `_task_mode` / `_force_refill_all` / `_phase_boundary` / `_phase_intent`. Form single-field actions no longer call autofill via `_ensure_scanned`; batch fill is a new gated action. Preamble becomes short catalog + one-line prior outcome + contract + current task.

**Tech Stack:** Node control plane (`trajectory-record-lifecycle.js`), Python agent (`session_runner`, `scripts/actions/*`, langchain ChatOpenAI), characterization scripts under `scripts/characterization/`.

**Spec:** `docs/superpowers/specs/2026-08-06-phase-reviewer-form-assistant-design.md`

## Global Constraints

- Do not hard-block navigate overreach clicks this round (TODO-B2).
- Do not require `run_form_assistant` before save (TODO-B1).
- Do not inject full phase bodies into the execution Agent (TODO-B3); short catalog only.
- LLM success → sole authority; rules only on fail/timeout/invalid JSON / flag off.
- Any change under `src/services/` must update `CHANGELOG.md` `[Unreleased]` with Python sync hint.
- Prefer extending existing characterization scripts; keep changes focused.

## File map

| File | Responsibility |
|------|----------------|
| `scripts/feature_flags.py` | `AI_PHASE_REVIEWER` (default on) + timeout helper |
| `scripts/actions/_phase_context.py` | open-page-before-modify classify; preamble short catalog + one-line prior; `needs_business_data_context` uses contract |
| `scripts/actions/_phase_boundary.py` | open-page branch before form_modify; accept applied contract |
| `scripts/actions/_phase_intent.py` | `apply_phase_contract` atomic writer; richer `contract_summary_hint` |
| `scripts/actions/_phase_reviewer.py` | **New** — LLM review + JSON normalize |
| `scripts/prompts/phase-reviewer-prompt.md` | **New** — reviewer system prompt |
| `scripts/session_runner.py` | Call reviewer; pass `all_phases`; assemble preamble |
| `scripts/actions/_form.py` | Kill implicit autofill; add `run_form_assistant` |
| `scripts/prompts/agent-prompt.md` | Explicit assistant + contract obedience |
| `scripts/prompts/planner-prompt.md` | Respect contract / no later-phase advice |
| `src/services/trajectory-record-lifecycle.js` | Emit `all_phases` + slim `prior_outcome` |
| `CHANGELOG.md` | Control-plane instruction payload |
| `scripts/characterization/characterize-phase-*.py` | New assertions |

---

### Task 1: Open-page classification fix (rules fallback)

**Files:**
- Modify: `scripts/actions/_phase_context.py`
- Modify: `scripts/actions/_phase_boundary.py`
- Modify: `scripts/characterization/characterize-case-data.py`
- Modify: `scripts/characterization/characterize-phase-boundary.py`
- Test: same characterization scripts

**Interfaces:**
- Produces: `classify_task_mode` returns `other` for pure open-page texts even if「修改」appears only in later-phase pollution is N/A — for texts matching `is_open_page_task` and not save-to-open, classify as `other` **before** `is_modify_task`. `compile_boundary` must set `role=navigate` for those texts.

- [ ] **Step 1: Write failing characterization cases**

In `scripts/characterization/characterize-case-data.py` inside `test_three_task_modes` (or new function called from main), add:

```python
nav = '进入对公客户管理页面。预期结果：打开对公客户管理列表页面。'
assert_true(classify_task_mode(nav) == 'other', 'open-page → other not form_modify')
assert_true(is_open_page_task(nav) is True, 'open-page detect')
# polluted: navigation goal must win over incidental 修改 in non-goal wording only when is_open_page_task
# keep existing modify cases unchanged
assert_true(classify_task_mode('修改客户状态为潜在') == 'form_modify', 'partial modify still')
```

In `characterize-phase-boundary.py`, after imports of `compile_boundary`:

```python
b = compile_boundary('进入对公客户管理页面。预期结果：打开对公客户管理列表页面。')
assert_true(b.get('role') == 'navigate', 'boundary navigate for open-page')
assert_true(b.get('requires_write_all_editable') is False, 'no write-all on navigate')
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
python scripts/characterization/characterize-case-data.py
python scripts/characterization/characterize-phase-boundary.py
```

Expected: open-page assertions fail (currently may classify as `form_modify` if「管理」path differs — if「进入对公客户管理」does not match `_MODIFY_TASK_RE`, use a stronger fixture that currently fails, e.g. text that includes both open-page expect AND「修改」in the **expected result of a different sentence** only if product text does; otherwise add fixture:

```python
nav2 = '点击菜单进入客户管理。预期结果：打开客户管理页面。'  # ensure is_open_page_task True
# And separately document: classify must check is_open_page_task before is_modify_task
```

If current `进入对公客户管理` already returns `other`, still change order so any `is_open_page_task` True text cannot become `form_modify`. Add fixture that **today fails**:

```python
# 「维护」triggers modify today; open-page expect must win
nav_maintain = '进入客户信息维护列表。预期结果：打开客户信息维护列表页面。'
assert_true(is_open_page_task(nav_maintain), 'open-page with 维护 in title')
assert_true(classify_task_mode(nav_maintain) == 'other', 'open-page wins over 维护 keyword')
```

- [ ] **Step 3: Implement classify order**

In `classify_task_mode` (`_phase_context.py`), after login/query checks, **before** `is_modify_task`:

```python
if is_open_page_task(t) or is_wizard_nav_task(t):
    return 'other'
```

Import `is_wizard_nav_task` if not already available in this module (it lives here already).

In `compile_boundary` (`_phase_boundary.py`), move the `is_open_page_task` / wizard navigate branches **above** `task_mode in ('form_fill', 'form_modify')` so open-page never becomes `role=maintain`.

- [ ] **Step 4: Re-run characterizations — expect PASS**

```bash
python scripts/characterization/characterize-case-data.py
python scripts/characterization/characterize-phase-boundary.py
```

- [ ] **Step 5: Commit**

```bash
git add scripts/actions/_phase_context.py scripts/actions/_phase_boundary.py scripts/characterization/characterize-case-data.py scripts/characterization/characterize-phase-boundary.py
git commit -m "$(cat <<'EOF'
fix: prefer open-page navigate over modify/fill classification

EOF
)"
```

---

### Task 2: Atomic `apply_phase_contract` writer

**Files:**
- Modify: `scripts/actions/_phase_intent.py`
- Modify: `scripts/characterization/characterize-phase-intent.py`
- Test: `scripts/characterization/characterize-phase-intent.py`

**Interfaces:**
- Produces:
  - `MODE_TO_TASK_MODE: dict`
  - `apply_phase_contract(case_data_store, contract: dict) -> dict` — clears prior intent/boundary flags as today, writes all four stores, returns normalized contract
  - `contract_allows_form_assistant(case_data_store) -> bool`
  - Extended `contract_summary_hint` including `allow_form_assistant`, `goal`, `out_of_scope`, `done_when`, `source`

- [ ] **Step 1: Failing test for atomic apply**

```python
from scripts.actions._phase_intent import apply_phase_contract, contract_allows_form_assistant

store = {}
c = {
    'mode': 'navigate',
    'allow_form_assistant': False,
    'refill': 'none',
    'goal': '进入列表页',
    'in_scope': ['打开菜单', '确认列表可见'],
    'out_of_scope': ['点击修改', '填写表单', '保存'],
    'done_when': '列表页已打开',
    'submit': {'required': False, 'via': 'any', 'button_text': ''},
    'success': {'kinds': [], 'evidence': []},
    'source': 'llm',
}
apply_phase_contract(store, c)
assert_true(store.get('_task_mode') == 'other', 'task_mode other')
assert_true(store.get('_force_refill_all') is False, 'no force refill')
assert_true(store.get('_phase_intent', {}).get('mode') == 'navigate', 'intent mode')
assert_true(store.get('_phase_boundary', {}).get('role') == 'navigate', 'boundary role')
assert_true(contract_allows_form_assistant(store) is False, 'assistant denied')
```

- [ ] **Step 2: Run — expect FAIL (import/function missing)**

```bash
python scripts/characterization/characterize-phase-intent.py
```

- [ ] **Step 3: Implement `apply_phase_contract`**

Add to `_phase_intent.py` (keep `apply_phase_intent` as thin rules-only wrapper used by fallback):

```python
_MODE_TO_TASK = {
    'create': 'form_fill',
    'modify': 'form_modify',
    'query': 'query',
    'login': 'login',
    'navigate': 'other',
    'introduce_pick': 'other',
    'other': 'other',
}
_MODE_TO_ROLE = {
    'create': 'maintain',
    'modify': 'maintain',
    'query': 'query',
    'navigate': 'navigate',
    'introduce_pick': 'introduce',
    'login': 'other',
    'other': 'other',
}

def contract_allows_form_assistant(case_data_store: dict | None) -> bool:
    c = get_phase_intent(case_data_store)
    if not c:
        return False
    if 'allow_form_assistant' in c:
        return bool(c.get('allow_form_assistant'))
    return c.get('refill') == 'all_editable' and c.get('mode') in ('create', 'modify')


def apply_phase_contract(case_data_store: dict | None, contract: dict[str, Any]) -> dict[str, Any]:
    """Authoritative write of task_mode + force_refill + boundary + intent."""
    clear_phase_intent(case_data_store)  # also clears boundary via existing clear
    if case_data_store is None:
        return contract
    c = dict(contract)
    mode = c.get('mode') or 'other'
    refill = c.get('refill') or 'none'
    if 'allow_form_assistant' not in c:
        c['allow_form_assistant'] = (
            refill == 'all_editable' and mode in ('create', 'modify')
        )
    role = _MODE_TO_ROLE.get(mode, 'other')
    requires_write = refill == 'all_editable'
    boundary = {
        'role': role,
        'requires_write_all_editable': requires_write,
        'goals': list(c.get('in_scope') or []),
        'success_when': list((c.get('success') or {}).get('kinds') or []),
        'task_mode': _MODE_TO_TASK.get(mode, 'other'),
        'source': c.get('source') or 'llm',
        # preserve keys compile_boundary callers expect with safe defaults:
        'forbid_index_submit': mode in ('create', 'modify'),
        'picker_allowed': mode in ('create', 'modify', 'introduce_pick'),
    }
    case_data_store['_phase_boundary'] = boundary
    case_data_store['_phase_boundary_flag_locked'] = True
    case_data_store['_phase_intent'] = c
    case_data_store['_phase_intent_flag_locked'] = True
    case_data_store['_task_mode'] = _MODE_TO_TASK.get(mode, 'other')
    case_data_store['_query_task'] = mode == 'query'
    case_data_store['_force_refill_all'] = requires_write
    return c
```

Extend `contract_summary_hint` to append `allow_form_assistant`, `goal`, bullet `out_of_scope`, `done_when`, `source`.

Refactor `apply_phase_intent` to: compile via existing rules → set `source=rules_fallback` + default `allow_form_assistant` → `return apply_phase_contract(store, contract)` (so one write path). When boundary flag path was used, convert via `boundary_to_legacy_intent` then merge `allow_form_assistant` / `source` then `apply_phase_contract`.

- [ ] **Step 4: Run characterizations PASS**

```bash
python scripts/characterization/characterize-phase-intent.py
python scripts/characterization/characterize-phase-boundary.py
```

- [ ] **Step 5: Commit**

```bash
git add scripts/actions/_phase_intent.py scripts/characterization/characterize-phase-intent.py
git commit -m "$(cat <<'EOF'
feat: apply_phase_contract atomically aligns task_mode boundary intent

EOF
)"
```

---

### Task 3: Phase Reviewer LLM module + prompt

**Files:**
- Create: `scripts/prompts/phase-reviewer-prompt.md`
- Create: `scripts/actions/_phase_reviewer.py`
- Create: `scripts/characterization/characterize-phase-reviewer.py`
- Modify: `scripts/feature_flags.py`

**Interfaces:**
- Produces:
  - `phase_reviewer_enabled() -> bool` (env `AI_PHASE_REVIEWER`, default True)
  - `phase_reviewer_timeout_s() -> float` (env `AI_PHASE_REVIEWER_TIMEOUT_S`, default `20`)
  - `async def review_phase_contract(*, task_text, all_phases, current_phase_number, scenario_summary, llm) -> dict | None`
  - Returns normalized contract dict or `None` on failure

- [ ] **Step 1: Feature flag helpers**

Append to `scripts/feature_flags.py`:

```python
def phase_reviewer_enabled() -> bool:
    """AI_PHASE_REVIEWER — per-phase LLM contract (default on)."""
    return _env_flag('AI_PHASE_REVIEWER', True)


def phase_reviewer_timeout_s() -> float:
    raw = os.environ.get('AI_PHASE_REVIEWER_TIMEOUT_S')
    if raw is None or str(raw).strip() == '':
        return 20.0
    try:
        return max(1.0, float(str(raw).strip()))
    except (TypeError, ValueError):
        return 20.0
```

- [ ] **Step 2: Write `phase-reviewer-prompt.md`**

Create `scripts/prompts/phase-reviewer-prompt.md` with instructions:

- Role: phase reviewer/planner for Element UI recording
- Inputs will include full phase list + current phase + optional scenario
- Output **only** JSON with keys: mode, allow_form_assistant, refill, goal, in_scope, out_of_scope, done_when, submit, success
- Rules: 「进入/打开…页面」→ mode=navigate, allow_form_assistant=false, refill=none; put later-phase work in out_of_scope; create/full-modify → allow_form_assistant=true, refill=all_editable; partial modify → allow_form_assistant=false, refill=none or touched

- [ ] **Step 3: Characterization for JSON normalize (no live LLM)**

`scripts/characterization/characterize-phase-reviewer.py`:

```python
from scripts.actions._phase_reviewer import normalize_reviewer_payload

raw = '''```json
{"mode":"navigate","allow_form_assistant":false,"refill":"none",
 "goal":"打开列表","in_scope":["进菜单"],"out_of_scope":["点修改"],
 "done_when":"列表可见","submit":{"required":false,"via":"any","button_text":""},
 "success":{"kinds":[],"evidence":[]}}
```'''
c = normalize_reviewer_payload(raw)
assert c and c['mode'] == 'navigate' and c['allow_form_assistant'] is False
assert normalize_reviewer_payload('not json') is None
assert normalize_reviewer_payload('{"mode":"nope"}') is None  # invalid mode
```

- [ ] **Step 4: Implement `_phase_reviewer.py`**

```python
"""LLM Phase Reviewer — compile execution contract before each AI recording phase."""
from __future__ import annotations
import asyncio, json, re, sys
from pathlib import Path
from typing import Any

_VALID_MODES = frozenset({
    'navigate', 'create', 'modify', 'query', 'introduce_pick', 'login', 'other',
})
_VALID_REFILL = frozenset({'none', 'touched', 'all_editable'})

def _load_prompt() -> str:
    p = Path(__file__).resolve().parents[1] / 'prompts' / 'phase-reviewer-prompt.md'
    return p.read_text(encoding='utf-8')

def normalize_reviewer_payload(raw: str) -> dict[str, Any] | None:
    t = (raw or '').strip()
    if t.startswith('```'):
        t = t.split('\n', 1)[-1].rsplit('```', 1)[0].strip()
    try:
        data = json.loads(t)
    except Exception:
        m = re.search(r'\{.*\}', t, re.S)
        if not m:
            return None
        try:
            data = json.loads(m.group(0))
        except Exception:
            return None
    if not isinstance(data, dict):
        return None
    mode = data.get('mode')
    refill = data.get('refill') or 'none'
    if mode not in _VALID_MODES or refill not in _VALID_REFILL:
        return None
    out = {
        'mode': mode,
        'allow_form_assistant': bool(data.get('allow_form_assistant')),
        'refill': refill,
        'goal': str(data.get('goal') or '')[:300],
        'in_scope': [str(x) for x in (data.get('in_scope') or [])][:12],
        'out_of_scope': [str(x) for x in (data.get('out_of_scope') or [])][:12],
        'done_when': str(data.get('done_when') or '')[:300],
        'submit': data.get('submit') if isinstance(data.get('submit'), dict) else {
            'required': False, 'via': 'any', 'button_text': '',
        },
        'success': data.get('success') if isinstance(data.get('success'), dict) else {
            'kinds': [], 'evidence': [],
        },
        'source': 'llm',
    }
    return out

def _build_user_payload(...):
    # format all_phases as numbered full descriptions; mark current
    ...

async def review_phase_contract(*, task_text, all_phases, current_phase_number, scenario_summary='', llm=None) -> dict | None:
    from scripts.feature_flags import phase_reviewer_enabled, phase_reviewer_timeout_s
    if not phase_reviewer_enabled() or llm is None:
        return None
    from langchain_core.messages import SystemMessage, HumanMessage
    timeout = phase_reviewer_timeout_s()
    try:
        coro = llm.ainvoke([
            SystemMessage(content=_load_prompt()),
            HumanMessage(content=_build_user_payload(...)),
        ])
        response = await asyncio.wait_for(coro, timeout=timeout)
        raw = response.content if hasattr(response, 'content') else str(response)
        if isinstance(raw, list):
            raw = '\n'.join(str(x) for x in raw)
        return normalize_reviewer_payload(str(raw))
    except Exception as e:
        sys.stderr.write(f'[phase_reviewer] failed: {e}\n')
        sys.stderr.flush()
        return None
```

- [ ] **Step 5: Run normalize characterization**

```bash
python scripts/characterization/characterize-phase-reviewer.py
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/feature_flags.py scripts/prompts/phase-reviewer-prompt.md scripts/actions/_phase_reviewer.py scripts/characterization/characterize-phase-reviewer.py
git commit -m "$(cat <<'EOF'
feat: add LLM phase reviewer module and prompt

EOF
)"
```

---

### Task 4: Wire reviewer into `session_runner` + business-data gate

**Files:**
- Modify: `scripts/session_runner.py` (phase start block ~420–520)
- Modify: `scripts/actions/_phase_context.py` — `needs_business_data_context`

**Interfaces:**
- Consumes: `review_phase_contract`, `apply_phase_contract`, `apply_phase_intent` (fallback)
- Instruction keys: `all_phases` / `allPhases`, `prior_outcome` / `priorOutcome`

- [ ] **Step 1: Fix `needs_business_data_context` to prefer contract**

At top of function, after empty check:

```python
if case_data_store:
    contract = case_data_store.get('_phase_intent') or {}
    mode = contract.get('mode')
    if mode in ('navigate', 'login', 'query'):
        return False
    if mode in ('create', 'modify', 'introduce_pick'):
        return True
    boundary = case_data_store.get('_phase_boundary') or {}
    if boundary.get('role') == 'navigate':
        return False
    if boundary.get('role') in ('maintain', 'introduce'):
        return True
# then existing classify-based logic as last resort
```

- [ ] **Step 2: Replace phase-start apply sequence in `session_runner.py`**

Where today:

```python
mode = apply_task_mode(case_data_ref, phase_core)
contract = apply_phase_intent(case_data_ref, phase_core)
```

Replace with (heal_mode branch unchanged):

```python
from .actions._phase_reviewer import review_phase_contract
from .actions._phase_intent import apply_phase_contract, apply_phase_intent

all_phases = instruction.get('all_phases') or instruction.get('allPhases') or []
reviewed = None
if llm is available in this scope:  # use the session llm already created for the agent; if not yet, pass None and fallback
    reviewed = await review_phase_contract(
        task_text=phase_core,
        all_phases=all_phases if isinstance(all_phases, list) else [],
        current_phase_number=phase_for_preamble,
        scenario_summary='',
        llm=llm,  # may need to reorder: ensure llm exists before phase task build, or call reviewer inside async phase runner where llm exists
    )
if reviewed:
    contract = apply_phase_contract(case_data_ref, reviewed)
    mode = case_data_ref.get('_task_mode') or 'other'
else:
    # rules fallback still goes through apply_phase_intent → apply_phase_contract
    mode = apply_task_mode(case_data_ref, phase_core)  # temporary flags; overwritten by apply
    contract = apply_phase_intent(case_data_ref, phase_core)
    mode = case_data_ref.get('_task_mode') or mode
```

**Important:** If `agent_task` assembly currently runs before `llm` is constructed, move reviewer call to the async function that already has `llm` (same place Agent is created / phase executed). Read `session_runner.py` for the nearest async site that has both `instruction` and `llm`; wire there and keep sync classify only as fallback inside that site.

- [ ] **Step 3: Extend `phase_intent_obs` payload**

Include `source=contract.get('source')`, `allow_form_assistant=contract.get('allow_form_assistant')`.

- [ ] **Step 4: Manual/logic sanity**

```bash
python -c "from scripts.actions._phase_reviewer import normalize_reviewer_payload; print('ok')"
python scripts/characterization/characterize-phase-intent.py
python scripts/characterization/characterize-case-data.py
```

- [ ] **Step 5: Commit**

```bash
git add scripts/session_runner.py scripts/actions/_phase_context.py
git commit -m "$(cat <<'EOF'
feat: wire phase reviewer into session start with rules fallback

EOF
)"
```

---

### Task 5: Remove implicit autofill; add `run_form_assistant`

**Files:**
- Modify: `scripts/actions/_form.py`
- Modify: `scripts/characterization/characterize-case-data.py` (update `_skip_auto_fill` expectations if tests assume implicit path)
- Test: new asserts in characterize-phase-intent or new `characterize-form-assistant.py`

**Interfaces:**
- Produces: `@controller.action` `run_form_assistant()` 
- Changes: `_ensure_scanned` becomes scan-only helper used by assistant OR split into `_scan_form_into_task_list` without `_auto_fill_pending`; single-field actions stop awaiting autofill path

- [ ] **Step 1: Failing test — assistant gate**

```python
from scripts.actions._phase_intent import apply_phase_contract, contract_allows_form_assistant
store = {}
apply_phase_contract(store, {
    'mode': 'navigate', 'allow_form_assistant': False, 'refill': 'none',
    'goal': 'x', 'in_scope': [], 'out_of_scope': [], 'done_when': '',
    'submit': {}, 'success': {}, 'source': 'llm',
})
assert_true(contract_allows_form_assistant(store) is False, 'nav denies assistant')
```

(Full action test is integration; gate helper is enough for unit.)

- [ ] **Step 2: Refactor `_ensure_scanned`**

1. Rename autofill body conceptually: extract `_scan_and_maybe_autofill(label_text, *, do_autofill: bool)`.
2. At all single-field call sites (`fill_form_field`, `fill_date_field`, `select_option`, `click_radio`, `select_tree_option` — every `await _ensure_scanned`), pass `do_autofill=False` **or** replace with a light `_touch_container_only` that updates container id / query UI detection **without** calling `_auto_fill_pending`.
3. Keep scan+autofill path only inside new `run_form_assistant`.

Minimal approach matching spec:

```python
async def _ensure_scanned(label_text: str, *, allow_autofill: bool = False):
    ...
    if not allow_autofill:
        # still allow container switch + query detect; do NOT auto-fill
        # optional: skip creating task_list entirely for single-field
        return
    ... existing autofill ...
```

Call sites for single-field: `allow_autofill=False` (default).

- [ ] **Step 3: Add `run_form_assistant` action**

Near other form actions in `_register_form_actions`:

```python
@controller.action(
    'Batch-scan and auto-fill editable form fields in the current container. '
    'Call only when the phase contract allows form assistant (create / full modify). '
    'Do not use on navigate/query phases.'
)
async def run_form_assistant():
    from ._phase_intent import contract_allows_form_assistant
    if not contract_allows_form_assistant(case_data_store):
        return 'err-form-assistant-forbidden: phase contract allow_form_assistant=false'
    # Reuse prior autofill implementation with a synthetic label trigger:
    await _ensure_scanned('__run_form_assistant__', allow_autofill=True)
    summary = case_data_store.get('_autofill_summary') or 'auto-fill-complete'
    return _ok(summary)
```

Ensure `_ensure_scanned` treats unknown label as “force scan” when `allow_autofill=True` (existing logic already rescans when label not in pending/done).

- [ ] **Step 4: Update characterization that expected implicit autofill on first fill**

Search `characterize-case-data.py` / docs in prompts later. Any test asserting `_skip_auto_fill` False means “will autofill on first fill” — update comments; behavior of `_skip_auto_fill` can remain for assistant internal use.

Run:

```bash
python scripts/characterization/characterize-case-data.py
python scripts/characterization/characterize-phase-intent.py
python scripts/characterization/characterize-form-rules.py
```

- [ ] **Step 5: Commit**

```bash
git add scripts/actions/_form.py scripts/characterization/
git commit -m "$(cat <<'EOF'
feat: explicit run_form_assistant; stop implicit full-form autofill

EOF
)"
```

---

### Task 6: Preamble — short catalog + one-line prior

**Files:**
- Modify: `scripts/actions/_phase_context.py` — `format_phase_preamble`
- Modify: `scripts/session_runner.py` — pass `all_phases`, `prior_outcome`
- Test: small asserts in characterize-case-data or new preamble tests

**Interfaces:**
- Produces: `format_phase_preamble(..., all_phases=None, prior_outcome=None)` 
- Short catalog block `【阶段目录】` with `N. title`
- Prior block only previous phase one-line result (no prior description dump)

- [ ] **Step 1: Implement preamble helpers**

```python
def format_phase_catalog(all_phases: list | None, current_phase: int) -> str:
    if not all_phases:
        return ''
    lines = ['【阶段目录】']
    for p in all_phases:
        if not isinstance(p, dict):
            continue
        n = p.get('phaseNumber') if p.get('phaseNumber') is not None else p.get('phase_number')
        title = (p.get('title') or p.get('name') or '').strip()
        if not title:
            desc = (p.get('description') or '').strip().split('\n', 1)[0]
            title = truncate_text(desc, 40)
        mark = ' ←当前' if n is not None and int(n) == int(current_phase) else ''
        lines.append(f'{n}. {title}{mark}')
    return '\n'.join(lines) if len(lines) > 1 else ''


def format_prior_outcome_line(prior_outcome: dict | None) -> str:
    if not isinstance(prior_outcome, dict):
        return ''
    pn = prior_outcome.get('phaseNumber') or prior_outcome.get('phase_number') or ''
    ok = prior_outcome.get('success')
    label = '成功' if ok else ('失败' if ok is False else '未知')
    text = truncate_text(str(prior_outcome.get('text') or ''), 120)
    if text:
        return f'【上一阶段结果】阶段{pn}：{label} — {text}'
    return f'【上一阶段结果】阶段{pn}：{label}'
```

Change `format_phase_preamble` to:

1. catalog (if any)
2. prior one-liner (if any) — **do not** dump prior descriptions
3. `【当前任务】` + task
4. caller still appends contract hint / refill hint

Deprecate use of multi-prior full description path when `all_phases` present; if only legacy `prior_phases` without catalog, fall back to one-line from last prior’s outcome field only (strip description lines).

- [ ] **Step 2: session_runner passes new fields**

```python
agent_task = format_phase_preamble(
    current_phase=...,
    current_task=agent_task,
    prior_phases=None,  # or keep for outcome extraction only
    prior_outcome=instruction.get('prior_outcome') or instruction.get('priorOutcome'),
    all_phases=all_phases,
    case_data_store=case_data_ref,
)
```

- [ ] **Step 3: Quick unit via characterization**

```python
from scripts.actions._phase_context import format_phase_catalog, format_phase_preamble
cat = format_phase_catalog([
    {'phaseNumber': 1, 'title': '登录'},
    {'phaseNumber': 2, 'title': '进入对公客户管理'},
], 2)
assert_true('2. 进入对公客户管理 ←当前' in cat, 'catalog marks current')
```

- [ ] **Step 4: Commit**

```bash
git add scripts/actions/_phase_context.py scripts/session_runner.py scripts/characterization/
git commit -m "$(cat <<'EOF'
feat: agent preamble uses all-phase short catalog and one-line prior

EOF
)"
```

---

### Task 7: Control plane `all_phases` + CHANGELOG

**Files:**
- Modify: `src/services/trajectory-record-lifecycle.js`
- Modify: `CHANGELOG.md`
- Optional: `src/dashboard/api-docs/catalog.js` note if session instruction is documented

**Interfaces:**
- Produces on each step: `all_phases: [{ id, phaseNumber, title, description }]`, `prior_outcome: { phaseNumber, success, text } | undefined`

- [ ] **Step 1: Build `all_phases` once per recording loop**

Before the `for (let i = 0; i < phases.length; i++)` body uses it:

```javascript
const all_phases = phases.map((p) => ({
  id: p.id,
  phaseNumber: p.phaseNumber,
  title: (p.title || p.name || '').trim() || String(p.description || '').split('\n')[0].slice(0, 80),
  description: p.description || '',
}));
```

Inside loop, replace prior_phases full dump:

```javascript
stepData.all_phases = all_phases;
if (i > 0) {
  const prev = phases[i - 1];
  // Prefer last known phase outcome from runtime if available; else minimal placeholder
  const prevOutcome = runtime.phaseOutcomes?.[prev.id] || runtime.phaseOutcomes?.[prev.phaseNumber];
  stepData.prior_outcome = {
    phaseNumber: prev.phaseNumber,
    success: prevOutcome?.success ?? true,
    text: prevOutcome?.text || prevOutcome?.summary || '见页面当前状态',
  };
}
// Keep prior_phases omitted OR leave empty for back-compat — prefer omit to avoid double injection
```

If `runtime.phaseOutcomes` does not exist, add a small map updated when `phase_done` is observed in this same function (search existing phase_done handling nearby and record `{ success, text }`).

- [ ] **Step 2: CHANGELOG `[Unreleased]` Added/Changed**

```markdown
### Changed
- 2026-08-06: AI 录制 step instruction 增加 **`all_phases`**（当前录制集全量阶段 id/序号/标题/描述）与 **`prior_outcome`**（上一阶段一句结果）；不再依赖 prior 0–2 段全文注入执行 Agent。
  影响范围：录制生命周期 → Python session instruction。
  文件：src/services/trajectory-record-lifecycle.js
  Python 同步提示：session step 消费 `all_phases` / `prior_outcome`；执行 Agent 用短目录，评审器用全文 description。
```

- [ ] **Step 3: Commit**

```bash
git add src/services/trajectory-record-lifecycle.js CHANGELOG.md
git commit -m "$(cat <<'EOF'
feat: ship all_phases and prior_outcome on recording steps

EOF
)"
```

---

### Task 8: Prompt redesign (agent + planner)

**Files:**
- Modify: `scripts/prompts/agent-prompt.md`
- Modify: `scripts/prompts/planner-prompt.md`

- [ ] **Step 1: Edit agent-prompt form-assistant section**

Replace the block titled `# 🚨 表单填写助手（CRITICAL — 信任协作）` and any table rows saying「第一次 fill/select 触发」with:

- Batch fill **only** via `run_form_assistant`, and only when 【阶段意图合约】`allow_form_assistant=true`
- Single-field `fill_*` / `select_*` never trigger full-form scan
- Navigate / query: never call `run_form_assistant`; do not open 修改/维护 for later phases listed in `out_of_scope`
- Obey 【阶段目录】: only execute the current phase; later phases are out of scope
- Remove statements that `fill_form_fields_batch` was removed in favor of implicit trigger; document `run_form_assistant` instead

Also fix the task-type table (~line 75) accordingly.

- [ ] **Step 2: Planner prompt light patch**

Add under Additional Evaluation Rules:

```
8. Respect the phase contract in the task text (mode / out_of_scope / done_when). Never advise actions listed in out_of_scope or work that belongs to a later phase in 【阶段目录】.
9. Form batch fill only via run_form_assistant when allow_form_assistant=true; do not assume first fill/select autofills the form.
```

- [ ] **Step 3: Commit**

```bash
git add scripts/prompts/agent-prompt.md scripts/prompts/planner-prompt.md
git commit -m "$(cat <<'EOF'
docs: rewrite agent/planner prompts for explicit form assistant and phase contract

EOF
)"
```

---

### Task 9: End-to-end characterization + verification

**Files:**
- Modify/create characterization as needed
- Run full relevant suite

- [ ] **Step 1: Add integration-style characterization script** `scripts/characterization/characterize-phase-reviewer-flow.py`

```python
"""Rules path: open-page → contract denies assistant; create → allows."""
from scripts.actions._phase_intent import apply_phase_intent, contract_allows_form_assistant

store = {}
c = apply_phase_intent(store, '进入对公客户管理页面。预期结果：打开对公客户管理列表页面。')
assert c and store.get('_phase_boundary', {}).get('role') == 'navigate'
assert contract_allows_form_assistant(store) is False

store2 = {}
c2 = apply_phase_intent(store2, '新增对公客户并保存')
assert contract_allows_form_assistant(store2) is True or store2.get('_force_refill_all') is True
```

- [ ] **Step 2: Run suite**

```bash
python scripts/characterization/characterize-case-data.py
python scripts/characterization/characterize-phase-intent.py
python scripts/characterization/characterize-phase-boundary.py
python scripts/characterization/characterize-phase-reviewer.py
python scripts/characterization/characterize-phase-reviewer-flow.py
python scripts/characterization/characterize-form-rules.py
node scripts/characterization/characterize-ctrl.mjs
```

Expected: all PASS (ctrl unchanged unless action registration breaks Agent schema — `run_form_assistant` is Python-only action, not CTRL).

- [ ] **Step 3: Final commit if any fixes**

```bash
git add scripts/characterization/
git commit -m "$(cat <<'EOF'
test: characterize phase reviewer flow and open-page assistant gate

EOF
)"
```

---

## Spec coverage checklist

| Spec section | Task |
|--------------|------|
| Open-page rules fix | Task 1 |
| Atomic contract authority | Task 2 |
| LLM reviewer + prompt + flag | Task 3 |
| session_runner wiring + biz-data gate | Task 4 |
| Explicit assistant / no implicit autofill | Task 5 |
| Short catalog + one-line prior | Task 6 |
| `all_phases` control plane + CHANGELOG | Task 7 |
| Agent/planner prompts | Task 8 |
| Success criteria / characterization | Task 9 |
| TODO-B1/B2/B3 | Explicitly out of plan (listed in spec only) |

## Placeholder / consistency self-review

- Action name locked: `run_form_assistant`
- Writer name locked: `apply_phase_contract`
- Flag locked: `AI_PHASE_REVIEWER` default on
- Instruction keys locked: `all_phases`, `prior_outcome`
)
