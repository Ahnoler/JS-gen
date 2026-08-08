"""
Controller: Element UI custom actions for browser_use.

Thin facade — re-exports all public symbols from submodules
for backward compatibility with existing callers
(session_runner, recorder, agent_utils).

``build_controller`` is bound lazily (PEP 562): during the module→package
migration its transitive dependencies pass through compatibility shims that
import back into this package, so an eager binding at init time would cycle.
All consumer forms (`from scripts.controller import build_controller`,
``scripts.controller.build_controller``, ``import *``, ``dir()``) behave
identically to an eager binding.
"""
from scripts.state import _ACTION_LOG, _TRAJECTORY_URL, _ACTION_TO_COMMAND, _record_action

__all__ = [
    'build_controller',
    '_ACTION_LOG',
    '_TRAJECTORY_URL',
    '_ACTION_TO_COMMAND',
    '_record_action',
]


def __getattr__(name):
    if name == 'build_controller':
        from .service import build_controller
        return build_controller
    raise AttributeError(f'module {__name__!r} has no attribute {name!r}')


def __dir__():
    return sorted(set(globals()) | {'build_controller'})
