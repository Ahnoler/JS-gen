"""Form scan/classify helpers (extracted verbatim from scripts/controller/actions/_form.py).

Scan, section grouping, query-mode detection, snapshot persistence, task
completion and submit cues. ``_register_form_actions`` lives in _form.py.
"""

import json
import re
import sys
from dataclasses import dataclass

from scripts.state import _ACTION_LOG, _record_action
from ._helpers import (
    _as_dict,
    attach_select_options,
    options_from_scan_store,
    read_select_options,
)
from ._js_snippets import JS_SCAN_FORM_FIELDS, JS_IS_QUERY_TOOLBAR, JS_GET_CONTAINER
from .scan_summary import (  # noqa: F401  (re-exported for compat)
    _build_section_summary,
    _project_summary_buttons,
    _project_summary_field,
    _region_display_label,
    _summary_regions,
    _summary_scope,
    build_editable_summary,
)
from .select_match import (  # noqa: F401  (re-exported for compat)
    _SELECT_OPTION_SENTINELS,
    match_select_option_candidate,
    resolve_recorded_option_text,
    select_option_already_matched,
)
from .task_completion import (  # noqa: F401  (re-exported for compat)
    _query_not_form_payload,
    _submit_ready_hint,
    _switch_task_list_container,
    _task_done_impl,
    _task_xpath_smart,
    _with_submit_cue,
)
from .js_snippets.scan_utils import (  # noqa: F401  (re-exported for compat)
    _JS_READ_CERT_TYPE,
    _JS_EXTRACT_ERROR_LABELS,
)
from ...models import FormSnapshot, FormSnapshotCollection, TaskList
from ...models.field import ScannedButton
from .container_naming import overlay_title_from_container_id
from .form_rules import get_has_button_keywords

# Search/picker dialogs — agent must control which query fields to fill.
# Data-entry dialogs (新增/编辑/校验…) still get auto-fill + case data.
_SEARCH_DIALOG_HINTS = ('查询', '搜索', '查找', '选择客户', '选择法人', '引入', '挑选')

_QUERY_NEXT_HINT = (
    'NOT_FORM_FILL | mode=query_filter | '
    'Search/filter UI — not a data-entry form. '
    'Do NOT use task_list / auto-fill / click_save. '
    'Set filters named by the task, then click 查询 via click_element_by_index.'
)


def _is_search_dialog(container_id: str) -> bool:
    if not (container_id or '').startswith('dialog:'):
        return False
    title = overlay_title_from_container_id(container_id)
    return any(h in title for h in _SEARCH_DIALOG_HINTS)


def is_chrome_menu_label(text: str | None) -> bool:
    """True when label matches portal chrome menu noise (layout/theme/close-tab)."""
    t = (text or "").strip()
    if not t:
        return False
    if "布局" in t:
        return True
    if "主题" in t:
        return True
    if "页签" in t and ("关闭" in t or "固定" in t):
        return True
    # Portal synonym: 标签 ≈ 页签 (e.g. 关闭所有标签(含固定))
    if "标签" in t and ("关闭" in t or "固定" in t):
        return True
    return False


def _force_refill_flag(business_data_store: dict | None) -> bool:
    from scripts.controller.actions._phase_intent import contract_force_refill
    return contract_force_refill(business_data_store)


def _scan_buttons_from_result(result) -> list[dict]:
    """Parse standalone buttons from JS_SCAN_FORM_FIELDS JSON (not TaskList fields)."""
    if not isinstance(result, dict):
        return []
    raw = result.get('buttons') or []
    out: list[dict] = []
    for b in raw:
        if isinstance(b, dict):
            out.append(ScannedButton(**b).model_dump())
        elif isinstance(b, ScannedButton):
            out.append(b.model_dump())
    return out


