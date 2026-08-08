"""Facade — _phase_intent.py split into scripts.controller.actions.phase.*."""
from scripts.controller.actions.phase.intent import *  # noqa: F401,F403
from scripts.controller.actions.phase.intent import (  # noqa: F401
    Any, ContractMode, Literal, MODE_TO_TASK_MODE,
    RefillMode, _ALL_FIELDS_SYNONYMS, _CRUD_PHASE_RE, _DEVIATE_CLICK_LABELS,
    _INTRODUCE_RE, _MAINTAIN_DIALOG_TITLE_RE, _MODE_TO_ROLE, _MODE_TO_TASK,
    _PICKER_DIALOG_TITLE_RE, _clear_phase_form_state, _is_introduce_task, annotations,
    apply_phase_contract, apply_phase_intent, check_pending_write_gate, classify_task_mode,
    clear_phase_intent, compile_phase_intent, contract_allows_form_assistant, contract_force_refill,
    contract_summary_hint, emit_phase_observability, force_refill_all_required, get_phase_intent,
    has_contract_success, is_cycle_deviate_fingerprint, is_introduce_phase, is_login_task,
    is_maintain_form_phase, is_query_task, mark_quality_failed, overlay_blocks_done,
    phase_intent_active, phase_intent_contract_enabled, re, record_success_token,
    recovery_prescription_message, should_block_index_submit,
)
