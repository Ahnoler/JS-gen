# Phase Reviewer Effort → max_steps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Phase Reviewer estimate phase length (`brief_plan` + effort bucket and/or `estimated_steps`) and lower `agent.run(max_steps)` under the control-plane ceiling.

**Architecture:** Extend existing reviewer JSON normalize; add pure `resolve_phase_max_steps(ceiling, contract)`; `session_runner` applies chosen max_steps after contract apply and logs ceiling/chosen. No second LLM call. Hard-gate soft-demotion is out of scope.

**Tech Stack:** Python agent (`_phase_reviewer.py`, `session_runner.py`, prompts), characterization scripts.

**Spec:** `docs/superpowers/specs/2026-08-06-phase-reviewer-max-steps-design.md`

## Global Constraints

- Control plane `max_steps` is **ceiling**; reviewer may only **lower**.
- Hybrid: required soft `brief_plan`; `effort` in `{short,medium,long}` **or** `estimated_steps`; if both, **integer wins**.
- Bucket map: `short→5`, `medium→15`, `long→30`.
- `FLOOR=3`, `BUFFER=1`; missing effort → keep ceiling.
- Missing `brief_plan` → backfill `[goal]` (or `["完成本阶段任务"]`); do **not** discard contract.
- Do **not** change recorder hard gates / overlay behavior.
- Scripts-only → no CHANGELOG required.

## File map

| File | Role |
|------|------|
| `scripts/actions/_phase_reviewer.py` | Normalize new fields; `resolve_phase_max_steps` |
| `scripts/prompts/phase-reviewer-prompt.md` | Document brief_plan + effort |
| `scripts/session_runner.py` | Use chosen max_steps; log; obs fields |
| `scripts/actions/_phase_intent.py` | `contract_summary_hint` appends 【阶段计划】 |
| `scripts/characterization/characterize-phase-reviewer.py` | Resolve + normalize tests |

---

### Task 1: `resolve_phase_max_steps` + normalize fields (TDD)

**Files:**
- Modify: `scripts/actions/_phase_reviewer.py`
- Modify: `scripts/characterization/characterize-phase-reviewer.py`

**Interfaces:**
- Produces: `resolve_phase_max_steps(ceiling: int, contract: dict | None) -> int`
- Extends: `normalize_reviewer_payload` → `brief_plan`, `effort`, `estimated_steps`

- [ ] **Step 1: Write failing tests** in `characterize-phase-reviewer.py`:

```python
from scripts.actions._phase_reviewer import resolve_phase_max_steps, normalize_reviewer_payload

assert resolve_phase_max_steps(30, {'effort': 'short'}) == 5
assert resolve_phase_max_steps(30, {'effort': 'medium'}) == 15
assert resolve_phase_max_steps(30, {'effort': 'long'}) == 30
assert resolve_phase_max_steps(10, {'effort': 'long'}) == 10
assert resolve_phase_max_steps(30, {'estimated_steps': 2}) == 3  # 2+1 floor
assert resolve_phase_max_steps(30, {'estimated_steps': 4}) == 5
assert resolve_phase_max_steps(30, {'estimated_steps': 4, 'effort': 'long'}) == 5  # int wins
assert resolve_phase_max_steps(30, {}) == 30
assert resolve_phase_max_steps(30, None) == 30

raw = (
    '{"mode":"navigate","allow_form_assistant":false,"refill":"none",'
    '"goal":"进列表","in_scope":[],"out_of_scope":[],"done_when":"列表可见",'
    '"submit":{"required":false,"via":"any","button_text":""},'
    '"success":{"kinds":[],"evidence":[]},"effort":"short",'
    '"brief_plan":["点客户管理","点对公客户管理","确认列表"]}'
)
c = normalize_reviewer_payload(raw)
assert c and c.get('effort') == 'short' and len(c.get('brief_plan') or []) == 3

# missing brief_plan → backfill from goal
c2 = normalize_reviewer_payload(
    '{"mode":"navigate","allow_form_assistant":false,"refill":"none",'
    '"goal":"打开新增抽屉","in_scope":[],"out_of_scope":[],"done_when":"抽屉可见",'
    '"submit":{"required":false,"via":"any","button_text":""},'
    '"success":{"kinds":[],"evidence":[]},"effort":"short"}'
)
assert c2 and c2['brief_plan'] == ['打开新增抽屉']
```

- [ ] **Step 2: Run — expect FAIL**

```bash
python scripts/characterization/characterize-phase-reviewer.py
```

- [ ] **Step 3: Implement**

In `_phase_reviewer.py`:

```python
_EFFORT_STEPS = {'short': 5, 'medium': 15, 'long': 30}
_MAX_STEPS_FLOOR = 3
_MAX_STEPS_BUFFER = 1

def resolve_phase_max_steps(ceiling: int, contract: dict | None) -> int:
    try:
        ceil = int(ceiling)
    except (TypeError, ValueError):
        ceil = 40
    if ceil < 1:
        ceil = 40
    if not isinstance(contract, dict):
        return ceil
    raw = None
    est = contract.get('estimated_steps')
    try:
        est_i = int(est)
    except (TypeError, ValueError):
        est_i = 0
    if est_i > 0:
        raw = est_i + _MAX_STEPS_BUFFER
    else:
        effort = str(contract.get('effort') or '').strip().lower()
        if effort in _EFFORT_STEPS:
            raw = _EFFORT_STEPS[effort]
    if raw is None:
        return ceil
    return min(ceil, max(_MAX_STEPS_FLOOR, int(raw)))
```

