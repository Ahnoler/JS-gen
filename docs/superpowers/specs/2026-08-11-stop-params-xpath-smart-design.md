# Stop persisting params.xpath_smart — Design

**Status:** Implemented  
**Date:** 2026-08-11  
**Approach:** 3 — stop writing at record sites + strip at `_record_action` persist choke point  
**Depends on:** Element-first replay (`_resolve_replay_xpath` ignores params) already landed in working tree  
**Supersedes (partially):** Unify-relative-xpath goals “params === element” and “replay stays params-first” — replaced by **params omit xpath; element is sole persisted locator**

## Problem

`params_json.xpath_smart` was a second, agent/resolve-sourced copy of the locator. It diverges from `element_json.xpath_smart` in durable ways (e.g. traj 130 step 23: label 名称, params pointed at 编号). Stamp/weak gates and ops repair only catch some classes of bad params. Dual-write is the root of replay mis-targeting under params-first.

Product decision: **new recordings must not persist `params.xpath_smart`**. Replay and any consumer that needs a xpath must use `element.xpath_smart`.

## Goals

1. **New form (and related) steps:** `params_json` has no `xpath_smart` key (or never a non-empty value — prefer **omit key**).
2. **Replay locate:** Only `element.xpath_smart` → label/semantic → `element.xpath_full` (params xpath unused). Already done; keep and characterize.
3. **Other consumers:** Every reader of step `params.xpath_smart` for locate/readback/audit/wet switches to `element.xpath_smart` (`_element_xpath_smart`); delete `_params_xpath_smart`. Batch push / assemble already element — verify only.
4. **Defense in depth:** Record call sites stop putting xpath in params **and** `scripts/state.py` `_record_action` strips `xpath_smart` from params before append/persist.
5. **Keep:** Agent tool argument `xpath_smart` (runtime inventory lookup only); scan/`task_list` inventory `xpath_smart`; `element_json.xpath_smart` as sole persisted write locator.

## Non-goals

- Removing agent tool schema `xpath_smart`.
- Forced DB migration wiping historical `params.xpath_smart` (optional ops only).
- Changing how inventory scan builds xpath.
- Reverting element-first replay.

## Contract

| Store | `xpath_smart` |
|-------|----------------|
| `element_json` | **Required authority** for replay/assemble when relative primary is on |
| `params_json` | **Must not** carry `xpath_smart` on new records |
| Agent tool arg | Runtime lookup only — never copied into params |
| `_scan_fields` / task_list | Unchanged (resolve inventory) |

Historical steps may still have `params.xpath_smart`; readers must ignore it for locate.

## Approach detail (3)

### A. Stop writing at sources

- `scripts/controller/actions/_form.py`: all `_record_action(..., {..., 'xpath_smart': xp_out})` → drop `xpath_smart` from params dict. Keep writing xpath into `element` via `_capture_element` / existing element payload. `_task_done_impl(..., xpath_smart=)` may still update inventory done items (not params_json) — leave unless it mutates params.
- `scripts/manual_recorder/mapper.py`: remove params stamp of `xpath_smart`; element snap keeps smart.
- Autofill / select / radio / tree fallback record paths: same as form.
- Drop or narrow `stamp_recorded_xpath_smart` usage for **params** purpose; helper may remain for tests or be reduced to “prefer capture for element only” — no params stamp.

### B. Choke-point strip

- In `_record_action` (canonical append path used by AI + manual): if `params` is a dict, `params = {k: v for k, v in params.items() if k != 'xpath_smart'}` (or pop copy) before log/persist.
- Ensures any missed call site cannot reintroduce the field.

### C. Consumers → element

- Replay / wet / audit: use `_element_xpath_smart` only; **delete** `_params_xpath_smart`.
- `scripts/codegen` / assembler / batch push (`pickExportTarget`): already element — verify.
- Repair: strip leftover `params.xpath_smart` keys (do not copy element into params).

### D. Characterization

- Assert new record params lack `xpath_smart` (source +/or unit around `_record_action`).
- Assert `_resolve_replay_xpath` ignores params (traj 130 style case).
- Manual dialog scope: params must **not** equal-stamp xpath; element still scoped.
- Capture/stamp tests: retarget to “element has durable xpath; params omit xpath_smart”.

## Out of scope files (unless needed for consumer switch)

- `src/cdp/page-locator-helpers.js` algorithm body (unchanged).
- Python FastAPI control-plane sync: scripts-only → no CHANGELOG unless a Node product API documents `params.xpath_smart` as required (check `/api/docs`; if catalog mentions it, update docs only).

## Risks

| Risk | Mitigation |
|------|------------|
| Downstream UI still shows params xpath | Point UI to element; empty params field OK |
| Old traj still has dirty params | Element-first replay ignores them |
| `_task_done_impl` / export confuse inventory xpath with params | Keep inventory separate; params omit |
| Strip hides bugs at call sites | Characterization fails if call sites still pass xpath **before** strip if we assert on pre-strip — assert on recorded payload after `_record_action` |

## Success criteria

1. New AI/manual form fill/select/radio/date steps: `params_json` has no `xpath_smart`.
2. `element_json.xpath_smart` still durable dialog/drawer+label (or legitimate no-label cases).
3. Replay traj 130 phase 4 step 23 writes 名称 into 名称 field without DB repair.
4. M1/M2 characterization suites green with updated expectations.
5. `_record_action` strip covered by a focused characterization.

## Implementation note

Prefer TDD: failing “params must omit xpath_smart” characterization, then stop-write + strip, then consumer/test updates. No push unless asked.
