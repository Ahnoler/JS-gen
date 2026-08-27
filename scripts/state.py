"""
Shared mutable state for the controller module.

Holds _ACTION_LOG and _TRAJECTORY_URL. All internal reads/writes
go through this module. The controller facade re-exports these
for external callers (session_runner, recorder, agent_utils).
"""

from .models import ActionEntry
import base64
import re
from urllib.parse import urlsplit

_ACTION_LOG: list[dict] = []
_TRAJECTORY_URL: str | None = None
_CURRENT_PHASE: int = 0
_CURRENT_SOURCE: str = 'agent'
_CAPTURE_SCREENSHOTS: bool = False

# Page-level screenshot registry: level_key -> snapshot dict.
# Keys are pageKey (`page:<origin><path>#<hash>`) and popupKey
# (`pageKey|dialog:<title>@@anchor:<xpath>`).
_PAGE_LEVEL_SHOTS: dict[str, dict] = {}
_CURRENT_PAGE_KEY: str = ''

# Actions that never become replay steps — skip before/after capture.
# Shared with scripts/script_assembler.py (imported there).
_SKIP_SCREENSHOT_ACTIONS = frozenset({
    'scroll_down', 'scroll_up', 'get_page_state', 'scan_form_fields', 'scan_visible_fields',
    'check_field_value', 'verify_field_value', 'take_screenshot',
    'save_trajectory', 'save_business_data', 'read_business_data',
    'use_special_element',
    'match_form_rule', 'init_task_list', 'get_pending_tasks', 'sync_tasks_from_errors',
    'expand_all_el_tree', 'task_done', 'task_retry',
    'save_form_snapshot',
    'wait_for_loading',
    'mark_field_done', 'rebuild_task_list',
})

# Action → old-format command mapping (legacy, mirrors models/action.py:ACTION_TO_COMMAND)
_ACTION_TO_COMMAND = {
    'fill_form_field': 'input',
    'select_option': 'select', 'select_tree_option': 'select',
    'click_element_by_index': 'click', 'click_menu_item': 'click',
    'click_table_row_button': 'click', 'click_table_row_radio': 'click',
    'click_adjacent_button': 'click', 'click_radio': 'click',
    'click_button': 'click',
    'switch_tab': 'tab', 'close_dialog': 'close',
    'wait_for_loading': 'wait', 'go_to_url': 'navigate',
    'expand_all_el_tree': 'expand',
}

# Consecutive ops on the same page element coalesce → keep the later step.
_FIELD_COALESCE_ACTIONS = frozenset({
    'fill_form_field',
    'select_option', 'select_tree_option', 'click_radio',
})


def set_current_phase(n: int):
    """Set the current phase number. Called by session_runner before each step."""
    global _CURRENT_PHASE
    _CURRENT_PHASE = n


def set_current_page_key(page_key: str):
    """Set the page-level key for subsequently recorded actions."""
    global _CURRENT_PAGE_KEY
    _CURRENT_PAGE_KEY = page_key or ''


def set_current_source(source: str):
    """Set recording source for subsequent _record_action calls (agent|manual|cdp)."""
    global _CURRENT_SOURCE
    _CURRENT_SOURCE = source if source in ('agent', 'manual', 'cdp') else 'agent'


def set_capture_screenshots(enabled: bool):
    """Enable/disable per-step before/after page.screenshot capture."""
    global _CAPTURE_SCREENSHOTS
    _CAPTURE_SCREENSHOTS = bool(enabled)


def reset_page_level_shots():
    """Clear the page-level screenshot registry when a recording session (re)starts."""
    global _PAGE_LEVEL_SHOTS, _CURRENT_PAGE_KEY
    _PAGE_LEVEL_SHOTS = {}
    _CURRENT_PAGE_KEY = ''


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


async def capture_page_dims_from_page(page) -> dict:
    """Document scroll size (CSS px) — the coordinate space of full-page screenshots.

    Used as the denominator for rect_norm (plugin-format aligned normalized
    0..1 coordinates relative to the page-level screenshot).
    """
    try:
        target = getattr(page, 'page', page)
        return await target.evaluate(
            "() => ({"
            "contentWidth: document.documentElement.scrollWidth,"
            "contentHeight: document.documentElement.scrollHeight})"
        ) or {}
    except Exception:
        return {}