async def refresh_scan_buttons(page, business_data_store) -> list[dict]:
    """Rescan DOM buttons into ``business_data_store['_scan_buttons']``; return button list."""
    raw = await page.evaluate(JS_SCAN_FORM_FIELDS, [False, get_has_button_keywords(business_data_store)])
    try:
        result = _as_dict(raw)
    except Exception:
        return list(business_data_store.get('_scan_buttons') or [])
    buttons = _scan_buttons_from_result(result)
    business_data_store['_scan_buttons'] = buttons
    return buttons


def _section_group_key(section_id: str, section_title: str) -> str:
    sid = (section_id or '').strip()
    if sid:
        return sid
    title = (section_title or '').strip()
    if title:
        return title
    return '__root__'


def _dedupe_needs_agent(needs: list) -> list:
    """Dedupe needs_agent entries by label; last reason wins."""
    by_label: dict[str, dict] = {}
    order: list[str] = []
    for n in needs or []:
        if not isinstance(n, dict):
            continue
        label = (n.get('label') or '').strip()
        if not label:
            continue
        if label in by_label:
            order.remove(label)
        order.append(label)
        by_label[label] = n
    return [by_label[lbl] for lbl in order]


KNOWN_EDITABLE_FIELD_KINDS = frozenset({
    'input', 'select', 'date', 'radio', 'checkbox', 'tree-select', 'tree',
})

_SHELL_ROLES = frozenset({'shell-header', 'shell-aside'})
_NON_FILL_KINDS = frozenset({'menu_item', 'icon'})
_SCANNED_FIELD_KINDS = frozenset({
    'input', 'select', 'date', 'radio', 'checkbox', 'tree-select', 'unknown',
})
_TREE_FILTER_LABEL_RE = re.compile(r'关键字|过滤|搜索')
_NUMERIC_DISPLAY_RE = re.compile(r'^-?\d+(\.\d+)?$')


def parse_numeric_display(value: str | None) -> float | None:
    """Parse amount-like display text (strips thousand commas). None if not numeric."""
    t = (value or '').strip().replace(',', '').replace(' ', '').replace('\u00a0', '')
    if not t or not _NUMERIC_DISPLAY_RE.fullmatch(t):
        return None
    try:
        return float(t)
    except ValueError:
        return None


def field_values_equivalent(current: str | None, expected: str | None) -> bool:
    """True when DOM display value matches filled/expected (amount format tolerant).

    ``2026`` ≡ ``2,026.00``. When either side is numeric, do not fall back to
    substring (avoids ``12`` matching ``1,234.00``). Non-numeric keeps exact /
    containment for units / suffixes.
    """
    a = (current or '').strip()
    b = (expected or '').strip()
    if not a or not b:
        return False
    if a == b:
        return True
    na, nb = parse_numeric_display(a), parse_numeric_display(b)
    if na is not None and nb is not None:
        return abs(na - nb) < 1e-9
    if na is not None or nb is not None:
        return False
    return b in a or a in b


def enrich_field_value_check(info: dict) -> dict:
    """Annotate check_field_value JSON so agents don't loop on amount formatting."""
    if not isinstance(info, dict):
        return info
    cv = (info.get('currentValue') or '').strip()
    n = parse_numeric_display(cv)
    if n is None:
        return info
    if ',' in cv or ('.' in cv and cv.split('.')[-1].strip('0') == ''):
        if abs(n - round(n)) < 1e-9:
            bare = str(int(round(n)))
        else:
            bare = ('%f' % n).rstrip('0').rstrip('.')
        info['normalizedValue'] = bare
        info['valueNote'] = (
            '金额/数字字段可能显示千分位与小数位；'
            f'normalizedValue={bare} 与填入的裸数字等价时勿反复重填。'
            '核对请用 verify_field_value。'
        )
    return info


def tasklist_scan_mode(container_id: str = '') -> str:
    """Scan mode for TaskList / write-gate inventory (not summary-only).

    Visible dialog/drawer maintain forms must use ``multi`` so list-page query
    fields and page tree filters are not mixed into the overlay TaskList.
    ``fullpage`` remains for main-page inventory.
    """
    cid = (container_id or '').strip()
    if cid.startswith(('dialog:', 'drawer:')):
        return 'multi'
    return 'fullpage'


