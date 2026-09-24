"""Parse a native-dialog reply and build the step-feedback item."""
from __future__ import annotations

import asyncio
import re

from scripts.agent.step_feedback import clip_text

ASK_TIMEOUT_SEC = 20
EMPTY_DIALOG_TEXT = "（无文案）"
_ANSWER = re.compile(r"^(accept|dismiss)(?::(.*))?$", re.IGNORECASE)


def parse_dialog_answer(raw: str) -> tuple[str, str] | None:
    """Return (action, suffix) for the first non-empty line, or None."""
    for line in str(raw or "").splitlines():
        line = line.strip()
        if not line:
            continue
        match = _ANSWER.match(line)
        if not match:
            return None
        suffix = match.group(2)
        return match.group(1).lower(), "" if suffix is None else suffix
    return None


def dialog_display_text(message: str) -> str:
    """Blank messages become a visible placeholder so the cue is not dropped."""
    text = clip_text(message)
    return text or EMPTY_DIALOG_TEXT


def native_dialog_item(dialog_type: str, message: str, decision: str, value: str = "") -> dict:
    """One step-feedback row for a native browser dialog."""
    return {
        "kind": "dialog",
        "surface": str(dialog_type or "alert"),
        "text": dialog_display_text(message),
        "decision": str(decision or "accepted"),
        "value": "" if value is None else str(value),
    }


_PENDING = "_native_dialog_pending"


def push_native_dialog(store: dict | None, item: dict) -> None:
    if not isinstance(store, dict) or not item:
        return
    store.setdefault(_PENDING, []).append(item)


def take_native_dialogs(store: dict | None) -> list[dict]:
    if not isinstance(store, dict):
        return []
    rows = list(store.get(_PENDING) or [])
    store[_PENDING] = []
    return rows


async def apply_native_dialog(dialog, store, ask) -> None:
    """Accept, dismiss, or timeout-accept one Playwright dialog and queue feedback."""
    dtype = str(getattr(dialog, "type", "") or "")
    raw_message = str(getattr(dialog, "message", "") or "")
    default_value = str(getattr(dialog, "default_value", "") or "")
    if dtype in ("alert", "beforeunload"):
        await dialog.accept()
        push_native_dialog(store, native_dialog_item(dtype, raw_message, "accepted"))
        return
    if dtype not in ("confirm", "prompt"):
        await dialog.accept()
        push_native_dialog(store, native_dialog_item(dtype or "alert", raw_message, "accepted"))
        return
    try:
        if ask is None:
            raise TimeoutError("no dialog ask callback")
        raw = await asyncio.wait_for(
            ask(dtype, raw_message, default_value),
            timeout=ASK_TIMEOUT_SEC,
        )
        parsed = parse_dialog_answer(raw)
        if parsed is None:
            raise ValueError("unparsed dialog answer")
        action, suffix = parsed
        if action == "dismiss":
            await dialog.dismiss()
            push_native_dialog(store, native_dialog_item(dtype, raw_message, "dismissed"))
            return
        if dtype == "prompt":
            await dialog.accept(suffix)
            push_native_dialog(
                store, native_dialog_item(dtype, raw_message, "accepted", suffix)
            )
            return
        await dialog.accept()
        push_native_dialog(store, native_dialog_item(dtype, raw_message, "accepted"))
    except Exception:
        if dtype == "prompt":
            await dialog.accept(default_value)
        else:
            await dialog.accept()
        push_native_dialog(store, native_dialog_item(dtype, raw_message, "timeout-accepted"))
