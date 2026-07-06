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
    _ok, _err,
    _wait_if_loading, _capture_element, _merge_ax_text,
)
from ._js_snippets import (
    JS_GET_CONTAINER, JS_IDENTIFY_CONTAINER,
    JS_CHECK_SINGLE_FIELD, JS_SCAN_FORM_FIELDS,
    JS_FILL_FORM_FIELD, JS_FILL_DATE_FIELD,
    JS_FIND_LABELED_SELECT, JS_FIND_OPTION, JS_SELECT_OPTION, JS_LOCATOR,
    JS_CLICK_RADIO,
    JS_SELECT_TREE_OPTION,
    JS_SCROLL_TO_FIRST_ERROR,
)
from ._llm_values import _llm_generate_values
from ..models import (
    ScannedField, FormScanResult, Notification,
    FormSnapshot, FormSnapshotCollection,
    TaskItem, TaskList,
)
from .form_rules import match_rule, get_has_button_keywords


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


def _task_done_impl(label_text, case_data_store):
    """Mark a field as completed in the task list.

    Extracted from closure so the form module can share it internally
    and future split modules can import it.
    """
    tl = TaskList.from_store(case_data_store.get('task_list'))
    found = tl.mark_done(label_text)
    if found is not None:
        sys.stderr.write(f'[task-done] OK: "{label_text}" → done={len(tl.done)}\n')
    else:
        already = tl.find_done(label_text)
        if already is None:
            sys.stderr.write(f'[task-done] NOT FOUND: "{label_text}"\n')
        else:
            sys.stderr.write(f'[task-done] ALREADY: "{label_text}"\n')
    case_data_store['task_list'] = tl.to_store()


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
        """
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
        raw = await page.evaluate(JS_SCAN_FORM_FIELDS, False, _button_keywords())
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
        return _ok(f'expanded-{total}-nodes')

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
        _record_action('login', {'username': username, 'password': password, 'captcha': captcha, 'sms_code': sms_code}, 'login-ok')
        return _ok('login-ok | ' + ' '.join(results))

    @controller.action('Get a value for a form field by its label using form rules.')
    async def match_form_rule(label_text: str):
        val = match_rule(label_text, form_rules)
        return val if val else 'NO-RULE'

    @controller.action('Fill a form field using Element UI native DOM setter. Works for text inputs AND date fields (sets value directly).')
    async def fill_form_field(label_text: str, value: str):
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)
        await _ensure_scanned(label_text)
        result = await page.evaluate(JS_FILL_FORM_FIELD, [label_text, value])
        if result == 'ok' or result == 'ok-date' or result == 'ok-placeholder' or result == 'ok-type':
            element = await _capture_element(page, label_text)
            _record_action('fill_form_field', {'label_text': label_text, 'value': value}, result, element=element)
            _task_done_impl(label_text, case_data_store)
            return _ok(result)
        return result

    @controller.action('Fill an Element UI date picker by label text. Value should be in YYYY-MM-DD format.')
    async def fill_date_field(label_text: str, value: str):
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)
        await _ensure_scanned(label_text)
        result = await page.evaluate(JS_FILL_DATE_FIELD, [label_text, value])
        if result.startswith('ok-date'):
            _record_action('fill_date_field', {'label_text': label_text, 'value': value}, result)
            _task_done_impl(label_text, case_data_store)
            return _ok(result)
        return result

    @controller.action('Check the current value of a single form field by its label. Returns JSON with label/kind/currentValue/placeholder/disabled/selected/required. Use this to verify a field was filled correctly by checking currentValue.')
    async def check_field_value(label_text: str):
        page = await browser_context.get_current_page()
        return await page.evaluate(JS_CHECK_SINGLE_FIELD, label_text, _button_keywords())

    @controller.action('Verify that a form field has an expected value. Calls check_field_value and compares currentValue with expected. Returns ok if match, err if mismatch. Use this to confirm a field was filled correctly.')
    async def verify_field_value(label_text: str, expected: str):
        page = await browser_context.get_current_page()
        raw = await page.evaluate(JS_CHECK_SINGLE_FIELD, label_text, _button_keywords())
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

    @controller.action('Full scan: ALL form fields in the current dialog/drawer regardless of visibility. Use this ONCE at the start to build the task list. Auto-saves form structure snapshot for replay validation. Returns {fields: [...], notification: {visible, text}|null}.')
    async def scan_form_fields():
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)
        raw = await page.evaluate(JS_SCAN_FORM_FIELDS, False, _button_keywords())
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

        # 自动构建任务列表并批量填写（Agent 无感知）
        # Preserve existing done items — from_scan filters fields with values,
        # so mark_done() won't find them in pending. Create TaskItems directly.
        prev_tl = TaskList.from_store(case_data_store.get('task_list'))
        prev_done_labels = {d.label for d in prev_tl.done}
        prev_intervene = {item.label for item in prev_tl.pending if item.needs_intervention}

        tl = TaskList.from_scan([f.model_dump() for f in dom_fields])
        # Restore previously-done items — add directly to done since they won't be in pending
        new_labels = {item.label for item in tl.pending}
        for label in prev_done_labels:
            if label not in new_labels:
                tl.done.append(TaskItem(label=label, kind='input'))
        # Restore needs_intervention flags on items that ended up in pending
        for item in tl.pending:
            if item.label in prev_intervene:
                item.needs_intervention = True
        case_data_store['task_list'] = tl.to_store()
        case_data_store['_scan_fields'] = [f.model_dump() for f in dom_fields]
        if tl.pending:
            await _auto_fill_pending()
            # Re-read task_list after auto-fill to get updated done list
            tl = TaskList.from_store(case_data_store.get('task_list'))
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
        raw = await page.evaluate(JS_SCAN_FORM_FIELDS, True, _button_keywords())
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

        # Only show fields that still need filling (pending) — keeps failed/error fields.
        # Also keeps fields not yet tracked (safe default for dynamically shown fields).
        tl = TaskList.from_store(case_data_store.get('task_list'))
        pending_labels = {d.label for d in tl.pending}
        done_labels = {d.label for d in tl.done}
        dom_fields = [f for f in dom_fields if f.label in pending_labels or f.label not in done_labels]

        container_id = result.get('container', 'main') if isinstance(result, dict) else 'main'
        raw_notification = result.get('notification') if isinstance(result, dict) else None
        notification = Notification(**raw_notification) if raw_notification else None
        scan_result = FormScanResult(
            container=container_id,
            fields=dom_fields,
            notification=notification,
        )
        return json.dumps(scan_result.model_dump(), ensure_ascii=False, indent=2)

    @controller.action('Rebuild the task list from scan results (utility — scan_form_fields already handles auto-fill).')
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

    # 内部函数 — 由 scan_form_fields 末尾自动调用。
    # 按 kind 分组（select→input→date→radio→checkbox）多次调用 LLM，
    # 失败字段保留在 pending 供 agent 手动处理，成功字段记录 action + task_done。
    # ── 辅助闭包（共享 page / llm / case_data_store / form_rules）──
    #
    # _execute_round: 分组 → LLM → 逐个执行，三轮回合共用。
    # _scan_new_fields: 全量扫描 → 差值过滤 → TaskItem 创建，Round 2/3 共用。

    async def _execute_round(page, items, label_kind, all_results, round_tag):
        """分组 → LLM 规划 → 逐个执行。round_tag: '' | 'round2 ' | 'round3 '"""
        KIND_ORDER = {'select': 0, 'input': 1, 'date': 2, 'radio': 3, 'checkbox': 4, 'tree-select': 5}
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
            kind_name = {0:'select',1:'input',2:'date',3:'radio',4:'checkbox',5:'tree-select'}.get(idx, 'other')
            await page.evaluate(
                's => console.log("[AI填表] 分组 " + s)',
                f'{kind_name}: {len(sub)}个字段',
            )
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
                    elif field_kind == 'tree-select':
                        result = await page.evaluate(JS_SELECT_TREE_OPTION, [label, value])
                    elif kind in ('select_option', 'select', 'option'):
                        already = await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'check'])
                        if already.startswith('already:'):
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
                                    if not confirmed.startswith('SELECTED:'):
                                        await page.evaluate(JS_FILL_FORM_FIELD, [label, value])
                                        await page.wait_for_timeout(200)
                                        confirmed2 = await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'confirm'])
                                        result = confirmed2 if confirmed2.startswith('SELECTED:') else 'not-synced:' + confirmed
                        else:
                            await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'trigger'])
                            await page.wait_for_timeout(350)
                            result = await page.evaluate(JS_SELECT_OPTION, value)
                            if result.startswith('option-not-found:'):
                                result = await page.evaluate(JS_SELECT_OPTION, 'first')
                            if result.startswith('ok'):
                                confirmed = await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'confirm'])
                                if not confirmed.startswith('SELECTED:'):
                                    await page.evaluate(JS_FILL_FORM_FIELD, [label, value])
                                    await page.wait_for_timeout(200)
                                    confirmed2 = await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'confirm'])
                                    result = confirmed2 if confirmed2.startswith('SELECTED:') else 'not-synced:' + confirmed
                    else:
                        result = f'unknown-action:{kind}'
                except Exception as e:
                    result = f'error:{e}'

                ok = result.startswith('ok') or result.startswith('already') or result.startswith('SELECTED:')
                entry = {'index': step_num, 'action': kind, 'label': label, 'value': value, 'result': result}
                all_results.append(entry)

                if ok:
                    ok_in_group += 1
                    if kind in ('fill_input', 'fill', 'input'):
                        _record_action('fill_form_field', {'label_text': label, 'value': value}, result)
                    elif kind in ('select_option', 'select', 'option'):
                        _record_action('select_option', {'label_text': label, 'option_text': value}, result)
                    _task_done_impl(label, case_data_store)
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
                                            b.click(); return 'verify-clicked';
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
            raw2 = await page.evaluate(JS_SCAN_FORM_FIELDS, False, _button_keywords())
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
            raw3 = await page.evaluate(JS_SCAN_FORM_FIELDS, False, _button_keywords())
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
        ok_count = sum(1 for r in all_results if r['result'].startswith('ok') or r['result'].startswith('already') or r['result'].startswith('SELECTED:'))
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
            raw_sync = await page.evaluate(JS_SCAN_FORM_FIELDS, False, _button_keywords())
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

    @controller.action('Re-add a field to the pending task list (e.g., after a validation error).')
    async def task_retry(label_text: str):
        tl = TaskList.from_store(case_data_store.get('task_list'))
        tl.retry(label_text)
        case_data_store['task_list'] = tl.to_store()
        return _ok(f'task-retry:{label_text} | pending:{len(tl.pending)}')

    @controller.action('Get the current pending/done task list. Returns {"pending": [{label,kind,options,...}], "done": [...]}. Each entry is a full field object for LLM planning.')
    async def get_pending_tasks():
        tl = TaskList.from_store(case_data_store.get('task_list'))
        done_labels = [d.label for d in tl.done]
        intervene = [item.label for item in tl.pending if item.needs_intervention]
        pending_labels = [item for item in tl.to_store()['pending'] if not item.get('needs_intervention')]
        sys.stderr.write(f'[get-pending] done={len(tl.done)} pending={len(tl.pending)} intervene={len(intervene)}\n')
        sys.stderr.flush()
        result = {
            'done': done_labels,
            'pending': pending_labels,
        }
        if intervene:
            result['NEEDS_INTERVENTION'] = intervene
        return json.dumps(result, ensure_ascii=False)

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
        errors = await page.evaluate('''() => {
            const container = ''' + JS_GET_CONTAINER + ''';
            const items = [];
            for (const el of container.querySelectorAll('.el-form-item__error')) {
                const raw = el.textContent.trim();
                if (!raw) continue;
                const label = raw.replace(/^(请选择|请?输入|请上传|填写|完善)/, '').replace(/[：:]/g, '').trim();
                if (label && label.length > 1 && label.length < 30) items.push(label);
            }
            return JSON.stringify(items);
        }''')
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
        if already.startswith('already:'):
            cur_val = already.split(':', 1)[1]
            if cur_val == option_text or option_text in cur_val or cur_val in option_text:
                element = await _capture_element(page, label_text)
                _record_action('select_option', {'label_text': label_text, 'option_text': option_text}, already, element=element)
                _task_done_impl(label_text, case_data_store)
                return _ok(already + ' | already-matched')

        trigger_result = await page.evaluate(JS_FIND_LABELED_SELECT, [label_text, 'trigger'])
        if trigger_result in ('label-not-found', 'no-select-found', 'select-disabled'):
            return trigger_result

        await page.wait_for_timeout(800)

        matched_text = await page.evaluate(JS_FIND_OPTION, option_text)
        if matched_text in ('NO_ITEMS',):
            return _err('no-items')
        if matched_text.startswith('NOT_FOUND:'):
            retry_key = f'_sel_retry_{label_text}'
            retries = case_data_store.get(retry_key, 0) + 1
            case_data_store[retry_key] = retries
            if retries >= 3:
                matched_text = await page.evaluate(JS_FIND_OPTION, 'first')
                if matched_text in ('NO_ITEMS',) or matched_text.startswith('NOT_FOUND:'):
                    return _err(matched_text)
            else:
                return _err(matched_text)

        try:
            opt = page.locator(
                f'//li[contains(@class, "el-select-dropdown__item")][normalize-space()="{matched_text}"]'
            ).first
            await opt.wait_for(state='visible', timeout=3000)
            await opt.click()
        except Exception:
            try:
                opt = page.locator('.el-select-dropdown__item').filter(has_text=matched_text).first
                await opt.wait_for(state='attached', timeout=2000)
                await opt.click()
            except Exception as e:
                return _err(f'click-failed:{e}')

        await page.wait_for_timeout(500)

        current_raw = await page.evaluate(JS_CHECK_SINGLE_FIELD, label_text, _button_keywords())
        if not current_raw or current_raw == 'label-not-found':
            loc = await page.evaluate(JS_LOCATOR, [label_text])
            return _ok(f'ok | {matched_text}' + (' | loc:' + loc) if loc else f'ok | {matched_text}')

        try:
            field_info = json.loads(current_raw)
        except Exception:
            field_info = {}
        current_val = field_info.get('currentValue', '')

        await page.evaluate('''([label, text]) => {
            const container = ''' + JS_GET_CONTAINER + ''';
            const items = container.querySelectorAll('.el-form-item');
            for (const item of items) {
                const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
                if (!lbl.includes(label)) continue;
                const trigger = item.querySelector('.el-select .el-input__inner');
                if (trigger) { trigger.value = text; trigger.setAttribute('value', text); }
                return;
            }
        }''', [label_text, matched_text])

        if current_val and (current_val == matched_text or matched_text in current_val or current_val in matched_text):
            case_data_store.pop(f'_sel_retry_{label_text}', None)
            element = await _capture_element(page, label_text)
            _record_action('select_option', {'label_text': label_text, 'option_text': option_text}, matched_text, element=element)
            _task_done_impl(label_text, case_data_store)
            return _ok(f'ok | {current_val}')

        return _err(f'confirm-failed | current:{current_val} | expected:{matched_text}')

    # ── Adjacent button / radio (moved from misc for logical grouping) ──

    @controller.action('Click an adjacent button (选择/引入/上传) to fill a field, but only if the field is empty. Returns "already-filled" if field has value.')
    async def click_adjacent_button(label_text: str):
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)
        # First check if field already has a value — skip if so
        check_info = await page.evaluate(JS_CHECK_SINGLE_FIELD, label_text, _button_keywords())
        if check_info != 'label-not-found':
            try:
                info = json.loads(check_info)
                if (info.get('currentValue', '').strip() != '' or info.get('selected', False)) and label_text not in ('查询', '搜索', '确定', '提交', '保存'):
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
                            btn.click(); return 'clicked';
                        }
                    }
                }
                // Pass 2: fallback — click any visible button inside the form item
                for (const tag of ['el-button', 'button', 'a']) {
                    const btns = item.querySelectorAll(tag);
                    for (const btn of btns) {
                        if (btn.offsetParent === null) continue;
                        btn.click(); return 'clicked';
                    }
                }
                return 'no-adjacent-button-found';
            }
            return 'label-not-found';
        }''', [label_text])
        if result == 'clicked':
            _record_action('click_adjacent_button', {'label_text': label_text}, result)
            return _ok('clicked')
        return result

    @controller.action('Click a radio option by label text and radio option text.')
    async def click_radio(label_text: str, option_text: str):
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)
        await _ensure_scanned(label_text)
        return await page.evaluate(JS_CLICK_RADIO, [label_text, option_text])

    @controller.action('Select a tree-select option by label and option text. For custom TsscMultiTree components (e.g. 行业代码). Opens popover, searches tree data by label, selects matching node, closes popover.')
    async def select_tree_option(label_text: str, option_text: str):
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)
        await _ensure_scanned(label_text)
        result = await page.evaluate(JS_SELECT_TREE_OPTION, [label_text, option_text])
        if result.startswith('ok:'):
            element = await _capture_element(page, label_text)
            _record_action('select_tree_option', {'label_text': label_text, 'option_text': option_text}, result, element=element)
            _task_done_impl(label_text, case_data_store)
            return _ok(result)
        return result