def page_level_key_from_url(url: str) -> str:
    """Build a stable page key for SPA navigation.

    Keeps origin + path + hash route (SPA page identity); drops query params —
    both real search (`?x` before `#`) and query inside the hash fragment
    (`#/route?x=1`) — because they are usually volatile (timestamps, tokens,
    pagination state). In-fragment query also blew past screenshot.level_key
    VARCHAR(512) on long SUT URLs, failing the page_level insert entirely.
    """
    try:
        parts = urlsplit(url or '')
        base = f'{parts.scheme}://{parts.netloc}{parts.path}'.rstrip('/')
        if not base or base == '://':
            return ''
        key = f'page:{base}'
        if parts.fragment:
            key += f'#{parts.fragment.split("?")[0]}'
        return key
    except Exception:
        return f'page:{url or ""}'


def _stamp_rect_norm(el: dict) -> None:
    """Normalize page_bbox to 0..1 relative to the owning screenshot (plugin-format aligned).

    Page controls: page_bbox / page-level screenshot document size (meta.contentWidth/Height).
    Popup controls: (page_bbox - popup rect on page) / popup rect size — popup meta carries
    its document-coordinate rect; popup screenshot size == rect size (element screenshot).

    Requires page_bbox (document coords). bbox (content/scroll-root coords) is a different
    system and is NOT normalized here — skipping is safer than emitting wrong ratios.
    Registered-shot lookup falls back to a startswith match because stamp keys drop the
    ``@@anchor:`` suffix while registry keys may carry it.
    """
    pb = el.get('page_bbox')
    if not isinstance(pb, dict):
        return
    try:
        px1, py1 = float(pb['x1']), float(pb['y1'])
        px2, py2 = float(pb['x2']), float(pb['y2'])
    except (KeyError, TypeError, ValueError):
        return

    meta: dict = {}
    pkey = str(el.get('popup_level_key') or '').strip()
    if pkey:
        shot = _PAGE_LEVEL_SHOTS.get(pkey)
        if not shot:
            for k, v in _PAGE_LEVEL_SHOTS.items():
                if k.startswith(pkey):
                    shot = v
                    break
        meta = (shot or {}).get('meta') or {}
        r = meta.get('rect') if isinstance(meta.get('rect'), dict) else {}
        try:
            w = float(r['x2']) - float(r['x1'])
            h = float(r['y2']) - float(r['y1'])
            ox, oy = float(r['x1']), float(r['y1'])
        except (KeyError, TypeError, ValueError):
            return
    else:
        shot = _PAGE_LEVEL_SHOTS.get(_CURRENT_PAGE_KEY)
        meta = (shot or {}).get('meta') or {}
        try:
            w = float(meta['contentWidth'])
            h = float(meta['contentHeight'])
        except (KeyError, TypeError, ValueError):
            return
        ox, oy = 0.0, 0.0
    if w <= 0 or h <= 0:
        return
    el['rect_norm'] = {
        'x1': (px1 - ox) / w,
        'y1': (py1 - oy) / h,
        'x2': (px2 - ox) / w,
        'y2': (py2 - oy) / h,
    }


async def current_page_level(browser_context):
    """Return (page_key, display_name) for the current page."""
    try:
        page = await browser_context.get_current_page()
        if page is None:
            return '', ''
        target = getattr(page, 'page', page)
        url = target.url or ''
        key = page_level_key_from_url(url)
        try:
            title = (await target.title()).strip()
        except Exception:
            title = ''
        return key, title or key
    except Exception:
        return '', ''


def _register_page_level_shot(
    *,
    level_type: str,
    level_key: str,
    parent_level_key: str | None,
    display_name: str,
    png_b64: str,
    meta: dict | None,
) -> None:
    if not level_key or not png_b64:
        return
    snapshot = {
        'levelType': level_type,
        'levelKey': level_key,
        'parentLevelKey': parent_level_key or '',
        'displayName': display_name or level_key,
        'pngBase64': png_b64,
        'meta': meta or {},
    }
    _PAGE_LEVEL_SHOTS[level_key] = snapshot


