"""Engine classes for login/fill/select/radio/tree form actions (extracted from _form.py)."""

import json
import re
import sys
from dataclasses import dataclass

from ...agent_utils import emit_json
from scripts.state import _record_action
from ._helpers import (
    _as_dict, _ok, _err, _is_ok_result,
    is_absent_field_result, absent_field_skip_result, should_record_result,
    _wait_if_loading, _capture_element, _merge_ax_text,
    _enrich_click_element,
    attach_select_options, options_from_scan_store, read_select_options,
    reset_select_ui,
    stamp_recorded_xpath_smart,
)
from ._js_snippets import (
    JS_GET_CONTAINER, JS_IDENTIFY_CONTAINER, JS_IS_QUERY_TOOLBAR,
    JS_CHECK_SINGLE_FIELD, JS_SCAN_FORM_FIELDS,
    JS_FILL_FORM_FIELD, JS_FILL_BY_XPATH,
    JS_CLEAR_FIELD_VALUE,
    JS_SELECT_OPTION,
    JS_SELECT_TRIGGER_BY_XPATH, JS_SELECT_VALUE_BY_XPATH, JS_LOCATOR,
    JS_CLICK_RADIO_BY_XPATH,
    JS_SELECT_TREE_OPTION, JS_EXPAND_ALL_EL_TREE,
    JS_SCROLL_TO_FIRST_ERROR,
    JS_CLICK_SAVE_BUTTON, JS_SCAN_SAVE_OUTCOME, JS_WATCH_SAVE_NOTIFICATIONS,
    JS_CLICK_LOGIN_BUTTON,
)
from ...models import (
    ScannedField, FormScanResult, Notification,
    FormSnapshot, FormSnapshotCollection,
    TaskItem, TaskList,
)
from ...models.field import ScannedButton
from .form_rules import (
    match_rule, match_cert_number, get_has_button_keywords,
    normalize_lat_lng_value,
)

from .form_scan_utils import (
    _SEARCH_DIALOG_HINTS, _QUERY_NEXT_HINT, _is_search_dialog, _force_refill_flag,
    _scan_buttons_from_result, refresh_scan_buttons, _section_group_key, _dedupe_needs_agent,
    _build_section_summary, build_editable_summary, _is_query_mode, _skip_auto_fill,
    _mark_query_ui_if_needed,
    filter_fillable_scan_fields, prepare_scan_fields_for_tasklist, tasklist_scan_mode,
    field_values_equivalent, enrich_field_value_check,
    _pack_select_record, resolve_recorded_option_text, select_option_already_matched,
    match_select_option_candidate,
    _JS_READ_CERT_TYPE, _JS_EXTRACT_ERROR_LABELS, _save_form_snapshot,
    ResolvedControl, _resolve_control, resolve_select_fallback, _task_xpath_smart, _task_done_impl,
    _submit_ready_hint, _switch_task_list_container, _with_submit_cue, _query_not_form_payload,
)

from .form_autofill import FormAutofillEngine

class _FormActionEngineBase:
    """Shared wiring for extracted form action engines."""

    def __init__(self, browser_context, case_data_store, autofill_engine, button_keywords=None):
        self.browser_context = browser_context
        self.case_data_store = case_data_store
        self.autofill_engine = autofill_engine
        self.ensure_scanned = autofill_engine.ensure_scanned
        self.button_keywords = button_keywords


class LoginEngine(_FormActionEngineBase):
    async def login(self, username: str, password: str, captcha: str = '', sms_code: str = ''):
        page = await self.browser_context.get_current_page()
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
        clicked = await page.evaluate(JS_CLICK_LOGIN_BUTTON)
        results.append(f'btn:{clicked}')

        summary = ' '.join(results)
        if (
            not _is_ok_result(str(u_r))
            or not _is_ok_result(str(p_r))
            or clicked != 'ok'
        ):
            return _err('err-login | ' + summary)

        await page.wait_for_timeout(3000)
        _record_action(
            'login',
            {'username': username, 'password': password, 'captcha': captcha, 'sms_code': sms_code},
            'ok-login',
        )
        return _ok('ok-login | ' + summary, include_in_memory=True)




