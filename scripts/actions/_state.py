"""
Shared mutable state for the controller module.

Holds _ACTION_LOG and _TRAJECTORY_URL. All internal reads/writes
go through this module. The controller.py facade re-exports these
for external callers (session_runner, recorder, agent_utils).
"""

from ..models import ActionEntry
import base64
import re

_ACTION_LOG: list[dict] = []
_TRAJECTORY_URL: str | None = None
_CURRENT_PHASE: int = 0
_CURRENT_SOURCE: str = 'agent'
_CAPTURE_SCREENSHOTS: bool = False

# Actions that never become replay steps — skip before/after capture.
# Shared with scripts/script_assembler.py (imported there).
_SKIP_SCREENSHOT_ACTIONS = frozenset({
    'scroll_down', 'scroll_up', 'get_page_state', 'scan_form_fields', 'scan_visible_fields',
    'check_field_value', 'verify_field_value', 'take_screenshot',
    'save_trajectory', 'save_case_data', 'read_case_data',
    'use_special_element',
    'match_form_rule', 'init_task_list', 'get_pending_tasks', 'sync_tasks_from_errors',
    'expand_all_el_tree', 'task_done', 'task_retry',
    'save_form_snapshot',
    'wait_for_loading', 'close_notification',
    'mark_field_done', 'rebuild_task_list',
})

# Action → old-format command mapping (legacy, mirrors models/action.py:ACTION_TO_COMMAND)
_ACTION_TO_COMMAND = {
    'fill_form_field': 'input', 'fill_date_field': 'input',
    'select_option': 'select', 'select_tree_option': 'select',
    'click_element_by_index': 'click', 'click_menu_item': 'click',
    'click_table_row_button': 'click', 'click_table_row_radio': 'click',
    'click_adjacent_button': 'click', 'click_radio': 'click',
    'click_icon_button': 'click',
    'switch_tab': 'tab', 'close_dialog': 'close',
    'wait_for_loading': 'wait', 'go_to_url': 'navigate',
    'expand_all_el_tree': 'expand',
}

# Consecutive ops on the same page element coalesce → keep the later step.
_FIELD_COALESCE_ACTIONS = frozenset({
    'fill_form_field', 'fill_date_field',
    'select_option', 'select_tree_option', 'click_radio',
})


def set_current_phase(n: int):
    """Set the current phase number. Called by session_runner before each step."""
    global _CURRENT_PHASE
    _CURRENT_PHASE = n


def set_current_source(source: str):
    """Set recording source for subsequent _record_action calls (agent|manual|cdp)."""
    global _CURRENT_SOURCE
    _CURRENT_SOURCE = source if source in ('agent', 'manual', 'cdp') else 'agent'


def set_capture_screenshots(enabled: bool):
    """Enable/disable per-step before/after page.screenshot capture."""
    global _CAPTURE_SCREENSHOTS
    _CAPTURE_SCREENSHOTS = bool(enabled)


def capture_screenshots_enabled() -> bool:
    return bool(_CAPTURE_SCREENSHOTS)


def should_skip_screenshot_action(action_name: str) -> bool:
    return (action_name or '') in _SKIP_SCREENSHOT_ACTIONS


async def capture_page_png_b64(browser_context, *, full_page: bool = True) -> str | None:
    """Best-effort Playwright screenshot → base64 PNG string (no data: prefix)."""
    if not capture_screenshots_enabled():
        return None
    try:
        page = await browser_context.get_current_page()
        if page is None:
            return None
        return await capture_page_png_b64_from_page(page, full_page=full_page)
    except Exception:
        return None


async def capture_page_png_b64_from_page(page, *, full_page: bool = True) -> str | None:
    """Screenshot from an existing page/handle (auto-fill already holds ``page``)."""
    if not capture_screenshots_enabled() or page is None:
        return None
    try:
        target = getattr(page, 'page', page)
        png = await target.screenshot(full_page=full_page, type='png')
        if not png:
            return None
        return base64.b64encode(png).decode('ascii')
    except Exception:
        return None


def emit_step_screenshot(entry_id: str, before_b64: str | None, after_b64: str | None):
    """One-shot screenshot event — never attach bytes to _ACTION_LOG entries."""
    if not entry_id:
        return
    if not before_b64 and not after_b64:
        return
    try:
        from ..agent_utils import emit_json
        emit_json({
            "event": "step_screenshot",
            "data": {
                "entryId": str(entry_id),
                "before": before_b64,
                "after": after_b64,
            },
        })
    except ImportError:
        pass


async def record_action_with_screenshots(
    page,
    action_name,
    params,
    result,
    element=None,
    source=None,
    *,
    before_b64: str | None = None,
):
    """_record_action + after shot + step_screenshot (for paths that bypass controller.action).

    Pass ``before_b64`` captured before the DOM mutation when possible.
    """
    after_b64 = None
    if capture_screenshots_enabled():
        try:
            after_b64 = await capture_page_png_b64_from_page(page)
        except Exception:
            after_b64 = None
    entry = _record_action(action_name, params, result, element=element, source=source)
    if isinstance(entry, dict) and entry.get('id'):
        emit_step_screenshot(str(entry['id']), before_b64, after_b64)
    return entry


