# Overlay Done Gate — Contract-First Soft-Demotion — Design

**Date:** 2026-08-07  
**Status:** Spec approved — plan at `docs/superpowers/plans/2026-08-07-overlay-done-gate.md`  

**Related:** Phase reviewer max_steps (`2026-08-06-phase-reviewer-max-steps-design.md`); live log `log.txt` Step 3–8 (`Premature done() — visible overlay drawer:新增客户校验`)

---

## 1. Problem

Recorder hard-rejects `done()` whenever a visible `el-dialog` / `el-drawer` is open, unless `navigated_ok` / `save_ok` / `introduce_ok` already fired:

```text
Premature done() — visible overlay drawer:… still open
```

That assumes **「弹层开着 = 表单未完成」**. It conflicts with:

- Navigate / open-page phases whose goal is **打开抽屉/弹窗**
- Per-field phases whose goal is **在已打开抽屉里改一个字段**（抽屉理应保持打开）

Live evidence: Step 3–8 contracts already had `submit.required=false` and empty `success.kinds`, Agent correctly called `done`, recorder burned steps with overlay rejects until `max_steps` exhausted.

A separate failure in the same run (phase script label `客户分类` vs real `客户状态` → `close_dialog` wipe) is **out of scope** here.

---

## 2. Goals & Non-Goals

### Goals

- Prefer phase **contract** over DOM overlay heuristics for this gate.
- With a contract: **overlay does not block done by default**.
- Overlay hard-blocks done only when the contract still requires submit and/or non-empty success kinds.
- Centralize the decision in a testable helper; recorder only calls it.
- Soft-warn when overlay is present but contract allows done.

### Non-Goals

- Softening other done gates: visible validation/errors, missing success token, `all_editable` pending, legacy “claimed save without toast”.
- Forbidding `close_dialog` / re-open `+新增` after field miss.
- Fixing trajectory phase text (e.g. `客户分类` → `客户状态`).
- New success evidence kinds such as `overlay_opened`.
- Changing assemble / replay / CTRL.

### Locked decisions

| Decision | Choice |
|----------|--------|
| Scope | **Overlay gate only** |
| Default (has contract) | **Allow done** even if overlay open |
| Still hard-block | `submit.required=true` **or** `success.kinds` non-empty |
| No contract | **Hard-block** (conservative) |
| Mode strings | **Ignored** — only `submit` / `success.kinds` |
| Implementation | Helper `overlay_blocks_done(contract)` + recorder wire |

---

## 3. API

Place in `scripts/actions/_phase_intent.py` (same layer as submit/success helpers):

```python
def overlay_blocks_done(contract: dict | None) -> bool:
    """True → recorder hard-rejects done while overlay is open.
    False → do not block done solely because overlay is visible.
    """
```

### Decision table

| Input | Result |
|-------|--------|
| `contract` is `None` or not a `dict` | **blocks** (`True`) |
| Has contract AND (`submit.required` is true **OR** `success.kinds` non-empty) | **blocks** (`True`) |
| Has contract AND `submit.required` is false/absent AND `kinds` empty/absent | **does not block** (`False`) |

### Field reading rules

- `submit`: if missing or not a dict → treat as `required=False`.
- `submit.required`: use `coerce_bool` from `_phase_reviewer` (only `True` / `"true"` / `"1"` / `1` → true).
- `success.kinds`: read `(contract.get('success') or {}).get('kinds')`; missing / `None` / `[]` → empty; any non-empty sequence → blocks.
- Do **not** consult `mode`, `refill`, `goals`, or DOM.

---

## 4. Recorder wiring

File: `scripts/recorder.py` (recording done branch, overlay check).

Current shape (conceptual):

```python
if open_overlay and not navigated_ok and not save_ok and not introduce_ok:
    # hard reject done
```

New shape:

```python
if (
    open_overlay
    and not navigated_ok
    and not save_ok
    and not introduce_ok
    and overlay_blocks_done(contract)
):
    # hard reject (unchanged message)
elif open_overlay and not navigated_ok and not save_ok and not introduce_ok:
    # soft warn only; continue to later gates
    # log: overlay present ({open_overlay}) but contract allows done
    #       (submit.required=…, kinds=…)
```

Preserve existing bypasses: `navigated_ok` / `save_ok` / `introduce_ok` still skip the overlay hard path.

Later gates (errors, token, pending, claimed-save) **unchanged**.

---

## 5. Logging

| Case | Log |
|------|-----|
| Hard reject | Keep existing `Premature done() — visible overlay … forcing continue` |
| Soft allow | `[recorder] overlay present ({open_overlay}) but contract allows done (submit.required=…, kinds=…)` — info/soft-warn; **do not** clear `is_done` |

---

## 6. Characterization

Extend `scripts/characterization/characterize-phase-intent.py`:

1. `overlay_blocks_done(None)` → `True`
2. `required=True` (kinds empty or not) → `True`
3. `required=False`, `kinds=['toast_ok']` → `True`
4. `required=False`, `kinds=[]` → `False`
5. Contract with only `mode='modify'` (no submit/success) → `False` (inverted default)

No browser integration test required for this round.

### Manual acceptance (against prior log shape)

- Phases like Step 3–8 (`submit.required=false`, empty kinds): `done` must **not** be rejected solely for `drawer:新增客户校验`.
- Save phase (`submit.required=true`, e.g. `toast_ok`): premature `done` while overlay still open may still hard-reject via this gate (token gate may also apply).

---

## 7. Risks

| Risk | Mitigation |
|------|------------|
| Create/modify phase with wrong contract (`required=false`) ends while drawer open mid-form | Reviewer/sanitize already own contract quality; out of scope to re-harden DOM |
| No-contract sessions become stricter relative to “always allow” fantasy | Explicit: no contract → still block (safe) |
| Stacking more recorder ifs | Helper is the only new policy surface; no mode/keyword branches |

---

## 8. Implementation sketch (for plan)

1. TDD: add `overlay_blocks_done` cases to `characterize-phase-intent.py` (fail).
2. Implement helper in `_phase_intent.py`.
3. Wire `recorder.py` + soft log.
4. Re-run characterize-phase-intent (+ smoke related phase suites if cheap).
