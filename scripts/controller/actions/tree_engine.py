"""TreeEngine — split from form_action_engines.py (S7)."""

from scripts.state import _record_action
from ._helpers import (
    _ok, _err, _is_ok_result,
    _wait_if_loading, _capture_element, stamp_recorded_xpath_smart,
)
from ._js_snippets import (
    JS_FILL_FORM_FIELD, JS_FILL_BY_XPATH,
    JS_SELECT_TREE_OPTION, JS_EXPAND_ALL_EL_TREE,
)
from .form_engine_base import _FormActionEngineBase, _ReplayAutofillStub, _ReplayPageAdapter, _replay_engine_store
from .form_scan_utils import _resolve_control, _task_done_impl
from .replay_timing import WAIT_500_MS

class TreeEngine(_FormActionEngineBase):
    @classmethod
    async def select_tree_option_for_replay(
        cls,
        page,
        label_text: str,
        option_text: str,
        *,
        xpath_smart: str = "",
        business_data_store: dict | None = None,
    ):
        """Replay entry: construct engine with page adapter and run mode=replay."""
        store = _replay_engine_store(business_data_store)
        bc = _ReplayPageAdapter(page)
        autofill = _ReplayAutofillStub()
        engine = cls(bc, store, autofill)
        return await engine.select_tree_option(
            label_text,
            option_text,
            xpath_smart,
            mode="replay",
        )

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


    async def select_tree_option(
        self,
        label_text: str,
        option_text: str,
        xpath_smart: str = "",
        *,
        mode: str = "record",
    ):
        is_replay = mode == "replay"
        page = await self.browser_context.get_current_page()
        await _wait_if_loading(page)
        await self._maybe_ensure_scanned(label_text, mode)
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
            if is_replay:
                return str(result)
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
                    if is_replay:
                        return str(fill_result)
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
