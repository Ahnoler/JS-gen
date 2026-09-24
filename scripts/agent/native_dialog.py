"""Parse a native-dialog reply and build the step-feedback item."""
from __future__ import annotations

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
