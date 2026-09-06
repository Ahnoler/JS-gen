# Phase Reviewer + Explicit Form Assistant — Design

**Date:** 2026-08-06  
**Status:** Spec approved 2026-08-06 — implementation plan next  
**Related incident:** AI recording overreach — navigation phase classified as `form_modify` + implicit full-form autofill (e.g.「进入对公客户管理页面」→ 选行 → 修改 → 全表填)

---

## 1. Problem

1. **Classification misjudgment:** Rule-based `classify_task_mode` / `phase_boundary` can label open-page / navigate tasks as `form_modify` + `requires_write_all_editable`, so recording hints and autofill gates treat the phase as form maintain.
2. **Implicit form assistant:** First `fill_form_field` / `select_`* on a maintain surface triggers `_ensure_scanned` full-form autofill, so a single overreach click can pull the entire later-phase form work into the current phase.
3. **Missing global phase view:** Control plane only injects `prior_phases` (0–2 previous). The execution Agent lacks a catalog of the full recording plan, which encourages completing later phases early.
4. **Split authority:** `_task_mode`, `_phase_boundary`, and `_phase_intent` are written by separate rule paths and can disagree after any partial fix.

---



## 2. Goals & Non-Goals



### Goals

- Per-phase **LLM Phase Reviewer** that sees business scenario summary + **full phase list** + current phase, and emits an execution contract.
- LLM contract is **sole authority** on success: rewrite `_task_mode`, `_force_refill_all`, `_phase_boundary`, `_phase_intent` together.
- Rules remain **fallback** when LLM fails/times out/returns invalid JSON; **also fix** open-page priority in rules so fallback does not repeat the same misjudgment.
- Remove implicit full-form autofill; batch fill only via explicit `run_form_assistant`, hard-gated by `allow_form_assistant`.
- Redesign Browser Use Agent prompts around the contract + short phase catalog.
- Control plane ships `all_phases` for the reviewer (and short-catalog derivation for the Agent).



### Non-Goals (this round)

- Hard-blocking out-of-scope clicks (e.g.「修改」on navigate) — soft prompt/contract only.
- Hard-requiring `run_form_assistant` before save/done when `refill=all_editable`.
- Injecting **full phase body text** into the execution Agent (short catalog only).
- Continuous mid-phase re-review beyond the existing interval planner (planner gets a light “respect contract” tweak only).
- Product SPA / public API redesign beyond the recording instruction payload + CHANGELOG for control-plane fields.



### Deferred TODOs (validate after this round)


| ID      | Item                                                                                                                     |
| ------- | ------------------------------------------------------------------------------------------------------------------------ |
| TODO-B1 | If soft guidance is insufficient: **require** `run_form_assistant` before `click_save`/`done` when `refill=all_editable` |
| TODO-B2 | If navigate overreach persists: hard-reject clicks matching 修改/编辑/维护 under `mode=navigate` / forbid list                 |
| TODO-B3 | Experiment: inject **full phase bodies** into the execution Agent (compare vs short catalog)                             |


---



## 3. Architecture

```
phase_start (control plane)
  → instruction includes: current task, all_phases[], prior_outcome (one line), fact_pack?, …
  → Python session_runner:
       clear old contract
       Phase Reviewer LLM (all_phases full text + scenario + current)
         success → normalize → write ALL of:
              _phase_boundary, _phase_intent, _task_mode, _force_refill_all
              (+ allow_form_assistant, goal, in/out_of_scope, done_when, source=llm)
         fail → rules compile (open-page-fixed) → same writes, source=rules_fallback
       build Agent task text:
              short catalog (all phases: number + title)
              prior = one-line previous phase outcome/status (no prior full text)
              contract summary (mode, allow_form_assistant, goal, out_of_scope, done_when)
              current phase body (+ 业务数据 only if contract needs writes)
       Browser Use Agent executes
         run_form_assistant → hard check allow_form_assistant
         fill/select single field → NEVER triggers full-form scan
```

**Feature flag:** `AI_PHASE_REVIEWER` (default **on**). When off, behavior = rules-only path (with open-page fix still applied).

**Heal mode:** unchanged — skip reviewer / phase intent (same as today).

---



## 4. Contract Schema

LLM (and rules fallback after mapping) must produce a JSON object that can populate both boundary and legacy intent. Canonical fields:


