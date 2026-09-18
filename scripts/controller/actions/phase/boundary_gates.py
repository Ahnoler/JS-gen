"""Phase boundary gates + evidence — extracted from phase/boundary.py.

Evidence recording, done-ok evaluation, picker/context detection, submit
blocking and NEXT_ACTION cues. Lazy-imports phase.reviewer only.
"""

from __future__ import annotations

import re
from typing import Any

from .boundary_contract import (
    _CONFIRM_BTN_RE,
    _MAINTAIN_TITLE_RE,
    _PICKER_TITLE_RE,
    _SAVE_BTN_RE,
    get_phase_boundary,
    phase_boundary_active,
)

def record_evidence(business_data_store: dict | None, kind: str, detail: str = '') -> None:
    if not business_data_store or not kind:
        return
    store = business_data_store.setdefault('_evidence_observed', [])
    if not isinstance(store, list):
        store = []
        business_data_store['_evidence_observed'] = store
    entry = {'kind': kind, 'detail': (detail or '')[:160]}
    # Dedup by kind only
    if not any(isinstance(e, dict) and e.get('kind') == kind for e in store):
        store.append(entry)
    # Mirror legacy tokens for opt-out / adapters
    if kind in ('toast_ok', 'url_change', 'saved_navigation'):
        business_data_store['_last_save_ok'] = True
    if kind in ('picker_closed', 'dialog_confirmed', 'introduced_backfilled'):
        business_data_store['_last_introduce_ok'] = True
    tokens = business_data_store.setdefault('_success_tokens', [])
    if isinstance(tokens, list):
        tok = {'kind': kind, 'evidence': detail or kind}
        if tok not in tokens:
            tokens.append(tok)

def observed_kinds(business_data_store: dict | None) -> set[str]:
    raw = (business_data_store or {}).get('_evidence_observed') or []
    out: set[str] = set()
    if isinstance(raw, list):
        for e in raw:
            if isinstance(e, dict) and e.get('kind'):
                out.add(str(e['kind']))
    # Legacy fallbacks
    if (business_data_store or {}).get('_last_save_ok'):
        out.update({'toast_ok', 'url_change', 'saved_navigation'})
    if (business_data_store or {}).get('_last_introduce_ok'):
        out.update({'picker_closed', 'dialog_confirmed', 'introduced_backfilled'})
    return out

def phase_done_ok(business_data_store: dict | None) -> tuple[bool, list[str]]:
    """Return (ok, missing_hints). Empty success_when → always ok (login / other).

    Non-empty success_when uses any-of matching (maintain intro+save is AND of groups).
    """
    b = get_phase_boundary(business_data_store)
    if not b:
        return True, []
    needed = list(b.get('success_when') or [])
    if not needed:
        return True, []
    have = observed_kinds(business_data_store)
    intro_kinds = {'picker_closed', 'dialog_confirmed', 'introduced_backfilled'}
    save_kinds = {'toast_ok', 'url_change', 'saved_navigation'}

    if b.get('requires_introduce_then_save'):
        has_intro = bool(have & intro_kinds)
        has_save = bool(have & save_kinds)
        missing = []
        if not has_intro:
            missing.append('introduce_evidence')
        if not has_save:
            missing.append('save_evidence')
        return (not missing), missing

    # Any of success_when is enough. Alias LLM dialog_close ↔ introduce close kinds.
    needed_set = set(needed)
    have_match = set(have)
    intro_close = intro_kinds | {'dialog_close', 'confirm_click'}
    if have_match & intro_close:
        have_match |= intro_close
    if have_match & needed_set:
        return True, []
    return False, [f'missing_any_of:{needed}']


def can_submit_writes(business_data_store: dict | None, section: str = "") -> tuple[bool, list[str]]:
    """Write gate: maintain + requires_write → no fillable pending in current container."""
    b = get_phase_boundary(business_data_store)
    if not b or not b.get('requires_write_all_editable'):
        return True, []
    from scripts.models.task import TaskList
    from scripts.controller.actions.section_scope import filter_pending_labels

    tl = TaskList.from_store((business_data_store or {}).get('task_list'))
    pending = filter_pending_labels(tl, section)
    return len(pending) == 0, pending