In `normalize_reviewer_payload`, after building `out` and before `sanitize_contract_for_mode`:

- Parse `brief_plan` as list of strings, max 4, strip empties; if empty after parse, set to `[out['goal']]` if goal else `['完成本阶段任务']`
- Parse `effort` if in `{short,medium,long}` else omit/None
- Parse `estimated_steps` as positive int else omit

Keep `sanitize_contract_for_mode` after these fields are set (sanitize should preserve plan/effort keys).

- [ ] **Step 4: Run tests — PASS**

```bash
python scripts/characterization/characterize-phase-reviewer.py
```

- [ ] **Step 5: Commit**

```bash
git add scripts/actions/_phase_reviewer.py scripts/characterization/characterize-phase-reviewer.py
git commit -m "feat: resolve phase max_steps from reviewer effort estimate"
```

---

### Task 2: Prompt + contract summary hint

**Files:**
- Modify: `scripts/prompts/phase-reviewer-prompt.md`
- Modify: `scripts/actions/_phase_intent.py` (`contract_summary_hint`)

- [ ] **Step 1: Update reviewer prompt**

Add to the keys table and rules:

- `brief_plan`: string[] 2–4，仅本阶段
- `effort`: short|medium|long 可选
- `estimated_steps`: 正整数可选；与 effort 同时给时运行时以整数为准
- Guidance: 打开页面/单次点击/单字段 → short；多字段/整表 → medium/long
- 禁止把后续阶段写进 brief_plan
- 说明运行时会 `min(控制面上限, 估算)`

- [ ] **Step 2: Extend `contract_summary_hint`**

After existing lines, if `contract.get('brief_plan')`:

```python
lines.append('- 【阶段计划】')
for i, step in enumerate(list(contract.get('brief_plan') or [])[:4], 1):
    text = str(step).strip()
    if text:
        lines.append(f'  {i}. {text[:80]}')
```

- [ ] **Step 3: Commit**

```bash
git add scripts/prompts/phase-reviewer-prompt.md scripts/actions/_phase_intent.py
git commit -m "docs: reviewer prompt and contract hint for brief_plan effort"
```

---

### Task 3: Wire `session_runner` max_steps + obs/log

**Files:**
- Modify: `scripts/session_runner.py`

**Interfaces:**
- Consumes: `resolve_phase_max_steps`, contract after apply
- `max_steps` local variable must be updated **before** `agent.run`

- [ ] **Step 1: After contract apply (both LLM ok and rules fallback paths), resolve chosen**

Near where `max_steps = instruction.get("max_steps", 40)` is read (~line 361), keep as ceiling source. After `contract` is finalized (reviewer ok or fallback) and **not** heal_mode:

```python
from .actions._phase_reviewer import resolve_phase_max_steps
ceiling = max_steps
try:
    ceiling = int(max_steps)
except (TypeError, ValueError):
    ceiling = 40
if contract and not heal_mode:
    max_steps = resolve_phase_max_steps(ceiling, contract)
else:
    max_steps = ceiling
sys.stderr.write(
    f"[session] max_steps ceiling={ceiling} chosen={max_steps} "
    f"effort={(contract or {}).get('effort')} "
    f"estimated_steps={(contract or {}).get('estimated_steps')} "
    f"plan_n={len((contract or {}).get('brief_plan') or [])}\n"
)
sys.stderr.flush()
```

Ensure this runs **after** contract is known and **before** `agent.run(max_steps=max_steps)`. If contract is applied deep inside a try block, set a variable `phase_contract` and resolve once after that block (including heal → no lower).

- [ ] **Step 2: Extend `phase_intent_obs` data** with:

```python
"brief_plan": (contract or {}).get("brief_plan"),
"effort": (contract or {}).get("effort"),
"estimated_steps": (contract or {}).get("estimated_steps"),
"max_steps_ceiling": ceiling,
"max_steps_chosen": max_steps,
```

(Only when those locals exist in scope.)

- [ ] **Step 3: Smoke**

```bash
python scripts/characterization/characterize-phase-reviewer.py
python scripts/characterization/characterize-phase-intent.py
python -c "from scripts.actions._phase_reviewer import resolve_phase_max_steps; print(resolve_phase_max_steps(30,{'effort':'short'}))"
```

- [ ] **Step 4: Commit**

```bash
git add scripts/session_runner.py
git commit -m "feat: apply reviewer effort to agent max_steps under ceiling"
```

---

### Task 4: Verification

- [ ] **Step 1: Run suite**

```bash
python scripts/characterization/characterize-phase-reviewer.py
python scripts/characterization/characterize-phase-intent.py
python scripts/characterization/characterize-phase-reviewer-flow.py
python scripts/characterization/characterize-case-data.py
```

- [ ] **Step 2: Manual check list (for human)**

- Navigate phase log shows `max_steps ceiling=30 chosen=5` when effort=short
- Login ceiling=10 + long → chosen=10
- Overlay hard-gate behavior unchanged (known issue; out of scope)

- [ ] **Step 3: Commit only if fixes needed**

---

## Spec coverage

| Spec item | Task |
|-----------|------|
| `resolve_phase_max_steps` algorithm | Task 1 |
| normalize brief_plan / effort / estimated_steps | Task 1 |
| Prompt | Task 2 |
| contract_summary_hint plan | Task 2 |
| session_runner chosen + log + obs | Task 3 |
| Hard gates untouched | All tasks |
| Characterization | Task 1 + 4 |
