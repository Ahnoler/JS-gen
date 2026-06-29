"""
Helper functions used by controller action implementations.

Includes browser interaction utilities (_wait_if_loading, _capture_element),
ARIA snapshot merging (_merge_ax_text), and ActionResult wrappers (_ok, _err).
"""

import json
import re

from browser_use.agent.views import ActionResult

from ._js_snippets import (
    JS_CHECK_LOADING, JS_WAIT_LOADING,
    JS_SMART_LOCATOR, JS_LOCATOR,
)
from .models import ScannedField


def _ok(msg):
    """Wrap a success string in ActionResult with is_done=False."""
    return ActionResult(extracted_content=str(msg), is_done=False)


def _err(msg):
    """Wrap an error string in ActionResult."""
    return ActionResult(extracted_content=str(msg), is_done=False, success=False)


async def _wait_if_loading(page):
    loading = await page.evaluate(JS_CHECK_LOADING)
    if loading:
        await page.evaluate(JS_WAIT_LOADING)


async def _capture_element(page, label_text):
    """Capture both attribute XPath (smart) and absolute XPath for a labeled form field."""
    result = {}
    try:
        raw = await page.evaluate(JS_SMART_LOCATOR, [label_text])
        if raw:
            info = json.loads(raw) if isinstance(raw, str) else raw
            if info.get('xpath'):
                result['xpath'] = info['xpath']
                result['tag_name'] = info.get('tag', 'input')
                result['attributes'] = info.get('attrs', {})
    except Exception:
        pass
    try:
        raw_abs = await page.evaluate(JS_LOCATOR, [label_text])
        if raw_abs:
            abs_info = json.loads(raw_abs) if isinstance(raw_abs, str) else raw_abs
            if abs_info.get('xpath'):
                result['absolute_xpath'] = abs_info['xpath']
    except Exception:
        pass
    return result if result else None


def _merge_ax_text(dom_fields: list[ScannedField], snapshot_text: str) -> None:
    """Parse aria_snapshot(mode='ai') text and merge AX values into DOM fields.

    Handles both textbox (with value) and combobox (with selected option).
    Mutates the ScannedField objects in-place.
    """
    if not snapshot_text:
        return
    # Collect AX entries: label → {value, disabled}
    ax_map: dict[str, dict] = {}
    _AX_LINE_RE = re.compile(
        r'(textbox|combobox|spinbutton|searchbox)\s+"([^"]+)"\s*'
        r'(?P<attrs>\[(?!ref=)[^\]]*\])*\s*\[ref=[^\]]+\]'
        r'(?::\s*["\']?(?P<value>[^\n]*?)(?:"\']?)?)?'
        r'$'
    )
    for line in snapshot_text.splitlines():
        m = _AX_LINE_RE.search(line)
        if not m:
            continue
        role = m.group(1)
        name = m.group(2).strip()
        attrs = m.group('attrs') or ''
        value = (m.group('value') or '').strip().strip('"').strip("'")
        disabled = '[disabled]' in attrs

        ax_map[name] = {'value': value, 'disabled': disabled, 'role': role}

    # Also capture option "[selected]" lines (format: option "{name}" [selected])
    _OPTION_RE = re.compile(r'option\s+"([^"]+)"\s*\[selected\]')
    # Attach selected options to their combobox parents by scanning previous lines
    prev_combobox: str | None = None
    for line in snapshot_text.splitlines():
        cm = _AX_LINE_RE.search(line)
        if cm and cm.group(1) in ('combobox', 'listbox'):
            prev_combobox = cm.group(2).strip()
        om = _OPTION_RE.search(line)
        if om and prev_combobox:
            selected = om.group(1).strip()
            if prev_combobox in ax_map:
                ax_map[prev_combobox]['value'] = selected
                ax_map[prev_combobox]['selected_text'] = selected

    # Merge AX data into ScannedField objects
    for f in dom_fields:
        label = (f.label or '').strip()
        if not label:
            continue
        ax = ax_map.get(label)
        if not ax:
            # Partial match: find AX entry whose name contains or is contained by field label
            for ax_name, ax_data in ax_map.items():
                if ax_name in label or label in ax_name:
                    ax = ax_data
                    break
        if not ax:
            continue
        # Update currentValue from AX if DOM value was empty
        if not (f.currentValue or '').strip() and ax['value']:
            f.currentValue = ax['value']
        # AX disabled flag
        if ax.get('disabled') and not f.disabled:
            f.disabled = True
        # AX role → kind mapping (only override if kind is unknown)
        if f.kind in ('unknown',):
            if ax['role'] in ('combobox', 'listbox'):
                f.kind = 'select'
            elif ax['role'] in ('textbox', 'spinbutton', 'searchbox'):
                f.kind = 'input'
