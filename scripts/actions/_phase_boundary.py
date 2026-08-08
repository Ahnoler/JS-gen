"""Compatibility shim — implementation moved to scripts.controller.actions._phase_boundary.py."""
from scripts.controller.actions._phase_boundary import *  # noqa: F401,F403
from scripts.controller.actions._phase_boundary import (  # noqa: F401
    Any, CompletionEvidence, Literal, Role,
    _ALL_FIELDS_SYNONYMS, _CONFIRM_BTN_RE, _CRUD_PHASE_RE, _INTRODUCE_COMPLETE_RE,
    _INTRODUCE_RE, _MAINTAIN_TITLE_RE, _PICKER_TITLE_RE, _SAVE_BTN_RE,
    _is_introduce_primary, _requires_introduce_then_save, annotations, apply_phase_boundary,
    boundary_to_legacy_intent, can_submit_writes, classify_task_mode, clear_phase_boundary,
    compile_boundary, contract_summary_hint_boundary, force_refill_all_required, get_phase_boundary,
    is_login_task, is_open_page_task, is_picker_context, is_query_task,
    is_wizard_nav_task, mark_parent_form_stale, maybe_record_picker_closed, next_action_hint,
    observed_kinds, phase_boundary_active, phase_boundary_enabled, phase_done_ok,
    re, record_evidence, should_block_index_submit_boundary,
)
