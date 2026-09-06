"""Scan summary projection helpers (extracted from form_scan_utils.py).

form_scan_utils.py re-exports these names for backward compatibility.
"""


def _project_summary_field(field: dict) -> dict:
    """Project scan field → model-facing shape; region_label primary, section alias."""
    region = _region_display_label(field)
    return {
        'label': (field.get('label') or '').strip(),
        'xpath_smart': (field.get('xpath_smart') or '').strip(),
        'kind': (field.get('kind') or '').strip(),
        'region_label': region,
        'section': region,  # legacy alias — prefer region_label
    }


def _project_summary_buttons(buttons: list[dict]) -> list[dict]:
    """Source C buttons → {text, region_label, section, xpath_smart}."""
    out: list[dict] = []
    seen: set[tuple[str, str, str]] = set()
    for b in buttons:
        text = (b.get('label') or '').strip()
        if not text:
            continue
        region = _region_display_label(b)
        xp = (b.get('xpath_smart') or '').strip()
        key = (text, region, xp)
        if key in seen:
            continue
        seen.add(key)
        out.append({
            'text': text,
            'region_label': region,
            'section': region,  # legacy alias
            'xpath_smart': xp,
        })
    return out


def _region_display_label(field: dict | None) -> str:
    """Prefer L1 region_label; fall back to legacy section_title for compat."""
    if not isinstance(field, dict):
        return ''
    return (
        (field.get('region_label') or '').strip()
        or (field.get('section_title') or '').strip()
    )


def build_editable_summary(
    scan_results: list[dict],
    *,
    primary_container: str,
) -> dict:
    """Merge A/B/C scan JSON dicts → read-only editable summary. No store side effects."""
    # Late import: form_scan_utils.py imports this module back at module level.
    from .form_scan_utils import (
        KNOWN_EDITABLE_FIELD_KINDS,
        _field_is_filled,
        _field_is_pending,
        _field_is_readonly,
        _merge_scan_buttons,
        _merge_scan_fields,
        is_chrome_menu_label,
    )
    fields = _merge_scan_fields(scan_results)
    raw_buttons = _merge_scan_buttons(scan_results)
    known_fields = [
        f for f in fields
        if (f.get('kind') or '').strip() in KNOWN_EDITABLE_FIELD_KINDS
    ]

    pending_items: list[dict] = []
    pending_labels: list[str] = []
    seen_pending_xp: set[str] = set()
    seen_pending_label: set[str] = set()
    readonly_items: list[dict] = []
    readonly_labels: list[str] = []
    seen_readonly_xp: set[str] = set()
    seen_readonly_label: set[str] = set()

    for f in known_fields:
        label = (f.get('label') or '').strip()
        if not label:
            continue
        xp = (f.get('xpath_smart') or '').strip()
        if _field_is_readonly(f):
            # Prefer xpath identity so same label / different controls both appear.
            if xp:
                if xp in seen_readonly_xp:
                    continue
                seen_readonly_xp.add(xp)
            elif label in seen_readonly_label:
                continue
            if label not in seen_readonly_label:
                seen_readonly_label.add(label)
                readonly_labels.append(label)
            readonly_items.append(_project_summary_field(f))
            continue
        if not _field_is_pending(f):
            continue
        if xp:
            if xp in seen_pending_xp:
                continue
            seen_pending_xp.add(xp)
        elif label in seen_pending_label:
            continue
        if label not in seen_pending_label:
            seen_pending_label.add(label)
            pending_labels.append(label)
        pending_items.append(_project_summary_field(f))

    filled = sum(1 for f in known_fields if _field_is_filled(f))
    section_block = _build_section_summary(
        known_fields,
        raw_buttons,
        pending_labels=set(pending_labels),
    )
    sections = [
        {
            'id': s.get('section_id', ''),
            'title': s.get('region_label') or s.get('section_title', ''),
            'region_label': s.get('region_label') or s.get('section_title', ''),
            'pending': s.get('fields_editable_pending', 0),
        }
        for s in section_block.get('sections', [])
    ]

    projected_buttons = _project_summary_buttons(raw_buttons)
    # Fullpage L2: surface shell/menu/icon as button-like entries (text+section+xpath).
    for f in fields:
        if not isinstance(f, dict):
            continue
        kind = (f.get('kind') or '').strip()
        if kind not in ('menu_item', 'icon'):
            continue
        text = (f.get('label') or '').strip()
        if not text or len(text) > 40:
            continue
        if is_chrome_menu_label(text):
            continue
        projected_buttons.append({
            'text': text,
            'region_label': _region_display_label(f) or (f.get('region_role') or '')[:40],
            'section': _region_display_label(f) or (f.get('region_role') or '')[:40],
            'xpath_smart': (f.get('xpath_smart') or '').strip(),
        })
        if len(projected_buttons) >= 80:
            break

    return {
        'container': (primary_container or 'main').strip() or 'main',
        'scope': _summary_scope(scan_results),
        'total': len(known_fields),
        'filled': filled,
        'pending': len(pending_items),
        'pending_labels': pending_labels,
        'pending_items': pending_items,
        'readonly_labels': readonly_labels,
        'readonly_items': readonly_items,
        'sections': sections,
        'buttons': projected_buttons,
        **_summary_regions(scan_results),
    }


