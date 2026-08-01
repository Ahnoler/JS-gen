"""
Manual (human) DOM recorder — injects a page listener that captures user
interactions and maps them to controller ActionEntry (source=manual).

Flow:
  Dashboard 「开始人工录制」
    → Node POST /manual-record {enabled:true}
    → Python event manual_record_start
    → inject JS + page.on('console')
    → user clicks/fills in Chrome
    → console `__JSGEN_MANUAL__{...}`
    → map to ActionEntry → _ACTION_LOG → emit manual_action_recorded
    → Node appendRecordedStep(source=manual)

TODO (以后做 — 人工 click 的真实 highlight index):
  当前 click_element_by_index 的 params.index 固定为 -1，定位靠点击瞬间 xpath/text。
  原因：click 事件到达 Python 时页面往往已跳转，事后 get_state / selector_map 会偏。

  可行方案（预刷缓存 + mousedown 内存匹配）:
  1. Agent 空闲 / 人工录制开启时，周期性或按需 browser_context.get_state()，
     缓存当次 selector_map（xpath / attrs / text → index）。
  2. 页面侧改用 mousedown capture 上报（早于导航），用 bu_xpath 等与缓存做
     内存匹配得到 index，不再在 Python 侧事后 get_state。
  3. 未命中缓存时仍回退 index=-1 + xpath/text。
"""
from __future__ import annotations

import json
import sys
from typing import Callable, Optional

from ..actions._state import (
    _ACTION_LOG,
    _record_action,
    capture_page_png_b64,
    capture_screenshots_enabled,
    emit_step_screenshot,
    set_current_source,
)
from ..agent_utils import emit_json
from .js import JS_MANUAL_RECORDER
from .mapper import _map_dom_event_to_action


