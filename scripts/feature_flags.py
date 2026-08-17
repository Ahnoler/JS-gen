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


def xpath_smart_fill_only_enabled() -> bool:
    """XPATH_SMART_FILL_ONLY — grayscale: fill/select write path requires xpath_smart (default off).

    When false (default): testers keep label-DOM fallback if scan/resolve miss xpath.
    When true: ``fill_form_field`` / similar refuse label-only fill — xpath_smart required.
    """
    return _env_flag('XPATH_SMART_FILL_ONLY', False)


def phase_preamble_enabled() -> bool:
    """AI_PHASE_PREAMBLE — assemble 【业务场景】 prior-phase block (default on)."""
    return _env_flag('AI_PHASE_PREAMBLE', True)


def memory_whitelist_enabled() -> bool:
    """AI_MEMORY_WHITELIST — ActionResult.include_in_memory on critical actions (default on)."""
    return _env_flag('AI_MEMORY_WHITELIST', True)


def scenario_describer_enabled() -> bool:
    """AI_SCENARIO_DESCRIBER — inject business-scenario summary at agent step start (default on)."""
    return _env_flag('AI_SCENARIO_DESCRIBER', True)


def phase_intent_contract_enabled() -> bool:
    """AI_PHASE_INTENT_CONTRACT — phase intent hard contract for AI recording (default on)."""
    return _env_flag('AI_PHASE_INTENT_CONTRACT', True)


def phase_boundary_enabled() -> bool:
    """AI_PHASE_BOUNDARY — loose phase boundary completion contract (default on).

    When on (default), recording uses ``_phase_boundary`` as authority; legacy
    ``_phase_intent`` is adapted from it. Set ``AI_PHASE_BOUNDARY=off`` to
    fall back to the pre-boundary intent contract only.
    """
    return _env_flag('AI_PHASE_BOUNDARY', True)


def scenario_describer_interval() -> int:
    """SCENARIO_DESCRIBER_INTERVAL — run scenario LLM every N agent micro-steps (default 3)."""
    raw = os.environ.get('SCENARIO_DESCRIBER_INTERVAL')
    if raw is None or str(raw).strip() == '':
        return 3
    try:
        n = int(str(raw).strip())
    except (TypeError, ValueError):
        return 3
    return n if n >= 1 else 3

def memory_events_enabled() -> bool:
    """AI_MEMORY_EVENTS — 记忆事件旁路摄取（默认开，只写不读）。"""
    return _env_flag('AI_MEMORY_EVENTS', True)


def memory_fact_pack_enabled() -> bool:
    """AI_MEMORY_FACT_PACK — 事实包注入（P1，默认关）。"""
    return _env_flag('AI_MEMORY_FACT_PACK', True)


def memory_decisions_enabled() -> bool:
    """AI_MEMORY_DECISIONS — LLM 决策记录（默认开）。"""
    return _env_flag('AI_MEMORY_DECISIONS', True)


def memory_audit_strict_enabled() -> bool:
    """AI_MEMORY_AUDIT_STRICT — 审计严格模式（默认关）。"""
    return _env_flag('AI_MEMORY_AUDIT_STRICT', False)


def phase_reviewer_enabled() -> bool:
    """AI_PHASE_REVIEWER — per-phase LLM contract (default on)."""
    return _env_flag('AI_PHASE_REVIEWER', True)


def phase_reviewer_timeout_s() -> float:
    raw = os.environ.get('AI_PHASE_REVIEWER_TIMEOUT_S')
    if raw is None or str(raw).strip() == '':
        return 20.0
    try:
        return max(1.0, float(str(raw).strip()))
    except (TypeError, ValueError):
        return 20.0


def form_batch_heartbeat_enabled() -> bool:
    """AI_FORM_BATCH_HEARTBEAT — 表单批量 LLM 生成期间发 form_batch_started/done 占位事件（默认开）。

    100+ 表单项的长批量生成会让 WS 链路长时间空闲，易被 NAT/LB 空闲回收掐成半开连接
    （executor 侧 readyState 仍 OPEN、事件进黑洞）。占位事件保持事件流活跃，
    从源头降低 WS 空闲回收触发概率。
    """
    return _env_flag('AI_FORM_BATCH_HEARTBEAT', True)

def duplicate_failure_cue_enabled() -> bool:
    """AI_DUP_FAILURE_CUE — inject [纠偏] cue on repeated identical failed actions (default off)."""
    return _env_flag('AI_DUP_FAILURE_CUE', False)

def click_nav_cue_enabled() -> bool:
    """AI_CLICK_NAV_CUE — inject [导航] cue when an index click navigated to a new page (default on)."""
    return _env_flag('AI_CLICK_NAV_CUE', True)
