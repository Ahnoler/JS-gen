"""FillEngine — split from form_action_engines.py (S4)."""

import json
import re
import sys

from scripts.state import _record_action
from ._helpers import (
    _ok, _err, _is_ok_result,
    is_absent_field_result, absent_field_skip_result, should_record_result,
    _wait_if_loading, _capture_element,
    _enrich_click_element,
    _as_dict,
    stamp_recorded_xpath_smart,
)
from ._js_snippets import (
    JS_GET_CONTAINER,
    JS_CHECK_SINGLE_FIELD,
    JS_FILL_FORM_FIELD, JS_FILL_BY_XPATH,
)
from .js_snippets.container import JS_VISIBLE_OVERLAY_OF
from .js_snippets._locator_helpers_js import PAGE_LOCATOR_HELPERS
from .form_rules import match_rule, match_cert_number, normalize_lat_lng_value
from .form_scan_utils import (
    _is_query_mode, _with_submit_cue,
    field_values_equivalent, enrich_field_value_check,
    _JS_READ_CERT_TYPE,
    _resolve_control, lookup_field_kind, _task_done_impl,
)
from .form_engine_base import (
    _FormActionEngineBase,
    _ReplayAutofillStub,
    _ReplayPageAdapter,
    _replay_engine_store,
)
from .result_protocol import err_with, affordances
from .replay_timing import WAIT_300_MS

# 置 False 可一键回退为守卫前的盲填行为。
STRICT_FILL_GUARDS = True

def _maybe_mark_stc_search_filled(
    store: dict | None,
    *,
    label_text: str,
    resolved_label: str = "",
    placeholder: str = "",
) -> None:
    from .search_then_click_guard import is_search_field_label, mark_search_filled

    for lbl in (label_text, resolved_label, placeholder):
        if is_search_field_label(lbl):
            mark_search_filled(store)
            return


