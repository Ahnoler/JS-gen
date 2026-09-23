"""Session-only record of page feedback produced by one agent step."""
from __future__ import annotations

import json
import re

TEXT_MAX = 200
HISTORY_MAX = 40
_STORE_KEY = "_step_feedback"

_OBSERVE_ACTIONS = frozenset({
    "semantic_snapshot",
    "read_error_notify",
    "read_xhr_log",
    "read_step_feedback",
    "read_business_date",
    "kb_flow",
    "verify_context",
    "get_page_state",
    "scan_form_fields",
    "scan_visible_fields",
    "scan_editable_summary",
    "done",
})

_WS = re.compile(r"\s+")


def clip_text(value) -> str:
    text = _WS.sub(" ", str(value or "")).strip()
    return text[:TEXT_MAX]


def business_action_names(raw_actions) -> list[str]:
    names: list[str] = []
    for raw in raw_actions or []:
        data = raw
        if hasattr(raw, "model_dump"):
            data = raw.model_dump()
        elif hasattr(raw, "dict"):
            data = raw.dict()
        if not isinstance(data, dict):
            continue
        for key, val in data.items():
            if val is None:
                continue
            if key not in _OBSERVE_ACTIONS:
                names.append(str(key))
            break
    return names


def omit_api_if_ui(items: list[dict]) -> list[dict]:
    has_ui = any(it.get("kind") in ("toast", "form") for it in items or [])
    if not has_ui:
        return list(items or [])
    return [it for it in items if it.get("kind") != "api"]


def format_step_feedback_cue(actions: list[str], items: list[dict]) -> str:
    if not items:
        return ""
    head = actions[-1] if actions else "step"
    parts: list[str] = []
    for it in items[:8]:
        kind = it.get("kind")
        text = clip_text(it.get("text"))
        if not text:
            continue
        if kind == "toast":
            level = {"error": "err", "success": "ok"}.get(str(it.get("level") or ""), "info")
            parts.append(f"toast:{level}:{text}")
        elif kind == "form":
            parts.append(f"form:{clip_text(it.get('label'))}:{text}")
        elif kind == "dialog":
            surface = it.get("surface") if it.get("surface") in ("dialog", "drawer") else "dialog"
            parts.append(f"{surface}:{text}")
        elif kind == "api":
            parts.append(f"api:{text}")
        elif kind == "console":
            level = "pageerror" if str(it.get("level") or "") == "pageerror" else "err"
            parts.append(f"console:{level}:{text}")
    if not parts:
        return ""
    return f"[step-feedback] {head} | " + "；".join(parts)


def append_step_feedback(store: dict, step: int, actions: list[str], items: list[dict]) -> None:
    if store is None or not items:
        return
    rows = store.setdefault(_STORE_KEY, [])
    rows.append({
        "step": int(step),
        "actions": list(actions),
        "items": list(items),
    })
    if len(rows) > HISTORY_MAX:
        del rows[:-HISTORY_MAX]


def read_step_feedback_rows(store: dict | None, last: int = 5) -> list[dict]:
    rows = []
    if isinstance(store, dict):
        raw = store.get(_STORE_KEY)
        if isinstance(raw, list):
            rows = raw
    try:
        n = int(last)
    except (TypeError, ValueError):
        n = 5
    if n < 1:
        n = 1
    return list(rows[-n:])


def extract_api_error_text(body: str, status: int | None) -> str:
    try:
        payload = json.loads(body) if body else None
    except (TypeError, ValueError):
        payload = None
    if not isinstance(payload, dict):
        return ""
    code = payload.get("code")
    biz_fail = code is not None and str(code) not in ("0", "200") and code not in (0, 200)
    http_fail = isinstance(status, int) and (status < 200 or status >= 400)
    if not biz_fail and not http_fail:
        return ""
    for key in ("description", "message", "msg", "error"):
        text = clip_text(payload.get(key))
        if text:
            return text
    return ""
