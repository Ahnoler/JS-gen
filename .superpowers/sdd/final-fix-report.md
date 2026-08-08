# Final Fix Report — Phase Reviewer + Form Assistant

**Branch:** `V2.1_dev`  
**Date:** 2026-08-06

## Important findings addressed

| # | Area | Fix |
|---|------|-----|
| 1 | Phase hygiene on LLM apply | `_clear_phase_form_state` in `apply_phase_contract` clears `_query_ui`/`_query_ready`/`_submit_ready` always; clears `task_list`/`_scan_fields`/`_autofill_summary`/container maps when mode or mapped `task_mode` is non-maintain |
| 2 | Safe bool coerce | `coerce_bool()` in `_phase_reviewer.py`; used in `normalize_reviewer_payload` and `contract_allows_form_assistant` |
| 3 | prior_outcome fidelity | `phase_done` emits `success`+`text` from `_phase_outcomes`; `merge_prior_outcome` prefers richer local text over truncated control-plane echo in `format_phase_preamble` |
| 4 | rules fallback mode=navigate | `boundary_to_legacy_intent` sets `mode='navigate'` for `role=='navigate'` |
| 5 | stale clear without rescan | `_ensure_scanned` runs scan-only `_rebuild_task_list_from_dom(autofill=False)` on stale container when `allow_autofill=False` |

## Files changed

- `scripts/actions/_phase_intent.py`
- `scripts/actions/_phase_reviewer.py`
- `scripts/actions/_phase_boundary.py`
- `scripts/actions/_phase_context.py`
- `scripts/actions/_form.py`
- `scripts/session_runner.py`
- `scripts/characterization/characterize-phase-intent.py`
- `scripts/characterization/characterize-phase-boundary.py`
- `scripts/characterization/characterize-phase-reviewer.py`
- `scripts/characterization/characterize-phase-reviewer-flow.py`
- `scripts/characterization/characterize-form-assistant.py`

## Verification (full output)

```
$ python scripts/characterization/characterize-phase-intent.py
characterize-phase-intent: OK

$ python scripts/characterization/characterize-phase-boundary.py
characterize-phase-boundary: OK

$ python scripts/characterization/characterize-phase-reviewer.py
PASS characterize-phase-reviewer

$ python scripts/characterization/characterize-phase-reviewer-flow.py
PASS characterize-phase-reviewer-flow

$ python scripts/characterization/characterize-case-data.py
INFO     [telemetry] Anonymized telemetry enabled. See https://docs.browser-use.com/development/telemetry for more information.
characterize-case-data: OK

$ python scripts/characterization/characterize-form-assistant.py
characterize-form-assistant: OK

$ python scripts/characterization/characterize-form-rules.py
ok: characterization form_rules
```

**Result:** 7/7 PASS

---

## Batch draft mode — final review fixes (2026-08-07)

| # | Area | Fix |
|---|------|-----|
| 1 | JS-gen CHANGELOG | Consolidated `[Unreleased]` entry for `mode=record|draft` (400/503, request_hash, drafted lifecycle, cancel/summary/WS mode, pumpDraft/pumpRecord); removed duplicate pumpDraft-only Changed entry |
| 2 | Vue job status copy | `statusText(status, mode?)` — draft jobs show「建草稿中」for `accepted`/`running`; record keeps「录制中」 |
| 3 | Characterization | Assert `pumpRecord` source includes `jobModes: ['record']` |

### Commits

- **JS-gen** (`V2.1_dev`): `fec9fa2` — `docs(batch): consolidate draft mode CHANGELOG and pumpRecord assert`
- **Vue** (`dev`): `57fe826` — `fix(batch): mode-aware job status text for draft imports`

### Verification

```
$ node scripts/characterization/characterize-batch-import.mjs

=== characterize-batch-import ===

  ✓ template round-trip
  ✓ empty skip + partial reject
  ✓ bad header rejected
  ✓ max rows enforced
  ✓ request hash stable + mode-sensitive
  ✓ job terminal derivation
  ✓ draft pump reclaims analyzed orphans

All passed.

$ npx vue-tsc --noEmit
(exit 0, no errors)
```

**Result:** 2/2 PASS

---

## err-section-required behavioral gate (2026-08-08)

| # | Area | Fix |
|---|------|-----|
| 1 | `_section_scope.py` | Extract `requires_section_declaration(tl)` — `len(pending_by_section(tl)) >= 2` |
| 2 | `_form.py` `click_save` | Call helper instead of inlined `len(by) >= 2` (no behavior change) |
| 3 | Characterization | `test_err_section_required_trigger_condition` — multi-section TaskList, `requires_section_declaration`, `filter_pending_labels` scoped/unscoped |

### Commit

- **JS-gen** (`V2.1_dev`): `575a01a` — `test: behavioral err-section-required section gate`

### Verification

```
$ python scripts/characterization/characterize-phase-section-scope.py
INFO     [telemetry] Anonymized telemetry enabled. See https://docs.browser-use.com/development/telemetry for more information.
characterize-phase-section-scope: OK
```

**Result:** 1/1 PASS (10 tests incl. new behavioral gate)

---

## Final branch review fixes — empty-act non-submit + submit-ready section (2026-08-08)

**Base:** `70ab8e58b9fa46834e8e140c505714dbe155309a`  
**Branch:** `V2.1_dev`

### Status

**PASS**

### Fixes

| # | Area | Fix |
|---|------|-----|
| 1 | `empty_act_prescription_message` | `_phase_submit_not_required()` — query/navigate/login modes or `submit.required=false` → `done(success=true)` instead of `click_save` |
| 2 | `_submit_ready_hint` | When `sec` empty: `resolve_phase_section` before `unique_button_section` |
| 3 | `recorder` last_step | `n_steps >= _phase_max_steps` + optional `agent.state.is_last_step` flag; comment cites design §3.3 |
| 4 | CHANGELOG | Removed `characterize-phase-section-scope.py` from phase-runtime-hardening file list (not in `5aadb6d..70ab8e5` diff) |

### Commit

`d881379b893bc79297aab0d2c08b627074e0aa19` — `fix: empty-act non-submit cue and submit-ready section resolve`

### Verification

```
$ python scripts/characterization/characterize-phase-runtime.py
PASS characterize-phase-runtime

$ python scripts/characterization/characterize-phase-reviewer.py
PASS characterize-phase-reviewer

$ python scripts/characterization/characterize-phase-section-scope.py
characterize-phase-section-scope: OK
```

**Result:** 3/3 PASS

### Concerns

- Non-submit empty-act message still mentions `Do NOT click_save()` in prose (test asserts `NEXT_ACTION: click_save` absent, not substring `click_save`).
- `is_last_step` on `agent.state` is best-effort; primary signal remains `n_steps >= _phase_max_steps`.
- Store without `_phase_intent` still falls through to scoped `click_save` (unchanged legacy path).
