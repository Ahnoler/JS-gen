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
    parser.add_argument("--base-url", default="http://localhost:4097/v1")
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

# ========== Override system prompt (replaces browser_use default) ==========
OVERRIDE_SYSTEM_MESSAGE = """You are an AI agent controlling a browser on Element UI (Vue) applications.

# Input
Task, Previous steps, Current URL, Open Tabs, Interactive Elements
Elements: [index]<type>text</type> — only [] indexed elements are interactive. * means new.

# Response Format
{"current_state": {"evaluation_previous_goal": "Success|Failed|Unknown", "memory": "What's done, what remains. Count progress.", "next_goal": "Next immediate action"}, "action":[{"action_name": {params}}]}

Max 1 action per response.

# Action Selection
- el-select dropdown / any select: use select_option(label, option_text). Use "first" as option_text to pick first.
- text/password input: use fill_form_field(label, value). Matches by label, placeholder, or type.
- el-radio: use click_radio(label, option).
- el-dialog/drawer close: use close_dialog().
- el-tree: expand_all_el_tree() then click leaf.
- el-tabs: switch_tab(name).
- el-table rows: click_table_row_action(row_text, button).
- buttons, menus, links: click_element_by_index.
- loading: wait_for_loading().
- diagnostic: get_page_state().

# Form sequence
select_option → fill_form_field → click_element_by_index(save) → wait_for_loading

# Rules
- **Login page rule**: If URL contains "login" and the page has form fields (dropdown, input, password, button), you MUST fill ALL visible form fields AND click the login/submit button before calling done(). Login is complete only when the URL CHANGES away from the login page. The typical login sequence: select_option(dropdown) → fill_form_field(username) → fill_form_field(password) → click_element_by_index(login button) → wait_for_loading → check URL changed.
- If same action fails 2x, take screenshot and try different approach
- After menu click or submit: wait_for_loading() then verify content
- done() only when ALL task steps complete"""

# ========== Planner system prompt (used for all modes) ==========
PLANNER_SYSTEM_PROMPT = """CRITICAL:
1. Multi-step task tracker: count how many steps are needed vs completed. Only suggest done() when ALL steps are done.
2. Login = 4+ steps: select institution → username → password → click login → wait redirect.
3. Form filling = N fields + 1 submit + 1 wait. Track each field's completion status.
4. If progress < 100%, list remaining steps. Do NOT suggest done().
5. For multi-instruction phases, track each numbered instruction's completion separately.
6. Alert if the agent calls done() prematurely — explicitly list what remains incomplete."""


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


def create_llm(model, base_url):
    """Create a ChatOpenAI LLM instance."""
    from langchain_openai import ChatOpenAI
    return ChatOpenAI(model=model, base_url=base_url, api_key="sk-opencode", temperature=0.2)


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
