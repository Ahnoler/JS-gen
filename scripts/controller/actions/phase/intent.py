"""Facade — intent.py split into contract/gates halves."""
from scripts.controller.actions.phase.intent_contract import *  # noqa: F401,F403
from scripts.controller.actions.phase.intent_contract import (  # noqa: F401
    Any, ContractMode, Literal, MODE_TO_TASK_MODE,
    RefillMode, _ALL_FIELDS_SYNONYMS, _CRUD_PHASE_RE, _DEVIATE_CLICK_LABELS,
    _INTRODUCE_RE, _MAINTAIN_DIALOG_TITLE_RE, _MODE_TO_ROLE, _MODE_TO_TASK,
    _PICKER_DIALOG_TITLE_RE, _clear_phase_form_state, _is_introduce_task, annotations,
    apply_phase_contract, apply_phase_intent, classify_task_mode, clear_phase_intent,
    compile_phase_intent, contract_force_refill, force_refill_all_required, get_phase_intent,
    is_login_task, is_query_task, phase_intent_active, phase_intent_contract_enabled,
    re,
)
from scripts.controller.actions.phase.intent_gates import *  # noqa: F401,F403
from scripts.controller.actions.phase.intent_gates import (  # noqa: F401
    Any, _DEVIATE_CLICK_LABELS, _MAINTAIN_DIALOG_TITLE_RE, _PICKER_DIALOG_TITLE_RE,
    annotations, check_pending_write_gate, contract_allows_form_assistant, contract_force_refill,
    contract_summary_hint, emit_phase_observability, get_phase_intent, has_contract_success,
    is_cycle_deviate_fingerprint, is_introduce_phase, is_maintain_form_phase, mark_quality_failed,
    overlay_blocks_done, phase_intent_active, re, record_success_token,
    recovery_prescription_message, should_block_index_submit,
)
