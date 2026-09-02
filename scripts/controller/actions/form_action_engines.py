"""Engine classes for login/fill/select/radio/tree form actions (extracted from _form.py)."""

import asyncio
import json
import re
import sys
import time
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
from .js_snippets.container import JS_VISIBLE_OVERLAY_OF
from .js_snippets._locator_helpers_js import PAGE_LOCATOR_HELPERS
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
from .result_protocol import err_with, ok_marked, affordances
from .select_match import suggest_field_for_value
from .replay_timing import WAIT_500_MS, WAIT_3000_MS, budget_for

# SB：fill_form_field 确定性守卫总开关（Z2 严格解析闸 + Z4 弹层作用域闸）。
# 置 False 可一键回退为守卫前的盲填行为。
STRICT_FILL_GUARDS = True

def _select_failure_next_action(label_text: str, option_text: str, business_data_store) -> str:
    """确定性「建议字段」提示（C2）：值↔选项错配时的下一步指引。

    候选来自 business_data_store 的 task_list（TaskList.from_store 后取
    pending+done 全部项：每项 {label, options}；options 兼容 JSON 字符串）。
    无候选/首项哨兵时返回既有默认文案（逐字不变）。
    """
    default_action = (
        'select_option(label_text="' + label_text + '", option_text=<从 现场/scan options 取原文>)'
    )
    ot = (option_text or '').strip()
    if not ot or ot.lower() in ('first', '1st') or ot in ('第一个', '第一项'):
        return default_action

    def _coerce_opts(raw):
        if isinstance(raw, str):
            try:
                return json.loads(raw)
            except Exception:
                return []
        return raw

    task_fields: list[dict] = []
    raw_tl = (business_data_store or {}).get('task_list')
    try:
        tl = TaskList.from_store(raw_tl)
        for t in list(tl.pending) + list(tl.done):
            task_fields.append({
                'label': getattr(t, 'label', '') or '',
                'options': _coerce_opts(getattr(t, 'options', None)),
            })
    except Exception:
        task_fields = []
    if not task_fields and isinstance(raw_tl, dict):
        for bucket in ('pending', 'done'):
            for p in raw_tl.get(bucket) or []:
                if isinstance(p, dict):
                    task_fields.append({
                        'label': p.get('label', '') or '',
                        'options': _coerce_opts(p.get('options')),
                    })

    cands = suggest_field_for_value(ot, task_fields, exclude_label=label_text)
    if not cands:
        return default_action
    parts = []
    for c in cands[:2]:
        parts.append(
            '建议字段「' + c['label'] + '」（快照选项含：' + c['option'] + '）：'
            'select_option(label_text="' + c['label'] + '", option_text="' + c['option'] + '")'
        )
    return '；'.join(parts)


async def _wait_for_login_form(page, timeout_s=20):
    """Pre-wait for the login page controls to mount (cold-start SPA fix).

    Polls for a visible username-ish input (`placeholder` containing 用户名/
    用户/账号) every 500ms, up to timeout_s. Returns True as soon as found,
    False on timeout. On False the caller proceeds unchanged — non-login-page
    calls (e.g. already-logged-in sessions) keep their existing behavior
    (label-not-found semantics); this probe only absorbs the cold-start
    mounting window. Never raises for probe failures.
    """
    js = (
        "() => { const u=[...document.querySelectorAll('input')].find("
        "i=>i.offsetParent!==null && ((i.placeholder||'').includes('用户名') "
        "|| (i.placeholder||'').includes('用户') || (i.placeholder||'').includes('账号')));"
        " return !!u; }"
    )
    try:
        deadline = time.monotonic() + float(timeout_s)
        while time.monotonic() < deadline:
            try:
                if await page.evaluate(js):
                    return True
            except Exception:
                pass
            await asyncio.sleep(0.5)
    except Exception:
        return False
    return False




class _FormActionEngineBase:
    """Shared wiring for extracted form action engines."""

    def __init__(self, browser_context, business_data_store, autofill_engine, button_keywords=None):
        self.browser_context = browser_context
        self.business_data_store = business_data_store
        self.autofill_engine = autofill_engine
        self.ensure_scanned = autofill_engine.ensure_scanned
        # Parity alias: engine action bodies call the underscore name,
        # e.g. await self._ensure_scanned(label_text).
        self._ensure_scanned = self.ensure_scanned
        self.button_keywords = button_keywords
        # Parity alias: fill bodies call the underscore name,
        # e.g. JS_CHECK_SINGLE_FIELD with self._button_keywords().
        self._button_keywords = button_keywords


