"""Map DOM event payloads to controller ActionEntry tuples."""
from __future__ import annotations

import re
from typing import Optional


def _xpath_literal(text: str) -> str:
    t = str(text or '')
    if "'" not in t:
        return f"'{t}'"
    if '"' not in t:
        return f'"{t}"'
    parts = t.split("'")
    return 'concat(' + ', "\'", '.join(f"'{p}'" for p in parts) + ')'


def _build_xpath_smart(tag: str, text: str, xpath_abs: str = '', class_name: str = '') -> str:
    """Text-anchored xpath for buttons/links — stable across dialog remounts."""
    t = re.sub(r'\s+', ' ', str(text or '')).strip()[:40]
    if not t:
        return ''
    tag_l = (tag or '').lower()
    cls = class_name or ''
    clickable = tag_l in ('button', 'a') or bool(re.search(r'(?:^|\s)el-button(?:\s|$)', cls))
    if not clickable:
        return ''
    lit = _xpath_literal(t)
    local = f'a[normalize-space()={lit}]' if tag_l == 'a' else f'button[normalize-space()={lit}]'
    abs_l = xpath_abs or ''
    if re.search(r'el-drawer', abs_l, re.I) or re.search(r'el-drawer', cls, re.I):
        return f"(//div[contains(@class,'el-drawer')])[last()]//{local}"
    if re.search(r'el-dialog|el-message-box', abs_l, re.I) or re.search(
        r'el-dialog|el-message-box', cls, re.I
    ):
        return (
            "(//div[contains(@class,'el-dialog') or contains(@class,'el-message-box')])[last()]"
            f"//{local}"
        )
    return f'//{local}'


def _map_dom_event_to_action(payload: dict) -> Optional[tuple[str, dict, Optional[dict]]]:
    """
    Map a DOM event payload to (action_name, params, element_info).
    Returns None if the event should be ignored.

    Manual click_element_by_index always uses index=-1; locate via xpath/text.
    """
    kind = (payload.get('kind') or '').strip()
    attrs = payload.get('attributes') or {}
    text = payload.get('text') or attrs.get('title') or ''
    text = re.sub(r'\s+', ' ', str(text or '')).strip()
    abs_xp = payload.get('xpath_abs') or payload.get('xpath_full') or ''
    bu = payload.get('bu_xpath') or ''
    smart = payload.get('xpath_smart') or ''
    tag = payload.get('tag') or ''
    cls = str(attrs.get('class') or attrs.get('className') or '')
    if not smart:
        smart = _build_xpath_smart(tag, text, abs_xp or str(payload.get('xpath') or ''), cls)
    css = payload.get('cssSelector') or payload.get('css_selector') or ''
    primary = smart or bu or payload.get('xpath') or abs_xp or ''
    candidates = payload.get('candidates')
    if not isinstance(candidates, list) or not candidates:
        candidates = []
        if smart:
            candidates.append({'type': 'xpath_smart', 'value': smart})
        if abs_xp:
            candidates.append({'type': 'xpath_full', 'value': abs_xp})
        elif primary and primary != smart:
            candidates.append({'type': 'xpath_full', 'value': primary})
        if css:
            candidates.append({'type': 'css', 'value': css})
    element = {
        'xpath': primary,
        'bu_xpath': bu,
        'xpath_abs': abs_xp or payload.get('xpath') or '',
        'xpath_full': abs_xp or '',
        'xpath_smart': smart,
        'tag_name': tag,
        'css_selector': css,
        'attributes': attrs,
        'text': text,
        'candidates': candidates,
    }

    if kind == 'fill':
        label = (payload.get('label_text') or '').strip()
        value = payload.get('value')
        if value is None:
            return None
        if not label and not element['xpath']:
            return None
        # Prefer labeled form fills for assembler
        if label:
            return 'fill_form_field', {'label_text': label, 'value': value}, element
        return 'fill_form_field', {'label_text': label or element['xpath'], 'value': value}, element

    if kind == 'fill_date':
        label = (payload.get('label_text') or '').strip()
        value = (payload.get('value') or '').strip()
        if not label or not value:
            return None
        return 'fill_date_field', {'label_text': label, 'value': value}, element

    if kind == 'select_option':
        label = (payload.get('label_text') or '').strip()
        option = (payload.get('option_text') or '').strip()
        if not option:
            return None
        return 'select_option', {'label_text': label or option, 'option_text': option}, element

    def _as_click_by_index(text: str):
        """Manual clicks → click_element_by_index with index=-1 (xpath/text locate only)."""
        t = (text or '').strip()
        if not t and not element.get('xpath') and not element.get('bu_xpath'):
            return None
        # Reject junk hits: empty body-level shells like /div[2] (teleport/mask)
        tag = (element.get('tag_name') or '').lower()
        attrs_map = element.get('attributes') or {}
        cls = str(attrs_map.get('class') or attrs_map.get('className') or '')
        xp = (element.get('bu_xpath') or element.get('xpath') or element.get('xpath_abs') or '').strip()
        # Body teleport /div[N] — never a durable control (even if text stole a date value)
        if re.match(r'^(html/body/)?/?div\[\d+\]$', xp, re.I):
            return None
        # Date-string clicks from reopening el-date-editor / picker residue
        if re.match(r'^\d{4}-\d{2}-\d{2}$', t) and tag in ('div', 'span', 'input', ''):
            return None
        if (
            not t
            and tag in ('div', 'span')
            and not cls
            and not attrs_map.get('id')
            and not attrs_map.get('role')
        ):
            # empty anonymous div/span with no usable locator text
            if tag in ('div', 'span') and not t:
                return None
        # Keep text on element for assembler XPath/text degradation chain
        if t and not element.get('text'):
            element['text'] = t
        return 'click_element_by_index', {
            # Manual recording: never resolve browser_use highlight index.
            # Post-click get_state sees a different page → wrong index/xpath.
            'index': -1,
            'tag_name': element.get('tag_name') or '',
            'text': t,
        }, element

    # Menu / nav / generic clicks → click_element_by_index (assembler N-tier relocate)
    if kind == 'click_menu_item':
        return _as_click_by_index(payload.get('menu_text') or payload.get('text') or '')

    if kind == 'click_table_row_button':
        btn = (payload.get('button_text') or payload.get('text') or '').strip()
        return _as_click_by_index(btn)

    if kind == 'click_table_row_radio':
        row = (payload.get('row_text') or '').strip()
        # Reject junk fallbacks from empty fixed-column rows (was recorded as "radio")
        if not row or row.lower() in ('radio', 'checkbox', 'true', 'false'):
            return None
        return 'click_table_row_radio', {'row_text': row}, element

    if kind == 'click_adjacent_button':
        # Prefer button visible text; fall back to field label
        return _as_click_by_index(payload.get('text') or payload.get('label_text') or '')

    if kind == 'click':
        return _as_click_by_index(payload.get('text') or '')

    # Specialized form widgets keep dedicated actions
    if kind == 'click_radio':
        label = (payload.get('label_text') or '').strip()
        option = (payload.get('option_text') or '').strip()
        if not option:
            return None
        return 'click_radio', {'label_text': label, 'option_text': option}, element

    if kind == 'switch_tab':
        name = (payload.get('tab_name') or '').strip()
        if not name:
            return None
        return 'switch_tab', {'tab_name': name}, element

    if kind == 'close_dialog':
        return 'close_dialog', {}, element

    return None
