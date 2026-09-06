# 报文捞取 MVP — Rename JS/Python References (Tasks 3-6)

> Continuation of 2026-08-25-message-capture-mvp.md. Tasks 1-2 are in that file.

## Task 3: Rename JS trajectory/memory/routes/model references

Files to modify:
- src/services/trajectory/trajectory-record-lifecycle.js
- src/services/trajectory/trajectory-recording-runner.js
- src/services/trajectory/trajectory-text-extract.js
- src/services/trajectory/trajectory-meta-service.js
- src/services/trajectory/trajectory-query-service.js
- src/services/trajectory/trajectory-runtime.js
- src/services/trajectory/form-snapshot-append.js
- src/memory/memory-service.js
- src/memory/protocol.js
- src/routes/v2/trajectory.js
- src/models/entities.js
- src/models/meta-step-actions.js
- src/executor-session-client.js
- executor/session-handler.js
- src/services/legacy-engine-export.js
- src/dao/form-snapshot-dao.js
- src/routes/browser-session/register.js
- src/routes/browser-session/step-execution.js
- src/routes/browser-session/watcher-actions.js
- src/services/system-ref-service.js (comment only)

Produces: prepareBusinessDataInjection(tid) returning {businessDataFile, businessData, businessDataBlock}; BUSINESS_DATA_SECTION_RE (symbol renamed, regex content unchanged); extractBusinessDataBlock; extractBusinessEntriesFromRequirement; appendBusinessDataToPhases; ingestBusinessEntriesAsFacts; transport keys business_data/business_data_file/business_data_block; action names save_business_data/read_business_data

- [ ] Step 1: trajectory-record-lifecycle.js — rename prepareCaseDataInjection to prepareBusinessDataInjection, update all caseData/case_data refs (lines 170-223), update import path to business-data-dao.js, update extractCaseEntriesFromRequirement/extractCaseDataBlock imports to new names, update ingestCaseEntriesAsFacts to ingestBusinessEntriesAsFacts

- [ ] Step 2: trajectory-recording-runner.js — line 21 import prepareBusinessDataInjection; line 299 destructure {businessDataFile, businessData, businessDataBlock}; lines 306-307 use businessDataBlock; lines 422-428 transport keys business_data_block/business_data/business_data_file; CASE_BLOCK_MARK and CASE_BLOCK_MARK_LEGACY stay unchanged

- [ ] Step 3: trajectory-text-extract.js — line 6 import businessDataDao; line 9 CASE_DATA_SECTION_RE to BUSINESS_DATA_SECTION_RE (keep regex content — it matches user input headers); line 10 CASE_DATA_HEADER_INLINE_RE to BUSINESS_DATA_HEADER_INLINE_RE; line 66 extractCaseDataBlock to extractBusinessDataBlock; line 97 extractCaseEntriesFromRequirement to extractBusinessEntriesFromRequirement; line 145 normalizeCaseEntries to normalizeBusinessEntries via businessDataDao; line 153 appendCaseDataToPhases to appendBusinessDataToPhases; update all internal references

- [ ] Step 4: trajectory-meta-service.js — line 8 import businessDataDao; lines 14-17 import new symbol names; lines 20-25 re-export new names; line 63 BUSINESS_DATA_SECTION_RE; line 97 extractBusinessDataBlock; line 145 BUSINESS_DATA_SECTION_RE; line 149 appendBusinessDataToPhases; line 157 extractBusinessEntriesFromRequirement + businessEntries; lines 200-201 params businessEntries/businessData; line 273 businessEntries ?? businessData; line 275 businessDataDao.replaceEntriesForTrajectory; line 309 setTrajectoryCaseEntries to setTrajectoryBusinessEntries; line 322 businessDataDao.replaceEntriesForTrajectory

- [ ] Step 5: trajectory-query-service.js — line 7 import businessDataDao; line 98 businessDataDao.listEntriesByTrajectory + businessEntries; line 149 same

- [ ] Step 6: trajectory-runtime.js — line 120 caseDataFile to businessDataFile

- [ ] Step 7: form-snapshot-append.js — line 236 case_data_id to business_data_id

- [ ] Step 8: memory-service.js — line 478 comment; line 482 ingestCaseEntriesAsFacts to ingestBusinessEntriesAsFacts; line 496 comment; line 512 case_entries to business_entries. protocol.js — lines 27,57 comments

- [ ] Step 9: routes/v2/trajectory.js — line 11 comment; lines 110-111 caseEntries to businessEntries, caseData to businessData; lines 124-125 pass-through; lines 157,160,174,176 PATCH handler; line 191 route to /api/v2/trajectories/:id/business-data; line 193-194 setTrajectoryBusinessEntries; lines 255,257 PUT phases

- [ ] Step 10: models/entities.js — line 226 CaseData to BusinessData; line 242 CaseDataEntry to BusinessDataEntry; line 244 caseDataId to businessDataId

- [ ] Step 11: models/meta-step-actions.js — lines 28-29 save_case_data/read_case_data to save_business_data/read_business_data