class FillEngine(_FormActionEngineBase):
    async def match_form_rule(self, label_text: str):
        # 业务数据（用户需求）仅作原文提示给 AI；不用 label↔key 硬匹配灌值
        t = (label_text or '').replace(' ', '')
        if '证件号码' in t or (t.endswith('证件号') and '类型' not in t):
            page = await self.browser_context.get_current_page()
            try:
                cert_type = await page.evaluate(_JS_READ_CERT_TYPE, ['证件类型', '证照类型', '证件种类'])
            except Exception:
                cert_type = ''
            val = match_cert_number(cert_type or '')
            sys.stderr.write(f'[match-form-rule] cert_type={cert_type!r} → {val}\n')
            sys.stderr.flush()
            return val
        val = match_rule(label_text)
        return val if val else 'NO-RULE'


    async def fill_form_field(self, label_text: str, value: str, xpath_smart: str = ""):
        page = await self.browser_context.get_current_page()
        await _wait_if_loading(page)
        await self._ensure_scanned(label_text)
        value = normalize_lat_lng_value(label_text, value)
        resolved = _resolve_control(self.case_data_store, label_text, xpath_smart)
        from scripts.feature_flags import xpath_smart_fill_only_enabled

        def _absent_skip(lbl: str):
            if not _is_query_mode(self.case_data_store):
                _task_done_impl(lbl or label_text, self.case_data_store)
            sys.stderr.write(f'[form] skip absent fill label={(lbl or label_text)!r}\n')
            sys.stderr.flush()
            return _ok(_with_submit_cue(absent_field_skip_result(), self.case_data_store))

        strict_xpath = xpath_smart_fill_only_enabled()
        use_label_fallback = (
            (not strict_xpath)
            and bool(resolved.error)
            and not (resolved.xpath_smart or "").strip()
        )
        if resolved.error and not use_label_fallback:
            if is_absent_field_result(resolved.error):
                return _absent_skip(label_text)
            if strict_xpath and not (resolved.xpath_smart or xpath_smart or '').strip():
                return _with_submit_cue(
                    resolved.error or 'err-xpath-smart-required',
                    self.case_data_store,
                )
            return resolved.error
        if use_label_fallback:
            # Query/introduce picker: scan may still miss; label DOM fill in
            # the active container (JS_GET_CONTAINER) is the recording path.
            result = await page.evaluate(JS_FILL_FORM_FIELD, [label_text, value])
            if is_absent_field_result(result):
                return _absent_skip(label_text)
            if _is_ok_result(result) and should_record_result(result):
                element = await _capture_element(
                    page, label_text, target_kind='form_input', xpath_smart='',
                )
                xp_inv = stamp_recorded_xpath_smart(element, "")
                _record_action(
                    'fill_form_field',
                    {'label_text': label_text, 'value': value},
                    result,
                    element=element,
                )
                if not _is_query_mode(self.case_data_store):
                    _task_done_impl(label_text, self.case_data_store, value=value, xpath_smart=xp_inv)
                return _ok(_with_submit_cue(result, self.case_data_store))
            if _is_ok_result(result):
                return _ok(_with_submit_cue(result, self.case_data_store))
            return _with_submit_cue(result or resolved.error, self.case_data_store)
        element = await _capture_element(
            page, resolved.label, target_kind='form_input', xpath_smart=resolved.xpath_smart,
        )
        result = await page.evaluate(JS_FILL_BY_XPATH, [resolved.xpath_smart, value, resolved.label])
        if is_absent_field_result(result):
            return _absent_skip(resolved.label or label_text)
        if _is_ok_result(result) and should_record_result(result):
            xp_inv = stamp_recorded_xpath_smart(element, resolved.xpath_smart)
            _record_action(
                'fill_form_field',
                {'label_text': resolved.label, 'value': value},
                result,
                element=element,
            )
            if not _is_query_mode(self.case_data_store):
                _task_done_impl(
                    resolved.label, self.case_data_store, value=value, xpath_smart=xp_inv,
                )
            return _ok(_with_submit_cue(result, self.case_data_store))
        if _is_ok_result(result):
            return _ok(_with_submit_cue(result, self.case_data_store))
        return _with_submit_cue(result, self.case_data_store)


    async def check_field_value(self, label_text: str):
        page = await self.browser_context.get_current_page()
        raw = await page.evaluate(JS_CHECK_SINGLE_FIELD, [label_text, self._button_keywords()])
        if raw == 'label-not-found':
            return raw
        try:
            info = _as_dict(raw)
        except Exception:
            return raw
        if isinstance(info, dict):
            enrich_field_value_check(info)
            return json.dumps(info, ensure_ascii=False)
        return raw


    async def verify_field_value(self, label_text: str, expected: str):
        page = await self.browser_context.get_current_page()
        raw = await page.evaluate(JS_CHECK_SINGLE_FIELD, [label_text, self._button_keywords()])
        if raw == 'label-not-found':
            return _err('label-not-found')
        try:
            info = json.loads(raw)
        except Exception:
            return raw
        current = info.get('currentValue', '')
        if field_values_equivalent(current, expected):
            return _ok(f'verified:{current}')
        return _err(f'mismatch | current:{current} | expected:{expected}')


    async def click_adjacent_button(self, label_text: str):
        page = await self.browser_context.get_current_page()
        await _wait_if_loading(page)
        # First check if field already has a value — skip if so
        check_info = await page.evaluate(JS_CHECK_SINGLE_FIELD, [label_text, self._button_keywords()])
        if check_info != 'label-not-found':
            try:
                info = json.loads(check_info)
                if (info.get('currentValue', '').strip() != '' or info.get('selected', False)) and label_text not in ('查询', '搜索', '确定', '提交', '保存'):
                    # Non-recordable skip — must NOT use ok prefix
                    return _ok(f'already-filled | {info.get("currentValue", "")}')
            except Exception:
                pass
        # Snapshot the adjacent button (not the input) before click
        element = await _enrich_click_element(
            page, text='', form_label=label_text, target_kind='adjacent_button',
        )
        result = await page.evaluate('''([label]) => {
            const container = ''' + JS_GET_CONTAINER + ''';
            const items = container.querySelectorAll('.el-form-item');
            for (const item of items) {
                const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
                if (!lbl.includes(label)) continue;
                item.scrollIntoView({ block: 'center', behavior: 'instant' });
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
            _record_action(
                'click_adjacent_button',
                {'label_text': label_text},
                result,
                element=element,
            )
            return _ok(result)
        return result




class SelectEngine(_FormActionEngineBase):
    async def select_option(self, label_text: str, option_text: str, xpath_smart: str = ""):
        page = await self.browser_context.get_current_page()
        await _wait_if_loading(page)
        await self._ensure_scanned(label_text)

        async def _final_select_failure(result_text: str, xpath_for_log: str = '') -> str:
            diag = await reset_select_ui(page)
            sys.stderr.write(
                f'[select] final failure label={label_text!r} option={option_text!r} '
                f'xpath={xpath_for_log!r} result={result_text!r} reset={diag}\n'
            )
            sys.stderr.flush()
            return result_text

        reset_diag = await reset_select_ui(page)
        if not reset_diag.get('closed', False):
            sys.stderr.write(f'[select] preflight reset incomplete: {reset_diag}\n')
            sys.stderr.flush()
            failed = await _final_select_failure('no-items')
            return _err(failed)

        resolved = _resolve_control(self.case_data_store, label_text, xpath_smart)
        if resolved.error:
            return resolved.error
        xp = resolved.xpath_smart
        label_text = resolved.label or label_text

        element = await _capture_element(
            page, label_text, target_kind='form_select', xpath_smart=resolved.xpath_smart,
        )

        # Xpath-only already-matched (no JS_FIND_LABELED_SELECT).
        already = await page.evaluate(JS_SELECT_VALUE_BY_XPATH, [xp, label_text])
        if str(already).startswith('ok-already:'):
            cur_val = already.split(':', 1)[1]
            # "first" means "any existing value is fine" — do NOT re-open the
            # dropdown (re-selecting first can cascade-reset dependent fields).
            # Exact match only — substring (非金融 ⊂ 其他非金融) must re-select.
            if select_option_already_matched(option_text, cur_val):
                stamped = resolve_recorded_option_text(option_text, cur_val)
                params, element = await _pack_select_record(
                    page, self.case_data_store, label_text, stamped, element,
                )
                xp_inv = stamp_recorded_xpath_smart(element, xp)
                params['option_text'] = stamped
                _record_action('select_option', params, already, element=element)
                _task_done_impl(
                    label_text, self.case_data_store, value=cur_val or stamped, xpath_smart=xp_inv,
                )
                streak = int(self.case_data_store.get('_already_matched_streak', 0) or 0) + 1
                self.case_data_store['_already_matched_streak'] = streak
                return _ok(_with_submit_cue(
                    already + ' | already-matched | SKIP — field already set; do not re-select',
                    self.case_data_store,
                ))

        self.case_data_store['_already_matched_streak'] = 0

        trigger_result = await page.evaluate(JS_SELECT_TRIGGER_BY_XPATH, [xp, label_text])
        if trigger_result == 'xpath-not-found':
            fallback = resolve_select_fallback(self.case_data_store, label_text, xp)
            if fallback is not None:
                reset_diag = await reset_select_ui(page)
                if not reset_diag.get('closed', False):
                    sys.stderr.write(
                        f'[select] fallback preflight reset incomplete: {reset_diag}\n'
                    )
                    sys.stderr.flush()
                    failed = await _final_select_failure('no-items', xp)
                    return _err(failed)
                xp = fallback.xpath_smart
                label_text = fallback.label or label_text
                trigger_result = await page.evaluate(JS_SELECT_TRIGGER_BY_XPATH, [xp, label_text])
                if _is_ok_result(str(trigger_result)):
                    element = await _capture_element(
                        page,
                        label_text,
                        target_kind='form_select',
                        xpath_smart=xp,
                    )
                    sys.stderr.write(
                        f'[select] xpath fallback success label={label_text!r} xpath={xp!r}\n'
                    )
                    sys.stderr.flush()
        if trigger_result in (
            'label-not-found',
            'no-select-found',
            'select-disabled',
            'xpath-not-found',
            'xpath-empty',
            'field-disabled',
        ):
            if is_absent_field_result(trigger_result):
                if not _is_query_mode(self.case_data_store):
                    _task_done_impl(label_text, self.case_data_store)
                sys.stderr.write(f'[select] skip absent label={label_text!r}\n')
                sys.stderr.flush()
                return _ok(_with_submit_cue(absent_field_skip_result(), self.case_data_store))
            failed = await _final_select_failure(str(trigger_result), xp)
            if trigger_result == 'no-select-found':
                return _err(failed + ' | field may be radio — use click_radio')
            return failed

        await page.wait_for_timeout(500)

        # Capture full option list while dropdown is open (before pick)
        params, element = await _pack_select_record(
            page, self.case_data_store, label_text, option_text, element,
        )
        xp_inv = stamp_recorded_xpath_smart(element, xp)

        select_result = await page.evaluate(JS_SELECT_OPTION, option_text)
        if _is_ok_result(select_result):
            matched_text = select_result.split(':', 1)[1] if ':' in select_result else select_result
            self.case_data_store.pop(f'_sel_retry_{label_text}', None)
            stamped = resolve_recorded_option_text(option_text, matched_text)
            params['option_text'] = stamped
            params, element = attach_select_options(params, element, params.get('options'))
            _record_action('select_option', params, matched_text, element=element)
            _task_done_impl(
                label_text, self.case_data_store, value=stamped or option_text, xpath_smart=xp_inv,
            )
            return _ok(_with_submit_cue(f'ok | {matched_text}', self.case_data_store))
        elif select_result == 'no-items':
            # Xpath recheck — treat already-set field as success (no labeled JS).
            recheck = await page.evaluate(JS_SELECT_VALUE_BY_XPATH, [xp, label_text])
            if str(recheck).startswith('ok-already:'):
                cur = recheck.split(':', 1)[1]
                stamped = resolve_recorded_option_text(option_text, cur)
                params['option_text'] = stamped
                _task_done_impl(label_text, self.case_data_store, value=cur or stamped, xpath_smart=xp_inv)
                _record_action('select_option', params, recheck, element=element)
                return _ok(_with_submit_cue(recheck + ' | already-matched | no-items-skip', self.case_data_store))
            failed = await _final_select_failure('no-items', xp)
            return _err(failed)
        elif select_result.startswith('option-not-found:'):
            # Fuzzy: pick listed option that contains / is contained by option_text
            listed = [x.strip() for x in select_result.split(':', 1)[1].split(',') if x.strip()]
            # Prefer union of live dropdown preview + stored options
            stored = list(params.get('options') or [])
            for x in listed:
                if x not in stored:
                    stored.append(x)
            params, element = attach_select_options(params, element, stored)
            want = (option_text or '').strip()
            fuzzy = match_select_option_candidate(want, stored)
            # Common alias: 中国 → 中华人民共和国
            if not fuzzy and want in ('中国', '中国大陆'):
                fuzzy = next((o for o in stored if '中国' in o), None)
            if fuzzy:
                fuzzy_result = await page.evaluate(JS_SELECT_OPTION, fuzzy)
                if _is_ok_result(fuzzy_result):
                    matched_text = fuzzy_result.split(':', 1)[1] if ':' in fuzzy_result else fuzzy_result
                    self.case_data_store.pop(f'_sel_retry_{label_text}', None)
                    params['option_text'] = matched_text
                    _record_action('select_option', params, matched_text, element=element)
                    _task_done_impl(label_text, self.case_data_store, value=matched_text, xpath_smart=xp_inv)
                    return _ok(_with_submit_cue(f'ok | {matched_text} | fuzzy-matched-from:{want}', self.case_data_store))
            retry_key = f'_sel_retry_{label_text}'
            retries = self.case_data_store.get(retry_key, 0) + 1
            self.case_data_store[retry_key] = retries
            if retries >= 3:
                first_result = await page.evaluate(JS_SELECT_OPTION, 'first')
                if _is_ok_result(first_result):
                    matched_text = first_result.split(':', 1)[1] if ':' in first_result else first_result
                    self.case_data_store.pop(f'_sel_retry_{label_text}', None)
                    stamped = resolve_recorded_option_text(option_text, matched_text)
                    params['option_text'] = stamped
                    _record_action('select_option', params, matched_text, element=element)
                    _task_done_impl(
                        label_text, self.case_data_store, value=stamped or matched_text, xpath_smart=xp_inv,
                    )
                    return _ok(_with_submit_cue(f'ok | {matched_text}', self.case_data_store))
                failed = await _final_select_failure(str(first_result), xp)
                return _err(failed)
            failed = await _final_select_failure(str(select_result), xp)
            return _err(failed)
        else:
            failed = await _final_select_failure(str(select_result), xp)
            return _err(failed)

    # ── Adjacent button / radio (moved from misc for logical grouping) ──




class RadioEngine(_FormActionEngineBase):
    async def click_radio(self, label_text: str, option_text: str, xpath_smart: str = ""):
        page = await self.browser_context.get_current_page()
        await _wait_if_loading(page)
        await self._ensure_scanned(label_text)
        resolved = _resolve_control(self.case_data_store, label_text, xpath_smart)
        if resolved.error:
            return resolved.error
        element = await _capture_element(
            page, resolved.label, target_kind='form_radio', xpath_smart=resolved.xpath_smart,
        )
        result = await page.evaluate(JS_CLICK_RADIO_BY_XPATH, [resolved.xpath_smart, option_text])
        if is_absent_field_result(result):
            if not _is_query_mode(self.case_data_store):
                _task_done_impl(resolved.label, self.case_data_store)
            sys.stderr.write(f'[form] skip absent radio label={resolved.label!r}\n')
            sys.stderr.flush()
            return _ok(_with_submit_cue(absent_field_skip_result(), self.case_data_store))
        if _is_ok_result(result):
            xp_inv = stamp_recorded_xpath_smart(element, resolved.xpath_smart)
            _record_action(
                'click_radio',
                {
                    'label_text': resolved.label,
                    'option_text': option_text,
                },
                result,
                element=element,
            )
            _task_done_impl(
                resolved.label, self.case_data_store, value=option_text, xpath_smart=xp_inv,
            )
            return _ok(result)
        return result




class TreeEngine(_FormActionEngineBase):
    async def expand_all_el_tree(self):
        page = await self.browser_context.get_current_page()
        total = 0
        for _ in range(10):
            clicked = await page.evaluate(JS_EXPAND_ALL_EL_TREE)
            if clicked == -1:
                return _err('no-el-tree-found')
            if clicked == 0:
                break
            total += clicked
            await page.wait_for_timeout(500)
        return _ok(f'ok-expanded-{total}-nodes')


    async def select_tree_option(self, label_text: str, option_text: str, xpath_smart: str = ""):
        page = await self.browser_context.get_current_page()
        await _wait_if_loading(page)
        await self._ensure_scanned(label_text)
        resolved = _resolve_control(self.case_data_store, label_text, xpath_smart)
        # Soft resolve: tree-select can still run via label JS when scan miss;
        # capture uses resolved xpath when present so steps stamp form_tree_select.
        label_text = (resolved.label or label_text or '').strip() or label_text
        xp = '' if resolved.error else (resolved.xpath_smart or '').strip()
        element = await _capture_element(
            page, label_text, target_kind='form_tree_select', xpath_smart=xp,
        )
        result = await page.evaluate(JS_SELECT_TREE_OPTION, [label_text, option_text])
        # P0/P1/P2 success codes all use ok prefix → recordable via _is_ok_result
        if _is_ok_result(result):
            if element is None and xp:
                element = await _capture_element(
                    page, label_text, target_kind='form_tree_select', xpath_smart=xp,
                )
            if element is None:
                # Last resort: stamp label-only meta so persist has form_tree_select
                element = {
                    'tag_name': 'div',
                    'xpath': xp or '',
                    'xpath_smart': xp or '',
                    'formLabel': label_text,
                    'target_kind': 'form_tree_select',
                    'text': (option_text or '')[:80],
                    'attributes': {},
                    'candidates': (
                        [{'type': 'xpath_smart', 'value': xp}] if xp else []
                    ),
                }
            xp_inv = stamp_recorded_xpath_smart(element, xp)
            _record_action(
                'select_tree_option',
                {'label_text': label_text, 'option_text': option_text},
                result,
                element=element,
            )
            _task_done_impl(label_text, self.case_data_store, value=option_text, xpath_smart=xp_inv)
            return _ok(result)
        res_s = str(result or '')
        if res_s == 'disabled' or res_s.startswith('disabled'):
            return (
                f'disabled | Field "{label_text}" is read-only '
                f'(TsscMultiTree/component disabled; e.g. 分类目录 prefilled from sidebar). '
                f'Do NOT retry select_tree_option or fill_form_field — skip this field.'
            )
        # Misclassified / non-Tssc field: concrete values often work via native fill
        if res_s.startswith('no-tree-component'):
            fill_val = (option_text or '').strip()
            if fill_val and fill_val.lower() != 'first':
                resolved_fill = _resolve_control(self.case_data_store, label_text, '')
                fill_xpath = '' if resolved_fill.error else resolved_fill.xpath_smart
                if fill_xpath:
                    fill_el = await _capture_element(
                        page, label_text, target_kind='form_input', xpath_smart=fill_xpath,
                    )
                    fill_result = await page.evaluate(
                        JS_FILL_BY_XPATH, [fill_xpath, fill_val, label_text],
                    )
                    xp_inv = stamp_recorded_xpath_smart(fill_el, fill_xpath)
                    record_params = {
                        'label_text': label_text,
                        'value': fill_val,
                    }
                else:
                    fill_el = None
                    fill_result = await page.evaluate(JS_FILL_FORM_FIELD, [label_text, fill_val])
                    record_params = {'label_text': label_text, 'value': fill_val}
                if _is_ok_result(fill_result):
                    _record_action(
                        'fill_form_field',
                        record_params,
                        fill_result,
                        element=fill_el,
                    )
                    _task_done_impl(
                        label_text, self.case_data_store, value=fill_val,
                        xpath_smart=xp_inv if fill_xpath else '',
                    )
                    return _ok(
                        f'ok-fill-fallback:{fill_val} | was no-tree-component; '
                        f'recorded as fill_form_field (do not retry select_tree_option)'
                    )
                return (
                    f'{res_s} | fill_form_field also failed ({fill_result}). '
                    f'Do NOT retry select_tree_option on this field.'
                )
            return (
                f'{res_s} | option_text="first" cannot fill. '
                f'Do NOT retry select_tree_option. '
                f'Call fill_form_field("{label_text}", concreteValue) '
                f'or select_option if the field is an el-select.'
            )
        return result


