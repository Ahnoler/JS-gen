"""Phase boundary contract — extracted from phase/boundary.py.

Compile/apply the loose completion contract (role + goals + success_when),
adapt to legacy intent shape. Lazy-imports _phase_context only.
"""

from __future__ import annotations

import re
from typing import Any, Literal

from scripts.feature_flags import phase_boundary_enabled

from .._phase_context import (
    classify_task_mode,
    force_refill_all_required,
    is_login_task,
    is_open_page_task,
    is_query_task,
    is_wizard_nav_task,
)

Role = Literal['maintain', 'query', 'introduce', 'navigate', 'other']
CompletionEvidence = Literal[
    'toast_ok',
    'url_change',
    'picker_closed',
    'dialog_confirmed',
    'introduced_backfilled',
    'saved_navigation',
]

_INTRODUCE_RE = re.compile(
    r'引入|选人|选择客户|客户选择|选择企业|选择法人|联网核查|'
    r'挑选.*客户|挑选.*企业|选择.*客户|选择.*企业'
)
_CRUD_PHASE_RE = re.compile(r'新增|创建|录入|新建|添加|修改|编辑|更新|维护')
_INTRODUCE_COMPLETE_RE = re.compile(
    r'完成引入|引入流程|引入成功|选人完成|完成选人|完成引入流程'
)
_ALL_FIELDS_SYNONYMS = re.compile(
    r'修改表单中所有字段|修改所有字段|改所有字段|全部字段.*修改|修改.*全部字段'
    r'|改一遍全部|逐项修改|所有表单项|全部表单项|每个字段|每一个字段'
)
_PICKER_TITLE_RE = re.compile(r'引入|选择|查询|客户|企业|法人|列表|放大镜|挑选')
_MAINTAIN_TITLE_RE = re.compile(r'维护|修改|编辑|新增|录入|详情|信息')
_SAVE_BTN_RE = re.compile(r'^(保存|提交)')
_CONFIRM_BTN_RE = re.compile(r'^(确认|确定)')



def phase_boundary_active(case_data_store: dict | None) -> bool:
    if not case_data_store:
        return False
    if case_data_store.get('_phase_boundary_flag_locked') is False:
        return False
    return isinstance(case_data_store.get('_phase_boundary'), dict)


def clear_phase_boundary(case_data_store: dict | None) -> None:
    if not case_data_store:
        return
    for key in (
        '_phase_boundary',
        '_phase_boundary_flag_locked',
        '_evidence_observed',
        '_form_stale',
        '_task_lists_by_container',
        '_active_container',
        '_parent_container_before_picker',
    ):
        case_data_store.pop(key, None)


def get_phase_boundary(case_data_store: dict | None) -> dict[str, Any] | None:
    if not case_data_store:
        return None
    raw = case_data_store.get('_phase_boundary')
    return raw if isinstance(raw, dict) else None


def _is_introduce_primary(task_text: str) -> bool:
    t = (task_text or '').strip()
    if not t or is_login_task(t):
        return False
    if not _INTRODUCE_RE.search(t):
        return False
    if _CRUD_PHASE_RE.search(t):
        return False
    return True


def _requires_introduce_then_save(task_text: str) -> bool:
    """Mixed create+introduce with explicit「完成引入流程」semantics."""
    t = task_text or ''
    if not _INTRODUCE_RE.search(t):
        return False
    if not _CRUD_PHASE_RE.search(t):
        return False
    return bool(_INTRODUCE_COMPLETE_RE.search(t))