class LoginEngine(_FormActionEngineBase):
    async def login(self, username: str, password: str, captcha: str = '', sms_code: str = ''):
        page = await self.browser_context.get_current_page()
        await _wait_if_loading(page)

        # G5 orphan-Chrome reuse probe (already-logged-in session check). If a
        # _usertoken already exists and the hash shows '/home', the browser was
        # reused from a previous run: a matching user → reuse the session
        # directly (no page-state change); a different/unknown user → clear
        # localStorage and reload to reach a clean login form. Missing token →
        # original flow completely unchanged.
        try:
            _g5_sess = await page.evaluate(
                "() => ({ token: localStorage.getItem('_usertoken') || '',"
                " hash: location.hash || '',"
                " usr: localStorage.getItem('usrNo') || localStorage.getItem('usrno')"
                " || localStorage.getItem('username') || localStorage.getItem('userName')"
                " || localStorage.getItem('account') || '' })"
            )
        except Exception:
            _g5_sess = {}
        if (
            isinstance(_g5_sess, dict)
            and (_g5_sess.get('token') or '').strip()
            and '/home' in str(_g5_sess.get('hash') or '')
        ):
            _g5_user = str(_g5_sess.get('usr') or '').strip()
            if _g5_user and _g5_user == str(username or '').strip():
                return _ok(
                    'ok-login reuse | already-logged-in | user:' + _g5_user
                    + ' | hash:' + str(_g5_sess.get('hash') or ''),
                    include_in_memory=True,
                )
            try:
                await page.evaluate("() => { localStorage.clear(); }")
                await page.reload()
            except Exception:
                pass
            await _wait_for_login_form(page)

        # Cold-start pre-wait: absorb the SPA mounting window on a fresh
        # executor slot. If the login form never appears within the timeout
        # (e.g. non-login page / already-logged-in session), fall through
        # unchanged — original label-not-found semantics fully preserved.
        await _wait_for_login_form(page)

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

        await page.wait_for_timeout(WAIT_3000_MS)

        # Post-login probe: poll up to 10s (500ms interval) for a login-success
        # signature; re-click login once around the 4s mark to absorb observed
        # first-click nondeterminism. Success = ANY of:
        #   1. legacy credit-system signature: '#/home' hash or _usertoken in
        #      localStorage;
        #   2. any token-like key (token/usertoken/authorization/session…) with
        #      a non-empty value in localStorage or sessionStorage;
        #   3. left the login page: no visible password input AND no visible
        #      login/submit button remain (covers SPAs that land on a hash the
        #      first two checks don't know about).
        _LOGIN_PROBE_JS = """() => {
          if ((location.hash || '').includes('#/home')) return 'home';
          if (!!localStorage.getItem('_usertoken')) return 'token';
          const stores = [localStorage, sessionStorage];
          for (const s of stores) {
            for (let i = 0; i < s.length; i++) {
              const k = (s.key(i) || '').toLowerCase();
              if (/(token|authorization|session|jwt|loginsession)/.test(k) && (s.getItem(s.key(i)) || '').trim()) return 'token';
            }
          }
          const visible = (el) => {
            if (!el) return false;
            const st = getComputedStyle(el);
            return st.display !== 'none' && st.visibility !== 'hidden' && el.offsetParent !== null;
          };
          const pwd = [...document.querySelectorAll('input[type=password]')].some(visible);
          const btn = [...document.querySelectorAll('button, .el-button, input[type=submit], [class*=login]')].find((b) => visible(b) && /登录|登陆|login|sign ?in/i.test((b.textContent || b.value || '')));
          if (!pwd && !btn) return 'left-login';
          return '';
        }"""

        async def _login_probe_sig():
            try:
                return str(await page.evaluate(_LOGIN_PROBE_JS) or '')
            except Exception:
                return ''

        import time as _time
        _probe_start = _time.monotonic()
        _probe_deadline = _probe_start + 10.0
        _reclicked = False
        probe_sig = await _login_probe_sig()
        while not probe_sig and _time.monotonic() < _probe_deadline:
            if not _reclicked and _time.monotonic() - _probe_start >= 4.0:
                try:
                    await page.evaluate(JS_CLICK_LOGIN_BUTTON)
                except Exception:
                    pass
                _reclicked = True
            await page.wait_for_timeout(500)
            probe_sig = await _login_probe_sig()

        if not probe_sig:
            return _err('err-login | probe-timeout | ' + summary)

        _record_action(
            'login',
            {'username': username, 'password': password, 'captcha': captcha, 'sms_code': sms_code},
            'ok-login',
        )
        return _ok('ok-login | ' + summary + ' | probe:' + probe_sig, include_in_memory=True)




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
        resolved = _resolve_control(self.business_data_store, label_text, xpath_smart)
        from scripts.feature_flags import xpath_smart_fill_only_enabled

        def _absent_skip(lbl: str):
            if not _is_query_mode(self.business_data_store):
                _task_done_impl(lbl or label_text, self.business_data_store)
            sys.stderr.write(f'[form] skip absent fill label={(lbl or label_text)!r}\n')
            sys.stderr.flush()
            return _ok(_with_submit_cue(absent_field_skip_result(), self.business_data_store))

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
                    self.business_data_store,
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
                if not _is_query_mode(self.business_data_store):
                    _task_done_impl(label_text, self.business_data_store, value=value, xpath_smart=xp_inv)
                return _ok(_with_submit_cue(result, self.business_data_store))
            if _is_ok_result(result):
                return _ok(_with_submit_cue(result, self.business_data_store))
            if str(result).startswith('field-disabled'):
                kind_info = await affordances(page, resolved.label or label_text)
                kind = (kind_info or {}).get('kind', 'unknown')
                obs = []
                if kind_info.get('options'):
                    obs.append("options=" + ",".join(kind_info['options'][:6]))
                if kind_info.get('buttons'):
                    obs.append("adjacent=" + ",".join(b['text'] for b in kind_info['buttons'][:3]))
                from .result_protocol import recommend_action_for_kind
                nxt = recommend_action_for_kind(kind)
                return err_with(
                    "err-field-disabled",
                    ("该字段是下拉框(el-select/Tssc)，不能文本直填" if kind == 'select'
                     else f"控件形态 kind={kind} 不接受直接文本写入"),
                    observed=",".join(obs),
                    next_action=nxt.replace("<此字段label>", resolved.label or label_text),
                )
            return _with_submit_cue(result or resolved.error, self.business_data_store)
        # SB 守卫（仅 xpath_smart 非空时执行；两道独立 try/except，
        # 守卫自身故障只 skip 放行，绝不阻断填表）：
        guards_diag = []
        xp_guard = (resolved.xpath_smart or xpath_smart or '').strip()
        if STRICT_FILL_GUARDS and xp_guard:
            # Z2 严格解析闸：命中 0 或多个可见节点都拒绝盲试
            try:
                strict_raw = await page.evaluate(
                    "([expr]) => { " + PAGE_LOCATOR_HELPERS
                    + " return resolveLocatorStrict(expr, {visibleOnly:true}); }",
                    [xp_guard],
                )
                strict_info = strict_raw if isinstance(strict_raw, dict) else {}
                if strict_info.get('error'):
                    guards_diag.append('strict-locator:skipped(' + str(strict_info.get('error'))[:80] + ')')
                elif int(strict_info.get('effectiveCount') or 0) == 0:
                    return _err(
                        'strict-locator-not-found:' + xp_guard
                        + ' | 先 scan 重新获取定位，勿重试同参数'
                    )
                elif strict_info.get('ambiguous'):
                    return _err(
                        'ambiguous-locator:' + xp_guard
                        + ' | hits=' + str(strict_info.get('effectiveCount'))
                        + ' | ' + json.dumps(strict_info.get('samples') or [], ensure_ascii=False)[:200]
                        + ' | 需含消歧条件的定位，拒绝盲试'
                    )
                else:
                    guards_diag.append(
                        'strict-locator:passed(eff=' + str(strict_info.get('effectiveCount')) + ')'
                    )
            except Exception as _guard_exc:
                guards_diag.append('strict-locator:skipped(' + str(_guard_exc)[:80] + ')')
            # Z4 弹层作用域闸：可见弹层存在而目标在其外 → 拒绝
            try:
                overlay_raw = await page.evaluate(JS_VISIBLE_OVERLAY_OF, [xp_guard])
                overlay = overlay_raw if isinstance(overlay_raw, dict) else {}
                if overlay.get('error'):
                    guards_diag.append('overlay:skipped(' + str(overlay.get('error'))[:80] + ')')
                elif (
                    overlay.get('overlayPresent')
                    and overlay.get('targetFound')
                    and not overlay.get('targetInsideOverlay')
                ):
                    return _err(
                        'fill-outside-overlay | 目标在可见弹层「'
                        + str(overlay.get('overlayLabel'))
                        + '」之外，已拒绝。若确要填底层页面字段，先关闭弹层再填'
                    )
                else:
                    guards_diag.append(
                        'overlay:passed(present=' + str(bool(overlay.get('overlayPresent')))
                        + ',found=' + str(bool(overlay.get('targetFound')))
                        + ',inside=' + str(overlay.get('targetInsideOverlay')) + ')'
                    )
            except Exception as _overlay_exc:
                guards_diag.append('overlay:skipped(' + str(_overlay_exc)[:80] + ')')
            sys.stderr.write(
                '[fill] guards label=' + repr(label_text) + ' | ' + ' '.join(guards_diag) + '\n'
            )
            sys.stderr.flush()
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
            if not _is_query_mode(self.business_data_store):
                _task_done_impl(
                    resolved.label, self.business_data_store, value=value, xpath_smart=xp_inv,
                )
            return _ok(_with_submit_cue(result, self.business_data_store))
        if _is_ok_result(result):
            return _ok(_with_submit_cue(result, self.business_data_store))
        if str(result).startswith('field-disabled'):
            kind_info = await affordances(page, resolved.label or label_text)
            kind = (kind_info or {}).get('kind', 'unknown')
            obs = []
            if kind_info.get('options'):
                obs.append("options=" + ",".join(kind_info['options'][:6]))
            if kind_info.get('buttons'):
                obs.append("adjacent=" + ",".join(b['text'] for b in kind_info['buttons'][:3]))
            from .result_protocol import recommend_action_for_kind
            nxt = recommend_action_for_kind(kind)
            return err_with(
                "err-field-disabled",
                ("该字段是下拉框(el-select/Tssc)，不能文本直填" if kind == 'select'
                 else f"控件形态 kind={kind} 不接受直接文本写入"),
                observed=",".join(obs),
                next_action=nxt.replace("<此字段label>", resolved.label or label_text),
            )
        return _with_submit_cue(result, self.business_data_store)


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
                # Disabled field with no adjacent button (hasButton empty) —
                # cannot be operated; non-recordable skip (same semantics as
                # already-filled: _ok wrapper + non-ok message → not recorded,
                # not a failure). Must come after already-filled and before
                # the click attempt so replay does not fail / trigger heal.
                has_button = (info.get('hasButton') or '').strip() if isinstance(info.get('hasButton'), str) else info.get('hasButton')
                if info.get('disabled') and not has_button:
                    # Non-recordable skip — must NOT use ok prefix
                    return _ok(f'disabled-no-adjacent-button | {label_text}')
            except Exception:
                pass
        # Snapshot the adjacent button (not the input) before click
        element = await _enrich_click_element(
            page, text='', form_label=label_text, target_kind='adjacent_button',
        )
        result = await page.evaluate('''([label]) => {
            const container = ''' + JS_GET_CONTAINER + ''';
            const allItems = container.querySelectorAll('.el-form-item');
            // Collect every form-item whose label includes the target, recording
            // an exact-match flag so a prefix sibling (实际控制人客户编号 vs
            // 实际控制人配偶客户编号) does not short-circuit on a button-less item.
            const exact = [];
            const partial = [];
            for (const item of allItems) {
                const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
                if (!lbl.includes(label)) continue;
                if (lbl.trim() === label) exact.push(item);
                else partial.push(item);
            }
            const ordered = exact.concat(partial);
            let matchedAny = ordered.length > 0;
            for (const item of ordered) {
                item.scrollIntoView({ block: 'center', behavior: 'instant' });
                const kw = ['选择', '引入', '上传', '添加', '导入', '新增'];
                let clicked = false;
                for (const tag of ['el-button', 'button', 'a']) {
                    const btns = item.querySelectorAll(tag);
                    for (const btn of btns) {
                        if (btn.offsetParent === null) continue;
                        const t = btn.textContent.trim();
                        if (t && kw.some((k) => t.includes(k))) {
                            btn.click(); clicked = true; break;
                        }
                    }
                    if (clicked) break;
                }
                if (clicked) return 'ok-clicked';
                for (const tag of ['el-button', 'button', 'a']) {
                    const btns = item.querySelectorAll(tag);
                    for (const btn of btns) {
                        if (btn.offsetParent === null) continue;
                        btn.click(); return 'ok-clicked';
                    }
                }
                // No button in this item — continue to the next match instead of
                // giving up (the real button may live in a same-prefix sibling).
            }
            return matchedAny ? 'no-adjacent-button-found' : 'label-not-found';
        }''', [label_text])
        if _is_ok_result(result):
            _record_action(
                'click_adjacent_button',
                {'label_text': label_text},
                result,
                element=element,
            )
            return _ok(result)
        if str(result).startswith('no-adjacent-button-found') or str(result) == 'label-not-found':
            aff = await affordances(page, label_text)
            btns = ",".join(b['text'] for b in (aff.get('buttons') or [])[:4]) or '（该字段区域无可见按钮）'
            return err_with(
                "err-no-adjacent-button",
                f"{label_text} 字段旁没有 选择/引入/上传 类相邻按钮",
                observed=f"fieldButtons={btns} kind={aff.get('kind','unknown')}",
                next_action='若目标需要搜索选择，改用 run_form_assistant 或 select_option；确认该字段是否本就无需引入',
            )
        return result




