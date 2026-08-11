"""Best-effort memory emit for scan_editable_summary inventory (T4-P2)."""

from __future__ import annotations

PENDING_LABEL_MAX_ITEMS = 20
PENDING_LABEL_MAX_CHARS = 500
BUTTON_MAX_ITEMS = 15
BUTTON_MAX_CHARS = 400

_FACT_META = {
    'entity': 'form_inventory',
    'factType': 'page_state',
    'source': 'page',
    'stance': 'inferred',
}


def truncate_pending_labels(labels: list | None) -> list[str]:
    """Return up to PENDING_LABEL_MAX_ITEMS non-empty label strings."""
    out: list[str] = []
    if not labels:
        return out
    for raw in labels:
        label = str(raw or '').strip()
        if not label:
            continue
        out.append(label)
        if len(out) >= PENDING_LABEL_MAX_ITEMS:
            break
    return out


def join_pending_labels(labels: list | None) -> str:
    """Comma-join truncated pending labels, capped at PENDING_LABEL_MAX_CHARS."""
    items = truncate_pending_labels(labels)
    if not items:
        return ''
    joined = ','.join(items)
    if len(joined) <= PENDING_LABEL_MAX_CHARS:
        return joined
    return joined[:PENDING_LABEL_MAX_CHARS]


def truncate_buttons(buttons: list | None) -> list[dict]:
    """Return up to BUTTON_MAX_ITEMS {text, section} dicts."""
    out: list[dict] = []
    if not buttons:
        return out
    for raw in buttons:
        if not isinstance(raw, dict):
            continue
        text = str(raw.get('text') or '').strip()
        section = str(raw.get('section') or '').strip()
        if not text and not section:
            continue
        out.append({'text': text, 'section': section})
        if len(out) >= BUTTON_MAX_ITEMS:
            break
    return out


def format_buttons_compact(buttons: list | None) -> str:
    """Format buttons as text@section comma-joined, capped at BUTTON_MAX_CHARS."""
    parts: list[str] = []
    for btn in truncate_buttons(buttons):
        text = str(btn.get('text') or '').strip()
        section = str(btn.get('section') or '').strip()
        if section:
            parts.append(f'{text}@{section}')
        else:
            parts.append(text)
    if not parts:
        return ''
    joined = ','.join(parts)
    if len(joined) <= BUTTON_MAX_CHARS:
        return joined
    return joined[:BUTTON_MAX_CHARS]


def build_inventory_payload(summary: dict) -> dict:
    """Build truncated form_state payload from editable summary."""
    if not isinstance(summary, dict):
        summary = {}
    labels = summary.get('pending_labels')
    buttons = summary.get('buttons')
    return {
        'container': str(summary.get('container') or 'main').strip() or 'main',
        'scope': str(summary.get('scope') or 'active+visible-overlays'),
        'total': int(summary.get('total') or 0),
        'filled': int(summary.get('filled') or 0),
        'pending': int(summary.get('pending') or 0),
        'pending_labels': truncate_pending_labels(labels),
        'buttons': truncate_buttons(buttons),
    }


def build_inventory_facts(summary: dict) -> list[dict]:
    """Build form_inventory aggregate facts from editable summary."""
    payload = build_inventory_payload(summary)
    pending_count = payload['pending']
    if pending_count == 0 and payload['pending_labels']:
        pending_count = len(payload['pending_labels'])
    return [
        {
            **_FACT_META,
            'attribute': 'container',
            'value': payload['container'],
        },
        {
            **_FACT_META,
            'attribute': 'pending_count',
            'value': str(pending_count),
        },
        {
            **_FACT_META,
            'attribute': 'pending_labels',
            'value': join_pending_labels(summary.get('pending_labels')),
        },
        {
            **_FACT_META,
            'attribute': 'buttons',
            'value': format_buttons_compact(summary.get('buttons')),
        },
    ]


def emit_editable_summary_memory(summary: dict, *, phase_number=None) -> None:
    """Best-effort; never raises to caller."""
    try:
        from scripts.memory.writer import emit_memory_event

        payload = build_inventory_payload(summary)
        facts = build_inventory_facts(summary)
        emit_memory_event(
            'form_state',
            payload,
            phase_number=phase_number,
            facts=facts,
        )
    except Exception:
        pass
