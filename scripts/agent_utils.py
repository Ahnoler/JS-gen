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
    parser.add_argument("--cdp-url", default=None, help="Connect to existing browser via CDP (ws://...). Used for self-healing.")
    return parser.parse_args()

def emit_json(data):
    sys.stdout.write(json.dumps(data, ensure_ascii=False) + "\n")
    sys.stdout.flush()

def extract_first_url(task):
    urls = re.findall(r'https?://[^\s\n]+', task)
    return urls[0] if urls else None

async def do_navigate(page, url):
    from . import controller as ctrl_mod
    ctrl_mod._TRAJECTORY_URL = url
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

# ========== Load system prompts from external markdown file ==========
# Edit agent-prompt.md instead of this file to change prompts.
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_PROMPT_PATH = os.path.join(_SCRIPT_DIR, 'prompts', 'agent-prompt.md')

with open(_PROMPT_PATH, 'r', encoding='utf-8') as _f:
    _prompt_content = _f.read()

# Resolve {{include}} directives — replace {{filename.md}} with file content
_DIRECTIVE_RE = re.compile(r'\{\{([^}]+\.md)\}\}')
def _resolve_directives(text):
    def _replacer(m):
        fname = m.group(1)
        fpath = os.path.join(_SCRIPT_DIR, fname)
        if os.path.exists(fpath):
            with open(fpath, 'r', encoding='utf-8') as _f:
                return _f.read().strip()
        return m.group(0)  # fallback: leave unchanged
    return _DIRECTIVE_RE.sub(_replacer, text)

_prompt_content = _resolve_directives(_prompt_content)
OVERRIDE_SYSTEM_MESSAGE = _prompt_content.strip()

# Planner prompt: prefer standalone file, fall back to inline section in agent-prompt.md
_PLANNER_PATH = os.path.join(_SCRIPT_DIR, 'prompts', 'planner-prompt.md')
if os.path.exists(_PLANNER_PATH):
    with open(_PLANNER_PATH, 'r', encoding='utf-8') as _f:
        PLANNER_SYSTEM_PROMPT = _resolve_directives(_f.read()).strip()
else:
    _planner_idx = _prompt_content.find('# PLANNER SYSTEM PROMPT')
    PLANNER_SYSTEM_PROMPT = _prompt_content[_planner_idx:].strip() if _planner_idx != -1 else ''


def patch_message_manager():
    """Monkey-patch MessageManager to limit context size while preserving tool/tool_calls pairing."""
    from browser_use.agent.message_manager.service import MessageManager
    
    _original_get_messages = MessageManager.get_messages
    MAX_RECENT = 12
    
    def _patched_get_messages(self):
        msgs = _original_get_messages(self)
        total = len(msgs)
        if total <= MAX_RECENT + 2:
            return msgs
        tail = msgs[-(MAX_RECENT):]
        # Ensure tool/tool_calls pairing: if tail starts with a tool message,
        # include its preceding assistant message to avoid breaking the pair
        first = tail[0]
        role = getattr(first, 'role', '') or getattr(first, 'type', '')
        if role == 'tool':
            start = max(2, total - MAX_RECENT - 1)
        else:
            start = total - MAX_RECENT
        trimmed = msgs[:2] + msgs[start:]
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
