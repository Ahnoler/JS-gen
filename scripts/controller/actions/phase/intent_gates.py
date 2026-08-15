"""Phase intent gates + observability — extracted from phase/intent.py.

Assistant-permission, done/submit gates, success tokens, quality marks and
observability emission. Lazy-imports _phase_boundary and phase.reviewer.
"""

from __future__ import annotations

import re
from typing import Any

from .intent_contract import (
    _DEVIATE_CLICK_LABELS,
    _MAINTAIN_DIALOG_TITLE_RE,
    _PICKER_DIALOG_TITLE_RE,
    contract_force_refill,
    get_phase_intent,
    phase_intent_active,
)

def contract_allows_form_assistant(case_data_store: dict | None) -> bool:
    c = get_phase_intent(case_data_store)
    if not c:
        return False
    if 'allow_form_assistant' in c:
        from scripts.controller.actions.phase.reviewer import coerce_bool
        return coerce_bool(c.get('allow_form_assistant'))
    return c.get('refill') == 'all_editable' and c.get('mode') in ('create', 'modify')

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
    from scripts.controller.actions.phase.reviewer import coerce_bool
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
    from scripts.controller.actions.section_scope import filter_pending_labels

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

def done_accept_reason(
    contract: dict[str, Any] | None,
    *,
    save_ok: bool = False,
    introduce_ok: bool = False,
    navigated_ok: bool = False,
) -> str:
    """Label for the recorder's 'done() accepted after …' log line.

    Prefers the phase contract's own success kinds so a lingering
    _last_introduce_ok does not relabel a create/modify save acceptance.
    Falls back to the legacy introduce > save-ok > navigation priority.
    """
    kinds = ((contract or {}).get('success') or {}).get('kinds') or []
    if not isinstance(kinds, (list, tuple)):
        kinds = []
    if save_ok and {'toast_ok', 'url_change'} & set(kinds):
        return 'navigation' if navigated_ok else 'save-ok'
    if introduce_ok and {'confirm_click', 'picker_closed'} & set(kinds):
        return 'introduce'
    if introduce_ok:
        return 'introduce'
    if save_ok:
        return 'save-ok'
    return 'navigation'

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
