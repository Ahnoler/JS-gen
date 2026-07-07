"""
Global application state — replaces src/state.js.
"""
from typing import Optional, Dict, Any


class GlobalBrowser:
    def __init__(self):
        self.process = None
        self.stdin = None
        self.ready = False
        self.busy = False
        self.step_index = 0


class AppState:
    def __init__(self):
        self.default_model: Optional[Dict[str, str]] = None
        self.global_browser = GlobalBrowser()


# Single module-level instance (like state.js module)
state = AppState()