def is_tasklist_noise_field(field: dict | None) -> bool:
    """True for controls that must not block click_save / premature-done gates."""
    if not isinstance(field, dict):
        return True
    label = (field.get('label') or '').strip()
    if not label:
        return True
    ph = (field.get('placeholder') or '').strip()
    kind = (field.get('kind') or '').strip()
    xp = (field.get('xpath_smart') or '').strip()
    # Tree / search filter: placeholder used as label (e.g. 输入关键字进行过滤)
    if ph and label == ph and _TREE_FILTER_LABEL_RE.search(label):
        return True
    if kind in ('tree-select', 'tree') and _TREE_FILTER_LABEL_RE.search(label):
        return True
    # Source B table-row radio option text (e.g. label=对公) — not a form-item field
    if kind == 'radio' and '//tr[' in xp and 'el-form-item' not in xp:
        return True
    return False


def filter_fillable_scan_fields(fields: list | None) -> list[dict]:
    """Fields eligible for TaskList / autofill (exclude shell + menu_item/icon)."""
    out: list[dict] = []
    for f in fields or []:
        if not isinstance(f, dict):
            continue
        kind = (f.get('kind') or '').strip()
        if kind in _NON_FILL_KINDS:
            continue
        role = (f.get('region_role') or '').strip()
        if role in _SHELL_ROLES:
            continue
        if is_tasklist_noise_field(f):
            continue
        out.append(f)
    return out


def prepare_scan_fields_for_tasklist(fields: list | None) -> list[dict]:
    """Filter shell noise then normalize kinds for ScannedField / TaskList.from_scan."""
    prepared: list[dict] = []
    for f in filter_fillable_scan_fields(fields):
        d = dict(f)
        kind = (d.get('kind') or '').strip()
        if kind == 'tree':
            d['kind'] = 'tree-select'
        elif kind not in _SCANNED_FIELD_KINDS:
            d['kind'] = 'unknown'
        prepared.append(d)
    return prepared


def _field_is_filled(field: dict) -> bool:
    """True when scan field has a value (select: selected or currentValue)."""
    kind = (field.get('kind') or '').strip()
    if kind == 'select' and field.get('selected'):
        return True
    return bool((field.get('currentValue') or '').strip())


def _field_is_pending(field: dict) -> bool:
    """Empty, enabled, known-kind fields count toward pending_labels."""
    kind = (field.get('kind') or '').strip()
    if kind not in KNOWN_EDITABLE_FIELD_KINDS:
        return False
    if field.get('disabled'):
        return False
    return not _field_is_filled(field)


def _field_is_readonly(field: dict) -> bool:
    """Known-kind fields with disabled=True — keep for model reference, not fill targets."""
    kind = (field.get('kind') or '').strip()
    if kind not in KNOWN_EDITABLE_FIELD_KINDS:
        return False
    return bool(field.get('disabled'))


def _merge_scan_fields(scan_results: list[dict]) -> list[dict]:
    """Merge fields across scan dicts; dedupe by non-empty xpath_smart (first wins)."""
    merged: list[dict] = []
    seen_xpath: set[str] = set()
    for result in scan_results:
        if not isinstance(result, dict):
            continue
        for f in result.get('fields') or []:
            if not isinstance(f, dict):
                continue
            xp = (f.get('xpath_smart') or '').strip()
            if xp:
                if xp in seen_xpath:
                    continue
                seen_xpath.add(xp)
            merged.append(f)
    return merged


def _merge_scan_buttons(scan_results: list[dict]) -> list[dict]:
    merged: list[dict] = []
    for result in scan_results:
        if not isinstance(result, dict):
            continue
        for b in result.get('buttons') or []:
            if isinstance(b, dict):
                merged.append(b)
    return merged


def _is_query_mode(business_data_store: dict | None) -> bool:
    """True when this phase/UI is query-filter (no form-save / no auto-fill)."""
    if not business_data_store:
        return False
    if business_data_store.get('_task_mode') == 'query':
        return True
    return bool(
        business_data_store.get('_query_task')
        or business_data_store.get('_query_ui')
    )