# N1 filterable-typed fallback: remote/filterable el-select (信贷系统「选择冻结额度」
# 抽屉的客户号) only renders the default first-page options in the DOM — the target
# option (盛达) is absent and option-not-found fires. Real interaction = type a
# keyword into the trigger input (native setter + input event → Vue filter /
# remote fetch), wait, then click the filtered item. Runs ONLY after the plain
# pick path already failed (option-not-found) — never on the success path.
JS_SELECT_FILTERABLE_TYPED = r'''async (optionText) => {
    const want = String(optionText == null ? '' : optionText).trim();
    if (!want) return 'filterable-empty-option';
    const setNativeValue = (input, value) => {
        const proto = input instanceof HTMLTextAreaElement
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(input, value);
        else input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const visibleDropdown = () => [...document.querySelectorAll('.el-select-dropdown')]
        .find((dd) => {
            if (dd.classList.contains('is-hidden')) return false;
            const st = getComputedStyle(dd);
            if (st.display === 'none' || st.visibility === 'hidden') return false;
            return dd.offsetParent !== null || dd.getBoundingClientRect().width > 0;
        });
    const trigger = window.__last_select_trigger || null;
    if (!trigger || !document.contains(trigger)) return 'filterable-no-trigger';
    // Re-open the dropdown if a prior reset closed it. Element UI binds the
    // toggle on the .el-select WRAPPER (@click.stop="toggleMenu"), not the
    // inner input — dispatching only on the input used to fail to open the
    // dropdown (frz round-3: poll saw 0 items, remote search never fired
    // because handleQueryChange runs with visible=false). Try wrapper first,
    // then the input.
    const openDropdown = () => {
        const wrap = trigger.closest('.el-select') || trigger;
        wrap.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        wrap.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        wrap.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        trigger.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        trigger.click();
    };
    if (!visibleDropdown()) openDropdown();
    // Clear before typing (每次键入前清空), then inject the keyword via the
    // native setter so Vue's filterable/remote filter actually fires.
    setNativeValue(trigger, '');
    await new Promise((resolve) => setTimeout(resolve, 150));
    setNativeValue(trigger, want);
    // Filterable/remote filtering is async (remote search round-trip) — poll the
    // visible dropdown items every 300ms up to 5s; first item containing the
    // keyword is clicked. A single 600ms read used to race the remote fetch and
    // return an empty list (frz round-2 N1 failure). 1.8s cap: the watcher
    // action budget for select_option is 5s (replay_timing
    // DEFAULT_ACTION_BUDGET_S) and pre-fallback work (reset/scan/plain pick)
    // already consumes ~3s — success returns as soon as the item appears;
    // only the no-match path consumes the full window.
    const readVisibleItems = () => {
        const dd = visibleDropdown();
        const items = dd
            ? [...dd.querySelectorAll('.el-select-dropdown__item')]
            : [...document.querySelectorAll('.el-select-dropdown__item')];
        return items.filter(
            (it) => it.offsetParent !== null || it.getBoundingClientRect().width > 0
        );
    };
    const deadline = Date.now() + 1800;
    let seen = 0;
    let reopened = 0;
    // Diagnostic (frz round-3): record whether the remote search actually
    // fires — capture fetch/XHR URLs issued during the poll window.
    if (!window.__filterable_net) {
        window.__filterable_net = [];
        const oOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (m, u) {
            try { window.__filterable_net.push(String(u).slice(0, 120)); } catch (e) {}
            return oOpen.apply(this, arguments);
        };
        const oFetch = window.fetch;
        if (oFetch) {
            window.fetch = function (input) {
                try { window.__filterable_net.push(String(input && input.url || input).slice(0, 120)); } catch (e) {}
                return oFetch.apply(this, arguments);
            };
        }
    }
    const t0 = Date.now();
    window.__filterable_net.length = 0;
    while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        // Keep the dropdown open — a re-render/reset during the remote round
        // trip may close it; remote filtering only applies while visible.
        if (!visibleDropdown() && reopened < 2) { openDropdown(); reopened += 1; }
        const visibleItems = readVisibleItems();
        seen = Math.max(seen, visibleItems.length);
        const hit = visibleItems.find(
            (it) => ((it.textContent || '').trim()).indexOf(want) !== -1
        );
        if (hit) {
            hit.scrollIntoView?.({ block: 'center', behavior: 'instant' });
            hit.click();
            return 'ok-filterable-typed:' + (hit.textContent || '').trim();
        }
    }
    const texts = readVisibleItems().slice(0, 8)
        .map((it) => (it.textContent || '').trim()).filter(Boolean);
    const ddAll = document.querySelectorAll('.el-select-dropdown').length;
    const net = (window.__filterable_net || []).slice(0, 3).join(' ; ');
    return 'filterable-typed-no-match:' + texts.join(',')
        + '|seen:' + seen + '|reopened:' + reopened
        + '|dd:' + ddAll + '|net:' + net + '|ms:' + (Date.now() - t0);
}'''


