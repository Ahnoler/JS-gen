"""Event dispatch for CDP / executor messages in the session runner.

Extracted verbatim from scripts/session_runner.py.
"""
import sys

from .agent_utils import emit_json
from .trajectory_store import (
    _handle_reset_trajectory,
    _handle_save_case_data,
    _handle_save_trajectory,
)


_REPLAY_ACTION_SIGNATURES = {
    "fill_form_field": {"label_text", "value"},
    "fill_date_field": {"label_text", "value"},
    "select_option": {"label_text", "option_text"},
    "click_element_by_index": {"index"},
    "click_menu_item": {"menu_text"},
    "click_table_row_button": {"row_text", "button_text"},
    "click_table_row_radio": {"row_text"},
    "click_adjacent_button": {"label_text"},
    "click_radio": {"label_text", "option_text"},
    "select_tree_option": {"label_text", "option_text"},
    "switch_tab": {"tab_name"},
    "close_dialog": set(),
    "go_to_url": {"url"},
    "login": {"username", "password", "captcha", "sms_code"},
}

def _convert_action_params(action_name, params):
    sig = _REPLAY_ACTION_SIGNATURES.get(action_name)
    if sig is None:
        return dict(params) if params else {}
    return {k: v for k, v in (params or {}).items() if k in sig}


