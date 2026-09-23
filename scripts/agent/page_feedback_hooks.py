"""Rebind recording observers onto every page, including tabs opened later."""
from __future__ import annotations

import asyncio
import sys
import weakref

# Page/context objects, not id(). A closed page can be collected and its id reused.
# id() fallback is only for objects that cannot be weak-referenced.
_attached_pages: weakref.WeakSet = weakref.WeakSet()
_attached_ids: set[int] = set()
_console_bound: weakref.WeakSet = weakref.WeakSet()
_console_ids: set[int] = set()
_xhr_contexts: weakref.WeakSet = weakref.WeakSet()
_xhr_context_ids: set[int] = set()
_page_hook_tasks: set[asyncio.Task] = set()


def _target(page):
    return getattr(page, "page", page)


def _seen(bucket: weakref.WeakSet, fallback: set[int], obj) -> bool:
    try:
        if obj in bucket:
            return True
    except TypeError:
        return id(obj) in fallback
    return False


def _remember(bucket: weakref.WeakSet, fallback: set[int], obj) -> None:
    try:
        bucket.add(obj)
    except TypeError:
        fallback.add(id(obj))


def _bind_console(target, store) -> bool:
    from scripts.agent.console_feedback import push_console_line

    if _seen(_console_bound, _console_ids, target):
        return True

    def on_console(msg):
        try:
            if getattr(msg, "type", "") != "error":
                return
            text = msg.text if hasattr(msg, "text") else str(msg)
        except Exception:
            return
        push_console_line(store, level="error", text=text)

    def on_pageerror(err):
        try:
            push_console_line(store, level="pageerror", text=getattr(err, "message", None) or str(err))
        except Exception:
            return

    try:
        target.on("console", on_console)
        target.on("pageerror", on_pageerror)
    except Exception as exc:
        sys.stderr.write(f"[step-feedback] console hook failed: {exc}\n")
        sys.stderr.flush()
        return False
    _remember(_console_bound, _console_ids, target)
    return True


async def _attach_page(page, xhr_hook: str, store) -> None:
    if page is None:
        return
    target = _target(page)
    if _seen(_attached_pages, _attached_ids, target):
        return
    console_ok = _bind_console(target, store)
    try:
        from scripts.browser.factory import attach_native_dialog_accept
        attach_native_dialog_accept(target)
    except Exception as exc:
        sys.stderr.write(f"[step-feedback] dialog hook failed: {exc}\n")
        sys.stderr.flush()
    try:
        await target.add_init_script(xhr_hook)
        await target.evaluate(xhr_hook)
    except Exception as exc:
        sys.stderr.write(f"[step-feedback] xhr hook failed: {exc}\n")
        sys.stderr.flush()
        return
    if console_ok:
        _remember(_attached_pages, _attached_ids, target)


async def install_recording_page_hooks(browser_context, business_data_store=None) -> None:
    """Install xhr, console/pageerror, and dialog accept on current and future pages."""
    from scripts.controller.actions._js_snippets import JS_XHR_HOOK

    session = getattr(browser_context, "session", None)
    ctx = getattr(session, "context", None) if session else None
    pages = []
    if ctx is not None:
        if not _seen(_xhr_contexts, _xhr_context_ids, ctx):
            try:
                await ctx.add_init_script(JS_XHR_HOOK)
            except Exception as exc:
                sys.stderr.write(f"[step-feedback] context xhr init failed: {exc}\n")
                sys.stderr.flush()

            def _on_page(new_page):
                try:
                    task = asyncio.get_running_loop().create_task(
                        _attach_page(new_page, JS_XHR_HOOK, business_data_store)
                    )
                    _page_hook_tasks.add(task)
                    task.add_done_callback(_page_hook_tasks.discard)
                except Exception as exc:
                    sys.stderr.write(f"[step-feedback] new page hook failed: {exc}\n")
                    sys.stderr.flush()

            try:
                ctx.on('page', _on_page)
            except Exception as exc:
                sys.stderr.write(f"[step-feedback] page listener failed: {exc}\n")
                sys.stderr.flush()
            else:
                _remember(_xhr_contexts, _xhr_context_ids, ctx)
        try:
            pages = list(ctx.pages or [])
        except Exception:
            pages = []
    if not pages:
        try:
            current = await browser_context.get_current_page()
        except Exception:
            current = None
        if current is not None:
            pages = [current]
    for page in pages:
        await _attach_page(page, JS_XHR_HOOK, business_data_store)
