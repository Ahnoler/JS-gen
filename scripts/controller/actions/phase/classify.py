"""Task-mode classification for phase preambles (extracted from _phase_context).

Regex constants + NL task classification: login / query / open-page / wizard /
modify / fill → TaskMode. ``apply_task_mode`` writes the compat flags into
case_data_store. Feature-flag re-exports kept here for facade parity.
"""

from __future__ import annotations

import re
from typing import Literal

from scripts.feature_flags import (  # noqa: F401 — re-export
    memory_whitelist_enabled,
    phase_preamble_enabled,
)

TaskMode = Literal['login', 'query', 'form_fill', 'form_modify', 'other']

# Task text that requires overwriting every editable field (modify-dialog refill).
_FORCE_REFILL_RE = re.compile(
    r'修改表单中所有字段|修改所有字段|改所有字段|全部字段.*修改|修改.*全部字段'
)

# Query/filter-only phases — no 保存/提交; agent must click 查询, not click_save.
_QUERY_TASK_RE = re.compile(r'查询|搜索|查找')
_QUERY_EXCLUDE_RE = re.compile(
    r'新增|创建|编辑|修改|保存|提交|删除|录入|校验|导入'
)
# Wizard / multi-step pages often say「客户名称搜索为…，点击下一步」— that is NOT
# list-filter query (must not force「点查询 → done」).
_WIZARD_NAV_RE = re.compile(r'下一步|上一步|进入下一步|点击下一步')
# Open-page / navigate phases:「点击评级申请。预期结果：打开评级申请相关页面」—
# done once the target page/dialog appears; do NOT continue the flow inside it.
_OPEN_PAGE_EXPECT_RE = re.compile(
    r'预期结果[:：]?[^。；\n]{0,12}(?:打开|进入|抵达|到达)[^。；\n]{0,20}(?:页面|界面|弹窗|对话框)'
)
# Save-to-open phases (点击保存。预期结果：保存成功并进入列表页) keep prompt rule 3
# (click_save → ok-save-navigation → done) — NOT open-page navigation.
_OPEN_PAGE_EXCLUDE_RE = re.compile(r'保存|提交')

# Suffixes appended for AI fill context — must NOT affect task-mode / boundary classify.
_BUSINESS_DATA_MARK_RE = re.compile(
    r'\n*【(?:业务数据|业务场景案例数据|预设案例数据)[^\n]*】[\s\S]*$',
)

# Form modify (edit existing values) — distinct from blank form_fill.
_MODIFY_TASK_RE = re.compile(r'修改|编辑|更新|变更|改填|维护')

# Explicit new/entry form fill — required for form_fill (not a catch-all default).
_FILL_TASK_RE = re.compile(r'新增|创建|录入|填写|新建|添加|校验|开立')

# Pure login phase (navigate to login / enter credentials).
_LOGIN_TASK_RE = re.compile(r'登录|登入|/login|#/login', re.IGNORECASE)
_LOGIN_EXCLUDE_RE = re.compile(
    r'新增|创建|录入|填写|修改|编辑|查询|搜索|删除|保存|提交|校验'
)


def force_refill_all_required(task_text: str) -> bool:
    """True when the phase task requires overwriting all editable form fields."""
    return bool(_FORCE_REFILL_RE.search(task_text or ''))


def strip_business_data_block(task_text: str) -> str:
    """Remove trailing 【业务数据】/ legacy case-data blocks from phase text.

    Those blocks are fill *values*, not phase goals. Keeping them in classify
    text caused navigate phases to become form_fill (boilerplate contains「填写」)
    or introduce (key data contains「引入」).
    """
    t = str(task_text or '')
    t = _BUSINESS_DATA_MARK_RE.sub('', t)
    return t.strip()


def classification_task_text(task_text: str) -> str:
    """Phase text used for task_mode / boundary / intent — no business-data suffix."""
    return strip_business_data_block(task_text)


def needs_business_data_context(
    task_text: str,
    case_data_store: dict | None = None,
) -> bool:
    """Whether to show 【业务数据】to the model for this phase.

    Only fill / modify / introduce (incl. introduce-then-save). Not login,
    pure open-page navigate, or list query.
    """
    t = classification_task_text(task_text)
    if not t:
        return False
    if case_data_store:
        contract = case_data_store.get('_phase_intent') or {}
        mode = contract.get('mode')
        if mode in ('navigate', 'login', 'query'):
            return False
        if mode in ('create', 'modify', 'introduce_pick'):
            return True
        boundary = case_data_store.get('_phase_boundary') or {}
        if boundary.get('role') == 'navigate':
            return False
        if boundary.get('role') in ('maintain', 'introduce'):
            return True
    mode = classify_task_mode(t)
    if mode in ('form_fill', 'form_modify'):
        return True
    if case_data_store:
        boundary = case_data_store.get('_phase_boundary') or {}
        if boundary.get('role') == 'introduce' or boundary.get('requires_introduce_then_save'):
            return True
        contract = case_data_store.get('_phase_intent') or {}
        if contract.get('mode') == 'introduce_pick':
            return True
    if mode in ('login', 'query'):
        return False
    # Pure open-page / menu navigate — no value hints
    if mode == 'other' and is_open_page_task(t):
        return False
    # Introduce-only goals often classify as other
    if re.search(r'引入|选人|客户选择|选择客户|选择.*客户', t):
        return True
    return False


