"""Overlay container display naming: trigger|title for LLM; title-only for verify."""
from __future__ import annotations
import re

OVERLAY_SEP = '|'
_TRIGGER_KEY = '_last_trigger_button'
_ALIAS_KEY = '_overlay_container_alias'

_DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
_DAY_RE = re.compile(r'^\d{1,2}$')
_MAX_TRIGGER_LEN = 40


def _split_type(container_id: str) -> tuple[str, str]:
    s = (container_id or '').strip()
    for prefix in ('dialog:', 'drawer:'):
        if s.startswith(prefix):
            return prefix, s[len(prefix):]
    return '', s


def overlay_title_from_container_id(container_id: str) -> str:
    """Title segment used by verifyFormStructure (ignores trigger before |)."""
    prefix, rest = _split_type(container_id)
    if not prefix:
        return (container_id or '').strip()
    if OVERLAY_SEP in rest:
        return rest.split(OVERLAY_SEP, 1)[1].strip()
    return rest.strip()


def normalize_trigger_button(text: str | None) -> str:
    t = re.sub(r'\s+', '', (text or '').strip())
    if not t:
        return ''
    if _DAY_RE.match(t) or _DATE_RE.match(t):
        return ''
    if len(t) > _MAX_TRIGGER_LEN:
        return ''
    # Exclude routine submit/query labels (YAGNI: not treated as overlay openers)
    if t in ('保存', '提交', '查询', '搜索', '查找', '重置'):
        return ''
    return t


def compose_overlay_container(raw_id: str, trigger: str | None) -> str:
    try:
        prefix, rest = _split_type(raw_id)
        if not prefix:
            return (raw_id or '').strip() or 'main'
        btn = normalize_trigger_button(trigger)
        title = (rest or '').strip() or 'unnamed'
        if not btn:
            return f'{prefix}{title}'
        if title == 'unnamed':
            return f'{prefix}{btn}{OVERLAY_SEP}unnamed'
        return f'{prefix}{btn}{OVERLAY_SEP}{title}'
    except Exception:
        return (raw_id or '').strip() or 'main'


def remember_trigger_button(store: dict | None, text: str | None) -> None:
    if not isinstance(store, dict):
        return
    btn = normalize_trigger_button(text)
    if not btn:
        return
    store[_TRIGGER_KEY] = btn


def clear_trigger_button(store: dict | None) -> None:
    if not isinstance(store, dict):
        return
    store.pop(_TRIGGER_KEY, None)
    store.pop(_ALIAS_KEY, None)


def resolve_display_container(raw_id: str, store: dict | None) -> str:
    """Compose once per raw root; freeze in store alias map."""
    raw = (raw_id or '').strip() or 'main'
    if not isinstance(store, dict):
        return compose_overlay_container(raw, None)
    prefix, _rest = _split_type(raw)
    if not prefix:
        return raw
    aliases = store.setdefault(_ALIAS_KEY, {})
    if not isinstance(aliases, dict):
        aliases = {}
        store[_ALIAS_KEY] = aliases
    if raw in aliases:
        return aliases[raw]
    composed = compose_overlay_container(raw, store.get(_TRIGGER_KEY))
    aliases[raw] = composed
    return composed
