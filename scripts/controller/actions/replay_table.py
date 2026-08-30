"""Replay table row-radio click (semantic first, then durable xpath).

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
    """Replay row radio: semantic first (fixed columns), then durable xpath."""
    # Late import: _replay.py imports this module back at module level.
    from ._replay import _element_xpath_smart, _replay_controller_action, _result_ok
    row_text = (
        params.get('row_text')
        or params.get('text')
        or params.get('row_match')
        or ''
    )
    row_text = str(row_text).strip()

    semantic = ''
    act = (controller_actions or {}).get('click_table_row_radio')
    if act and row_text:
        semantic = await _replay_controller_action(act, {'row_text': row_text})
        await page.wait_for_timeout(WAIT_400_MS)
        await _wait_if_loading(page)
        if _result_ok('click_table_row_radio', semantic):
            return f'{semantic} | locate=semantic-row'

    # Fallback: recorded xpath_smart / text durable click
    click_params = {**params, 'text': row_text or params.get('text') or ''}
    if _element_xpath_smart(entry) or click_params.get('text'):
        durable = await _replay_click_by_index(page, entry, click_params)
        if _result_ok('click_table_row_radio', durable):
            prefix = f'{semantic} | ' if semantic else ''
            return f'{prefix}{durable} | locate=durable-fallback'
        if semantic:
            return f'{semantic} | durable:{durable}'
        return durable

    if semantic:
        return semantic
    if act and not row_text:
        return 'row-text-empty'
    return 'unknown-action:click_table_row_radio'