async def _dispatch_event(msg, session_state, agent_running_ref=None, cdp_action_queue=None):
    event = msg.get("event")

    if event == "save_trajectory":
        _handle_save_trajectory(session_state.get('cumulative_path'), session_state['session_id'], case_data_store=session_state.get('case_data_store'))
        return 'continue'

    if event == "get_action_log":
        from .actions._state import _ACTION_LOG
        emit_json({
            "event": "get_action_log_result",
            "data": {
                "entries": list(_ACTION_LOG),
                "count": len(_ACTION_LOG),
            },
        })
        return 'continue'

    if event == "save_case_data":
        _handle_save_case_data(session_state['case_data_store'], session_state['session_id'])
        return 'continue'

    if event == "reset_trajectory":
        cum_path = _handle_reset_trajectory(
            session_state['session_id'],
            case_data_store=session_state.get('case_data_store'),
        )
        session_state['cumulative_path'] = cum_path
        session_state['case_data_store'].clear()
        return 'continue'

    if event == "cdp_action":
        action_data = msg.get("data", {})
        if cdp_action_queue is not None:
            await cdp_action_queue.put(action_data)
        return 'continue'

    if event == "manual_record_start":
        recorder = session_state.get('manual_recorder')
        if recorder is None:
            from .manual_recorder import ManualRecorder
            recorder = ManualRecorder(session_state.get('browser_context'))
            session_state['manual_recorder'] = recorder
        try:
            await recorder.start()
        except Exception as e:
            emit_json({"event": "manual_record_status", "data": {"enabled": False, "error": str(e)}})
            sys.stderr.write(f"[manual-recorder] start error: {e}\n")
            sys.stderr.flush()
        return 'continue'

    if event == "manual_record_stop":
        recorder = session_state.get('manual_recorder')
        if recorder:
            try:
                await recorder.stop()
            except Exception as e:
                emit_json({"event": "manual_record_status", "data": {"enabled": False, "error": str(e)}})
        else:
            emit_json({"event": "manual_record_status", "data": {"enabled": False}})
        return 'continue'

    if event == "capture_screenshots":
        from .actions._state import set_capture_screenshots
        data = msg.get("data") or {}
        enabled = bool(data.get("enabled", True))
        set_capture_screenshots(enabled)
        emit_json({"event": "capture_screenshots_status", "data": {"enabled": enabled}})
        sys.stderr.write(f"[session] capture_screenshots={enabled}\n")
        sys.stderr.flush()
        return 'continue'

    # BiB canvas / CDP inspect path — same payload shape as page inject
    if event == "manual_dom_event":
        recorder = session_state.get('manual_recorder')
        payload = msg.get("data") or msg.get("payload") or {}
        if not recorder or not getattr(recorder, 'enabled', False):
            return 'continue'
        if isinstance(payload, dict) and payload:
            try:
                recorder.ingest_external(payload)
            except Exception as e:
                sys.stderr.write(f"[manual-recorder] ingest_external error: {e}\n")
                sys.stderr.flush()
        return 'continue'

    if event == "list_tabs":
        browser_context = session_state.get('browser_context')
        if not browser_context:
            emit_json({"event": "tabs_result", "data": {"tabs": [], "activePageId": None, "error": "no browser_context"}})
            return 'continue'
        try:
            tabs_info = await browser_context.get_tabs_info()
            active = None
            try:
                cur = await browser_context.get_current_page()
                for t in tabs_info:
                    if getattr(t, 'url', None) == getattr(cur, 'url', None):
                        active = getattr(t, 'page_id', None)
                        break
            except Exception:
                pass
            emit_json({
                "event": "tabs_result",
                "data": {
                    "tabs": [
                        {
                            "pageId": getattr(t, 'page_id', i),
                            "url": getattr(t, 'url', '') or '',
                            "title": getattr(t, 'title', '') or '',
                        }
                        for i, t in enumerate(tabs_info)
                    ],
                    "activePageId": active,
                },
            })
        except Exception as e:
            emit_json({"event": "tabs_result", "data": {"tabs": [], "activePageId": None, "error": str(e)}})
        return 'continue'

    if event == "switch_tab":
        browser_context = session_state.get('browser_context')
        data = msg.get("data") or {}
        if not browser_context:
            emit_json({"event": "switch_tab_result", "data": {"ok": False, "error": "no browser_context"}})
            return 'continue'
        try:
            page_id = data.get("pageId")
            url = (data.get("url") or "").strip()
            if page_id is not None and str(page_id) != "":
                await browser_context.switch_to_tab(int(page_id))
            elif url:
                tabs_info = await browser_context.get_tabs_info()
                matched = None
                for t in tabs_info:
                    if (getattr(t, 'url', '') or '') == url:
                        matched = getattr(t, 'page_id', None)
                        break
                if matched is None:
                    # Soft match: same path without trailing slash / query noise
                    for t in tabs_info:
                        tu = (getattr(t, 'url', '') or '').rstrip('/')
                        if tu and tu == url.rstrip('/'):
                            matched = getattr(t, 'page_id', None)
                            break
                if matched is None:
                    raise RuntimeError(f'No Playwright tab matches url={url!r}')
                await browser_context.switch_to_tab(int(matched))
                page_id = matched
            else:
                raise RuntimeError('pageId or url required')
            cur = await browser_context.get_current_page()
            emit_json({
                "event": "switch_tab_result",
                "data": {
                    "ok": True,
                    "pageId": int(page_id) if page_id is not None else None,
                    "url": getattr(cur, 'url', '') or url,
                },
            })
            sys.stderr.write(f"[session] switch_tab -> pageId={page_id} url={getattr(cur, 'url', '')}\n")
            sys.stderr.flush()
        except Exception as e:
            emit_json({"event": "switch_tab_result", "data": {"ok": False, "error": str(e)}})
            sys.stderr.write(f"[session] switch_tab failed: {e}\n")
            sys.stderr.flush()
        return 'continue'

    if event == "replay_actions":
        data = msg.get("data", {}) or {}
        entries = data.get("actions", [])
        seed_action_log = bool(data.get("seed_action_log"))
        stop_on_fail = bool(data.get("stop_on_fail"))
        browser_context = session_state.get('browser_context')
        case_data_store = session_state.get('case_data_store', {})
        if not browser_context or not entries:
            emit_json({"event": "replay_done", "data": {"count": 0, "error": "no browser_context or empty actions"}})
            return 'continue'

        # Self-heal / trajectory replay: sequential ops via scripts/actions/_replay.py
        # (form JS + durable click + controller) — not LLM, not Playwright assemble_partial.
        from .actions._builder import build_controller
        from .actions._replay import replay_action_entries

        controller = build_controller(browser_context, case_data_store=case_data_store)
        registry_actions = controller.registry.registry.actions

        # Pass raw params — `_normalize_params` accepts aliases; controller path
        # filters by function signature inside `_replay_controller_action`.
        filtered = []
        for entry in entries:
            action_name = entry.get("action", "")
            raw_params = entry.get("params", {}) or {}
            # Prefer signature filter when known, else keep raw for alias normalize.
            converted = _convert_action_params(action_name, raw_params)
            merged = {**raw_params, **converted} if converted else dict(raw_params)
            filtered.append({**entry, "action": action_name, "params": merged})

        summary = await replay_action_entries(
            browser_context,
            filtered,
            controller_actions=registry_actions,
            case_data_store=case_data_store,
            emit=emit_json,
            stop_on_fail=stop_on_fail,
        )

        # Heal path: seed ACTION_LOG with the original pre-failure entries so the
        # subsequent agent recording can be saved as a complete trajectory (prefix + fix).
        if seed_action_log:
            try:
                from .actions import _state as action_state
                action_state._ACTION_LOG.clear()
                for entry in filtered:
                    action_name = entry.get("action") or ""
                    if action_name in (
                        'scroll_down', 'scroll_up', 'get_page_state', 'scan_form_fields',
                        'scan_visible_fields', 'check_field_value', 'verify_field_value',
                        'take_screenshot', 'save_trajectory', 'save_case_data', 'read_case_data',
                        'match_form_rule', 'init_task_list', 'get_pending_tasks',
                        'sync_tasks_from_errors', 'expand_all_el_tree', 'task_done', 'task_retry',
                        'save_form_snapshot',
                    ):
                        continue
                    dumped = dict(entry)
                    dumped.setdefault('source', 'replay')
                    action_state._ACTION_LOG.append(dumped)
                    if action_name == 'go_to_url' and (entry.get('params') or {}).get('url'):
                        action_state._TRAJECTORY_URL = entry['params']['url']
                sys.stderr.write(
                    f"[replay] Seeded ACTION_LOG with {len(action_state._ACTION_LOG)} pre-failure entries\n"
                )
                sys.stderr.flush()
            except Exception as e:
                sys.stderr.write(f"[replay] seed_action_log failed: {e}\n")
                sys.stderr.flush()

        done_data = {
            "count": summary.get("count", 0),
            "ok": summary.get("ok", 0),
            "failed": summary.get("failed", 0),
            "error": summary.get("error"),
            "results": summary.get("results") or [],
        }
        if summary.get("stoppedAt") is not None:
            done_data["stoppedAt"] = summary["stoppedAt"]
        emit_json({"event": "replay_done", "data": done_data})
        return 'continue'

    if event == "intervene":
        # Human intervention via AI session is retired — use manual recording instead.
        emit_json({
            "event": "error",
            "data": {
                "message": "intervene is gone (410). Use manual recording for human correction.",
                "code": 410,
            },
        })
        sys.stderr.write("[session] intervene rejected (410 Gone — use manual recording)\n")
        sys.stderr.flush()
        return 'continue'

    if event != "step":
        if event:
            sys.stderr.write(f"[session] Unknown event: {event}\n")
            sys.stderr.flush()
        return 'continue'

    return 'step'
