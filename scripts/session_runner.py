"""
Interactive session mode for browser-use agent.
Reads JSON instructions from stdin, runs agent steps with SSE output.
"""
import os
import sys
import asyncio
import json
import tempfile
from pathlib import Path

from browser_use.browser.context import BrowserContextConfig

from .agent_utils import (
    emit_json,
    patch_message_manager, patch_planner_prompt, patch_icon_tooltip_labels, create_llm,
)
from .controller import build_controller
from .recorder import build_recording_hooks

from .agent.service import (
    _close_agent,  # noqa: F401  (re-exported for compat)
    _request_agent_stop,  # noqa: F401
    _run_agent_step,  # noqa: F401
)
from .browser.factory import (  # noqa: F401  (re-exported for compat)
    _build_browser,
    _bypass_ssl_interstitial_if_any,
    _chrome_automation_args,
    _chrome_headless_enabled,
    _dismiss_native_js_dialogs,
    _fit_browser_window,
    _ignore_certificate_errors,
    _resolve_chromium_executable,
    _seed_chrome_profile,
    _session_window_size,
)
from .cdp_ports import (  # noqa: F401  (re-exported for compat)
    _pick_free_cdp_port,
    _port_is_connectable,
    _probe_cdp_ws_url,
    _wait_cdp_http,
    wait_cdp_http,
)
from .event_dispatch import _dispatch_event  # noqa: F401
from .trajectory_store import (  # noqa: F401  (re-exported for compat)
    _accumulate_trajectory,
    _handle_reset_trajectory,
    _handle_save_business_data,
    _handle_save_trajectory,
)

# Phase-state-key emission for phase-group shot capture: remember the last phase so
# the first step of a NEW phase reports its state key (phase 开始即采第一张).
_last_phase_state_key_phase: int | None = None


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
            sys.stderr.write(f"Invalid JSON: {line[:100]}\n")
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
        if event == "phase_shot_candidate_result":
            # Agent 运行期间主循环被 await agent.run() 阻塞，ack 无法经主循环到达；
            # 在此直接解包 future（未知/迟到 ack 静默丢弃），避免 click_save 等满 timeout。
            try:
                from .state import resolve_phase_shot_result
                resolve_phase_shot_result(msg.get("data") or {})
            except Exception:
                pass
            continue
        await stdin_queue.put(msg)


async def _run_cdp_watcher(browser_context, action_queue, business_data_store):
    """In-process quick-action executor — uses the same browser_context as the Agent.

    Shares _ACTION_LOG and business_data_store with the main Agent, so all actions
    executed through this watcher are recorded for script assembly.
    No separate CDP connection needed — actions run on the same Playwright context.
    """
    from .controller.service import build_controller

    # TODO: 如果将来改用 raw Playwright context（如从 CDP 连接），
    #       必须手动注入 get_current_page()，否则 controller action 会报错。
    #       参考 scripts/cdp/watcher.py:69-70:
    #         ctx = browser.contexts[0]
    #         ctx.get_current_page = _get_page
    # Self-heal scene reproduce uses replay_actions → _replay.replay_action_entries
    # (see browser-session.js /rerun), not this CDP watcher loop.
    ctrl = build_controller(browser_context, business_data_store=business_data_store)
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
            from .state import set_current_source
            business_data_store['_watcher_mode'] = True
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
                business_data_store['_watcher_mode'] = False
                set_current_source('agent')
            sys.stderr.write(f"[cdp-watcher] {action_name}{params} -> {result_str}\n")
            sys.stderr.flush()
            from .state import _ACTION_LOG
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
                from .state import set_current_source
                set_current_source('agent')
                business_data_store['_watcher_mode'] = False
            except Exception:
                pass
            if req_id:
                emit_json({"event": "cdp_action_result", "id": req_id, "result": None, "error": err_str, "entry": None})


def _env_llm_timeout_sec():
    """Read LLM_TIMEOUT_MS env → seconds; <=0 → None (no timeout)."""
    raw = os.getenv('LLM_TIMEOUT_MS', '').strip()
    if not raw:
        return None
    try:
        ms = float(raw)
    except (TypeError, ValueError):
        return None
    if ms <= 0:
        return None
    return ms / 1000.0

