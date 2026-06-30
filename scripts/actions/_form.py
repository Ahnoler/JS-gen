"""
Form-related actions: scan, fill, select, task list, validation.

The largest action group — registers 18 controller actions for
Element UI form interaction.
"""

import json
import sys

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
)
from ._llm_values import _llm_generate_values
from ..models import (
    ScannedField, FormScanResult, Notification,
    FormSnapshot, FormSnapshotCollection,
    TaskItem, TaskList,
)
from ..form_rules import match_rule


def _task_done_impl(label_text, case_data_store):
    """Mark a field as completed in the task list.

    Extracted from closure so the form module can share it internally
    and future split modules can import it.
    """
    tl = TaskList.from_store(case_data_store.get('task_list'))
    tl.mark_done(label_text)
    case_data_store['task_list'] = tl.to_store()


def _register_form_actions(controller, browser_context, form_rules, case_data_store, llm=None):
    async def _ensure_scanned(label_text: str):
        """Auto-scan + auto-fill if label is not in the current task_list.

        Deterministic trigger — no LLM dependency.  Two conditions:
        1. task_list doesn't exist → first form on this task
        2. task_list exists but label not in pending/done → new form

        Only triggers for main-page forms.  Dialog/drawer containers are
        skipped — they are search/utility dialogs where agent needs fine
        control over which fields to fill.
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
        raw = await page.evaluate(JS_SCAN_FORM_FIELDS, False)
        try:
            result = json.loads(raw) if isinstance(raw, str) else raw
            raw_fields = result.get('fields') if isinstance(result, dict) else result
        except Exception:
            return
        dom_fields = [ScannedField(**f) if isinstance(f, dict) else f for f in raw_fields]
        container_id = result.get('container', 'main') if isinstance(result, dict) else 'main'

        # Save form structure snapshot BEFORE auto-fill (captures original state)
        snapshot = FormSnapshot.from_scan_fields(
            container=container_id,
            scan_fields=[f.model_dump() for f in dom_fields],
            action_index=len(_ACTION_LOG),
        )
        coll = FormSnapshotCollection(case_data_store.get('form_snapshots', []))
        coll.upsert(snapshot)
        case_data_store['form_snapshots'] = coll.to_dicts()
        case_data_store['form_snapshot'] = snapshot.model_dump()
        _record_action('save_form_snapshot', snapshot.model_dump(), f'ok | {snapshot.count}')

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
            return _ok(result)
        return result

    @controller.action('Check the current value of a single form field by its label. Returns JSON with label/kind/currentValue/placeholder/disabled/selected/required. Use this to verify a field was filled correctly by checking currentValue.')
    async def check_field_value(label_text: str):
        page = await browser_context.get_current_page()
        return await page.evaluate(JS_CHECK_SINGLE_FIELD, label_text)

    @controller.action('Verify that a form field has an expected value. Calls check_field_value and compares currentValue with expected. Returns ok if match, err if mismatch. Use this to confirm a field was filled correctly.')
    async def verify_field_value(label_text: str, expected: str):
        page = await browser_context.get_current_page()
        raw = await page.evaluate(JS_CHECK_SINGLE_FIELD, label_text)
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
        raw = await page.evaluate(JS_SCAN_FORM_FIELDS, False)
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

        snapshot = FormSnapshot.from_scan_fields(
            container=container_id,
            scan_fields=[f.model_dump() for f in dom_fields],
            action_index=len(_ACTION_LOG),
        )
        coll = FormSnapshotCollection(case_data_store.get('form_snapshots', []))
        coll.upsert(snapshot)
        case_data_store['form_snapshots'] = coll.to_dicts()
        case_data_store['form_snapshot'] = snapshot.model_dump()
        _record_action('save_form_snapshot', snapshot.model_dump(), f'ok | {snapshot.count}')

        # 自动构建任务列表并批量填写（Agent 无感知）
        tl = TaskList.from_scan([f.model_dump() for f in dom_fields])
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

        scan_result = FormScanResult(
            container=container_id,
            fields=dom_fields,
            notification=notification,
        )
        return json.dumps(scan_result.model_dump(), ensure_ascii=False, indent=2)

    @controller.action('Visible scan: only visible form fields (offsetParent !== null). Use this for ALL subsequent checks — much smaller output, saves context. Excludes fields already filled by auto-fill. Returns {fields: [...], notification: {visible, text}|null}.')
    async def scan_visible_fields():
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)
        raw = await page.evaluate(JS_SCAN_FORM_FIELDS, True)
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

        snapshot = FormSnapshot.from_scan_fields(
            container=container_id,
            scan_fields=fields,
            action_index=len(_ACTION_LOG),
        )

        coll = FormSnapshotCollection(case_data_store.get('form_snapshots', []))
        coll.upsert(snapshot)
        case_data_store['form_snapshots'] = coll.to_dicts()
        case_data_store['form_snapshot'] = snapshot.model_dump()
        _record_action('save_form_snapshot', snapshot.model_dump(), f'ok | {snapshot.count}')
        return _ok(f'form-snapshot | container:{container_id} | count:{snapshot.count}')

    # 内部函数 — 由 scan_form_fields 末尾自动调用。
    # 按 kind 分组（select→input→date→radio→checkbox）多次调用 LLM，
    # 失败字段保留在 pending 供 agent 手动处理，成功字段记录 action + task_done。
    async def _auto_fill_pending():
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)
        tl = TaskList.from_store(case_data_store.get('task_list'))
        pending = tl.pending

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

        # 按 kind 分组，多次调用 LLM
        KIND_ORDER = {'select': 0, 'input': 1, 'date': 2, 'radio': 3, 'checkbox': 4, 'tree-select': 5}
        groups: dict[int, list[dict]] = {}
        for d in pending_dicts:
            idx = KIND_ORDER.get(label_kind.get(d['label'], 'input'), 99)
            groups.setdefault(idx, []).append(d)

        all_results = []
        for idx in sorted(groups.keys()):
            sub = groups[idx]
            if not sub:
                continue

            # Step 1: LLM 规划（按分组调用）
            kind_name = {0:'select',1:'input',2:'date',3:'radio',4:'checkbox',5:'tree-select'}.get(idx, 'other')
            await page.evaluate(
                's => console.log("[AI填表] 分组 " + s)',
                f'{kind_name}: {len(sub)}个字段',
            )
            # sub 包含此组所有 pending 字段，_llm_generate_values 内部按三级优先级处理：
            #   P1 commandValue → P2 form_rules → P3 LLM/fallback
            # 返回的 actions 已包含 P1+P2+P3 全部结果
            actions = _llm_generate_values(llm, sub, form_rules=form_rules, case_data_store=case_data_store)
            # 打印完整动作列表（P1+P2+P3），确保数量与 pending 一致
            await page.evaluate(
                'd => console.log("[AI填表] 所有动作(" + d.length + "): " + JSON.stringify(d.map(a => a.label + "=" + (a.value||a.option||""))))',
                actions,
            )

            # Step 2: 逐个执行
            total = len(actions)
            ok_in_group = 0
            fail_in_group = 0
            for i, a in enumerate(actions):
                label = a.get('label', '')
                kind = (a.get('action') or '').lower().replace('-', '_')
                value = a.get('value', '') or a.get('option', '')
                field_kind = label_kind.get(label, kind)
                step_num = i + 1
                result = 'skipped'

                try:
                    if kind in ('fill_input', 'fill', 'input'):
                        if field_kind == 'date':
                            result = await page.evaluate(JS_FILL_DATE_FIELD, [label, value])
                        else:
                            result = await page.evaluate(JS_FILL_FORM_FIELD, [label, value])
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
                        else:
                            await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'trigger'])
                            await page.wait_for_timeout(350)
                            result = await page.evaluate(JS_SELECT_OPTION, value)
                            if result.startswith('option-not-found:'):
                                result = await page.evaluate(JS_SELECT_OPTION, 'first')
                    elif field_kind == 'tree-select':
                        result = await page.evaluate(JS_SELECT_TREE_OPTION, [label, value])
                    else:
                        result = f'unknown-action:{kind}'
                except Exception as e:
                    result = f'error:{e}'

                ok = result.startswith('ok') or result.startswith('already')
                entry = {'index': step_num, 'action': kind, 'label': label, 'value': value, 'result': result}
                all_results.append(entry)

                if ok:
                    ok_in_group += 1
                    if kind in ('fill_input', 'fill', 'input'):
                        _record_action('fill_form_field', {'label_text': label, 'value': value}, result)
                    elif kind in ('select_option', 'select', 'option'):
                        _record_action('select_option', {'label_text': label, 'option_text': value}, result)
                    _task_done_impl(label, case_data_store)
                    sys.stderr.write(f'[auto-fill] recorded: {kind} "{label}" = {value} (total: {len(_ACTION_LOG)})\n')
                    sys.stderr.flush()
                    # 进度日志：每步都打印
                    status = 'ok' if ok else f'FAILED:{result}'
                    await page.evaluate(
                        'o => console.log("[AI填表] 执行进度 ======\\n" + o)',
                        f'{step_num}/{total} {kind} "{label}" → {status}',
                    )
                else:
                # 失败 → 不标记 done，留在 pending
                    fail_in_group += 1
                    await page.evaluate(
                        'o => console.log("[AI填表] FAIL: " + o)',
                        f'{step_num}/{total} {kind} "{label}" → {result}',
                    )

                await page.wait_for_timeout(300)

            await page.evaluate(
                's => console.log("[AI填表] 本组完成: " + s)',
                f'{total}个动作 | ok:{ok_in_group} failed:{fail_in_group}',
            )

        # Step 3: 完成
        ok_count = sum(1 for r in all_results if r['result'].startswith('ok') or r['result'].startswith('already'))
        failed_count = len(all_results) - ok_count
        await page.evaluate(
            'd => console.log("[AI填表] 执行完成 ======\\n" + JSON.stringify(d))',
            all_results,
        )
        return _ok(f'auto-fill-done | ok:{ok_count} failed:{failed_count} | ' + json.dumps(all_results, ensure_ascii=False))

    @controller.action('Mark a form field as completed in the task list. Use this after successfully filling a field.')
    async def task_done(label_text: str):
        _task_done_impl(label_text, case_data_store)
        tl = TaskList.from_store(case_data_store.get('task_list'))
        return _ok(f'task-done:{label_text} | remaining:{len(tl.pending)}')

    @controller.action('Re-add a field to the pending task list (e.g., after a validation error).')
    async def task_retry(label_text: str):
        tl = TaskList.from_store(case_data_store.get('task_list'))
        item = tl.retry(label_text)
        if item is None:
            if tl.find_pending(label_text) is None:
                tl.pending.append(TaskItem(label=label_text, kind='input'))
                case_data_store['task_list'] = tl.to_store()
                return _ok(f'task-retry:{label_text} | pending:{len(tl.pending)}')
            case_data_store['task_list'] = tl.to_store()
            return _ok(f'task-retry:{label_text} | pending:{len(tl.pending)} (already pending)')
        case_data_store['task_list'] = tl.to_store()
        return _ok(f'task-retry:{label_text} | pending:{len(tl.pending)}')

    @controller.action('Get the current pending/done task list. Returns {"pending": [{label,kind,options,...}], "done": [...]}. Each entry is a full field object for LLM planning.')
    async def get_pending_tasks():
        tl = TaskList.from_store(case_data_store.get('task_list'))
        done_labels = [d.label for d in tl.done]
        return json.dumps({
            'pending': tl.to_store()['pending'],
            'done': done_labels,
        }, ensure_ascii=False)

    @controller.action('Sync task list from current page validation errors. Reads .el-form-item__error text, extracts field labels (strips 请选择/请输入/请上传 prefix), re-adds them to pending. Call this after a failed submit attempt.')
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
        retried_labels: list[str] = []
        for label in error_labels:
            found = tl.find_done(label)
            if not found:
                for d in list(tl.done):
                    if label in d.label or d.label in label:
                        found = d
                        break
            if found:
                tl.retry(found.label)
                retried_labels.append(found.label)
            elif tl.find_pending(label) is None:
                tl.pending.append(TaskItem(label=label, kind='input'))
                retried_labels.append(label)
        case_data_store['task_list'] = tl.to_store()
        return _ok(f'sync-errors | retried:{len(retried_labels)} | ' + json.dumps(retried_labels, ensure_ascii=False))

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

        current_raw = await page.evaluate(JS_CHECK_SINGLE_FIELD, label_text)
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
            return _ok(f'ok | {current_val}')

        return _err(f'confirm-failed | current:{current_val} | expected:{matched_text}')

    # ── Adjacent button / radio (moved from misc for logical grouping) ──

    @controller.action('Click an adjacent button (选择/引入/上传) to fill a field, but only if the field is empty. Returns "already-filled" if field has value.')
    async def click_adjacent_button(label_text: str):
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)
        # First check if field already has a value — skip if so
        check_info = await page.evaluate(JS_CHECK_SINGLE_FIELD, label_text)
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
