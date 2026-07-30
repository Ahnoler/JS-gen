"""
Interactive session mode for browser-use agent.
Reads JSON instructions from stdin, runs agent steps with SSE output.
"""
import os
import sys
import asyncio
import json
import uuid
import tempfile
import re
from datetime import datetime
from pathlib import Path

from browser_use import Agent, Browser
from browser_use.browser.context import BrowserContextConfig

from .agent_utils import (
    emit_json, extract_first_url, do_navigate,
    OVERRIDE_SYSTEM_MESSAGE, PLANNER_SYSTEM_PROMPT,
    patch_message_manager, patch_planner_prompt, patch_icon_tooltip_labels, create_llm,
    make_step_callback, make_done_callback,
)
from .controller import build_controller
from .recorder import build_recording_hooks
from .actions.form_rules import load_rules

_last_agent = None


def _port_is_connectable(host: str, port: int) -> bool:
    """Same check browser_use uses before dropping --remote-debugging-port."""
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        return s.connect_ex((host, int(port))) == 0


def _pick_free_cdp_port(preferred: int, span: int = 40) -> int:
    """
    Pick a port that is NOT connectable (browser_use will strip
    --remote-debugging-port if localhost:port accepts connections).
    Also try binding so we do not race with another binder.
    """
    import socket
    start = max(1024, int(preferred) or 9242)
    for port in range(start, start + span):
        if _port_is_connectable('127.0.0.1', port) or _port_is_connectable('localhost', port):
            continue
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                s.bind(('127.0.0.1', port))
            # Released — double-check nothing answered while we held it
            if _port_is_connectable('127.0.0.1', port) or _port_is_connectable('localhost', port):
                continue
            return port
        except OSError:
            continue
    return start


async def _wait_cdp_http(port: int, timeout_s: float = 20.0) -> bool:
    """Poll Chrome /json/version until CDP HTTP is reachable."""
    import urllib.request

    url = f'http://127.0.0.1:{int(port)}/json/version'
    deadline = asyncio.get_event_loop().time() + timeout_s
    while asyncio.get_event_loop().time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1.5) as resp:
                if getattr(resp, 'status', 200) == 200:
                    return True
        except Exception:
            pass
        await asyncio.sleep(0.4)
    sys.stderr.write(f'[session] WARN: CDP HTTP not ready on port {port} after {timeout_s}s\n')
    sys.stderr.flush()
    return False


async def _probe_cdp_ws_url(port: int) -> str | None:
    """Return webSocketDebuggerUrl from /json/version if available."""
    import urllib.request
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{int(port)}/json/version', timeout=2) as resp:
            raw = resp.read().decode('utf-8', errors='replace')
            data = json.loads(raw)
            ws = data.get('webSocketDebuggerUrl')
            return str(ws) if ws else None
    except Exception:
        return None


# Keep old name for any external imports
async def wait_cdp_http(port: int, timeout_s: float = 20.0) -> bool:
    return await _wait_cdp_http(port, timeout_s)


def _close_agent():
    global _last_agent
    if _last_agent is not None:
        try:
            for t in getattr(_last_agent, '_tasks', []):
                t.cancel()
        except Exception:
            pass
        _last_agent = None


def _request_agent_stop(cancel_flag_path=None, goal_tracker=None, reason='cancel_step'):
    """Stop the in-flight browser-use Agent ASAP (no further steps).

    Cooperative: browser-use honors agent.state.stopped at the next step boundary.
    Also writes cancel_flag_path so on_step_start/end hooks reinforce the stop.
    """
    global _last_agent
    try:
        if cancel_flag_path is not None:
            Path(cancel_flag_path).write_text('cancel', encoding='utf-8')
    except Exception as e:
        sys.stderr.write(f"[session] cancel flag write failed: {e}\n")
        sys.stderr.flush()

    if isinstance(goal_tracker, dict):
        goal_tracker['stopped'] = True

    agent = _last_agent
    if agent is not None:
        try:
            if getattr(agent, 'state', None) is not None:
                agent.state.stopped = True
        except Exception:
            pass
        try:
            for t in getattr(agent, '_tasks', []) or []:
                try:
                    t.cancel()
                except Exception:
                    pass
        except Exception:
            pass

    sys.stderr.write(f"[session] Stop requested ({reason}) — agent will not take further steps\n")
    sys.stderr.flush()
    emit_json({"event": "agent_stopped", "data": {"reason": reason}})