async def _ensure_browser_and_cdp(cdp_url, cdp_port, session_id):
    """browser/CDP 启动段（原 run_session 内 217-241 / 273-288 段逐字搬移）。

    构建 Playwright 浏览器与 browser_context（窗口尺寸/无 viewport/忽略证书/
    适配窗口/原生弹窗关闭/SSL 拦截旁路），并急启 Chrome 会话；随后等待 CDP HTTP
    就绪并探测 ws URL（外部 cdp_url 直连时直接标记就绪）。
    返回 (browser, browser_context, cdp_port, cdp_ready, cdp_ws_url)。
    """
    browser, cdp_port, _ = await _build_browser(
        cdp_url=cdp_url,
        cdp_port=cdp_port,
        session_id=session_id,
    )

    # window_width/height (not viewport_*) — browser_use ignores unknown fields.
    # Keep normal window at BiB default size (do not maximize to screen).
    win_w, win_h = _session_window_size()
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
    await _fit_browser_window(browser_context, win_w, win_h)
    await _dismiss_native_js_dialogs(browser_context)
    await _bypass_ssl_interstitial_if_any(browser_context)

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
                f"WARN: CDP HTTP still not ready on port {cdp_port} after launch. "
                "BiB canvas unavailable; AI/manual recording can still run.\n"
            )
            sys.stderr.flush()
    return browser, browser_context, cdp_port, cdp_ready, cdp_ws_url


async def _teardown_session(browser, browser_context, reader_task, cdp_task, cdp_port, cdp_url, keep_browser):
    """会话关停段（原 run_session 内 489-522 段逐字搬移）。

    取消 stdin/cdp watcher 任务并等待退出、登记 session-end 终截、关闭
    browser_context，再按 keep_browser 决定软关闭（留 CDP）或硬关闭；
    异常路径与 finally 顺序与原 run_session 保持一致。
    """
    reader_task.cancel()
    cdp_task.cancel()
    await asyncio.gather(reader_task, cdp_task, return_exceptions=True)
    # 会话结束最终截图：正常 / error / cancel / SystemExit 退出路径统一在此捕获
    # 当前页面（capturedAt='session-end'）；截图失败静默，不阻塞关闭。
    try:
        from .state import register_current_page_screenshot
        await register_current_page_screenshot(browser_context, captured_at='session-end')
        sys.stderr.write('[session-end] final screenshot registered\n')
        sys.stderr.flush()
    except Exception as exc:
        sys.stderr.write('[session-end] FAILED: ' + type(exc).__name__ + ': ' + str(exc) + '\n')
        sys.stderr.flush()
    try:
        await browser_context.close()
    except Exception:
        pass
    if keep_browser:
        # Soft close — leave Chromium on CDP (not the normal「释放资源」path).
        sys.stderr.write(
            f"Leaving Chrome idle"
            + (f" on CDP port={cdp_port}" if cdp_port and not cdp_url else "")
            + (f" via {cdp_url}" if cdp_url else "")
            + "\n"
        )
        sys.stderr.flush()
    else:
        try:
            await browser.close()
        except Exception as e:
            sys.stderr.write(f"WARN: browser.close failed: {e}\n")
            sys.stderr.flush()
        sys.stderr.write("Browser closed, exiting\n")
        sys.stderr.flush()


