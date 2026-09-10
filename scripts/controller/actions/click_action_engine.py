"""ClickEngine: click_element_by_index / click_button record+replay (Phase B)."""

from .replay_click import _replay_click_by_index


class ClickEngine:
    @classmethod
    async def click_element_by_index_for_replay(
        cls,
        page,
        entry: dict,
        params: dict,
    ) -> str:
        """Replay durable click; ignores ephemeral highlight index."""
        return await _replay_click_by_index(page, entry or {}, params or {})

    @classmethod
    async def click_button_for_replay(
        cls,
        page,
        entry: dict,
        params: dict,
    ) -> str:
        """Replay click_button via same durable path (params already text-mapped)."""
        return await _replay_click_by_index(page, entry or {}, params or {})