def _summary_scope(scan_results: list[dict]) -> str:
    for r in scan_results or []:
        if isinstance(r, dict) and (r.get('scope') or '').strip() == 'fullpage':
            return 'fullpage'
    return 'active+visible-overlays'


def _summary_regions(scan_results: list[dict]) -> dict:
    regions: list[dict] = []
    seen: set[str] = set()
    for r in scan_results or []:
        if not isinstance(r, dict):
            continue
        for reg in r.get('regions') or []:
            if not isinstance(reg, dict):
                continue
            rid = str(reg.get('id') or '')
            if rid and rid in seen:
                continue
            if rid:
                seen.add(rid)
            regions.append({
                'id': rid,
                'role': reg.get('role') or '',
                'title': (reg.get('title') or '')[:40],
                'band': reg.get('band') or '',
            })
            if len(regions) >= 30:
                return {'regions': regions}
    return {'regions': regions} if regions else {}


def _build_section_summary(
    fields: list[dict],
    buttons: list[dict],
    pending_labels: set[str] | list[str] | None = None,
) -> dict:
    """Group scan fields/buttons by section for model-facing summaries.

    fields_sample: up to 5 labels per section (pending first).
    fields_total / fields_editable_pending: per-section counts (pending ∩ labels, disabled-aware).
    ambiguous_buttons: same label in >=2 distinct section_id groups.
    """
    # Late import: form_scan_utils.py imports this module back at module level.
    from .form_scan_utils import _section_group_key
    pending = set(pending_labels or [])
    order: list[str] = []
    by_key: dict[str, dict] = {}

    def _ensure(section_id: str, section_title: str, region_label: str = '') -> dict:
        title = (region_label or section_title or '').strip()
        key = _section_group_key(section_id, title)
        if key not in by_key:
            by_key[key] = {
                'section_id': (section_id or '').strip() or key,
                'section_title': (section_title or title).strip(),
                'region_label': title,
                'fields_sample': [],
                'buttons': [],
                '_field_entries': [],
            }
            order.append(key)
        elif title and not by_key[key].get('region_label'):
            by_key[key]['region_label'] = title
        return by_key[key]

    for f in fields:
        if not isinstance(f, dict):
            continue
        sec = _ensure(
            f.get('section_id') or '',
            f.get('section_title') or '',
            f.get('region_label') or '',
        )
        label = (f.get('label') or '').strip()
        if label:
            sec['_field_entries'].append({
                'label': label,
                'disabled': bool(f.get('disabled')),
            })

    for b in buttons:
        if not isinstance(b, dict):
            continue
        sec = _ensure(
            b.get('section_id') or '',
            b.get('section_title') or '',
            b.get('region_label') or '',
        )
        label = (b.get('label') or '').strip()
        if label and label not in sec['buttons']:
            sec['buttons'].append(label)

    for key in order:
        sec = by_key[key]
        entries = sec.pop('_field_entries')
        label_meta: dict[str, bool] = {}
        for entry in entries:
            lbl = entry['label']
            dis = entry['disabled']
            if lbl not in label_meta:
                label_meta[lbl] = dis
            else:
                label_meta[lbl] = label_meta[lbl] and dis
        labels = list(label_meta.keys())
        sec['fields_total'] = len(label_meta)
        sec['fields_editable_pending'] = sum(
            1 for lbl, dis in label_meta.items() if lbl in pending and not dis
        )
        seen: set[str] = set()
        sample: list[str] = []
        for label in labels:
            if label in pending and label not in seen:
                seen.add(label)
                sample.append(label)
                if len(sample) >= 5:
                    break
        if len(sample) < 5:
            for label in labels:
                if label not in seen:
                    seen.add(label)
                    sample.append(label)
                    if len(sample) >= 5:
                        break
        sec['fields_sample'] = sample

    label_sections: dict[str, dict[str, dict]] = {}
    for b in buttons:
        if not isinstance(b, dict):
            continue
        text = (b.get('label') or '').strip()
        if not text:
            continue
        sid = (b.get('section_id') or '').strip()
        title = (b.get('section_title') or '').strip()
        key = _section_group_key(sid, title)
        if text not in label_sections:
            label_sections[text] = {}
        label_sections[text][key] = {
            'section_id': sid or key,
            'section_title': title,
        }

    ambiguous_buttons = [
        {'text': text, 'sections': list(sec_map.values())}
        for text, sec_map in label_sections.items()
        if len(sec_map) >= 2
    ]

    out: dict = {'sections': [by_key[k] for k in order]}
    if ambiguous_buttons:
        out['ambiguous_buttons'] = ambiguous_buttons
    return out



