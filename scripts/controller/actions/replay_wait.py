"""Idle / tree-node waiters for replay (extracted verbatim from _replay.py)."""

import re
import time

from ._helpers import _wait_if_loading
from ._js_snippets import JS_CHECK_LOADING
from .replay_js import _JS_EDIT_FORM_INPUT_VISIBLE, _JS_PAGE_BUSY
from .replay_timing import WAIT_100_MS, WAIT_120_MS, WAIT_200_MS


_SAVE_BUTTON_TEXTS = frozenset({'保存', '提交'})


def _is_save_click_text(text: str) -> bool:
    t = re.sub(r'\s+', '', str(text or '').strip())
    return t in _SAVE_BUTTON_TEXTS


def _is_tree_node_entry(entry: dict | None, xpath_smart: str = '', xpath: str = '') -> bool:
    el = entry.get('element') if isinstance(entry, dict) and isinstance(entry.get('element'), dict) else {}
    if str(el.get('target_kind') or '') == 'tree_node':
        return True
    blob = ' '.join(
        str(x or '')
        for x in (
            xpath_smart,
            xpath,
            el.get('xpath_smart'),
            el.get('xpath'),
            el.get('cssSelector'),
            (el.get('attributes') or {}).get('class') if isinstance(el.get('attributes'), dict) else '',
        )
    )
    return 'el-tree-node__content' in blob or 'el-tree-node__label' in blob


def _is_trackable_request(request) -> bool:
    """XHR/fetch only — skip documents/assets; keep-alives are handled via soft timeout."""
    try:
        return request.resource_type in ('xhr', 'fetch')
    except Exception:
        return False


async def _wait_after_save_page_idle(
    page,
    *,
    timeout_ms: int = 10000,
    quiet_ms: int = 500,
) -> None:
    """After 保存/提交: wait until the page looks idle (DOM busy cues + xhr/fetch quiet).

    Broader than tree-reload detection: any save-triggered list/form/dialog refresh.
    Soft-exits if DOM is idle but a long-lived request never finishes (SPA poll).
    """
    inflight: set = set()

    def _on_request(req):
        if _is_trackable_request(req):
            inflight.add(req)

    def _on_done(req):
        inflight.discard(req)

    page.on('request', _on_request)
    page.on('requestfinished', _on_done)
    page.on('requestfailed', _on_done)
    try:
        # Let save XHR / loading mask have a moment to appear.
        await page.wait_for_timeout(WAIT_200_MS)
        await _wait_if_loading(page)

        deadline = time.monotonic() + timeout_ms / 1000.0
        quiet_since: float | None = None
        dom_idle_since: float | None = None

        while time.monotonic() < deadline:
            try:
                busy = str(await page.evaluate(_JS_PAGE_BUSY) or '')
            except Exception:
                busy = ''
            try:
                loading_mask = bool(await page.evaluate(JS_CHECK_LOADING))
            except Exception:
                loading_mask = False
            if loading_mask and not busy:
                busy = 'mask'

            net_busy = len(inflight) > 0

            if busy:
                if loading_mask or busy == 'mask':
                    await _wait_if_loading(page)
                quiet_since = None
                dom_idle_since = None
                await page.wait_for_timeout(WAIT_100_MS)
                continue

            # DOM idle
            now = time.monotonic()
            if dom_idle_since is None:
                dom_idle_since = now

            if net_busy:
                # Soft: if DOM stayed idle long enough, don't hang on keep-alive/poll.
                if (now - dom_idle_since) >= max(quiet_ms / 1000.0, 0.8) * 3:
                    break
                quiet_since = None
                await page.wait_for_timeout(WAIT_100_MS)
                continue

            if quiet_since is None:
                quiet_since = now
            elif (now - quiet_since) >= quiet_ms / 1000.0:
                break

            await page.wait_for_timeout(WAIT_100_MS)

        await page.wait_for_timeout(WAIT_120_MS)
        await _wait_if_loading(page)
    finally:
        try:
            page.remove_listener('request', _on_request)
            page.remove_listener('requestfinished', _on_done)
            page.remove_listener('requestfailed', _on_done)
        except Exception:
            pass


async def _wait_after_tree_node_for_form(page, *, timeout_ms: int = 5000) -> bool:
    """After tree node click: wait until right-side edit form input is visible.

    Soft wait — returns False on timeout without failing the click itself.
    """
    await _wait_if_loading(page)
    deadline = time.monotonic() + timeout_ms / 1000.0
    while time.monotonic() < deadline:
        try:
            if await page.evaluate(_JS_EDIT_FORM_INPUT_VISIBLE):
                await page.wait_for_timeout(WAIT_120_MS)
                return True
        except Exception:
            pass
        try:
            if await page.evaluate(JS_CHECK_LOADING):
                await _wait_if_loading(page)
        except Exception:
            pass
        await page.wait_for_timeout(WAIT_100_MS)
    return False