def _handle_save_trajectory(cumulative_path, session_id, browser_context=None, case_data_store=None):
    """Save action/log/form files for assemble + MySQL persist.

    - action_{ts}.json  — custom action format (for script_assembler.py)
    - log_{ts}.txt      — operation log (for LLM context)
    - form_{ts}.json    — form structure snapshots (optional)

    Native browser-use AgentHistory (scripts/trajectories/{session_id}.json /
    traj_*.json) is no longer saved — product truth is MySQL + action JSON.
    """
    from .controller import _ACTION_LOG, _TRAJECTORY_URL
    from .recorder import _ACTION_LOG as _recorder_log
    from .controller import _ACTION_LOG as _controller_log
    # Try to extract URL from go_to_url action or _TRAJECTORY_URL
    url = _TRAJECTORY_URL or ''
    if not url:
        for entry in (list(_controller_log) if _controller_log else []):
            if entry.get('action') == 'go_to_url':
                url = entry.get('params', {}).get('url', '') or ''
                if url:
                    break
    if not url:
        url = 'http://unknown'

    # ── 快照：立即复制所有可变数据，后续只用副本 ──
    entries = list(_ACTION_LOG) if _ACTION_LOG else []
    rec_log_snapshot = list(_recorder_log) if _recorder_log else []

    if not entries and not rec_log_snapshot:
        emit_json(
            {"event": "save_trajectory_result", "data": {"success": False, "message": "No trajectory data available"}})
        return
    try:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        scripts_dir = Path(__file__).parent
        action_dir = scripts_dir / 'action'
        log_dir = scripts_dir / 'log'
        action_dir.mkdir(parents=True, exist_ok=True)
        log_dir.mkdir(parents=True, exist_ok=True)
        action_path = None
        log_path = None

        # Prepare file paths (write later, after all metadata is ready)
        action_path = action_dir / f"action_{ts}.json" if entries else None
        log_path = log_dir / f"log_{ts}.txt" if rec_log_snapshot else None

        # Native AgentHistory dump disabled — discard temp cumulative so it does not grow.
        if cumulative_path and cumulative_path.exists():
            try:
                cumulative_path.unlink()
            except OSError:
                pass
        sys.stderr.write(f"[save-trajectory] entries={len(entries)}, rec_log_snapshot={len(rec_log_snapshot)} (native AgentHistory skipped)\n")
        sys.stderr.flush()

        # File 4: form_{ts}.json — form structure snapshots (for replay validation)
        form_path = None
        snapshots = None
        if case_data_store:
            from .models import FormSnapshotCollection
            coll = FormSnapshotCollection.from_store(case_data_store)
            snapshots = coll.to_dicts()
        if snapshots:
            forms_dir = scripts_dir / 'forms'
            forms_dir.mkdir(parents=True, exist_ok=True)
            form_path = forms_dir / f"form_{ts}.json"
            with open(form_path, 'w', encoding='utf-8') as f:
                json.dump(snapshots, f, ensure_ascii=False, indent=2)
            sys.stderr.write(f"[session] Form snapshots saved: {form_path}\n")
            sys.stderr.flush()

        # File 1: action_{ts}.json
        if action_path and entries:
            action_json = {
                'id': str(uuid.uuid4()),
                'name': 'browser-use-session',
                'url': url,
                'tests': [{
                    'id': str(uuid.uuid4()),
                    'name': 'browser-use-session',
                    'commands': entries,
                }],
            }
            with open(action_path, 'w', encoding='utf-8') as f:
                json.dump(action_json, f, ensure_ascii=False, indent=2)

        # File 2: log_{ts}.txt
        if log_path and rec_log_snapshot:
            with open(log_path, 'w', encoding='utf-8') as f:
                f.write(f"URL: {url}\n")
                f.write(f"Total steps: {len(rec_log_snapshot)}\n")
                f.write("=" * 60 + "\n")
                for line in rec_log_snapshot:
                    f.write(line + "\n")

        # Clear all logs so next task starts fresh
        action_count = len(entries)
        log_count = len(rec_log_snapshot)
        _ACTION_LOG.clear()
        _recorder_log.clear()
        from .actions._state import _emit_action_log_sync
        _emit_action_log_sync()

        emit_json({
            "event": "save_trajectory_result",
            "data": {
                "success": True,
                "action_file": str(action_path) if action_path else None,
                # Native AgentHistory path removed; do not fall back to action_file
                # (would wrongly feed trajectory-store / scripts/trajectories).
                "trajectory_file": None,
                "log_file": str(log_path) if log_path else None,
                "form_file": str(form_path) if form_path else None,
                "action_count": action_count,
                "log_count": log_count,
                "native_count": 0,
                "url": url,
            },
        })
        _fcounts = [s.get('count', 0) for s in snapshots] if snapshots else []
        _fstr = ', '.join(str(c) for c in _fcounts) if _fcounts else '0'
        sys.stderr.write(f"[session] Saved: action({action_count}) log({log_count}) form({_fstr})\n")
        sys.stderr.flush()
    except Exception as e:
        emit_json({"event": "save_trajectory_result", "data": {"success": False, "message": str(e)}})
        emit_json({"event": "save_trajectory_result", "data": {"success": False, "message": str(e)}})


def _handle_save_case_data(case_data_store, session_id):
    try:
        data_dir = Path(__file__).parent / 'case_data'
        data_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        case_data_path = data_dir / f"cdata_{ts}.json"
        import json as _json
        with open(case_data_path, 'w', encoding='utf-8') as f:
            _json.dump(case_data_store, f, ensure_ascii=False, indent=2)
        sys.stderr.write(f"[session] Case data saved on demand: {case_data_path}\n")
        sys.stderr.flush()
        emit_json({
            "event": "save_case_data_result",
            "data": {"success": True, "case_data_file": str(case_data_path), "keys": len(case_data_store)},
        })
    except Exception as e:
        emit_json({"event": "save_case_data_result", "data": {"success": False, "message": str(e)}})


