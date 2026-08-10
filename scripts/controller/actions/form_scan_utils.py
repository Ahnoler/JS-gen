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
    attach_select_options,
    options_from_scan_store,
    read_select_options,
)
from ._js_snippets import JS_SCAN_FORM_FIELDS, JS_IS_QUERY_TOOLBAR, JS_GET_CONTAINER
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


def _force_refill_flag(case_data_store: dict | None) -> bool:
    from scripts.controller.actions._phase_intent import contract_force_refill
    return contract_force_refill(case_data_store)


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


async def refresh_scan_buttons(page, case_data_store) -> list[dict]:
    """Rescan DOM buttons into ``case_data_store['_scan_buttons']``; return button list."""
    raw = await page.evaluate(JS_SCAN_FORM_FIELDS, [False, get_has_button_keywords(case_data_store)])
    try:
        result = json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        return list(case_data_store.get('_scan_buttons') or [])
    buttons = _scan_buttons_from_result(result)
    case_data_store['_scan_buttons'] = buttons
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


def _is_query_mode(case_data_store: dict | None) -> bool:
    """True when this phase/UI is query-filter (no form-save / no auto-fill)."""
    if not case_data_store:
        return False
    if case_data_store.get('_task_mode') == 'query':
        return True
    return bool(
        case_data_store.get('_query_task')
        or case_data_store.get('_query_ui')
    )


def _skip_auto_fill(case_data_store: dict | None) -> bool:
    """True when run_form_assistant auto-fill must not run.

    Auto-fill only for form_fill and form_modify+force_refill_all.
    login / query / other / partial modify → skip.
    """
    if not case_data_store:
        return True
    if _is_query_mode(case_data_store):
        return True
    mode = case_data_store.get('_task_mode')
    if mode == 'form_fill':
        return False
    if mode == 'form_modify' and _force_refill_flag(case_data_store):
        return False
    return True


async def _mark_query_ui_if_needed(page, case_data_store, container_id: str = '') -> bool:
    """Detect query/filter UI; set _query_ui. Returns True if search context.

    Re-evaluates on every call — do not sticky-keep ``_query_ui`` after a picker
    dialog closes (that blocked click_save on the parent maintain form).
    Phase-level ``_query_task`` / task_mode=query still forces query semantics.
    """
    if case_data_store is None:
        return _is_search_dialog(container_id)
    if case_data_store.get('_query_task') or case_data_store.get('_task_mode') == 'query':
        case_data_store['_query_ui'] = True
        return True
    if _is_search_dialog(container_id):
        case_data_store['_query_ui'] = True
        return True
    is_qt = False
    try:
        is_qt = bool(await page.evaluate(JS_IS_QUERY_TOOLBAR))
    except Exception as e:
        sys.stderr.write(f'[form] query-toolbar detect failed: {e}\n')
        sys.stderr.flush()
    case_data_store['_query_ui'] = is_qt
    if is_qt:
        sys.stderr.write('[form] Detected query toolbar (有查询无保存) — skip save cues\n')
        sys.stderr.flush()
    return is_qt


async def _pack_select_record(page, case_data_store, label_text, option_text, element):
    """Build select_option params/element.

    - option_text: the value actually selected (replay contract — must stay exact)
    - options: full dropdown inventory for export / downstream products (reference)
    """
    opts = options_from_scan_store(case_data_store, label_text)
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


# Read current 证件类型 / 证照类型 display value from the open form.
_JS_READ_CERT_TYPE = '''(kw) => {
    const items = document.querySelectorAll('.el-form-item');
    for (const item of items) {
        const lbl = item.querySelector('.el-form-item__label');
        if (!lbl) continue;
        if (kw.some(k => lbl.textContent.trim().includes(k))) {
            const inp = item.querySelector('input:not([type="hidden"])');
            if (inp && inp.value) return inp.value;
            const inner = item.querySelector('.el-input__inner');
            if (inner && inner.value) return inner.value;
            const selected = item.querySelector('.el-select__tags-text, .el-radio.is-checked');
            if (selected && selected.textContent) return selected.textContent.trim();
        }
    }
    return '';
}'''

# Extract validation-error field labels from parent .el-form-item (not error text).
_JS_EXTRACT_ERROR_LABELS = '''() => {
    const container = ''' + JS_GET_CONTAINER + ''';
    const items = [];
    const seen = new Set();
    for (const el of container.querySelectorAll('.el-form-item__error')) {
        const raw = (el.textContent || '').trim();
        if (!raw) continue;
        const formItem = el.closest('.el-form-item');
        let label = (formItem && formItem.querySelector('.el-form-item__label')
            ? formItem.querySelector('.el-form-item__label').textContent.trim()
            : '');
        if (!label) {
            // Fallback: strip imperative prefix from error message
            label = raw.replace(/^(请选择|请?输入|请上传|填写|完善)/, '').replace(/[：:]/g, '').trim();
        }
        if (label && label.length > 0 && label.length < 40 && !seen.has(label)) {
            seen.add(label);
            items.push(label);
        }
    }
    return JSON.stringify(items);
}'''


