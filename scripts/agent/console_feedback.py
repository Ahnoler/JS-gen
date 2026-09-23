"""Per-session ring of console and pageerror lines for the next step cue."""
from __future__ import annotations

from scripts.agent.step_feedback import clip_text

RING_MAX = 20
_RING = "_step_console_ring"
_SEQ = "_step_console_seq"
_CURSOR = "_step_console_cursor"


def push_console_line(store: dict | None, *, level: str, text: str) -> None:
    """Append one clipped console line. Blank text is ignored."""
    if not isinstance(store, dict):
        return
    clipped = clip_text(text)
    if not clipped:
        return
    seq = int(store.get(_SEQ) or 0) + 1
    store[_SEQ] = seq
    ring = store.setdefault(_RING, [])
    ring.append({"seq": seq, "level": str(level or "error"), "text": clipped})
    if len(ring) > RING_MAX:
        del ring[:-RING_MAX]


def take_console_feedback(store: dict | None) -> list[dict]:
    """Return console lines newer than the cursor, then advance the cursor."""
    if not isinstance(store, dict):
        return []
    ring = store.get(_RING) or []
    cursor = int(store.get(_CURSOR) or 0)
    fresh: list[dict] = []
    newest = cursor
    for row in ring:
        if not isinstance(row, dict):
            continue
        seq = int(row.get("seq") or 0)
        if seq <= cursor:
            continue
        if seq > newest:
            newest = seq
        fresh.append({
            "kind": "console",
            "level": str(row.get("level") or "error"),
            "text": str(row.get("text") or ""),
        })
    store[_CURSOR] = newest
    return fresh
