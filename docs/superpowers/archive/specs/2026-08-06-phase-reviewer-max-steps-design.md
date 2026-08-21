# Phase Reviewer Effort → max_steps — Design

**Date:** 2026-08-06  
**Status:** Spec approved 2026-08-06 — implementation plan next  
**Related:** Phase reviewer + form assistant (`2026-08-06-phase-reviewer-form-assistant-design.md`); overlay hard-gate soft-demotion is **out of scope** (separate topic)

---

## 1. Problem

Control plane sends a fixed `max_steps` per recording step (often 30, login 10). Short single-step phases (open menu, click +新增, select one field) do not need that budget. Excess steps enable empty loops / thrashing after soft failures.

The Phase Reviewer already runs once per phase before the Agent. It should also estimate **how long this phase is** and tighten `max_steps` under the control-plane ceiling.

---

## 2. Goals & Non-Goals

### Goals

- Reviewer emits `brief_plan` (2–4 bullets) plus effort as **bucket and/or integer**.
- Runtime sets `agent.run(max_steps=chosen)` where `chosen ≤ ceiling` from instruction.
- Observable: log `ceiling`, `chosen`, effort source, plan summary.
- Inject `brief_plan` into Agent contract hint so execution aligns with the plan.

### Non-Goals

- Softening recorder hard gates (overlay / token / pending) — **separate design**.
- Changing control-plane default ceilings (30/10 remain the upper bound).
- Second LLM call only for effort estimation.
- Raising `max_steps` above the control-plane value.

### Locked decisions

| Decision | Choice |
|----------|--------|
| Authority | Control plane = **ceiling**; reviewer may only **lower** |
| Output shape | **Hybrid:** required `brief_plan`; `effort` bucket **or** `estimated_steps` (or both; int wins) |
| Bucket map | `short→5`, `medium→15`, `long→30` |
| Scope this round | max_steps only |

---

## 3. Contract fields

Extend Phase Reviewer JSON (existing keys unchanged):

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `brief_plan` | `string[]` | yes (soft) | 2–4 items preferred; if missing, synthesize `[goal]` so contract is not discarded |
| `effort` | `short` \| `medium` \| `long` | one of effort / estimated_steps | Bucket |
| `estimated_steps` | positive int | one of effort / estimated_steps | If both present, **integer path wins** |

---

## 4. Normalization algorithm

```
ceiling = int(instruction.max_steps) or default (existing session_runner behavior)
FLOOR = 3
BUFFER = 1

if estimated_steps is int and estimated_steps > 0:
    raw = estimated_steps + BUFFER
elif effort == "short":
    raw = 5
elif effort == "medium":
    raw = 15
elif effort == "long":
    raw = 30
else:
    raw = ceiling   # no effort signal → do not lower

chosen = min(ceiling, max(FLOOR, raw))
```

Examples:

| ceiling | effort / steps | chosen |
|---------|----------------|--------|
| 30 | short | 5 |
| 30 | medium | 15 |
| 30 | long | 30 |
| 10 (login) | short | 5 |
| 10 | long | 10 (clamped) |
| 30 | estimated_steps=2 | 3 (2+1, then floor) |
| 30 | estimated_steps=4 | 5 |
| 30 | missing both | 30 |

Implement as pure function `resolve_phase_max_steps(ceiling, contract) -> int` in `_phase_reviewer.py` (or small helper next to it) for characterization.

---

## 5. Runtime wiring

```
instruction.max_steps → ceiling
review_phase_contract → normalize (incl. brief_plan / effort / estimated_steps)
  → existing sanitize_contract_for_mode (login/nav/query)
  → apply_phase_contract
  → chosen = resolve_phase_max_steps(ceiling, contract)
  → agent.run(max_steps=chosen)
```

On reviewer **failure** / no contract: `chosen = ceiling` (unchanged today).

Logging (extend existing contract debug line or adjacent):

```
[session] max_steps ceiling=30 chosen=5 effort=short estimated_steps=None plan_n=3
```

`contract_summary_hint`: append `【阶段计划】` bullets from `brief_plan` (truncated).

`phase_intent_obs`: include `brief_plan`, `effort`, `estimated_steps`, `max_steps_ceiling`, `max_steps_chosen` when present.

---

## 6. Prompt changes

`scripts/prompts/phase-reviewer-prompt.md`:

- Require `brief_plan` (2–4 steps for **this phase only**).
- Guidance: open-page / single click / single field → `short` or low `estimated_steps`; multi-field / full form → `medium`/`long`.
- Forbid putting later-phase work into `brief_plan`.
- Document that runtime clamps to control-plane ceiling.

---

## 7. Failure / edge cases

| Case | Behavior |
|------|----------|
| Reviewer fail | ceiling unchanged |
| Contract OK, no effort/steps | ceiling unchanged |
| `brief_plan` missing | keep contract; `brief_plan = [goal]` or `["完成本阶段任务"]` |
| Invalid effort string | ignore; fall through to estimated_steps or ceiling |
| `estimated_steps` ≤ 0 / non-int | ignore |
| Heal mode | no reviewer (existing); keep instruction max_steps |

No mode-based secondary fallback this round (YAGNI); can add later if missing-effort is common.

---

## 8. Success criteria

1. Navigate “进入对公客户管理” / “点+新增” typically get `chosen=5` when reviewer returns `short` (and ceiling ≥ 5).
2. Login with ceiling 10 never exceeds 10.
3. Stderr shows ceiling + chosen.
4. Characterization covers: buckets, int+buffer, clamp to ceiling, floor, missing effort → ceiling, brief_plan backfill.
5. Hard-gate / overlay behavior **unchanged** by this work.

---

## 9. Touchpoints

- `scripts/actions/_phase_reviewer.py` — normalize fields + `resolve_phase_max_steps`
- `scripts/prompts/phase-reviewer-prompt.md`
- `scripts/session_runner.py` — apply chosen max_steps + log
- `scripts/actions/_phase_intent.py` — `contract_summary_hint` plan bullets (optional small)
- `scripts/characterization/characterize-phase-reviewer.py` — resolve tests
- No CHANGELOG required if scripts-only (per AGENTS.md); if obs payload is documented in api-docs later, optional

---

## 10. Spec self-review

- [x] No TBD left unexplained
- [x] Consistent with locked decisions (ceiling, hybrid, 5/15/30, max_steps-only scope)
- [x] Soft gates explicitly out of scope
- [x] Ambiguity resolved: int wins over bucket; missing effort → ceiling; missing plan → backfill not discard