async def run_session(args):
    patch_message_manager()
    patch_planner_prompt()
    patch_icon_tooltip_labels()
    llm = create_llm(args.model, args.base_url, getattr(args, 'api_key', None), timeout=_env_llm_timeout_sec())

    session_id = args.session_id or "unknown"

    # P0：初始化外部记忆 writer（异步批量上报，失败不阻塞 Agent）
    from scripts.memory.writer import (
        configure as configure_memory_writer,
        start as start_memory_writer,
        flush as flush_memory_writer,
        shutdown as shutdown_memory_writer,
    )
    configure_memory_writer(session_id=session_id, model=getattr(args, 'model', None))
    start_memory_writer()

    cdp_url = getattr(args, 'cdp_url', None) or None
    cdp_port = getattr(args, 'cdp_port', None)
    if cdp_port is not None:
        try:
            cdp_port = int(cdp_port)
        except (TypeError, ValueError):
            cdp_port = None

    browser, browser_context, cdp_port, cdp_ready, cdp_ws_url = await _ensure_browser_and_cdp(
        cdp_url, cdp_port, session_id,
    )

    business_data_store = {}  # process-level in-memory store, persists across steps
    special_element_candidates_store = {}  # replaced each phase; AI may only use these ids
    cancel_flag_path = Path(tempfile.gettempdir()) / f"browser_use_cancel_{session_id}"
    goal_tracker = {'goals': [], 'stopped': False}

    on_step_start_hook, on_step_end_hook = build_recording_hooks(
        goal_tracker, cancel_flag_path, business_data_store,
    )
    controller = build_controller(
        browser_context,
        business_data_store=business_data_store,
        llm=llm,
        special_element_candidates_store=special_element_candidates_store,
    )

    # Start CDP watcher — runs in-process, shares _ACTION_LOG and business_data_store
    cdp_action_queue = asyncio.Queue()
    cdp_task = asyncio.create_task(_run_cdp_watcher(browser_context, cdp_action_queue, business_data_store))

    def _on_cdp_task_done(t):
        """记录 cdp watcher 任务异常退出，避免无人观测的静默死亡。"""
        if t.cancelled():
            return
        exc = t.exception()
        if exc is not None:
            sys.stderr.write(f"[cdp-watcher] task exited: {type(exc).__name__}: {exc}\n")
            sys.stderr.flush()

    cdp_task.add_done_callback(_on_cdp_task_done)

    # cdp_ready / cdp_ws_url already computed by _ensure_browser_and_cdp above;
    # do not re-wait CDP HTTP here (worst case doubled the 45s readiness wait).

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
        f"Ready, session_id={session_id}"
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
        'business_data_store': business_data_store,
        'special_element_candidates_store': special_element_candidates_store,
        'browser_context': browser_context,
    }

    business_data_loaded = False
    keep_browser = False  # 「释放资源」默认关浏览器；keep_browser=True 才留 CDP

    async def _run_step(data, step_idx):
        """Execute one agent step with the given data."""
        nonlocal cumulative_path
        from .state import register_current_page_screenshot, set_current_phase
        # Prefer client-provided phase_number (matches 【阶段N】); fallback to step_idx
        phase_num = data.get("phase_number")
        if phase_num is None:
            phase_num = data.get("phaseNumber")
        try:
            phase_num = int(phase_num) if phase_num is not None else int(step_idx)
        except (TypeError, ValueError):
            phase_num = step_idx
        set_current_phase(phase_num)
        # 新阶段第一步（agent 运行前）：上报当前状态键 → 控制面开组采集第一张。
        global _last_phase_state_key_phase
        if _last_phase_state_key_phase != phase_num:
            _last_phase_state_key_phase = phase_num
            try:
                from .state import current_page_level
                _phase_state_key, _phase_state_name = await current_page_level(browser_context)
            except Exception:
                _phase_state_key = ''
            emit_json({
                "event": "phase_state_key",
                "data": {
                    "phase": phase_num,
                    "entryId": '',
                    "beforeKey": _phase_state_key,
                    "afterKey": _phase_state_key,
                },
            })
        agent_running_ref['value'] = True
        try:
            output_path, task_text = await _run_agent_step(
                data, step_idx, session_id, args, llm, browser_context,
                controller, goal_tracker, cancel_flag_path,
                on_step_start_hook, on_step_end_hook, business_data_store, cumulative_path,
                special_element_candidates_store=special_element_candidates_store,
            )
        finally:
            agent_running_ref['value'] = False
        if output_path is None:
            return
        # Native AgentHistory accumulate disabled (scripts/trajectories/*.json no longer saved).
        # Temp per-step history files may still exist under %TEMP%; not copied to repo.
        try:
            from .state import register_current_page_screenshot
            await register_current_page_screenshot(browser_context)
        except Exception:
            pass

        phase_done_data: dict = {
            "phase": phase_num,
            "total": -1,
            "name": task_text[:60],
            "trajectory_file": str(output_path),
            "cumulative_file": str(cumulative_path),
            "step_index": step_idx,
        }
        try:
            from .controller.actions._phase_context import _outcome_for
            outcome = _outcome_for(business_data_store, phase_num)
            if outcome:
                if 'success' in outcome:
                    phase_done_data['success'] = outcome['success']
                if outcome.get('text'):
                    phase_done_data['text'] = outcome['text']
            else:
                # No accepted done() → unknown (not success). Control plane must not
                # coerce missing success to true.
                phase_done_data['success'] = None
        except Exception:
            pass
        emit_json({
            "event": "phase_done",
            "data": phase_done_data,
        })
        # Human log: Phase N (【阶段N】); fall back to step ordinal when phase unset/0.
        display_phase = phase_num if isinstance(phase_num, int) and phase_num > 0 else step_idx
        sys.stderr.write(f"Phase {display_phase} done\n\n")
        sys.stderr.flush()

    while True:
        msg = await stdin_queue.get()
        if msg is None:
            break
        if isinstance(msg, dict) and msg.get("event") == "close":
            data = msg.get("data") or {}
            keep_browser = data.get("keep_browser", data.get("keepBrowser", False)) is True
            break

        # phase_shot_candidate_result 正常由 _stdin_reader 快路径解包；主循环兜底处理
        #（例如消息在 reader 忙时仍入列的场景），未知 requestId 由 resolve 静默丢弃。
        if isinstance(msg, dict) and msg.get("event") == "phase_shot_candidate_result":
            try:
                from .state import resolve_phase_shot_result
                resolve_phase_shot_result(msg.get("data") or {})
            except Exception as e:
                sys.stderr.write(f"phase_shot_candidate_result resolve failed: {type(e).__name__}: {e}\n")
                sys.stderr.flush()
            continue

        try:
            action = await _dispatch_event(msg, session_state, agent_running_ref, cdp_action_queue)
            cumulative_path = session_state['cumulative_path']

            if action != 'step':
                continue

            step_index += 1
            data = msg.get("data", {})

            # 业务数据 from the user requirement (soft NL), not 案例数据 from the system.
            # Prefer business_data_block → _business_scenario_text for the agent; flat business_data
            # is optional. See prepareCaseDataInjection terminology note.
            business_data_inline = data.get("business_data")
            business_data_file = data.get("business_data_file")
            business_data_block = data.get("business_data_block") or data.get("businessDataBlock")
            if isinstance(business_data_block, str) and business_data_block.strip():
                business_data_store['_business_scenario_text'] = business_data_block.strip()
                sys.stderr.write(
                    f"Business scenario text ready ({len(business_data_block.strip())} chars)\n"
                )
                sys.stderr.flush()
            if not business_data_loaded and (business_data_inline or business_data_file):
                try:
                    imported = {}
                    if isinstance(business_data_inline, dict):
                        imported = business_data_inline
                    elif business_data_file:
                        with open(business_data_file, 'r', encoding='utf-8') as f:
                            imported = json.load(f)
                    if isinstance(imported, dict) and imported:
                        business_data_store.update(imported)
                        business_data_loaded = True
                        src = "inline" if isinstance(business_data_inline, dict) else business_data_file
                        sys.stderr.write(f"Imported business data ({len(imported)} keys) from {src}\n")
                        sys.stderr.flush()
                except Exception as e:
                    sys.stderr.write(f"Failed to import business data: {e}\n")
                    sys.stderr.flush()

            await _run_step(data, step_index)

        except asyncio.CancelledError:
            sys.stderr.write("Main loop cancelled, exiting\n");
            sys.stderr.flush()
            break
        except SystemExit:
            sys.stderr.write("SystemExit received, exiting\n");
            sys.stderr.flush()
            break
        except BaseException as e:
            agent_running_ref['value'] = False
            sys.stderr.write(f"Unexpected error in main loop: {type(e).__name__}: {e}\n");
            sys.stderr.flush()
            emit_json({"event": "error", "data": {"message": f"Unexpected error: {type(e).__name__}: {e}"}})

    await _teardown_session(browser, browser_context, reader_task, cdp_task, cdp_port, cdp_url, keep_browser)

    # P0：退出前冲刷记忆队列（不等待太久，避免拖慢关闭）
    flush_memory_writer(timeout=2.0)
