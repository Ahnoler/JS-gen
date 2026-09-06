"""Replay click-by-index without ephemeral highlight index.

Extracted from _replay.py. _replay.py re-exports these names for compat.
"""

import sys

from ._helpers import _wait_if_loading
from .replay_js import _JS_CLICK_DURABLE
from .replay_wait import (
    _is_save_click_text,
    _is_tree_node_entry,
    _wait_after_save_page_idle,
    _wait_after_tree_node_for_form,
)
from .replay_timing import WAIT_300_MS, WAIT_400_MS, WAIT_600_MS, CLICK_TIMEOUT_MS


async def _replay_click_by_index(page, entry: dict, params: dict) -> str:
    """
    Replay click_element_by_index without relying on ephemeral highlight index.

    Prefer xpath_smart / drawer-scoped text (same idea as script_assembler).
    """
    await _wait_if_loading(page)
    el = entry.get('element') if isinstance(entry.get('element'), dict) else {}
    text = str(
        params.get('text')
        or params.get('menu_text')
        or el.get('text')
        or ''
    ).strip()
    cands = el.get('candidates') if isinstance(el.get('candidates'), list) else []

    def _cand(ctype: str) -> str:
        for c in cands:
            if isinstance(c, dict) and c.get('type') == ctype and c.get('value'):
                return str(c['value'])
        return ''

    xpath_smart = str(
        el.get('xpath_smart')
        or _cand('xpath_smart')
        or ''
    ).strip()
    # If primary target is already a smart-style xpath, treat it as smart
    target = str(entry.get('target') or el.get('xpath') or '').strip()
    if not xpath_smart and target.startswith('//'):
        xpath_smart = target
    xpath_full = str(
        el.get('xpath_full')
        or el.get('xpath_abs')
        or _cand('xpath_full')
        or params.get('xpath')
        or (entry.get('attributes') or {}).get('xpath')
        or ''
    ).strip()
    # Absolute xpath only as fallback (avoid using smart twice)
    xpath = xpath_full
    if not xpath and target and not target.startswith('//'):
        xpath = target
    tag_hint = str(params.get('tag_name') or entry.get('tagName') or el.get('tag') or '').strip()
    parent_text = str(
        params.get('parent_text')
        or el.get('parent_text')
        or ''
    ).strip()
    icon_class = str(
        params.get('icon_class')
        or el.get('icon_class')
        or el.get('className')
        or el.get('class')
        or ''
    ).strip()
    target_kind = str(
        params.get('target_kind')
        or el.get('target_kind')
        or el.get('kind')
        or ''
    ).strip()
    if not target_kind:
        blob = (xpath_smart + ' ' + icon_class).lower()
        action_name = str(entry.get('action') or '').lower()
        if 'el-tree-node' in blob:
            target_kind = 'tree_node'
        elif 'el-icon-' in blob or 'click_icon' in action_name:
            target_kind = 'icon'
    opts = {
        'parentText': parent_text,
        'iconClass': icon_class,
        'targetKind': target_kind,
    }
    result = await page.evaluate(_JS_CLICK_DURABLE, [text, xpath, tag_hint, xpath_smart, opts])
    if isinstance(result, str) and result.startswith('ok'):
        await _post_click_settle(page, entry, text, xpath_smart, xpath, result)
        return result

    # Playwright text click — prefer last visible button (overlay remounts)
    if text:
        try:
            loc = page.get_by_role('button', name=text, exact=True).last
            await loc.click(timeout=CLICK_TIMEOUT_MS)
            await _post_click_settle(page, entry, text, xpath_smart, xpath, 'ok-playwright-role-last')
            return 'ok-playwright-role-last'
        except Exception:
            pass
        try:
            await page.get_by_text(text, exact=True).last.click(timeout=CLICK_TIMEOUT_MS)
            await _post_click_settle(page, entry, text, xpath_smart, xpath, 'ok-playwright-text-last')
            return 'ok-playwright-text-last'
        except Exception:
            try:
                await page.locator(f'text={text}').last.click(timeout=CLICK_TIMEOUT_MS)
                await _post_click_settle(page, entry, text, xpath_smart, xpath, 'ok-playwright-text-loose')
                return 'ok-playwright-text-loose'
            except Exception:
                pass

    index = params.get('index')
    return (
        f'click-failed:index={index} (ephemeral; text/xpath not found: {text!r})'
        if index is not None
        else f'click-failed:not-found text={text!r} xpath={xpath_smart or xpath!r}'
    )


async def _post_click_settle(
    page,
    entry: dict | None,
    text: str,
    xpath_smart: str,
    xpath: str,
    click_result: str,
) -> None:
    """Post-click waits: save→tree reload settle; tree node→edit form visible; else short pause."""
    if _is_save_click_text(text):
        await _wait_after_save_page_idle(page)
        return
    if _is_tree_node_entry(entry, xpath_smart, xpath):
        await page.wait_for_timeout(WAIT_300_MS)
        await _wait_if_loading(page)
        appeared = await _wait_after_tree_node_for_form(page)
        if not appeared:
            sys.stderr.write('[replay] tree-node click: edit form input not visible within timeout\n')
            sys.stderr.flush()
        return
    wait_ms = WAIT_600_MS if ('expand' in click_result or 'submenu' in click_result) else WAIT_400_MS
    await page.wait_for_timeout(wait_ms)
    await _wait_if_loading(page)


