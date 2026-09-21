# Contract-Sovereignty Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Reviewer/Executor/Planner authority unambiguous under contract sovereignty: hard gates + contract win; Planner is advisory-only; `done()` is accepted only via `validate_done`.

**Architecture:** Keep browser-use loop. Extend `scripts/controller/actions/phase/*` as the single authority API (`get_active_contract`, `validate_done`, `is_action_in_scope`, contract `version`). Wire `scripts/agent/service.py` done/recontract paths to that API. Demote planner prompt + runtime filter. Add cold characterization pins before behavior changes.

**Tech Stack:** Python 3.12 agent (`scripts/`), browser-use Agent, phase reviewer JSON contracts, characterization pins (`scripts/characterization/`), `scripts/refactor/verify-all.sh`.

**Spec:** [`docs/superpowers/specs/2026-09-11-contract-sovereignty-orchestration-design.md`](../specs/2026-09-11-contract-sovereignty-orchestration-design.md)

## Global Constraints

- Authority order: hard-gate evidence > contract JSON > Executor step > Planner advice.
- Stage mid-flight: do **not** mutate contract bytes unless explicit `recontract` (auto recontract **default off**).
- Rejected `done()` must **not** call Planner for a second opinion; inject structured reject into next Executor observation.
- Heal mode (`heal_mode` / `_heal_contract`): keep existing bypass; do not force product scope checks onto heal unless a test already requires it.
- Do not rewrite browser-use loop; do not change trajectory DB schema; do not touch KB recall.
- Disjoint from unrelated WIP (`classify.py`, other open plans). Commit only files this plan touches + agent-log.
- Follow AGENTS.md: open agent-log before edits; characterization before/after; no CHANGELOG.md.
- Prefer extending existing APIs (`has_contract_success`, `check_pending_write_gate`, `done_accept_reason`, `should_block_index_submit`) over parallel duplicate logic.

## File map

| File | Responsibility |
|---|---|
| `scripts/controller/actions/phase/intent_contract.py` | Contract shape, `version`, `get_active_contract`, history list |
| `scripts/controller/actions/phase/intent_gates.py` | `validate_done`, `is_action_in_scope`, reuse success/pending/index-submit gates |
| `scripts/controller/actions/phase/reviewer.py` | Ensure applied contracts get `version=1` (or bump on recontract) |
| `scripts/controller/actions/_phase_intent.py` | Re-export new public names |
| `scripts/agent/service.py` | Done path to `validate_done`; recontract rebuild; planner advisory filter hook |
| `scripts/agent_utils.py` | Planner prompt load; parse/filter `compatible_with_contract` |
| `scripts/prompts/planner-prompt.md` | Advisory-only language + required JSON field |
| `scripts/characterization/cold/characterize-contract-sovereignty.py` | Cold pins for authority APIs |
| `scripts/characterization/characterize-planner-advisory-filter.py` | Planner filter unit pin |
| `scripts/refactor/verify-all.sh` | Register new pins |

---

### Task 1: Contract version + `get_active_contract` (fail-first pin)

**Files:**
- Create: `scripts/characterization/cold/characterize-contract-sovereignty.py`
- Modify: `scripts/controller/actions/phase/intent_contract.py`
- Modify: `scripts/controller/actions/phase/reviewer.py` (normalize/apply path stamps version)
- Modify: `scripts/controller/actions/_phase_intent.py` (re-export)
- Test: cold pin above

**Interfaces:**
- Produces:
  - `get_active_contract(business_data: dict) -> dict | None`
  - Contract dict MUST include int `version` (>=1) when present via apply/normalize
  - `append_contract_history(business_data, contract) -> None` stores prior versions under `business_data['_contract_history']` (list)

- [ ] **Step 1: Write failing cold pin**

```python
#!/usr/bin/env python3
"""Cold pins: contract sovereignty authority APIs (Task 1 subset)."""
from __future__ import annotations
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from scripts.controller.actions._phase_intent import (
    apply_phase_contract,
    get_active_contract,
)

def main() -> int:
    bd: dict = {}
    c = {
        'mode': 'navigate',
        'allow_form_assistant': False,
        'refill': 'none',
        'goal': 'open list',
        'in_scope': ['open menu'],
        'out_of_scope': ['click edit'],
        'done_when': 'list visible',
        'submit': {'required': False, 'via': 'any', 'button_text': ''},
        'success': {'kinds': [], 'evidence': []},
    }
    apply_phase_contract(bd, c)
    active = get_active_contract(bd)
    assert active is not None, 'active contract missing'
    assert int(active.get('version', 0)) >= 1, 'version must be >= 1'
    assert get_active_contract({}) is None, 'empty bd -> None'
    print('characterize-contract-sovereignty Task1 OK')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
```

