# Overlay Done Gate Soft-Demotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop hard-rejecting `done()` solely because a dialog/drawer is open when the phase contract does not require submit or success evidence.

**Architecture:** Add pure `overlay_blocks_done(contract)` in `_phase_intent.py` with inverted default (has contract → allow unless `submit.required` or non-empty `success.kinds`). Wire `recorder.py` overlay gate to call it; soft-warn when overlay present but allowed. Other done gates unchanged.

**Tech Stack:** Python agent (`_phase_intent.py`, `recorder.py`), characterization scripts.

**Spec:** `docs/superpowers/specs/2026-08-07-overlay-done-gate-design.md`

## Global Constraints

- Scope: **overlay done-gate only** — do not soften error / token / pending / claimed-save gates.
- **Inverted default:** with a contract, overlay does **not** block done unless `submit.required` is true **or** `success.kinds` is non-empty.
- No contract (`None` / non-dict) → **blocks** (conservative).
- Ignore `mode` / `refill` / DOM for this decision.
- `submit.required` via `coerce_bool` from `_phase_reviewer`.
- Scripts-only → no CHANGELOG required.
- No `__pycache__` commits.

## File map

| File | Role |
|------|------|
| `scripts/actions/_phase_intent.py` | `overlay_blocks_done(contract)` |
| `scripts/recorder.py` | Call helper at overlay hard-reject (~L488) |
| `scripts/characterization/characterize-phase-intent.py` | Unit cases for helper |

---

### Task 1: `overlay_blocks_done` (TDD)

**Files:**
- Modify: `scripts/actions/_phase_intent.py`
- Modify: `scripts/characterization/characterize-phase-intent.py`

**Interfaces:**
- Consumes: `coerce_bool` from `scripts.actions._phase_reviewer`
- Produces: `overlay_blocks_done(contract: dict | None) -> bool`
  - `True` = recorder must hard-reject done while overlay open
  - `False` = do not block done solely for overlay

- [ ] **Step 1: Write failing characterization cases**

Near the end of `main()` in `characterize-phase-intent.py` (before the final `print`), import and assert:

```python
from scripts.actions._phase_intent import overlay_blocks_done

assert_true(overlay_blocks_done(None) is True, 'no contract blocks')
assert_true(
    overlay_blocks_done({'submit': {'required': True}, 'success': {'kinds': []}}) is True,
    'required=True blocks',
)
assert_true(
    overlay_blocks_done({'submit': {'required': False}, 'success': {'kinds': ['toast_ok']}}) is True,
    'non-empty kinds blocks',
)
assert_true(
    overlay_blocks_done({'submit': {'required': False}, 'success': {'kinds': []}}) is False,
    'required=false empty kinds allows',
)
assert_true(
    overlay_blocks_done({'mode': 'modify'}) is False,
    'mode-only contract allows (inverted default)',
)
assert_true(
    overlay_blocks_done({'submit': {'required': 'true'}, 'success': {'kinds': []}}) is True,
    'coerce_bool string true blocks',
)
assert_true(
    overlay_blocks_done({'submit': {'required': 'false'}, 'success': {'kinds': []}}) is False,
    'coerce_bool string false allows',
)
```

Also add `overlay_blocks_done` to the top-level import list in that file (or keep the local import as above — either is fine; prefer top-level with other imports).

- [ ] **Step 2: Run test — expect FAIL**

```bash
python scripts/characterization/characterize-phase-intent.py
```

Expected: `ImportError` or `AssertionError` / `NameError` because `overlay_blocks_done` does not exist yet.

- [ ] **Step 3: Implement helper**

In `scripts/actions/_phase_intent.py`, near other contract predicates (e.g. after `is_introduce_phase` ~L430):

```python
def overlay_blocks_done(contract: dict | None) -> bool:
    """True → hard-reject done while overlay open; False → do not block for overlay alone.

    Inverted default: with a contract, allow unless submit.required or non-empty success.kinds.
    No contract → block (conservative).
    """
    if not isinstance(contract, dict):
        return True
    from ._phase_reviewer import coerce_bool
    submit = contract.get('submit')
    if not isinstance(submit, dict):
        submit = {}
    required = coerce_bool(submit.get('required'))
    kinds = (contract.get('success') or {}).get('kinds') or []
    if not isinstance(kinds, (list, tuple)):
        kinds = []
    if required or len(kinds) > 0:
        return True
    return False
```

- [ ] **Step 4: Run test — expect PASS**

```bash
python scripts/characterization/characterize-phase-intent.py
```

Expected: `characterize-phase-intent: OK`

- [ ] **Step 5: Commit**

```bash
git add scripts/actions/_phase_intent.py scripts/characterization/characterize-phase-intent.py
git commit -m "$(cat <<'EOF'
feat: overlay_blocks_done prefers contract over open dialog

EOF
)"
```