class ManualRecorder:
    """Manages inject + console/binding listener lifecycle for one browser_context."""

    def __init__(self, browser_context):
        self.browser_context = browser_context
        self.enabled = False
        self._console_handlers: dict[int, Callable] = {}  # page id → handler
        self._bound_pages: set[int] = set()
        self._binding_pages: set[int] = set()
        self._nav_hooks: set[int] = set()
        self._handle_lock = None  # asyncio.Lock, created lazily
        self._pending_before_b64: str | None = None

    async def start(self) -> dict:
        self.enabled = True
        page = await self.browser_context.get_current_page()
        await self._attach_page(page)

        # Best-effort: listen for new pages
        try:
            session = getattr(self.browser_context, 'session', None)
            ctx = getattr(session, 'context', None) if session else None
            if ctx is not None:
                def _on_page(p):
                    import asyncio
                    try:
                        asyncio.get_event_loop().create_task(self._attach_page(p))
                    except Exception:
                        pass
                ctx.on('page', _on_page)
        except Exception as e:
            sys.stderr.write(f'[manual-recorder] page listener skip: {e}\n')
            sys.stderr.flush()

        # Brief warm-up: skip focus-only clicks while inject/CDP paths settle
        try:
            await page.evaluate(
                '() => { window.__jsgenManualWarmUntil = Date.now() + 1200; }'
            )
        except Exception:
            pass

        emit_json({"event": "manual_record_status", "data": {"enabled": True}})
        sys.stderr.write('[manual-recorder] STARTED\n')
        sys.stderr.flush()
        return {"enabled": True}

    async def stop(self) -> dict:
        self.enabled = False
        # Disable flag in all pages
        for page_id in list(self._bound_pages):
            try:
                page = self._find_page(page_id)
                if page:
                    await page.evaluate('() => { window.__jsgenManualEnabled = false; }')
            except Exception:
                pass
        # Also try current page
        try:
            page = await self.browser_context.get_current_page()
            if page:
                await page.evaluate('() => { window.__jsgenManualEnabled = false; }')
        except Exception:
            pass
        emit_json({"event": "manual_record_status", "data": {"enabled": False}})
        sys.stderr.write('[manual-recorder] STOPPED\n')
        sys.stderr.flush()
        return {"enabled": False}

    def _find_page(self, page_id: int):
        return None  # best-effort; reinject uses current page

    def _pw_page(self, page):
        return getattr(page, 'page', page)

    async def _on_new_page(self, page):
        if self.enabled:
            await self._attach_page(page)

    async def _reinject(self, page):
        if not self.enabled:
            return
        try:
            await page.evaluate(JS_MANUAL_RECORDER)
            # Force enable even if install was a no-op leftover flag from init race
            await page.evaluate(
                '() => { window.__jsgenManualEnabled = true; window.__jsgenManualWarmUntil = Date.now() + 1200; }'
            )
        except Exception as e:
            sys.stderr.write(f'[manual-recorder] reinject failed: {e}\n')
            sys.stderr.flush()

    async def _ensure_binding(self, page) -> None:
        """Playwright expose_binding — more reliable than console.log on overridden pages."""
        target = self._pw_page(page)
        pid = id(target)
        if pid in self._binding_pages:
            return

        def _on_emit(source, payload):
            if not self.enabled:
                return
            if isinstance(payload, dict):
                self._schedule_payload(payload)
            elif isinstance(payload, str):
                try:
                    self._schedule_payload(json.loads(payload))
                except Exception:
                    pass

        try:
            await target.expose_binding('__jsgenManualEmit', _on_emit)
            self._binding_pages.add(pid)
            sys.stderr.write('[manual-recorder] binding __jsgenManualEmit ready\n')
            sys.stderr.flush()
        except Exception as e:
            # Already registered or unsupported — console fallback remains
            self._binding_pages.add(pid)
            sys.stderr.write(f'[manual-recorder] binding skip: {e}\n')
            sys.stderr.flush()

    async def _attach_page(self, page) -> None:
        if page is None:
            return
        pid = id(page)
        target = self._pw_page(page)

        await self._ensure_binding(page)

        # Survive full page reloads
        try:
            await target.add_init_script(JS_MANUAL_RECORDER)
        except Exception as e:
            sys.stderr.write(f'[manual-recorder] init_script skip: {e}\n')
            sys.stderr.flush()

        try:
            await page.evaluate(JS_MANUAL_RECORDER)
            await page.evaluate('() => { window.__jsgenManualEnabled = true; }')
        except Exception as e:
            sys.stderr.write(f'[manual-recorder] inject failed: {e}\n')
            sys.stderr.flush()
            return

        # Re-inject after navigations (SPA soft-nav may keep listeners; hard nav needs this)
        if pid not in self._nav_hooks:
            self._nav_hooks.add(pid)

            def _schedule_reinject(*_args):
                if not self.enabled:
                    return
                import asyncio
                try:
                    loop = asyncio.get_event_loop()
                    if loop.is_running():
                        loop.create_task(self._reinject(page))
                except Exception:
                    pass

            try:
                target.on('load', _schedule_reinject)
                target.on('framenavigated', lambda frame: (
                    _schedule_reinject() if frame == target.main_frame else None
                ))
            except Exception as e:
                sys.stderr.write(f'[manual-recorder] nav hook skip: {e}\n')
                sys.stderr.flush()

        if pid in self._bound_pages:
            return
        self._bound_pages.add(pid)

        def on_console(msg):
            if not self.enabled:
                return
            try:
                text = msg.text if hasattr(msg, 'text') else str(msg)
            except Exception:
                return
            if not text.startswith('__JSGEN_MANUAL__'):
                return
            raw = text[len('__JSGEN_MANUAL__'):]
            try:
                payload = json.loads(raw)
            except Exception:
                return
            self._schedule_payload(payload)

        try:
            target.on('console', on_console)
            self._console_handlers[pid] = on_console
        except Exception as e:
            sys.stderr.write(f'[manual-recorder] console bind failed: {e}\n')
            sys.stderr.flush()

    def _schedule_payload(self, payload: dict) -> None:
        """Queue async handling so click index can be resolved via DomService scan."""
        import asyncio

        async def _runner():
            try:
                await self._handle_payload_async(payload)
            except Exception as e:
                sys.stderr.write(f'[manual-recorder] handle failed: {e}\n')
                sys.stderr.flush()

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop is not None:
            try:
                loop.call_soon_threadsafe(lambda: loop.create_task(_runner()))
                return
            except Exception:
                try:
                    loop.create_task(_runner())
                    return
                except Exception:
                    pass

        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                loop.create_task(_runner())
                return
        except Exception:
            pass

        # Last resort: record without selector_map refresh
        self._record_mapped(_map_dom_event_to_action(payload))

    def ingest_external(self, payload: dict) -> None:
        """Ingest a payload from Node CDP BiB path (same shape as page inject)."""
        if not self.enabled or not isinstance(payload, dict):
            return
        import time
        sig = json.dumps(payload, sort_keys=True, ensure_ascii=False)[:500]
        now = time.time()
        last = getattr(self, '_ext_last', None)
        if last and last[0] == sig and now - last[1] < 0.45:
            return
        self._ext_last = (sig, now)
        self._schedule_payload(payload)

    async def _ensure_lock(self):
        import asyncio
        if self._handle_lock is None:
            self._handle_lock = asyncio.Lock()
        return self._handle_lock

    def _record_mapped(self, mapped) -> Optional[dict]:
        if not mapped:
            return None
        action_name, params, element = mapped
        try:
            set_current_source('manual')
            result = (
                f'manual:click_element_by_index'
                if action_name == 'click_element_by_index'
                else f'manual:{action_name}'
            )
            entry = _record_action(
                action_name, params,
                result,
                element=element,
                source='manual',
            )
        finally:
            set_current_source('agent')

        if not entry:
            return None

        emit_json({
            "event": "manual_action_recorded",
            "data": {
                "entry": entry,
                "count": len(_ACTION_LOG),
            },
        })
        sys.stderr.write(f'[manual-recorder] {action_name} {params}\n')
        sys.stderr.flush()
        return entry

    async def _record_mapped_async(self, mapped) -> Optional[dict]:
        """Record + optional before/after screenshots (manual path)."""
        before_b64 = self._pending_before_b64
        self._pending_before_b64 = None

        if capture_screenshots_enabled() and before_b64 is None:
            try:
                before_b64 = await capture_page_png_b64(self.browser_context)
            except Exception:
                before_b64 = None

        entry = self._record_mapped(mapped)
        if not entry:
            return None

        if capture_screenshots_enabled():
            after_b64 = None
            try:
                import asyncio
                await asyncio.sleep(0.08)
                after_b64 = await capture_page_png_b64(self.browser_context)
            except Exception:
                after_b64 = None
            eid = entry.get('id') if isinstance(entry, dict) else None
            if eid:
                emit_step_screenshot(str(eid), before_b64, after_b64)
        return entry

    async def _handle_payload_async(self, payload: dict) -> None:
        lock = await self._ensure_lock()
        async with lock:
            # before: first thing under the lock (user action already happened)
            before_b64 = None
            if capture_screenshots_enabled():
                try:
                    before_b64 = await capture_page_png_b64(self.browser_context)
                except Exception:
                    before_b64 = None
            self._pending_before_b64 = before_b64

            mapped = _map_dom_event_to_action(payload)
            if not mapped:
                self._pending_before_b64 = None
                sys.stderr.write(f'[manual-recorder] unmapped kind={payload.get("kind")}\n')
                sys.stderr.flush()
                return
            action_name, params, element = mapped
            # Manual click_element_by_index: keep index=-1 and xpath/text from the
            # DOM event at click time. Do NOT call get_state / selector_map — that
            # reflects the post-navigation page and skews index + xpath.
            if action_name == 'click_element_by_index':
                params['index'] = -1

            await self._record_mapped_async((action_name, params, element))


def asyncio_create_task(coro):
    import asyncio
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            return loop.create_task(coro)
    except Exception:
        pass
    return None