# N4 paged-traverse fallback: paginated el-select (信贷系统「选择冻结额度」抽屉的
# 客户号) loads only the first page (pageNum=1, pageSize=5) into the dropdown —
# typing filters those 5 items only (frz round-4: zero network on input), the
# target lives on page 24/29. Real interaction = open the dropdown, click the
# pagination「下一页」control page by page and scan the rendered items until the
# target appears. Runs ONLY after the filterable-typed fallback already failed
# — never on the success path. No pagination control in the dropdown → not
# applicable ('select-paged-no-pagination'; caller keeps the original error).
# Budget: the watcher action budget for select_option is 5s and the plain/fuzzy/
# filterable chain already consumed most of it — Python passes the remaining
# budget (ms); exceeding it returns select-paged-no-match with the page count.
JS_SELECT_PAGED_TRAVERSE = r'''async ([optionText, budgetMs]) => {
    const want = String(optionText == null ? '' : optionText).trim();
    if (!want) return 'select-paged-empty-option';
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const deadline = Date.now() + Math.max(500, Number(budgetMs) || 3000);
    const visibleDropdown = () => [...document.querySelectorAll('.el-select-dropdown')]
        .find((dd) => {
            if (dd.classList.contains('is-hidden')) return false;
            const st = getComputedStyle(dd);
            if (st.display === 'none' || st.visibility === 'hidden') return false;
            return dd.offsetParent !== null || dd.getBoundingClientRect().width > 0;
        });
    const trigger = window.__last_select_trigger || null;
    if (!trigger || !document.contains(trigger)) return 'select-paged-no-trigger';
    // Same open gesture as JS_SELECT_FILTERABLE_TYPED: the toggle lives on the
    // .el-select WRAPPER, not the inner input.
    const openDropdown = () => {
        const wrap = trigger.closest('.el-select') || trigger;
        wrap.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        wrap.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        wrap.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        trigger.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        trigger.click();
    };
    const fire = (el, type) => el.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, view: window })
    );
    // Real-mouse-event chain (frz round-4 convention): mousedown → mouseup → click.
    const clickChain = (el) => { fire(el, 'mousedown'); fire(el, 'mouseup'); el.click(); };
    if (!visibleDropdown()) { openDropdown(); await sleep(200); }
    if (!visibleDropdown()) { openDropdown(); await sleep(300); }
    const dd = visibleDropdown();
    if (!dd) return 'select-paged-no-dropdown';
    //「下一页」control: .el-pagination .btn-next, or a visible control whose
    // text is exactly 下一页 / › / » inside the dropdown.
    const findNext = (root) => {
        const btn = root.querySelector('.el-pagination .btn-next');
        if (btn && btn.offsetParent !== null) return btn;
        const cands = [...root.querySelectorAll(
            'button, .el-pagination span, .el-pagination li, .el-pager li, a, span, i'
        )].filter((el) => el.offsetParent !== null);
        return cands.find((el) => {
            const t = (el.textContent || '').trim();
            return t === '下一页' || t === '›' || t === '»';
        }) || null;
    };
    if (!findNext(dd)) return 'select-paged-no-pagination';
    const nextDisabled = (next) => next.disabled
        || next.classList.contains('disabled') || next.classList.contains('is-disabled')
        || (next.parentElement && (next.parentElement.classList.contains('disabled')
            || next.parentElement.classList.contains('is-disabled')));
    // Count findCoreInfGroup responses so each page's data is rendered before
    // scanning — clicking「下一页」fires a server fetch; scanning stale items
    // wastes a page tick. (Patched once, after the first next-click setup.)
    // Additionally rewrite the page fetch's pageSize 5→200: the frz round-5
    // wet test proved the server honors a larger pageSize, so the next fetch
    // loads all 144 candidates at once and the scan hits without traversing
    // 29 pages (impossible inside the 5s action budget). If the server ignores
    // the rewrite, traversal continues page by page as before.
    if (!window.__paged_resp_count) {
        window.__paged_resp_count = 0;
        const PAGED_URL = 'findCoreInfGroup';
        const enlarge = (body) => {
            try {
                if (body && typeof body === 'string') {
                    body = body.replace(/"pageSize":\s*\d+/, '"pageSize":200')
                        .replace(/pageSize=\d+/, 'pageSize=200');
                }
            } catch (e) {}
            return body;
        };
        const oOpen = XMLHttpRequest.prototype.open;
        const oSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (m, u) {
            this.__paged_url = String(u || '');
            return oOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function (body) {
            const xhr = this;
            if ((xhr.__paged_url || '').indexOf(PAGED_URL) !== -1) {
                body = enlarge(body);
                xhr.addEventListener('load', function () { window.__paged_resp_count += 1; });
                xhr.addEventListener('error', function () { window.__paged_resp_count += 1; });
            }
            return oSend.apply(this, arguments);
        };
        const oFetch = window.fetch;
        if (oFetch) {
            window.fetch = function (input, init) {
                const u = String((input && input.url) || input || '');
                if (u.indexOf(PAGED_URL) !== -1 && init && typeof init.body === 'string') {
                    init = { ...init, body: enlarge(init.body) };
                }
                const p = oFetch.apply(this, [input, init]);
                if (u.indexOf(PAGED_URL) !== -1) {
                    p.then(() => { window.__paged_resp_count += 1; },
                           () => { window.__paged_resp_count += 1; });
                }
                return p;
            };
        }
    }
    const readItems = (root) => [...root.querySelectorAll('.el-select-dropdown__item')]
        .filter((it) => it.offsetParent !== null || it.getBoundingClientRect().width > 0);
    const MAX_PAGES = 30;
    let pages = 0;
    let reopens = 0;
    for (let p = 0; p < MAX_PAGES; p++) {
        if (Date.now() > deadline) {
            return 'select-paged-no-match:pages=' + pages + '|reason:budget';
        }
        const cur = visibleDropdown();
        if (!cur) {
            if (reopens >= 2) return 'select-paged-no-match:pages=' + pages + '|reason:dropdown-closed';
            reopens += 1;
            openDropdown();
            await sleep(300);
            continue;
        }
        // 每页扫描前把下拉滚到顶，防粘底（frz round-4 教训）。刚重开时列表可能
        // 仍在加载——等首屏 items 出现（最多 600ms）再判空。
        const wrap = cur.querySelector('.el-scrollbar__wrap') || cur;
        wrap.scrollTop = 0;
        if (readItems(cur).length === 0) {
            const tWait = Date.now();
            while (Date.now() - tWait < 600 && Date.now() <= deadline) {
                await sleep(60);
                const curW = visibleDropdown();
                if (curW && readItems(curW).length > 0) break;
            }
        }
        const curScan = visibleDropdown();
        if (!curScan) continue;
        const hit = readItems(curScan).find(
            (it) => ((it.textContent || '').trim()).indexOf(want) !== -1
        );
        if (hit) {
            hit.scrollIntoView?.({ block: 'center', behavior: 'instant' });
            clickChain(hit);
            return 'ok-select-paged:' + (hit.textContent || '').trim();
        }
        const next = findNext(curScan);
        if (!next) {
            return 'select-paged-no-match:pages=' + pages + '|reason:no-next';
        }
        if (nextDisabled(next)) {
            // 翻页请求在途时「下一页」可能短暂禁用——重查最多 3 次再判末页，
            // 防止把加载态误判为 last-page（五轮实测 11 页假 last-page）。
            let stillDisabled = true;
            for (let r = 0; r < 3 && Date.now() <= deadline; r++) {
                await sleep(250);
                const curR = visibleDropdown();
                if (!curR) break;
                const nextR = findNext(curR);
                if (nextR && !nextDisabled(nextR)) { stillDisabled = false; break; }
                if (!nextR) { stillDisabled = true; break; }
            }
            if (stillDisabled) {
                return 'select-paged-no-match:pages=' + pages + '|reason:last-page';
            }
        }
        pages += 1;
        const firstBefore = (readItems(visibleDropdown() || curScan)[0] || {}).textContent || '';
        const prevResps = window.__paged_resp_count;
        clickChain(next);
        // 等待本页数据就绪：findCoreInfGroup 响应到达或首项文本变化，最长
        // 250ms（5s 动作预算内要遍历 20+ 页，不能固定长等；ready 即提前走）。
        const t0 = Date.now();
        while (Date.now() - t0 < 250 && Date.now() <= deadline) {
            await sleep(20);
            const cur2 = visibleDropdown();
            if (!cur2) break;
            const its = readItems(cur2);
            const firstNow = (its[0] || {}).textContent || '';
            if (window.__paged_resp_count > prevResps
                || (its.length && firstNow !== firstBefore)) break;
        }
    }
    return 'select-paged-no-match:pages=' + pages + '|reason:max-pages';
}'''