def _emit_page_level_screenshot(snapshot: dict) -> None:
    try:
        from .agent_utils import emit_json
        emit_json({
            'event': 'page_level_screenshot',
            'data': snapshot,
        })
    except Exception:
        pass


async def register_current_page_screenshot(
    browser_context,
    *,
    png_b64: str | None = None,
    captured_at: str = 'phase-end',
) -> str:
    """Register (or replace) a page-level screenshot for the current page.

    ``captured_at`` marks the capture occasion (default ``phase-end`` keeps the
    existing per-phase callers' semantics; ``session-end`` marks the final shot
    taken right before the browser closes).
    """
    key, name = await current_page_level(browser_context)
    if not key:
        return ''
    if not png_b64:
        png_b64 = await capture_page_png_b64(browser_context, full_page=True)
    if not png_b64:
        return ''
    dims = {}
    try:
        page = await browser_context.get_current_page()
        if page is not None:
            dims = await capture_page_dims_from_page(page)
    except Exception:
        dims = {}
    meta = {'phaseNumber': _CURRENT_PHASE, 'capturedAt': captured_at}
    if dims.get('contentWidth') and dims.get('contentHeight'):
        meta['contentWidth'] = int(dims['contentWidth'])
        meta['contentHeight'] = int(dims['contentHeight'])
    _register_page_level_shot(
        level_type='page',
        level_key=key,
        parent_level_key=None,
        display_name=name,
        png_b64=png_b64,
        meta=meta,
    )
    _emit_page_level_screenshot(_PAGE_LEVEL_SHOTS[key])
    return key


async def register_page_screenshot_if_changed(
    browser_context,
    *,
    before_key: str = '',
    before_name: str = '',
    before_b64: str | None = None,
    before_dims: dict | None = None,
) -> tuple[str, str]:
    """Called after an action: if navigation changed the page, persist the pre-navigation page screenshot.

    ``before_dims`` is the pre-navigation document size ({contentWidth,contentHeight}),
    captured by the caller at the same moment as ``before_b64`` — required for
    rect_norm normalization of the leaving page (post-navigation dims would be wrong).

    Returns the post-action (page_key, page_name).
    """
    global _CURRENT_PAGE_KEY
    after_key, after_name = await current_page_level(browser_context)
    if before_key and before_b64 and before_key != after_key:
        meta = {'phaseNumber': _CURRENT_PHASE, 'capturedAt': 'before-leave'}
        if isinstance(before_dims, dict) and before_dims.get('contentWidth') and before_dims.get('contentHeight'):
            meta['contentWidth'] = int(before_dims['contentWidth'])
            meta['contentHeight'] = int(before_dims['contentHeight'])
        _register_page_level_shot(
            level_type='page',
            level_key=before_key,
            parent_level_key=None,
            display_name=before_name,
            png_b64=before_b64,
            meta=meta,
        )
        _emit_page_level_screenshot(_PAGE_LEVEL_SHOTS.get(before_key))
    if after_key:
        _CURRENT_PAGE_KEY = after_key
        if after_key not in _PAGE_LEVEL_SHOTS and before_key == after_key and before_b64:
            _register_page_level_shot(
                level_type='page',
                level_key=after_key,
                parent_level_key=None,
                display_name=after_name,
                png_b64=before_b64,
                meta={'phaseNumber': _CURRENT_PHASE, 'capturedAt': 'after-action'},
            )
            _emit_page_level_screenshot(_PAGE_LEVEL_SHOTS[after_key])
    return after_key, after_name


async def register_popup_screenshot(
    browser_context,
    *,
    page_key: str,
    dialog_title: str,
    anchor_xpath: str,
    dialog_b64: str,
    dialog_meta: dict | None = None,
) -> str:
    """Register one popup-level screenshot per popup key."""
    if not page_key or not dialog_b64:
        return ''
    title = (dialog_title or 'overlay').replace(r'\s+', ' ').strip()[:40]
    anchor = (anchor_xpath or '').strip()
    popup_key = f'{page_key}|dialog:{title}'
    if anchor:
        popup_key += f'@@anchor:{anchor}'
    meta = dict(dialog_meta or {})
    meta.setdefault('phaseNumber', _CURRENT_PHASE)
    meta['capturedAt'] = meta.get('capturedAt') or 'dialog-open'
    _register_page_level_shot(
        level_type='popup',
        level_key=popup_key,
        parent_level_key=page_key,
        display_name=title,
        png_b64=dialog_b64,
        meta=meta,
    )
    _emit_page_level_screenshot(_PAGE_LEVEL_SHOTS[popup_key])
    return popup_key


