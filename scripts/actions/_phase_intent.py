"""Phase Intent Contract — compile NL task text into hard constraints for AI recording.

Stored in ``case_data_store['_phase_intent']`` (process-local authority).
Feature flag: ``AI_PHASE_INTENT_CONTRACT`` (default on). Locked per phase at compile time.
"""

from __future__ import annotations

import re
from typing import Any, Literal

from scripts.feature_flags import phase_intent_contract_enabled

from ._phase_context import (
    classify_task_mode,
    force_refill_all_required,
    is_login_task,
    is_query_task,
)

RefillMode = Literal['none', 'touched', 'all_editable']
ContractMode = Literal[
    'create', 'modify', 'query', 'navigate', 'verify', 'introduce_pick', 'login', 'other'
]

# Synonyms for explicit all-fields modify (boosts confidence; default is all_editable anyway).
_ALL_FIELDS_SYNONYMS = re.compile(
    r'修改表单中所有字段|修改所有字段|改所有字段|全部字段.*修改|修改.*全部字段'
    r'|改一遍全部|逐项修改|所有表单项|全部表单项|每个字段|每一个字段'
)

_INTRODUCE_RE = re.compile(
    r'引入|选人|选择客户|选择企业|选择法人|联网核查|挑选.*客户|挑选.*企业'
)

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
    ):
        case_data_store.pop(key, None)


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
    t = (task_text or '').strip()
    if not t or is_query_task(t) or is_login_task(t):
        return False
    if _INTRODUCE_RE.search(t):
        return True
    return False


def compile_phase_intent(task_text: str) -> dict[str, Any]:
    """Rule-based compiler (synonym table + task_mode). Returns contract dict."""
    t = (task_text or '').strip()
    task_mode = classify_task_mode(t)

    if is_login_task(t):
        mode: ContractMode = 'login'
        refill: RefillMode = 'none'
        submit = {'required': False, 'via': 'any', 'button_text': ''}
        success = {'kinds': [], 'evidence': []}
    elif is_query_task(t):
        mode = 'query'
        refill = 'none'
        submit = {'required': False, 'via': 'any', 'button_text': '查询'}
        success = {'kinds': [], 'evidence': []}
    elif _is_introduce_task(t):
        mode = 'introduce_pick'
        refill = 'none'
        submit = {'required': True, 'via': 'any', 'button_text': '确认'}
        success = {
            'kinds': ['confirm_click', 'picker_closed'],
            'evidence': ['ok-introduce-confirm', 'picker-dialog-closed'],
        }
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


def apply_phase_intent(case_data_store: dict | None, task_text: str) -> dict[str, Any] | None:
    """Clear old contract, compile if flag on, write store. Returns contract or None."""
    clear_phase_intent(case_data_store)
    if case_data_store is None:
        return None
    enabled = phase_intent_contract_enabled()
    case_data_store['_phase_intent_flag_locked'] = enabled
    if not enabled:
        return None
    contract = compile_phase_intent(task_text)
    case_data_store['_phase_intent'] = contract
    # Sync legacy flag used across form/task paths
    case_data_store['_force_refill_all'] = contract.get('refill') == 'all_editable'
    return contract


def contract_force_refill(case_data_store: dict | None) -> bool:
    """Whether TaskList should treat pre-filled editable fields as pending."""
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
    return '\n'.join(lines) + '\n'


def is_maintain_form_phase(contract: dict[str, Any] | None) -> bool:
    return bool(contract and contract.get('mode') in ('create', 'modify'))


def is_introduce_phase(contract: dict[str, Any] | None) -> bool:
    return bool(contract and contract.get('mode') == 'introduce_pick')


def should_block_index_submit(
    contract: dict[str, Any] | None,
    btn_label: str,
    *,
    in_form_overlay: bool,
    dialog_title: str = '',
) -> bool:
    """True when index-click on submit label must be blocked (maintain dialog only)."""
    if not contract:
        return in_form_overlay
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
    # 确认/确定 — only block in maintain context, not picker dialogs
    if _PICKER_DIALOG_TITLE_RE.search(dialog_title or '') and not _MAINTAIN_DIALOG_TITLE_RE.search(
        dialog_title or ''
    ):
        return False
    return in_form_overlay


def check_pending_write_gate(case_data_store: dict | None) -> tuple[bool, list[str]]:
    """Return (ok, pending_labels). Hard gate when refill=all_editable."""
    if not contract_force_refill(case_data_store):
        return True, []
    from scripts.models.task import TaskList

    tl = TaskList.from_store((case_data_store or {}).get('task_list'))
    pending = [i.label for i in tl.pending if not i.needs_intervention and i.label]
    return len(pending) == 0, pending


def record_success_token(case_data_store: dict | None, kind: str, evidence: str = '') -> None:
    if not case_data_store:
        return
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
    """Emit phase_intent / recovery / quality_failed on recording events."""
    if not case_data_store or not emit_fn:
        return
    payload: dict[str, Any] = {}
    c = get_phase_intent(case_data_store)
    if c:
        payload['phase_intent'] = c
        payload['recovery'] = c.get('recovery')
    if case_data_store.get('_quality_failed'):
        payload['quality_failed'] = True
        payload['quality_failed_reasons'] = list(
            case_data_store.get('_quality_failed_reasons') or []
        )
    if payload:
        emit_fn({'event': 'phase_intent_obs', 'data': payload})