def is_picker_context(
    *,
    container_id: str = '',
    dialog_title: str = '',
    query_ui: bool = False,
    has_query_no_save: bool = False,
) -> bool:
    """True when UI is customer-magnifier / search-picker (not maintain form)."""
    if query_ui or has_query_no_save:
        return True
    cid = container_id or ''
    if cid.startswith('dialog:') or cid.startswith('drawer:'):
        title = cid.split(':', 1)[-1] if ':' in cid else dialog_title
        title = title or dialog_title or ''
        if _PICKER_TITLE_RE.search(title) and not (
            _MAINTAIN_TITLE_RE.search(title) and not re.search(r'选择|引入|放大镜', title)
        ):
            # Prefer picker when title has 选择/引入 even if also has 信息
            if re.search(r'选择|引入|放大镜|查询客户|客户列表|挑选', title):
                return True
            if _PICKER_TITLE_RE.search(title) and not _MAINTAIN_TITLE_RE.search(title):
                return True
    if dialog_title and re.search(r'选择|引入|放大镜|查询客户|客户列表|挑选', dialog_title):
        return True
    return False

def should_block_index_submit_boundary(
    boundary: dict[str, Any] | None,
    btn_label: str,
    *,
    in_form_overlay: bool,
    dialog_title: str = '',
    container_id: str = '',
    query_ui: bool = False,
) -> bool:
    """True when index-click on submit label must be blocked."""
    compact = re.sub(r'\s+', '', (btn_label or '').strip())
    if not compact:
        return False
    picker = is_picker_context(
        container_id=container_id,
        dialog_title=dialog_title,
        query_ui=query_ui,
        has_query_no_save=query_ui,
    )
    # Query/picker UI: never allow 保存/提交 via index
    if picker and _SAVE_BTN_RE.match(compact):
        return True
    # Picker: allow 确认/确定
    if picker and _CONFIRM_BTN_RE.match(compact):
        return False

    if not boundary:
        return in_form_overlay and not picker
    if not boundary.get('forbid_index_submit'):
        return False
    if not re.match(r'^(保存|提交|确认|确定)', compact):
        return False
    if _SAVE_BTN_RE.match(compact):
        return True
    # 确认 on maintain overlay (not picker)
    return in_form_overlay and not picker

def mark_parent_form_stale(business_data_store: dict | None, parent_container: str = '') -> None:
    if not business_data_store:
        return
    parent = parent_container or business_data_store.get('_parent_container_before_picker') or 'main'
    business_data_store['_form_stale'] = parent
    business_data_store.pop('_query_ui', None)

def maybe_record_picker_closed(
    business_data_store: dict | None,
    *,
    still_query_ui: bool,
    parent_container: str = '',
) -> bool:
    """If picker closed, record evidence + stale parent. Returns True when recorded."""
    if still_query_ui:
        return False
    b = get_phase_boundary(business_data_store)
    # Always allow recording when introduce goals or picker_allowed
    if b and not (
        b.get('picker_allowed')
        or b.get('role') == 'introduce'
        or b.get('requires_introduce_then_save')
    ):
        # Still record if we had parent picker context
        if not business_data_store.get('_parent_container_before_picker'):
            return False
    record_evidence(business_data_store, 'picker_closed', 'dialog-closed')
    record_evidence(business_data_store, 'dialog_confirmed', 'picker-closed')
    mark_parent_form_stale(business_data_store, parent_container)
    # A popup region remembered in _phase_section (e.g. via save_retry_scope
    # inside the picker) is by definition stale once the popup closes — clear
    # it so the next save re-resolves against the live DOM.
    from scripts.controller.actions.section_scope import clear_phase_section

    clear_phase_section(business_data_store)
    return True


_QUERY_BTN_RE = re.compile(r'^(查询|搜索|查找)')
_NEXT_BTN_RE = re.compile(r'^(下一步|继续|下一步骤|上一步|返回上一步)')


