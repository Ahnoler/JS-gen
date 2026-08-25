"""Business data helpers for cross-phase sharing.

Terminology
===========
- **业务数据 (business data)**
  Provided by the *user* in the requirement / task description (often a
  「关键数据」section). It is the data they *want* the automation to use
  (e.g.「法定责任人引入 朱桂武」). Soft, relatively structured NL — not our
  DB tables and not a guaranteed label→value schema.

  This project persists runtime capture (form snapshots, saved values) under
  the same ``business_data`` / ``business_data_entry`` tables. The single
  ``业务数据`` concept covers both the user's wish-list and what we save back
  from the system.

Legacy names (``case_data_block``, ``_case_scenario_text``, ``caseEntries``)
often hold **业务数据** from the requirement; rename carefully if you touch them.

Design for 业务数据: tolerate wording drift; never hard-match fieldKey to form
labels for autofill (that caused magnifier queries to reuse main-form names).
Ship raw block + flat KV as text on ``agent_task`` via ``format_business_data_hint``.
"""

from ._helpers import _ok, _err
from ...memory.writer import emit_memory_event

# Internal / nested keys that must not be treated as user field presets.
_RESERVED_BUSINESS_KEYS = frozenset({
    'form_snapshot', 'form_snapshots', 'task_list',
    '_watcher_mode', '_scan_fields',
    '_submit_ready', '_query_ready', '_query_task', '_query_ui', '_task_mode',
    '_autofill_summary', '_last_save_ok',
    '_url_before_save', '_ref_date', '_already_matched_streak',
    '_has_button_keywords', '_phase_outcomes', '_force_refill_all',
    '_phase_intent', '_phase_intent_flag_locked', '_success_tokens',
    '_last_introduce_ok', '_quality_failed', '_quality_failed_reasons',
    '_cycle_prescribed', '_recovery_active', '_heal_mode',
    '_phase_boundary', '_phase_boundary_flag_locked', '_evidence_observed',
    '_form_stale', '_task_lists_by_container', '_active_container',
    '_parent_container_before_picker', '_boundary_hint',
    '_case_scenario_text',
    '_business_scenario_text',
})


def _normalize_label(label: str) -> str:
    """Strip spaces / required markers / colons for fuzzy label match."""
    s = (label or '').strip()
    for ch in ('*', '＊', ':', '：', ' '):
        s = s.replace(ch, '')
    return s


def lookup_business_value(business_data_store: dict | None, label: str) -> str | None:
    """Resolve a user preset for a form label from business_data_store.

    Match order: exact key → normalized equality → bidirectional substring.
    Skips reserved / nested keys. Returns None when no usable preset exists.
    """
    if not business_data_store or not label:
        return None

    def _usable(val) -> str | None:
        if val is None or isinstance(val, (dict, list)):
            return None
        text = str(val).strip()
        return text or None

    direct = _usable(business_data_store.get(label))
    if direct is not None:
        return direct

    want = _normalize_label(label)
    if not want:
        return None

    # Normalized equality
    for key, val in business_data_store.items():
        if not isinstance(key, str) or key.startswith('_') or key in _RESERVED_BUSINESS_KEYS:
            continue
        if _normalize_label(key) == want:
            found = _usable(val)
            if found is not None:
                return found

    # Bidirectional substring (e.g. "证件号码" ↔ "法人证件号码")
    for key, val in business_data_store.items():
        if not isinstance(key, str) or key.startswith('_') or key in _RESERVED_BUSINESS_KEYS:
            continue
        nk = _normalize_label(key)
        if not nk:
            continue
        if want in nk or nk in want:
            found = _usable(val)
            if found is not None:
                return found

    return None


def iter_user_business_entries(business_data_store: dict | None) -> list[tuple[str, str]]:
    """Flat user KV presets (label, value) for agent hints / logging."""
    if not business_data_store:
        return []
    out = []
    for key, val in business_data_store.items():
        if not isinstance(key, str) or key.startswith('_') or key in _RESERVED_BUSINESS_KEYS:
            continue
        if val is None or isinstance(val, (dict, list)):
            continue
        text = str(val).strip()
        if not text:
            continue
        out.append((key, text))
    return out


def format_business_data_hint(business_data_store: dict | None) -> str:
    """Append 业务数据 (user requirement notes) for the AI to interpret.

    Users write soft notes (「法定责任人引入 朱桂武」); the agent maps them to
    controls. Do not hard-match keys to form labels.

    Always attach both the prose block (if any) and flat KV entries (if any) so
    ``agent_task`` preview carries usable values for the LLM.
    """
    if not business_data_store:
        return ''
    block = str(
        business_data_store.get('_business_scenario_text')
        or business_data_store.get('_case_scenario_text')
        or ''
    ).strip()
    entries = iter_user_business_entries(business_data_store)
    if not block and not entries:
        return ''
    parts = [
        '\n\n【业务数据 — 来自用户需求/关键数据；'
        '由你根据场景自行判断填入哪个字段；禁止机械按标签名与键名一一对应；'
        '引入/选人弹窗查询值优先取「引入」相关说明】',
    ]
    if block:
        parts.append(block)
    if entries:
        parts.append('\n'.join(f'- {k}：{v}' for k, v in entries))
    return '\n'.join(parts) + '\n'


def _register_business_data_actions(controller, business_data_store):
    @controller.action(
        'Save data reported from the target system into the project business-data store '
        '(业务数据 — system-captured).'
    )
    async def save_business_data(key: str, value: str):
        try:
            business_data_store[key] = value
            # P1：带 phase_number 归属（事实包按阶段检索；P0 缺省导致检索不到）
            try:
                from ...state import _CURRENT_PHASE
                emit_memory_event(
                    'business_saved',
                    {'key': key, 'value': str(value)[:500]},
                    phase_number=_CURRENT_PHASE if _CURRENT_PHASE else None,
                )
            except Exception:
                emit_memory_event('business_saved', {'key': key, 'value': str(value)[:500]})
            return _ok(f'saved:{key}={value}', include_in_memory=True)
        except Exception as e:
            return _err(f'save-error:{e}')

    @controller.action(
        'Read from the project business-data store (业务数据). '
        'For user requirement notes (业务数据), rely on the task 【业务数据】block.'
    )
    async def read_business_data(key: str):
        val = lookup_business_value(business_data_store, key)
        if val is None:
            # Fall back to exact get for debugging empty/missing
            raw = business_data_store.get(key)
            if raw is None:
                return _err(f'NO-DATA:{key}')
            if isinstance(raw, (dict, list)):
                return _err(f'NO-DATA:{key}')
            return str(raw) if raw is not None else _err(f'NO-DATA:{key}')
        return val
