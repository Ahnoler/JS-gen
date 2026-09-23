"""Fail-open viewport question for the recording side path.

The main agent stays text-only. This module sends one image on a separate
call and returns '' when the model or the network cannot look at it.
"""
from __future__ import annotations

import asyncio
import sys

_PROBE_PNG = (
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
)
_supported: bool | None = None


def model_blocks_vision(model_name: str) -> bool:
    """browser-use turns vision off for these names, so the side path does too."""
    name = str(model_name or '').lower()
    return 'deepseek' in name or 'grok' in name


def _model_name(llm) -> str:
    return str(getattr(llm, 'model_name', None) or getattr(llm, 'model', '') or '')


async def vision_supported(llm) -> bool:
    """Probe once per process. A failed probe disables later image calls."""
    global _supported
    if _supported is not None:
        return _supported
    if llm is None or model_blocks_vision(_model_name(llm)):
        _supported = False
        if llm is not None:
            sys.stderr.write(
                f"[record-vision] skipped, model blocks vision: {_model_name(llm)}\n"
            )
            sys.stderr.flush()
        return False
    try:
        from langchain_core.messages import HumanMessage

        await asyncio.wait_for(
            llm.ainvoke([HumanMessage(content=[
                {'type': 'text', 'text': 'reply ok'},
                {'type': 'image_url', 'image_url': {'url': f'data:image/png;base64,{_PROBE_PNG}'}},
            ])]),
            timeout=15,
        )
        _supported = True
    except Exception as exc:
        _supported = False
        sys.stderr.write(f"[record-vision] probe failed, text-only: {exc}\n")
        sys.stderr.flush()
    return _supported


async def ask_vision(llm, png_b64: str, question: str) -> str:
    """Return the model text, or '' when vision is unavailable or this call fails."""
    if not png_b64 or not question:
        return ''
    if not await vision_supported(llm):
        return ''
    try:
        from langchain_core.messages import HumanMessage

        response = await asyncio.wait_for(
            llm.ainvoke([HumanMessage(content=[
                {'type': 'text', 'text': question},
                {'type': 'image_url', 'image_url': {'url': f'data:image/png;base64,{png_b64}'}},
            ])]),
            timeout=20,
        )
    except Exception as exc:
        sys.stderr.write(f"[record-vision] ask failed, ignored: {exc}\n")
        sys.stderr.flush()
        return ''
    return str(getattr(response, 'content', '') or '')


def reset_vision_probe_for_tests() -> None:
    """Clear the process cache. Characterization only."""
    global _supported
    _supported = None