def _skip_auto_fill(business_data_store: dict | None) -> bool:
    """True when run_form_assistant auto-fill must not run.

    Auto-fill only for form_fill and form_modify+force_refill_all.
    login / query / other / partial modify → skip.
    """
    if not business_data_store:
        return True
    if _is_query_mode(business_data_store):
        return True
    mode = business_data_store.get('_task_mode')
    if mode == 'form_fill':
        return False
    if mode == 'form_modify' and _force_refill_flag(business_data_store):
        return False
    return True


async def _mark_query_ui_if_needed(page, business_data_store, container_id: str = '') -> bool:
    """Detect query/filter UI; set _query_ui. Returns True if search context.

    Re-evaluates on every call — do not sticky-keep ``_query_ui`` after a picker
    dialog closes (that blocked click_save on the parent maintain form).
    Phase-level ``_query_task`` / task_mode=query still forces query semantics.
    """
    if business_data_store is None:
        return _is_search_dialog(container_id)
    if business_data_store.get('_query_task') or business_data_store.get('_task_mode') == 'query':
        business_data_store['_query_ui'] = True
        return True
    if _is_search_dialog(container_id):
        business_data_store['_query_ui'] = True
        return True
    is_qt = False
    try:
        is_qt = bool(await page.evaluate(JS_IS_QUERY_TOOLBAR))
    except Exception as e:
        sys.stderr.write(f'[form] query-toolbar detect failed: {e}\n')
        sys.stderr.flush()
    business_data_store['_query_ui'] = is_qt
    if is_qt:
        sys.stderr.write('[form] Detected query toolbar (有查询无保存) — skip save cues\n')
        sys.stderr.flush()
    return is_qt


async def _pack_select_record(page, business_data_store, label_text, option_text, element):
    """Build select_option params/element.

    - option_text: the value actually selected (replay contract — must stay exact)
    - options: full dropdown inventory for export / downstream products (reference)
    """
    opts = options_from_scan_store(business_data_store, label_text)
    live = await read_select_options(page, label_text)
    if live:
        # Prefer live (more complete after dropdown open); keep scan extras
        merged = list(live)
        for o in opts:
            if o not in merged:
                merged.append(o)
        opts = merged
    if option_text and option_text not in opts and option_text not in ('first', '1st', '第一个', '第一项'):
        opts = list(opts) + [option_text]
    params = {'label_text': label_text, 'option_text': option_text}
    return attach_select_options(params, element, opts)


def _save_form_snapshot(container: str, scan_fields: list[dict], business_data_store: dict, *, emit_checkpoint: bool = True):
    """Persist form structure snapshot to business_data_store; optionally emit ACTION_LOG checkpoint.

    Builds a FormSnapshot from scan fields, upserts into the collection
    (always append in memory), and updates both form_snapshots (array) and
    form_snapshot (latest single entry) in the store.

    When emit_checkpoint is True and the fingerprint is new for this root
    container, also _record_action('save_form_snapshot') for live MySQL dual-write.
    Identical fingerprint for the same root container → memory refresh only.
    """
    snapshot = FormSnapshot.from_scan_fields(
        container=container,
        scan_fields=scan_fields,
        action_index=len(_ACTION_LOG),
    )
    existing = business_data_store.get('form_snapshots') or []
    root = FormSnapshot._root_container(snapshot.container)
    fp = snapshot.fields_fingerprint
    already = False
    for s in existing:
        prev = FormSnapshot(**s) if isinstance(s, dict) else s
        if FormSnapshot._root_container(prev.container) == root and prev.fields_fingerprint == fp:
            already = True
            break

    if already:
        # Same structure already captured — refresh latest pointer only; no new ACTION_LOG
        business_data_store['form_snapshot'] = snapshot.model_dump()
        return snapshot

    coll = FormSnapshotCollection(list(existing))
    coll.upsert(snapshot)
    business_data_store['form_snapshots'] = coll.to_dicts()
    business_data_store['form_snapshot'] = snapshot.model_dump()

    if emit_checkpoint:
        params = snapshot.model_dump()
        # Emit label + is_required for every field; attach options only for
        # select / tree-select fields that actually have a non-empty option
        # list (legacy consumers ignore the extra key; the LLM uses it to
        # distinguish same-prefix dropdowns by their own options).
        field_entries = []
        for f in snapshot.fields:
            entry = {'label': f.label, 'is_required': f.is_required}
            if f.options:
                entry['options'] = list(f.options)
            field_entries.append(entry)
        params['fields'] = field_entries
        _record_action('save_form_snapshot', params, f'form-snapshot|{snapshot.container}|{snapshot.count}')

    return snapshot