def is_wizard_nav_task(task_text: str) -> bool:
    """True when the phase advances a wizard (下一步/上一步), not list query."""
    return bool(_WIZARD_NAV_RE.search(classification_task_text(task_text)))


def is_open_page_task(task_text: str) -> bool:
    """True when the expected result is just opening/entering a page or dialog.

    e.g.「选中客户名称…，点击评级申请。预期结果：打开评级申请相关页面。」— the phase
    ends when the target page/dialog shows; the agent must not run the flow inside.
    Save-to-open texts (…点击保存。预期结果：…进入列表页面) are excluded — they keep
    the click_save → ok-save-navigation → done rule.
    """
    t = classification_task_text(task_text)
    if _OPEN_PAGE_EXCLUDE_RE.search(t):
        return False
    return bool(_OPEN_PAGE_EXPECT_RE.search(t))


def is_query_task(task_text: str) -> bool:
    """True when the phase is a search/filter task (no form-save semantics).

    Matches「查询产品信息」etc. Excludes mixed CRUD tasks that also mention 查询
    (e.g. 查询后新增 / 修改并保存) — those still use form-save when a dialog opens.
    Also excludes wizard copy like「客户名称搜索为…，点击下一步」(set field + next).
    Main-page query toolbars are additionally detected via DOM (有查询无保存).
    """
    t = classification_task_text(task_text)
    if not _QUERY_TASK_RE.search(t):
        return False
    if _QUERY_EXCLUDE_RE.search(t):
        return False
    if is_wizard_nav_task(t):
        return False
    return True


def is_login_task(task_text: str) -> bool:
    """True when the phase is only sign-in (not login-then-fill in one blob)."""
    t = classification_task_text(task_text)
    if not t or not _LOGIN_TASK_RE.search(t):
        return False
    if _LOGIN_EXCLUDE_RE.search(t):
        return False
    return True


def is_modify_task(task_text: str) -> bool:
    """True when the phase is editing an existing form (not blank entry, not query)."""
    t = classification_task_text(task_text)
    if not t or is_query_task(t) or is_login_task(t):
        return False
    if force_refill_all_required(t):
        return True
    return bool(_MODIFY_TASK_RE.search(t))


def is_fill_task(task_text: str) -> bool:
    """True when the phase is explicit new/entry form filling."""
    t = classification_task_text(task_text)
    if not t or is_query_task(t) or is_login_task(t) or is_modify_task(t):
        return False
    return bool(_FILL_TASK_RE.search(t))


def classify_task_mode(task_text: str) -> TaskMode:
    """Classify phase intent. ``form_fill`` only when entry keywords match — never default.

    Classification ignores trailing 【业务数据】blocks (value hints, not goals).
    """
    t = classification_task_text(task_text)
    if is_login_task(t):
        return 'login'
    if is_query_task(t):
        return 'query'
    if is_open_page_task(t):
        return 'other'
    if is_modify_task(t):
        return 'form_modify'
    if is_fill_task(t):
        return 'form_fill'
    return 'other'


def apply_task_mode(case_data_store: dict | None, task_text: str) -> TaskMode:
    """Write ``_task_mode`` / compat flags into case_data_store. Returns mode."""
    mode = classify_task_mode(task_text)
    if case_data_store is None:
        return mode
    case_data_store['_task_mode'] = mode
    case_data_store['_query_task'] = mode == 'query'
    # Legacy default; PhaseIntentContract may override via apply_phase_intent().
    case_data_store['_force_refill_all'] = (
        mode == 'form_fill'
        or (mode == 'form_modify' and force_refill_all_required(task_text))
    )
    case_data_store.pop('_query_ui', None)
    case_data_store.pop('_query_ready', None)
    case_data_store.pop('_submit_ready', None)
    if mode in ('query', 'login', 'other'):
        case_data_store.pop('task_list', None)
        case_data_store.pop('_scan_fields', None)
        case_data_store.pop('_autofill_summary', None)
    return mode

