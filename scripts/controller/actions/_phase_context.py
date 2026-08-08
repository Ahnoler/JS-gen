"""Facade — _phase_context.py split into scripts.controller.actions.phase.*."""
from scripts.controller.actions.phase.classify import *  # noqa: F401,F403
from scripts.controller.actions.phase.classify import (  # noqa: F401
    Literal, TaskMode, _BUSINESS_DATA_MARK_RE, _FILL_TASK_RE,
    _FORCE_REFILL_RE, _LOGIN_EXCLUDE_RE, _LOGIN_TASK_RE, _MODIFY_TASK_RE,
    _OPEN_PAGE_EXCLUDE_RE, _OPEN_PAGE_EXPECT_RE, _QUERY_EXCLUDE_RE, _QUERY_TASK_RE,
    _WIZARD_NAV_RE, annotations, apply_task_mode, classification_task_text,
    classify_task_mode, force_refill_all_required, is_fill_task, is_login_task,
    is_modify_task, is_open_page_task, is_query_task, is_wizard_nav_task,
    memory_whitelist_enabled, needs_business_data_context, phase_preamble_enabled, re,
    strip_business_data_block,
)
from scripts.controller.actions.phase.prompts import *  # noqa: F401,F403
from scripts.controller.actions.phase.prompts import (  # noqa: F401
    TaskMode, annotations, apply_heal_mode, detect_heal_mode,
    force_refill_hint, form_fill_hint, form_modify_partial_hint, is_heal_mode,
    is_open_page_task, is_wizard_nav_task, login_task_hint, open_page_task_hint,
    query_task_hint, recording_refill_hint, task_mode_hint, wizard_nav_task_hint,
)
from scripts.controller.actions.phase.outcomes import *  # noqa: F401,F403
from scripts.controller.actions.phase.outcomes import (  # noqa: F401
    Any, _OUTCOME_TEXT_MAX, _PREAMBLE_TOTAL_MAX, _PRIOR_DESC_MAX,
    _build_prior_entries, _legacy_prior_outcome_line, _looks_like_truncated_echo, _outcome_for,
    annotations, clear_phase_outcomes, format_phase_catalog, format_phase_preamble,
    format_prior_outcome_line, merge_prior_outcome, phase_preamble_enabled, record_phase_outcome,
    truncate_text,
)
