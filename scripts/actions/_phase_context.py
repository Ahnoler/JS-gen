"""Cross-phase business-scenario preamble for AI long-term context.

Feature flags: see ``scripts.feature_flags`` (re-exported here for callers).
"""

from __future__ import annotations

import re
from typing import Any

from scripts.feature_flags import (  # noqa: F401 — re-export
    memory_whitelist_enabled,
    phase_preamble_enabled,
)


_OUTCOME_TEXT_MAX = 400
_PRIOR_DESC_MAX = 200
_PREAMBLE_TOTAL_MAX = 1200

# Task text that requires overwriting every editable field (modify-dialog refill).
_FORCE_REFILL_RE = re.compile(
    r'修改表单中所有字段|修改所有字段|改所有字段|全部字段.*修改|修改.*全部字段'
)


def force_refill_all_required(task_text: str) -> bool:
    """True when the phase task requires overwriting all editable form fields."""
    return bool(_FORCE_REFILL_RE.search(task_text or ''))


def force_refill_hint() -> str:
    return (
        '\n\n【强制改填 — CRITICAL】\n'
        '本阶段要求修改表单中所有可编辑字段。\n'
        '1. 打开修改弹窗后，禁止只 check_field_value / 核对回显就点确认。\n'
        '2. 对每个可编辑字段必须执行覆盖写入：input→fill_form_field，'
        'select→select_option，radio→click_radio（可用 match_form_rule / 案例数据生成新值）。\n'
        '3. 回显的旧值必须换成新值；仅 disabled 且无旁边按钮的只读字段可跳过。\n'
        '4. 全部改完后用 click_save(button_text="确认"或"保存")，见到 ok-save-success 再 done。\n'
    )


def truncate_text(text: str, max_len: int) -> str:
    t = (text or '').strip()
    if len(t) <= max_len:
        return t
    return t[: max_len - 1].rstrip() + '…'


def record_phase_outcome(case_data_store: dict | None, phase_number: int, *, success: bool, text: str) -> None:
    """Persist done() outcome for later preamble (overwrites on phase retry)."""
    if case_data_store is None:
        return
    try:
        phase = int(phase_number)
    except (TypeError, ValueError):
        return
    store = case_data_store.setdefault('_phase_outcomes', {})
    store[phase] = {
        'success': bool(success),
        'text': truncate_text(text or '', _OUTCOME_TEXT_MAX),
    }


def clear_phase_outcomes(case_data_store: dict | None) -> None:
    if case_data_store is not None:
        case_data_store.pop('_phase_outcomes', None)


def _outcome_for(case_data_store: dict | None, phase_number: int) -> dict | None:
    if not case_data_store:
        return None
    store = case_data_store.get('_phase_outcomes') or {}
    hit = store.get(phase_number)
    if hit is None:
        # JSON keys may be strings after round-trip
        hit = store.get(str(phase_number))
    return hit if isinstance(hit, dict) else None


def _build_prior_entries(
    *,
    current_phase: int,
    prior_phases: list | None,
    case_data_store: dict | None,
) -> list[dict[str, Any]]:
    """Build up to 2 prior phase entries (exclude current phase)."""
    entries: list[dict[str, Any]] = []

    if isinstance(prior_phases, list) and prior_phases:
        for item in prior_phases:
            if not isinstance(item, dict):
                continue
            try:
                pn = int(item.get('phaseNumber', item.get('phase_number')))
            except (TypeError, ValueError):
                continue
            if pn == current_phase:
                continue
            desc = (item.get('description') or '').strip()
            outcome = _outcome_for(case_data_store, pn)
            entries.append({
                'phaseNumber': pn,
                'description': desc,
                'outcome': outcome,
            })
            if len(entries) >= 2:
                break
        return entries

    # Fallback: process-local outcomes only (phase_number - 1 / - 2)
    for pn in (current_phase - 1, current_phase - 2):
        if pn < 1 or pn == current_phase:
            continue
        outcome = _outcome_for(case_data_store, pn)
        if outcome is None:
            continue
        entries.append({
            'phaseNumber': pn,
            'description': '',
            'outcome': outcome,
        })
        if len(entries) >= 2:
            break
    # Keep chronological order (older first)
    entries.sort(key=lambda e: e['phaseNumber'])
    return entries[-2:]


def format_phase_preamble(
    *,
    current_phase: int,
    current_task: str,
    prior_phases: list | None,
    case_data_store: dict | None,
) -> str:
    """Return 【业务场景】+【当前任务】 block, or just current task if no priors / disabled.

    Does NOT append case-data hint — caller still uses format_case_data_hint.
    """
    task = (current_task or '').strip()
    if not phase_preamble_enabled():
        return task

    try:
        cur = int(current_phase)
    except (TypeError, ValueError):
        cur = 0

    priors = _build_prior_entries(
        current_phase=cur,
        prior_phases=prior_phases,
        case_data_store=case_data_store,
    )
    if not priors:
        return task

    lines = ['【业务场景】', '（此前阶段）']
    had_failure = False
    for e in priors:
        pn = e['phaseNumber']
        desc = truncate_text(e.get('description') or '', _PRIOR_DESC_MAX)
        if desc:
            lines.append(f'- 阶段{pn}：{desc}')
        else:
            lines.append(f'- 阶段{pn}：')
        outcome = e.get('outcome')
        if outcome:
            ok = bool(outcome.get('success'))
            label = '成功' if ok else '失败'
            otext = truncate_text(str(outcome.get('text') or ''), _OUTCOME_TEXT_MAX)
            if otext:
                lines.append(f'  结果：{label} — {otext}')
            else:
                lines.append(f'  结果：{label}')
            if not ok:
                had_failure = True
        else:
            lines.append('  结果：见页面当前状态')

    if had_failure:
        lines.append('（勿重复上阶段已尝试且失败的做法）')

    scenario = '\n'.join(lines)
    if len(scenario) > _PREAMBLE_TOTAL_MAX and len(priors) >= 2:
        # Prefer keeping the most recent prior (last entry); rebuild once without recursion risk
        last = priors[-1]
        slim = [
            '【业务场景】',
            '（此前阶段）',
        ]
        pn = last['phaseNumber']
        desc = truncate_text(last.get('description') or '', _PRIOR_DESC_MAX)
        slim.append(f'- 阶段{pn}：{desc}' if desc else f'- 阶段{pn}：')
        outcome = last.get('outcome')
        if outcome:
            ok = bool(outcome.get('success'))
            label = '成功' if ok else '失败'
            otext = truncate_text(str(outcome.get('text') or ''), _OUTCOME_TEXT_MAX)
            slim.append(f'  结果：{label} — {otext}' if otext else f'  结果：{label}')
            if not ok:
                slim.append('（勿重复上阶段已尝试且失败的做法）')
        else:
            slim.append('  结果：见页面当前状态')
        scenario = truncate_text('\n'.join(slim), _PREAMBLE_TOTAL_MAX)
    elif len(scenario) > _PREAMBLE_TOTAL_MAX:
        scenario = truncate_text(scenario, _PREAMBLE_TOTAL_MAX)

    current_block = f'【当前任务 — 阶段{cur}】\n{task}' if cur else f'【当前任务】\n{task}'
    return f'{scenario}\n\n{current_block}'
