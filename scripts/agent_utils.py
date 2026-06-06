"""
Agent utility functions shared across browser-use-agent modules.
"""
import argparse
import json
import sys
import re
import os
from pathlib import Path

def parse_args():
    parser = argparse.ArgumentParser(description="Browser Use Agent")
    parser.add_argument("--task", help="Task description")
    parser.add_argument("--workflow", help="Path to workflow JSON file (array of {name, task, maxSteps})")
    parser.add_argument("--model", required=True, help="Model ID")
    parser.add_argument("--base-url", default=os.getenv("LLM_BASE_URL"), help="LLM base URL (or set LLM_BASE_URL env)")
    parser.add_argument("--api-key", default=None, help="LLM API key (or set OPENAI_API_KEY env)")
    parser.add_argument("--output", default=None)
    parser.add_argument("--playwright-output", default=None, help="Path to save generated Playwright script (.py)")
    parser.add_argument("--session", action="store_true", help="Run in session mode (stdin/stdout interactive)")
    parser.add_argument("--session-id", default=None, help="Session ID (for trajectory file naming)")
    return parser.parse_args()

def emit_json(data):
    sys.stdout.write(json.dumps(data, ensure_ascii=False) + "\n")
    sys.stdout.flush()

def extract_first_url(task):
    urls = re.findall(r'https?://[^\s\n]+', task)
    return urls[0] if urls else None

async def do_navigate(page, url):
    emit_json({"event": "nav_step", "data": {"step": 0, "label": "Navigating to target URL"}})
    try:
        await page.goto(url, wait_until='networkidle', timeout=60000)
    except:
        try:
            await page.goto(url, wait_until='load', timeout=30000)
        except:
            await page.goto(url, timeout=30000)
    await page.wait_for_timeout(2000)
    emit_json({"event": "nav_step", "data": {"step": 1, "label": "Page loaded"}})

# ========== Override system prompt ==========
# Replaces browser_use default to support custom Element UI controller actions.
# The default prompt mentions input_text/select_dropdown_option which we exclude,
# so we override with instructions tuned for the custom actions.
OVERRIDE_SYSTEM_MESSAGE = """You are an AI agent that controls a browser to automate tasks on web applications — especially Element UI (Vue) based apps.

# Input
- Task (the goal)
- Previous steps and their results
- Current URL, Open Tabs
- Interactive Elements: [index]<type>text</type> — only indexed elements are clickable/interactable

# Response Format — JSON ONLY, no extra text
{"current_state": {"evaluation_previous_goal": "Success|Failed|Unknown — short why",
"memory": "Track progress: what's done, what remains, count iterations (e.g. 2/5 fields filled)",
"next_goal": "The single next action to take"},
"action": [{"action_name": {params}}]}

You can output MULTIPLE actions in one response, but only if they can all succeed without the page changing between them (e.g. filling multiple form fields in sequence).

# Available Actions
## Default browser actions (always available)
- click_element(index) — click element by its [] index
- input_text(index, text) — type text into an input field (by element index)
- select_dropdown_option(index, option) — select from a native <select>
- go_to_url(url), go_back(), scroll(down|up), send_keys(keys)
- wait(ms) — wait milliseconds
- extract_content(goal) — extract page content
- done(text, success) — call ONLY when task is fully complete

## Element UI custom actions (use these for Element UI components)
- select_option(label_text, option_text) — el-select dropdowns. "first" picks first item.
- fill_form_field(label_text, value) — text/password inputs inside el-form-item. Matches by label text, placeholder, or input type.
- click_radio(label_text, option_text) — el-radio groups
- close_dialog() — close topmost el-dialog/el-drawer
- expand_all_el_tree() — fully expand el-tree
- switch_tab(tab_name) — switch el-tabs tab
- click_menu_item(menu_text) — click el-menu item (auto-expands submenus)
- click_table_row_action(row_text, button_text) — click el-table row button
- wait_for_loading() — wait until Element UI loading mask disappears
- get_page_state() — diagnostics

# TASK COMPLETION RULES (CRITICAL)
1. Use done() ONLY when the ENTIRE task is finished. Do NOT call done() after a single action if more work remains.
2. Track progress in "memory": count completed vs remaining steps. E.g. "Step 1/5: logged in. Step 2/5: navigating to form."
3. For numbered instructions (1., 2., 3.), complete EVERY numbered item before done().
4. Login sequence is ALWAYS: select institution → fill username → fill password → click login → wait redirect → verify URL changed. Never stop mid-login.
5. If an action fails twice, try a different approach (screenshot, get_page_state, alternative selector).
6. After any submit/menu-click, call wait_for_loading() before proceeding.
7. Keep trying until max steps reached — only then call done(success=false).

# NAVIGATION & ERRORS
- Navigate first, then wait for page load. Use extract_content to understand the page.
- If stuck, go_back(), try a new tab, or use a different approach.
- Handle popups/cookies by closing them.
- Always scroll to find elements if they're not visible."""

