"""
Workflow and single-task runners for browser-use agent.
"""
import json
import asyncio
import tempfile
import time
import sys
from datetime import datetime
from pathlib import Path

from browser_use import Agent, Browser
from browser_use.browser.context import BrowserContextConfig

from .agent_utils import (
    emit_json, extract_first_url, do_navigate,
    OVERRIDE_SYSTEM_MESSAGE, PLANNER_SYSTEM_PROMPT,
    make_step_callback, make_done_callback,
)
from .controller import build_controller
from .recorder import build_recording_hooks


async def run_workflow(args, llm, form_rules, extend_system_message):
    """Run a multi-phase workflow from a JSON file."""
    browser = Browser()
    config = BrowserContextConfig(
        viewport_width=1920, viewport_height=1080,
        wait_for_network_idle_page_load_time=3.0
    )
    browser_context = await browser.new_context(config)
    controller = build_controller(browser_context, form_rules)

    on_step_start_hook, on_step_end_hook = build_recording_hooks()

    pw_path_base = None
    if args.playwright_output:
        pw_path_base = Path(args.playwright_output)
        pw_path_base.parent.mkdir(parents=True, exist_ok=True)

    with open(args.workflow, 'r', encoding='utf-8') as f:
        phases = json.load(f)

    total = len(phases)
    all_trajectories = []

    for idx, phase in enumerate(phases):
        phase_num = idx + 1
        phase_name = phase.get('name', f'Phase {phase_num}')
        phase_task = phase.get('task', '')
        max_steps = phase.get('maxSteps', 40)

        emit_json({"event": "phase_start", "data": {"phase": phase_num, "total": total, "name": phase_name}})

        # Navigate on first phase if URL present
        if idx == 0:
            nav_url = extract_first_url(phase_task)
            if nav_url:
                try:
                    page = await browser_context.get_current_page()
                    await do_navigate(page, nav_url)
                except Exception as e:
                    emit_json({"event": "error", "data": {"message": f"Navigation failed: {e}"}})

        phase_output = Path(tempfile.gettempdir()) / (
            f"browser_use_phase{phase_num}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        )
        step_offset = idx * 100

        pw_script_path = None
        if pw_path_base:
            pw_script_path = str(pw_path_base.parent / f"phase{phase_num}_script.py")

        agent = Agent(
            task=phase_task, llm=llm, controller=controller, browser_context=browser_context,
            override_system_message=OVERRIDE_SYSTEM_MESSAGE,
            extend_system_message=extend_system_message,
            use_vision=False, enable_memory=False,
            max_failures=5, retry_delay=10,
            planner_llm=llm, planner_interval=3,
            extend_planner_system_message=PLANNER_SYSTEM_PROMPT,
            register_new_step_callback=make_step_callback(step_offset),
            register_done_callback=make_done_callback(phase_output),
            save_playwright_script_path=pw_script_path,
        )

        try:
            await agent.run(max_steps=max_steps, on_step_start=on_step_start_hook, on_step_end=on_step_end_hook)
        except Exception as e:
            emit_json({"event": "phase_error", "data": {"phase": phase_num, "name": phase_name, "message": str(e)}})

        all_trajectories.append(str(phase_output))
        emit_json({"event": "phase_done", "data": {"phase": phase_num, "total": total, "name": phase_name}})

    emit_json({
        "event": "workflow_done",
        "data": {
            "total_phases": total,
            "trajectories": all_trajectories,
            "message": "All phases completed",
        },
    })

    await browser_context.close()
    sys.stdout.flush()
    sys.stderr.flush()


async def run_single_task(args, llm, form_rules, extend_system_message):
    """Run a single task."""
    browser = Browser()
    config = BrowserContextConfig(
        viewport_width=1920, viewport_height=1080,
        wait_for_network_idle_page_load_time=3.0
    )
    browser_context = await browser.new_context(config)
    controller = build_controller(browser_context, form_rules)

    on_step_start_hook, on_step_end_hook = build_recording_hooks()

    # Navigate if URL present
    nav_url = extract_first_url(args.task)
    if nav_url:
        try:
            page = await browser_context.get_current_page()
            await do_navigate(page, nav_url)
        except Exception as e:
            emit_json({"event": "error", "data": {"message": f"Navigation failed: {e}"}})

    output_path = Path(
        args.output
        or Path(tempfile.gettempdir()) / f"browser_use_trajectory_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    )

    pw_path_str = None
    if args.playwright_output:
        pw_path_base = Path(args.playwright_output)
        pw_path_base.parent.mkdir(parents=True, exist_ok=True)
        pw_path_str = str(pw_path_base)

    agent = Agent(
        task=args.task, llm=llm, controller=controller, browser_context=browser_context,
        override_system_message=OVERRIDE_SYSTEM_MESSAGE,
        extend_system_message=extend_system_message,
        use_vision=False, enable_memory=False,
        max_failures=5, retry_delay=10,
        planner_llm=llm, planner_interval=3,
        extend_planner_system_message=PLANNER_SYSTEM_PROMPT,
        register_new_step_callback=make_step_callback(10),
        register_done_callback=make_done_callback(output_path),
        save_playwright_script_path=pw_path_str,
    )

    try:
        await agent.run(max_steps=100, on_step_start=on_step_start_hook, on_step_end=on_step_end_hook)
    except Exception as e:
        emit_json({"event": "error", "data": {"message": f"Agent run failed: {e}"}})

    await browser_context.close()
    sys.stdout.flush()
    sys.stderr.flush()
