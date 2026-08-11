"""
Controller builder: factory function that assembles all action groups
into a single browser_use Controller instance.
"""

import functools
import inspect

from .actions._case_data import _register_case_data_actions
from .actions._form import _register_form_actions
from .actions._navigation import _register_navigation_actions
from .actions._table import _register_table_actions
from .actions._misc import _register_misc_actions
from .actions._special_element import _register_special_element_actions
from ..state import (
    _ACTION_LOG,
    capture_page_png_b64,
    capture_screenshots_enabled,
    emit_step_screenshot,
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
                before_b64 = None
                try:
                    before_b64 = await capture_page_png_b64(browser_context)
                except Exception:
                    before_b64 = None

                result = await func(*args, **kwargs)

                if len(_ACTION_LOG) <= len_before:
                    return result

                after_b64 = None
                try:
                    after_b64 = await capture_page_png_b64(browser_context)
                except Exception:
                    after_b64 = None

                entry_id = None
                try:
                    entry_id = (_ACTION_LOG[-1] or {}).get('id')
                except Exception:
                    entry_id = None
                if entry_id:
                    emit_step_screenshot(str(entry_id), before_b64, after_b64)
                return result

            # functools.wraps copies __annotations__ but not a bound Signature;
            # set explicitly so pydantic / browser-use see real params.
            wrapped.__signature__ = orig_sig
            return register(wrapped)

        return decorator

    controller.action = action_decorator


def build_controller(browser_context, case_data_store=None,
                     llm=None, exclude_actions=None,
                     special_element_candidates_store=None):
    """Build and return a browser_use Controller with all custom actions registered."""
    from browser_use import Controller
    if exclude_actions is None:
        exclude_actions = ['input_text', 'select_dropdown_option']
    controller = Controller(exclude_actions=exclude_actions)

    if case_data_store is None:
        case_data_store = {}
    if special_element_candidates_store is None:
        special_element_candidates_store = {}

    _wrap_action_with_screenshots(controller, browser_context)

    _register_case_data_actions(controller, case_data_store)
    _register_form_actions(controller, browser_context, case_data_store, llm)
    _register_navigation_actions(controller, browser_context)
    _register_table_actions(controller, browser_context, case_data_store)
    _register_misc_actions(controller, browser_context, case_data_store)
    _register_special_element_actions(
        controller,
        browser_context,
        case_data_store,
        special_element_candidates_store,
    )

    return controller
