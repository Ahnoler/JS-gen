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
from .classify import _action_clause

Role = Literal['maintain', 'query', 'introduce', 'navigate', 'other']
CompletionEvidence = Literal[
    'toast_ok',
    'url_change',
    'picker_closed',
    'dialog_confirmed',
    'introduced_backfilled',
    'saved_navigation',
    'query_clicked',
    'page_opened',
    'nav_next_clicked',
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

# 2026-09-21：阶段终态动作词表——用于区分"只打开/填写"与"要完成保存/确认"的阶段。
# 只匹配动作子句（预期结果之前），避免把"预期结果：保存成功"等下一阶段的终态描述
# 误判为本阶段动作。
# 注意："选中/选行/勾选"是中间选择动作，不是终态（如开页前选行不算完成阶段），
# 因此不列入通用终态动作；但引入流程的"选中/选目标"可视为该子流程终态。
_TERMINAL_ACTION_RE = re.compile(
    r'点击\s*(?:保存|提交|确认|确定)|(?:保存|提交|确认|确定)\s*按钮|'
    r'保存|提交|确认|确定|回填|完成引入|完成选择|完成选人'
)
_INTRODUCE_TERMINAL_RE = re.compile(
    r'点击\s*(?:确认|确定)|(?:确认|确定)\s*按钮|选中|选行|选择目标|确认|确定|回填|完成引入|完成选择|完成选人'
)
_SAVE_TERMINAL_RE = re.compile(
    r'点击\s*(?:保存|提交|确认|确定)|(?:保存|提交|确认|确定)\s*按钮|'
    r'保存成功|提交成功|保存并|提交并|并保存|并提交|保存后|提交后|保存|提交|确认|确定'
)
_NEGATED_TERMINAL_RE = re.compile(
    r'(?:不要(?:点|点击)?|不点|勿点|禁止(?:点击)?|勿)\s*[「“"\']?'
    r'(?:保存|提交|确认|确定)'
)


def _has_terminal_action(task_text: str) -> bool:
    """动作子句中是否含本阶段终态动作（保存/确认/选中等）。"""
    return bool(_TERMINAL_ACTION_RE.search(_action_clause(task_text)))


def _has_introduce_terminal(task_text: str) -> bool:
    """动作子句中是否含引入/选人流程的终态动作。"""
    return bool(_INTRODUCE_TERMINAL_RE.search(_action_clause(task_text)))


def _has_save_terminal(task_text: str) -> bool:
    """本阶段是否含保存/提交终态动作（动作子句或预期结果）。"""
    raw = task_text or ''
    stripped = _NEGATED_TERMINAL_RE.sub('', raw)
    return bool(_SAVE_TERMINAL_RE.search(stripped))


_ACTION_SUBMIT_BTN_RE = re.compile(
    r'点击\s*[【\[「『]?\s*(确认|确定|保存|提交)'
)


def maintain_submit_button(task_text: str, *, modify: bool = False) -> str:
    """保存阶段要点的按钮文案。动作子句里最后一次点击优先，否则按模式默认。

    create 默认「保存」、modify 默认「确认」。弹窗终态常写「点击【确认】」，
    若合同仍写死「保存」，click_save 的文案针匹配不到【确认】，该步不会入轨迹。
    """
    action = _action_clause(task_text or '')
    hits = list(_ACTION_SUBMIT_BTN_RE.finditer(action))
    if hits:
        word = hits[-1].group(1)
        return word
    return '确认' if modify else '保存'


def _terminal_action_in_later_phase(
    task_text: str,
    all_phases: list,
    current_phase_number: int,
) -> bool:
    """后续阶段是否含可能承接本阶段终态的动作词（跨阶段令牌归属辅助）。"""
    if not all_phases or current_phase_number is None:
        return False
    try:
        cur = int(current_phase_number)
    except (TypeError, ValueError):
        return False
    # 优先看本阶段主题词：引入/选择/保存；后续阶段含对应终态词才认为承接。
    t = (task_text or '').strip()
    has_intro = bool(_INTRODUCE_RE.search(t))
    has_save = bool(_SAVE_TERMINAL_RE.search(t))
    for p in all_phases:
        if not isinstance(p, dict):
            continue
        n = p.get('phaseNumber') if p.get('phaseNumber') is not None else p.get('phase_number')
        try:
            if n is None or int(n) <= cur:
                continue
        except (TypeError, ValueError):
            continue
        desc = str(p.get('description') or p.get('title') or p.get('name') or '').strip()
        if not desc:
            continue
        if has_intro and _has_introduce_terminal(desc):
            return True
        if has_save and _has_save_terminal(desc):
            return True
        # 若本阶段无明确主题，后续阶段有任何终态动作也视为可能承接（保守）
        if not has_intro and not has_save and _has_terminal_action(desc):
            return True
    return False


def _is_open_only_dialog_or_page(
    task_text: str,
    all_phases: list | None = None,
    current_phase_number: int | None = None,
) -> bool:
    """阶段是否仅为"打开/弹出页面或弹窗"，而终态动作归后续阶段。

    典型："点击客户名称右侧的【引入】按钮。预期结果：打开客户选择窗口。"
    动作子句只有触发，没有保存/确认/选中；预期结果是开页/开窗；且（有 catalog
    时）后续阶段含对应终态动作。
    """
    t = (task_text or '').strip()
    if not is_open_page_task(t):
        return False
    # 动作子句已含终态动作 → 不是纯打开阶段（如"点击新增按钮打开表单后点击保存"）。
    if _has_terminal_action(t):
        return False
    # 有全阶段目录时，要求后续阶段确实含终态动作，避免单阶段流程被误判。
    if all_phases is not None and current_phase_number is not None:
        return _terminal_action_in_later_phase(t, all_phases, current_phase_number)
    return True


def phase_boundary_active(business_data_store: dict | None) -> bool:
    if not business_data_store:
        return False
    if business_data_store.get('_phase_boundary_flag_locked') is False:
        return False
    return isinstance(business_data_store.get('_phase_boundary'), dict)


def clear_phase_boundary(business_data_store: dict | None) -> None:
    if not business_data_store:
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
        business_data_store.pop(key, None)


def get_phase_boundary(business_data_store: dict | None) -> dict[str, Any] | None:
    if not business_data_store:
        return None
    raw = business_data_store.get('_phase_boundary')
    return raw if isinstance(raw, dict) else None


def _is_introduce_primary(
    task_text: str,
    all_phases: list | None = None,
    current_phase_number: int | None = None,
) -> bool:
    """True when introduce/pick is the *complete* primary phase goal.

    2026-09-21：单纯的"打开选择窗口"阶段（动作子句只有触发、无选中/确定）
    应判为 navigate/open_page，不归入 introduce——否则 done 会索要 picker_closed
    等本阶段产不出的令牌，迫使 agent 执行下一阶段动作。
    """
    t = (task_text or '').strip()
    if not t or is_login_task(t):
        return False
    if not _INTRODUCE_RE.search(t):
        return False
    if _CRUD_PHASE_RE.search(t):
        return False
    # 纯开弹窗/页面阶段 → navigate
    if _is_open_only_dialog_or_page(t, all_phases, current_phase_number):
        return False
    # 必须在本阶段完成选/确定/回填，否则终态动作属于后续阶段
    return _has_introduce_terminal(t) or bool(_INTRODUCE_COMPLETE_RE.search(t))


def _requires_introduce_then_save(task_text: str) -> bool:
    """Mixed create+introduce with explicit「完成引入流程」semantics."""
    t = task_text or ''
    if not _INTRODUCE_RE.search(t):
        return False
    if not _CRUD_PHASE_RE.search(t):
        return False
    return bool(_INTRODUCE_COMPLETE_RE.search(t))


def compile_boundary(
    task_text: str,
    container_kind: str = '',
    all_phases: list | None = None,
    current_phase_number: int | None = None,
) -> dict[str, Any]:
    """Compile NL task into a PhaseBoundary dict (JSON-serializable)."""
    from .._phase_context import classification_task_text

    t = classification_task_text(task_text).strip()
    task_mode = classify_task_mode(t)
    explicit_all = bool(_ALL_FIELDS_SYNONYMS.search(t)) or force_refill_all_required(t)
    needs_intro_then_save = _requires_introduce_then_save(t)
    # 是否本阶段就包含保存/提交终态动作
    has_save_terminal = _has_save_terminal(t)

    if is_login_task(t):
        # login keeps empty success_when — prepare already uses replay_done, not
        # the recording phase_done evidence gate (G3 plan §7 default).
        role: Role = 'other'
        requires_write = False
        goals: list[str] = ['login']
        success_when: list[str] = []
        forbid_index = False
        picker_allowed = False
    elif _is_introduce_primary(t, all_phases, current_phase_number):
        # Complete introduce/pick phase (select + confirm) must win over query,
        # because picker phases routinely contain「查询/填写」words.
        role = 'introduce'
        requires_write = False
        goals = ['introduce_pick']
        success_when = ['picker_closed', 'dialog_confirmed', 'introduced_backfilled']
        forbid_index = False
        picker_allowed = True
    elif is_query_task(t):
        # Query wins over open-page expectation: "点击查询。预期结果：打开查询结果页面"
        # must still record query_clicked evidence.
        role = 'query'
        requires_write = False
        goals = ['query_filter']
        # G3: forbid empty success_when — must click 查询/搜索 (any-of list).
        success_when = ['query_clicked']
        forbid_index = False
        picker_allowed = False
    elif _is_open_only_dialog_or_page(t, all_phases, current_phase_number):
        # Open-page / open-picker-only intermediate stage. Terminal action belongs
        # to a later phase, so success token = page/dialog opened.
        role = 'navigate'
        requires_write = False
        goals = ['open_page']
        # G3: URL change OR dialog/drawer page_opened (any-of).
        success_when = ['url_change', 'page_opened']
        forbid_index = False
        picker_allowed = False
    elif task_mode in ('form_fill', 'form_modify'):
        role = 'maintain'
        requires_write = True  # all_editable for recording (current container only)
        # 保存/提交终态动作在本阶段才给保存令牌；否则只是"填写完成"的中间阶段
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
        elif has_save_terminal:
            goals = ['fill_form', 'save_form']
            success_when = ['toast_ok', 'url_change', 'saved_navigation']
        else:
            # 纯填写阶段：保留 all_editable 以采集可写元素，但不索要保存令牌
            goals = ['fill_form']
            success_when = []
        forbid_index = True
        picker_allowed = True  # nested picker may open during maintain
    elif is_wizard_nav_task(t):
        # Non-form wizard:「…搜索为…，点击下一步」— set conditions + next, not list query.
        # Maintain verbs (新增/填写/修改…) win above so wizard form steps keep refill semantics.
        role = 'navigate'
        requires_write = False
        goals = ['set_conditions', 'click_next']
        # G3: at least one successful「下一步」click (any-of with url/page as OR).
        success_when = ['nav_next_clicked', 'url_change', 'page_opened']
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
        'submit_button': (
            maintain_submit_button(t, modify=(task_mode == 'form_modify'))
            if role == 'maintain' and success_when
            else ''
        ),
    }