def _handle_reset_trajectory(session_id):
    from .controller import _ACTION_LOG
    from .recorder import _ACTION_LOG as _recorder_log
    _ACTION_LOG.clear()
    _recorder_log.clear()
    from .actions._state import _emit_action_log_sync
    _emit_action_log_sync()
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    cumulative_path = Path(tempfile.gettempdir()) / f"browser_use_session_{session_id}_case_{ts}.json"
    sys.stderr.write(f"[session] ATP trajectory reset ({ts})\n")
    sys.stderr.flush()
    emit_json({"event": "reset_trajectory_ready",
               "data": {"session_id": session_id, "format": "atp-record", "cumulative_file": str(cumulative_path)}})
    return cumulative_path


def _accumulate_trajectory(output_path, cumulative_path, phase_number=None):
    if not output_path.exists():
        return
    try:
        from .controller import _ACTION_LOG as _action_log
        from .recorder import _ACTION_LOG as _recorder_log
        with open(output_path, 'r', encoding='utf-8') as _f:
            _step = json.load(_f)
        _step_history = _step.get('history', [])
        if not _step_history:
            return
        # ── 注入 phase_number 到每一步的 state 中 ──
        if phase_number is not None:
            for step in _step_history:
                step.setdefault('state', {})['_phase_number'] = phase_number
        if cumulative_path.exists():
            with open(cumulative_path, 'r', encoding='utf-8') as _f:
                _cum = json.load(_f)
        else:
            _cum = {'history': []}
        _cum['history'].extend(_step_history)
        cumulative_path.parent.mkdir(parents=True, exist_ok=True)
        with open(cumulative_path, 'w', encoding='utf-8') as _f:
            json.dump(_cum, _f, ensure_ascii=False, indent=2)
        sys.stderr.write(
            f"[session] Accumulated: step({len(_step_history)}) action({len(_action_log)}) log({len(_recorder_log)}) trajectory({len(_cum['history'])} total)\n")
        sys.stderr.flush()
    except Exception as _e:
        sys.stderr.write(f"[session] Accumulate error: {_e}\n")
        sys.stderr.flush()


# Actions recorded by the custom controller (subset of all browser_use actions)
_CUSTOM_ACTIONS = {
    'fill_form_field', 'select_option', 'click_element_by_index',
    'click_menu_item', 'click_table_row_button', 'click_table_row_radio', 'click_radio',
    'fill_date_field', 'click_adjacent_button', 'switch_tab', 'close_dialog',
}



async def _run_agent_step(instruction, step_index, session_id, args, llm, browser_context,
                          controller, goal_tracker, cancel_flag_path,
                          on_step_start_hook, on_step_end_hook, case_data_ref, cumulative_path):
    global _last_agent
    max_steps = instruction.get("max_steps", 40)
    task_text = instruction.get("instruction", "")
    if not task_text:
        emit_json({"event": "error", "data": {"message": "instruction is required"}})
        return None, None

    # Close previous agent before creating new one
    _close_agent()

    if cancel_flag_path.exists():
        try:
            cancel_flag_path.unlink(missing_ok=True)
        except Exception:
            pass

    emit_json({"event": "phase_start", "data": {"phase": step_index, "total": -1, "name": task_text[:60]}})
    sys.stderr.write(f"[session] Step {step_index}: {task_text[:80]} (max_steps={max_steps})\n")
    sys.stderr.flush()

    nav_url = extract_first_url(task_text)
    if nav_url:
        try:
            page = await browser_context.get_current_page()
            sys.stderr.write(f"[session] Navigating to {nav_url}\n");
            sys.stderr.flush()
            await do_navigate(page, nav_url)
            sys.stderr.write(f"[session] Navigation done\n");
            sys.stderr.flush()
        except Exception as e:
            sys.stderr.write(f"[session navigate] Error: {e}\n");
            sys.stderr.flush()

    agent_task = re.sub(r'^【目标URL】\s*\n\s*https?://[^\s\n]+[\s\n]*', '', task_text, count=1).strip() or task_text
    try:
        from .actions._case_data import format_case_data_hint, iter_user_case_entries
        entries = iter_user_case_entries(case_data_ref)
        hint = format_case_data_hint(case_data_ref)
        if hint:
            agent_task = agent_task + hint
            sys.stderr.write(f"[session] Appended case data hint ({len(entries)} keys)\n")
            sys.stderr.flush()
    except Exception as e:
        sys.stderr.write(f"[session] case data hint skipped: {e}\n")
        sys.stderr.flush()

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_path = Path(tempfile.gettempdir()) / f"browser_use_session_{session_id}_step{step_index}_{ts}.json"
    goal_tracker['goals'] = []
    goal_tracker['stopped'] = False

    sys.stderr.write(f"[session] Creating Agent...\n");
    sys.stderr.flush()
    agent = Agent(
        task=agent_task, llm=llm, controller=controller, browser_context=browser_context,
        override_system_message=OVERRIDE_SYSTEM_MESSAGE,
        use_vision=False, enable_memory=False,
        max_failures=5, retry_delay=10,
        planner_llm=llm, planner_interval=3,
        extend_planner_system_message=PLANNER_SYSTEM_PROMPT,
        register_new_step_callback=make_step_callback(step_index * 100),
        register_done_callback=make_done_callback(output_path),
    )
    _last_agent = agent
    sys.stderr.write(f"[session] Agent created, starting run...\n");
    sys.stderr.flush()

    try:
        sys.stderr.write(f"[session] Calling agent.run() with max_steps={max_steps}\n");
        sys.stderr.flush()
        await agent.run(max_steps=max_steps, on_step_start=on_step_start_hook, on_step_end=on_step_end_hook)
        sys.stderr.write(f"[session] Agent run completed\n");
        sys.stderr.flush()
        if not hasattr(agent, '_done_fired') and hasattr(agent, 'history'):
            output_path.parent.mkdir(parents=True, exist_ok=True)
            agent.history.save_to_file(str(output_path))
    except asyncio.CancelledError:
        sys.stderr.write("[session] Agent run cancelled\n");
        sys.stderr.flush()
        emit_json({"event": "phase_error",
                   "data": {"phase": step_index, "name": task_text[:60], "message": "Agent run cancelled"}})
    except Exception as e:
        emit_json({"event": "phase_error", "data": {"phase": step_index, "name": task_text[:60], "message": str(e)}})

    return output_path, task_text


