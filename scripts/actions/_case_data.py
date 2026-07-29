"""Case data storage actions for cross-phase data sharing."""

from ._helpers import _ok, _err

# Internal / nested keys that must not be treated as user field presets.
_RESERVED_CASE_KEYS = frozenset({
    'form_snapshot', 'form_snapshots', 'task_list',
    '_watcher_mode', '_intervention_queue', '_scan_fields',
    '_submit_ready', '_autofill_summary', '_last_save_ok',
    '_url_before_save', '_ref_date', '_already_matched_streak',
    '_has_button_keywords',
})


def _normalize_label(label: str) -> str:
    """Strip spaces / required markers / colons for fuzzy label match."""
    s = (label or '').strip()
    for ch in ('*', '＊', ':', '：', ' '):
        s = s.replace(ch, '')
    return s


def lookup_case_value(case_data_store: dict | None, label: str) -> str | None:
    """Resolve a user preset for a form label from case_data_store.

    Match order: exact key → normalized equality → bidirectional substring.
    Skips reserved / nested keys. Returns None when no usable preset exists.
    """
    if not case_data_store or not label:
        return None

    def _usable(val) -> str | None:
        if val is None or isinstance(val, (dict, list)):
            return None
        text = str(val).strip()
        return text or None

    direct = _usable(case_data_store.get(label))
    if direct is not None:
        return direct

    want = _normalize_label(label)
    if not want:
        return None

    # Normalized equality
    for key, val in case_data_store.items():
        if not isinstance(key, str) or key.startswith('_') or key in _RESERVED_CASE_KEYS:
            continue
        if _normalize_label(key) == want:
            found = _usable(val)
            if found is not None:
                return found

    # Bidirectional substring (e.g. "证件号码" ↔ "法人证件号码")
    for key, val in case_data_store.items():
        if not isinstance(key, str) or key.startswith('_') or key in _RESERVED_CASE_KEYS:
            continue
        nk = _normalize_label(key)
        if not nk:
            continue
        if want in nk or nk in want:
            found = _usable(val)
            if found is not None:
                return found

    return None


def iter_user_case_entries(case_data_store: dict | None) -> list[tuple[str, str]]:
    """Flat user KV presets (label, value) for agent hints / logging."""
    if not case_data_store:
        return []
    out = []
    for key, val in case_data_store.items():
        if not isinstance(key, str) or key.startswith('_') or key in _RESERVED_CASE_KEYS:
            continue
        if val is None or isinstance(val, (dict, list)):
            continue
        text = str(val).strip()
        if not text:
            continue
        out.append((key, text))
    return out


def format_case_data_hint(case_data_store: dict | None) -> str:
    """Append-able task hint so the agent prefers presets (esp. dialogs)."""
    entries = iter_user_case_entries(case_data_store)
    if not entries:
        return ''
    lines = '\n'.join(f'- {k} = {v}' for k, v in entries)
    return (
        '\n\n【预设案例数据 — 填表必须优先使用这些值；'
        '可用 read_case_data(key) 读取；不要用规则/LLM 另造替代值】\n'
        f'{lines}'
    )


def _register_case_data_actions(controller, case_data_store):
    @controller.action('Save data to the shared case data store for cross-phase data sharing.')
    async def save_case_data(key: str, value: str):
        try:
            case_data_store[key] = value
            return _ok(f'saved:{key}={value}')
        except Exception as e:
            return _err(f'save-error:{e}')

    @controller.action('Read data from the shared case data store.')
    async def read_case_data(key: str):
        val = lookup_case_value(case_data_store, key)
        if val is None:
            # Fall back to exact get for debugging empty/missing
            raw = case_data_store.get(key)
            if raw is None:
                return _err(f'NO-DATA:{key}')
            if isinstance(raw, (dict, list)):
                return _err(f'NO-DATA:{key}')
            return str(raw) if raw is not None else _err(f'NO-DATA:{key}')
        return val