def _save_form_snapshot(container: str, scan_fields: list[dict], case_data_store: dict, *, emit_checkpoint: bool = True):
    """Persist form structure snapshot to case_data_store; optionally emit ACTION_LOG checkpoint.

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
    existing = case_data_store.get('form_snapshots') or []
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
        case_data_store['form_snapshot'] = snapshot.model_dump()
        return snapshot

    coll = FormSnapshotCollection(list(existing))
    coll.upsert(snapshot)
    case_data_store['form_snapshots'] = coll.to_dicts()
    case_data_store['form_snapshot'] = snapshot.model_dump()

    if emit_checkpoint:
        params = snapshot.model_dump()
        params['fields'] = [
            {'label': f.label, 'is_required': f.is_required}
            for f in snapshot.fields
        ]
        _record_action('save_form_snapshot', params, f'form-snapshot|{snapshot.container}|{snapshot.count}')

    return snapshot


@dataclass(frozen=True)
class ResolvedControl:
    xpath_smart: str
    label: str
    error: str = ""


def _resolve_control(case_data_store, label_text: str, xpath_hint: str = "") -> ResolvedControl:
    label = (label_text or "").strip()
    hint = (xpath_hint or "").strip()
    if hint:
        resolved_label = label
        for f in case_data_store.get("_scan_fields") or []:
            if isinstance(f, dict) and (f.get("xpath_smart") or "").strip() == hint:
                resolved_label = (f.get("label") or label).strip() or label
                break
        if resolved_label == label:
            tl = TaskList.from_store(case_data_store.get("task_list"))
            for item in list(tl.pending) + list(tl.done):
                if (item.xpath_smart or "").strip() == hint and (item.label or "").strip():
                    resolved_label = item.label.strip()
                    break
        return ResolvedControl(xpath_smart=hint, label=resolved_label or label, error="")

    matches: list[tuple[str, str]] = []
    seen_xp: set[str] = set()
    tl = TaskList.from_store(case_data_store.get("task_list"))
    for item in list(tl.pending) + list(tl.done):
        if item.label == label_text and (item.xpath_smart or "").strip():
            xp = item.xpath_smart.strip()
            if xp not in seen_xp:
                seen_xp.add(xp)
                matches.append((xp, item.label))
    for f in case_data_store.get("_scan_fields") or []:
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


def _task_xpath_smart(case_data_store, label_text: str, xpath_hint: str = "") -> str:
    """Compat wrapper — prefer _resolve_control; returns xpath or '' (not error codes)."""
    r = _resolve_control(case_data_store, label_text, xpath_hint)
    return r.xpath_smart if not r.error else ""


def _task_done_impl(label_text, case_data_store, value=None, xpath_smart=""):
    """Mark a field as completed in the task list.

    Extracted from closure so the form module can share it internally
    and future split modules can import it.

    ``value`` is the value that was just written (fill/select). Stored on
    TaskItem.currentValue so scan_form_fields summaries are not empty after
    auto-fill.

    When ``xpath_smart`` is set, disambiguates duplicate labels in mark_done.

    Query/filter UI is not form-fill — skip task_list tracking entirely.
    """
    if _is_query_mode(case_data_store):
        return
    xp = _task_xpath_smart(case_data_store, label_text, xpath_smart)
    tl = TaskList.from_store(case_data_store.get('task_list'))
    found = tl.mark_done(label_text, value=value, xpath_smart=xp)
    if found is not None:
        sys.stderr.write(f'[task-done] OK: "{label_text}" → done={len(tl.done)}\n')
    else:
        already = tl.find_done(label_text)
        if already is None and xp:
            already = next((d for d in tl.done if d.xpath_smart == xp), None)
        if already is None:
            sys.stderr.write(f'[task-done] NOT FOUND: "{label_text}"\n')
        else:
            sys.stderr.write(f'[task-done] ALREADY: "{label_text}"\n')
    case_data_store['task_list'] = tl.to_store()
    # Write-through active container slot so same/cross-container switch
    # does not restore a pre-mark_done snapshot.
    active = case_data_store.get('_active_container')
    if active:
        by = case_data_store.setdefault('_task_lists_by_container', {})
        if isinstance(by, dict):
            by[active] = {
                'task_list': case_data_store.get('task_list'),
                '_scan_fields': case_data_store.get('_scan_fields'),
            }
    if value is not None and str(value).strip():
        labels = case_data_store.setdefault('_autofilled_labels', [])
        if label_text not in labels:
            labels.append(label_text)
        case_data_store.setdefault('_generated_value_cache', {})[label_text] = str(value)


def _submit_ready_hint(case_data_store: dict, section: str = '') -> str:
    """Return a short NEXT_ACTION cue when fillable pending is empty.

    Query/filter UI is never form-fill — no click_save / pending-form cues.
    Prefers PhaseBoundary.next_action_hint when active.
    """
    if _is_query_mode(case_data_store):
        return ''
    try:
        from scripts.controller.actions._phase_boundary import next_action_hint, phase_boundary_active
        if phase_boundary_active(case_data_store):
            cue = next_action_hint(case_data_store)
            if cue:
                return cue
    except Exception:
        pass
    tl = TaskList.from_store(case_data_store.get('task_list'))
    from scripts.controller.actions.section_scope import resolve_phase_section, section_matches
    sec = (section or '').strip()
    fillable = [
        i for i in tl.pending
        if not i.needs_intervention
        and section_matches(sec, i.section_id, i.section_title, getattr(i, 'region_label', '') or '')
    ]
    if fillable:
        return ''
    # Legacy needs_intervention pending (old stores): do not block save cues —
    # introduce is agent/special-element/manual, not assistant intervene.
    if tl.total > 0:
        c = case_data_store.get('_phase_intent')
        if isinstance(c, dict):
            try:
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
            except Exception:
                pass
        # Auto-bind section when not explicitly scoped: memory/infer then unique save button
        from scripts.controller.actions.section_scope import (
            preferred_submit_button,
            preferred_submit_cue,
            same_label_section_keys,
            unique_button_section,
        )
        try:
            btn = preferred_submit_button(case_data_store, section=sec)
        except Exception:
            btn = '保存'
        keys = same_label_section_keys(case_data_store.get('_scan_buttons'), btn)
        if len(keys) >= 2:
            return f'NEXT_ACTION: {preferred_submit_cue(case_data_store, section="")}'
        if not sec:
            try:
                auto_sec = resolve_phase_section(case_data_store)
                if not auto_sec:
                    prefer = preferred_submit_button(case_data_store, section='')
                    auto_sec = unique_button_section(
                        case_data_store.get('_scan_buttons'), prefer,
                    ) or unique_button_section(
                        case_data_store.get('_scan_buttons'), '保存',
                    )
                if auto_sec:
                    sec = auto_sec
            except Exception:
                pass
        # Include section= when scoped so caller can pass it through to click_save
        sec_part = f", section='{sec}'" if sec else ''
        return (
            f"NEXT_ACTION: click_save(button_text='{btn}'{sec_part}) | fillable pending=0. "
            f"Call click_save(button_text='{btn}'{sec_part}) NOW "
            f"(auto-finds {btn}, scrolls into view). "
            f'Do NOT scroll_down / click_element_by_index to hunt for {btn}. '
            'Do NOT re-fill or re-select already-filled fields.'
        )
    return ''


def _switch_task_list_container(case_data_store: dict, container_id: str) -> None:
    """Persist/restore task_list keyed by JS_IDENTIFY_CONTAINER id."""
    by = case_data_store.setdefault('_task_lists_by_container', {})
    if not isinstance(by, dict):
        by = {}
        case_data_store['_task_lists_by_container'] = by
    active = case_data_store.get('_active_container')
    # Same container: keep live flat view (mark_done progress). Do not
    # restore a stale first-touch snapshot from the slot.
    if active and active == container_id:
        by[container_id] = {
            'task_list': case_data_store.get('task_list'),
            '_scan_fields': case_data_store.get('_scan_fields'),
        }
        return
    if active and active != container_id:
        # Save current flat view
        by[active] = {
            'task_list': case_data_store.get('task_list'),
            '_scan_fields': case_data_store.get('_scan_fields'),
        }
    prev = active
    case_data_store['_active_container'] = container_id
    if (
        prev
        and str(prev).startswith(('dialog:', 'drawer:'))
        and not str(container_id).startswith(('dialog:', 'drawer:'))
    ):
        from scripts.controller.actions.container_naming import clear_trigger_button
        clear_trigger_button(case_data_store)
    saved = by.get(container_id)
    if isinstance(saved, dict):
        if saved.get('task_list') is not None:
            case_data_store['task_list'] = saved['task_list']
        if saved.get('_scan_fields') is not None:
            case_data_store['_scan_fields'] = saved['_scan_fields']
    elif active != container_id:
        # Fresh container — clear flat view so scan runs
        case_data_store.pop('task_list', None)
        case_data_store.pop('_scan_fields', None)
        case_data_store.pop('_autofill_summary', None)
        case_data_store.pop('_submit_ready', None)


def _with_submit_cue(result: str, case_data_store: dict) -> str:
    """Append auto-fill / submit-ready cue — skipped entirely for query/filter UI."""
    if _is_query_mode(case_data_store):
        case_data_store.pop('_autofill_summary', None)
        case_data_store.pop('_submit_ready', None)
        case_data_store.pop('_query_ready', None)
        return result
    parts = [result]
    summary = case_data_store.pop('_autofill_summary', None)
    if summary:
        parts.append(summary)
    cue = _submit_ready_hint(case_data_store)
    if cue:
        parts.append(cue)
        # Only arm recorder's click_save HumanMessage inject for real save cues.
        if 'NEXT_ACTION: click_save()' in cue:
            case_data_store['_submit_ready'] = True
        else:
            case_data_store.pop('_submit_ready', None)
    return ' | '.join(parts)


def _query_not_form_payload(container_id: str = '') -> str:
    """JSON payload telling the agent this UI is not form-fill."""
    return json.dumps({
        'not_form_fill': True,
        'mode': 'query_filter',
        'container': container_id or '',
        'hint': _QUERY_NEXT_HINT,
    }, ensure_ascii=False)