# N5 main-area labeled select trigger fallback: on the two-step wizard / signing
# pages (frz round-5: 冻结类型/冻结原因/流程操作) JS_SELECT_TRIGGER_BY_XPATH
# returns xpath-not-found even with the scan's xpath_smart, while
# fill_form_field resolves the same fields fine. Last-resort: find the LAST
# visible .el-form-item whose label matches exactly and click its el-select.
JS_SELECT_TRIGGER_MAIN_AREA = r'''([labelText]) => {
    const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
        .replace(/[：:*\s]+$/g, '').replace(/^[*\s]+/, '');
    const isVis = (el) => {
        if (!el || el.nodeType !== 1) return false;
        if (el.offsetParent === null && !el.closest('.el-table__fixed')) return false;
        const st = getComputedStyle(el);
        return st.display !== 'none' && st.visibility !== 'hidden';
    };
    const want = norm(labelText);
    if (!want) return 'main-empty-label';
    let target = null;
    for (const it of document.querySelectorAll('.el-form-item')) {
        if (!isVis(it) || !it.querySelector('.el-select')) continue;
        const lbl = it.querySelector('.el-form-item__label, label');
        if (norm((lbl && lbl.textContent) || '') === want) target = it;
    }
    if (!target) return 'main-select-not-found';
    const trig = target.querySelector('.el-select .el-input__inner');
    if (!trig || !isVis(trig)) return 'no-select-found';
    if (trig.disabled) return 'field-disabled';
    target.scrollIntoView?.({ block: 'center', behavior: 'instant' });
    trig.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    trig.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    trig.click();
    window.__last_select_trigger = trig;
    return 'ok-triggered';
}'''


