# Phase Runtime Hardening — Design

**Date:** 2026-08-08  
**Status:** draft (awaiting user review)  
**Branch target:** `V2.1_dev`  
**Approach:** thin PhaseRuntime primitives on top of existing Phase Intent Contract (not a full agent-harness rewrite)

## Problem

Four related recording failures (evidence from live logs):

1. **Empty `act={}` burns `max_steps`** — LLM/structured-output produces no effective tool call; browser-use still consumes a loop iteration. Common log: `goal=Execute AgentOutput | act={} | res=None`.
2. **`done()` rejected by cross-section pending** — recorder calls `check_pending_write_gate(store)` with **no** `section`, so other blocks (征信/综合评价…) block finish after a section-scoped save.
3. **Missing success token looks like success** — soft `quality_failed` / `missing_success_token` exists but stderr/`Step N done` still read as OK.
4. **Stale `_scan_buttons` auto-section** — unique-button auto-bind used a cached scan that omitted sibling「保存」buttons; (pass-`sec` bug already fixed) refresh still needed for correctness.

## Decisions (brainstorm)

| Topic | Choice |
|-------|--------|
| `done()` pending scope | **C** — last used section → unique NL/title infer → else full table |
| Empty steps vs budget | **D** — add empty-act buffer to chosen `max_steps` (do not reimplement browser-use counting) |
| Empty-act handling | Detect empty effective actions and inject a recovery prescription (**no** step-count change) |
| Missing-token visibility | **B** — loud stderr + guarantee `phase_end.quality_failed` (+ reasons); **no** `phase_error` |
| Auto-section buttons | **A** — when `section=` empty, **rescan buttons** before `unique_button_section` |
| Architecture | Thin runtime helpers beside contract; **not** full harness rewrite |

### Conflict resolutions (guiding principle: maximize **legal, executable** next actions)

Conflicts found in review were resolved so prescriptions and auto-scope never ask the model for an action it cannot legally run this step.

| Conflict | Resolution | Why (legal action) |
|----------|------------|-------------------|
| Empty cue after save already OK | If `_last_save_ok` / contract success → cue **`done(success=true)`**; else cue scoped **`click_save`** | Avoid illegal/useless re-save; only `done` is valid when token exists |
| Empty cue on browser-use last step | On `is_last_step` → cue **only `done(success=…)`** (true iff save/success token); **never** `click_save` | Last step is DoneAgentOutput-only; `click_save` is not in the schema |
| Naked `click_save` + multi「保存」but `_phase_section` set | After rescan: prefer **`_phase_section`**, then `unique_button_section`, else ambiguous | Scoped `click_save(section=…)` is the legal call; guessing wrong unique button is worse than using phase memory |
| `_EMPTY_ACT_BUFFER` scope | Apply **+3 only when `submit.required`** (create/modify maintain) | Extra budget where legal save/`done` sequence matters; don’t inflate navigate/login |
| When to `remember_phase_section` | **Early:** assistant `section=` on start; `click_save` whenever `sec` is resolved (explicit, auto-unique, or `_phase_section` fallback)—even if click later fails pending/ambiguous | Later empty-act / NEXT_ACTION cues can emit **legal** `click_save(..., section=…)` instead of bare save |

Additional clarity (non-blocking gaps closed the same way):

- `done()` pending gate remains gated on `refill=all_editable` (today’s rule); only the **section argument** changes via `resolve_phase_section`.
- Title infer: prefer **longest** unique `section_title` match when multiple substring hits nest.

## Non-goals

- Fork / wrap browser-use `for step in range(max_steps)` to truly skip empty iterations.
- Emit `phase_error` for quality failures (reserved for cancel/exception).
- Block index-click of「暂存」(product: phase-4 暂存 is intentional).
- Revert force-cap of reviewer `estimated_steps` / `effort`.

## Architecture

```
Phase Intent Contract (policy)
  mode / refill / submit / success / recovery
        │
        ▼
Thin Phase Runtime (this work)
  resolve_phase_section(store)
  remember_phase_section(store, sec)
  refresh_scan_buttons(page) → _scan_buttons
  empty_act detection + prescription (recorder)
  EMPTY_ACT_BUFFER in resolve_phase_max_steps
  QUALITY FAIL stderr + phase_end payload
        │
        ▼
recorder / click_save / session_runner / agent.run(max_steps=)
```

Contracts remain the declarative policy; runtime owns **scope memory**, **budget padding**, **empty-act cue**, and **terminal visibility**.

