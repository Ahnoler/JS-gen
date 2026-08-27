"""
Controller builder: factory function that assembles all action groups
into a single browser_use Controller instance.
"""

import functools
import inspect

from .actions._business_data import _register_business_data_actions
from .actions._form import _register_form_actions
from .actions._navigation import _register_navigation_actions
from .actions._table import _register_table_actions
from .actions._misc import _register_misc_actions
from .actions._special_element import _register_special_element_actions
from ..state import (
    _ACTION_LOG,
    _CURRENT_PHASE,
    _is_overlay_region,
    capture_dialog_png_b64,
    capture_page_dims_from_page,
    capture_page_png_b64,
    capture_screenshots_enabled,
    current_page_level,
    emit_step_screenshot,
    register_page_screenshot_if_changed,
    register_popup_screenshot,
    request_phase_shot_candidate,
    set_current_page_key,
    should_skip_screenshot_action,
)


def _wrap_action_with_screenshots(controller, browser_context):
    """Wrap controller.action so registered funcs capture before/after PNGs.

    AI agent and CDP watcher both invoke the same act.function, so one wrap
    covers both recording paths.

    Critical: preserve the original callable signature. browser-use builds
    Pydantic param models from inspect.signature; a bare (*args, **kwargs)
    wrapper yields inspect._empty and crashes Agent creation with
    PydanticInvalidForJsonSchema.
    """
    original_action = controller.action

    def action_decorator(*d_args, **d_kwargs):
        register = original_action(*d_args, **d_kwargs)

        def decorator(func):
            action_name = getattr(func, '__name__', '') or ''
            orig_sig = inspect.signature(func)

            @functools.wraps(func)
            async def wrapped(*args, **kwargs):
                if (
                    not capture_screenshots_enabled()
                    or should_skip_screenshot_action(action_name)
                ):
                    return await func(*args, **kwargs)

                len_before = len(_ACTION_LOG)
                before_key = ''
                before_name = ''
                before_b64 = None
                try:
                    before_key, before_name = await current_page_level(browser_context)
                except Exception:
                    before_key, before_name = '', ''
                set_current_page_key(before_key)
                before_dims = {}
                try:
                    before_b64 = await capture_page_png_b64(browser_context)
                    _page = await browser_context.get_current_page()
                    if _page is not None:
                        before_dims = await capture_page_dims_from_page(_page)
                except Exception:
                    before_b64 = None

                pre_dialog_b64, pre_dialog_meta = None, None
                if action_name == 'close_dialog':
                    pre_dialog_b64, pre_dialog_meta = await capture_dialog_png_b64(browser_context)
                    if pre_dialog_b64:
                        pre_dialog_meta = dict(pre_dialog_meta or {})
                        pre_dialog_meta['capturedAt'] = 'before-close'
                        await register_popup_screenshot(
                            browser_context,
                            page_key=before_key or '',
                            dialog_title=(pre_dialog_meta or {}).get('dialogTitle') or '',
                            anchor_xpath=(pre_dialog_meta or {}).get('anchorXpath') or '',
                            dialog_b64=pre_dialog_b64,
                            dialog_meta=pre_dialog_meta,
                        )

                # 提交类动作（click_save）：执行前按当前状态键请求控制面采集状态组图
                # （触发集 = 状态键变化 ∪ click_save 执行前；同状态内普通填值不触发采集）。
                if action_name == 'click_save':
                    # 事件协议见 scripts/state.py request_phase_shot_candidate —
                    # 'phase_shot_candidate_request' → 'phase_shot_candidate_result'。
                    try:
                        await request_phase_shot_candidate(before_key, int(_CURRENT_PHASE or 0))
                    except Exception:
                        pass

                result = await func(*args, **kwargs)

                if len(_ACTION_LOG) <= len_before:
                    return result

                after_b64 = None
                try:
                    after_b64 = await capture_page_png_b64(browser_context)
                except Exception:
                    after_b64 = None

                after_key, after_name = await register_page_screenshot_if_changed(
                    browser_context,
                    before_key=before_key,
                    before_name=before_name,
                    before_b64=before_b64,
                    before_dims=before_dims,
                )

                entry_id = None
                try:
                    entry_id = (_ACTION_LOG[-1] or {}).get('id')
                except Exception:
                    entry_id = None
                dialog_b64 = pre_dialog_b64
                dialog_meta = pre_dialog_meta
                if entry_id:
                    last_entry = _ACTION_LOG[-1] or {}
                    el = last_entry.get('element') or {}
                    if action_name != 'close_dialog' and _is_overlay_region(el.get('region_id')):
                        dialog_b64, dialog_meta = await capture_dialog_png_b64(browser_context)
                        await register_popup_screenshot(
                            browser_context,
                            page_key=after_key or before_key,
                            dialog_title=(dialog_meta or {}).get('dialogTitle') or '',
                            anchor_xpath=(dialog_meta or {}).get('anchorXpath') or '',
                            dialog_b64=dialog_b64,
                            dialog_meta=dialog_meta,
                        )
                    emit_step_screenshot(str(entry_id), before_b64, after_b64, dialog_b64, dialog_meta)
                # 状态键上报（fire-and-forget，不带 bytes）：Node 按 beforeKey 归组、
                # afterKey 变化时预采下一组，供后续步骤直接命中。
                try:
                    from ..agent_utils import emit_json
                    emit_json({
                        "event": "phase_state_key",
                        "data": {
                            "phase": int(_CURRENT_PHASE or 0),
                            "entryId": str(entry_id) if entry_id else '',
                            "beforeKey": before_key,
                            "afterKey": after_key,
                        },
                    })
                except Exception:
                    pass
                return result

            # functools.wraps copies __annotations__ but not a bound Signature;
            # set explicitly so pydantic / browser-use see real params.
            wrapped.__signature__ = orig_sig
            return register(wrapped)

        return decorator

    controller.action = action_decorator


def build_controller(browser_context, business_data_store=None,
                     llm=None, exclude_actions=None,
                     special_element_candidates_store=None):
    """Build and return a browser_use Controller with all custom actions registered."""
    from browser_use import Controller
    if exclude_actions is None:
        exclude_actions = ['input_text', 'select_dropdown_option']
    controller = Controller(exclude_actions=exclude_actions)

    if business_data_store is None:
        business_data_store = {}
    if special_element_candidates_store is None:
        special_element_candidates_store = {}

    _wrap_action_with_screenshots(controller, browser_context)

    _register_business_data_actions(controller, business_data_store)
    _register_form_actions(controller, browser_context, business_data_store, llm)
    _register_navigation_actions(controller, browser_context)
    _register_table_actions(controller, browser_context, business_data_store)
    _register_misc_actions(controller, browser_context, business_data_store)
    _register_special_element_actions(
        controller,
        browser_context,
        business_data_store,
        special_element_candidates_store,
    )

    return controller
