"""Observe actions: unified semantic snapshot and pre-action context verification (both read-only)."""

import json

from scripts.state import _record_action
from ._helpers import _ok
from ._js_snippets import JS_SEMANTIC_SNAPSHOT, JS_VERIFY_CONTEXT
from ._workspace import _workspace_result


def _register_observe_actions(controller, browser_context, business_data_store=None):
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
        'read feedback already recorded for recent steps; does not scan the page'
    )
    async def read_step_feedback(last: int = 5):
        from scripts.agent.step_feedback import read_step_feedback_rows
        rows = read_step_feedback_rows(business_data_store, last)
        if not rows:
            return 'no-step-feedback'
        return json.dumps(rows, ensure_ascii=False)
