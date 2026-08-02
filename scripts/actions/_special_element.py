"""Special-element library reuse: execute pre-approved operation groups."""

from __future__ import annotations

from ._helpers import _ok, _err
from ._state import _record_action


def format_special_element_hint(candidates_store: dict | None) -> str:
    """Lightweight prompt hint listing current-phase special-element candidates."""
    if not candidates_store:
        return ''
    lines = []
    for cid, c in candidates_store.items():
        name = c.get('name') or cid
        label = c.get('dictLabel') or c.get('dict_label') or ''
        reasons = c.get('matchReasons') or c.get('match_reasons') or []
        step_count = c.get('stepCount') or c.get('step_count') or len(c.get('steps') or [])
        reason_txt = '；'.join(str(r) for r in reasons[:3]) if reasons else ''
        lines.append(
            f"- id={cid} name={name}"
            + (f" tag={label}" if label else '')
            + f" steps={step_count}"
            + (f" reasons={reason_txt}" if reason_txt else '')
        )
    if not lines:
        return ''
    return (
        '\n\n【特殊元素库候选 — 仅可对下列 id 调用 use_special_element；'
        '不要编造未列出的 id；页面状态匹配时优先复用】\n'
        + '\n'.join(lines)
    )


def replace_special_element_candidates(store: dict, candidates) -> dict:
    """Replace the whole store with this phase's candidates (no cross-phase accumulate)."""
    store.clear()
    if not candidates:
        return store
    items = candidates if isinstance(candidates, list) else []
    for c in items:
        if not isinstance(c, dict):
            continue
        cid = str(c.get('id') or '').strip()
        if not cid:
            continue
        store[cid] = c
    return store


def _register_special_element_actions(
    controller,
    browser_context,
    case_data_store,
    special_element_candidates_store,
):
    @controller.action(
        'Execute a pre-approved special-element operation group by id, '
        'chosen from the candidates offered for the current phase only. '
        'Use when the page matches a candidate complex component workflow.'
    )
    async def use_special_element(special_element_id: str):
        cid = str(special_element_id or '').strip()
        candidate = special_element_candidates_store.get(cid) if special_element_candidates_store else None
        if not candidate:
            return _err(f'special_element_id not offered for this phase:{cid}')

        entries = candidate.get('steps') or []
        if not entries:
            return _err(f'special_element empty steps:{cid}')

        # Normalize to replay_action_entries shape
        normalized = []
        for e in entries:
            if not isinstance(e, dict):
                continue
            action_name = e.get('action') or e.get('actionType') or e.get('action_type') or ''
            params = e.get('params') or e.get('paramsJson') or e.get('params_json') or {}
            element = e.get('element') or e.get('elementJson') or e.get('element_json')
            normalized.append({
                'id': e.get('id'),
                'action': action_name,
                'params': params if isinstance(params, dict) else {},
                'element': element if isinstance(element, dict) else None,
            })

        if not normalized:
            return _err(f'special_element no valid steps:{cid}')

        from ._replay import replay_action_entries

        # Build a fresh controller registry for nested replay (same pattern as session_runner)
        from ._builder import build_controller
        nested = build_controller(
            browser_context,
            case_data_store=case_data_store,
            special_element_candidates_store=special_element_candidates_store,
        )
        registry_actions = nested.registry.registry.actions

        result = await replay_action_entries(
            browser_context,
            normalized,
            controller_actions=registry_actions,
            case_data_store=case_data_store,
        )

        rows = result.get('results') or []
        for row, entry in zip(rows, normalized):
            _record_action(
                row.get('action') or entry.get('action') or '',
                row.get('params') or entry.get('params') or {},
                row.get('result'),
                element=entry.get('element'),
                source='special_element',
            )

        ok = int(result.get('ok') or 0)
        count = int(result.get('count') or len(normalized))
        failed = int(result.get('failed') or 0)
        msg = f'special_element {cid}: {ok}/{count} ok'
        if failed:
            return _err(msg)
        return _ok(msg, include_in_memory=True)