---

## 1. Section scope for `done()` (decision C)

### 1.1 API

- `remember_phase_section(store, section: str) -> None` — set `store['_phase_section']` when non-empty.
- `resolve_phase_section(store) -> str` — returns `""` if unresolved (means: keep today’s full-table gate).

### 1.2 Resolution order

1. `store['_phase_section']` if non-empty (phase memory; see remember rules below).
2. **Infer once:** match phase `goal` / `in_scope` / current phase task text against known `section_title`s from `_scan_buttons` and/or `task_list` items. Adopt only if **exactly one** title matches after normalization; if several titles substring-match, keep the **longest** matching title only when it is uniquely longest, else do not guess.
3. Else `""`.

### 1.3 Writers (remember early so later cues stay legal)

- `run_form_assistant`: if caller `section` non-empty when the action starts, `remember_phase_section`.
- `click_save`: after resolving `sec` (explicit → else remembered `_phase_section` → else unique-button after rescan), if `sec` non-empty → `remember_phase_section` **before** click/gate outcome (so a failed pending/ambiguous still leaves memory for the next legal cue).
- Phase start / `apply_phase_*` / clear intent: clear `_phase_section`.

### 1.4 Consumers

- `recorder` premature-`done` write gate (**still only when `refill=all_editable`**):  
  `check_pending_write_gate(store, section=resolve_phase_section(store))`.
- `session_runner` phase-end soft pending check: **same** resolver and same `all_editable` precondition (no divergent rules).

### 1.5 Error / recovery copy

When rejecting `done` with scoped pending, message should mention the active section and remaining labels **in that section**, plus hint to `click_save(..., section=…)`.

---

## 2. Empty-act budget (decision D)

### 2.1 Formula

In `resolve_phase_max_steps`:

1. Base from `estimated_steps + BUFFER(2)` or effort bucket (existing).
2. Apply `_SUBMIT_STEPS_FLOOR` (8) when `submit.required`.
3. Add `_EMPTY_ACT_BUFFER` (**default 3**) **only when `submit.required`** (maintain phases that must emit legal `click_save` / `done`).
4. `min(ceiling, result)`; floor remains existing minimums.

Navigate/login/query without submit: **no** empty-act buffer (avoid inflating phases that should stay short).

### 2.2 Observability

- stderr: include `empty_buffer=N` alongside `ceiling` / `chosen`.
- Optional: `phase_intent_obs.max_steps_empty_buffer`.

Does **not** stop empty loops by itself; pairs with §3.

---

## 3. Empty-act detection + prescription (added to scope)

### 3.1 Root cause (context)

browser-use may:

- Fall back from failed structured parse to a tool call named `AgentOutput` → log `goal=Execute AgentOutput`, `ActionModel` has no registered tool → effective empty action.
- Emit action models whose `model_dump()` is all-nulls; empty check uses `model_dump() == {}` **without** `exclude_unset`/`exclude_none`, so retry/noop-done often **does not** run.
- Our recorder filters `None` fields → prints `act={}`.

### 3.2 Detection (our side)

In recorder step callback (same place as goal/action logging), treat an action list as **empty effective** when:

- no actions, or
- every action’s `model_dump(exclude_none=True)` / filtered active dict is `{}`, or
- sole key is unknown / not a registered controller action (defensive), or
- `next_goal` matches `Execute AgentOutput` **and** effective actions empty.

Do **not** treat a real `done={...}` as empty.

### 3.3 Prescription (no step-count change) — always a **legal** next action

On empty effective action:

1. Increment `store['_empty_act_streak']` (reset to 0 on any non-empty effective action).
2. Choose cue by **what the model is allowed to emit this step**:
   - **Last step** (`AgentStepInfo.is_last_step` / DoneAgentOutput active):  
     `NEXT_ACTION: done(success=true|false)` only — `success=true` iff `has_contract_success` / `_last_save_ok` (or introduce ok); else `success=false` with short reason. **Never** prescribe `click_save` here.
   - **Not last step**, and save already OK (`_last_save_ok` or contract success):  
     `NEXT_ACTION: done(success=true)`. **Do not** prescribe another `click_save`.
   - **Not last step**, save not OK, `submit.required`:  
     `NEXT_ACTION: click_save(button_text='保存', section='…')` using `resolve_phase_section` when known; if section unknown, still prescribe `click_save` and tell model to pass `section=` from scan/`sections` (legal tool; may return ambiguous — better than empty act).
   - **Not last step**, no submit required:  
     prescribe the contract recovery / `done(success=true)` as appropriate (same spirit as submit-ready hint).