def _emit_action_log_sync(removed_ids=None):
    """Push the full _ACTION_LOG to the Dashboard (optional removedIds for live-persist cleanup)."""
    try:
        from ..agent_utils import emit_json
        data = {
            "entries": list(_ACTION_LOG),
            "count": len(_ACTION_LOG),
        }
        if removed_ids:
            data["removedIds"] = [str(x) for x in removed_ids if x]
        emit_json({"event": "action_log_sync", "data": data})
    except ImportError:
        pass


def _element_identity(action_name, params_dict, element=None) -> str | None:
    """Stable key for 'same page element' coalesce, or None if unknown."""
    params = params_dict or {}
    label = str(params.get('label_text') or '').strip()
    if action_name in _FIELD_COALESCE_ACTIONS and label:
        return f'field:{label}'

    el = element if isinstance(element, dict) else {}
    xpath = str(
        (el or {}).get('xpath')
        or (el or {}).get('xpath_smart')
        or (el or {}).get('bu_xpath')
        or ''
    ).strip()
    if xpath:
        return f'xpath:{xpath}'

    if action_name == 'click_icon_button':
        text = str(params.get('button_text') or '').strip()
        if text:
            return f'icon:{text}'
    if action_name == 'click_menu_item':
        text = str(params.get('menu_text') or '').strip()
        if text:
            return f'menu:{text}'
    if action_name == 'switch_tab':
        text = str(params.get('tab_name') or '').strip()
        if text:
            return f'tab:{text}'
    if action_name == 'click_adjacent_button' and label:
        return f'adjacent:{label}'
    return None


def _entry_element_identity(entry: dict) -> str | None:
    if not isinstance(entry, dict):
        return None
    return _element_identity(
        entry.get('action') or '',
        entry.get('params') or {},
        entry.get('element'),
    )


def _record_action(action_name, params, result, element=None, source=None):
    """Record a controller action call using ActionEntry model."""
    global _TRAJECTORY_URL
    params_dict = dict(params) if params else {}
    resolved_source = source or _CURRENT_SOURCE or 'agent'

    entry = ActionEntry.from_record(
        action_name, params_dict,
        str(result) if result else '',
        element,
        phase=_CURRENT_PHASE,
        source=resolved_source,
    )

    dumped = entry.model_dump()
    removed_ids: list[str] = []

    # Manual only: drop date-picker reopen clicks that echo the just-selected date
    # (CDP quick actions record as-is — no coalesce / noise filter)
    if (
        resolved_source == 'manual'
        and action_name == 'click_element_by_index'
        and _ACTION_LOG
    ):
        click_text = str(params_dict.get('text') or '').strip()
        last = _ACTION_LOG[-1]
        if last.get('action') == 'fill_date_field' and last.get('source') in ('manual', None):
            last_val = str((last.get('params') or {}).get('value') or '').strip()
            if click_text and (click_text == last_val or re.match(r'^\d{4}-\d{2}-\d{2}$', click_text)):
                return None  # skip reopen noise; do not append / emit

    # Manual only: before coalescing fills, drop a junk click left from date-picker UI
    if (
        resolved_source == 'manual'
        and action_name == 'fill_date_field'
        and _ACTION_LOG
    ):
        last = _ACTION_LOG[-1]
        if last.get('action') == 'click_element_by_index' and last.get('source') in ('manual', None):
            last_text = str((last.get('params') or {}).get('text') or '').strip()
            date_val = str(params_dict.get('value') or '').strip()
            if (
                (last_text.isdigit() and 1 <= int(last_text) <= 31)
                or bool(re.match(r'^\d{4}-\d{2}-\d{2}$', last_text))
                or (date_val and last_text == date_val)
            ):
                popped = _ACTION_LOG.pop()
                pid = popped.get('id') if isinstance(popped, dict) else None
                if pid:
                    removed_ids.append(str(pid))

    # Agent + manual: consecutive ops on the same page element → keep later only.
    # (CDP quick actions record as-is.) Covers auto-fill then agent re-fill of same label.
    if resolved_source in ('agent', 'manual') and _ACTION_LOG:
        new_id = _element_identity(action_name, params_dict, element)
        if new_id:
            last = _ACTION_LOG[-1]
            last_src = last.get('source') or 'agent'
            if last_src == resolved_source or (
                resolved_source == 'manual' and last_src in ('manual', None)
            ):
                last_id = _entry_element_identity(last)
                if last_id and last_id == new_id:
                    popped = _ACTION_LOG.pop()
                    pid = popped.get('id') if isinstance(popped, dict) else None
                    if pid:
                        removed_ids.append(str(pid))

    # Do NOT drop a preceding click when recording select_option — that click is often
    # 「新增」/导航等真实步骤。Opening the dropdown is skipped at capture time instead.

    _ACTION_LOG.append(dumped)
    if action_name == 'go_to_url' and params_dict.get('url'):
        _TRAJECTORY_URL = params_dict['url']

    _emit_action_log_sync(removed_ids or None)
    return dumped
