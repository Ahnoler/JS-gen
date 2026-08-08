"""Phase Intent Contract — compile NL task text into hard constraints for AI recording.

Stored in ``case_data_store['_phase_intent']`` (process-local authority).
Feature flag: ``AI_PHASE_INTENT_CONTRACT`` (default on). Locked per phase at compile time.
"""

from __future__ import annotations

import re
from typing import Any, Literal

from scripts.feature_flags import phase_intent_contract_enabled

from .._phase_context import (
    classify_task_mode,
    force_refill_all_required,
    is_login_task,
    is_query_task,
)

RefillMode = Literal['none', 'touched', 'all_editable']
ContractMode = Literal[
    'create', 'modify', 'query', 'navigate', 'verify', 'introduce_pick', 'login', 'other'
]

_MODE_TO_TASK = {
    'create': 'form_fill',
    'modify': 'form_modify',
    'query': 'query',
    'login': 'login',
    'navigate': 'other',
    'introduce_pick': 'other',
    'other': 'other',
}
MODE_TO_TASK_MODE = _MODE_TO_TASK
_MODE_TO_ROLE = {
    'create': 'maintain',
    'modify': 'maintain',
    'query': 'query',
    'navigate': 'navigate',
    'introduce_pick': 'introduce',
    'login': 'other',
    'other': 'other',
}

# Synonyms for explicit all-fields modify (boosts confidence; default is all_editable anyway).
_ALL_FIELDS_SYNONYMS = re.compile(
    r'修改表单中所有字段|修改所有字段|改所有字段|全部字段.*修改|修改.*全部字段'
    r'|改一遍全部|逐项修改|所有表单项|全部表单项|每个字段|每一个字段'
)

_INTRODUCE_RE = re.compile(
    r'引入|选人|选择客户|客户选择|选择企业|选择法人|联网核查|'
    r'挑选.*客户|挑选.*企业|选择.*客户|选择.*企业'
)

# CRUD verbs that mean the phase goal is form maintain (create/modify), not introduce-only.
# Conditional「如果出现引入按钮…」inside an 新增 task must NOT hijack mode→introduce_pick.
_CRUD_PHASE_RE = re.compile(r'新增|创建|录入|新建|添加|修改|编辑|更新|维护')

_MAINTAIN_DIALOG_TITLE_RE = re.compile(
    r'维护|修改|编辑|新增|录入|详情|信息'
)

_PICKER_DIALOG_TITLE_RE = re.compile(
    r'引入|选择|查询|客户|企业|法人|列表'
)

# Cycle deviate fingerprints (after recovery prescription).
_DEVIATE_CLICK_LABELS = frozenset({'修改', '编辑', '更新'})


def clear_phase_intent(case_data_store: dict | None) -> None:
    """Remove contract and phase-scoped recovery flags (call before next phase compile)."""
    if not case_data_store:
        return
    for key in (
        '_phase_intent',
        '_phase_intent_flag_locked',
        '_cycle_prescribed',
        '_recovery_active',
        '_last_introduce_ok',
        '_quality_failed',
        '_quality_failed_reasons',
        '_phase_section',
        '_empty_act_streak',
    ):
        case_data_store.pop(key, None)
    try:
        from .._phase_boundary import clear_phase_boundary
        clear_phase_boundary(case_data_store)
    except Exception:
        pass


def get_phase_intent(case_data_store: dict | None) -> dict[str, Any] | None:
    if not case_data_store:
        return None
    raw = case_data_store.get('_phase_intent')
    return raw if isinstance(raw, dict) else None


def phase_intent_active(case_data_store: dict | None) -> bool:
    """True when contract is in effect for this phase."""
    if not case_data_store:
        return False
    if case_data_store.get('_phase_intent_flag_locked') is False:
        return False
    return get_phase_intent(case_data_store) is not None


