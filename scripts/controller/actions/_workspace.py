"""Workspace actions: read business date, picker-dialog query/select, tab management."""

import json

from scripts.state import _record_action
from ._helpers import _ok, _err, _as_dict
from ._js_snippets import (
    JS_READ_BUSINESS_DATE,
    JS_PICKER_DIALOG_QUERY,
    JS_PICKER_DIALOG_SELECT,
    JS_WORKSPACE_TABS,
    JS_CLOSE_VISIBLE_DIALOG,
)
from .replay_timing import WAIT_800_MS

_WORKSPACE_ACTIONS = ('list', 'activate', 'close')


def _workspace_result(result):
    """Normalize a page.evaluate JSON-string result into (ok, payload_str).

    JS snippets return ``JSON.stringify({ok: true, ...})`` / ``{ok: false, error}``;
    the codebase's ``_is_ok_result`` expects an ``ok``-prefixed string, so parse
    here: returns (True, 'ok:...') on success, (False, error string) otherwise.
    """
    parsed = _as_dict(result)
    if not isinstance(parsed, dict):
        return False, str(result)
    if parsed.get('ok'):
        return True, 'ok:' + json.dumps(parsed, ensure_ascii=False)
    return False, str(parsed.get('error') or result)


def _register_workspace_actions(controller, browser_context):
    @controller.action(
        'Read the business date (营业日期) that drives date-field defaults in the '
        'target system, from localStorage (keys: businessDate, databaseDate, tenantId). '
        'Call this BEFORE filling any date field — the system defaults to the business '
        'date, not today.'
    )
    async def read_business_date():
        page = await browser_context.get_current_page()
        result = await page.evaluate(JS_READ_BUSINESS_DATE)
        await page.wait_for_timeout(WAIT_800_MS)
        ok, payload = _workspace_result(result)
        if ok:
            _record_action('read_business_date', {}, payload)
            return _ok(payload)
        return payload

    @controller.action(
        'Fill query fields and click 查询 inside an el-dialog picker dialog '
        '(e.g. 选择对公授信客户). fields_json is a JSON array string like '
        '[{"label":"客户编号","value":"260831"}]. Returns row_count and the first 5 row texts.'
    )
    async def picker_dialog_query(dialog_name: str, fields_json: str):
        try:
            fields = json.loads(fields_json) if isinstance(fields_json, str) else fields_json
            if not isinstance(fields, list):
                raise ValueError('not a JSON array')
        except (ValueError, TypeError) as exc:
            return _err('invalid fields_json (expect [{"label":"...","value":"..."}]): %s' % exc)
        page = await browser_context.get_current_page()
        result = await page.evaluate(JS_PICKER_DIALOG_QUERY, [dialog_name, fields_json])
        # JS side polls for query rows internally (≤5s); this wait is a settling buffer.
        await page.wait_for_timeout(WAIT_800_MS)
        ok, payload = _workspace_result(result)
        if ok:
            _record_action('picker_dialog_query', {'dialog_name': dialog_name, 'fields': fields}, payload)
            return _ok(payload)
        return payload

    @controller.action(
        'Select the row whose text contains row_text in an el-dialog picker dialog, '
        'click its radio, then click the confirm button. Returns the underlying-page '
        'form fields (label→value) that changed after confirmation.'
    )
    async def picker_dialog_select(dialog_name: str, row_text: str):
        page = await browser_context.get_current_page()
        result = await page.evaluate(JS_PICKER_DIALOG_SELECT, [dialog_name, row_text])
        # JS side waits for dialog close + form backfill internally (≤5s); settling buffer.
        await page.wait_for_timeout(WAIT_800_MS)
        ok, payload = _workspace_result(result)
        if ok:
            # G3 refill gate: JS sets refill_verified:false when changed was empty
            # even after its internal 1500ms delayed re-read. Re-read once here and
            # re-run the SELECT once with the same row_text; if still empty, fail
            # explicitly instead of the old silent changed:{} success.
            try:
                payload_dict = json.loads(payload[3:]) if payload.startswith('ok:') else {}
            except Exception:
                payload_dict = {}
            if payload_dict.get('refill_verified') is False:
                retry_eval = await page.evaluate(JS_PICKER_DIALOG_SELECT, [dialog_name, row_text])
                await page.wait_for_timeout(WAIT_800_MS)
                ok2, payload2 = _workspace_result(retry_eval)
                if ok2:
                    try:
                        payload_dict2 = json.loads(payload2[3:]) if payload2.startswith('ok:') else {}
                    except Exception:
                        payload_dict2 = {}
                    if payload_dict2.get('refill_verified') is not False:
                        _record_action('picker_dialog_select', {'dialog_name': dialog_name, 'row_text': row_text}, payload2)
                        return _ok(payload2)
                return _err(
                    'err-refill-not-verified: 回填未观察 | dialog=%s row=%s | '
                    '确认后底层表单回填未发生（重选一次仍未观察到 changed 字段），'
                    '请检查选择是否命中正确行或改用其他选择方式' % (dialog_name, row_text)
                )
            _record_action('picker_dialog_select', {'dialog_name': dialog_name, 'row_text': row_text}, payload)
            return _ok(payload)
        return payload

    @controller.action(
        'Manage workspace tabs (.tag-item chips). action: "list" (returns all tabs with '
        'active/closable flags), "activate" or "close" by exact tab title (trimmed). '
        'The fixed 首页 tab cannot be closed (affix-tab-protected).'
    )
    async def workspace_tabs(action: str, tab_name: str = ''):
        if action not in _WORKSPACE_ACTIONS:
            return _err(
                "invalid action '%s' — expected one of: list, activate, close" % action
            )
        page = await browser_context.get_current_page()
        result = await page.evaluate(JS_WORKSPACE_TABS, [action, tab_name])
        if action != 'list':
            # activate/close take effect async — give the workspace time to switch.
            await page.wait_for_timeout(WAIT_800_MS)
        ok, payload = _workspace_result(result)
        if ok:
            _record_action('workspace_tabs', {'action': action, 'tab_name': tab_name}, payload)
            return _ok(payload)
        return payload

    @controller.action(
        'Close a business-foreign visible .el-dialog (客户360视图详情 / 身份识别, '
        '维护方案品种明细 residual state, ...). Never touches .el-drawer — drawers '
        'are handled by back/navigation. Clicks the topmost (or title-matching) '
        'visible dialog button in priority order: 取消 → 确 定/确定 → header X. '
        'Call this BEFORE the next step when get_page_state shows a dialog that '
        'does not belong to the current flow. Errors: err-dialog-not-found (no '
        'visible dialog) / err-dialog-not-closable:<title> (all buttons disabled '
        '— residual disableBtn state; do NOT retry in a loop, restore via '
        'refresh/navigate back to the list and re-enter the apply page instead).'
    )
    async def close_visible_dialog(dialog_title: str = ''):
        page = await browser_context.get_current_page()
        result = await page.evaluate(JS_CLOSE_VISIBLE_DIALOG, [dialog_title])
        await page.wait_for_timeout(WAIT_800_MS)
        ok, payload = _workspace_result(result)
        if ok:
            try:
                parsed = json.loads(payload[3:]) if payload.startswith('ok:') else {}
            except Exception:
                parsed = {}
            _record_action('close_visible_dialog', {
                'dialog_title': dialog_title,
                'closed': parsed.get('closed'),
                'via': parsed.get('via'),
            }, payload)
            return _ok(payload)
        return payload