def _last_anchor_xpath_for_overlay() -> str:
    """Infer the most recent pre-dialog click step as the popup trigger anchor."""
    if len(_ACTION_LOG) < 2:
        return ''
    for entry in reversed(_ACTION_LOG[:-1]):
        el = (entry or {}).get('element') or {}
        action = str((entry or {}).get('action') or '')
        if not action.startswith('click_'):
            continue
        if _is_overlay_region(el.get('region_id') or ''):
            continue
        xpath = str(el.get('xpath_smart') or el.get('xpath') or '').strip()
        if xpath:
            return xpath
    return ''


async def capture_dialog_png_b64_from_page(page):
    """Capture the first visible dialog from an existing page handle."""
    if not capture_screenshots_enabled() or page is None:
        return None, None
    try:
        target = getattr(page, 'page', page)
        for selector in (
            '.el-dialog:visible', '.el-drawer:visible', '.el-message-box:visible',
            '.el-notification:visible',
        ):
            loc = target.locator(selector).first
            if await loc.count() == 0:
                continue
            try:
                rect = await loc.evaluate("""
                  (el) => {
                    const doc = document.scrollingElement || document.documentElement;
                    const sx = doc ? (doc.scrollLeft || 0) : 0;
                    const sy = doc ? (doc.scrollTop || 0) : 0;
                    const r = el.getBoundingClientRect();
                    return {
                      x1: Math.round(r.left + sx),
                      y1: Math.round(r.top + sy),
                      x2: Math.round(r.right + sx),
                      y2: Math.round(r.bottom + sy),
                    };
                  }
                """
              )
            except Exception:
                rect = {}
            png = await loc.screenshot(type='png')
            if not png:
                return None, None
            b64 = base64.b64encode(png).decode('ascii')
            title = ''
            try:
                title_el = loc.locator(
                    '.el-dialog__title, .el-drawer__title, .el-message-box__title, .el-notification__title'
                ).first
                if await title_el.count() > 0:
                    title = (await title_el.inner_text()).strip()
            except Exception:
                title = ''
            meta = {
                'dialog': True,
                'phaseNumber': _CURRENT_PHASE,
                'dialogKey': f'page-{_CURRENT_PHASE}|dialog:{title or "overlay"}',
                'dialogTitle': title or 'overlay',
                'anchorXpath': _last_anchor_xpath_for_overlay(),
                'rect': rect,
            }
            return b64, meta
        return None, None
    except Exception:
        return None, None


def _is_overlay_region(region_id) -> bool:
    """Check whether a region_id chain contains an overlay segment."""
    return _overlay_label_in_region(region_id) is not None


def _overlay_label_in_region(region_id) -> str | None:
    """Return the label of the first overlay segment in a region_id chain, or None.

    A region_id chain is ``role:label|role:label|...``; an overlay segment looks
    like ``overlay:新增客户``. The label is the text after the first ``:``.
    """
    if not region_id:
        return None
    for seg in str(region_id).split('|'):
        seg = seg.strip()
        if not seg:
            continue
        role, _, label = seg.partition(':')
        if role.strip() == 'overlay':
            return (label or '').strip() or 'overlay'
    return None