- [ ] **Step 2: Run pin (expect fail — `get_active_contract` missing)**

```bash
python scripts/characterization/cold/characterize-contract-sovereignty.py
```

Expected: `ImportError` or `AssertionError` on version.

- [ ] **Step 3: Implement minimal API**

In `intent_contract.py` (or adjacent module already owning apply):

```python
def get_active_contract(business_data: dict | None) -> dict | None:
    if not business_data:
        return None
    c = business_data.get('_phase_intent') or business_data.get('_phase_contract')
    return c if isinstance(c, dict) else None

def ensure_contract_version(contract: dict) -> dict:
    out = dict(contract)
    if int(out.get('version') or 0) < 1:
        out['version'] = 1
    return out

def append_contract_history(business_data: dict, contract: dict) -> None:
    hist = business_data.setdefault('_contract_history', [])
    if isinstance(hist, list):
        hist.append(dict(contract))
```

Stamp `ensure_contract_version` inside `apply_phase_contract` / reviewer normalize before store. Re-export from `_phase_intent.py`.

- [ ] **Step 4: Re-run pin → PASS**

- [ ] **Step 5: Commit**

```bash
git add scripts/characterization/cold/characterize-contract-sovereignty.py \
  scripts/controller/actions/phase/intent_contract.py \
  scripts/controller/actions/phase/reviewer.py \
  scripts/controller/actions/_phase_intent.py \
  docs/superpowers/agent-log.md
git commit -m "feat(phase): contract version + get_active_contract for sovereignty"
```

---

### Task 2: `validate_done` hard-gate stack

**Files:**
- Modify: `scripts/controller/actions/phase/intent_gates.py`
- Modify: `scripts/controller/actions/_phase_intent.py`
- Modify: `scripts/characterization/cold/characterize-contract-sovereignty.py` (extend)
- Consumes: `get_active_contract`, existing `has_contract_success`, `check_pending_write_gate`, `overlay_blocks_done`, `should_block_index_submit`

**Interfaces:**
- Produces:

```python
@dataclass(frozen=True)
class DoneDecision:
    accepted: bool
    reasons: tuple[str, ...]           # machine codes
    remaining: tuple[str, ...]         # in_scope leftovers if any
    missing_evidence: tuple[str, ...]  # success kinds/evidence gaps

def validate_done(business_data: dict, *, section: str | None = None) -> DoneDecision:
    ...
```

Reason codes (fixed strings): `no_contract`, `overlay_blocks`, `pending_write`, `submit_required`, `index_submit_blocked`, `success_unmet`, `scope_remaining`.

- [ ] **Step 1: Extend cold pin with fail-first cases**

```python
from scripts.controller.actions._phase_intent import validate_done, apply_phase_contract

bd = {}
apply_phase_contract(bd, {
    'mode': 'create', 'allow_form_assistant': True, 'refill': 'all_editable',
    'goal': 'create row', 'in_scope': ['fill form', 'save'], 'out_of_scope': [],
    'done_when': 'saved', 'submit': {'required': True, 'via': 'click_save', 'button_text': '保存'},
    'success': {'kinds': ['toast_ok'], 'evidence': []}, 'version': 1,
})
d = validate_done(bd)
assert d.accepted is False
assert 'success_unmet' in d.reasons or 'pending_write' in d.reasons or 'submit_required' in d.reasons
```

(Adapt exact reason to current gate semantics; pin the **stable** code you implement.)

- [ ] **Step 2: Run pin → fail on missing `validate_done`**

- [ ] **Step 3: Implement `validate_done`** wrapping existing gates in order:

1. no active contract → reject `no_contract`
2. `overlay_blocks_done` → `overlay_blocks`
3. submit.required and not satisfied (reuse existing submit/index helpers; `should_block_index_submit` → `index_submit_blocked`) → `submit_required` / `index_submit_blocked`
4. `check_pending_write_gate` not ok → `pending_write`
5. `has_contract_success` false → `success_unmet` (+ populate `missing_evidence` from contract success kinds not recorded)
6. optional: compute `remaining` from unchecked in_scope markers if the codebase already tracks them; if not tracked today, leave `remaining=()` and document in agent-log — do **not** invent a parallel checklist store in this task