async def _stdin_reader(loop, stdin_queue, agent_running_ref, cancel_flag_path=None, goal_tracker=None):
    while True:
        try:
            line = await loop.run_in_executor(None, sys.stdin.readline)
        except asyncio.CancelledError:
            break
        except Exception:
            await asyncio.sleep(0.1)
            continue
        if not line:
            await stdin_queue.put(None)
            break
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            sys.stderr.write(f"[session] Invalid JSON: {line[:100]}\n")
            sys.stderr.flush()
            continue
        event = msg.get("event")
        if event == "close":
            # Pass close msg through so main loop can read keep_browser
            await stdin_queue.put(msg)
            break
        # Stop immediately even while agent.run() is blocking the main loop.
        if event == "cancel_step":
            _request_agent_stop(cancel_flag_path, goal_tracker, reason='cancel_step')
            continue
        await stdin_queue.put(msg)


# Controller function param signatures — only these keys are passed to the action
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


async def _dispatch_event(msg, session_state, intervention_queue=None, agent_running_ref=None, cdp_action_queue=None):
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
        cum_path = _handle_reset_trajectory(session_state['session_id'])
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
        form_rules = session_state.get('form_rules', [])
        case_data_store = session_state.get('case_data_store', {})
        if not browser_context or not entries:
            emit_json({"event": "replay_done", "data": {"count": 0, "error": "no browser_context or empty actions"}})
            return 'continue'

        # Self-heal / trajectory replay: sequential ops via scripts/actions/_replay.py
        # (form JS + durable click + controller) — not LLM, not Playwright assemble_partial.
        from .actions._builder import build_controller
        from .actions._replay import replay_action_entries

        controller = build_controller(browser_context, form_rules, case_data_store=case_data_store)
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
        instruction = msg.get("data", {}).get("instruction", "")
        if instruction:
            if agent_running_ref and not agent_running_ref.get('value'):
                sys.stderr.write(f"[session] Intervention immediate: {instruction[:80]}\n")
                sys.stderr.flush()
                return ('intervene', instruction)
            if intervention_queue is not None:
                intervention_queue.put_nowait(instruction)
                sys.stderr.write(f"[session] Intervention queued for running agent: {instruction[:80]}\n")
                sys.stderr.flush()
        return 'continue'

    if event != "step":
        if event:
            sys.stderr.write(f"[session] Unknown event: {event}\n")
            sys.stderr.flush()
        return 'continue'

    return 'step'


