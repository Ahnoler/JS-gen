"""Replay table row-radio click (structural xpath first when recorded).

Extracted from _replay.py. _replay.py re-exports _replay_table_row_radio for compat.
"""

from ._helpers import _wait_if_loading
from .replay_click import _replay_click_by_index
from .replay_timing import WAIT_400_MS


async def _replay_table_row_radio(
    page,
    entry: dict,
    params: dict,
    *,
    controller_actions: dict | None = None,
) -> str:
    """Replay row radio: structural xpath first when recorded, else semantic then durable."""
    # Late import: _replay.py imports this module back at module level.
    from ._replay import _element_xpath_smart, _replay_controller_action, _result_ok
    row_text = (
        params.get('row_text')
        or params.get('text')
        or params.get('row_match')
        or ''
    )
    row_text = str(row_text).strip()

    act = (controller_actions or {}).get('click_table_row_radio')
    click_params = {**params, 'text': row_text or params.get('text') or ''}
    smart_xpath = _element_xpath_smart(entry)

    durable = ''
    # locate=xpath-first: spec §6 — structural xpath before semantic row_text
    if smart_xpath:
        durable = await _replay_click_by_index(page, entry, click_params)
        await page.wait_for_timeout(WAIT_400_MS)
        await _wait_if_loading(page)
        if _result_ok('click_table_row_radio', durable):
            return f'{durable} | locate=xpath-first'

    semantic = ''
    if act and row_text:
        semantic = await _replay_controller_action(act, {'row_text': row_text})
        await page.wait_for_timeout(WAIT_400_MS)
        await _wait_if_loading(page)
        if _result_ok('click_table_row_radio', semantic):
            prefix = f'{durable} | ' if durable else ''
            locate = 'semantic-fallback' if smart_xpath else 'semantic-row'
            return f'{prefix}{semantic} | locate={locate}'

    # Legacy: no structural xpath — semantic first above, durable as last resort
    if not smart_xpath and (click_params.get('text') or _element_xpath_smart(entry)):
        if not durable:
            durable = await _replay_click_by_index(page, entry, click_params)
        if _result_ok('click_table_row_radio', durable):
            prefix = f'{semantic} | ' if semantic else ''
            return f'{prefix}{durable} | locate=durable-fallback'
        if semantic:
            return f'{semantic} | durable:{durable}'
        return durable

    if smart_xpath and durable:
        if semantic:
            return f'{semantic} | durable:{durable}'
        return durable

    if semantic:
        return semantic
    if act and not row_text:
        return 'row-text-empty'
    return 'unknown-action:click_table_row_radio'