def compile_boundary(task_text: str, container_kind: str = '') -> dict[str, Any]:
    """Compile NL task into a PhaseBoundary dict (JSON-serializable)."""
    from .._phase_context import classification_task_text

    t = classification_task_text(task_text).strip()
    task_mode = classify_task_mode(t)
    explicit_all = bool(_ALL_FIELDS_SYNONYMS.search(t)) or force_refill_all_required(t)
    needs_intro_then_save = _requires_introduce_then_save(t)

    if is_login_task(t):
        role: Role = 'other'
        requires_write = False
        goals: list[str] = ['login']
        success_when: list[str] = []
        forbid_index = False
        picker_allowed = False
    elif _is_introduce_primary(t):
        role = 'introduce'
        requires_write = False
        goals = ['introduce_pick']
        success_when = ['picker_closed', 'dialog_confirmed', 'introduced_backfilled']
        forbid_index = False
        picker_allowed = True
    elif is_query_task(t):
        role = 'query'
        requires_write = False
        goals = ['query_filter']
        success_when = []
        forbid_index = False
        picker_allowed = False
    elif is_open_page_task(t):
        # Open-page expect wins over incidental 维护/修改 in navigation titles.
        role = 'navigate'
        requires_write = False
        goals = ['open_page']
        success_when = []
        forbid_index = False
        picker_allowed = False
    elif task_mode in ('form_fill', 'form_modify'):
        role = 'maintain'
        requires_write = True  # all_editable for recording (current container only)
        goals = ['fill_form', 'save_form']
        if needs_intro_then_save:
            goals = ['fill_form', 'introduce_legal_person', 'save_form']
            # Must have introduce evidence AND save evidence (checked in phase_done_ok)
            success_when = [
                'picker_closed',
                'dialog_confirmed',
                'introduced_backfilled',
                'toast_ok',
                'url_change',
                'saved_navigation',
            ]
        else:
            success_when = ['toast_ok', 'url_change', 'saved_navigation']
        forbid_index = True
        picker_allowed = True  # nested picker may open during maintain
    elif is_wizard_nav_task(t):
        # Non-form wizard:「…搜索为…，点击下一步」— set conditions + next, not list query.
        # Maintain verbs (新增/填写/修改…) win above so wizard form steps keep refill semantics.
        role = 'navigate'
        requires_write = False
        goals = ['set_conditions', 'click_next']
        success_when = []
        forbid_index = False
        picker_allowed = False
    else:
        role = 'other'
        requires_write = False
        goals = ['navigate_or_misc']
        success_when = []
        forbid_index = False
        picker_allowed = bool(_INTRODUCE_RE.search(t))

    return {
        'role': role,
        'requires_write_all_editable': requires_write,
        'goals': goals,
        'success_when': success_when,
        'forbid_index_submit': forbid_index,
        'picker_allowed': picker_allowed,
        'requires_introduce_then_save': needs_intro_then_save,
        'task_text_excerpt': t[:200],
        'explicit_all_fields': explicit_all,
        'container_kind': container_kind or '',
        'task_mode': task_mode,
    }


def apply_phase_boundary(case_data_store: dict | None, task_text: str) -> dict[str, Any] | None:
    """Clear + compile boundary when flag on. Returns boundary or None."""
    clear_phase_boundary(case_data_store)
    if case_data_store is None:
        return None
    enabled = phase_boundary_enabled()
    case_data_store['_phase_boundary_flag_locked'] = enabled
    if not enabled:
        return None
    boundary = compile_boundary(task_text)
    case_data_store['_phase_boundary'] = boundary
    case_data_store['_evidence_observed'] = []
    case_data_store['_force_refill_all'] = bool(boundary.get('requires_write_all_editable'))
    return boundary


