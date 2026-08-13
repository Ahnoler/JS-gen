"""Phase outcome persistence + preamble formatting (extracted from _phase_context).

Prior-phase outcome lines and the phase catalog; ``format_phase_preamble``
assembles the final preamble block.
"""

from __future__ import annotations

from typing import Any

from scripts.feature_flags import phase_preamble_enabled

_OUTCOME_TEXT_MAX = 400
_PRIOR_DESC_MAX = 200
# Soft cap only for pathological dumps — never trim 【阶段目录】lines.
_PREAMBLE_TOTAL_MAX = 8000

def truncate_text(text: str, max_len: int) -> str:
    t = (text or '').strip()
    if max_len <= 0 or len(t) <= max_len:
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


def _looks_like_truncated_echo(text: str) -> bool:
    """True when text is likely a truncated task instruction echo, not a done summary."""
    t = (text or '').strip()
    if not t:
        return True
    if t.endswith('…'):
        return True
    if len(t) >= 58 and not any(
        kw in t for kw in ('成功', '失败', '完成', '错误', '无法', '已保存', '已打开', 'ok', 'fail')
    ):
        return True
    return False


def merge_prior_outcome(
    prior_outcome: dict | None,
    *,
    case_data_store: dict | None,
    current_phase: int,
) -> dict | None:
    """Prefer richer local _phase_outcomes when control-plane text is a weak echo."""
    if not isinstance(prior_outcome, dict):
        pn = current_phase - 1
        if pn < 1:
            return prior_outcome
        local = _outcome_for(case_data_store, pn)
        if not local:
            return prior_outcome
        return {
            'phaseNumber': pn,
            'success': local.get('success'),
            'text': local.get('text'),
        }

    merged = dict(prior_outcome)
    try:
        pn = int(prior_outcome.get('phaseNumber') or prior_outcome.get('phase_number') or 0)
    except (TypeError, ValueError):
        pn = 0
    if pn < 1:
        pn = current_phase - 1
    local = _outcome_for(case_data_store, pn) if pn >= 1 else None
    if not local:
        return merged

    prior_text = str(prior_outcome.get('text') or '').strip()
    local_text = str(local.get('text') or '').strip()
    if prior_outcome.get('success') is None and 'success' in local:
        merged['success'] = local.get('success')
    if local_text and (
        not prior_text
        or len(local_text) > len(prior_text) + 8
        or _looks_like_truncated_echo(prior_text)
    ):
        merged['text'] = local_text
    return merged


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


def format_phase_catalog(all_phases: list | None, current_phase: int) -> str:
    if not all_phases:
        return ''
    lines = ['【阶段目录】']
    for p in all_phases:
        if not isinstance(p, dict):
            continue
        n = p.get('phaseNumber') if p.get('phaseNumber') is not None else p.get('phase_number')
        title = (p.get('title') or p.get('name') or '').strip()
        if not title:
            desc = (p.get('description') or '').strip().split('\n', 1)[0]
            title = truncate_text(desc, 40)
        mark = ''
        if n is not None:
            try:
                if int(n) == int(current_phase):
                    mark = ' ←当前'
            except (TypeError, ValueError):
                pass
        lines.append(f'{n}. {title}{mark}')
    return '\n'.join(lines) if len(lines) > 1 else ''


def format_prior_outcome_line(prior_outcome: dict | None) -> str:
    if not isinstance(prior_outcome, dict):
        return ''
    pn = prior_outcome.get('phaseNumber') or prior_outcome.get('phase_number') or ''
    ok = prior_outcome.get('success')
    label = '成功' if ok else ('失败' if ok is False else '未知')
    text = truncate_text(str(prior_outcome.get('text') or ''), 120)
    if text:
        return f'【上一阶段结果】阶段{pn}：{label} — {text}'
    return f'【上一阶段结果】阶段{pn}：{label}'


def _legacy_prior_outcome_line(
    *,
    current_phase: int,
    prior_phases: list | None,
    case_data_store: dict | None,
) -> str:
    """One-line prior from last prior entry outcome only (no description dump)."""
    priors = _build_prior_entries(
        current_phase=current_phase,
        prior_phases=prior_phases,
        case_data_store=case_data_store,
    )
    if not priors:
        return ''
    last = priors[-1]
    outcome = last.get('outcome')
    if outcome:
        return format_prior_outcome_line({
            'phaseNumber': last['phaseNumber'],
            'success': outcome.get('success'),
            'text': outcome.get('text'),
        })
    return format_prior_outcome_line({'phaseNumber': last['phaseNumber']})


def format_phase_preamble(
    *,
    current_phase: int,
    current_task: str,
    prior_phases: list | None,
    case_data_store: dict | None,
    all_phases: list | None = None,
    prior_outcome: dict | None = None,
) -> str:
    """Return short catalog + one-line prior + 【当前任务】, or just task if disabled / empty.

    Does NOT append case-data hint — caller still uses format_case_data_hint.
    """
    task = (current_task or '').strip()
    if not phase_preamble_enabled():
        return task

    try:
        cur = int(current_phase)
    except (TypeError, ValueError):
        cur = 0

    blocks: list[str] = []
    catalog_phases = all_phases if isinstance(all_phases, list) and all_phases else None

    if catalog_phases:
        catalog = format_phase_catalog(catalog_phases, cur)
        if catalog:
            blocks.append(catalog)
        prior_line = format_prior_outcome_line(
            merge_prior_outcome(
                prior_outcome,
                case_data_store=case_data_store,
                current_phase=cur,
            )
        )
        if not prior_line:
            prior_line = _legacy_prior_outcome_line(
                current_phase=cur,
                prior_phases=prior_phases,
                case_data_store=case_data_store,
            )
        if prior_line:
            blocks.append(prior_line)
    else:
        prior_line = format_prior_outcome_line(
            merge_prior_outcome(
                prior_outcome,
                case_data_store=case_data_store,
                current_phase=cur,
            )
        )
        if not prior_line:
            prior_line = _legacy_prior_outcome_line(
                current_phase=cur,
                prior_phases=prior_phases,
                case_data_store=case_data_store,
            )
        if prior_line:
            blocks.append(prior_line)

    if not blocks:
        return task

    # Keep full catalog (all trajectory phases). Only truncate if absurdly large.
    preamble = '\n\n'.join(blocks)
    if len(preamble) > _PREAMBLE_TOTAL_MAX:
        preamble = truncate_text(preamble, _PREAMBLE_TOTAL_MAX)
    current_block = f'【当前任务 — 阶段{cur}】\n{task}' if cur else f'【当前任务】\n{task}'
    return f'{preamble}\n\n{current_block}'