| Field                  | Type     | Meaning                                                                           |
| ---------------------- | -------- | --------------------------------------------------------------------------------- |
| `mode`                 | enum     | `navigate` | `create` | `modify` | `query` | `introduce_pick` | `login` | `other` |
| `allow_form_assistant` | bool     | Whether `run_form_assistant` is allowed                                           |
| `refill`               | enum     | `none` | `touched` | `all_editable`                                               |
| `goal`                 | string   | One-line direction for this phase                                                 |
| `in_scope`             | string[] | Allowed high-level actions                                                        |
| `out_of_scope`         | string[] | Forbidden (esp. later-phase work)                                                 |
| `done_when`            | string   | Completion condition in natural language                                          |
| `submit`               | object   | Existing submit shape when maintain (`required`, `via`, `button_text`)            |
| `success`              | object   | Existing success evidence kinds when applicable                                   |
| `source`               | enum     | `llm` | `rules_fallback`                                                          |




### Mapping to existing stores

On apply (LLM or fallback):

- `_phase_intent` ← full contract (plus existing `forbid` / `recovery` defaults where still useful)
- `_phase_boundary` ← derived: `role` from `mode` (`navigate`→navigate, `create`/`modify`→maintain, …); `requires_write_all_editable` ⇔ `refill=all_editable`; goals/success_when adapted from contract
- `_task_mode` ← `create`→`form_fill`, `modify`→`form_modify`, `navigate`/`other`→`other`, etc.
- `_force_refill_all` ← `refill=all_editable`

Observation events (`phase_intent_obs` / `phase_boundary_obs`) include `source` and `allow_form_assistant`.

### Reviewer input / output rules (prompt)

- Input: scenario summary, **all phases with full descriptions**, current phase id/number, optional business-data presence flag (not necessarily values for every phase).
- Prefer `navigate` + `allow_form_assistant=false` + `refill=none` for「进入/打开…页面」style goals.
- Later phases’ work must appear in `out_of_scope` for the current phase.
- Output: JSON only; invalid → fallback.

---



## 5. Form Assistant Changes


| Before                                                          | After                                                |
| --------------------------------------------------------------- | ---------------------------------------------------- |
| First fill/select on main/drawer → `_ensure_scanned` autofill   | **Removed**                                          |
| `fill_form_fields_batch` removed; docs say use implicit trigger | **Add** `run_form_assistant` as the only batch entry |
| `scan_form_fields` scan-only                                    | Unchanged (still no fill)                            |




### `run_form_assistant`

1. If `allow_form_assistant` is false → return explicit error (do not scan/fill).
2. Else scan visible form → fill per `refill` + authoritative business-data / fact pack values.
3. Return summary (`done` / `pending`) + suggested next step (usually `click_save` or “edit named fields”).



### Single-field actions

- Never call full-form `_ensure_scanned` autofill.
- Remain available even when `allow_form_assistant=false` (**soft** out_of_scope only).



### Soft vs hard gates (this round)


| Gate                            | Enforcement        |
| ------------------------------- | ------------------ |
| Batch assistant when disallowed | **Hard**           |
| Single-field writes on navigate | **Soft**           |
| Click 修改/编辑 on navigate         | **Soft**           |
| Must call assistant before save | **Soft** (TODO-B1) |


---



## 6. Prompt Changes


| File                                               | Change                                                                                                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **New** `scripts/prompts/phase-reviewer-prompt.md` | Reviewer system prompt + JSON schema instructions                                                                                            |
| `scripts/prompts/agent-prompt.md`                  | Remove “first fill/select triggers autofill”; document `run_form_assistant`; inject contract + short catalog semantics; stage boundary rules |
| `scripts/prompts/planner-prompt.md`                | Light: respect phase contract; do not advise out_of_scope / later-phase work                                                                 |
| Related field/form prompt fragments                | Align wording if they still mention implicit autofill                                                                                        |


---



## 7. Control Plane & Preamble



### `all_phases`

- `src/services/trajectory-record-lifecycle.js` (and any session instruction builder) adds `all_phases`: for each phase in the **current recording set** (respects `phaseIds` filter): `{ id, phaseNumber, title, description }` (full text for reviewer).
- **CHANGELOG** `[Unreleased]` entry required (affects `src/services/` + Python sync hint: consume `all_phases` in session step instruction).



