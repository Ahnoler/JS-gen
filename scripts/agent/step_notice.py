"""Per-step toast/notification scan → agent memory cue (lightweight)."""
from __future__ import annotations

import json
import sys
from typing import Any


def notice_fingerprint(item: dict) -> str:
    level = str((item or {}).get("level") or "").strip()
    text = str((item or {}).get("text") or "").strip()[:120]
    return f"{level}|{text}"


def take_new_notices(business_data_store: dict | None, items: list[dict]) -> list[dict]:
    """Return unseen notices; remember fingerprints on the store."""
    if business_data_store is None:
        business_data_store = {}
    seen_raw = business_data_store.get("_step_notice_seen")
    if isinstance(seen_raw, set):
        seen = seen_raw
    elif isinstance(seen_raw, list):
        seen = set(seen_raw)
    else:
        seen = set()
    fresh: list[dict] = []
    for it in items or []:
        if not isinstance(it, dict):
            continue
        fp = notice_fingerprint(it)
        if not fp or fp == "|" or fp in seen:
            continue
        seen.add(fp)
        fresh.append(it)
    # Cap memory of fingerprints
    if len(seen) > 80:
        seen = set(list(seen)[-60:])
    business_data_store["_step_notice_seen"] = seen
    return fresh


def _take_new_surface_keys(
    business_data_store: dict | None,
    store_key: str,
    keys: list[str],
) -> list[str]:
    """Return unseen surface keys; remember on the store (capped like toast fingerprints)."""
    if business_data_store is None:
        return list(keys)
    seen_raw = business_data_store.get(store_key)
    if isinstance(seen_raw, set):
        seen = seen_raw
    elif isinstance(seen_raw, list):
        seen = set(seen_raw)
    else:
        seen = set()
    fresh: list[str] = []
    for key in keys:
        if not key or key == "|" or key in seen:
            continue
        seen.add(key)
        fresh.append(key)
    if len(seen) > 80:
        seen = set(list(seen)[-60:])
    business_data_store[store_key] = seen
    return fresh


def rewind_notify_cursor_if_shrunk(business_data_store: dict | None, log_len: int) -> bool:
    """Reset cursor + seen when in-page ``__notify_log`` shrank (navigation / new document).

    Without this, ``log_len < cursor`` leaves the cursor past the new log head and
    permanently skips early toasts on the next page (P2-toast-cursor).
    """
    if business_data_store is None:
        return False
    cursor = int(business_data_store.get("_step_notice_log_cursor") or 0)
    if int(log_len or 0) >= cursor:
        return False
    business_data_store["_step_notice_log_cursor"] = 0
    business_data_store.pop("_step_notice_seen", None)
    return True


def format_notice_cue(items: list[dict]) -> str:
    """HumanMessage body for new notices."""
    if not items:
        return ""
    parts = []
    has_err = False
    has_ok = False
    for it in items[:6]:
        level = str(it.get("level") or "info")
        text = str(it.get("text") or "").strip()
        if not text:
            continue
        if level == "error":
            has_err = True
            parts.append(f"err:{text}")
        elif level == "success":
            has_ok = True
            parts.append(f"ok:{text}")
        else:
            parts.append(f"info:{text}")
    if not parts:
        return ""
    body = "；".join(parts)
    cue = f"【页面通知】{body}"
    if has_err:
        cue += " | 存在错误/警告通知：勿 done(success=true)；错误文案已在 [step-feedback]。"
    elif has_ok:
        cue += " | 已见成功类提示：若阶段目标即保存/确认，可据此 done(success=true)（勿再盲点确定）。"
    return cue


def _as_dict(raw: Any) -> dict:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except Exception:
            return {}
    return {}


