"""RadioEngine — split from form_action_engines.py (S6)."""

import sys

from scripts.state import _record_action
from ._helpers import (
    _ok, _err, _is_ok_result,
    is_absent_field_result, absent_field_skip_result,
    _wait_if_loading, _capture_element, stamp_recorded_xpath_smart,
)
from ._js_snippets import JS_CLICK_RADIO, JS_CLICK_RADIO_BY_XPATH
from .form_engine_base import _FormActionEngineBase
from .form_scan_utils import _resolve_control, lookup_field_kind, _is_query_mode, _with_submit_cue, _task_done_impl


def _unwrap_action_result(result) -> str:
    if hasattr(result, "extracted_content"):
        return str(result.extracted_content)
    return str(result)


class RadioEngine(_FormActionEngineBase):
    @classmethod
    async def click_radio_for_replay(
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
        return await engine.click_radio(
            label_text,
            option_text,
            xpath_smart,
            mode="replay",
        )

    async def click_radio(
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
        if resolved.error:
            err = resolved.error
            if is_replay:
                return _unwrap_action_result(err) if not isinstance(err, str) else str(err)
            return err
        label_resolved = resolved.label
        xp = (resolved.xpath_smart or "").strip()
        element = await _capture_element(
            page, label_resolved, target_kind='form_radio', xpath_smart=xp,
        )

        if xp:
            result = await page.evaluate(JS_CLICK_RADIO_BY_XPATH, [xp, option_text])
            if is_absent_field_result(result) or _is_ok_result(result):
                pass
            else:
                result = await page.evaluate(JS_CLICK_RADIO, [label_resolved, option_text])
        else:
            result = await page.evaluate(JS_CLICK_RADIO, [label_resolved, option_text])

        if is_absent_field_result(result):
            if is_replay:
                sys.stderr.write(f'[form] skip absent radio label={label_resolved!r}\n')
                sys.stderr.flush()
                return absent_field_skip_result()
            if not _is_query_mode(self.business_data_store):
                _task_done_impl(label_resolved, self.business_data_store)
            sys.stderr.write(f'[form] skip absent radio label={label_resolved!r}\n')
            sys.stderr.flush()
            return _ok(_with_submit_cue(absent_field_skip_result(), self.business_data_store))

        if _is_ok_result(result):
            if is_replay:
                return str(result)
            xp_inv = stamp_recorded_xpath_smart(element, xp)
            _record_action(
                'click_radio',
                {
                    'label_text': label_resolved,
                    'option_text': option_text,
                },
                result,
                element=element,
            )
            _task_done_impl(
                label_resolved, self.business_data_store, value=option_text, xpath_smart=xp_inv,
            )
            return _ok(result)
        if is_replay:
            return str(result)
        return result