- [ ] Step 12: executor-session-client.js — line 145 save_case_data to save_business_data; lines 311-312,322 caseDataFile/caseData/caseDataBlock to businessDataFile/businessData/businessDataBlock with transport key updates

- [ ] Step 13: executor/session-handler.js — lines 73-75 transport keys business_data_file/business_data/business_data_block; line 107-108 session.save_business_data

- [ ] Step 14: legacy-engine-export.js — lines 52-53 save_business_data/read_business_data

- [ ] Step 15: dao/form-snapshot-dao.js — line 34 caseDataId to businessDataId; line 102 listByCaseData to listByBusinessData; line 104 business_data_id

- [ ] Step 16: routes/browser-session/register.js — line 6 import saveBusinessDataRecord from business-data-store.js; line 8 import persistSessionBusinessData from business-data-service.js; lines 31,39,60,87 caseDataFile to businessDataFile; line 131 save_business_data/read_business_data; line 305 business_data_file; line 413 route save-business-data; lines 421,437,443,445,457,483 event names and field names updated

- [ ] Step 17: routes/browser-session/step-execution.js — lines 11,15,93,106,108,115,163 caseDataFile to businessDataFile, transport key business_data_file

- [ ] Step 18: routes/browser-session/watcher-actions.js — lines 177,188 caseDataFile to businessDataFile

- [ ] Step 19: system-ref-service.js — line 6 comment case_data to business_data

- [ ] Step 20: Run verify-all — note failures for Task 5

- [ ] Step 21: Commit — "feat: rename case-data JS references to business-data (trajectory/memory/routes/models)"

---

## Task 4: Rename Python _case_data.py + entity + all Python references

