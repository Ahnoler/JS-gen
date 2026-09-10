"""L1c: best-effort POST discoverL1 regions to control-plane /api/v2/regions/classify.

Scan consumer for the shared classifyRegions service (resolve already wired in Node).
Fail-soft: timeout / unreachable / non-200 leave regions unchanged (algorithm B).
Does NOT rewrite field region_* (assignRegion ids differ from discoverL1 ids).
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from typing import Callable


def region_to_feature_card(reg: dict | None) -> dict:
    """Map a discoverL1 region dict to a FeatureCard for classifyRegions."""
    reg = reg if isinstance(reg, dict) else {}
    role = str(reg.get('role') or 'other').strip() or 'other'
    title = str(reg.get('title') or '').strip()[:80]
    tokens = list(reg.get('classTokens') or [])[:12]
    hint = reg.get('childHint') if isinstance(reg.get('childHint'), dict) else {}
    try:
        buttons = min(int(hint.get('buttons') or 0), 50)
    except (TypeError, ValueError):
        buttons = 0
    try:
        form_items = min(int(hint.get('formItems') or 0), 50)
    except (TypeError, ValueError):
        form_items = 0
    weak = role == 'other' or role.startswith('custom:')
    return {
        'tag': '',
        'classTokens': [str(t) for t in tokens if t],
        'title': title,
        'band': str(reg.get('band') or 'center'),
        'childCounts': {
            'button': buttons,
            'input': form_items,
            'menu': 0,
        },
        'flags': {
            'overlay': role == 'overlay',
            'tableLike': role in ('table', 'custom:tssc-table'),
            'menuLike': role in ('shell-aside', 'menu'),
            'titledPanel': bool(title),
        },
        'ruleRole': role,
        'ruleConfidence': 0.4 if weak else 0.85,
    }


def apply_classified_to_regions(
    regions: list | None,
    classified: list | None,
) -> list:
    """Patch regions in-place by index from classify items; never drop entries."""
    if not isinstance(regions, list):
        return []
    items = classified if isinstance(classified, list) else []
    for i, reg in enumerate(regions):
        if not isinstance(reg, dict):
            continue
        if i >= len(items) or not isinstance(items[i], dict):
            continue
        c = items[i]
        role = str(c.get('role') or '').strip()
        label = str(c.get('label') or '').strip()
        if role:
            reg['role'] = role
        if label:
            reg['title'] = label[:40]
        if c.get('confidence') is not None:
            try:
                reg['confidence'] = float(c['confidence'])
            except (TypeError, ValueError):
                pass
        src = str(c.get('source') or '').strip()
        if src:
            reg['classify_source'] = src
    return regions


def _default_control_url() -> str:
    return (
        os.getenv('L1C_CONTROL_URL')
        or os.getenv('MEMORY_CONTROL_URL')
        or 'http://127.0.0.1:4097'
    ).rstrip('/')


def _default_timeout_s() -> float:
    raw = os.getenv('L1C_HTTP_TIMEOUT_MS', '1500')
    try:
        return max(0.2, float(raw) / 1000.0)
    except (TypeError, ValueError):
        return 1.5


def _post_classify(
    url: str,
    body: dict,
    timeout_s: float,
) -> list | None:
    """POST classify; return items list or None on failure."""
    data = json.dumps(body, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(
        f'{url}/api/v2/regions/classify',
        data=data,
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            if getattr(resp, 'status', 200) != 200:
                return None
            payload = json.loads(resp.read().decode('utf-8') or '{}')
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError, ValueError, json.JSONDecodeError):
        return None
    items = payload.get('items') if isinstance(payload, dict) else None
    return items if isinstance(items, list) else None


def classify_scan_regions(
    scan_result: dict | None,
    *,
    system_id: str = '',
    control_url: str | None = None,
    timeout_s: float | None = None,
    post_fn: Callable[..., list | None] | None = None,
) -> dict | None:
    """Best-effort classify discoverL1 regions on a scan result dict.

    Mutates scan_result['regions'] on success. Returns the same dict.
    ``post_fn`` is injectable for cold pins (signature like _post_classify).
    """
    if not isinstance(scan_result, dict):
        return scan_result
    regions = scan_result.get('regions')
    if not isinstance(regions, list) or not regions:
        return scan_result

    cards = [region_to_feature_card(r) for r in regions if isinstance(r, dict)]
    if not cards:
        return scan_result

    url = (control_url or _default_control_url()).rstrip('/')
    to = _default_timeout_s() if timeout_s is None else float(timeout_s)
    poster = post_fn or _post_classify
    body = {'systemId': str(system_id or ''), 'cards': cards}
    try:
        items = poster(url, body, to)
    except Exception as err:
        sys.stderr.write(f'[l1c-scan] classify request failed: {err}\n')
        sys.stderr.flush()
        return scan_result

    if not items:
        sys.stderr.write('[l1c-scan] classify skipped (no items / HTTP failure)\n')
        sys.stderr.flush()
        return scan_result

    apply_classified_to_regions(regions, items)
    return scan_result
