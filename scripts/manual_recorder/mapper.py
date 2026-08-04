"""Map DOM event payloads to controller ActionEntry tuples.

Trusts the DOM snapshot (xpath_smart / strategy / candidates) from the page or
CDP inspect path. Offline rebuild is a safe fallback only when smart xpath is
missing — never invents menu from a generic /ul/li/ absolute path.
"""
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


def _offline_xpath_smart_fallback(
    tag: str,
    text: str,
    xpath_abs: str = '',
    class_name: str = '',
    form_label: str = '',
    target_kind: str = '',
) -> str:
    """Safe offline rebuild from supplied cues only (no menu inference from /ul/li/)."""
    form_lbl = re.sub(r'\s+', ' ', str(form_label or '')).strip()
    form_lbl = re.sub(r'[：:*\s]+$', '', form_lbl)[:40]
    kind = str(target_kind or '').strip()

    if form_lbl and (kind.startswith('form_') or kind in ('', 'generic', 'adjacent_button') or not kind):
        lit = _xpath_literal(form_lbl)
        item = (
            f"div[contains(@class,'el-form-item')]"
            f"[.//label[contains(normalize-space(.),{lit})]]"
        )
        tag_l = (tag or '').lower()
        cls = class_name or ''
        abs_l = xpath_abs or ''
        if kind == 'adjacent_button':
            leaf = "*[self::button or contains(concat(' ',normalize-space(@class),' '),' el-button ')]"
            btn = re.sub(r'\s+', ' ', str(text or '')).strip()[:40]
            if btn:
                leaf += f"[normalize-space()={_xpath_literal(btn)}]"
        elif tag_l == 'textarea' or re.search(r'el-textarea', cls, re.I):
            leaf = 'textarea'
        elif re.search(r'el-select', cls, re.I) or re.search(r'el-select', abs_l, re.I):
            leaf = "div[contains(@class,'el-select')]"
        elif re.search(r'el-date-editor|tsscdatepicker', cls, re.I):
            leaf = "div[contains(@class,'el-date-editor')]"
        else:
            leaf = 'input' if tag_l in ('', 'input') or 'el-input__inner' in cls else tag_l
        local = f"{item}//{leaf}"
        if re.search(r'el-drawer', abs_l, re.I) or re.search(r'el-drawer', cls, re.I):
            return f"(//div[contains(@class,'el-drawer')])[last()]//{local}"
        if re.search(r'el-dialog|el-message-box', abs_l, re.I):
            return (
                "(//div[contains(@class,'el-dialog') or contains(@class,'el-message-box')])[last()]"
                f"//{local}"
            )
        return f"//{local}"

    t = re.sub(r'\s+', ' ', str(text or '')).strip()[:40]
    if not t:
        return ''
    if kind == 'icon':
        lit = _xpath_literal(t)
        return f'//*[@aria-label={lit} or @title={lit}]'
    # Only rebuild button/link text xpath offline — never menu from absolute path alone
    tag_l = (tag or '').lower()
    cls = class_name or ''
    clickable = (
        tag_l in ('button', 'a')
        or bool(re.search(r'(?:^|\s)el-button(?:\s|$)', cls))
        or kind in ('button', 'link')
    )
    if not clickable:
        return ''
    lit = _xpath_literal(t)
    local = f'a[normalize-space()={lit}]' if tag_l == 'a' else f'button[normalize-space()={lit}]'
    abs_l = xpath_abs or ''
    if re.search(r'el-drawer', abs_l, re.I):
        return f"(//div[contains(@class,'el-drawer')])[last()]//{local}"
    if re.search(r'el-dialog|el-message-box', abs_l, re.I):
        return (
            "(//div[contains(@class,'el-dialog') or contains(@class,'el-message-box')])[last()]"
            f"//{local}"
        )
    return f'//{local}'


# Backward-compatible alias (tests / __init__ re-exports)
_build_xpath_smart = _offline_xpath_smart_fallback


