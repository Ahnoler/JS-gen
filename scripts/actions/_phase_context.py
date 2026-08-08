"""Compatibility shim — implementation moved to scripts.controller.actions._phase_context.py."""
from scripts.controller.actions._phase_context import *  # noqa: F401,F403
from scripts.controller.actions._phase_context import (  # noqa: F401
    Any, Literal, TaskMode, _BUSINESS_DATA_MARK_RE,
    _FILL_TASK_RE, _FORCE_REFILL_RE, _LOGIN_EXCLUDE_RE, _LOGIN_TASK_RE,
    _MODIFY_TASK_RE, _OPEN_PAGE_EXCLUDE_RE, _OPEN_PAGE_EXPECT_RE, _OUTCOME_TEXT_MAX,
    _PREAMBLE_TOTAL_MAX, _PRIOR_DESC_MAX, _QUERY_EXCLUDE_RE, _QUERY_TASK_RE,
    _WIZARD_NAV_RE, _build_prior_entries, _legacy_prior_outcome_line, _looks_like_truncated_echo,
    _outcome_for, annotations, apply_heal_mode, apply_task_mode,
    classification_task_text, classify_task_mode, clear_phase_outcomes, detect_heal_mode,
    force_refill_all_required, force_refill_hint, form_fill_hint, form_modify_partial_hint,
    format_phase_catalog, format_phase_preamble, format_prior_outcome_line, is_fill_task,
    is_heal_mode, is_login_task, is_modify_task, is_open_page_task,
    is_query_task, is_wizard_nav_task, login_task_hint, memory_whitelist_enabled,
    merge_prior_outcome, needs_business_data_context, open_page_task_hint, phase_preamble_enabled,
    query_task_hint, re, record_phase_outcome, recording_refill_hint,
    strip_business_data_block, task_mode_hint, truncate_text, wizard_nav_task_hint,
)