async def scan_and_emit_step_notices(
    agent,
    business_data_store: dict | None,
    *,
    step: int = 0,
    raw_actions=None,
) -> list[dict]:
    """Scan page feedback, inject [step-feedback] cue, stamp toast_ok on success."""
    from scripts.feature_flags import step_notice_scan_enabled
    from scripts.agent.step_feedback import (
        append_step_feedback,
        business_action_names,
        clip_text,
        format_step_feedback_cue,
        omit_api_if_ui,
    )

    if not step_notice_scan_enabled():
        return []
    if business_data_store is None:
        return []
    try:
        page = await agent.browser_context.get_current_page()
    except Exception:
        return []
    if page is None:
        return []

    # Best-effort install notify hook so short-lived toasts remain in __notify_log
    try:
        from scripts.controller.actions._js_snippets import JS_NOTIFY_HOOK
        await page.evaluate(JS_NOTIFY_HOOK)
    except Exception:
        pass

    cursor = int(business_data_store.get("_step_notice_log_cursor") or 0)
    try:
        from scripts.controller.actions._js_snippets import JS_SCAN_STEP_NOTICES
        raw = await page.evaluate(JS_SCAN_STEP_NOTICES, cursor)
    except Exception as e:
        sys.stderr.write(f"[recorder] step-notice scan failed: {e}\n")
        sys.stderr.flush()
        return []

    data = _as_dict(raw)
    items = data.get("items") if isinstance(data.get("items"), list) else []
    log_len = int(data.get("notify_log_len") or 0)
    if rewind_notify_cursor_if_shrunk(business_data_store, log_len):
        business_data_store.pop("_step_feedback_form_seen", None)
        business_data_store.pop("_step_feedback_overlay_seen", None)
        # Re-scan from 0 — first evaluate used a stale cursor past the new log head.
        cursor = 0
        try:
            raw = await page.evaluate(JS_SCAN_STEP_NOTICES, 0)
            data = _as_dict(raw)
            items = data.get("items") if isinstance(data.get("items"), list) else []
            log_len = int(data.get("notify_log_len") or 0)
        except Exception as e:
            sys.stderr.write(f"[recorder] step-notice rescan after rewind failed: {e}\n")
            sys.stderr.flush()
            return []
    if log_len >= cursor:
        business_data_store["_step_notice_log_cursor"] = log_len

    fresh_toasts = take_new_notices(business_data_store, items)
    feedback_items: list[dict] = []
    for it in fresh_toasts:
        feedback_items.append({
            "kind": "toast",
            "level": str(it.get("level") or "info"),
            "text": clip_text(it.get("text")),
        })

    try:
        from scripts.controller.actions._js_snippets import JS_SCAN_STEP_SURFACE
        surface_raw = await page.evaluate(JS_SCAN_STEP_SURFACE)
    except Exception as e:
        sys.stderr.write(f"[recorder] step-feedback scan failed: {e}\n")
        sys.stderr.flush()
        surface_raw = {}

    surface = _as_dict(surface_raw)
    forms = surface.get("forms") if isinstance(surface.get("forms"), list) else []
    overlays = surface.get("overlays") if isinstance(surface.get("overlays"), list) else []

    form_keys: list[str] = []
    form_by_key: dict[str, dict] = {}
    for f in forms:
        if not isinstance(f, dict):
            continue
        label = clip_text(f.get("label"))
        text = clip_text(f.get("text"))
        if not text:
            continue
        key = f"{label}|{text}"
        form_keys.append(key)
        form_by_key[key] = {"label": label, "text": text}
    for key in _take_new_surface_keys(business_data_store, "_step_feedback_form_seen", form_keys):
        row = form_by_key.get(key) or {}
        feedback_items.append({
            "kind": "form",
            "label": row.get("label", ""),
            "text": row.get("text", ""),
        })

    overlay_keys: list[str] = []
    overlay_by_key: dict[str, dict] = {}
    for ov in overlays:
        if not isinstance(ov, dict):
            continue
        surface_name = str(ov.get("surface") or "dialog")
        text = clip_text(ov.get("text"))
        if not text:
            continue
        key = f"{surface_name}|{text}"
        overlay_keys.append(key)
        overlay_by_key[key] = {"surface": surface_name, "text": text}
    for key in _take_new_surface_keys(business_data_store, "_step_feedback_overlay_seen", overlay_keys):
        row = overlay_by_key.get(key) or {}
        feedback_items.append({
            "kind": "dialog",
            "surface": row.get("surface", "dialog"),
            "text": row.get("text", ""),
        })

    try:
        from scripts.controller.actions._js_snippets import JS_TAKE_API_ERROR_TEXTS
        xhr_cursor = int(business_data_store.get("_step_feedback_xhr_cursor") or 0)
        api_raw = await page.evaluate(JS_TAKE_API_ERROR_TEXTS, xhr_cursor)
        api_data = _as_dict(api_raw)
        if int(api_data.get("len") or 0) >= xhr_cursor:
            business_data_store["_step_feedback_xhr_cursor"] = int(api_data.get("len") or 0)
        for text in api_data.get("texts") or []:
            clipped = clip_text(text)
            if clipped:
                feedback_items.append({"kind": "api", "text": clipped})
    except Exception as e:
        sys.stderr.write(f"[recorder] step-feedback api scan failed: {e}\n")
        sys.stderr.flush()

    feedback_items = omit_api_if_ui(feedback_items)
    if not feedback_items:
        return []

    actions = business_action_names(raw_actions)
    append_step_feedback(business_data_store, step, actions, feedback_items)
    cue = format_step_feedback_cue(actions, feedback_items)
    if cue:
        try:
            from langchain_core.messages import HumanMessage
            agent._message_manager._add_message_with_tokens(HumanMessage(content=cue))
        except Exception as e:
            sys.stderr.write(f"[recorder] step-notice inject failed: {e}\n")
            sys.stderr.flush()

    # Stamp success token when a success toast is newly seen (helps introduce_pick / save)
    if any(str(it.get("level")) == "success" for it in fresh_toasts):
        try:
            from scripts.controller.actions._phase_intent import record_success_token
            ok_text = next(
                (str(it.get("text") or "") for it in fresh_toasts if str(it.get("level")) == "success"),
                "toast",
            )
            record_success_token(business_data_store, "toast_ok", ok_text)
        except Exception:
            pass

    sys.stderr.write(f"[recorder] step-feedback: {cue[:140]}\n")
    sys.stderr.flush()
    return feedback_items