def _map_dom_event_to_action(payload: dict) -> Optional[tuple[str, dict, Optional[dict]]]:
    """
    Map a DOM event payload to (action_name, params, element_info).
    Returns None if the event should be ignored.

    Manual click_element_by_index always uses index=-1; locate via xpath/text.
    """
    kind = (payload.get('kind') or '').strip()
    attrs = payload.get('attributes') or {}
    text = payload.get('text') or attrs.get('title') or attrs.get('aria-label') or ''
    text = re.sub(r'\s+', ' ', str(text or '')).strip()
    abs_xp = payload.get('xpath_abs') or payload.get('xpath_full') or ''
    bu = payload.get('bu_xpath') or ''
    smart = payload.get('xpath_smart') or ''
    tag = payload.get('tag') or ''
    cls = str(attrs.get('class') or attrs.get('className') or '')
    form_label = (payload.get('label_text') or payload.get('formLabel') or '').strip()
    target_kind = str(payload.get('target_kind') or '').strip()

    # Trust DOM snapshot; offline rebuild only when smart missing
    if not smart:
        smart = _offline_xpath_smart_fallback(
            tag,
            text,
            abs_xp or str(payload.get('xpath') or ''),
            cls,
            form_label=form_label if kind in ('fill', 'fill_date', 'select_option', 'click_adjacent_button') else '',
            target_kind=target_kind or (
                'form_input' if kind in ('fill', 'fill_date', 'select_option') else
                'adjacent_button' if kind == 'click_adjacent_button' else
                'icon' if kind == 'click_icon_button' else
                'menu' if kind == 'click_menu_item' else
                'tab' if kind == 'switch_tab' else
                'dialog_close' if kind == 'close_dialog' else
                ''
            ),
        )

    css = payload.get('cssSelector') or payload.get('css_selector') or ''
    strategy = payload.get('locator_strategy') or ('xpath_smart' if smart else 'xpath_full')
    primary = smart if strategy == 'xpath_smart' and smart else (
        smart or bu or payload.get('xpath') or abs_xp or ''
    )
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
        'locator_strategy': strategy,
        'locator_verified': bool(payload.get('locator_verified')),
    }
    if form_label:
        element['formLabel'] = form_label
    if target_kind:
        element['target_kind'] = target_kind
    if payload.get('locator_scope'):
        element['locator_scope'] = payload['locator_scope']
    if payload.get('locator_occurrence'):
        element['locator_occurrence'] = payload['locator_occurrence']
    if payload.get('locator_fallback_reason'):
        element['locator_fallback_reason'] = payload['locator_fallback_reason']

    if kind == 'fill':
        label = (payload.get('label_text') or '').strip()
        value = payload.get('value')
        if value is None:
            return None
        if not label and not element['xpath']:
            return None
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
        params = {'label_text': label or option, 'option_text': option}
        raw_opts = payload.get('options')
        if isinstance(raw_opts, list):
            opts = []
            seen = set()
            for o in raw_opts:
                s = str(o).strip() if o is not None else ''
                if not s or s == '请选择' or s in seen:
                    continue
                seen.add(s)
                opts.append(s)
            if opts:
                params['options'] = opts
                element['options'] = opts
        return 'select_option', params, element

    def _as_click_by_index(text: str):
        """Manual clicks → click_element_by_index with index=-1 (xpath/text locate only)."""
        t = (text or '').strip()
        if not t and not element.get('xpath') and not element.get('bu_xpath'):
            return None
        tag = (element.get('tag_name') or '').lower()
        attrs_map = element.get('attributes') or {}
        cls = str(attrs_map.get('class') or attrs_map.get('className') or '')
        xp = (element.get('bu_xpath') or element.get('xpath') or element.get('xpath_abs') or '').strip()
        if re.match(r'^(html/body/)?/?div\[\d+\]$', xp, re.I):
            return None
        if re.match(r'^\d{4}-\d{2}-\d{2}$', t) and tag in ('div', 'span', 'input', ''):
            return None
        if (
            not t
            and tag in ('div', 'span')
            and not cls
            and not attrs_map.get('id')
            and not attrs_map.get('role')
        ):
            if tag in ('div', 'span') and not t:
                return None
        if t and not element.get('text'):
            element['text'] = t
        return 'click_element_by_index', {
            'index': -1,
            'tag_name': element.get('tag_name') or '',
            'text': t,
        }, element

    if kind == 'click_menu_item':
        return _as_click_by_index(payload.get('menu_text') or payload.get('text') or '')

    if kind == 'click_table_row_button':
        btn = (payload.get('button_text') or payload.get('text') or '').strip()
        return _as_click_by_index(btn)

    if kind == 'click_table_row_radio':
        row = (payload.get('row_text') or '').strip()
        if not row or row.lower() in ('radio', 'checkbox', 'true', 'false'):
            return None
        return 'click_table_row_radio', {'row_text': row}, element

    if kind == 'click_adjacent_button':
        return _as_click_by_index(payload.get('text') or payload.get('label_text') or '')

    if kind == 'click_icon_button':
        text = (payload.get('button_text') or payload.get('text') or '').strip()
        if not text:
            return None
        element['target_kind'] = 'icon'
        return 'click_icon_button', {'button_text': text}, element

    if kind == 'click':
        return _as_click_by_index(payload.get('text') or '')

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
