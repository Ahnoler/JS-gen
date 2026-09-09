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
        cue += " | 存在错误/警告通知：勿 done(success=true)；先处理或 close_notification / 按校验补填。"
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


async def scan_and_emit_step_notices(agent, business_data_store: dict | None) -> list[dict]:
    """Scan page notices, inject cue, stamp toast_ok on success. Returns fresh items."""
    from scripts.feature_flags import step_notice_scan_enabled

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
    if log_len >= cursor:
        business_data_store["_step_notice_log_cursor"] = log_len

    fresh = take_new_notices(business_data_store, items)
    if not fresh:
        return []

    cue = format_notice_cue(fresh)
    if cue:
        try:
            from langchain_core.messages import HumanMessage
            agent._message_manager._add_message_with_tokens(HumanMessage(content=cue))
        except Exception as e:
            sys.stderr.write(f"[recorder] step-notice inject failed: {e}\n")
            sys.stderr.flush()

    # Stamp success token when a success toast is newly seen (helps introduce_pick / save)
    if any(str(it.get("level")) == "success" for it in fresh):
        try:
            from scripts.controller.actions._phase_intent import record_success_token
            ok_text = next(
                (str(it.get("text") or "") for it in fresh if str(it.get("level")) == "success"),
                "toast",
            )
            record_success_token(business_data_store, "toast_ok", ok_text)
        except Exception:
            pass

    sys.stderr.write(f"[recorder] step-notice: {cue[:140]}\n")
    sys.stderr.flush()
    return fresh