def boundary_to_legacy_intent(boundary: dict[str, Any] | None) -> dict[str, Any] | None:
    """Adapt PhaseBoundary → legacy compile_phase_intent shape for callers."""
    if not boundary:
        return None
    role = boundary.get('role')
    if role == 'maintain':
        mode = 'create' if boundary.get('task_mode') != 'form_modify' else 'modify'
        refill = 'all_editable' if boundary.get('requires_write_all_editable') else 'none'
        btn = '确认' if mode == 'modify' else '保存'
        success_kinds = []
        if any(k in (boundary.get('success_when') or []) for k in ('toast_ok',)):
            success_kinds.append('toast_ok')
        if any(k in (boundary.get('success_when') or []) for k in ('url_change', 'saved_navigation')):
            success_kinds.append('url_change')
        return {
            'mode': mode,
            'refill': refill,
            'submit': {'required': True, 'via': 'click_save', 'button_text': btn},
            'success': {
                'kinds': success_kinds or ['toast_ok', 'url_change'],
                'evidence': ['ok-save-success', 'post_save_navigation'],
            },
            'forbid': [
                'index_submit_on_form_maintain',
                'idle_get_page_state_while_loading',
                'done_without_token',
            ],
            'recovery': {
                'next_action': f'click_save(button_text="{btn}")',
                'forbid_reopen_modify_cycle': True,
                'on_cycle': 'prescribe_once_then_stop_if_deviate',
                'deviate_actions': ['reselect_row', 'reopen_modify', 'reopen_maintain_dialog'],
                'allow': ['wait', 'get_page_state', 'wait_for_loading', 'click_element_by_index'],
            },
            'task_text_excerpt': boundary.get('task_text_excerpt', ''),
            'explicit_all_fields': boundary.get('explicit_all_fields', False),
            '_from_boundary': True,
        }
    if role == 'introduce':
        return {
            'mode': 'introduce_pick',
            'refill': 'none',
            'submit': {'required': True, 'via': 'any', 'button_text': '确认'},
            'success': {
                'kinds': ['confirm_click', 'picker_closed'],
                'evidence': ['ok-introduce-confirm', 'picker-dialog-closed'],
            },
            'forbid': ['idle_get_page_state_while_loading', 'done_without_token'],
            'recovery': {
                'next_action': 'click_element_by_index on 确认 after row selected',
                'forbid_reopen_modify_cycle': False,
                'on_cycle': 'prescribe_once_then_stop_if_deviate',
                'deviate_actions': [],
                'allow': ['wait', 'get_page_state', 'wait_for_loading', 'click_element_by_index'],
            },
            'task_text_excerpt': boundary.get('task_text_excerpt', ''),
            'explicit_all_fields': False,
            '_from_boundary': True,
        }
    if role == 'query':
        return {
            'mode': 'query',
            'refill': 'none',
            'submit': {'required': False, 'via': 'any', 'button_text': '查询'},
            'success': {'kinds': [], 'evidence': []},
            'forbid': [],
            'recovery': {
                'next_action': 'click 查询',
                'forbid_reopen_modify_cycle': False,
                'on_cycle': 'prescribe_once_then_stop_if_deviate',
                'deviate_actions': [],
                'allow': ['wait', 'get_page_state', 'wait_for_loading', 'click_element_by_index'],
            },
            'task_text_excerpt': boundary.get('task_text_excerpt', ''),
            'explicit_all_fields': False,
            '_from_boundary': True,
        }
    if role == 'navigate':
        nav_goals = boundary.get('goals') or []
        return {
            'mode': 'navigate',
            'refill': 'none',
            'submit': {'required': False, 'via': 'any', 'button_text': '下一步'},
            'success': {'kinds': [], 'evidence': []},
            'forbid': [],
            'recovery': {
                'next_action': (
                    'set fields from task then click_element_by_index on 下一步'
                    if 'click_next' in nav_goals
                    else 'complete task clicks; when target page/dialog appears, done(success=true)'
                ),
                'forbid_reopen_modify_cycle': False,
                'on_cycle': 'prescribe_once_then_stop_if_deviate',
                'deviate_actions': [],
                'allow': ['wait', 'get_page_state', 'wait_for_loading', 'click_element_by_index'],
            },
            'task_text_excerpt': boundary.get('task_text_excerpt', ''),
            'explicit_all_fields': False,
            '_from_boundary': True,
        }
    return {
        'mode': 'other',
        'refill': 'none',
        'submit': {'required': False, 'via': 'any', 'button_text': ''},
        'success': {'kinds': [], 'evidence': []},
        'forbid': [],
        'recovery': {
            'next_action': '',
            'forbid_reopen_modify_cycle': False,
            'on_cycle': 'prescribe_once_then_stop_if_deviate',
            'deviate_actions': [],
            'allow': ['wait', 'get_page_state', 'wait_for_loading', 'click_element_by_index'],
        },
        'task_text_excerpt': boundary.get('task_text_excerpt', ''),
        'explicit_all_fields': False,
        '_from_boundary': True,
    }


def contract_summary_hint_boundary(boundary: dict[str, Any] | None) -> str:
    if not boundary:
        return ''
    role = boundary.get('role', '')
    goals = boundary.get('goals') or []
    lines = [
        '\n\n【阶段边界合约】',
        f'- role={role} goals={",".join(goals)}',
        f'- refill_current_container={bool(boundary.get("requires_write_all_editable"))}',
    ]
    if boundary.get('requires_introduce_then_save'):
        lines.append('- 收口：须完成引入（确认/弹窗关闭/回填）且最终保存成功（toast 或跳转）。')
    elif role == 'maintain':
        lines.append('- 收口：保存成功 = 操作成功提示 或 保存后页面跳转。')
    elif role == 'introduce':
        lines.append('- 收口：选人确认 / 弹窗关闭即可，不要求操作成功 toast。')
    elif role == 'navigate':
        if 'open_page' in goals:
            lines.append('- 收口：目标页面/弹窗出现即 done；禁止在新页面内继续操作（填字段/下一步/确定）。')
        else:
            lines.append('- 收口：按任务设条件后点「下一步」；勿把点「查询」当阶段结束。')
    if boundary.get('picker_allowed'):
        lines.append('- 引入/选人弹窗内可索引点「确认」；禁止在查询弹窗点「保存/提交」。')
    return '\n'.join(lines) + '\n'
