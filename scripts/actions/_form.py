"""
Form-related actions: scan, fill, select, task list, validation.

The largest action group — registers 18 controller actions for
Element UI form interaction.
"""

import json
import sys

from ..agent_utils import emit_json
from ._state import _ACTION_LOG, _record_action
from ._helpers import (
    _ok, _err, _is_ok_result,
    _wait_if_loading, _capture_element, _merge_ax_text,
    _enrich_click_element,
)
from ._js_snippets import (
    JS_GET_CONTAINER, JS_IDENTIFY_CONTAINER,
    JS_CHECK_SINGLE_FIELD, JS_SCAN_FORM_FIELDS,
    JS_FILL_FORM_FIELD, JS_FILL_DATE_FIELD,
    JS_FIND_LABELED_SELECT, JS_FIND_OPTION, JS_SELECT_OPTION, JS_LOCATOR,
    JS_CLICK_RADIO,
    JS_SELECT_TREE_OPTION,
    JS_SCROLL_TO_FIRST_ERROR,
    JS_CLICK_SAVE_BUTTON, JS_SCAN_SAVE_OUTCOME,
)
from ._llm_values import _llm_generate_values
from ..models import (
    ScannedField, FormScanResult, Notification,
    FormSnapshot, FormSnapshotCollection,
    TaskItem, TaskList,
)
from .form_rules import (
    match_rule, match_cert_number, get_has_button_keywords,
    _gen_name,
)

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


def _save_form_snapshot(container: str, scan_fields: list[dict], case_data_store: dict):
    """Persist form structure snapshot to case_data_store.

    Builds a FormSnapshot from scan fields, upserts into the collection
    (deduped by container), and updates both form_snapshots (array) and
    form_snapshot (latest single entry) in the store.
    """
    snapshot = FormSnapshot.from_scan_fields(
        container=container,
        scan_fields=scan_fields,
        action_index=len(_ACTION_LOG),
    )
    coll = FormSnapshotCollection(case_data_store.get('form_snapshots', []))
    coll.upsert(snapshot)
    case_data_store['form_snapshots'] = coll.to_dicts()
    case_data_store['form_snapshot'] = snapshot.model_dump()
    return snapshot


def _task_done_impl(label_text, case_data_store, value=None):
    """Mark a field as completed in the task list.

    Extracted from closure so the form module can share it internally
    and future split modules can import it.

    ``value`` is the value that was just written (fill/select). Stored on
    TaskItem.currentValue so scan_form_fields summaries are not empty after
    auto-fill.
    """
    tl = TaskList.from_store(case_data_store.get('task_list'))
    found = tl.mark_done(label_text, value=value)
    if found is not None:
        sys.stderr.write(f'[task-done] OK: "{label_text}" → done={len(tl.done)}\n')
    else:
        already = tl.find_done(label_text)
        if already is None:
            sys.stderr.write(f'[task-done] NOT FOUND: "{label_text}"\n')
        else:
            sys.stderr.write(f'[task-done] ALREADY: "{label_text}"\n')
    case_data_store['task_list'] = tl.to_store()


def _submit_ready_hint(case_data_store: dict) -> str:
    """Return a short NEXT_ACTION cue when fillable pending is empty."""
    tl = TaskList.from_store(case_data_store.get('task_list'))
    intervene = [i.label for i in tl.pending if i.needs_intervention]
    fillable = [i for i in tl.pending if not i.needs_intervention]
    if fillable:
        return ''
    if intervene:
        return (
            f'NEXT_ACTION: click_save() | '
            f'fillable pending=0 but NEEDS_INTERVENTION={intervene}. '
            f'Call click_save() first. If validation blocks on those fields, '
            f'use click_adjacent_button / follow [HUMAN INTERVENTION]. '
            f'Do NOT re-select already-filled fields. Do NOT scroll_down to hunt for 保存.'
        )
    if tl.total > 0:
        return (
            'NEXT_ACTION: click_save() | fillable pending=0. '
            'Call click_save() NOW (auto-finds 保存/提交, scrolls into view). '
            'Do NOT scroll_down / click_element_by_index to hunt for 保存. '
            'Do NOT re-fill or re-select already-filled fields.'
        )
    return ''


def _with_submit_cue(result: str, case_data_store: dict) -> str:
    """Append auto-fill / submit-ready cue to an action result string."""
    parts = [result]
    summary = case_data_store.pop('_autofill_summary', None)
    if summary:
        parts.append(summary)
    cue = _submit_ready_hint(case_data_store)
    if cue:
        parts.append(cue)
        case_data_store['_submit_ready'] = True
    return ' | '.join(parts)


async def _clear_field_value(page, label_text):
    """Clear a form field's input value by label.

    Targets the input inside .el-form-item that matches the label,
    resets its value and dispatches input/change events so Vue picks it up.
    """
    try:
        await page.evaluate('''(label) => {
            const items = document.querySelectorAll('.el-form-item');
            for (const item of items) {
                const lbl = item.querySelector('.el-form-item__label');
                if (!lbl || !lbl.textContent.trim().includes(label)) continue;
                const trigger = item.querySelector('input, .el-input__inner, textarea');
                if (!trigger) continue;
                // Clear via native setter so Vue reacts
                Object.getOwnPropertyDescriptor(
                    HTMLInputElement.prototype, 'value'
                ).set.call(trigger, '');
                trigger.dispatchEvent(new Event('input', { bubbles: true }));
                trigger.dispatchEvent(new Event('change', { bubbles: true }));
                trigger.setAttribute('value', '');
                return 'cleared';
            }
            return 'not-found';
        }''', label_text)
    except Exception:
        pass


def _queue_intervention(case_data_store: dict, label: str, has_button: str, reason: str):
    """Queue an intervention request — appends to list so multiple fields are preserved.

    Replaces the old single-slot ``_intervention_request`` dict with an
    ``_intervention_queue`` list consumed by ``on_step_start`` in recorder.py.
    """
    queue = case_data_store.setdefault('_intervention_queue', [])
    # Dedup: skip if this label is already queued
    if any(q.get('label') == label for q in queue):
        return
    queue.append({
        'label': label,
        'hasButton': has_button or '',
        'reason': reason,
    })