@dataclass(frozen=True)
class ResolvedControl:
    xpath_smart: str
    label: str
    error: str = ""


def _resolve_control(business_data_store, label_text: str, xpath_hint: str = "") -> ResolvedControl:
    label = (label_text or "").strip()
    hint = (xpath_hint or "").strip()
    if hint:
        resolved_label = label
        in_inventory = False
        for f in business_data_store.get("_scan_fields") or []:
            if isinstance(f, dict) and (f.get("xpath_smart") or "").strip() == hint:
                resolved_label = (f.get("label") or label).strip() or label
                in_inventory = True
                break
        if not in_inventory:
            tl = TaskList.from_store(business_data_store.get("task_list"))
            for item in list(tl.pending) + list(tl.done):
                if (item.xpath_smart or "").strip() == hint and (item.label or "").strip():
                    resolved_label = item.label.strip()
                    in_inventory = True
                    break
        if in_inventory:
            return ResolvedControl(xpath_smart=hint, label=resolved_label or label, error="")
        # Invented / stale hint (traj 130 placeholder[1]): prefer unique inventory
        # for this label when available; keep hint only as last resort.
        by_label = _resolve_control_by_label(business_data_store, label_text)
        if not by_label.error and by_label.xpath_smart:
            return by_label
        # Spec: never return invented hint for write/persist.
        return ResolvedControl(
            xpath_smart="",
            label=label or label_text or "",
            error="xpath-not-found",
        )

    return _resolve_control_by_label(business_data_store, label_text)


def _resolve_control_by_label(business_data_store, label_text: str) -> ResolvedControl:
    matches: list[tuple[str, str]] = []
    seen_xp: set[str] = set()
    tl = TaskList.from_store(business_data_store.get("task_list"))
    for item in list(tl.pending) + list(tl.done):
        if item.label == label_text and (item.xpath_smart or "").strip():
            xp = item.xpath_smart.strip()
            if xp not in seen_xp:
                seen_xp.add(xp)
                matches.append((xp, item.label))
    for f in business_data_store.get("_scan_fields") or []:
        if not isinstance(f, dict):
            continue
        if f.get("label") != label_text:
            continue
        xp = (f.get("xpath_smart") or "").strip()
        if xp and xp not in seen_xp:
            seen_xp.add(xp)
            matches.append((xp, str(f.get("label") or label_text)))

    if not matches:
        return ResolvedControl(xpath_smart="", label=label_text or "", error="xpath-not-found")
    if len(matches) == 1:
        xp, lab = matches[0]
        return ResolvedControl(xpath_smart=xp, label=lab, error="")
    return ResolvedControl(xpath_smart="", label=label_text or "", error="ambiguous-label")


def resolve_select_fallback(
    business_data_store,
    label_text: str,
    failed_xpath: str,
) -> ResolvedControl | None:
    """Return one inventory xpath after an explicit xpath actually missed."""
    failed = (failed_xpath or "").strip()
    candidate = _resolve_control(business_data_store, label_text, "")
    if candidate.error or not candidate.xpath_smart:
        return None
    if candidate.xpath_smart.strip() == failed:
        return None
    return candidate