# ========== Planner system prompt ==========
PLANNER_SYSTEM_PROMPT = """You are a planner. Your job is to evaluate progress and prevent premature task completion.

CRITICAL RULES:
1. Count all required steps. Only recommend done() when every single step is finished.
2. Login always takes 4+ steps: (1) select institution, (2) fill username, (3) fill password, (4) click login, (5) wait for redirect.
3. Form filling = N fields + submit + wait. Track each field.
4. If any numbered instruction remains undone, list it explicitly and DO NOT recommend done().
5. If the agent calls done() prematurely, ALERT — explicitly list what remains incomplete.
6. Progress evaluation must be specific: "3/5 fields filled, submit pending" not just "80% complete"."""


def get_element_ui_knowledge(script_dir=None):
    """Load element-ui-knowledge.md if available."""
    if script_dir is None:
        script_dir = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(script_dir, 'element-ui-knowledge.md')
    if os.path.exists(path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()
            return content
        except Exception:
            return None
    return None


def patch_message_manager():
    """Monkey-patch MessageManager to limit context size."""
    from browser_use.agent.message_manager.service import MessageManager
    
    _original_get_messages = MessageManager.get_messages
    MAX_RECENT = 12
    
    def _patched_get_messages(self):
        msgs = _original_get_messages(self)
        total = len(msgs)
        if total <= MAX_RECENT + 2:
            return msgs
        trimmed = msgs[:2] + msgs[-(MAX_RECENT):]
        return trimmed
    
    MessageManager.get_messages = _patched_get_messages


def create_llm(model, base_url, api_key=None):
    from langchain_openai import ChatOpenAI
    effective_key = api_key or os.getenv("OPENAI_API_KEY") or os.getenv("LLM_API_KEY")
    if not base_url:
        print("Error: --base-url or LLM_BASE_URL env is required", file=sys.stderr)
        sys.exit(1)
    if not effective_key:
        print("Error: --api-key, OPENAI_API_KEY, or LLM_API_KEY env is required", file=sys.stderr)
        sys.exit(1)
    return ChatOpenAI(model=model, base_url=base_url, api_key=effective_key, temperature=0.2)


def make_step_callback(phase_offset=0):
    """Create a step callback that emits JSON events."""
    def on_step_end(browser_state, agent_output, step_num):
        try:
            if agent_output is None: return
            thinking = getattr(agent_output, 'current_state', None) or {}
            next_goal = getattr(thinking, 'next_goal', '') if hasattr(thinking, 'next_goal') else ''
            if not next_goal:
                next_goal = getattr(agent_output, 'next_goal', None) or ''
            actions = getattr(agent_output, 'action', None) or []
            action_names = [list(a.keys())[0] if isinstance(a, dict) else str(a) for a in actions]
            emit_json({"event": "step", "data": {"step": phase_offset + step_num, "url": getattr(browser_state, 'url', '') if browser_state else '', "next_goal": next_goal[:200], "actions": action_names}})
        except:
            pass
    return on_step_end


def make_done_callback(output_path):
    """Create a done callback that saves trajectory and emits JSON event."""
    def on_done(history_list):
        try:
            output_path.parent.mkdir(parents=True, exist_ok=True)
            history_list.save_to_file(str(output_path))
            emit_json({"event": "done", "data": {"output_file": str(output_path), "steps": len(history_list.history), "is_done": history_list.is_done(), "is_successful": history_list.is_successful(), "final_result": history_list.final_result(), "errors": history_list.errors()}})
        except:
            pass
    return on_done