async def _run_cdp_watcher(browser_context, action_queue, case_data_store, form_rules):
    """In-process quick-action executor — uses the same browser_context as the Agent.

    Shares _ACTION_LOG and case_data_store with the main Agent, so all actions
    executed through this watcher are recorded for script assembly.
    No separate CDP connection needed — actions run on the same Playwright context.
    """
    from .actions._builder import build_controller

    # TODO: 如果将来改用 raw Playwright context（如从 CDP 连接），
    #       必须手动注入 get_current_page()，否则 controller action 会报错。
    #       参考 scripts/cdp/watcher.py:69-70:
    #         ctx = browser.contexts[0]
    #         ctx.get_current_page = _get_page
    # Self-heal scene reproduce uses replay_actions → _replay.replay_action_entries
    # (see browser-session.js /rerun), not this CDP watcher loop.
    ctrl = build_controller(browser_context, form_rules, case_data_store=case_data_store)
    actions = ctrl.registry.registry.actions

    while True:
        msg = await action_queue.get()
        action_name = msg.get("action", "")
        params = msg.get("params", [])
        req_id = msg.get("id", "")

        act = actions.get(action_name)
        if not act:
            sys.stderr.write(f"[cdp-watcher] Unknown action: {action_name}\n")
            sys.stderr.flush()
            continue

        try:
            # Per-action watcher mode — skip _ensure_scanned, no auto-fill
            # Tag recorded actions as source=cdp for DB persistence
            from .actions._state import set_current_source
            case_data_store['_watcher_mode'] = True
            set_current_source('cdp')
            try:
                if isinstance(params, list):
                    result = await act.function(*params)
                elif isinstance(params, dict):
                    result = await act.function(**params)
                else:
                    result = await act.function()
                result_str = str(result)
            finally:
                case_data_store['_watcher_mode'] = False
                set_current_source('agent')
            sys.stderr.write(f"[cdp-watcher] {action_name}{params} -> {result_str}\n")
            sys.stderr.flush()
            from .actions._state import _ACTION_LOG
            last_entry = _ACTION_LOG[-1] if _ACTION_LOG else None
            # Always tag CDP result entry so control-plane never treats it as agent
            if isinstance(last_entry, dict):
                last_entry = {**last_entry, "source": "cdp"}
            if req_id:
                emit_json({
                    "event": "cdp_action_result",
                    "id": req_id,
                    "result": result_str,
                    "error": None,
                    "entry": last_entry,
                })
        except Exception as e:
            err_str = str(e)
            sys.stderr.write(f"[cdp-watcher] Error: {action_name}{params} -> {err_str}\n")
            sys.stderr.flush()
            try:
                from .actions._state import set_current_source
                set_current_source('agent')
                case_data_store['_watcher_mode'] = False
            except Exception:
                pass
            if req_id:
                emit_json({"event": "cdp_action_result", "id": req_id, "result": None, "error": err_str, "entry": None})


async def _resolve_chromium_executable() -> str | None:
    """Playwright-bundled Chromium path (used with browser_binary_path for reliable CDP)."""
    try:
        from playwright.async_api import async_playwright
        pw = await async_playwright().start()
        try:
            exe = pw.chromium.executable_path
            return str(exe) if exe else None
        finally:
            await pw.stop()
    except Exception as e:
        sys.stderr.write(f'[session] WARN: cannot resolve Playwright Chromium: {e}\n')
        sys.stderr.flush()
        return None


def _chrome_automation_args() -> list[str]:
    """Flags that suppress Chrome chrome UI prompts agents cannot click, and start maximized."""
    # NOT incognito — Incognito enables stricter HTTPS-First by default.
    args = [
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-default-apps',
        '--disable-sync',
        '--disable-extensions',
        '--disable-component-update',
        '--disable-background-networking',
        '--disable-client-side-phishing-detection',
        '--disable-hang-monitor',
        '--disable-popup-blocking',
        '--disable-prompt-on-repost',
        '--disable-infobars',
        '--hide-crash-restore-bubble',
        '--disable-session-crashed-bubble',
        '--password-store=basic',
        '--use-mock-keychain',
        '--metrics-recording-only',
        '--no-service-autorun',
        '--start-maximized',
        '--window-position=0,0',
        # Cert / mixed content
        '--ignore-certificate-errors',
        '--ignore-certificate-errors-spki-list',
        '--ignore-ssl-errors',
        '--allow-insecure-localhost',
        '--allow-running-insecure-content',
        # Plain HTTP sites (e.g. http://test.creditv5p2…) hit HTTPS-First interstitial:
        # 「此网站不支持安全连接」→「继续访问网站」. Disable the feature family entirely.
        (
            '--disable-features='
            'TranslateUI,ChromeWhatsNewUI,PrivacySandboxSettings4,'
            'HttpsUpgrades,'
            'HttpsFirstModeV2,'
            'HttpsFirstModeV2ForTypicallySecureUsers,'
            'HttpsFirstModeV2ForEngagedSites,'
            'HttpsFirstBalancedMode,'
            'HttpsFirstBalancedModeAutoEnable,'
            'HttpsFirstModeIncognito,'
            'HttpsFirstDialogUi,'
            'BlockInsecurePrivateNetworkRequests'
        ),
    ]
    # Linux root (typical cloud executor): Chrome exits immediately without these.
    if sys.platform != 'win32' and hasattr(os, 'geteuid') and os.geteuid() == 0:
        args.extend(['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'])
    return args


def _seed_chrome_profile(profile_dir: Path) -> None:
    """Clean exit + explicitly disable HTTPS-First / Always Use Secure Connections prefs."""
    try:
        default_dir = profile_dir / 'Default'
        default_dir.mkdir(parents=True, exist_ok=True)
        prefs_path = default_dir / 'Preferences'
        prefs = {}
        if prefs_path.exists():
            try:
                prefs = json.loads(prefs_path.read_text(encoding='utf-8'))
            except Exception:
                prefs = {}
        profile = prefs.setdefault('profile', {})
        profile['exit_type'] = 'Normal'
        profile['exited_cleanly'] = True

        # Chromium pref names (chrome/common/pref_names.h) — flat booleans, not nested.
        # Setting these BEFORE first launch prevents auto-enable heuristics on fresh profiles.
        prefs['https_only_mode_enabled'] = False
        prefs['https_first_balanced_mode_enabled'] = False
        prefs['https_first_mode_incognito_enabled'] = False
        prefs['https_only_mode_auto_enabled'] = False
        prefs.setdefault('ssl', {})['rev_checking'] = {'enabled': False}

        prefs_path.write_text(json.dumps(prefs), encoding='utf-8')

        local_state_path = profile_dir / 'Local State'
        local_state = {}
        if local_state_path.exists():
            try:
                local_state = json.loads(local_state_path.read_text(encoding='utf-8'))
            except Exception:
                local_state = {}
        local_state.setdefault('profile', {})['exited_cleanly'] = True
        local_state_path.write_text(json.dumps(local_state), encoding='utf-8')
    except Exception as e:
        sys.stderr.write(f'[session] WARN: seed chrome profile failed: {e}\n')
        sys.stderr.flush()


