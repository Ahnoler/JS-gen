"""
Controller builder: factory function that assembles all action groups
into a single browser_use Controller instance.
"""

from ._case_data import _register_case_data_actions
from ._form import _register_form_actions
from ._navigation import _register_navigation_actions
from ._table import _register_table_actions
from ._misc import _register_misc_actions
from ._state import (
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
    """
    original_action = controller.action

    def action_decorator(*d_args, **d_kwargs):
        register = original_action(*d_args, **d_kwargs)

        def decorator(func):
            action_name = getattr(func, '__name__', '') or ''

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

            wrapped.__name__ = getattr(func, '__name__', 'wrapped')
            wrapped.__doc__ = getattr(func, '__doc__', None)
            wrapped.__qualname__ = getattr(func, '__qualname__', wrapped.__name__)
            # Preserve pydantic / browser_use metadata if present
            for attr in ('__annotations__', '__signature__', '__module__'):
                if hasattr(func, attr):
                    try:
                        setattr(wrapped, attr, getattr(func, attr))
                    except Exception:
                        pass
            return register(wrapped)

        return decorator

    controller.action = action_decorator


def build_controller(browser_context, form_rules, case_data_store=None,
                     llm=None, exclude_actions=None):
    """Build and return a browser_use Controller with all custom actions registered."""
    from browser_use import Controller
    if exclude_actions is None:
        exclude_actions = ['input_text', 'select_dropdown_option']
    controller = Controller(exclude_actions=exclude_actions)

    if case_data_store is None:
        case_data_store = {}

    _wrap_action_with_screenshots(controller, browser_context)

    _register_case_data_actions(controller, case_data_store)
    _register_form_actions(controller, browser_context, form_rules, case_data_store, llm)
    _register_navigation_actions(controller, browser_context)
    _register_table_actions(controller, browser_context)
    _register_misc_actions(controller, browser_context, case_data_store)

    return controller