def _is_introduce_task(task_text: str) -> bool:
    """True when introduce/pick is the *primary* phase goal.

    Mixed create+conditional-introduce tasks (「新增…如果出现引入按钮…」) return False
    so compile keeps mode=create with refill=all_editable.

    Does **not** defer to ``is_query_task`` — picker phases routinely contain「查询」;
    compile_phase_intent checks introduce before query.
    """
    t = (task_text or '').strip()
    if not t or is_login_task(t):
        return False
    if not _INTRODUCE_RE.search(t):
        return False
    # Form maintain verbs win over nested introduce instructions.
    if _CRUD_PHASE_RE.search(t):
        return False
    return True


def compile_phase_intent(task_text: str) -> dict[str, Any]:
    """Rule-based compiler (synonym table + task_mode). Returns contract dict."""
    from .._phase_context import classification_task_text

    t = classification_task_text(task_text).strip()
    task_mode = classify_task_mode(t)

    if is_login_task(t):
        mode: ContractMode = 'login'
        refill: RefillMode = 'none'
        submit = {'required': False, 'via': 'any', 'button_text': ''}
        success = {'kinds': [], 'evidence': []}
    elif _is_introduce_task(t):
        # Before query/form_fill: picker phases often contain「填写」「查询」words.
        mode = 'introduce_pick'
        refill = 'none'
        submit = {'required': True, 'via': 'any', 'button_text': '确认'}
        success = {
            'kinds': ['confirm_click', 'picker_closed'],
            'evidence': ['ok-introduce-confirm', 'picker-dialog-closed'],
        }
    elif is_query_task(t):
        mode = 'query'
        refill = 'none'
        submit = {'required': False, 'via': 'any', 'button_text': '查询'}
        success = {'kinds': [], 'evidence': []}
    elif task_mode == 'form_fill':
        mode = 'create'
        refill = 'all_editable'
        submit = {'required': True, 'via': 'click_save', 'button_text': '保存'}
        success = {
            'kinds': ['toast_ok', 'url_change'],
            'evidence': ['ok-save-success', 'post_save_navigation'],
        }
    elif task_mode == 'form_modify':
        mode = 'modify'
        refill = 'all_editable'
        submit = {'required': True, 'via': 'click_save', 'button_text': '确认'}
        success = {
            'kinds': ['toast_ok', 'url_change'],
            'evidence': ['ok-save-success', 'post_save_navigation'],
        }
    else:
        mode = 'other'
        refill = 'none'
        submit = {'required': False, 'via': 'any', 'button_text': ''}
        success = {'kinds': [], 'evidence': []}

    explicit_all = bool(_ALL_FIELDS_SYNONYMS.search(t)) or force_refill_all_required(t)
    if mode in ('create', 'modify') and explicit_all:
        refill = 'all_editable'

    recovery = {
        'next_action': (
            'click_save(button_text="确认")'
            if mode == 'modify'
            else 'click_save(button_text="保存")'
        ),
        'forbid_reopen_modify_cycle': True,
        'on_cycle': 'prescribe_once_then_stop_if_deviate',
        'deviate_actions': ['reselect_row', 'reopen_modify', 'reopen_maintain_dialog'],
        'allow': ['wait', 'get_page_state', 'wait_for_loading', 'click_element_by_index'],
    }
    if mode == 'introduce_pick':
        recovery = {
            'next_action': 'click_element_by_index on 确认 after row selected',
            'forbid_reopen_modify_cycle': False,
            'on_cycle': 'prescribe_once_then_stop_if_deviate',
            'deviate_actions': [],
            'allow': ['wait', 'get_page_state', 'wait_for_loading', 'click_element_by_index'],
        }

    return {
        'mode': mode,
        'refill': refill,
        'submit': submit,
        'success': success,
        'forbid': [
            'index_submit_on_form_maintain',
            'idle_get_page_state_while_loading',
            'done_without_token',
        ],
        'recovery': recovery,
        'task_text_excerpt': t[:200],
        'explicit_all_fields': explicit_all,
    }