async def _ignore_certificate_errors(browser_context) -> None:
    """CDP-level cert bypass (covers pages opened after launch)."""
    try:
        page = await browser_context.get_current_page()
        session = await browser_context.get_session()
        cdp = await session.context.new_cdp_session(page)
        try:
            await cdp.send('Security.enable')
            await cdp.send('Security.setIgnoreCertificateErrors', {'ignore': True})
            sys.stderr.write('[session] CDP Security.setIgnoreCertificateErrors=true\n')
            sys.stderr.flush()
        finally:
            await cdp.detach()
    except Exception as e:
        sys.stderr.write(f'[session] WARN: ignore certificate errors failed: {e}\n')
        sys.stderr.flush()


async def _bypass_ssl_interstitial_if_any(browser_context) -> None:
    """Click 「继续访问网站」 on HTTPS-First / SSL interstitial if present."""
    try:
        from .actions._helpers import dismiss_https_first_interstitial
        page = await browser_context.get_current_page()
        result = await dismiss_https_first_interstitial(page)
        if result and result != 'none':
            sys.stderr.write(f'[session] HTTPS-First interstitial bypass: {result} url={page.url}\n')
            sys.stderr.flush()
    except Exception as e:
        sys.stderr.write(f'[session] WARN: SSL interstitial bypass failed: {e}\n')
        sys.stderr.flush()


def _screen_window_size() -> tuple[int, int]:
    try:
        from browser_use.browser.utils.screen_resolution import get_screen_resolution
        screen = get_screen_resolution()
        w = int(screen.get('width') or 1920)
        h = int(screen.get('height') or 1080)
        return max(w, 1280), max(h, 720)
    except Exception:
        return 1920, 1080


async def _maximize_browser_window(browser_context) -> None:
    """
    Force maximized window after browser_use's _resize_window (which sets windowState=normal).
    Maximized window = better BiB canvas coverage.
    """
    try:
        page = await browser_context.get_current_page()
        session = await browser_context.get_session()
        cdp = await session.context.new_cdp_session(page)
        try:
            win = await cdp.send('Browser.getWindowForTarget')
            window_id = win.get('windowId')
            if window_id is None:
                return
            await cdp.send(
                'Browser.setWindowBounds',
                {'windowId': window_id, 'bounds': {'windowState': 'maximized'}},
            )
            sys.stderr.write('[session] Browser window maximized\n')
            sys.stderr.flush()
        finally:
            await cdp.detach()
    except Exception as e:
        sys.stderr.write(f'[session] WARN: maximize window failed: {e}\n')
        sys.stderr.flush()


async def _dismiss_native_js_dialogs(browser_context) -> None:
    """Auto-accept in-page alert/confirm/prompt — agents struggle with modal JS dialogs."""
    try:
        page = await browser_context.get_current_page()

        async def _on_dialog(dialog):
            try:
                sys.stderr.write(f'[session] Auto-accept JS dialog: {dialog.type} {dialog.message[:80]!r}\n')
                sys.stderr.flush()
                await dialog.accept()
            except Exception:
                pass

        page.on('dialog', lambda d: asyncio.create_task(_on_dialog(d)))
    except Exception as e:
        sys.stderr.write(f'[session] WARN: dialog handler setup failed: {e}\n')
        sys.stderr.flush()


