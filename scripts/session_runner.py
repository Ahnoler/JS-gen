"""
Interactive session mode for browser-use agent.
Reads JSON instructions from stdin, runs agent steps with SSE output.
"""
import sys
import asyncio
import json
import tempfile
import re
from datetime import datetime
from pathlib import Path

from browser_use import Agent, Browser
from browser_use.browser.context import BrowserContextConfig

from .agent_utils import (
    emit_json, extract_first_url, do_navigate,
    OVERRIDE_SYSTEM_MESSAGE, PLANNER_SYSTEM_PROMPT,
    patch_message_manager, create_llm, get_element_ui_knowledge,
    make_step_callback, make_done_callback,
)
from .controller import build_controller
from .recorder import build_recording_hooks
from .form_rules import load_rules


async def run_session(args):
    patch_message_manager()
    llm = create_llm(args.model, args.base_url)
    form_rules = load_rules()
    extend_system_message = get_element_ui_knowledge()

    browser = Browser()

    config = BrowserContextConfig(
        viewport_width=1920, viewport_height=1080,
        wait_for_network_idle_page_load_time=3.0
    )
    browser_context = await browser.new_context(config)

    session_id = args.session_id or "unknown"
    step_index = 0
    cumulative_path = Path(tempfile.gettempdir()) / f"browser_use_session_{session_id}_cumulative.json"
    cancel_flag_path = Path(tempfile.gettempdir()) / f"browser_use_cancel_{session_id}"
    goal_tracker = {'goals': [], 'stopped': False}
    case_data_ref = {'path': Path(tempfile.gettempdir()) / f"browser_use_session_{session_id}_case_data.json"}

    on_step_start_hook, on_step_end_hook = build_recording_hooks(goal_tracker, cancel_flag_path)
    controller = build_controller(browser_context, form_rules, case_data_ref)

    emit_json({"event": "ready", "session_id": session_id})
    sys.stderr.write(f"[session] Ready, session_id={session_id}\n")
    sys.stderr.flush()

    loop = asyncio.get_event_loop()
    stdin_queue = asyncio.Queue()
    agent_running = False

    # Note: make_step_callback and make_done_callback are imported from agent_utils

    async def stdin_reader():
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
            if agent_running and event in ("reset_trajectory", "cancel_step"):
                if event == "reset_trajectory":
                    # Will be handled after agent finishes
                    pass
                continue
            await stdin_queue.put(msg)

    reader_task = asyncio.create_task(stdin_reader())

    while True:
        msg = await stdin_queue.get()
        if msg is None:
            break

        try:
            event = msg.get("event")

            if event == "save_trajectory":
                if not cumulative_path.exists():
                    emit_json({"event": "save_trajectory_result", "data": {"success": False, "message": "No trajectory data available"}})
                    continue
                try:
                    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
                    trajectory_path = Path(tempfile.gettempdir()) / f"browser_use_session_{session_id}_ondemand_{ts}.json"
                    import shutil
                    shutil.copy(str(cumulative_path), trajectory_path)
                    with open(trajectory_path, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                        steps_count = len(data.get('history', []))
                    emit_json({
                        "event": "save_trajectory_result",
                        "data": {"success": True, "trajectory_file": str(trajectory_path), "steps": steps_count, "is_done": True, "is_successful": True},
                    })
                    sys.stderr.write(f"[session] Trajectory saved on demand: {trajectory_path}\n")
                    sys.stderr.flush()
                except Exception as e:
                    emit_json({"event": "save_trajectory_result", "data": {"success": False, "message": str(e)}})
                continue

            if event == "reset_trajectory":
                ts = datetime.now().strftime("%Y%m%d_%H%M%S")
                cumulative_path = Path(tempfile.gettempdir()) / f"browser_use_session_{session_id}_case_{ts}.json"
                case_data_ref['path'] = Path(tempfile.gettempdir()) / f"browser_use_session_{session_id}_case_data_{ts}.json"
                sys.stderr.write(f"[session] Trajectory + case data reset -> {cumulative_path}\n")
                sys.stderr.flush()
                emit_json({"event": "reset_trajectory_ready", "data": {"cumulative_file": str(cumulative_path)}})
                continue

            if event != "step":
                sys.stderr.write(f"[session] Unknown event: {event}\n")
                sys.stderr.flush()
                continue

            instruction = msg.get("data", {}).get("instruction", "")
            max_steps = msg.get("data", {}).get("max_steps", 40)
            if not instruction:
                emit_json({"event": "error", "data": {"message": "instruction is required"}})
                continue

            step_index += 1

            if cancel_flag_path.exists():
                try:
                    cancel_flag_path.unlink(missing_ok=True)
                except Exception:
                    pass

            emit_json({"event": "phase_start", "data": {"phase": step_index, "total": -1, "name": instruction[:60]}})
            sys.stderr.write(f"[session] Step {step_index}: {instruction[:80]} (max_steps={max_steps})\n")
            sys.stderr.flush()

            nav_url = extract_first_url(instruction)
            if nav_url:
                try:
                    page = await browser_context.get_current_page()
                    sys.stderr.write(f"[session] Navigating to {nav_url}\n"); sys.stderr.flush()
                    await do_navigate(page, nav_url)
                    sys.stderr.write(f"[session] Navigation done\n"); sys.stderr.flush()
                except Exception as e:
                    sys.stderr.write(f"[session navigate] Error: {e}\n"); sys.stderr.flush()

            agent_task = re.sub(r'^【目标URL】\s*\n\s*https?://[^\s\n]+[\s\n]*', '', instruction, count=1).strip() or instruction

            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_path = Path(tempfile.gettempdir()) / f"browser_use_session_{session_id}_step{step_index}_{ts}.json"
            goal_tracker['goals'] = []
            goal_tracker['stopped'] = False

            sys.stderr.write(f"[session] Creating Agent...\n"); sys.stderr.flush()
            agent = Agent(
                task=agent_task, llm=llm, controller=controller, browser_context=browser_context,
                override_system_message=OVERRIDE_SYSTEM_MESSAGE,
                extend_system_message=extend_system_message,
                use_vision=False, enable_memory=False,
                max_failures=2, retry_delay=5, max_actions_per_step=1, tool_calling_method="raw",
                planner_llm=llm, planner_interval=1,
                extend_planner_system_message=PLANNER_SYSTEM_PROMPT,
                register_new_step_callback=make_step_callback(step_index * 100),
                register_done_callback=make_done_callback(output_path),
            )
            sys.stderr.write(f"[session] Agent created, starting run...\n"); sys.stderr.flush()

            try:
                agent_running = True
                sys.stderr.write(f"[session] Calling agent.run() with max_steps={max_steps}\n"); sys.stderr.flush()
                await agent.run(max_steps=max_steps, on_step_start=on_step_start_hook, on_step_end=on_step_end_hook)
                sys.stderr.write(f"[session] Agent run completed\n"); sys.stderr.flush()
                if not hasattr(agent, '_done_fired') and hasattr(agent, 'history'):
                    output_path.parent.mkdir(parents=True, exist_ok=True)
                    agent.history.save_to_file(str(output_path))
            except asyncio.CancelledError:
                sys.stderr.write("[session] Agent run cancelled\n"); sys.stderr.flush()
                emit_json({"event": "phase_error", "data": {"phase": step_index, "name": instruction[:60], "message": "Agent run cancelled"}})
            except Exception as e:
                emit_json({"event": "phase_error", "data": {"phase": step_index, "name": instruction[:60], "message": str(e)}})
            finally:
                agent_running = False

            if output_path.exists():
                try:
                    with open(output_path, 'r', encoding='utf-8') as _f:
                        _step = json.load(_f)
                    _step_history = _step.get('history', [])
                    if _step_history:
                        if cumulative_path.exists():
                            with open(cumulative_path, 'r', encoding='utf-8') as _f:
                                _cum = json.load(_f)
                        else:
                            _cum = {'history': []}
                        _cum['history'].extend(_step_history)
                        cumulative_path.parent.mkdir(parents=True, exist_ok=True)
                        with open(cumulative_path, 'w', encoding='utf-8') as _f:
                            json.dump(_cum, _f, ensure_ascii=False, indent=2)
                        sys.stderr.write(f"[session] Accumulated {len(_step_history)} actions to case trajectory ({len(_cum['history'])} total)\n")
                        sys.stderr.flush()
                except Exception as _e:
                    sys.stderr.write(f"[session] Accumulate error: {_e}\n")
                    sys.stderr.flush()

            emit_json({
                "event": "phase_done",
                "data": {"phase": step_index, "total": -1, "name": instruction[:60], "trajectory_file": str(output_path), "cumulative_file": str(cumulative_path), "step_index": step_index},
            })
            sys.stderr.write(f"[session] Step {step_index} done\n")
            sys.stderr.flush()

        except asyncio.CancelledError:
            sys.stderr.write("[session] Main loop cancelled, exiting\n"); sys.stderr.flush()
            break
        except SystemExit:
            sys.stderr.write("[session] SystemExit received, exiting\n"); sys.stderr.flush()
            break
        except BaseException as e:
            sys.stderr.write(f"[session] Unexpected error in main loop: {type(e).__name__}: {e}\n"); sys.stderr.flush()
            emit_json({"event": "error", "data": {"message": f"Unexpected error: {type(e).__name__}: {e}"}})

    reader_task.cancel()
    try:
        await browser_context.close()
    except:
        pass
    sys.stderr.write("[session] Browser closed, exiting\n")
    sys.stderr.flush()