def apply_phase_boundary(
    business_data_store: dict | None,
    task_text: str,
    all_phases: list | None = None,
    current_phase_number: int | None = None,
) -> dict[str, Any] | None:
    """Clear + compile boundary when flag on. Returns boundary or None."""
    clear_phase_boundary(business_data_store)
    if business_data_store is None:
        return None
    enabled = phase_boundary_enabled()
    business_data_store['_phase_boundary_flag_locked'] = enabled
    if not enabled:
        return None
    boundary = compile_boundary(
        task_text,
        all_phases=all_phases,
        current_phase_number=current_phase_number,
    )
    business_data_store['_phase_boundary'] = boundary
    business_data_store['_evidence_observed'] = []
    business_data_store['_force_refill_all'] = bool(boundary.get('requires_write_all_editable'))
    return boundary


def boundary_to_legacy_intent(boundary: dict[str, Any] | None) -> dict[str, Any] | None:
    """Adapt PhaseBoundary → legacy compile_phase_intent shape for callers."""
    if not boundary:
        return None
    role = boundary.get('role')
    if role == 'maintain':
        mode = 'create' if boundary.get('task_mode') != 'form_modify' else 'modify'
        refill = 'all_editable' if boundary.get('requires_write_all_editable') else 'none'
        btn = str(
            boundary.get('submit_button')
            or ('确认' if mode == 'modify' else '保存')
        )
        boundary_success_when = list(boundary.get('success_when') or [])
        success_kinds = []
        if any(k in boundary_success_when for k in ('toast_ok',)):
            success_kinds.append('toast_ok')
        if any(k in boundary_success_when for k in ('url_change', 'saved_navigation')):
            success_kinds.append('url_change')
        # 2026-09-21：纯填写阶段 boundary 给空 success_when → 不索要保存令牌，
        # recovery 也不应强推 click_save，避免 agent 越过阶段边界执行下一阶段的保存。
        requires_save = bool(success_kinds)
        submit = {
            'required': requires_save,
            'via': 'click_save' if requires_save else 'any',
            'button_text': btn if requires_save else '',
        }
        recovery_next = (
            f'click_save(button_text="{btn}")'
            if requires_save
            else '填写/选择字段完成后调用 done(success=true)（本阶段无保存动作）'
        )
        return {
            'mode': mode,
            'refill': refill,
            'submit': submit,
            'success': {
                'kinds': success_kinds,
                'evidence': ['ok-save-success', 'post_save_navigation'] if requires_save else [],
            },
            'forbid': [
                'index_submit_on_form_maintain',
                'idle_get_page_state_while_loading',
                'done_without_token',
            ],
            'recovery': {
                'next_action': recovery_next,
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
        # 276 兜底收敛（2026-09-18）：空合同显式传播为空 kinds，不再凭空抬升为
        # query 合同（2026-09-17 评级重置 done 死循环的隐患点之一）；空合同默认值
        # 职责由 apply_phase_contract 的既有逻辑承担。compile_boundary 对 query
        # 永不产空合同（G3），此分支只影响手工构造/未来调用方。
        q_kinds = list(boundary.get('success_when') or [])
        return {
            'mode': 'query',
            'refill': 'none',
            'submit': {'required': False, 'via': 'any', 'button_text': '查询'},
            'success': {
                'kinds': q_kinds,
                'evidence': ['ok-query-clicked'],
            },
            'forbid': ['done_without_token'],
            'recovery': {
                'next_action': 'click 查询 via click_element_by_index, then done(success=true)',
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
        # 276 兜底收敛（2026-09-18）：同 query —— 空合同不再抬升默认令牌。
        nav_kinds = list(boundary.get('success_when') or [])
        return {
            'mode': 'navigate',
            'refill': 'none',
            'submit': {'required': False, 'via': 'any', 'button_text': '下一步'},
            'success': {
                'kinds': nav_kinds,
                'evidence': ['ok-nav-evidence'],
            },
            'forbid': ['done_without_token'],
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
        if boundary.get('success_when'):
            lines.append('- 收口：保存成功 = 操作成功提示 或 保存后页面跳转。')
        else:
            lines.append(
                '- 收口：本阶段只填写/选择字段，填完后 done(success=true)。'
                '不要点确认/保存，弹窗保持打开。'
            )
    elif role == 'introduce':
        lines.append('- 收口：选人确认 / 弹窗关闭即可，不要求操作成功 toast。')
    elif role == 'query':
        lines.append('- 收口：必须先点「查询/搜索」取得证据后才允许 done(success=true)。')
    elif role == 'navigate':
        if 'open_page' in goals:
            lines.append(
                '- 收口：目标页面/弹窗出现（url_change 或 page_opened 证据）后 done；'
                '禁止在新页面内继续操作（填字段/下一步/确定）。'
            )
        elif 'click_next' in goals:
            lines.append('- 收口：按任务设条件后点「下一步」并取得证据；勿把点「查询」当阶段结束。')
        else:
            lines.append('- 收口：按任务设条件后点「下一步」；勿把点「查询」当阶段结束。')
    if boundary.get('picker_allowed'):
        lines.append('- 引入/选人弹窗内可索引点「确认」；禁止在查询弹窗点「保存/提交」。')
    return '\n'.join(lines) + '\n'
