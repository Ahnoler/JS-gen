"""
Interactive session mode for browser-use agent.
Reads JSON instructions from stdin, runs agent steps with SSE output.
"""
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
    patch_message_manager, patch_planner_prompt, create_llm,
    make_step_callback, make_done_callback,
)
from .controller import build_controller
from .recorder import build_recording_hooks
from .actions.form_rules import load_rules

_TRACE_DIR = str(Path(__file__).parent / "trace")

_last_agent = None


def _close_agent():
    global _last_agent
    if _last_agent is not None:
        try:
            for t in getattr(_last_agent, '_tasks', []):
                t.cancel()
        except Exception:
            pass
        _last_agent = None


def _handle_save_trajectory(cumulative_path, session_id, browser_context=None, case_data_store=None):
    """Save three files:
    - action_{ts}.json  — custom action format (for script_assembler.py)
    - traj_{ts}.json    — native AgentHistoryList format (for rerun_history)
    - log_{ts}.txt      — operation log (for LLM context)
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

        # File 3: traj_{ts}.json — native AgentHistoryList
        native_path = None
        _native = None
        sys.stderr.write(f"[save-trajectory] cumulative_path={cumulative_path}, exists={cumulative_path.exists() if cumulative_path else 'N/A'}\n")
        sys.stderr.flush()
        if cumulative_path and cumulative_path.exists():
            try:
                with open(cumulative_path, 'r', encoding='utf-8') as _f:
                    _native = json.load(_f)
                _history_len = len(_native.get('history', [])) if _native else 0
                sys.stderr.write(f"[save-trajectory] cumulative has history: {_history_len}\n")
                sys.stderr.flush()
                if _native.get('history'):
                    trajectories_dir = scripts_dir / 'trajectories'
                    trajectories_dir.mkdir(parents=True, exist_ok=True)
                    native_path = trajectories_dir / f"traj_{ts}.json"
                    sys.stderr.write(f"[save-trajectory] writing native_path={native_path}\n")
                    sys.stderr.flush()
                    with open(native_path, 'w', encoding='utf-8') as _f:
                        json.dump(_native, _f, ensure_ascii=False, indent=2)
                # ── 读完 cumulative 后立即删除（防重入：下一次 save 不会读到相同数据） ──
                try:
                    cumulative_path.unlink()
                except:
                    pass
            except Exception as _e:
                sys.stderr.write(f"[save-trajectory] native write error: {_e}\n")
                sys.stderr.flush()
        sys.stderr.write(f"[save-trajectory] entries={len(entries)}, rec_log_snapshot={len(rec_log_snapshot)}\n")
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
        native_count = len(_native.get('history', [])) if _native else 0
        _ACTION_LOG.clear()
        _recorder_log.clear()
        from .actions._state import _emit_action_log_sync
        _emit_action_log_sync()

        emit_json({
            "event": "save_trajectory_result",
            "data": {
                "success": True,
                "action_file": str(action_path) if action_path else None,
                "trajectory_file": str(native_path) if native_path else (str(action_path) if action_path else None),
                "log_file": str(log_path) if log_path else None,
                "action_count": action_count,
                "log_count": log_count,
                "native_count": native_count,
                "url": url,
            },
        })
        _fcounts = [s.get('count', 0) for s in snapshots] if snapshots else []
        _fstr = ', '.join(str(c) for c in _fcounts) if _fcounts else '0'
        sys.stderr.write(f"[session] Saved: action({action_count}) log({log_count}) trajectory({native_count}) form({_fstr})\n")
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


async def _stdin_reader(loop, stdin_queue, agent_running_ref):
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
            await stdin_queue.put(None)
            break
        if agent_running_ref['value'] and event == "cancel_step":
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

    if event == "replay_actions":
        entries = msg.get("data", {}).get("actions", [])
        browser_context = session_state.get('browser_context')
        form_rules = session_state.get('form_rules', [])
        case_data_store = session_state.get('case_data_store', {})
        if not browser_context or not entries:
            emit_json({"event": "replay_done", "data": {"count": 0, "error": "no browser_context or empty actions"}})
            return 'continue'
        from .actions._builder import build_controller
        controller = build_controller(browser_context, form_rules, case_data_store=case_data_store)
        actions = controller.registry.registry.actions
        total = len(entries)
        for i, entry in enumerate(entries):
            action_name = entry.get("action", "")
            raw_params = entry.get("params", {})
            params = _convert_action_params(action_name, raw_params)
            act = actions.get(action_name)
            if not act:
                sys.stderr.write(f"[replay] [{i+1}/{total}] Unknown action: {action_name}, skipping\n")
                sys.stderr.flush()
                continue
            sys.stderr.write(f"[replay] [{i+1}/{total}] {action_name} {params}\n")
            sys.stderr.flush()
            try:
                await act.function(**params)
            except Exception as e:
                sys.stderr.write(f"[replay] [{i+1}/{total}] Error: {action_name} {params} -> {e}\n")
                sys.stderr.flush()
            # ── Wait for page idle between actions ──
            try:
                page = await browser_context.get_current_page()
                await page.wait_for_load_state('networkidle', timeout=10000)
                from .actions._helpers import _wait_if_loading as _replay_wait
                await _replay_wait(page)
                await asyncio.sleep(0.3)
            except Exception:
                pass
        sys.stderr.write(f"[replay] Done: {total} actions executed\n")
        sys.stderr.flush()
        emit_json({"event": "replay_done", "data": {"count": total}})
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
    # TODO: 自愈重跑场景下，CDP 操作可用于快速重建页面场景（填写表单、点击按钮等），
    #       避免每次重跑都走完整的 AI 推理循环。见 browser-session.js rerun 路由的
    #       form_changes 参数，结合 CDP 操作可以精准修复字段级差异。
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
            case_data_store['_watcher_mode'] = True
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
            sys.stderr.write(f"[cdp-watcher] {action_name}{params} -> {result_str}\n")
            sys.stderr.flush()
            if req_id:
                emit_json({"event": "cdp_action_result", "id": req_id, "result": result_str, "error": None})
        except Exception as e:
            err_str = str(e)
            sys.stderr.write(f"[cdp-watcher] Error: {action_name}{params} -> {err_str}\n")
            sys.stderr.flush()
            if req_id:
                emit_json({"event": "cdp_action_result", "id": req_id, "result": None, "error": err_str})


async def run_session(args):
    patch_message_manager()
    patch_planner_prompt()
    llm = create_llm(args.model, args.base_url, getattr(args, 'api_key', None))
    form_rules = load_rules()

    cdp_url = getattr(args, 'cdp_url', None) or None
    if cdp_url:
        from browser_use.browser.browser import BrowserConfig
        sys.stderr.write(f"[session] Connecting to existing browser via CDP: {cdp_url}\n")
        sys.stderr.flush()
        browser = Browser(config=BrowserConfig(cdp_url=cdp_url))
    else:
        browser = Browser()

    config = BrowserContextConfig(
        viewport_width=1920, viewport_height=1080,
        wait_for_network_idle_page_load_time=3.0,
        trace_path=_TRACE_DIR,
    )
    browser_context = await browser.new_context(config)
    # When CDP is used, _create_context (called lazily by _initialize_session)
    # automatically reuses existing browser contexts from the partial script.

    session_id = args.session_id or "unknown"
    case_data_store = {}  # process-level in-memory store, persists across steps
    cancel_flag_path = Path(tempfile.gettempdir()) / f"browser_use_cancel_{session_id}"
    goal_tracker = {'goals': [], 'stopped': False}
    intervention_queue = asyncio.Queue()  # human intervention messages

    on_step_start_hook, on_step_end_hook = build_recording_hooks(goal_tracker, cancel_flag_path, intervention_queue, case_data_store)
    controller = build_controller(browser_context, form_rules, case_data_store, llm=llm)

    # Start CDP watcher — runs in-process, shares _ACTION_LOG and case_data_store
    cdp_action_queue = asyncio.Queue()
    cdp_task = asyncio.create_task(_run_cdp_watcher(browser_context, cdp_action_queue, case_data_store, form_rules))

    emit_json({"event": "ready", "session_id": session_id})
    sys.stderr.write(f"[session] Ready, session_id={session_id}\n")
    sys.stderr.flush()

    loop = asyncio.get_event_loop()
    stdin_queue = asyncio.Queue()
    agent_running_ref = {'value': False}

    reader_task = asyncio.create_task(_stdin_reader(loop, stdin_queue, agent_running_ref))

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

    async def _run_step(data, step_idx):
        """Execute one agent step with the given data."""
        nonlocal cumulative_path
        from .actions._state import set_current_phase
        set_current_phase(step_idx)
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
        _accumulate_trajectory(output_path, cumulative_path, step_idx)
        emit_json({
            "event": "phase_done",
            "data": {"phase": step_idx, "total": -1, "name": task_text[:60], "trajectory_file": str(output_path),
                     "cumulative_file": str(cumulative_path), "step_index": step_idx},
        })
        sys.stderr.write(f"[session] Step {step_idx} done\n")
        sys.stderr.flush()

    while True:
        msg = await stdin_queue.get()
        if msg is None:
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

            # Import case data from file on first step
            case_data_file = data.get("case_data_file")
            if case_data_file and not case_data_loaded:
                try:
                    with open(case_data_file, 'r', encoding='utf-8') as f:
                        imported = json.load(f)
                    case_data_store.update(imported)
                    case_data_loaded = True
                    sys.stderr.write(f"[session] Imported case data ({len(imported)} keys) from {case_data_file}\n")
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
        await browser_context.close()
    except:
        pass
    sys.stderr.write("[session] Browser closed, exiting\n")
    sys.stderr.flush()