---

### Task 2: Wire recorder overlay gate + soft warn

**Files:**
- Modify: `scripts/recorder.py` (overlay block ~L488–508)

**Interfaces:**
- Consumes: `overlay_blocks_done(contract)` from Task 1; `contract` already loaded via `get_phase_intent(case_data_store)` earlier in the same done branch (~L355)
- Produces: hard reject only when helper returns True; soft-warn log when overlay open but helper False

- [ ] **Step 1: Locate the overlay hard-reject**

Confirm this block still exists in `scripts/recorder.py`:

```python
if open_overlay and not navigated_ok and not save_ok and not introduce_ok:
    sys.stderr.write(
        f"[recorder] ⚠ Premature done() — visible overlay {open_overlay} "
        ...
    )
    ...
    return
```

- [ ] **Step 2: Replace with contract-gated hard reject + soft path**

Ensure import is available in this branch (local import is fine to match file style):

```python
from .actions._phase_intent import overlay_blocks_done
```

Replace the overlay `if` with:

```python
if open_overlay and not navigated_ok and not save_ok and not introduce_ok:
    if overlay_blocks_done(contract):
        sys.stderr.write(
            f"[recorder] ⚠ Premature done() — visible overlay {open_overlay} "
            f"at step {agent.state.n_steps}, forcing continue\n"
        )
        sys.stderr.flush()
        for h in agent.state.history.history:
            if h.result:
                for r in h.result:
                    r.is_done = False
                    r.error = (
                        f'Premature done() rejected: {open_overlay} still open. '
                        f'Finish or close it, then click submit / call done() again.'
                    )
                    try:
                        from scripts.feature_flags import memory_whitelist_enabled
                        if memory_whitelist_enabled():
                            r.include_in_memory = True
                    except Exception:
                        pass
        return
    submit = (contract or {}).get('submit') or {}
    kinds = ((contract or {}).get('success') or {}).get('kinds') or []
    sys.stderr.write(
        f"[recorder] overlay present ({open_overlay}) but contract allows done "
        f"(submit.required={bool(submit.get('required'))}, kinds={list(kinds)}) "
        f"at step {agent.state.n_steps}\n"
    )
    sys.stderr.flush()
```

Do **not** change the following `error_notifs` / `form_errors` hard gate or token / pending gates.

Note: soft-warn may print `submit.required=True` for string `"true"` via `bool(...)` while helper uses `coerce_bool` — prefer logging via the same coerce for consistency:

```python
from .actions._phase_reviewer import coerce_bool
...
f"(submit.required={coerce_bool(submit.get('required'))}, kinds={list(kinds)}) "
```

- [ ] **Step 3: Sanity import check**

```bash
python -c "from scripts.actions._phase_intent import overlay_blocks_done; from scripts import recorder; print(overlay_blocks_done({'mode':'navigate'}), 'ok')"
```

Expected: `False ok` (and no import error from recorder).

- [ ] **Step 4: Re-run characterization**

```bash
python scripts/characterization/characterize-phase-intent.py
```

Expected: `characterize-phase-intent: OK`

- [ ] **Step 5: Commit**

```bash
git add scripts/recorder.py
git commit -m "$(cat <<'EOF'
feat: skip overlay done reject when contract allows open dialog

EOF
)"
```

---

### Task 3: Verification

- [ ] **Step 1: Run suite**

```bash
python scripts/characterization/characterize-phase-intent.py
python scripts/characterization/characterize-phase-boundary.py
python scripts/characterization/characterize-phase-reviewer.py
```

Expected: all OK / PASS.

- [ ] **Step 2: Manual checklist (human live run)**

- Navigate / open `+新增` phase (`submit.required=false`, empty kinds): `done` while drawer open → soft log `contract allows done`, **no** `Premature done() — visible overlay`.
- Single-field phase in open drawer: same.
- Save phase (`submit.required=true`): premature `done` with drawer still open → still hard-reject overlay (and/or token gate).

- [ ] **Step 3: Commit only if fixes needed**

---

## Spec coverage

| Spec item | Task |
|-----------|------|
| `overlay_blocks_done` inverted default | Task 1 |
| `coerce_bool` for `submit.required` | Task 1 |
| No-contract blocks | Task 1 |
| Recorder hard vs soft paths | Task 2 |
| Soft warn log | Task 2 |
| Other gates untouched | Task 2–3 |
| Characterization cases | Task 1 + 3 |
| Manual acceptance vs prior log | Task 3 |

## Out of scope (do not implement in this plan)

- Softening validation-error / token / pending / claimed-save gates
- Forbidding `close_dialog` after field miss
- Trajectory text fix (`客户分类` → `客户状态`)
- New success evidence `overlay_opened`
