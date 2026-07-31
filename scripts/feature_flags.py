"""Feature flags for agent / recorder / replay (env-driven grayscale).

All Python-side boolean behavior toggles live here. Node mirrors that need
control-plane awareness (e.g. RELATIVE_XPATH_PRIMARY) are also exported from
``config/config.js``. Set values via process env or ``config/.env``.

Bool parsing: unset → default; ``false`` / ``0`` / ``off`` / ``no`` → False;
anything else → True.
"""

from __future__ import annotations

import os


def _env_flag(name: str, default: bool = True) -> bool:
    raw = os.environ.get(name)
    if raw is None or str(raw).strip() == '':
        return default
    return str(raw).strip().lower() not in ('0', 'false', 'no', 'off')


def relative_xpath_primary_enabled() -> bool:
    """RELATIVE_XPATH_PRIMARY — smart relative xpath as primary locator (default on).

    When false: primary falls back to absolute ``xpath_full``; ``xpath_smart``
    is still stored in candidates. Replay skips xpath_smart-first.
    """
    return _env_flag('RELATIVE_XPATH_PRIMARY', True)


def phase_preamble_enabled() -> bool:
    """AI_PHASE_PREAMBLE — assemble 【业务场景】 prior-phase block (default on)."""
    return _env_flag('AI_PHASE_PREAMBLE', True)


def memory_whitelist_enabled() -> bool:
    """AI_MEMORY_WHITELIST — ActionResult.include_in_memory on critical actions (default on)."""
    return _env_flag('AI_MEMORY_WHITELIST', True)
