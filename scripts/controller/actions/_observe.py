"""Observe actions: unified semantic snapshot and pre-action context verification (both read-only)."""

from scripts.state import _record_action
from ._helpers import _ok
from ._js_snippets import JS_SEMANTIC_SNAPSHOT, JS_VERIFY_CONTEXT, JS_XHR_HOOK, JS_XHR_RECENT
from ._workspace import _workspace_result


def _register_observe_actions(controller, browser_context):
    @controller.action(
        'One-shot semantic snapshot of the current page (the cheap-observation ladder '
        'rung before full scans): context header (title/hash/breadcrumb/visible '
        'overlay/loading) + field list with stable refs (label/kind/value/disabled/'
        'required) + buttons/tables/tabs + counts. Prefer this over scan_visible_fields '
        'when you only need page identity and an inventory overview.'
    )
    async def semantic_snapshot():
        page = await browser_context.get_current_page()
        result = await page.evaluate(JS_SEMANTIC_SNAPSHOT)
        await page.wait_for_timeout(300)
        ok, payload = _workspace_result(result)
        if ok:
            _record_action('semantic_snapshot', {}, payload)
            return _ok(payload)
        return payload

    @controller.action(
        'Verify the page identity BEFORE acting (pre-action binding, read-only). '
        'expected_json criteria (all optional): overlay_contains / overlay_absent / '
        'breadcrumb_contains / hash_contains / header_contains / title_contains. '
        'Refuse to fill or click when ok:false — re-observe or navigate instead. '
        'With an empty {} it just returns the current context header.'
    )
    async def verify_context(expected_json: str = '{}'):
        page = await browser_context.get_current_page()
        result = await page.evaluate(JS_VERIFY_CONTEXT, [expected_json])
        await page.wait_for_timeout(300)
        ok, payload = _workspace_result(result)
        if ok:
            _record_action('verify_context', {'expected': expected_json}, payload)
            return _ok(payload)
        return payload

    @controller.action(
        'Read recent XHR/fetch requests captured by the injected network hook '
        '(window.__xhr_log: last 20 requests with url/status/responseBody truncated '
        'to 2KB). Use this when the frontend swallows a server rejection silently '
        '(no toast / no formErrors — e.g. doDclScmNextCheck code:100 gate) to read '
        'the real reason, or to verify a save actually fired (url_filter=saveOrUpdate) '
        'and its request/response carried the expected fields. On first call the hook '
        'is installed — historyTraced:false means earlier requests are NOT traceable; '
        're-trigger the request then read again. url_filter is a raw substring of the '
        'request URL; last caps the returned entries (default 10).'
    )
    async def read_xhr_log(url_filter: str = '', last: int = 10):
        page = await browser_context.get_current_page()
        installed = False
        try:
            installed = bool(await page.evaluate('() => !!window.__xhr_log_installed'))
        except Exception:
            installed = False
        if not installed:
            # Register the hook for future navigations too (best-effort), then
            # install on the live page. Requests made BEFORE this point are not
            # traceable (historyTraced=false).
            try:
                await page.add_init_script(JS_XHR_HOOK)
            except Exception:
                pass
            await page.evaluate(JS_XHR_HOOK)
        result = await page.evaluate(JS_XHR_RECENT, [url_filter, last, not installed])
        await page.wait_for_timeout(300)
        ok, payload = _workspace_result(result)
        if ok:
            _record_action('read_xhr_log', {'url_filter': url_filter, 'last': last}, payload)
            return _ok(payload)
        return payload