Files to modify/rename:
- Rename: scripts/controller/actions/_case_data.py to _business_data.py
- Rename: scripts/models/entity/case_data_entity.py to business_data_entity.py
- Modify: scripts/models/entity/__init__.py
- Modify: all scripts/controller/actions/*.py (form_autofill, form_save, form_scan_actions, form_action_engines, form_rules, form_scan_utils, autofill_round, task_completion, _form, _replay, _helpers, _misc, _special_element, _table, _scenario_describer, _llm_values)
- Modify: scripts/controller/actions/phase/*.py (boundary_contract, boundary_gates, classify, intent_contract, intent_gates, outcomes, prompts)
- Modify: scripts/state.py, scripts/recorder.py, scripts/session_runner.py
- Modify: scripts/agent/service.py, scripts/agent/recorder_emitters.py
- Modify: scripts/memory/store.py, scripts/event_dispatch.py, scripts/trajectory_store.py
- Modify: scripts/cdp/watcher.py, scripts/codegen/actions.py
- Modify: scripts/models/action.py, scripts/models/form_snapshot.py, scripts/models/task.py

Produces: _business_data.py with lookup_business_value, iter_user_business_entries, format_business_data_hint, _register_business_data_actions, _RESERVED_BUSINESS_KEYS (includes both _business_scenario_text and _case_scenario_text for compat); BusinessDataEntity/BusinessDataEntryEntity; business_data_store param throughout; business_data_ref in agent/service.py; session_state['business_data_store'] key; _business_scenario_text internal key with dual-key fallback

- [ ] Step 1: Rename _case_data.py to _business_data.py. Rename _RESERVED_CASE_KEYS to _RESERVED_BUSINESS_KEYS (add both _business_scenario_text and _case_scenario_text). Rename lookup_case_value to lookup_business_value, iter_user_case_entries to iter_user_business_entries, format_case_data_hint to format_business_data_hint (add dual-key fallback: read _business_scenario_text or _case_scenario_text). Rename _register_case_data_actions to _register_business_data_actions, save_case_data to save_business_data, read_case_data to read_business_data. Rewrite terminology docstring to single concept. Update emit_memory_event calls: case_saved to business_saved, case_read to business_read. All case_data_store params to business_data_store.

- [ ] Step 2: Rename case_data_entity.py to business_data_entity.py. CaseDataEntity to BusinessDataEntity, CaseDataEntryEntity to BusinessDataEntryEntity, case_data_id to business_data_id.

- [ ] Step 3: Update entity/__init__.py imports and __all__ entries.

- [ ] Step 4: Rename all case_data_store to business_data_store across: form_autofill.py (constructor + self.case_data_store), form_save.py, form_scan_actions.py, form_action_engines.py, form_rules.py, form_scan_utils.py, autofill_round.py, task_completion.py, _form.py, _replay.py, _helpers.py, _misc.py, _special_element.py, _table.py, _scenario_describer.py, _llm_values.py (also update import: from ._case_data import to from ._business_data import, iter_user_case_entries to iter_user_business_entries)

- [ ] Step 5: Rename case_data_store to business_data_store in phase/boundary_contract.py, boundary_gates.py, classify.py (keep regex content at line 44 — it matches user input markers), intent_contract.py, intent_gates.py, outcomes.py, prompts.py (line 101: string 案例数据生成新值 to 业务数据生成新值)

- [ ] Step 6: state.py line 31: save_case_data/read_case_data to save_business_data/read_business_data. recorder.py: build_recording_hooks param case_data_store to business_data_store, all internal refs. session_runner.py: _handle_save_case_data import to _handle_save_business_data; _run_cdp_watcher param; build_controller kwarg; session_state key case_data_store to business_data_store; transport keys case_data/case_data_file/case_data_block to business_data/business_data_file/business_data_block (keep caseDataBlock fallback as businessDataBlock); _case_scenario_text to _business_scenario_text; case_data_loaded to business_data_loaded; all local vars

- [ ] Step 7: agent/service.py — case_data_ref to business_data_ref throughout (lines 80-561). Line 253: pop _business_scenario_text with fallback to _case_scenario_text. Line 396: import from _business_data, format_business_data_hint, iter_user_business_entries.

- [ ] Step 8: agent/recorder_emitters.py — all case_data_store params to business_data_store

- [ ] Step 9: memory/store.py — docstrings and __init__ param case_data_store to business_data_store

- [ ] Step 10: event_dispatch.py — _handle_save_case_data to _handle_save_business_data; session_state['case_data_store'] to session_state['business_data_store']; event "save_case_data" to "save_business_data"; allow-list strings

- [ ] Step 11: trajectory_store.py — _handle_save_trajectory param; _handle_save_case_data to _handle_save_business_data; event "save_case_data_result" to "save_business_data_result"; "case_data_file" to "business_data_file"; _handle_reset_trajectory param; keep directory name 'case_data' (cosmetic); clear_phase_outcomes/clear_phase_intent calls updated

- [ ] Step 12: cdp/watcher.py — _build_ctrl param, build_controller kwarg

- [ ] Step 13: codegen/actions.py and models/action.py — action name strings

- [ ] Step 14: models/form_snapshot.py and models/task.py — docstring references

- [ ] Step 15: Run verify-all — expect characterization failures (fixed in Task 5)

- [ ] Step 16: Commit — "feat: rename case-data Python references to business-data (actions/entity/state/session)"

---

## Task 5: Update characterization test pins

Files to modify:
- scripts/characterization/characterize-case-data.py
- scripts/characterization/characterize-confirm-notification.py
- scripts/characterization/characterize-heal-mode.py
- scripts/characterization/characterize-scan-editable-summary.py
- scripts/characterization/characterize-budget-extend.py
- scripts/characterization/characterize-phase-boundary.py
- scripts/characterization/characterize-analyze-case-data.mjs

- [ ] Step 1: characterize-case-data.py — lines 19-23 import from _business_data, new function names; line 86 read _business_data.py; lines 87-94 keep (apply_case_presets_to_fields absence checks unchanged); lines 79,107 keep (业务数据 in hint); lines 118-119 remove assertion about 非系统回写 (distinction eliminated); line 271 keep

- [ ] Step 2: characterize-confirm-notification.py — line 37: case_data_store to business_data_store in pinned substring

- [ ] Step 3: characterize-heal-mode.py — lines 136-138: case_data_ref to business_data_ref in pinned substring

- [ ] Step 4: characterize-scan-editable-summary.py — lines 73-75: case_data_store to business_data_store; lines 78-80: same for _scan_fields

- [ ] Step 5: characterize-budget-extend.py — lines 52-65: case_data local var to business_data (only if make_done_callback param was renamed)

- [ ] Step 6: characterize-phase-boundary.py — lines 152-156: case_data_store= to business_data_store= kwarg; line 194: update inline literal to match new hint text (remove 非系统回写案例数据 phrase)

- [ ] Step 7: characterize-analyze-case-data.mjs — line 32 keep (user input with 案例数据 header, regex still matches); update imports of extractCaseDataBlock/extractCaseEntriesFromRequirement to new names

- [ ] Step 8: Run verify-all — MUST be ALL GREEN

- [ ] Step 9: Commit — "test: update characterization pins for case-data to business-data rename"

---

## Task 6: Update API docs and CHANGELOG for rename

Files to modify:
- src/dashboard/api-docs/groups/recording.js
- src/dashboard/api-docs/groups/memory.js
- src/dashboard/api-docs/groups/trajectory.js
- CHANGELOG.md

- [ ] Step 1: recording.js line 53 — 案例数据 to 业务数据

- [ ] Step 2: memory.js — line 10 id case-data to business-data; line 11 name; line 13 table names; line 14 redirect info; lines 17,29,34,39 paths; line 50; line 142 case_saved to business_saved

- [ ] Step 3: trajectory.js — line 17 comment; lines 33-34,36 remove 非系统回写案例数据; lines 38,72,79,88,94,99,101,104,112-114,118-119,123,134,141,175,183 caseEntries to businessEntries, 案例数据 to 业务数据, case_data_entry to business_data_entry; line 112 path; line 113 summary

- [ ] Step 4: CHANGELOG.md — add [Unreleased] Changed entry for rename with Python sync note

- [ ] Step 5: Run verify-all — ALL GREEN

- [ ] Step 6: Commit — "docs: update api-docs and CHANGELOG for case-data to business-data rename"