def _false_ok_empty_actual(result) -> str | None:
    """false_ok 且 actual 为空时返回 expected 值，否则 None（P6-0/T0.3 兜底回读触发条件）。

    JS_FILL_BY_XPATH 片段回读只按 fill xpath——填充经 label/placeholder 兜底分支落到
    别的节点时，xpath 回读为空、误报 ``false_ok:expected=X,actual=``。
    """
    m = re.match(r'^false_ok:expected=(.*),actual=$', str(result or '').strip())
    return m.group(1) if m else None


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

    @classmethod
    async def fill_form_field_for_replay(
        cls,
        page,
        label_text: str,
        value: str,
        *,
        xpath_smart: str = "",
        element: dict | None = None,
        placeholder: str = "",
    ) -> str:
        """Replay entry: construct engine with page adapter and run mode=replay."""
        store = _replay_engine_store(None)
        bc = _ReplayPageAdapter(page)
        autofill = _ReplayAutofillStub()
        engine = cls(bc, store, autofill)
        return await engine.fill_form_field(
            label_text,
            value,
            xpath_smart,
            mode="replay",
            element=element,
            placeholder=placeholder,
        )

    async def fill_form_field(
        self,
        label_text: str,
        value: str,
        xpath_smart: str = "",
        *,
        mode: str = "record",
        element: dict | None = None,
        placeholder: str = "",
    ):
        if mode == "replay":
            return await self._fill_form_field_replay_impl(
                label_text,
                value,
                xpath_smart,
                element=element,
                placeholder=placeholder,
            )
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

        # TsscMultiSelect/TsscMultiTree: typing into the trigger looks like a
        # successful fill (filterable input) but never selects a row/node and
        # falsely marks task_done — seen on traj #696 / sid 5b463582.
        kind = lookup_field_kind(self.business_data_store, label_text)
        if kind not in ('tssc-multi-select', 'tree-select'):
            try:
                live = await page.evaluate(
                    '''(label) => {
                        const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
                        const want = norm(label);
                        const items = [...document.querySelectorAll('.el-form-item')];
                        let fi = null;
                        for (const it of items) {
                            const t = norm((it.querySelector('.el-form-item__label') || {}).textContent);
                            if (t && (t === want || t.includes(want))) { fi = it; break; }
                        }
                        if (!fi) return '';
                        if (fi.querySelector('.tssc-multi-select')) return 'tssc-multi-select';
                        if (fi.querySelector(
                            '.tree-popover, .tsscTree, .el-tree-select,'
                            + ' [class*="tsscmultitree"], [class*="TsscMultiTree"]'
                        )) return 'tree-select';
                        return '';
                    }''',
                    [label_text],
                )
                if live in ('tssc-multi-select', 'tree-select'):
                    kind = live
            except Exception:
                pass
        if kind == 'tssc-multi-select':
            from .result_protocol import err_with
            nxt = (
                f'select_option(label_text="{resolved.label or label_text}", '
                f'option_text="first" 或表行中文名原文)'
            )
            return err_with(
                "err-use-tssc-multi-select",
                "「要素名称」类字段是 TsscMultiSelect（弹层表格行选），禁止 fill_form_field 文本直填",
                observed=f"label={resolved.label or label_text} kind=tssc-multi-select",
                next_action=nxt,
            )
        if kind == 'tree-select':
            from .result_protocol import err_with, recommend_action_for_kind
            nxt = recommend_action_for_kind(kind).replace(
                '<此字段label>', resolved.label or label_text,
            )
            return err_with(
                "err-use-select-tree-option",
                "该字段是 TsscMultiTree，禁止 fill_form_field 文本直填",
                observed=f"label={resolved.label or label_text} kind=tree-select",
                next_action=nxt,
            )

        from .fill_dispatch import resolve_fill_attempt_order

        attempts = resolve_fill_attempt_order(
            label=resolved.label or label_text,
            placeholder="",
            xpath_smart=(resolved.xpath_smart or xpath_smart or "").strip(),
            xpath_smart_src="element",
            xpath_full="",
        )
        has_xpath_attempt = any(
            a.path == "xpath" and (a.xpath or "").strip() for a in attempts
        )

        strict_xpath = xpath_smart_fill_only_enabled()
        use_label_fallback = (
            (not strict_xpath)
            and bool(resolved.error)
            and not has_xpath_attempt
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
                _maybe_mark_stc_search_filled(
                    self.business_data_store, label_text=label_text,
                )
                return _ok(_with_submit_cue(result, self.business_data_store))
            if _is_ok_result(result):
                _maybe_mark_stc_search_filled(
                    self.business_data_store, label_text=label_text,
                )
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
        # P6-0/T0.3 填充校验对称：镜像回放 _try_xpath_fill 的兜底回读——JS 片段回读只按
        # xpath，填充经 label/placeholder 兜底落到别的节点时回读空、误报 false_ok actual=空
        # （录制弱通过/误败的根源）。按 label 复核真值，等值（field_values_equivalent 口径）
        # 则升级为 ok 继续记录；仍不等才保持 false_ok。
        expected_empty = _false_ok_empty_actual(result)
        if expected_empty is not None:
            try:
                raw = await page.evaluate(
                    JS_CHECK_SINGLE_FIELD,
                    [resolved.label or label_text, self._button_keywords()],
                )
                info = raw if isinstance(raw, dict) else _as_dict(raw)
                current = str((info or {}).get('currentValue') or '').strip()
                from scripts.controller.actions.form_scan_utils import field_values_equivalent
                if current and field_values_equivalent(current, expected_empty):
                    sys.stderr.write(
                        '[fill] false_ok(actual=empty) upgraded by label readback: label='
                        + repr(resolved.label or label_text)
                        + ' current=' + repr(current[:40]) + '\n'
                    )
                    sys.stderr.flush()
                    result = 'ok:label-readback'
            except Exception as _rb_exc:
                sys.stderr.write(f'[fill] label readback skipped: {_rb_exc}\n')
                sys.stderr.flush()
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
            _maybe_mark_stc_search_filled(
                self.business_data_store,
                label_text=label_text,
                resolved_label=resolved.label or "",
                placeholder=placeholder,
            )
            return _ok(_with_submit_cue(result, self.business_data_store))
        if _is_ok_result(result):
            _maybe_mark_stc_search_filled(
                self.business_data_store,
                label_text=label_text,
                resolved_label=resolved.label or "",
                placeholder=placeholder,
            )
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

    async def _fill_form_field_replay_impl(
        self,
        label_text: str,
        value: str,
        xpath_smart: str = "",
        *,
        element: dict | None = None,
        placeholder: str = "",
    ) -> str:
        """Replay fill: resolve_fill_attempt_order + JS evaluate; no record/task_done."""
        from scripts.feature_flags import relative_xpath_primary_enabled
        from ._replay import (
            _annotate_label_result,
            _classify_fill_result,
            _element_xpath_full,
            _read_value_by_label,
            _read_value_by_xpath,
        )

        page = await self.browser_context.get_current_page()
        await _wait_if_loading(page)
        await self._maybe_ensure_scanned(label_text, "replay")
        value = normalize_lat_lng_value(label_text, value)
        label = label_text
        ph = placeholder

        kind = lookup_field_kind(self.business_data_store, label_text)
        if kind not in ('tssc-multi-select', 'tree-select'):
            try:
                live = await page.evaluate(
                    '''(label) => {
                        const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
                        const want = norm(label);
                        const items = [...document.querySelectorAll('.el-form-item')];
                        let fi = null;
                        for (const it of items) {
                            const t = norm((it.querySelector('.el-form-item__label') || {}).textContent);
                            if (t && (t === want || t.includes(want))) { fi = it; break; }
                        }
                        if (!fi) return '';
                        if (fi.querySelector('.tssc-multi-select')) return 'tssc-multi-select';
                        if (fi.querySelector(
                            '.tree-popover, .tsscTree, .el-tree-select,'
                            + ' [class*="tsscmultitree"], [class*="TsscMultiTree"]'
                        )) return 'tree-select';
                        return '';
                    }''',
                    [label_text],
                )
                if live in ('tssc-multi-select', 'tree-select'):
                    kind = live
            except Exception:
                pass
        if kind == 'tssc-multi-select':
            return 'err-use-tssc-multi-select'
        if kind == 'tree-select':
            return 'err-use-select-tree-option'

        use_relative = relative_xpath_primary_enabled()
        entry = {'element': element} if isinstance(element, dict) else {}
        xp = (xpath_smart or '').strip()
        xp_src = 'element' if xp else ''
        full = _element_xpath_full(entry) if use_relative else ''
        element_xp = xp if use_relative else ''

        from .fill_dispatch import resolve_fill_attempt_order

        attempts = resolve_fill_attempt_order(
            label=label,
            placeholder=ph,
            xpath_smart=xp,
            xpath_smart_src=xp_src,
            xpath_full=full if use_relative else '',
        )

        async def _guard_xpath_fill(xp_guard: str) -> str | None:
            if not (STRICT_FILL_GUARDS and xp_guard):
                return None
            try:
                strict_raw = await page.evaluate(
                    "([expr]) => { " + PAGE_LOCATOR_HELPERS
                    + " return resolveLocatorStrict(expr, {visibleOnly:true}); }",
                    [xp_guard],
                )
                strict_info = strict_raw if isinstance(strict_raw, dict) else {}
                if strict_info.get('error'):
                    pass
                elif int(strict_info.get('effectiveCount') or 0) == 0:
                    return (
                        'strict-locator-not-found:' + xp_guard
                        + ' | 先 scan 重新获取定位，勿重试同参数'
                    )
                elif strict_info.get('ambiguous'):
                    return (
                        'ambiguous-locator:' + xp_guard
                        + ' | hits=' + str(strict_info.get('effectiveCount'))
                        + ' | ' + json.dumps(strict_info.get('samples') or [], ensure_ascii=False)[:200]
                        + ' | 需含消歧条件的定位，拒绝盲试'
                    )
            except Exception:
                pass
            try:
                overlay_raw = await page.evaluate(JS_VISIBLE_OVERLAY_OF, [xp_guard])
                overlay = overlay_raw if isinstance(overlay_raw, dict) else {}
                if (
                    overlay.get('overlayPresent')
                    and overlay.get('targetFound')
                    and not overlay.get('targetInsideOverlay')
                ):
                    return (
                        'fill-outside-overlay | 目标在可见弹层「'
                        + str(overlay.get('overlayLabel'))
                        + '」之外，已拒绝。若确要填底层页面字段，先关闭弹层再填'
                    )
            except Exception:
                pass
            return None

        async def _try_xpath_fill(xpath: str, locate_src: str, hint: str) -> str | None:
            if xpath:
                guard_err = await _guard_xpath_fill(xpath)
                if guard_err:
                    return guard_err
            result = await page.evaluate(JS_FILL_BY_XPATH, [xpath, value, hint])
            expected_empty = _false_ok_empty_actual(result)
            if expected_empty is not None:
                try:
                    raw = await page.evaluate(
                        JS_CHECK_SINGLE_FIELD,
                        [label, self._button_keywords()],
                    )
                    info = raw if isinstance(raw, dict) else _as_dict(raw)
                    current = str((info or {}).get('currentValue') or '').strip()
                    if current and field_values_equivalent(current, expected_empty):
                        sys.stderr.write(
                            '[fill-replay] false_ok(actual=empty) upgraded by label readback: label='
                            + repr(label)
                            + ' current=' + repr(current[:40]) + '\n'
                        )
                        sys.stderr.flush()
                        result = 'ok:label-readback'
                except Exception as _rb_exc:
                    sys.stderr.write(f'[fill-replay] label readback skipped: {_rb_exc}\n')
                    sys.stderr.flush()
            action_ok = isinstance(result, str) and result.startswith('ok')
            actual = await _read_value_by_xpath(page, xpath, hint) if (xpath and action_ok) else ''
            if action_ok and not actual:
                actual = await _read_value_by_label(page, label, ph)
            classified = _classify_fill_result(action_ok, value, actual)
            if classified == 'ok':
                await page.wait_for_timeout(WAIT_300_MS)
                return f'ok:locate={locate_src}'
            if classified.startswith('false_ok'):
                await page.wait_for_timeout(WAIT_300_MS)
                return classified
            return None

        result = 'label-not-found'
        for att in attempts:
            if att.js_kind == 'by_xpath':
                if not att.xpath:
                    result = await page.evaluate(JS_FILL_BY_XPATH, ['', value, att.hint])
                    if isinstance(result, str) and result.startswith('ok'):
                        await page.wait_for_timeout(WAIT_300_MS)
                        return str(result)
                    continue
                xpath_result = await _try_xpath_fill(att.xpath, att.locate_src, att.hint)
                if xpath_result:
                    return xpath_result
                continue
            result = await page.evaluate(JS_FILL_FORM_FIELD, [att.hint, value])
            if isinstance(result, str) and result.startswith('ok'):
                await page.wait_for_timeout(WAIT_300_MS)
                if element_xp:
                    actual = await _read_value_by_xpath(page, element_xp, label)
                    classified = _classify_fill_result(True, value, actual)
                    if classified.startswith('false_ok'):
                        return classified
                    if classified == 'ok':
                        return 'ok:locate=label'
                return _annotate_label_result(str(result))

        final = _annotate_label_result(str(result))
        if is_absent_field_result(final) or is_absent_field_result(result):
            sys.stderr.write(
                f'[fill-replay] skip absent label={label!r} result={result!r}\n'
            )
            sys.stderr.flush()
            return absent_field_skip_result()
        return final

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