### Execution Agent preamble

1. **Short catalog:** all phases as `N. <title>` (no long description this round; TODO-B3 for full bodies).
2. **Prior:** only previous phase **one-line outcome/status** (replace prior full-text dump).
3. **Contract block:** mode, allow_form_assistant, goal, out_of_scope, done_when.
4. **Current task body** (+ 【业务数据】 only when final contract indicates write/introduce needs — `needs_business_data_context` must use **final contract**, not pre-LLM `classify_task_mode`).

Reviewer uses full `all_phases` descriptions; Agent does not (this round).

---



## 8. Rules Fallback Fix

In `_phase_context` / `_phase_boundary` (and any duplicate classifiers):

- Detect open-page / 「进入…页面」/ expected-result-is-open **before** or **instead of** treating incidental「修改」as `form_modify` when the phase goal is navigation-only.
- Ensure `compile_boundary` can reach `role=navigate` for those texts even when old `classify_task_mode` would have returned `form_modify`.
- Characterization tests:「进入对公客户管理页面」→ navigate / no force refill / `allow_form_assistant` equivalent false.

---



## 9. Success Criteria

1. Phase「进入对公客户管理页面」→ contract `mode=navigate`, `allow_form_assistant=false`, `refill=none` on LLM path; rules fallback also navigate for the same wording.
2. That phase’s logs show **no** `_ensure_scanned` / `auto-fill-complete`; Agent reaches list page and `done` without opening maintain dialog **under normal prompt compliance** (soft; residual risk accepted).
3. True create / modify-all phases: batch fill appears **only after** `run_form_assistant`.
4. Single `fill_form_field` never produces full-form scan logs.
5. Reviewer timeout/invalid JSON → `source=rules_fallback`, recording continues.
6. Agent task includes short catalog of all recording phases; prior is one line only.
7. Characterization / smoke covering classifier fix + no implicit autofill + assistant hard gate updated and green.

---



## 10. Risks & Mitigations


| Risk                                      | Mitigation                                              |
| ----------------------------------------- | ------------------------------------------------------- |
| Extra LLM latency per phase               | Short structured prompt; hard timeout → rules fallback  |
| LLM still mis-labels navigate             | Prompt rules + log `source`; rules fallback also fixed  |
| Agent ignores soft out_of_scope           | Contract in preamble + planner tweak; TODO-B2 if needed |
| Agent never calls assistant on long forms | Prompt strong suggest; TODO-B1 if quality drops         |
| Triple-store drift                        | Single apply function writes all four fields atomically |


---



## 11. Conflict Resolutions (locked)

1. LLM success → sole authority; rewrite task_mode + force_refill + boundary + intent.
2. Hard-block batch only; single-field soft.
3. Soft-suggest `run_form_assistant`; mandatory path is TODO-B1.
4. Fix rules open-page priority in the same round.
5. Soft only for overreach clicks; hard-block is TODO-B2.
6. Control plane ships `all_phases` (CHANGELOG).
7. Agent gets short catalog first; full bodies TODO-B3.
8. Prior → one-line outcome; catalog owns global view.

---



## 12. Implementation Touchpoints (indicative)

- `scripts/actions/_phase_intent.py`, `_phase_boundary.py`, `_phase_context.py` — apply/reviewer wiring, classifier fix
- New: `scripts/actions/_phase_reviewer.py` (or similar) + `scripts/prompts/phase-reviewer-prompt.md`
- `scripts/session_runner.py` — call reviewer; preamble assembly
- `scripts/actions/_form.py` — remove implicit `_ensure_scanned` autofill path; add `run_form_assistant`
- `scripts/controller.py` / action registration — expose new action
- `scripts/prompts/agent-prompt.md`, `planner-prompt.md`
- `src/services/trajectory-record-lifecycle.js` — `all_phases` (+ prior outcome field if needed)
- `CHANGELOG.md` — Unreleased
- Characterization: phase-intent/boundary/case-data/form; ctrl parity if new CTRL surface (unlikely — Python action)

---



## 13. Spec Self-Review

- [x] No TBD/TODO placeholders left unexplained (deferred items listed as TODO-B1..B3)
- [x] No contradiction with locked conflict table
- [x] Scope matches approved approach 2 + conflict answers
- [x] `needs_business_data_context` / preamble / triple-write called out explicitly

)