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
| Empty-act handling | **Also** detect empty effective actions and inject a recovery prescription (**no** step-count change) |
| Missing-token visibility | **B** — loud stderr + guarantee `phase_end.quality_failed` (+ reasons); **no** `phase_error` |
| Auto-section buttons | **A** — when `section=` empty, **rescan buttons** before `unique_button_section` |
| Architecture | Thin runtime helpers beside contract; **not** full harness rewrite |

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

1. `store['_phase_section']` if non-empty (last successful scoped write/save).
2. **Infer once:** match phase `goal` / `in_scope` / current phase task text against known `section_title`s from `_scan_buttons` and/or `task_list` items. Adopt only if **exactly one** title matches (substring / normalized). Zero or ≥2 → do not guess.
3. Else `""`.

### 1.3 Writers

- `click_save`: after resolving `sec` (explicit or auto), if `sec`: `remember_phase_section`.
- `run_form_assistant`: if caller `section` non-empty and run proceeds, remember it.
- Phase start / `apply_phase_*` / clear intent: clear `_phase_section`.

### 1.4 Consumers

- `recorder` premature-`done` write gate:  
  `check_pending_write_gate(store, section=resolve_phase_section(store))`.
- `session_runner` phase-end soft pending check: **same** resolver (no divergent rules).

### 1.5 Error / recovery copy

When rejecting `done` with scoped pending, message should mention the active section and remaining labels **in that section**, plus hint to `click_save(..., section=…)`.

---

## 2. Empty-act budget (decision D)

### 2.1 Formula

In `resolve_phase_max_steps`:

1. Base from `estimated_steps + BUFFER(2)` or effort bucket (existing).
2. Apply `_SUBMIT_STEPS_FLOOR` (8) when `submit.required`.
3. Add `_EMPTY_ACT_BUFFER` (**default 3**).
4. `min(ceiling, result)`; floor remains existing minimums.

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

### 3.3 Prescription (no step-count change)

On empty effective action:

1. Increment `store['_empty_act_streak']` (reset to 0 on any non-empty effective action).
2. Inject `HumanMessage` via existing `_message_manager._add_message_with_tokens` (same pattern as submit-ready / cycle recovery):
   - Prefer recovery from contract / `resolve_phase_section`: e.g.  
     `NEXT_ACTION: click_save(button_text='保存', section='…')` when submit required and section known;
     else generic: return one concrete tool call JSON (click_save / run_form_assistant / get_pending_tasks with section if known).
   - Explicit: **do not** output empty actions; **do not** call `done` until success token / silent-save ok.
3. Log: `[recorder] Injected empty-act cue (streak=N)`.
4. **Do not** set `agent.state.stopped` on empty-act alone (budget D absorbs repeats; avoid fighting browser-use mid-step). Optional later: stop if streak ≥ K — **out of scope** unless we revisit.

### 3.4 Clear streak

Phase start / successful non-empty tool / successful save token → clear `_empty_act_streak`.

---

## 4. Rescan buttons before auto-section (decision A)

When `click_save` is called with empty `section` parameter:

1. `refresh_scan_buttons(page)` — reuse existing form-scan **buttons** extraction (same source as `_scan_buttons_from_result`), write `store['_scan_buttons']`.
2. `unique_button_section(_scan_buttons, compact_btn)` → maybe set `sec`.
3. Continue gate + `JS_CLICK_SAVE_BUTTON` with **`sec`** (already fixed).

If caller passed explicit `section=`, skip forced rescan (trust caller).

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
| Empty buffer | `submit.required` + `estimated_steps=4` → chosen ≥ `8+3` within ceiling |
| Empty-act cue | Source/behavior: empty effective action → inject message containing `NEXT_ACTION` / click_save; streak counter present |
| Rescan | `click_save` path without section calls refresh before `unique_button_section` |
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
| Empty buffer lengthens runaway phases | Still capped by control-plane ceiling; buffer default 3 |
| NL infer binds wrong section | Unique-match only; else full table |
| Rescan every naked `click_save` costs latency | Buttons-only / existing scan path; skip when section explicit |
| Empty-act cue fights last-step done-only | Cue text allows `done` only after save success; buffer reduces starving save |
| Prescription spam | Streak in log; message short; reset on real action |

---

## 9. Success criteria

- Section-scoped phase can `done` after silent/toast save without foreign-section pending rejection.
- `chosen` reflects empty buffer in logs for submit phases.
- Empty `act={}` steps get an immediate NEXT_ACTION cue instead of silent burn-only.
- Naked `click_save` auto-section uses freshly scanned buttons.
- Operators see `QUALITY FAIL` when success token missing; SPA/`phase_end` carries `quality_failed`.