async def _build_browser(cdp_url=None, cdp_port=None, session_id='unknown'):
    """
    Launch browser with a *reliable* CDP HTTP endpoint for BiB.

    browser_use's builtin Playwright launch path silently strips
    --remote-debugging-port when the port appears busy. The user-provided
    binary path launches Chrome itself and waits for /json/version — that
    is what we need for BibBridge.
    """
    from browser_use.browser.browser import BrowserConfig

    if cdp_url:
        sys.stderr.write(f"[session] Connecting to existing browser via CDP: {cdp_url}\n")
        sys.stderr.flush()
        return Browser(config=BrowserConfig(cdp_url=cdp_url)), None, True

    preferred = int(cdp_port) if cdp_port else 9242
    port = _pick_free_cdp_port(preferred)
    if port != preferred:
        sys.stderr.write(f"[session] CDP port {preferred} busy — using free port {port}\n")
        sys.stderr.flush()

    exe = await _resolve_chromium_executable()
    profile_dir = Path(tempfile.gettempdir()) / 'jsgen-chrome-profiles' / str(session_id)
    profile_dir.mkdir(parents=True, exist_ok=True)
    _seed_chrome_profile(profile_dir)

    extra_args = [
        f'--user-data-dir={profile_dir.resolve()}',
        *_chrome_automation_args(),
    ]

    if exe:
        sys.stderr.write(
            f"[session] Launching Chromium via browser_binary_path for CDP "
            f"port={port} exe={exe}\n"
        )
        sys.stderr.flush()
        browser = Browser(config=BrowserConfig(
            browser_binary_path=exe,
            chrome_remote_debugging_port=port,
            disable_security=True,  # ignore cert / CORS blockers for internal systems
            extra_browser_args=extra_args,
        ))
        return browser, port, None  # cdp_ready unknown until after new_context

    # Fallback: builtin launch (may drop CDP port — BiB may be unavailable)
    sys.stderr.write(
        f"[session] WARN: no Chromium exe — fallback builtin launch port={port}\n"
    )
    sys.stderr.flush()
    browser = Browser(config=BrowserConfig(
        chrome_remote_debugging_port=port,
        disable_security=True,
        extra_browser_args=extra_args,
    ))
    return browser, port, None