class SelectEngine(_FormActionEngineBase):
    async def select_option(self, label_text: str, option_text: str, xpath_smart: str = ""):
        try:
            return await self._select_option_impl(label_text, option_text, xpath_smart)
        except Exception as exc:
            import traceback as _tb
            sys.stderr.write(
                f'[select] select_option label={label_text!r} option={option_text!r} '
                f'xpath_smart={xpath_smart!r} exception: {exc}\n{_tb.format_exc()}\n'
            )
            sys.stderr.flush()
            raise

    async def _select_option_impl(self, label_text: str, option_text: str, xpath_smart: str = ""):
        # N4 paged fallback budgets itself against the select_option action
        # budget measured from here (session_runner enforces the same budget
        # via asyncio.wait_for — overrun = budget-timeout).
        impl_started = time.monotonic()
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
            return err_with(
                "err-select-option-unresolved",
                "下拉无可见选项",
                observed=f"label={label_text} last={failed}"[:160],
                next_action='select_option(label_text="' + label_text + '", option_text=<从 现场/scan options 取原文>)',
            )

        resolved = _resolve_control(self.business_data_store, label_text, xpath_smart)
        xp = '' if resolved.error else (resolved.xpath_smart or '').strip()
        trigger_pretriggered = False
        if resolved.error:
            # N5 resolver-level fallback: on wizard/signing pages the control is
            # absent from the inventory, so _resolve_control returns an error
            # BEFORE any trigger JS runs (frz round-5, 流程操作). Try the
            # main-area exact-label trigger; if it opens the dropdown, continue
            # with an empty xpath (the value/trigger evaluates below degrade to
            # harmless 'xpath-empty' and the pick runs on the open dropdown).
            main_trig = str(await page.evaluate(JS_SELECT_TRIGGER_MAIN_AREA, [label_text]))
            if main_trig == 'ok-triggered':
                label_text = resolved.label or label_text
                trigger_pretriggered = True
                sys.stderr.write(
                    f'[select] main-area trigger fallback (resolver-level) success label={label_text!r}\n'
                )
                sys.stderr.flush()
            else:
                return resolved.error
        else:
            label_text = resolved.label or label_text

        element = await _capture_element(
            page, label_text, target_kind='form_select', xpath_smart=xp,
        )

        if not trigger_pretriggered:
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
                        page, self.business_data_store, label_text, stamped, element,
                    )
                    xp_inv = stamp_recorded_xpath_smart(element, xp)
                    params['option_text'] = stamped
                    _record_action('select_option', params, already, element=element)
                    _task_done_impl(
                        label_text, self.business_data_store, value=cur_val or stamped, xpath_smart=xp_inv,
                    )
                    streak = int(self.business_data_store.get('_already_matched_streak', 0) or 0) + 1
                    self.business_data_store['_already_matched_streak'] = streak
                    return _ok(_with_submit_cue(
                        already + ' | already-matched | SKIP — field already set; do not re-select',
                        self.business_data_store,
                    ))
            self.business_data_store['_already_matched_streak'] = 0

            trigger_result = await page.evaluate(JS_SELECT_TRIGGER_BY_XPATH, [xp, label_text])
        else:
            trigger_result = 'ok-triggered'
        if trigger_result == 'xpath-not-found':
            fallback = resolve_select_fallback(self.business_data_store, label_text, xp)
            if fallback is not None:
                reset_diag = await reset_select_ui(page)
                if not reset_diag.get('closed', False):
                    sys.stderr.write(
                        f'[select] fallback preflight reset incomplete: {reset_diag}\n'
                    )
                    sys.stderr.flush()
                    failed = await _final_select_failure('no-items', xp)
                    return err_with(
                        "err-select-option-unresolved",
                        "下拉无可见选项",
                        observed=f"label={label_text} last={failed}"[:160],
                        next_action='select_option(label_text="' + label_text + '", option_text=<从 现场/scan options 取原文>)',
                    )
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
        # N5 main-area trigger fallback — last resort after the xpath trigger
        # (and any stored fallback) failed: exact-label visible el-form-item
        # hunt on main (wizard/signing pages, frz round-5).
        if str(trigger_result) in ('xpath-not-found', 'no-select-found', 'label-not-found'):
            main_trig = str(await page.evaluate(JS_SELECT_TRIGGER_MAIN_AREA, [label_text]))
            if main_trig == 'ok-triggered':
                trigger_result = main_trig
                element = await _capture_element(
                    page, label_text, target_kind='form_select', xpath_smart=xp,
                )
                sys.stderr.write(
                    f'[select] main-area trigger fallback success label={label_text!r}\n'
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
                if not _is_query_mode(self.business_data_store):
                    _task_done_impl(label_text, self.business_data_store)
                sys.stderr.write(f'[select] skip absent label={label_text!r}\n')
                sys.stderr.flush()
                return _ok(_with_submit_cue(absent_field_skip_result(), self.business_data_store))
            failed = await _final_select_failure(str(trigger_result), xp)
            if trigger_result == 'no-select-found':
                return err_with(
                    "err-select-option-unresolved",
                    f"无法稳定选中「{option_text}」",
                    observed=f"label={label_text} last={failed}"[:160],
                    next_action='click_radio(label_text="' + label_text + '", option_text=<选项原文>)',
                )
            return err_with(
                "err-select-option-unresolved",
                f"无法稳定选中「{option_text}」",
                observed=f"label={label_text} last={failed}"[:160],
                next_action='select_option(label_text="' + label_text + '", option_text=<从 现场/scan options 取原文>)',
            )

        await page.wait_for_timeout(WAIT_500_MS)

        # Capture full option list while dropdown is open (before pick)
        params, element = await _pack_select_record(
            page, self.business_data_store, label_text, option_text, element,
        )
        xp_inv = stamp_recorded_xpath_smart(element, xp)

        select_result = await page.evaluate(JS_SELECT_OPTION, option_text)
        if _is_ok_result(select_result):
            # Reject any JS result that silently picked the first item when the
            # wanted option was absent (pseudo-success) — never record / task_done.
            # JS-side root fix removes the fallback-first branch; this guard is
            # defense-in-depth against a regression from any other click path.
            if 'fallback-first' in str(select_result):
                failed = await _final_select_failure(str(select_result), xp)
                return err_with(
                    'err-select-option-unresolved',
                    '引擎拒绝首项兜底伪成功结果（wanted 不在下拉项中）',
                    observed=f'label={label_text} last={failed}'[:160],
                    next_action=_select_failure_next_action(label_text, option_text, self.business_data_store),
                )
            matched_text = select_result.split(':', 1)[1] if ':' in select_result else select_result
            self.business_data_store.pop(f'_sel_retry_{label_text}', None)
            stamped = resolve_recorded_option_text(option_text, matched_text)
            params['option_text'] = stamped
            params, element = attach_select_options(params, element, params.get('options'))
            _record_action('select_option', params, matched_text, element=element)
            _task_done_impl(
                label_text, self.business_data_store, value=stamped or option_text, xpath_smart=xp_inv,
            )
            return _ok(_with_submit_cue(f'ok | {matched_text}', self.business_data_store))
        elif select_result == 'no-items':
            # Xpath recheck — treat already-set field as success (no labeled JS).
            recheck = await page.evaluate(JS_SELECT_VALUE_BY_XPATH, [xp, label_text])
            if str(recheck).startswith('ok-already:'):
                cur = recheck.split(':', 1)[1]
                stamped = resolve_recorded_option_text(option_text, cur)
                params['option_text'] = stamped
                _task_done_impl(label_text, self.business_data_store, value=cur or stamped, xpath_smart=xp_inv)
                _record_action('select_option', params, recheck, element=element)
                return _ok(_with_submit_cue(recheck + ' | already-matched | no-items-skip', self.business_data_store))
            failed = await _final_select_failure('no-items', xp)
            return err_with(
                "err-select-option-unresolved",
                "下拉无可见选项",
                observed=f"label={label_text} last={failed}"[:160],
                next_action='select_option(label_text="' + label_text + '", option_text=<从 现场/scan options 取原文>)',
            )
        elif str(select_result).startswith('value-mismatch'):
            # SELECT_VERIFY_READBACK — JS_SELECT_OPTION clicked an option but the
            # trigger input read back a different value (same-prefix field wrote
            # the wrong select, e.g. 国民经济部门 option into 国民经济部门类别).
            # The JS substring fallback (lab.includes(option)) can also click a
            # wrong option when the desired label is an alias: e.g. want="中国"
            # has no exact option, so the fallback clicks "中国香港特别行政区"
            # (shortest label containing "中国"), which the readback verifier
            # rejects. In that case retrying the same alias loops forever.
            # Fix: on the first mismatch, resolve known aliases against the live
            # dropdown option list (params['options'] captured by
            # _pack_select_record) and retry with the resolved canonical label —
            # same pattern as the not-found branch below.
            mismatch_retry_key = f'_sel_mismatch_retry_{label_text}'
            mismatch_retries = self.business_data_store.get(mismatch_retry_key, 0) + 1
            self.business_data_store[mismatch_retry_key] = mismatch_retries
            if mismatch_retries > 1:
                self.business_data_store.pop(mismatch_retry_key, None)
                failed = await _final_select_failure(str(select_result), xp)
                return err_with(
                    "err-select-option-unresolved",
                    f"无法稳定选中「{option_text}」",
                    observed=f"label={label_text} last={failed}"[:160],
                    next_action=_select_failure_next_action(label_text, option_text, self.business_data_store),
                )
            # Alias resolution: map known short aliases to the canonical option
            # label present in the dropdown (e.g. 中国 → 中华人民共和国).
            # The generic match_select_option_candidate uses substring containment
            # which wrongly picks "台湾(中国的省)" for want="中国" (it contains
            # "中国" inside a parenthetical, but is not the country China).
            # For country aliases, match by prefix and exclude SAR/Taiwan variants.
            # Note: params['options'] may only contain the currently-visible
            # dropdown items (~21 of 250 for large country lists), so when the
            # canonical label is not in the stored list we fall back to the known
            # canonical name directly — JS_SELECT_OPTION will scroll to find it
            # (SELECT_LAZY_LOAD_ON_MISS block).
            resolved_option = option_text
            want = (option_text or '').strip()
            stored_opts = list(params.get('options') or [])
            if want in ('中国', '中国大陆'):
                # Prefer exact "中华人民共和国" in the stored list; otherwise a
                # label that starts with "中国" excluding SAR/Taiwan variants.
                fuzzy = next(
                    (o for o in stored_opts
                     if o.startswith('中国')
                     and '香港' not in o and '澳门' not in o and '台湾' not in o),
                    None,
                )
                if not fuzzy:
                    fuzzy = next(
                        (o for o in stored_opts if o == '中华人民共和国'), None,
                    )
                # If the canonical name isn't in the visible options at all, use
                # it directly — the dropdown scrolls to find it at retry time.
                if not fuzzy:
                    fuzzy = '中华人民共和国'
            else:
                fuzzy = match_select_option_candidate(want, stored_opts)
            if fuzzy and fuzzy != want:
                resolved_option = fuzzy
            reset_diag = await reset_select_ui(page)
            if not reset_diag.get('closed', False):
                sys.stderr.write(
                    f'[select] value-mismatch reset incomplete: {reset_diag}\n'
                )
                sys.stderr.flush()
                failed = await _final_select_failure(str(select_result), xp)
                return err_with(
                    "err-select-option-unresolved",
                    f"无法稳定选中「{option_text}」",
                    observed=f"label={label_text} last={failed}"[:160],
                    next_action='select_option(label_text="' + label_text + '", option_text=<从 现场/scan options 取原文>)',
                )
            retrigger = await page.evaluate(JS_SELECT_TRIGGER_BY_XPATH, [xp, label_text])
            if _is_ok_result(str(retrigger)):
                await page.wait_for_timeout(WAIT_500_MS)
                retry_result = await page.evaluate(JS_SELECT_OPTION, resolved_option)
                if _is_ok_result(retry_result):
                    self.business_data_store.pop(mismatch_retry_key, None)
                    matched_text = retry_result.split(':', 1)[1] if ':' in retry_result else retry_result
                    stamped = resolve_recorded_option_text(option_text, matched_text)
                    params['option_text'] = stamped
                    params, element = attach_select_options(params, element, params.get('options'))
                    _record_action('select_option', params, matched_text, element=element)
                    _task_done_impl(
                        label_text, self.business_data_store, value=stamped or option_text, xpath_smart=xp_inv,
                    )
                    return _ok(_with_submit_cue(f'ok | {matched_text} | mismatch-retry', self.business_data_store))
                # Alias retry still mismatch (rare race: lazy chunk lag made even
                # the canonical-label hunt settle on the wrong prefix item) →
                # one FINAL strict attempt with exactOnly: no fuzzy fallback at
                # all, readback must equal the resolved label verbatim.
                if resolved_option != option_text:
                    await reset_select_ui(page)
                    retrigger2 = await page.evaluate(
                        JS_SELECT_TRIGGER_BY_XPATH, [xp, label_text]
                    )
                    if _is_ok_result(str(retrigger2)):
                        await page.wait_for_timeout(WAIT_500_MS)
                        strict_result = await page.evaluate(
                            JS_SELECT_OPTION, [resolved_option, True]
                        )
                        if _is_ok_result(strict_result):
                            self.business_data_store.pop(mismatch_retry_key, None)
                            matched_text = strict_result.split(':', 1)[1] if ':' in strict_result else strict_result
                            stamped = resolve_recorded_option_text(option_text, matched_text)
                            params['option_text'] = stamped
                            params, element = attach_select_options(params, element, params.get('options'))
                            _record_action('select_option', params, matched_text, element=element)
                            _task_done_impl(
                                label_text, self.business_data_store, value=stamped or option_text, xpath_smart=xp_inv,
                            )
                            return ok_marked(
                                self.business_data_store, label=label_text, got=matched_text,
                                fallback="mismatch-retry-exact",
                                wanted=(option_text if matched_text != option_text else ""),
                            )
                        failed = await _final_select_failure(str(strict_result), xp)
                        return err_with(
                            "err-select-option-unresolved",
                            f"别名解析至「{resolved_option}」仍回读不一致",
                            observed=f"label={label_text} last={failed}"[:160],
                            next_action='select_option(label_text="' + label_text + '", option_text=<从 现场/scan options 取原文>)',
                        )
                # Retry still mismatch / other failure → heal.
                self.business_data_store.pop(mismatch_retry_key, None)
                failed = await _final_select_failure(str(retry_result), xp)
                return err_with(
                    "err-select-option-unresolved",
                    f"无法稳定选中「{option_text}」",
                    observed=f"label={label_text} last={failed}"[:160],
                    next_action='select_option(label_text="' + label_text + '", option_text=<从 现场/scan options 取原文>)',
                )
            failed = await _final_select_failure(str(select_result), xp)
            return err_with(
                "err-select-option-unresolved",
                f"无法稳定选中「{option_text}」",
                observed=f"label={label_text} last={failed}"[:160],
                next_action=_select_failure_next_action(label_text, option_text, self.business_data_store),
            )
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
                    self.business_data_store.pop(f'_sel_retry_{label_text}', None)
                    params['option_text'] = matched_text
                    _record_action('select_option', params, matched_text, element=element)
                    _task_done_impl(label_text, self.business_data_store, value=matched_text, xpath_smart=xp_inv)
                    return _ok(_with_submit_cue(f'ok | {matched_text} | fuzzy-matched-from:{want}', self.business_data_store))
            # N4 paged-traverse fallback — runs BEFORE the filterable-typed
            # attempt, with filterable-typed demoted to its sub-strategy: a
            # paginated el-select renders only the first page and typing cannot
            # reach later pages (frz round-4/5: zero network on input, target on
            # page 24/29), so burning the 1.8s typed window first starves the
            # page-by-page traversal inside the 5s action budget. Not
            # applicable (no pagination control) → fall through to the
            # filterable-typed block below unchanged. Budget-aware: pass the
            # remaining select_option budget (minus a 300ms margin) into the JS.
            elapsed_ms = (time.monotonic() - impl_started) * 1000
            paged_budget_ms = max(800, int(budget_for('select_option') * 1000 - elapsed_ms - 300))
            paged_result = str(await page.evaluate(
                JS_SELECT_PAGED_TRAVERSE, [want, paged_budget_ms],
            ))
            if str(paged_result).startswith('ok-select-paged'):
                matched_text = paged_result.split(':', 1)[1] if ':' in paged_result else want
                self.business_data_store.pop(f'_sel_retry_{label_text}', None)
                stamped = resolve_recorded_option_text(option_text, matched_text)
                params['option_text'] = stamped
                params, element = attach_select_options(params, element, params.get('options'))
                _record_action('select_option', params, matched_text + ' | select-paged', element=element)
                _task_done_impl(
                    label_text, self.business_data_store, value=stamped or matched_text, xpath_smart=xp_inv,
                )
                return _ok(_with_submit_cue(f'ok | {matched_text} | select-paged', self.business_data_store))
            paged_applicable = str(paged_result).startswith('select-paged-no-match')
            sys.stderr.write(
                f'[select] paged-traverse attempt label={label_text!r} '
                f'option={option_text!r} result={paged_result!r}\n'
            )
            sys.stderr.flush()
            self.business_data_store['_last_select_paged'] = {
                'label': label_text, 'option': option_text, 'result': paged_result,
            }
            if paged_applicable:
                # Pagination existed but the target was not reached within the
                # remaining budget — typed filtering cannot help paginated
                # dropdowns, fail with the paged diagnostic.
                failed = await _final_select_failure(
                    str(select_result) + ' | select-paged:' + paged_result, xp,
                )
                return err_with(
                    "err-select-option-unresolved",
                    f"无法稳定选中「{option_text}」",
                    observed=f"label={label_text} last={failed}"[:160],
                    next_action=_select_failure_next_action(label_text, option_text, self.business_data_store),
                )
            # N1 filterable-typed fallback — sub-strategy of the paged fallback,
            # only reached when the dropdown has NO pagination control (plain
            # remote/filterable select). Original chain otherwise unchanged.
            filterable_result = str(await page.evaluate(JS_SELECT_FILTERABLE_TYPED, want))
            if _is_ok_result(filterable_result):
                matched_text = filterable_result.split(':', 1)[1] if ':' in filterable_result else want
                self.business_data_store.pop(f'_sel_retry_{label_text}', None)
                stamped = resolve_recorded_option_text(option_text, matched_text)
                params['option_text'] = stamped
                params, element = attach_select_options(params, element, params.get('options'))
                _record_action('select_option', params, matched_text + ' | filterable-typed', element=element)
                _task_done_impl(
                    label_text, self.business_data_store, value=stamped or matched_text, xpath_smart=xp_inv,
                )
                return _ok(_with_submit_cue(f'ok | {matched_text} | filterable-typed', self.business_data_store))
            sys.stderr.write(
                f'[select] filterable-typed attempt failed label={label_text!r} '
                f'option={option_text!r} result={filterable_result!r}\n'
            )
            sys.stderr.flush()
            self.business_data_store['_last_select_filterable_typed'] = {
                'label': label_text, 'option': option_text, 'result': filterable_result,
            }
            failed = await _final_select_failure(
                str(select_result) + ' | filterable-typed:' + filterable_result
                + ' | select-paged:' + paged_result, xp,
            )
            return err_with(
                "err-select-option-unresolved",
                f"无法稳定选中「{option_text}」",
                observed=f"label={label_text} last={failed}"[:160],
                next_action=_select_failure_next_action(label_text, option_text, self.business_data_store),
            )
        else:
            failed = await _final_select_failure(str(select_result), xp)
            return err_with(
                "err-select-option-unresolved",
                f"无法稳定选中「{option_text}」",
                observed=f"label={label_text} last={failed}"[:160],
                next_action=_select_failure_next_action(label_text, option_text, self.business_data_store),
            )

    # ── Adjacent button / radio (moved from misc for logical grouping) ──




class RadioEngine(_FormActionEngineBase):
    async def click_radio(self, label_text: str, option_text: str, xpath_smart: str = ""):
        page = await self.browser_context.get_current_page()
        await _wait_if_loading(page)
        await self._ensure_scanned(label_text)
        resolved = _resolve_control(self.business_data_store, label_text, xpath_smart)
        if resolved.error:
            return resolved.error
        element = await _capture_element(
            page, resolved.label, target_kind='form_radio', xpath_smart=resolved.xpath_smart,
        )
        result = await page.evaluate(JS_CLICK_RADIO_BY_XPATH, [resolved.xpath_smart, option_text])
        if is_absent_field_result(result):
            if not _is_query_mode(self.business_data_store):
                _task_done_impl(resolved.label, self.business_data_store)
            sys.stderr.write(f'[form] skip absent radio label={resolved.label!r}\n')
            sys.stderr.flush()
            return _ok(_with_submit_cue(absent_field_skip_result(), self.business_data_store))
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
                resolved.label, self.business_data_store, value=option_text, xpath_smart=xp_inv,
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
            await page.wait_for_timeout(WAIT_500_MS)
        return _ok(f'ok-expanded-{total}-nodes')


    async def select_tree_option(self, label_text: str, option_text: str, xpath_smart: str = ""):
        page = await self.browser_context.get_current_page()
        await _wait_if_loading(page)
        await self._ensure_scanned(label_text)
        resolved = _resolve_control(self.business_data_store, label_text, xpath_smart)
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
            _task_done_impl(label_text, self.business_data_store, value=option_text, xpath_smart=xp_inv)
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
                resolved_fill = _resolve_control(self.business_data_store, label_text, '')
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
                        label_text, self.business_data_store, value=fill_val,
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