def maybe_record_click_completion_evidence(
    business_data_store: dict | None,
    *,
    btn_label: str = '',
    url_changed: bool = False,
    overlay_title_before: str = '',
    overlay_title_after: str = '',
) -> list[str]:
    """Record G3 query/nav evidence kinds after a successful index click.

    Returns list of kinds newly recorded (empty if none / no boundary).
    """
    if not business_data_store or not phase_boundary_active(business_data_store):
        return []
    recorded: list[str] = []
    compact = re.sub(r'\s+', '', (btn_label or '').strip())
    before = (overlay_title_before or '').strip()
    after = (overlay_title_after or '').strip()

    if url_changed:
        record_evidence(business_data_store, 'url_change', 'post-click-url')
        recorded.append('url_change')

    # New or retitled visible overlay → page_opened (OR evidence for navigate).
    if after and after != before:
        record_evidence(business_data_store, 'page_opened', after[:80])
        recorded.append('page_opened')

    if compact and _QUERY_BTN_RE.match(compact):
        record_evidence(business_data_store, 'query_clicked', compact[:40])
        recorded.append('query_clicked')

    if compact and _NEXT_BTN_RE.match(compact):
        record_evidence(business_data_store, 'nav_next_clicked', compact[:40])
        recorded.append('nav_next_clicked')

    return recorded


def next_action_hint(business_data_store: dict | None) -> str:
    """NEXT_ACTION cue from boundary goals + current pending."""
    b = get_phase_boundary(business_data_store)
    if not b:
        return ''
    from scripts.models.task import TaskList

    tl = TaskList.from_store((business_data_store or {}).get('task_list'))
    intervene = [i.label for i in tl.pending if i.needs_intervention]
    fillable = [i for i in tl.pending if not i.needs_intervention]
    have = observed_kinds(business_data_store)
    intro_kinds = {'picker_closed', 'dialog_confirmed', 'introduced_backfilled'}

    if fillable:
        return ''
    if b.get('requires_introduce_then_save') and not (have & intro_kinds):
        return (
            'NEXT_ACTION: complete introduce/picker first (use_special_element or '
            'click_adjacent_button → 查询 → 选行 → 确认), then click_save(保存).'
        )
    if b.get('role') == 'maintain':
        # Single-field / no-submit phases must not nudge click_save (burns steps +
        # plants validation errors). Same contract signal as overlay_blocks_done.
        c = (business_data_store or {}).get('_phase_intent')
        if isinstance(c, dict):
            from scripts.controller.actions.phase.reviewer import coerce_bool
            submit = c.get('submit') if isinstance(c.get('submit'), dict) else {}
            kinds = (c.get('success') or {}).get('kinds') or []
            if not isinstance(kinds, (list, tuple)):
                kinds = []
            if not coerce_bool(submit.get('required')) and len(kinds) == 0:
                return (
                    'NEXT_ACTION: done(success=true) | this phase does not require save. '
                    'Do NOT call click_save(). Confirm the field change then done().'
                )
        return (
            'NEXT_ACTION: click_save() | fillable pending=0. '
            'Call click_save() NOW. Do NOT re-fill already-filled fields.'
        )
    if b.get('role') == 'introduce':
        return 'NEXT_ACTION: select row then confirm (index click on 确认 OK).'
    if b.get('role') == 'query':
        if 'query_clicked' not in have:
            return (
                'NEXT_ACTION: click_element_by_index on 「查询/搜索」 first; '
                'only then done(success=true).'
            )
        return 'NEXT_ACTION: evidence ok — done(success=true).'
    if b.get('role') == 'navigate':
        if 'open_page' in (b.get('goals') or []):
            if not (have & {'url_change', 'page_opened'}):
                return (
                    'NEXT_ACTION: finish the clicks described in the task until the target '
                    'page/dialog appears (need url_change or page_opened evidence), then '
                    'done(success=true) — do NOT operate inside the new page '
                    '(no fill / no 下一步 / no 确定).'
                )
            return (
                'NEXT_ACTION: finish the clicks described in the task; once the target '
                'page/dialog appears, done(success=true) — do NOT operate inside the new page '
                '(no fill / no 下一步 / no 确定).'
            )
        if 'nav_next_clicked' not in have and not (have & {'url_change', 'page_opened'}):
            return (
                'NEXT_ACTION: set task fields then click_element_by_index on 下一步 '
                '(not 查询-as-done); after risk confirm if any, done(success=true).'
            )
        return (
            'NEXT_ACTION: set task fields then click_element_by_index on 下一步 '
            '(not 查询-as-done); after risk confirm if any, done(success=true).'
        )
    return ''