async def run_session(args):
    patch_message_manager()
    patch_planner_prompt()
    patch_icon_tooltip_labels()
    llm = create_llm(args.model, args.base_url, getattr(args, 'api_key', None))
    form_rules = load_rules()

    session_id = args.session_id or "unknown"

    cdp_url = getattr(args, 'cdp_url', None) or None
    cdp_port = getattr(args, 'cdp_port', None)
    if cdp_port is not None:
        try:
            cdp_port = int(cdp_port)
        except (TypeError, ValueError):
            cdp_port = None

    browser, cdp_port, _ = await _build_browser(
        cdp_url=cdp_url,
        cdp_port=cdp_port,
        session_id=session_id,
    )

    # window_width/height (not viewport_*) — browser_use ignores unknown fields.
    # Still call CDP maximize after init: browser_use _resize_window forces windowState=normal.
    win_w, win_h = _screen_window_size()
    config = BrowserContextConfig(
        window_width=win_w,
        window_height=win_h,
        no_viewport=True,
        wait_for_network_idle_page_load_time=3.0,
        # trace_path disabled: Playwright traces under scripts/trace/ are no longer needed.
    )
    browser_context = await browser.new_context(config)

    # Eagerly launch Chrome BEFORE CDP readiness check / BiB attach.
    # Previously launch was lazy (first agent step), so prepare often saw cdp_ready=false.
    await browser_context.get_session()
    await _ignore_certificate_errors(browser_context)
    await _maximize_browser_window(browser_context)
    await _dismiss_native_js_dialogs(browser_context)
    await _bypass_ssl_interstitial_if_any(browser_context)

    case_data_store = {}  # process-level in-memory store, persists across steps
    cancel_flag_path = Path(tempfile.gettempdir()) / f"browser_use_cancel_{session_id}"
    goal_tracker = {'goals': [], 'stopped': False}
    intervention_queue = asyncio.Queue()  # human intervention messages

    on_step_start_hook, on_step_end_hook = build_recording_hooks(goal_tracker, cancel_flag_path, intervention_queue, case_data_store)
    controller = build_controller(browser_context, form_rules, case_data_store, llm=llm)

    # Start CDP watcher — runs in-process, shares _ACTION_LOG and case_data_store
    cdp_action_queue = asyncio.Queue()
    cdp_task = asyncio.create_task(_run_cdp_watcher(browser_context, cdp_action_queue, case_data_store, form_rules))

    # Wait until CDP HTTP answers so executor BibBridge can attach reliably.
    cdp_ready = False
    cdp_ws_url = None
    if cdp_url:
        cdp_ready = True
        cdp_ws_url = cdp_url
    elif cdp_port:
        cdp_ready = await _wait_cdp_http(int(cdp_port), timeout_s=45)
        if cdp_ready:
            cdp_ws_url = await _probe_cdp_ws_url(int(cdp_port))
        else:
            sys.stderr.write(
                f"[session] WARN: CDP HTTP still not ready on port {cdp_port} after launch. "
                "BiB canvas unavailable; AI/manual recording can still run.\n"
            )
            sys.stderr.flush()

    ready_payload = {
        "event": "ready",
        "session_id": session_id,
        "cdp_ready": bool(cdp_ready),
    }
    if cdp_port and not cdp_url:
        ready_payload["cdp_port"] = int(cdp_port)
        ready_payload["cdp_http"] = f"http://127.0.0.1:{int(cdp_port)}"
    if cdp_ws_url:
        ready_payload["cdp_ws_url"] = cdp_ws_url
    emit_json(ready_payload)
    sys.stderr.write(
        f"[session] Ready, session_id={session_id}"
        + (f", cdp_port={cdp_port}" if cdp_port and not cdp_url else "")
        + f", cdp_ready={bool(cdp_ready)}"
        + "\n"
    )
    sys.stderr.flush()

    loop = asyncio.get_event_loop()
    stdin_queue = asyncio.Queue()
    agent_running_ref = {'value': False}

    reader_task = asyncio.create_task(
        _stdin_reader(loop, stdin_queue, agent_running_ref, cancel_flag_path, goal_tracker)
    )

    step_index = 0
    cumulative_path = Path(tempfile.gettempdir()) / f"browser_use_session_{session_id}_cumulative.json"

    session_state = {
        'session_id': session_id,
        'cumulative_path': cumulative_path,
        'case_data_store': case_data_store,
        'browser_context': browser_context,
        'form_rules': form_rules,
    }

    case_data_loaded = False
    keep_browser = False  # 「释放资源」默认关浏览器；keep_browser=True 才留 CDP

    async def _run_step(data, step_idx):
        """Execute one agent step with the given data."""
        nonlocal cumulative_path
        from .actions._state import set_current_phase
        # Prefer client-provided phase_number (matches 【阶段N】); fallback to step_idx
        phase_num = data.get("phase_number")
        if phase_num is None:
            phase_num = data.get("phaseNumber")
        try:
            phase_num = int(phase_num) if phase_num is not None else int(step_idx)
        except (TypeError, ValueError):
            phase_num = step_idx
        set_current_phase(phase_num)
        agent_running_ref['value'] = True
        try:
            output_path, task_text = await _run_agent_step(
                data, step_idx, session_id, args, llm, browser_context,
                controller, goal_tracker, cancel_flag_path,
                on_step_start_hook, on_step_end_hook, case_data_store, cumulative_path,
            )
        finally:
            agent_running_ref['value'] = False
        if output_path is None:
            return
        # Native AgentHistory accumulate disabled (scripts/trajectories/*.json no longer saved).
        # Temp per-step history files may still exist under %TEMP%; not copied to repo.
        emit_json({
            "event": "phase_done",
            "data": {"phase": phase_num, "total": -1, "name": task_text[:60], "trajectory_file": str(output_path),
                     "cumulative_file": str(cumulative_path), "step_index": step_idx},
        })
        sys.stderr.write(f"[session] Step {step_idx} done (phase={phase_num})\n")
        sys.stderr.flush()

    while True:
        msg = await stdin_queue.get()
        if msg is None:
            break
        if isinstance(msg, dict) and msg.get("event") == "close":
            data = msg.get("data") or {}
            keep_browser = data.get("keep_browser", data.get("keepBrowser", False)) is True
            break

        try:
            action = await _dispatch_event(msg, session_state, intervention_queue, agent_running_ref, cdp_action_queue)
            cumulative_path = session_state['cumulative_path']

            # Handle immediate intervention when agent is idle
            if isinstance(action, tuple) and action[0] == 'intervene':
                step_index += 1
                await _run_step({"instruction": action[1], "max_steps": 20}, step_index)

            if action != 'step':
                continue

            step_index += 1
            data = msg.get("data", {})

            # Import case data on first step (inline dict preferred for remote executors)
            case_data_inline = data.get("case_data")
            case_data_file = data.get("case_data_file")
            if not case_data_loaded and (case_data_inline or case_data_file):
                try:
                    imported = {}
                    if isinstance(case_data_inline, dict):
                        imported = case_data_inline
                    elif case_data_file:
                        with open(case_data_file, 'r', encoding='utf-8') as f:
                            imported = json.load(f)
                    if isinstance(imported, dict) and imported:
                        case_data_store.update(imported)
                        case_data_loaded = True
                        src = "inline" if isinstance(case_data_inline, dict) else case_data_file
                        sys.stderr.write(f"[session] Imported case data ({len(imported)} keys) from {src}\n")
                        sys.stderr.flush()
                except Exception as e:
                    sys.stderr.write(f"[session] Failed to import case data: {e}\n")
                    sys.stderr.flush()

            await _run_step(data, step_index)

        except asyncio.CancelledError:
            sys.stderr.write("[session] Main loop cancelled, exiting\n");
            sys.stderr.flush()
            break
        except SystemExit:
            sys.stderr.write("[session] SystemExit received, exiting\n");
            sys.stderr.flush()
            break
        except BaseException as e:
            agent_running_ref['value'] = False
            sys.stderr.write(f"[session] Unexpected error in main loop: {type(e).__name__}: {e}\n");
            sys.stderr.flush()
            emit_json({"event": "error", "data": {"message": f"Unexpected error: {type(e).__name__}: {e}"}})

    reader_task.cancel()
    try:
        cdp_task.cancel()
    except Exception:
        pass
    try:
        await browser_context.close()
    except Exception:
        pass
    if keep_browser:
        # Soft close — leave Chromium on CDP (not the normal「释放资源」path).
        sys.stderr.write(
            f"[session] Leaving Chrome idle"
            + (f" on CDP port={cdp_port}" if cdp_port and not cdp_url else "")
            + (f" via {cdp_url}" if cdp_url else "")
            + "\n"
        )
        sys.stderr.flush()
    else:
        try:
            await browser.close()
        except Exception as e:
            sys.stderr.write(f"[session] WARN: browser.close failed: {e}\n")
            sys.stderr.flush()
        sys.stderr.write("[session] Browser closed, exiting\n")
        sys.stderr.flush()