def _register_form_actions(controller, browser_context, form_rules, case_data_store, llm=None):
    # Lazily read hasButton keywords — supports runtime override via case_data_store
    def _button_keywords():
        return get_has_button_keywords(case_data_store)

    async def _ensure_scanned(label_text: str):
        """Auto-scan + auto-fill if label is not in the current task_list.

        Deterministic trigger — no LLM dependency.  Two conditions:
        1. task_list doesn't exist → first form on this task
        2. task_list exists but label not in pending/done → new form

        Only triggers for main-page forms and drawers.  Dialogs are skipped
        — they are search/utility dialogs where agent needs fine control
        over which fields to fill.

        Skips auto-fill when _watcher_mode is set (CDP quick actions).
        """
        if case_data_store.get('_watcher_mode'):
            return  # CDP watcher: single-field action, no auto-scan
        page = await browser_context.get_current_page()
        container_id = await page.evaluate(JS_IDENTIFY_CONTAINER)
        if container_id.startswith('dialog:'):
            return  # skip: agent manages dialog fields manually

        tl = TaskList.from_store(case_data_store.get('task_list'))
        if tl.total > 0:
            pending_labels = {d.label for d in tl.pending}
            done_labels = {d.label for d in tl.done}
            if label_text in pending_labels or label_text in done_labels:
                return  # already scanned for this form

        # Scan main-page form
        raw = await page.evaluate(JS_SCAN_FORM_FIELDS, [False, _button_keywords()])
        try:
            result = json.loads(raw) if isinstance(raw, str) else raw
            raw_fields = result.get('fields') if isinstance(result, dict) else result
        except Exception:
            return
        dom_fields = [ScannedField(**f) if isinstance(f, dict) else f for f in raw_fields]
        container_id = result.get('container', 'main') if isinstance(result, dict) else 'main'

        # Save form structure snapshot BEFORE auto-fill (captures original state)
        _save_form_snapshot(container_id, [f.model_dump() for f in dom_fields], case_data_store)

        # Store scan data + auto-fill
        tl = TaskList.from_scan([f.model_dump() for f in dom_fields])
        case_data_store['task_list'] = tl.to_store()
        case_data_store['_scan_fields'] = [f.model_dump() for f in dom_fields]
        if tl.pending:
            await _auto_fill_pending()
            tl_after = TaskList.from_store(case_data_store.get('task_list'))
            fillable_left = sum(1 for i in tl_after.pending if not i.needs_intervention)
            intervene_left = [i.label for i in tl_after.pending if i.needs_intervention]
            case_data_store['_autofill_summary'] = (
                f'auto-fill-complete done={len(tl_after.done)} '
                f'fillable_pending={fillable_left} intervene={intervene_left or []}'
            )
            if fillable_left == 0:
                case_data_store['_submit_ready'] = True

    @controller.action('Expand ALL el-tree nodes recursively (up to 10 rounds).')
    async def expand_all_el_tree():
        page = await browser_context.get_current_page()
        total = 0
        for _ in range(10):
            clicked = await page.evaluate('''() => {
                const tree = document.querySelector('.el-tree');
                if (!tree) return -1;
                let n = 0;
                tree.querySelectorAll('.el-tree-node:not(.is-expanded)').forEach(node => {
                    const icon = node.querySelector(':scope > .el-tree-node__content > .el-tree-node__expand-icon');
                    if (icon) { icon.click(); n++; }
                });
                return n;
            }''')
            if clicked == -1:
                return _err('no-el-tree-found')
            if clicked == 0:
                break
            total += clicked
            await page.wait_for_timeout(500)
        return _ok(f'ok-expanded-{total}-nodes')

    @controller.action('Login to the system. Fills username + password (+ optional captcha/sms), clicks login button, waits for navigation. Use this instead of manually filling login fields one by one.')
    async def login(username: str, password: str, captcha: str = '', sms_code: str = ''):
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)

        results = []

        # Fill username (try common labels)
        u_r = await page.evaluate(JS_FILL_FORM_FIELD, ['用户名', username])
        if u_r == 'label-not-found':
            u_r = await page.evaluate(JS_FILL_FORM_FIELD, ['账号', username])
        results.append(f'user:{u_r}')

        # Fill password
        p_r = await page.evaluate(JS_FILL_FORM_FIELD, ['密码', password])
        results.append(f'pass:{p_r}')

        # Optionally fill captcha
        if captcha:
            c_r = await page.evaluate(JS_FILL_FORM_FIELD, ['验证码', captcha])
            if c_r == 'label-not-found':
                c_r = await page.evaluate(JS_FILL_FORM_FIELD, ['图形验证码', captcha])
            results.append(f'captcha:{c_r}')

        # Optionally fill SMS code
        if sms_code:
            s_r = await page.evaluate(JS_FILL_FORM_FIELD, ['短信验证码', sms_code])
            if s_r == 'label-not-found':
                s_r = await page.evaluate(JS_FILL_FORM_FIELD, ['手机验证码', sms_code])
            results.append(f'sms:{s_r}')

        # Click login button
        clicked = await page.evaluate('''() => {
            const container = ''' + JS_GET_CONTAINER + ''';
            for (const btn of container.querySelectorAll('button')) {
                const t = btn.textContent.trim().replace(/\\s/g, '');
                if ((t === '登录' || t === '登錄' || t === 'Login') && btn.offsetParent !== null && !btn.disabled) {
                    btn.click();
                    return 'ok';
                }
            }
            return 'not-found';
        }''')
        results.append(f'btn:{clicked}')

        # Wait for post-login navigation
        await page.wait_for_timeout(3000)
        _record_action('login', {'username': username, 'password': password, 'captcha': captcha, 'sms_code': sms_code}, 'ok-login')
        return _ok('ok-login | ' + ' '.join(results))

    @controller.action('Get a value for a form field by its label using form rules. For 证件号码, reads 证件类型 from the page and generates the matching format (身份证 → ID card, 统一社会信用代码/营业执照 → credit code).')
    async def match_form_rule(label_text: str):
        t = (label_text or '').replace(' ', '')
        if '证件号码' in t or (t.endswith('证件号') and '类型' not in t):
            page = await browser_context.get_current_page()
            try:
                cert_type = await page.evaluate(_JS_READ_CERT_TYPE, ['证件类型', '证照类型', '证件种类'])
            except Exception:
                cert_type = ''
            val = match_cert_number(cert_type or '')
            sys.stderr.write(f'[match-form-rule] cert_type={cert_type!r} → {val}\n')
            sys.stderr.flush()
            return val
        val = match_rule(label_text, form_rules)
        return val if val else 'NO-RULE'

    @controller.action('Fill a form field using Element UI native DOM setter. Works for text inputs AND date fields (sets value directly).')
    async def fill_form_field(label_text: str, value: str):
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)
        await _ensure_scanned(label_text)
        result = await page.evaluate(JS_FILL_FORM_FIELD, [label_text, value])
        if _is_ok_result(result):
            element = await _capture_element(page, label_text)
            _record_action('fill_form_field', {'label_text': label_text, 'value': value}, result, element=element)
            _task_done_impl(label_text, case_data_store, value=value)
            return _ok(_with_submit_cue(result, case_data_store))
        return _with_submit_cue(result, case_data_store)

    @controller.action('Fill an Element UI date picker by label text. Value should be in YYYY-MM-DD format.')
    async def fill_date_field(label_text: str, value: str):
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)
        await _ensure_scanned(label_text)
        result = await page.evaluate(JS_FILL_DATE_FIELD, [label_text, value])
        if _is_ok_result(result):
            _record_action('fill_date_field', {'label_text': label_text, 'value': value}, result)
            _task_done_impl(label_text, case_data_store, value=value)
            return _ok(_with_submit_cue(result, case_data_store))
        return _with_submit_cue(result, case_data_store)

    @controller.action('Check the current value of a single form field by its label. Returns JSON with label/kind/currentValue/placeholder/disabled/selected/required. Use this to verify a field was filled correctly by checking currentValue.')
    async def check_field_value(label_text: str):
        page = await browser_context.get_current_page()
        return await page.evaluate(JS_CHECK_SINGLE_FIELD, [label_text, _button_keywords()])

    @controller.action('Verify that a form field has an expected value. Calls check_field_value and compares currentValue with expected. Returns ok if match, err if mismatch. Use this to confirm a field was filled correctly.')
    async def verify_field_value(label_text: str, expected: str):
        page = await browser_context.get_current_page()
        raw = await page.evaluate(JS_CHECK_SINGLE_FIELD, [label_text, _button_keywords()])
        if raw == 'label-not-found':
            return _err('label-not-found')
        try:
            info = json.loads(raw)
        except Exception:
            return raw
        current = info.get('currentValue', '')
        if current and (current == expected or expected in current or current in expected):
            return _ok(f'verified:{current}')
        return _err(f'mismatch | current:{current} | expected:{expected}')

    @controller.action('Full scan: ALL form fields in the current dialog/drawer regardless of visibility. Builds task list + form snapshot only — does NOT auto-fill (auto-fill is triggered implicitly by fill/select on main/drawer). Returns summary {total, filled, pending, ...}.')
    async def scan_form_fields():
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)
        raw = await page.evaluate(JS_SCAN_FORM_FIELDS, [False, _button_keywords()])
        try:
            result = json.loads(raw) if isinstance(raw, str) else raw
            raw_fields = result.get('fields') if isinstance(result, dict) else result
        except Exception:
            return raw

        dom_fields: list[ScannedField] = [
            ScannedField(**f) if isinstance(f, dict) else f
            for f in raw_fields
        ]

        try:
            ax_text = await page.aria_snapshot(mode='ai')
            if ax_text:
                _merge_ax_text(dom_fields, ax_text)
        except Exception:
            pass

        container_id = result.get('container', 'main') if isinstance(result, dict) else 'main'
        raw_notification = result.get('notification') if isinstance(result, dict) else None
        notification = Notification(**raw_notification) if raw_notification else None

        _save_form_snapshot(container_id, [f.model_dump() for f in dom_fields], case_data_store)

        # Build task list only — no auto-fill (avoids filling on browse/list pages).
        # Preserve existing done items — from_scan filters fields with values,
        # so mark_done() won't find them in pending. Create TaskItems directly.
        prev_tl = TaskList.from_store(case_data_store.get('task_list'))
        prev_done_labels = {d.label for d in prev_tl.done}
        prev_intervene = {item.label for item in prev_tl.pending if item.needs_intervention}

        tl = TaskList.from_scan([f.model_dump() for f in dom_fields])
        # Restore previously-done items — add directly to done since they won't be in pending.
        # from_scan now puts pre-filled fields in done[], so check both lists to avoid duplicates.
        # Preserve currentValue from prior done items so re-scan summaries stay accurate.
        new_pending_labels = {item.label for item in tl.pending}
        new_done_labels = {item.label for item in tl.done}
        prev_done_by_label = {d.label: d for d in prev_tl.done}
        for label in prev_done_labels:
            if label not in new_pending_labels and label not in new_done_labels:
                prev = prev_done_by_label.get(label)
                tl.done.append(TaskItem(
                    label=label,
                    kind=prev.kind if prev else 'input',
                    currentValue=prev.currentValue if prev else '',
                    options=list(prev.options) if prev else [],
                    placeholder=prev.placeholder if prev else '',
                    disabled=prev.disabled if prev else False,
                    required=prev.required if prev else False,
                    hasButton=prev.hasButton if prev else '',
                ))
        # Restore needs_intervention flags on items that ended up in pending
        for item in tl.pending:
            if item.label in prev_intervene:
                item.needs_intervention = True
        case_data_store['task_list'] = tl.to_store()
        case_data_store['_scan_fields'] = [f.model_dump() for f in dom_fields]

        # Annotate fields so agent knows which were handled
        done_labels = {d.label for d in tl.done}
        for f in dom_fields:
            f.filled = f.label in done_labels

        # Build summary instead of returning all fields (~40KB → <1KB)
        pending_labels = [item.label for item in tl.pending]
        intervene = [item.label for item in tl.pending if item.needs_intervention]
        summary = {
            'container': container_id,
            'total': len(dom_fields),
            'filled': len(done_labels),
            'filled_fields': {item.label: item.currentValue for item in tl.done},
            'pending': len(pending_labels),
            'pending_labels': pending_labels,
        }
        if intervene:
            summary['intervention_needed'] = intervene
        if notification:
            summary['notification'] = {'visible': notification.visible, 'text': (notification.text or '')[:200]}
        return json.dumps(summary, ensure_ascii=False)

    @controller.action('Visible scan: only visible form fields (offsetParent !== null). Use this for ALL subsequent checks — much smaller output, saves context. Excludes fields already filled by auto-fill. Returns {fields: [...], notification: {visible, text}|null}.')
    async def scan_visible_fields():
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)
        raw = await page.evaluate(JS_SCAN_FORM_FIELDS, [True, _button_keywords()])
        try:
            result = json.loads(raw) if isinstance(raw, str) else raw
            raw_fields = result.get('fields') if isinstance(result, dict) else result
        except Exception:
            return raw

        dom_fields: list[ScannedField] = [
            ScannedField(**f) if isinstance(f, dict) else f
            for f in raw_fields
        ]

        try:
            ax_text = await page.aria_snapshot(mode='ai')
            if ax_text:
                _merge_ax_text(dom_fields, ax_text)
        except Exception:
            pass

        tl = TaskList.from_store(case_data_store.get('task_list'))

        # ── 扫描校验错误：将报错字段从 done[] 移回 pending[]，清空值 ──
        try:
            error_labels = await page.evaluate(_JS_EXTRACT_ERROR_LABELS)
            error_labels_parsed = json.loads(error_labels) if isinstance(error_labels, str) else error_labels
        except Exception:
            error_labels_parsed = []
        if error_labels_parsed:
            retried = tl.sync_from_errors(error_labels_parsed)
            if retried:
                case_data_store['task_list'] = tl.to_store()
                for item in retried:
                    await _clear_field_value(page, item.label)
                sys.stderr.write(f'[scan-visible] Validation errors: {error_labels_parsed} → retried {len(retried)} field(s)\n')
                sys.stderr.flush()

        # Only show fields that still need filling (pending) — keeps failed/error fields.
        # Also keeps fields not yet tracked (safe default for dynamically shown fields).
        pending_labels = {d.label for d in tl.pending}
        done_labels = {d.label for d in tl.done}
        intervene_labels = {d.label for d in tl.pending if d.needs_intervention}
        filtered = []
        for f in dom_fields:
            if f.label in done_labels and f.label not in pending_labels:
                continue
            # Drop optional disabled fields with no adjacent button (内部评级等只读噪音)
            if f.disabled and not f.hasButton and not f.required:
                continue
            # Drop disabled fields that already have a value and no button
            if f.disabled and not f.hasButton and (f.currentValue or '').strip():
                continue
            filtered.append(f)
        dom_fields = filtered

        # If DOM quick-scan returned nothing but pending tasks exist (e.g. drawer
        # visibility quirks), surface pending items so the agent can still act.
        if not dom_fields and tl.pending:
            dom_fields = [
                ScannedField(
                    label=item.label,
                    kind=item.kind or 'input',
                    currentValue='',
                    options=list(item.options or []),
                    placeholder=item.placeholder or '',
                    disabled=bool(item.disabled),
                    required=True,
                    hasButton=item.hasButton or '',
                )
                for item in tl.pending
                if not item.needs_intervention
            ]

        container_id = result.get('container', 'main') if isinstance(result, dict) else 'main'
        raw_notification = result.get('notification') if isinstance(result, dict) else None
        notification = Notification(**raw_notification) if raw_notification else None
        payload = FormScanResult(
            container=container_id,
            fields=dom_fields,
            notification=notification,
        ).model_dump()
        if intervene_labels:
            payload['NEEDS_INTERVENTION'] = sorted(intervene_labels)
        fillable = [f['label'] for f in payload['fields'] if not f.get('disabled')]
        cue = _submit_ready_hint(case_data_store)
        if cue:
            payload['NEXT_ACTION'] = cue.split('|', 1)[0].replace('NEXT_ACTION:', '').strip()
            payload['hint'] = cue
        else:
            payload['hint'] = (
                f'fillable:{len(fillable)} pending:{len(pending_labels)} '
                f'intervene:{len(intervene_labels)} — do NOT re-select already-filled fields; '
                f'handle NEEDS_INTERVENTION via click_adjacent_button / request_intervention'
            )
        # Required disabled "联网核查" with empty value — nudge button click before save
        for f in payload.get('fields') or []:
            if (
                f.get('required') and f.get('disabled') and not (f.get('currentValue') or '').strip()
                and ('核查' in (f.get('label') or '') or '联网' in (f.get('label') or ''))
            ):
                payload['hint'] = (
                    f'Click adjacent 联网核查 button for "{f.get("label")}", wait_for_loading, '
                    f'then click 保存. ' + payload.get('hint', '')
                )
                break
        return json.dumps(payload, ensure_ascii=False, indent=2)

    @controller.action('Rebuild the task list from scan results (utility — does not auto-fill).')
    async def init_task_list(fields_json: str):
        try:
            data = json.loads(fields_json) if isinstance(fields_json, str) else fields_json
        except Exception:
            return _err('invalid-json')
        fields = data.get('fields') if isinstance(data, dict) else data

        tl = TaskList.from_scan(fields)
        case_data_store['task_list'] = tl.to_store()
        case_data_store['_scan_fields'] = fields
        pending_count = len(tl.pending)
        return _ok(f'task-list-init | pending:{pending_count}')

    @controller.action('Save form structure snapshot for replay validation. Call after init_task_list. Records per-field metadata (label + is_required) with separate required/optional counts so assembled scripts can grade changes by severity.')
    async def save_form_snapshot():
        page = await browser_context.get_current_page()
        container_id = await page.evaluate(JS_IDENTIFY_CONTAINER)
        fields = case_data_store.get('_scan_fields', [])

        snap = _save_form_snapshot(container_id, fields, case_data_store)
        return _ok(f'form-snapshot | container:{container_id} | count:{snap.count}')

    # 内部函数 — 仅由 _ensure_scanned（隐式）触发的 _auto_fill_pending 调用。
    # 按 kind 分组（date→select→input→radio→checkbox→tree-select）多次调用 LLM，
    # 失败字段保留在 pending 供 agent 手动处理，成功字段记录 action + task_done。
    # ── 辅助闭包（共享 page / llm / case_data_store / form_rules）──
    #
    # _execute_round: 分组 → LLM → 逐个执行，三轮回合共用。
    # _scan_new_fields: 全量扫描 → 差值过滤 → TaskItem 创建，Round 2/3 共用。

    async def _execute_round(page, items, label_kind, all_results, round_tag):
        """分组 → LLM 规划 → 逐个执行。round_tag: '' | 'round2 ' | 'round3 '"""
        KIND_ORDER = {'date': 0, 'select': 1, 'input': 2, 'radio': 3, 'checkbox': 4, 'tree-select': 5}
        groups: dict[int, list[dict]] = {}
        for d in items:
            # Skip needs_intervention — only auto-fill fillable fields
            if d.get('disabled') and d.get('hasButton'):
                continue
            idx = KIND_ORDER.get(label_kind.get(d['label'], 'input'), 99)
            groups.setdefault(idx, []).append(d)

        for idx in sorted(groups.keys()):
            sub = groups[idx]
            if not sub:
                continue
            kind_name = {0: 'date', 1: 'select', 2: 'input', 3: 'radio', 4: 'checkbox', 5: 'tree-select'}.get(idx, 'other')
            await page.evaluate(
                's => console.log("[AI填表] 分组 " + s)',
                f'{kind_name}: {len(sub)}个字段',
            )

            # ---- Cross-field: cert type -> cert number ----
            # When cert_number is in the input group and cert_type was already
            # selected, inject the matching format as commandValue (Priority 1).
            if idx == KIND_ORDER['input']:
                _has_cert_num = any(
                    '证件号码' in (d.get('label', '') or '') or '证件号' in (d.get('label', '') or '')
                    for d in sub
                )
                if _has_cert_num:
                    try:
                        _ct = await page.evaluate(_JS_READ_CERT_TYPE, ['证件类型', '证照类型', '证件种类'])
                    except Exception:
                        _ct = ''
                    _ov = match_cert_number(_ct or '')
                    for d in sub:
                        if '证件号码' in (d.get('label', '') or '') or '证件号' in (d.get('label', '') or ''):
                            d['commandValue'] = _ov
                            sys.stderr.write(f'[cert-detect] cert_type="{_ct}" -> cert_number override: {_ov}\n')
                            sys.stderr.flush()
                            break
                    # ---- Cross-field: cert type -> customer name ----
                    _has_cust_name = any(
                        '客户名称' in (d.get('label', '') or '') or '客户姓名' in (d.get('label', '') or '')
                        for d in sub
                    )
                    if _has_cust_name:
                        if _ct and ('统一社会信用代码' in _ct or '营业执照' in _ct):
                            _name_ov = '测试科技发展有限公司'
                        else:
                            _name_ov = _gen_name()
                        for d_name in sub:
                            if '客户名称' in (d_name.get('label', '') or '') or '客户姓名' in (d_name.get('label', '') or ''):
                                d_name['commandValue'] = _name_ov
                                sys.stderr.write(f'[cert-detect] cert_type="{_ct}" -> customer name: {_name_ov}\n')
                                sys.stderr.flush()
                                break

            actions = _llm_generate_values(llm, sub, form_rules=form_rules, case_data_store=case_data_store)
            await page.evaluate(
                'd => console.log("[AI填表] 所有动作(" + d.length + "): " + JSON.stringify(d.map(a => a.label + "=" + (a.value||a.option||""))))',
                actions,
            )

            # Build hasButton lookup for post-fill actions (e.g. phone verify)
            has_button_map = {d.get('label', ''): d.get('hasButton', '') for d in items}

            total = len(actions)
            ok_in_group = 0
            fail_in_group = 0
            for i, a in enumerate(actions):
                label = a.get('label', '')
                kind = (a.get('action') or '').lower().replace('-', '_')
                value = a.get('value', '') or a.get('option', '')
                field_kind = label_kind.get(label, kind)
                step_num = i + 1
                try:
                    if kind in ('fill_input', 'fill', 'input'):
                        if field_kind == 'date':
                            result = await page.evaluate(JS_FILL_DATE_FIELD, [label, value])
                        else:
                            result = await page.evaluate(JS_FILL_FORM_FIELD, [label, value])
                    elif field_kind == 'tree-select' or kind in (
                        'fill_tree', 'select_tree_option', 'tree_select', 'treeselect',
                    ):
                        result = await page.evaluate(JS_SELECT_TREE_OPTION, [label, value])
                    elif kind in ('select_option', 'select', 'option'):
                        already = await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'check'])
                        if already.startswith('ok-already:'):
                            cur_val = already.split(':', 1)[1]
                            if cur_val == value or value in cur_val or cur_val in value:
                                result = already
                            else:
                                await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'trigger'])
                                await page.wait_for_timeout(350)
                                result = await page.evaluate(JS_SELECT_OPTION, value)
                                if result.startswith('option-not-found:'):
                                    result = await page.evaluate(JS_SELECT_OPTION, 'first')
                                if result.startswith('ok'):
                                    confirmed = await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'confirm'])
                                    if not confirmed.startswith('ok-confirmed:'):
                                        await page.evaluate(JS_FILL_FORM_FIELD, [label, value])
                                        await page.wait_for_timeout(200)
                                        confirmed2 = await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'confirm'])
                                        result = confirmed2 if confirmed2.startswith('ok-confirmed:') else 'not-synced:' + confirmed
                        else:
                            await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'trigger'])
                            await page.wait_for_timeout(350)
                            result = await page.evaluate(JS_SELECT_OPTION, value)
                            if result.startswith('option-not-found:'):
                                result = await page.evaluate(JS_SELECT_OPTION, 'first')
                            if result.startswith('ok'):
                                confirmed = await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'confirm'])
                                if not confirmed.startswith('ok-confirmed:'):
                                    await page.evaluate(JS_FILL_FORM_FIELD, [label, value])
                                    await page.wait_for_timeout(200)
                                    confirmed2 = await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'confirm'])
                                    result = confirmed2 if confirmed2.startswith('ok-confirmed:') else 'not-synced:' + confirmed
                    else:
                        result = f'unknown-action:{kind}'
                except Exception as e:
                    result = f'error:{e}'

                ok = _is_ok_result(result)
                entry = {'index': step_num, 'action': kind, 'label': label, 'value': value, 'result': result}
                all_results.append(entry)

                if ok:
                    ok_in_group += 1
                    if kind in ('fill_input', 'fill', 'input') and field_kind != 'tree-select':
                        _record_action('fill_form_field', {'label_text': label, 'value': value}, result)
                    elif field_kind == 'tree-select' or kind in (
                        'fill_tree', 'select_tree_option', 'tree_select', 'treeselect',
                    ):
                        _record_action('select_tree_option', {'label_text': label, 'option_text': value}, result)
                    elif kind in ('select_option', 'select', 'option'):
                        _record_action('select_option', {'label_text': label, 'option_text': value}, result)
                    _task_done_impl(label, case_data_store, value=value)
                    # Phone verify: fill_input 成功后如果有"验证"按钮，自动点击
                    btn = has_button_map.get(label, '')
                    if '验证' in btn and kind in ('fill_input', 'fill', 'input'):
                        try:
                            await page.evaluate('''([lbl]) => {
                                const container = ''' + JS_GET_CONTAINER + ''';
                                for (const item of container.querySelectorAll('.el-form-item')) {
                                    const t = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
                                    if (!t.includes(lbl)) continue;
                                    for (const b of item.querySelectorAll('button')) {
                                        if (b.offsetParent !== null && b.textContent.includes('验证')) {
                                            b.click(); return 'ok-verify-clicked';
                                        }
                                    }
                                }
                                return 'no-verify-btn';
                            }''', [label])
                        except Exception:
                            pass
                    prefix = f'[auto-fill] {round_tag}recorded:' if round_tag else '[auto-fill] recorded:'
                    sys.stderr.write(f'{prefix} {kind} "{label}" = {value} (total: {len(_ACTION_LOG)})\n')
                    sys.stderr.flush()
                    status = 'ok' if ok else f'FAILED:{result}'
                    await page.evaluate(
                        'o => console.log("[AI填表] 执行进度 ======\\n" + o)',
                        f'{step_num}/{total} {kind} "{label}" → {status}',
                    )
                else:
                    fail_in_group += 1
                    await page.evaluate(
                        'o => console.log("[AI填表] FAIL: " + o)',
                        f'{step_num}/{total} {kind} "{label}" → {result}',
                    )

                await page.wait_for_timeout(500 if kind in ('select_option', 'select', 'option') else 300)

            await page.evaluate(
                's => console.log("[AI填表] 本组完成: " + s)',
                f'{total}个动作 | ok:{ok_in_group} failed:{fail_in_group}',
            )

    def _scan_new_fields(dom_fields, tl):
        """扫描新字段：差值过滤 + TaskItem 创建。返回 new_pending dicts。"""
        known_labels = {d.label for d in tl.pending} | {d.label for d in tl.done}
        new_pending: list[dict] = []
        for f in dom_fields:
            if not f.label or f.label in known_labels or f.currentValue.strip():
                continue
            if f.disabled:
                if not f.hasButton or not f.required:
                    continue
            new_pending.append(f.model_dump())
        if new_pending:
            new_labels = [d.get('label', '') for d in new_pending]
            for d in new_pending:
                item = TaskItem(**d)
                if d.get('disabled') and d.get('hasButton'):
                    item.needs_intervention = True
                tl.pending.append(item)
            case_data_store['task_list'] = tl.to_store()
            # Debug: verify store has the items
            verify = TaskList.from_store(case_data_store.get('task_list'))
            verify_labels = {i.label for i in verify.pending}
            sys.stderr.write(f'[auto-fill] _scan_new_fields: +{len(new_pending)} new={new_labels}, done={len(tl.done)} pending={len(tl.pending)}\n')
            sys.stderr.write(f'[auto-fill] _scan_new_fields verify: store pending has {len(verify.pending)} items, labels={list(verify_labels)[:3]}...\n')
            sys.stderr.flush()
        return new_pending

    # ═══════════════════════════════════════════════════════════════════════
    # Round 1: 初始 pending → 分组 → LLM → 执行
    # ═══════════════════════════════════════════════════════════════════════
    async def _auto_fill_pending():
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)
        tl = TaskList.from_store(case_data_store.get('task_list'))
        pending = [item for item in tl.pending if not item.needs_intervention]

        if not pending:
            return _ok('nothing-pending')

        # 构建待填字段列表（带 commandValue 注解）
        pending_dicts: list[dict] = []
        for item in pending:
            d = item.model_dump()
            user_val = case_data_store.get(item.label)
            if user_val and str(user_val).strip():
                d['commandValue'] = str(user_val).strip()
            pending_dicts.append(d)

        label_kind: dict[str, str] = {item.label: item.kind for item in pending}

        # Extract reference date from page
        try:
            ref_date = await page.evaluate('''() => {
                const dateLabels = ['成立日期', '登记日期', '注册日期', '营业起始日期', '营业开始日期'];
                const items = document.querySelectorAll('.el-form-item');
                for (const el of items) {
                    const lbl = el.querySelector('.el-form-item__label');
                    if (!lbl) continue;
                    const t = lbl.textContent.trim();
                    if (dateLabels.some(d => t.includes(d))) {
                        const inp = el.querySelector('input');
                        if (inp && inp.value && /\\d{4}-\\d{2}-\\d{2}/.test(inp.value)) {
                            return inp.value;
                        }
                    }
                }
                return '';
            }''')
            if ref_date:
                case_data_store['_ref_date'] = ref_date
                await page.evaluate('s => console.log("[AI填表] 参考日期: " + s)', ref_date)
        except Exception:
            pass

        # 打印待填写统计
        kind_counts: dict[str, int] = {}
        for item in pending:
            k = item.kind
            kind_counts[k] = kind_counts.get(k, 0) + 1
        summary_parts = ' '.join(f'{k}:{v}' for k, v in sorted(kind_counts.items()))
        await page.evaluate(
            's => console.log("[AI填表] 预计填写: " + s)',
            f'{len(pending)}个字段 | {summary_parts}',
        )

        all_results = []
        await _execute_round(page, pending_dicts, label_kind, all_results, '')

        # ═══════════════════════════════════════════════════════════════════
        # Round 2: 级联扫描 — select 赋值后可能 reveal 新字段
        # ═══════════════════════════════════════════════════════════════════
        round1_count = len(all_results)
        try:
            raw2 = await page.evaluate(JS_SCAN_FORM_FIELDS, [False, _button_keywords()])
            result2 = json.loads(raw2) if isinstance(raw2, str) else raw2
            raw_fields2 = result2.get('fields') if isinstance(result2, dict) else result2
        except Exception:
            raw_fields2 = []
        dom_fields2 = [ScannedField(**f) if isinstance(f, dict) else f for f in raw_fields2]
        tl = TaskList.from_store(case_data_store.get('task_list'))
        new_pending2 = _scan_new_fields(dom_fields2, tl)
        if new_pending2:
            await page.evaluate(
                's => console.log("[AI填表] 第二轮(联动): " + s)',
                f'{len(new_pending2)}个新字段',
            )
            label_kind2 = {d['label']: d.get('kind', 'input') for d in new_pending2}
            await _execute_round(page, new_pending2, label_kind2, all_results, 'round2 ')

        # ═══════════════════════════════════════════════════════════════════
        # Round 3: 深层联动扫描
        # ═══════════════════════════════════════════════════════════════════
        round2_count = len(all_results)
        try:
            raw3 = await page.evaluate(JS_SCAN_FORM_FIELDS, [False, _button_keywords()])
            result3 = json.loads(raw3) if isinstance(raw3, str) else raw3
            raw_fields3 = result3.get('fields') if isinstance(result3, dict) else result3
        except Exception:
            raw_fields3 = []
        dom_fields3 = [ScannedField(**f) if isinstance(f, dict) else f for f in raw_fields3]
        tl = TaskList.from_store(case_data_store.get('task_list'))
        new_pending3 = _scan_new_fields(dom_fields3, tl)
        if new_pending3:
            await page.evaluate(
                's => console.log("[AI填表] 第三轮(深层联动): " + s)',
                f'{len(new_pending3)}个新字段',
            )
            label_kind3 = {d['label']: d.get('kind', 'input') for d in new_pending3}
            await _execute_round(page, new_pending3, label_kind3, all_results, 'round3 ')

        # ═══════════════════════════════════════════════════════════════════
        # Step 4-6: 完成、干预、同步
        # ═══════════════════════════════════════════════════════════════════
        ok_count = sum(1 for r in all_results if _is_ok_result(r['result']))
        failed_count = len(all_results) - ok_count
        await page.evaluate(
            'd => console.log("[AI填表] 执行完成 ======\\n" + JSON.stringify(d))',
            all_results,
        )

        # Step 5: needs_intervention 字段 — 全部入队，跳转到第一个
        tl_final = TaskList.from_store(case_data_store.get('task_list'))
        intervene_items = [item for item in tl_final.pending if item.needs_intervention]
        if intervene_items:
            first = intervene_items[0]
            await page.evaluate('''([label]) => {
                const container = ''' + JS_GET_CONTAINER + ''';
                const items = container.querySelectorAll('.el-form-item');
                for (const item of items) {
                    const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
                    if (lbl.includes(label)) {
                        item.scrollIntoView({ block: 'center', behavior: 'instant' });
                        break;
                    }
                }
            }''', [first.label])
            sys.stderr.write(f'[auto-fill] NEEDS_INTERVENTION ({len(intervene_items)} fields): {[i.label for i in intervene_items]}\n')
            sys.stderr.write(f'[auto-fill] Scrolled to first: "{first.label}"\n')
            sys.stderr.flush()
            # Queue ALL intervention fields (not just first) — consumed by on_step_start
            for item in intervene_items:
                _queue_intervention(case_data_store, item.label, item.hasButton or '',
                    f"Field '{item.label}' is disabled with adjacent button '{item.hasButton}'. Needs a custom fill workflow.")
            sys.stderr.write(f'[auto-fill] Queued {len(intervene_items)} intervention request(s)\n')
            sys.stderr.flush()
            # Push SSE event so Dashboard shows which fields need intervention
            emit_json({'event': 'intervention_needed', 'data': {
                'fields': [{'label': item.label, 'hasButton': item.hasButton or '', 'kind': item.kind} for item in intervene_items],
                'source': 'auto_fill',
            }})

        # Step 6: full scan sync — 移除不在 DOM 的 pending 字段
        try:
            raw_sync = await page.evaluate(JS_SCAN_FORM_FIELDS, [False, _button_keywords()])
            sync_result = json.loads(raw_sync) if isinstance(raw_sync, str) else raw_sync
            sync_fields = sync_result.get('fields') if isinstance(sync_result, dict) else sync_result
            dom_labels = {f.get('label', '') for f in sync_fields}
        except Exception:
            dom_labels = set()

        if dom_labels:
            tl_sync = TaskList.from_store(case_data_store.get('task_list'))
            stale = [item for item in tl_sync.pending
                     if item.label not in dom_labels and not item.needs_intervention]
            for item in stale:
                tl_sync.pending.remove(item)
                sys.stderr.write(f'[auto-fill] Removed stale pending: "{item.label}" (not in DOM)\n')
            if stale:
                case_data_store['task_list'] = tl_sync.to_store()
                sys.stderr.flush()

        tl_debug = TaskList.from_store(case_data_store.get('task_list'))
        sys.stderr.write(f'[auto-fill] DEBUG done={len(tl_debug.done)} pending={len(tl_debug.pending)}\n')
        sys.stderr.flush()
        return _ok(f'auto-fill-done | ok:{ok_count} failed:{failed_count} | ' + json.dumps(all_results, ensure_ascii=False))

    @controller.action('Mark a form field as completed in the task list. Use this after successfully filling a field.')
    async def task_done(label_text: str):
        tl = TaskList.from_store(case_data_store.get('task_list'))
        # Check if this was an intervention field BEFORE marking done
        was_intervention = any(
            item.label == label_text and item.needs_intervention
            for item in tl.pending
        )
        _task_done_impl(label_text, case_data_store)
        tl = TaskList.from_store(case_data_store.get('task_list'))

        if was_intervention:
            # Remove from intervention queue so recorder doesn't re-inject
            queue = case_data_store.get('_intervention_queue', [])
            case_data_store['_intervention_queue'] = [q for q in queue if q.get('label') != label_text]
            remaining = [q.get('label', '') for q in case_data_store['_intervention_queue']]
            # Push SSE event so Dashboard removes the field from alerts
            emit_json({'event': 'intervention_resolved', 'data': {
                'label': label_text,
                'remaining': remaining,
            }})
            sys.stderr.write(f'[intervention] Resolved: "{label_text}" — {len(remaining)} remaining\n')
            sys.stderr.flush()

        return _ok(f'task-done:{label_text} | remaining:{len(tl.pending)}')

    @controller.action('Get the current pending task list. Returns {"pending": [...], optional NEEDS_INTERVENTION, NEXT_ACTION}. When pending is empty, NEXT_ACTION tells you to click 保存 — do not re-fill fields.')
    async def get_pending_tasks():
        tl = TaskList.from_store(case_data_store.get('task_list'))
        intervene = [item.label for item in tl.pending if item.needs_intervention]
        pending_labels = [item for item in tl.to_store()['pending'] if not item.get('needs_intervention')]
        sys.stderr.write(f'[get-pending] done={len(tl.done)} pending={len(tl.pending)} intervene={len(intervene)}\n')
        sys.stderr.flush()
        result = {
            'pending': pending_labels,
            'done': len(tl.done),
        }
        if intervene:
            result['NEEDS_INTERVENTION'] = intervene
        cue = _submit_ready_hint(case_data_store)
        if cue:
            # Parse NEXT_ACTION token for structured field
            if cue.startswith('NEXT_ACTION:'):
                result['NEXT_ACTION'] = cue.split('|', 1)[0].replace('NEXT_ACTION:', '').strip()
            result['hint'] = cue
            case_data_store['_submit_ready'] = True
        return json.dumps(result, ensure_ascii=False)

    @controller.action(
        'Find the 保存/提交 button, scroll it into view, click it, wait for loading, '
        'then scan the whole page for .el-form-item__error and success/error notifications. '
        'Prefer this over scroll_down + click_element_by_index for form submit. '
        'Returns ok-save-success only when an 操作成功 (or equivalent) toast appears — '
        'no-notification is NOT success. On validation errors returns err-save-validation.'
    )
    async def click_save(button_text: str = '保存'):
        page = await browser_context.get_current_page()
        url_before = page.url
        if case_data_store is not None:
            case_data_store['_url_before_save'] = url_before
            case_data_store['_last_save_ok'] = False

        # Capture short-lived success toasts that may vanish between polls
        await page.evaluate(r'''() => {
          const successRe = /操作成功|保存成功|提交成功|新建成功|修改成功|删除成功/;
          const failRe = /失败|错误|异常|不能|不允许|已存在|重复|校验|必填|不通过/;
          window.__saveWatch = { successNotifs: [], errorNotifs: [] };
          const take = (el) => {
            const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
            if (!t) return;
            if (successRe.test(t) && !failRe.test(t)) window.__saveWatch.successNotifs.push(t.slice(0, 160));
            else if (failRe.test(t) || /el-notification--error|el-message--error/.test(el.className || ''))
              window.__saveWatch.errorNotifs.push(t.slice(0, 160));
            else if (el.classList && (el.classList.contains('el-notification--success') || el.classList.contains('el-message--success')))
              window.__saveWatch.successNotifs.push(t.slice(0, 160));
          };
          for (const el of document.querySelectorAll('.el-notification, .el-message')) take(el);
          const obs = new MutationObserver((muts) => {
            for (const m of muts) {
              for (const n of m.addedNodes || []) {
                if (!n || n.nodeType !== 1) continue;
                if (n.matches && (n.matches('.el-notification, .el-message') || n.querySelector?.('.el-notification, .el-message'))) {
                  if (n.matches?.('.el-notification, .el-message')) take(n);
                  for (const el of (n.querySelectorAll?.('.el-notification, .el-message') || [])) take(el);
                }
              }
            }
          });
          obs.observe(document.body, { childList: true, subtree: true });
          window.__saveWatchObs = obs;
        }''')

        raw = await page.evaluate(JS_CLICK_SAVE_BUTTON, button_text or '保存')
        try:
            info = json.loads(raw) if isinstance(raw, str) else (raw or {})
        except Exception:
            info = {}
        if not info.get('ok'):
            try:
                await page.evaluate('() => { try { window.__saveWatchObs?.disconnect(); } catch(e) {} }')
            except Exception:
                pass
            reason = info.get('reason') or 'button-not-found'
            needle = info.get('needle') or (button_text or '保存')
            sys.stderr.write(f'[click_save] NOT FOUND: "{needle}" ({reason})\n')
            sys.stderr.flush()
            return _err(
                f'err-save-button-not-found:{needle}. '
                f'Close interfering dialogs (查询/返回) with close_dialog, then retry click_save().'
            )

        btn_text = info.get('text') or (button_text or '保存')
        xpath = info.get('xpath') or ''
        tag_name = info.get('tag') or 'button'
        element_info = await _enrich_click_element(
            page, xpath=xpath, text=btn_text, tag_name=tag_name, attributes={},
        )
        _record_action(
            'click_element_by_index',
            {
                'index': -1,
                'tag_name': (element_info or {}).get('tag_name') or tag_name,
                'text': btn_text,
            },
            f'ok-clicked-save:{btn_text}',
            element=element_info,
        )
        sys.stderr.write(f'[click_save] clicked "{btn_text}" xpath={xpath[:80]}\n')
        sys.stderr.flush()

        await page.wait_for_timeout(150)
        await _wait_if_loading(page)

        # Poll briefly — success toasts auto-dismiss in ~2–3s
        outcome = {'formErrors': [], 'successNotifs': [], 'errorNotifs': [], 'url': page.url}
        for _ in range(20):  # ~3s at 150ms
            scanned = await page.evaluate(JS_SCAN_SAVE_OUTCOME)
            if isinstance(scanned, str):
                try:
                    scanned = json.loads(scanned)
                except Exception:
                    scanned = {}
            watched = await page.evaluate('() => window.__saveWatch || {successNotifs:[], errorNotifs:[]}')
            outcome = scanned or outcome
            # Merge watcher captures (may include dismissed toasts)
            for t in (watched or {}).get('successNotifs') or []:
                if t not in (outcome.get('successNotifs') or []):
                    outcome.setdefault('successNotifs', []).append(t)
            for t in (watched or {}).get('errorNotifs') or []:
                if t not in (outcome.get('errorNotifs') or []):
                    outcome.setdefault('errorNotifs', []).append(t)
            if outcome.get('formErrors'):
                break
            if outcome.get('successNotifs'):
                break
            if outcome.get('errorNotifs'):
                break
            await page.wait_for_timeout(150)
            await _wait_if_loading(page)

        try:
            await page.evaluate('() => { try { window.__saveWatchObs?.disconnect(); } catch(e) {} }')
        except Exception:
            pass

        form_errors = outcome.get('formErrors') or []
        success_notifs = outcome.get('successNotifs') or []
        error_notifs = outcome.get('errorNotifs') or []

        if form_errors:
            labels = [e.get('label') or e.get('error') for e in form_errors[:8]]
            # Re-queue validation errors into task list when possible
            try:
                error_labels = await page.evaluate(
                    '''() => {
                      const out = [];
                      for (const el of document.querySelectorAll('.el-form-item__error')) {
                        const r = el.getBoundingClientRect();
                        if (r.width <= 0 || r.height <= 0) continue;
                        const t = (el.textContent || '').trim();
                        if (!t) continue;
                        const item = el.closest('.el-form-item');
                        const label = (item && item.querySelector('.el-form-item__label')
                          ? item.querySelector('.el-form-item__label').textContent : '').trim();
                        if (label) out.push(label);
                      }
                      return out;
                    }'''
                )
                if error_labels:
                    tl = TaskList.from_store(case_data_store.get('task_list'))
                    tl.sync_from_errors(error_labels)
                    case_data_store['task_list'] = tl.to_store()
            except Exception:
                pass
            try:
                await page.evaluate(JS_SCROLL_TO_FIRST_ERROR)
            except Exception:
                pass
            msg = (
                f'err-save-validation:{json.dumps(form_errors[:8], ensure_ascii=False)} | '
                f'Fix fields {labels} then call click_save() again. '
                f'Do NOT call done(success=true).'
            )
            sys.stderr.write(f'[click_save] validation errors: {labels}\n')
            sys.stderr.flush()
            return _err(msg)

        if success_notifs:
            if case_data_store is not None:
                case_data_store['_last_save_ok'] = True
                case_data_store.pop('_submit_ready', None)
            toast = success_notifs[0]
            sys.stderr.write(f'[click_save] SUCCESS: {toast[:80]}\n')
            sys.stderr.flush()
            return _ok(
                f'ok-save-success:{toast} | '
                f'Save confirmed (操作成功). Call done(success=true) if phase goal is save.'
            )

        if error_notifs:
            toast = error_notifs[0]
            sys.stderr.write(f'[click_save] error notification: {toast[:80]}\n')
            sys.stderr.flush()
            return _err(
                f'err-save-notification:{toast} | '
                f'Fix the reported issue then click_save() again. Do NOT treat as success.'
            )

        url_after = outcome.get('url') or page.url
        url_changed = bool(url_before and url_after and url_before != url_after)
        if url_changed:
            sys.stderr.write(
                f'[click_save] no success toast; URL changed {url_before[:60]} -> {url_after[:60]}\n'
            )
            sys.stderr.flush()
            return _err(
                'err-save-no-feedback: URL changed but no 操作成功 notification. '
                'Do NOT call done(success=true) unless you observed 操作成功. '
                'If form errors appear, fix them and click_save() again.'
            )

        sys.stderr.write('[click_save] no feedback (no toast, no form errors)\n')
        sys.stderr.flush()
        return _err(
            'err-save-no-feedback: no 操作成功 notification and no .el-form-item__error. '
            'no-notification is NOT success. Check overlays (close_dialog), then retry click_save(). '
            'Do NOT call done(success=true).'
        )

    @controller.action('Scroll to the first visible form validation error (.el-form-item.is-error or .el-form-item__error). Returns {label, error} so agent knows which field to fix next. Call after a failed submit or when form errors are visible.')
    async def scroll_to_first_error():
        page = await browser_context.get_current_page()
        raw = await page.evaluate(JS_SCROLL_TO_FIRST_ERROR)
        try:
            info = json.loads(raw) if isinstance(raw, str) else raw
        except Exception:
            return _ok('no-error-found')
        label = (info.get('label') or '').strip()
        error = (info.get('error') or '').strip()
        if not label and not error:
            return _ok('no-error-found')
        sys.stderr.write(f'[scroll-to-error] jumped to: "{label}" → {error}\n')
        sys.stderr.flush()
        return _ok(f'scrolled-to:{label} | {error}')

    @controller.action('Sync task list from current page validation errors. Reads .el-form-item__error text, extracts field labels (strips 请选择/请输入/请上传 prefix), re-adds them to pending. Also scrolls to first error. Call this after a failed submit attempt.')
    async def sync_tasks_from_errors():
        page = await browser_context.get_current_page()
        errors = await page.evaluate(_JS_EXTRACT_ERROR_LABELS)
        try:
            error_labels = json.loads(errors) if isinstance(errors, str) else errors
        except Exception:
            error_labels = []
        tl = TaskList.from_store(case_data_store.get('task_list'))
        retried = tl.sync_from_errors(error_labels)
        case_data_store['task_list'] = tl.to_store()

        # 分离需要人工干预的字段（disabled+hasButton）
        intervene = [item for item in retried if item.needs_intervention]
        fillable = [item for item in retried if not item.needs_intervention]
        if intervene:
            intervene_labels = [item.label for item in intervene]
            sys.stderr.write(f'[sync-errors] NEEDS INTERVENTION: {intervene_labels}\n')
            sys.stderr.flush()
            # Auto-queue intervention requests — consistent with _auto_fill_pending Step 5
            for item in intervene:
                _queue_intervention(case_data_store, item.label, item.hasButton or '',
                    f"Field '{item.label}' has a validation error and is disabled with adjacent button '{item.hasButton}'. Needs a custom fill workflow.")
            # Push SSE event so Dashboard shows which fields need intervention
            emit_json({'event': 'intervention_needed', 'data': {
                'fields': [{'label': item.label, 'hasButton': item.hasButton or '', 'kind': item.kind} for item in intervene],
                'source': 'sync_errors',
            }})

        # Auto-scroll to first error so agent can see and fix it immediately
        if retried:
            scroll_raw = await page.evaluate(JS_SCROLL_TO_FIRST_ERROR)
            try:
                scroll_info = json.loads(scroll_raw) if isinstance(scroll_raw, str) else scroll_raw
            except Exception:
                scroll_info = {}
            jumped_label = (scroll_info.get('label') or '').strip()
            jumped_error = (scroll_info.get('error') or '').strip()
            if jumped_label:
                sys.stderr.write(f'[sync-errors] auto-scrolled to: "{jumped_label}" → {jumped_error}\n')
                sys.stderr.flush()

        # 构建返回消息
        msg = f'sync-errors | retried:{len(retried)}'
        if fillable:
            msg += ' | fillable:' + json.dumps([item.label for item in fillable], ensure_ascii=False)
        if intervene:
            msg += ' | NEEDS_INTERVENTION:' + json.dumps([item.label for item in intervene], ensure_ascii=False)
        return _ok(msg)

    @controller.action('Request human intervention for a field that cannot be auto-filled. Use this when sync_tasks_from_errors returns NEEDS_INTERVENTION items, or when a field is disabled with an adjacent button. Queues the request so multiple fields are preserved.')
    async def request_intervention(label_text: str, reason: str = ''):
        tl = TaskList.from_store(case_data_store.get('task_list'))
        item = tl.find(label_text)
        has_button = ''
        if item:
            _, task_item = item
            has_button = task_item.hasButton or ''
        _queue_intervention(case_data_store, label_text, has_button,
            reason or f"Field '{label_text}' has disabled=True and hasButton='{has_button}'. Needs a custom fill workflow.")
        sys.stderr.write(f'[intervention] Agent requested: "{label_text}" (button={has_button}) queue_len={len(case_data_store.get("_intervention_queue", []))}\n')
        sys.stderr.flush()
        return _ok(f'intervention-requested | label:{label_text}')

    @controller.action('Select an option in an el-select dropdown by label and option text.')
    async def select_option(label_text: str, option_text: str):
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)
        await _ensure_scanned(label_text)

        already = await page.evaluate(JS_FIND_LABELED_SELECT, [label_text, 'check'])
        if already.startswith('ok-already:'):
            cur_val = already.split(':', 1)[1]
            _FIRST = ('first', '1st', '第一个', '第一项')
            # "first" means "any existing value is fine" — do NOT re-open the
            # dropdown (re-selecting first can cascade-reset dependent fields).
            if (
                (option_text or '').strip().lower() in _FIRST
                or cur_val == option_text
                or option_text in cur_val
                or cur_val in option_text
            ):
                element = await _capture_element(page, label_text)
                _record_action('select_option', {'label_text': label_text, 'option_text': option_text}, already, element=element)
                _task_done_impl(label_text, case_data_store, value=cur_val or option_text)
                # Count consecutive already-matched for recorder loop-break
                streak = int(case_data_store.get('_already_matched_streak', 0) or 0) + 1
                case_data_store['_already_matched_streak'] = streak
                return _ok(_with_submit_cue(
                    already + ' | already-matched | SKIP — field already set; do not re-select',
                    case_data_store,
                ))

        case_data_store['_already_matched_streak'] = 0

        # Close any leftover open dropdowns before opening the target select
        await page.evaluate('''() => {
            document.querySelectorAll('.el-select-dropdown:not(.is-hidden)').forEach(dd => {
                dd.style.display = 'none';
                dd.classList.add('is-hidden');
            });
            document.body.click();
        }''')
        await page.wait_for_timeout(100)

        trigger_result = await page.evaluate(JS_FIND_LABELED_SELECT, [label_text, 'trigger'])
        if trigger_result in ('label-not-found', 'no-select-found', 'select-disabled'):
            if trigger_result == 'no-select-found':
                return _err('no-select-found | field may be radio — use click_radio')
            return trigger_result

        await page.wait_for_timeout(500)

        select_result = await page.evaluate(JS_SELECT_OPTION, option_text)
        if _is_ok_result(select_result):
            matched_text = select_result.split(':', 1)[1] if ':' in select_result else select_result
            case_data_store.pop(f'_sel_retry_{label_text}', None)
            element = await _capture_element(page, label_text)
            _record_action('select_option', {'label_text': label_text, 'option_text': option_text}, matched_text, element=element)
            _task_done_impl(label_text, case_data_store, value=matched_text or option_text)
            return _ok(_with_submit_cue(f'ok | {matched_text}', case_data_store))
        elif select_result == 'no-items':
            # Dropdown empty — if field already has a value, treat as done
            recheck = await page.evaluate(JS_FIND_LABELED_SELECT, [label_text, 'check'])
            if recheck.startswith('ok-already:'):
                cur = recheck.split(':', 1)[1]
                _task_done_impl(label_text, case_data_store, value=cur)
                return _ok(_with_submit_cue(recheck + ' | already-matched | no-items-skip', case_data_store))
            return _err('no-items')
        elif select_result.startswith('option-not-found:'):
            # Fuzzy: pick listed option that contains / is contained by option_text
            listed = [x.strip() for x in select_result.split(':', 1)[1].split(',') if x.strip()]
            want = (option_text or '').strip()
            fuzzy = next((o for o in listed if want and (want in o or o in want)), None)
            # Common alias: 中国 → 中华人民共和国
            if not fuzzy and want in ('中国', '中国大陆'):
                fuzzy = next((o for o in listed if '中国' in o), None)
            if fuzzy:
                fuzzy_result = await page.evaluate(JS_SELECT_OPTION, fuzzy)
                if _is_ok_result(fuzzy_result):
                    matched_text = fuzzy_result.split(':', 1)[1] if ':' in fuzzy_result else fuzzy_result
                    case_data_store.pop(f'_sel_retry_{label_text}', None)
                    element = await _capture_element(page, label_text)
                    _record_action('select_option', {'label_text': label_text, 'option_text': matched_text}, matched_text, element=element)
                    _task_done_impl(label_text, case_data_store, value=matched_text)
                    return _ok(_with_submit_cue(f'ok | {matched_text} | fuzzy-matched-from:{want}', case_data_store))
            retry_key = f'_sel_retry_{label_text}'
            retries = case_data_store.get(retry_key, 0) + 1
            case_data_store[retry_key] = retries
            if retries >= 3:
                first_result = await page.evaluate(JS_SELECT_OPTION, 'first')
                if _is_ok_result(first_result):
                    matched_text = first_result.split(':', 1)[1] if ':' in first_result else first_result
                    case_data_store.pop(f'_sel_retry_{label_text}', None)
                    element = await _capture_element(page, label_text)
                    _record_action('select_option', {'label_text': label_text, 'option_text': option_text}, matched_text, element=element)
                    _task_done_impl(label_text, case_data_store, value=matched_text or option_text)
                    return _ok(_with_submit_cue(f'ok | {matched_text}', case_data_store))
                return _err(first_result)
            return _err(select_result)
        else:
            return _err(select_result)

    # ── Adjacent button / radio (moved from misc for logical grouping) ──

    @controller.action('Click an adjacent button (选择/引入/上传) to fill a field, but only if the field is empty. Returns "already-filled" (non-ok skip) if field has value.')
    async def click_adjacent_button(label_text: str):
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)
        # First check if field already has a value — skip if so
        check_info = await page.evaluate(JS_CHECK_SINGLE_FIELD, [label_text, _button_keywords()])
        if check_info != 'label-not-found':
            try:
                info = json.loads(check_info)
                if (info.get('currentValue', '').strip() != '' or info.get('selected', False)) and label_text not in ('查询', '搜索', '确定', '提交', '保存'):
                    # Non-recordable skip — must NOT use ok prefix
                    return _ok(f'already-filled | {info.get("currentValue", "")}')
            except Exception:
                pass
        result = await page.evaluate('''([label]) => {
            const container = ''' + JS_GET_CONTAINER + ''';
            const items = container.querySelectorAll('.el-form-item');
            for (const item of items) {
                const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
                if (!lbl.includes(label)) continue;
                item.scrollIntoView({ block: 'center', behavior: 'instant' });
                // Pass 1: match known button keywords
                for (const tag of ['el-button', 'button', 'a']) {
                    const btns = item.querySelectorAll(tag);
                    for (const btn of btns) {
                        if (btn.offsetParent === null) continue;
                        const t = btn.textContent.trim();
                        if (t && (t.includes('选择') || t.includes('引入') || t.includes('上传') || t.includes('添加') || t.includes('导入') || t.includes('新增'))) {
                            btn.click(); return 'ok-clicked';
                        }
                    }
                }
                // Pass 2: fallback — click any visible button inside the form item
                for (const tag of ['el-button', 'button', 'a']) {
                    const btns = item.querySelectorAll(tag);
                    for (const btn of btns) {
                        if (btn.offsetParent === null) continue;
                        btn.click(); return 'ok-clicked';
                    }
                }
                return 'no-adjacent-button-found';
            }
            return 'label-not-found';
        }''', [label_text])
        if _is_ok_result(result):
            _record_action('click_adjacent_button', {'label_text': label_text}, result)
            return _ok(result)
        return result

    @controller.action('Click a radio option by label text and radio option text.')
    async def click_radio(label_text: str, option_text: str):
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)
        await _ensure_scanned(label_text)
        result = await page.evaluate(JS_CLICK_RADIO, [label_text, option_text])
        if _is_ok_result(result):
            element = await _capture_element(page, label_text)
            _record_action('click_radio', {'label_text': label_text, 'option_text': option_text}, result, element=element)
            _task_done_impl(label_text, case_data_store, value=option_text)
            return _ok(result)
        return result

    @controller.action('Select a tree-select option by label and option text. For custom TsscMultiTree components (e.g. 行业代码). Opens popover, searches tree data by label, selects matching node, closes popover.')
    async def select_tree_option(label_text: str, option_text: str):
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)
        await _ensure_scanned(label_text)
        result = await page.evaluate(JS_SELECT_TREE_OPTION, [label_text, option_text])
        # P0/P1/P2 success codes all use ok prefix → recordable via _is_ok_result
        if _is_ok_result(result):
            element = await _capture_element(page, label_text)
            _record_action('select_tree_option', {'label_text': label_text, 'option_text': option_text}, result, element=element)
            _task_done_impl(label_text, case_data_store, value=option_text)
            return _ok(result)
        return result