3. Inject via `_message_manager._add_message_with_tokens`; log `[recorder] Injected empty-act cue (streak=N last_step=… save_ok=…)`.
4. **Do not** set `agent.state.stopped` on empty-act alone.

### 3.4 Clear streak

Phase start / successful non-empty tool / successful save token → clear `_empty_act_streak`.

---

## 4. Rescan buttons before auto-section (decision A)

When `click_save` is called with empty `section` parameter, resolve `sec` in this order (legal scoped click):

1. If `store['_phase_section']` non-empty → use it as `sec` (phase memory).
2. Else `refresh_scan_buttons(page)` → write `_scan_buttons` → `unique_button_section(...)`; if unique → `sec`.
3. Else leave `sec=""` → existing `err-save-ambiguous` / not-found paths when JS sees multiple/zero matches.

If caller passed explicit `section=`, use it and skip forced rescan.

After `sec` is known, `remember_phase_section` (see §1.3) then gate + `JS_CLICK_SAVE_BUTTON(..., sec)`.

---

## 5. Missing success-token visibility (decision B)

When phase-end soft gate marks `missing_success_token` (or any `_quality_failed`):

1. stderr (required):  
   `[session] QUALITY FAIL phase=<n> reasons=[...]`
2. `emit_json(phase_end)` **must** include:
   - `quality_failed: true`
   - `quality_failed_reasons: [...]`
3. Do **not** emit `phase_error` for this path.

If `quality_failed` was set earlier in the phase, still surface the same stderr line at phase end (once is enough).

---

## 6. Testing (characterization)

| Area | Assert |
|------|--------|
| Scope C | With `_phase_section='系统评级结论'`, gate ignores other sections’ pending; without memory + non-unique infer → full table |
| Infer | Exactly one title in goal → resolved; two titles mentioned → `""` |
| Empty buffer | `submit.required` + `estimated_steps=4` → chosen ≥ `8+3` within ceiling; **no** empty buffer when submit not required |
| Empty-act cue | Empty effective → inject legal NEXT_ACTION: last_step/save_ok → `done`; else scoped `click_save`; never `click_save` on last step |
| Rescan / memory | Naked `click_save`: `_phase_section` wins over unique-button; refresh used when memory empty |
| Quality B | session phase-end path contains `QUALITY FAIL`; `phase_end` includes quality fields when failed |

Prefer pure unit tests for resolver / buffer / empty detection helpers; source greps acceptable for wiring.

---

## 7. Files (expected)

- `scripts/actions/_section_scope.py` and/or new `scripts/actions/_phase_runtime.py` (resolver + remember + maybe empty helpers)
- `scripts/actions/_phase_reviewer.py` — `EMPTY_ACT_BUFFER`
- `scripts/actions/_form.py` — rescan + remember section on save/assistant
- `scripts/recorder.py` — scoped done gate + empty-act prescription
- `scripts/session_runner.py` — QUALITY FAIL + phase_end; scoped soft gate
- `scripts/characterization/characterize-phase-section-scope.py` (extend) and/or new `characterize-phase-runtime.py`
- `CHANGELOG.md` `[Unreleased]` Fixed/Changed
- Prompts only if recovery copy must mention empty-act (optional, keep minimal)

---

## 8. Risks

| Risk | Mitigation |
|------|------------|
| Empty buffer lengthens runaway phases | Ceiling cap; buffer **only** on `submit.required` |
| NL infer binds wrong section | Unique / longest-unique match only; else full table |
| Rescan every naked `click_save` costs latency | Skip rescan when explicit section or `_phase_section` already set |
| Empty-act cue fights last-step done-only | Last step cues **only** `done`; never `click_save` |
| Re-save after silent success | Save-ok → cue `done`, not another `click_save` |
| Prescription spam | Streak in log; short message; reset on real action |

---

## 9. Success criteria

- Section-scoped phase can `done` after silent/toast save without foreign-section pending rejection.
- `chosen` reflects empty buffer in logs for submit phases.
- Empty `act={}` steps get an immediate NEXT_ACTION cue instead of silent burn-only.
- Naked `click_save` auto-section uses freshly scanned buttons.
- Operators see `QUALITY FAIL` when success token missing; SPA/`phase_end` carries `quality_failed`.