def contract_allows_form_assistant(case_data_store: dict | None) -> bool:
    c = get_phase_intent(case_data_store)
    if not c:
        return False
    if 'allow_form_assistant' in c:
        from scripts.actions._phase_reviewer import coerce_bool
        return coerce_bool(c.get('allow_form_assistant'))
    return c.get('refill') == 'all_editable' and c.get('mode') in ('create', 'modify')


def _clear_phase_form_state(case_data_store: dict | None, *, mode: str, task_mode: str) -> None:
    """Drop phase-scoped form/query flags when a new contract is applied."""
    if not case_data_store:
        return
    for key in ('_query_ui', '_query_ready', '_submit_ready'):
        case_data_store.pop(key, None)
    clear_form = (
        mode in ('navigate', 'query', 'login', 'other')
        or task_mode in ('query', 'login', 'other')
    )
    if not clear_form:
        return
    for key in (
        'task_list',
        '_scan_fields',
        '_autofill_summary',
        '_task_lists_by_container',
        '_active_container',
        '_parent_container_before_picker',
    ):
        case_data_store.pop(key, None)


def apply_phase_contract(
    case_data_store: dict | None,
    contract: dict[str, Any],
    *,
    boundary_override: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Authoritative write of task_mode + force_refill + boundary + intent."""
    clear_phase_intent(case_data_store)  # also clears boundary via existing clear
    if case_data_store is None:
        return contract
    try:
        from scripts.actions._phase_reviewer import sanitize_contract_for_mode
        c = sanitize_contract_for_mode(dict(contract))
    except Exception:
        c = dict(contract)
    mode = c.get('mode') or 'other'
    refill = c.get('refill') or 'none'
    if 'allow_form_assistant' not in c:
        c['allow_form_assistant'] = (
            refill == 'all_editable' and mode in ('create', 'modify')
        )
    role = _MODE_TO_ROLE.get(mode, 'other')
    requires_write = refill == 'all_editable'
    task_mode = _MODE_TO_TASK.get(mode, 'other')
    source = c.get('source') or 'llm'
    if boundary_override is not None:
        boundary = dict(boundary_override)
        if not boundary.get('role'):
            boundary['role'] = role
        boundary['requires_write_all_editable'] = requires_write
        boundary['task_mode'] = task_mode
        boundary['source'] = source
    else:
        success_when = list((c.get('success') or {}).get('kinds') or [])
        # Keep boundary in sync with sanitized intent (login/nav/query → []).
        if mode in ('login', 'navigate', 'query'):
            success_when = []
        boundary = {
            'role': role,
            'requires_write_all_editable': requires_write,
            'goals': list(c.get('in_scope') or []),
            'success_when': success_when,
            'task_mode': task_mode,
            'source': source,
            # preserve keys compile_boundary callers expect with safe defaults:
            'forbid_index_submit': mode in ('create', 'modify'),
            'picker_allowed': mode in ('create', 'modify', 'introduce_pick'),
        }
    if boundary_override is not None and mode in ('login', 'navigate', 'query'):
        # Even with override, never require maintain tokens on non-maintain modes.
        boundary['success_when'] = []
        boundary['requires_write_all_editable'] = False
    case_data_store['_phase_boundary'] = boundary
    case_data_store['_phase_boundary_flag_locked'] = True
    case_data_store['_phase_intent'] = c
    case_data_store['_phase_intent_flag_locked'] = True
    case_data_store['_task_mode'] = task_mode
    case_data_store['_query_task'] = mode == 'query'
    case_data_store['_force_refill_all'] = requires_write
    case_data_store['_evidence_observed'] = []
    _clear_phase_form_state(case_data_store, mode=mode, task_mode=task_mode)
    return c


def apply_phase_intent(case_data_store: dict | None, task_text: str) -> dict[str, Any] | None:
    """Clear old contract, compile if flag on, write store. Returns contract or None.

    When AI_PHASE_BOUNDARY is on, compiles PhaseBoundary first and adapts it
    into the legacy intent dict so existing callers keep working.
    """
    if case_data_store is None:
        return None

    from scripts.feature_flags import phase_boundary_enabled

    if phase_boundary_enabled():
        from .._phase_boundary import (
            boundary_to_legacy_intent,
            compile_boundary,
        )
        boundary = compile_boundary(task_text)
        contract = boundary_to_legacy_intent(boundary)
        if not contract:
            clear_phase_intent(case_data_store)
            case_data_store['_phase_intent_flag_locked'] = True
            case_data_store['_phase_boundary_flag_locked'] = True
            return None
        if 'allow_form_assistant' not in contract:
            mode = contract.get('mode')
            refill = contract.get('refill')
            contract['allow_form_assistant'] = (
                refill == 'all_editable' and mode in ('create', 'modify')
            )
        contract['source'] = 'rules_fallback'
        if boundary.get('goals'):
            contract.setdefault('in_scope', list(boundary['goals']))
        return apply_phase_contract(case_data_store, contract, boundary_override=boundary)

    enabled = phase_intent_contract_enabled()
    if not enabled:
        clear_phase_intent(case_data_store)
        case_data_store['_phase_intent_flag_locked'] = enabled
        return None
    contract = compile_phase_intent(task_text)
    contract['source'] = 'rules_fallback'
    return apply_phase_contract(case_data_store, contract)


def contract_force_refill(case_data_store: dict | None) -> bool:
    """Whether TaskList should treat pre-filled editable fields as pending."""
    try:
        from .._phase_boundary import get_phase_boundary, phase_boundary_active
        if phase_boundary_active(case_data_store):
            b = get_phase_boundary(case_data_store)
            return bool(b and b.get('requires_write_all_editable'))
    except Exception:
        pass
    c = get_phase_intent(case_data_store)
    if c:
        return c.get('refill') == 'all_editable'
    if case_data_store:
        return bool(case_data_store.get('_force_refill_all'))
    return False


def contract_summary_hint(contract: dict[str, Any] | None) -> str:
    if not contract:
        return ''
    mode = contract.get('mode', '')
    refill = contract.get('refill', '')
    submit = contract.get('submit') or {}
    success = contract.get('success') or {}
    kinds = success.get('kinds') or []
    lines = [
        '\n\n【阶段意图合约】',
        f'- mode={mode} refill={refill}',
    ]
    if 'allow_form_assistant' in contract:
        lines.append(f'- allow_form_assistant={contract.get("allow_form_assistant")}')
    goal = contract.get('goal')
    if goal:
        lines.append(f'- goal: {goal}')
    out_of_scope = contract.get('out_of_scope') or []
    for item in out_of_scope:
        lines.append(f'- out_of_scope: {item}')
    done_when = contract.get('done_when')
    if done_when:
        lines.append(f'- done_when: {done_when}')
    source = contract.get('source')
    if source:
        lines.append(f'- source: {source}')
    if submit.get('required'):
        lines.append(f'- submit: via={submit.get("via")} button={submit.get("button_text")}')
    if kinds:
        lines.append(f'- success: {"|".join(kinds)}')
    if refill == 'all_editable':
        lines.append(
            '- 录制须对每个可编辑字段执行写动作（可同值重填），以采集可操作元素；'
            '禁止仅 check_field_value 后提交。'
        )
    if mode in ('create', 'modify'):
        lines.append(
            '- 保存成功 = 操作成功提示 或 保存后页面/抽屉跳转。'
        )
    if mode == 'introduce_pick':
        lines.append('- 引入/选人：选行后点确认即成功，不要求操作成功 toast。')
    if contract.get('brief_plan'):
        lines.append('- 【阶段计划】')
        for i, step in enumerate(list(contract.get('brief_plan') or [])[:4], 1):
            text = str(step).strip()
            if text:
                lines.append(f'  {i}. {text[:80]}')
    return '\n'.join(lines) + '\n'


def is_maintain_form_phase(contract: dict[str, Any] | None) -> bool:
    return bool(contract and contract.get('mode') in ('create', 'modify'))


def is_introduce_phase(contract: dict[str, Any] | None) -> bool:
    return bool(contract and contract.get('mode') == 'introduce_pick')


def overlay_blocks_done(contract: dict | None) -> bool:
    """True → DOM done-heuristics (open overlay / visible errors) hard-reject.

    False → do not block done for those heuristics alone.

    Inverted default: with a contract, allow unless submit.required or non-empty
    success.kinds. No contract → block (conservative).

    Shared by recorder overlay gate and visible-errors gate.
    """
    if not isinstance(contract, dict):
        return True
    from scripts.actions._phase_reviewer import coerce_bool
    submit = contract.get('submit')
    if not isinstance(submit, dict):
        submit = {}
    required = coerce_bool(submit.get('required'))
    kinds = (contract.get('success') or {}).get('kinds') or []
    if not isinstance(kinds, (list, tuple)):
        kinds = []
    if required or len(kinds) > 0:
        return True
    return False


def should_block_index_submit(
    contract: dict[str, Any] | None,
    btn_label: str,
    *,
    in_form_overlay: bool,
    dialog_title: str = '',
    is_picker_ui: bool = False,
    container_id: str = '',
    query_ui: bool = False,
    case_data_store: dict | None = None,
) -> bool:
    """True when index-click on submit label must be blocked.

    Prefers PhaseBoundary when active; falls back to legacy intent rules.
    """
    try:
        from .._phase_boundary import (
            get_phase_boundary,
            phase_boundary_active,
            should_block_index_submit_boundary,
        )
        if phase_boundary_active(case_data_store):
            return should_block_index_submit_boundary(
                get_phase_boundary(case_data_store),
                btn_label,
                in_form_overlay=in_form_overlay,
                dialog_title=dialog_title,
                container_id=container_id,
                query_ui=query_ui or is_picker_ui,
            )
    except Exception:
        pass

    if not contract:
        return in_form_overlay and not is_picker_ui
    if is_introduce_phase(contract):
        return False
    submit = contract.get('submit') or {}
    if submit.get('via') != 'click_save':
        return False
    compact = re.sub(r'\s+', '', (btn_label or '').strip())
    if not compact:
        return False
    if not re.match(r'^(保存|提交|确认|确定)', compact):
        return False
    if compact.startswith(('保存', '提交')):
        return True
    if is_picker_ui:
        return False
    title = dialog_title or ''
    if re.search(r'选择|引入|放大镜|查询客户|客户列表|挑选', title):
        return False
    if _PICKER_DIALOG_TITLE_RE.search(title) and not _MAINTAIN_DIALOG_TITLE_RE.search(title):
        return False
    return in_form_overlay


def check_pending_write_gate(case_data_store: dict | None, section: str = "") -> tuple[bool, list[str]]:
    """Return (ok, pending_labels). Hard gate when refill / boundary requires write."""
    try:
        from .._phase_boundary import can_submit_writes, phase_boundary_active
        if phase_boundary_active(case_data_store):
            return can_submit_writes(case_data_store, section=section)
    except Exception:
        pass
    if not contract_force_refill(case_data_store):
        return True, []
    from scripts.models.task import TaskList
    from scripts.actions._section_scope import filter_pending_labels

    tl = TaskList.from_store((case_data_store or {}).get('task_list'))
    pending = filter_pending_labels(tl, section)
    return len(pending) == 0, pending


def record_success_token(case_data_store: dict | None, kind: str, evidence: str = '') -> None:
    if not case_data_store:
        return
    try:
        from .._phase_boundary import phase_boundary_active, record_evidence
        if phase_boundary_active(case_data_store):
            mapping = {
                'toast_ok': 'toast_ok',
                'url_change': 'url_change',
                'confirm_click': 'dialog_confirmed',
                'picker_closed': 'picker_closed',
            }
            record_evidence(case_data_store, mapping.get(kind, kind), evidence)
    except Exception:
        pass
    store = case_data_store.setdefault('_success_tokens', [])
    if not isinstance(store, list):
        store = []
        case_data_store['_success_tokens'] = store
    entry = {'kind': kind, 'evidence': evidence}
    if entry not in store:
        store.append(entry)
    if kind in ('toast_ok', 'url_change'):
        case_data_store['_last_save_ok'] = True
    if kind in ('confirm_click', 'picker_closed'):
        case_data_store['_last_introduce_ok'] = True


def has_contract_success(case_data_store: dict | None) -> bool:
    """True when required success token for this phase is satisfied."""
    try:
        from .._phase_boundary import phase_boundary_active, phase_done_ok
        if phase_boundary_active(case_data_store):
            ok, _ = phase_done_ok(case_data_store)
            return ok
    except Exception:
        pass
    c = get_phase_intent(case_data_store)
    if not c:
        if case_data_store:
            return bool(case_data_store.get('_last_save_ok') or case_data_store.get('_last_introduce_ok'))
        return False
    kinds = (c.get('success') or {}).get('kinds') or []
    if not kinds:
        return True
    if case_data_store.get('_last_save_ok') and ('toast_ok' in kinds or 'url_change' in kinds):
        return True
    if case_data_store.get('_last_introduce_ok') and (
        'confirm_click' in kinds or 'picker_closed' in kinds
    ):
        return True
    tokens = case_data_store.get('_success_tokens') or []
    for tok in tokens:
        if isinstance(tok, dict) and tok.get('kind') in kinds:
            return True
    return False


def recovery_prescription_message(contract: dict[str, Any] | None, *, reason: str = '') -> str:
    if not contract:
        return (
            '[RECORDER] Recovery: call click_save(button_text="确认"/"保存") once. '
            'Do not re-select the same row / re-open 修改.'
        )
    rec = contract.get('recovery') or {}
    nxt = rec.get('next_action') or 'click_save()'
    base = (
        f'[RECORDER] {reason} '.strip()
        + f'Recovery prescription: {nxt}. '
        'Do NOT re-select table row or re-click 修改. '
        'wait / get_page_state / list query + row select + 确认 are allowed.'
    )
    return base.strip()


def is_cycle_deviate_fingerprint(fp: str) -> bool:
    if not fp:
        return False
    if fp.startswith('radio:'):
        return True
    if fp.startswith('click:'):
        label = fp[6:]
        compact = re.sub(r'\s+', '', label)
        for d in _DEVIATE_CLICK_LABELS:
            if compact == d or compact.startswith(d):
                return True
    return False


def mark_quality_failed(case_data_store: dict | None, *reasons: str) -> None:
    if not case_data_store:
        return
    case_data_store['_quality_failed'] = True
    existing = case_data_store.setdefault('_quality_failed_reasons', [])
    if not isinstance(existing, list):
        existing = []
        case_data_store['_quality_failed_reasons'] = existing
    for r in reasons:
        if r and r not in existing:
            existing.append(r)


def emit_phase_observability(case_data_store: dict | None, emit_fn) -> None:
    """Emit phase_intent / phase_boundary / recovery / quality_failed on recording events."""
    if not case_data_store or not emit_fn:
        return
    payload: dict[str, Any] = {}
    c = get_phase_intent(case_data_store)
    if c:
        payload['phase_intent'] = c
        payload['recovery'] = c.get('recovery')
    try:
        from .._phase_boundary import get_phase_boundary, phase_boundary_active
        if phase_boundary_active(case_data_store):
            b = get_phase_boundary(case_data_store)
            evidence = list(case_data_store.get('_evidence_observed') or [])
            payload['phase_boundary'] = b
            payload['evidence_observed'] = evidence
            emit_fn({
                'event': 'phase_boundary_obs',
                'data': {
                    'phase_boundary': b,
                    'evidence_observed': evidence,
                    'recovery': (c or {}).get('recovery') if c else None,
                },
            })
    except Exception:
        pass
    if case_data_store.get('_quality_failed'):
        payload['quality_failed'] = True
        payload['quality_failed_reasons'] = list(
            case_data_store.get('_quality_failed_reasons') or []
        )
    if payload:
        emit_fn({'event': 'phase_intent_obs', 'data': payload})