Prefer calling `done_accept_reason` if it already encodes accept path; unify so there is one accept story.

- [ ] **Step 4: Pin PASS; also run**

```bash
python scripts/characterization/cold/characterize-phase-intent.py
python scripts/characterization/characterize-phase-reviewer.py
```

Expected: still PASS (no regression).

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(phase): validate_done authority stack for contract sovereignty"
```

---

### Task 3: `is_action_in_scope` + tool-entry rejection

**Files:**
- Modify: `scripts/controller/actions/phase/intent_gates.py`
- Modify: `scripts/controller/service.py` and/or action modules that already consult phase intent (prefer one choke point near controller registry dispatch if it exists; else gate `click_element` / index click / navigation helpers that are known bleed paths)
- Extend cold pin
- Consumes: `get_active_contract`

**Interfaces:**

```python
def is_action_in_scope(business_data: dict | None, action_name: str, params: dict | None = None) -> tuple[bool, str]:
    """Return (allowed, reject_code). reject_code empty when allowed."""
```

Rules (minimal viable):

- No contract / heal contract active → allow (`''`).
- `action_name` in {`click_element`, `click_element_by_index`} AND save/submit context AND contract `submit.via == 'click_save'` → deny `submit_via_violation` (align with `should_block_index_submit`).
- Do **not** build an NLP matcher for all `out_of_scope` strings in this task; only enforce existing `should_block_index_submit` + save-via rules.

- [ ] **Step 1: Pin** mirroring a deterministic `should_block_index_submit` case via `is_action_in_scope`
- [ ] **Step 2–4: Implement wrapper + call from one real action path; pin PASS**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(phase): is_action_in_scope gate for submit-via violations"
```

---

### Task 4: Planner demotion (prompt + filter)

**Files:**
- Modify: `scripts/prompts/planner-prompt.md`
- Modify: `scripts/agent_utils.py` (`PLANNER_SYSTEM_PROMPT` load / patch helpers)
- Create: `scripts/characterization/characterize-planner-advisory-filter.py`
- Optional hook in `scripts/agent/service.py` where planner output is consumed (if accessible); if browser-use hides raw planner JSON, still ship prompt field + pure function filter tested.

**Interfaces:**

```python
def filter_planner_advice(advice: dict, contract: dict | None) -> dict | None:
    """Return None if advice must be discarded; else sanitized advice.
    Discard when compatible_with_contract is False/missing, or next_steps
    mention done()/结束阶段 as executable instruction.
    """
```

- [ ] **Step 1: Failing pin for filter**

```python
from scripts.agent_utils import filter_planner_advice
c = {'out_of_scope': ['点修改'], 'version': 1}
assert filter_planner_advice({'compatible_with_contract': False, 'next_steps': ['x']}, c) is None
assert filter_planner_advice({'compatible_with_contract': True, 'next_steps': ['调用 done() 结束']}, c) is None
kept = filter_planner_advice({'compatible_with_contract': True, 'next_steps': ['填写字段'], 'challenges': []}, c)
assert kept is not None
```