async def capture_dialog_png_b64(browser_context):
    """Capture the first visible Element UI dialog/drawer/message-box.

    Returns (base64_png, dialog_meta) or (None, None).
    """
    if not capture_screenshots_enabled():
        return None, None
    try:
        page = await browser_context.get_current_page()
        if page is None:
            return None, None
        target = getattr(page, 'page', page)
        for selector in ('.el-dialog:visible', '.el-drawer:visible', '.el-message-box:visible'):
            loc = target.locator(selector).first
            if await loc.count() == 0:
                continue
            try:
                rect = await loc.evaluate("""
                  (el) => {
                    const doc = document.scrollingElement || document.documentElement;
                    const sx = doc ? (doc.scrollLeft || 0) : 0;
                    const sy = doc ? (doc.scrollTop || 0) : 0;
                    const r = el.getBoundingClientRect();
                    return {
                      x1: Math.round(r.left + sx),
                      y1: Math.round(r.top + sy),
                      x2: Math.round(r.right + sx),
                      y2: Math.round(r.bottom + sy),
                    };
                  }
                """
              )
            except Exception:
                rect = {}
            png = await loc.screenshot(type='png')
            if not png:
                return None, None
            b64 = base64.b64encode(png).decode('ascii')
            title = ''
            try:
                title_el = loc.locator('.el-dialog__title, .el-drawer__title, .el-message-box__title').first
                if await title_el.count() > 0:
                    title = (await title_el.inner_text()).strip()
            except Exception:
                title = ''
            meta = {
                'dialog': True,
                'phaseNumber': _CURRENT_PHASE,
                'dialogKey': f'page-{_CURRENT_PHASE}|dialog:{title or "overlay"}',
                'dialogTitle': title or 'overlay',
                'anchorXpath': _last_anchor_xpath_for_overlay(),
                'rect': rect,
            }
            return b64, meta
        return None, None
    except Exception:
        return None, None


def emit_step_screenshot(
    entry_id: str,
    before_b64: str | None,
    after_b64: str | None,
    dialog_b64: str | None = None,
    dialog_meta: dict | None = None,
):
    """One-shot screenshot event — never attach bytes to _ACTION_LOG entries."""
    if not entry_id:
        return
    if not before_b64 and not after_b64 and not dialog_b64:
        return
    data = {
        "entryId": str(entry_id),
        "before": before_b64,
        "after": after_b64,
    }
    if dialog_b64:
        data["dialog"] = dialog_b64
        data["dialogMeta"] = dialog_meta or {}
    try:
        from .agent_utils import emit_json
        emit_json({
            "event": "step_screenshot",
            "data": data,
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
        dialog_b64 = None
        dialog_meta = None
        el = (entry.get('element') or {}) if isinstance(entry, dict) else {}
        if _is_overlay_region(el.get('region_id')):
            dialog_b64, dialog_meta = await capture_dialog_png_b64_from_page(page)
        emit_step_screenshot(str(entry['id']), before_b64, after_b64, dialog_b64, dialog_meta)
    return entry


def _emit_action_log_sync(removed_ids=None):
    """Push the full _ACTION_LOG to the Dashboard (optional removedIds for live-persist cleanup)."""
    try:
        from .agent_utils import emit_json
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

    if action_name == 'click_button':
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
    params_dict.pop("xpath_smart", None)
    resolved_source = source or _CURRENT_SOURCE or 'agent'

    entry = ActionEntry.from_record(
        action_name, params_dict,
        str(result) if result else '',
        element,
        phase=_CURRENT_PHASE,
        source=resolved_source,
    )

    dumped = entry.model_dump()
    if _CURRENT_PAGE_KEY and isinstance(dumped.get('element'), dict):
        el = dumped['element']
        el['page_level_key'] = _CURRENT_PAGE_KEY
        rid = str(el.get('region_id') or '').strip()
        if not rid.startswith(_CURRENT_PAGE_KEY):
            el['region_id'] = _CURRENT_PAGE_KEY + (f'|{rid}' if rid else '')
        overlay_label = _overlay_label_in_region(rid)
        if overlay_label:
            el['popup_level_key'] = f"{_CURRENT_PAGE_KEY}|dialog:{overlay_label}"
        _stamp_rect_norm(el)
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
        if last.get('action') == 'fill_form_field' and last.get('source') in ('manual', None):
            last_val = str((last.get('params') or {}).get('value') or '').strip()
            if click_text and last_val and (
                click_text == last_val
                or (
                    re.match(r'^\d{4}-\d{2}-\d{2}', last_val)
                    and re.match(r'^\d{4}-\d{2}-\d{2}$', click_text)
                )
            ):
                return None  # skip reopen noise; do not append / emit

    # Manual only: before coalescing fills, drop a junk click left from date-picker UI
    if (
        resolved_source == 'manual'
        and action_name == 'fill_form_field'
        and re.match(r'^\d{4}-\d{2}-\d{2}', str(params_dict.get('value') or '').strip())
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
