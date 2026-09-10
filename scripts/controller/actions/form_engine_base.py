"""Shared base + replay adapters for extracted form action engines (split from form_action_engines.py)."""


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

    async def _maybe_ensure_scanned(self, label_text: str, mode: str = "record"):
        """Record: full ensure_scanned. Replay: only if store already warm."""
        if mode != "replay":
            await self._ensure_scanned(label_text)
            return
        store = self.business_data_store or {}
        if store.get("_scan_fields") or store.get("task_list"):
            await self._ensure_scanned(label_text)


class _ReplayPageAdapter:
    """Minimal browser_context for page-only replay (no full agent session)."""

    def __init__(self, page):
        self._page = page

    async def get_current_page(self):
        return self._page


class _ReplayAutofillStub:
    """No-op autofill for replay-only engine construction."""

    async def ensure_scanned(self, label_text: str, *, allow_autofill: bool = False):
        pass


def _replay_engine_store(business_data_store: dict | None) -> dict:
    return business_data_store if isinstance(business_data_store, dict) else {}