- [ ] **Step 2: Run → fail**
- [ ] **Step 3: Implement filter + update planner-prompt.md** — add required `compatible_with_contract`; rewrite executable done/save override tone into advisory warnings
- [ ] **Step 4: Pin PASS**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(agent): demote planner to advisory with compatible_with_contract filter"
```

---

### Task 5: Wire `done` path in `scripts/agent/service.py`

**Files:**
- Modify: `scripts/agent/service.py` (phase completion / continue logic that today calls `has_contract_success` / pending gate)
- Emit `done_rejected` / structured observation into the channel already used for `phase_intent_obs`
- Extend cold pin or add `scripts/characterization/characterize-phase-done-validate.py` that imports the pure helper used by service (prefer testing helper, not full Agent)

**Behavior:**

- Before accepting phase success after browser-use reports done / local done handling: `decision = validate_done(business_data_ref)`.
- If not `decision.accepted`: do **not** emit phase success; emit:

```python
{
  "event": "done_rejected",
  "data": {
    "phase": "<n>",
    "contract_version": get_active_contract(bd).get("version"),
    "authority": "gate",
    "reasons": list(decision.reasons),
    "remaining": list(decision.remaining),
    "missing_evidence": list(decision.missing_evidence),
  },
}
```

- Inject the same fields into the next-step context string Executor sees (reuse `recovery_prescription_message` if present).
- Do **not** call Planner for a second opinion on reject.

- [ ] **Step 1: Characterization for emit helper / decision branch (fail first)**
- [ ] **Step 2: Implement wiring**
- [ ] **Step 3: Run new pin + `characterize-phase-runtime.py` / reviewer pins**
- [ ] **Step 4: Commit**

```bash
git commit -m "feat(agent): route phase done through validate_done; emit done_rejected"
```

---

### Task 6: Explicit `recontract` path

**Files:**
- Modify: `scripts/controller/actions/phase/reviewer.py` and/or `scripts/agent/service.py` session instruction handler
- Extend sovereignty cold pin for version bump + history

**Behavior:**

```python
def begin_recontract(business_data: dict, new_contract: dict) -> dict:
    old = get_active_contract(business_data)
    if old:
        append_contract_history(business_data, old)
        new_contract = dict(new_contract)
        new_contract['version'] = int(old.get('version') or 1) + 1
    else:
        new_contract = ensure_contract_version(new_contract)
    apply_phase_contract(business_data, new_contract)
    return get_active_contract(business_data)
```

- Trigger: only explicit session/control-plane instruction. **Do not** enable auto recontract.
- On recontract: emit `recontract` event with old/new version; clear planner advisory buffer if any; rebuild agent system message from new contract (same path as phase start).

- [ ] **Step 1: Pin version bump 1→2 and history length +1**
- [ ] **Step 2: Implement helper + one explicit trigger path**
- [ ] **Step 3: PASS + commit**

```bash
git commit -m "feat(phase): explicit recontract bumps contract version and history"
```

---

### Task 7: verify-all registration + docs touch-up

**Files:**
- Modify: `scripts/refactor/verify-all.sh` — register `characterize-contract-sovereignty` and `characterize-planner-advisory-filter`
- Confirm spec status is `approved`
- Optional: short bullet in `docs/superpowers/todo-list.md` pointing at this plan
- Modify: `docs/superpowers/agent-log.md`

- [ ] **Step 1: Add verify-all entries next to existing phase-reviewer runs**
- [ ] **Step 2: Run**

```bash
bash scripts/refactor/verify-all.sh
```

Expected: new pins GREEN; no unrelated WIP required.

- [ ] **Step 3: Commit**

```bash
git commit -m "test: register contract-sovereignty characterization in verify-all"
```

---

### Task 8: Wet checklist (manual, no code)

Not automated. After Tasks 1–7:

1. Start control plane + executor on LMY.
2. Run a multi-phase AI record with form save.
3. Confirm: phase boundaries show reviewer contract versions; mid-phase planner conflicts (if any) only in advisory logs; forced early done (if exercisable) yields `done_rejected` with `missing_evidence` / reasons; no silent contract byte changes without recontract event.
4. Write short report under `docs/superpowers/reports/2026-09-11-contract-sovereignty-wet.md` and agent-log closeout.

- [ ] **Step 1: Execute wet checklist**
- [ ] **Step 2: Commit report only**

```bash
git commit -m "docs(report): contract-sovereignty wet checklist results"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| Authority order / role table | Tasks 1–5 (API + wiring) |
| Conflict detection signals / obs fields | Tasks 2, 3, 5 |
| `done()` gate stack | Task 2, 5 |
| No Planner re-litigation on done reject | Task 5 |
| Recontract explicit, default no auto | Task 6 |
| Phase state machine executing stays on rejects | Task 5 behavior |
| Planner `compatible_with_contract` + discard | Task 4 |
| Code landing table | Tasks 1–7 |
| Acceptance #1 out_of_scope planner | Task 4 (+3 save-via) |
| Acceptance #2 missing evidence | Tasks 2, 5 |
| Acceptance #3 version monotonic | Tasks 1, 6 |
| Acceptance #4 wet multi-phase | Task 8 |

## Out of scope (reminders)

- Auto recontract enablement
- Full NLP `out_of_scope` enforcement
- Replacing browser-use
- KB / BiB / trajectory schema
