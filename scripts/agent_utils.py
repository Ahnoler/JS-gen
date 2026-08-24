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
    parser.add_argument("--model", required=True, help="Model ID")
    parser.add_argument("--base-url", default=os.getenv("LLM_BASE_URL"), help="LLM base URL (or set LLM_BASE_URL env)")
    parser.add_argument("--api-key", default=None, help="LLM API key (or set OPENAI_API_KEY env)")
    parser.add_argument("--output", default=None)
    parser.add_argument("--playwright-output", default=None, help="Path to save generated Playwright script (.py)")
    parser.add_argument("--session", action="store_true", help="Run in session mode (stdin/stdout interactive)")
    parser.add_argument("--session-id", default=None, help="Session ID (for trajectory file naming)")
    parser.add_argument("--cdp-url", default=None, help="Connect to existing browser via CDP (ws://...). Used for self-healing.")
    parser.add_argument(
        "--cdp-port",
        type=int,
        default=None,
        help="Chrome remote-debugging port when launching a new browser (per executor slot; default browser_use 9242)",
    )
    return parser.parse_args()

def emit_json(data):
    sys.stdout.write(json.dumps(data, ensure_ascii=False) + "\n")
    sys.stdout.flush()

def extract_first_url(task):
    urls = re.findall(r'https?://[^\s\n]+', task)
    return urls[0] if urls else None


# 批量动作预算：contract 模式 → 单步最大动作数（browser_use max_actions_per_step）
# 填表/维护/引入阶段字段多为独立输入，允许 5 个连续动作；导航/查询/登录等
# DOM 结构易变阶段收敛到 3，控制批内定位过期与整轮重试成本。
_MODE_MAX_ACTIONS = {
    'create': 5,
    'modify': 5,
    'introduce_pick': 5,
    'navigate': 3,
    'query': 3,
    'login': 3,
}

_DEFAULT_MAX_ACTIONS = 3


def resolve_max_actions_per_step(instruction_value, contract_mode=None):
    """解析单步最大动作数（browser_use max_actions_per_step）。

    规则（与 Node 配置链一致）：
    1. instruction_value 非空（Node 显式传 MAX_ACTIONS_PER_STEP）→ 用之；
       0 / 空串 / None 视为未显式指定，不覆盖，继续走模式映射；
    2. 否则按 contract 模式映射：create/modify/introduce_pick → 5，
       navigate/query/login → 3，其它模式 → 默认 3；
    3. 结果 clamp 到 [1, 10]（框架默认 10 封顶）。

    Returns: (value, source) — source ∈ {'config', 'mode', 'default'}。
    """
    if instruction_value not in (None, ''):
        try:
            explicit = int(instruction_value)
        except (TypeError, ValueError):
            explicit = 0
        if explicit:
            return max(1, min(10, explicit)), 'config'
    mode_default = _MODE_MAX_ACTIONS.get(contract_mode)
    if mode_default is not None:
        return mode_default, 'mode'
    return _DEFAULT_MAX_ACTIONS, 'default'


async def do_navigate(page, url):
    from . import controller as ctrl_mod
    from .controller.actions._helpers import dismiss_https_first_interstitial
    ctrl_mod._TRAJECTORY_URL = url
    emit_json({"event": "nav_step", "data": {"step": 0, "label": "Navigating to target URL"}})
    try:
        await page.goto(url, wait_until='networkidle', timeout=60000)
    except Exception:
        try:
            await page.goto(url, wait_until='load', timeout=30000)
        except Exception:
            await page.goto(url, timeout=30000)
    # Plain HTTP may land on HTTPS-First interstitial («此网站不支持安全连接»).
    bypass = await dismiss_https_first_interstitial(page)
    if bypass and bypass.startswith('proceeded'):
        # After proceed, wait for real page
        try:
            await page.wait_for_load_state('domcontentloaded', timeout=15000)
        except Exception:
            pass
        await dismiss_https_first_interstitial(page)
    await page.wait_for_timeout(2000)
    emit_json({"event": "nav_step", "data": {"step": 1, "label": "Page loaded"}})

# ========== Load system prompts from external markdown file ==========
# Edit pack files under prompts/ or agent-prompt.md shim to change prompts.
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_PACK_DIR = os.path.join(_SCRIPT_DIR, 'prompts')
_PROMPT_PATH = os.path.join(_PACK_DIR, 'agent-prompt.md')

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


def _read_pack(name: str) -> str:
    path = os.path.join(_PACK_DIR, name)
    with open(path, 'r', encoding='utf-8') as f:
        return f.read().strip()


def build_agent_system_message(contract: dict | None = None) -> str:
    """Assemble system prompt from packs based on phase intent contract."""
    mode = (contract or {}).get('mode') if contract else None
    allow_assistant = bool((contract or {}).get('allow_form_assistant')) if contract else False

    packs = ['agent-core.md', 'agent-tools-common.md']

    # Heal mode: recovery rules only — no form/table/tree recording packs.
    if mode == 'heal':
        packs.append('agent-tools-heal.md')
    else:
        # Table tools for navigate/query/introduce (row selection, icon buttons)
        # and create/modify (row edit/delete, toolbar icons)
        if mode in ('navigate', 'query', 'introduce_pick', 'login', 'create', 'modify', None):
            packs.append('agent-tools-table.md')

        # Form pack for introduce_pick and create/modify
        if mode in ('introduce_pick', 'create', 'modify') or allow_assistant:
            packs.append('agent-tools-form.md')

        # Tree pack for create/modify (default)
        if mode in ('create', 'modify'):
            packs.append('agent-tools-tree.md')

        # Full fallback: unknown mode or None contract
        if mode not in ('login', 'navigate', 'query', 'introduce_pick', 'create', 'modify'):
            packs = [
                'agent-core.md',
                'agent-tools-common.md',
                'agent-tools-form.md',
                'agent-tools-table.md',
                'agent-tools-tree.md',
            ]

    parts = [_read_pack(p) for p in packs]
    return '\n\n'.join(parts)


# Backward-compatible default: full assembly (all packs)
OVERRIDE_SYSTEM_MESSAGE = build_agent_system_message(None)

# Legacy shim file (thin include chain → full assembly via _resolve_directives)
with open(_PROMPT_PATH, 'r', encoding='utf-8') as _f:
    _prompt_content = _resolve_directives(_f.read()).strip()

# Planner prompt: prefer standalone file, fall back to inline section in agent-prompt.md
_PLANNER_PATH = os.path.join(_SCRIPT_DIR, 'prompts', 'planner-prompt.md')
if os.path.exists(_PLANNER_PATH):
    with open(_PLANNER_PATH, 'r', encoding='utf-8') as _f:
        PLANNER_SYSTEM_PROMPT = _resolve_directives(_f.read()).strip()
else:
    _planner_idx = _prompt_content.find('# PLANNER SYSTEM PROMPT')
    PLANNER_SYSTEM_PROMPT = _prompt_content[_planner_idx:].strip() if _planner_idx != -1 else ''


def patch_planner_prompt():
    """Monkey-patch PlannerPrompt.get_system_message() to use extend as override.

    Before: built-in (hardcoded) + extended_planner_system_prompt (appended)
    After:  extended_planner_system_prompt as full replacement (includes built-in part)

    This allows editing the full Planner prompt in planner-prompt.md
    without the library's hardcoded prefix interfering.
    """
    from browser_use.agent.prompts import PlannerPrompt

    _original_get_system_message = PlannerPrompt.get_system_message

    def _patched_get_system_message(self, is_planner_reasoning=False, extended_planner_system_prompt=None):
        from langchain_core.messages import HumanMessage, SystemMessage

        if extended_planner_system_prompt:
            planner_prompt_text = extended_planner_system_prompt
        else:
            planner_prompt_text = """
You are a planning agent that helps break down tasks into smaller steps and reason about the current state.
Your role is to:
1. Analyze the current state and history
2. Evaluate progress towards the ultimate goal
3. Identify potential challenges or roadblocks
4. Suggest the next high-level steps to take

Inside your messages, there will be AI messages from different agents with different formats.

Your output format should be always a JSON object with the following fields:
{{
    "state_analysis": "Brief analysis of the current state and what has been done so far",
    "progress_evaluation": "Evaluation of progress towards the ultimate goal (as percentage and description)",
    "challenges": "List any potential challenges or roadblocks",
    "next_steps": "List 2-3 concrete next steps to take",
    "reasoning": "Explain your reasoning for the suggested next steps"
}}

Ignore the other AI messages output structures.

Keep your responses concise and focused on actionable insights.
"""

        if is_planner_reasoning:
            return HumanMessage(content=planner_prompt_text)
        else:
            return SystemMessage(content=planner_prompt_text)

    PlannerPrompt.get_system_message = _patched_get_system_message


def patch_message_manager():
    """Monkey-patch MessageManager to limit context size while preserving:
    - init / memory message_type
    - include_in_memory Action result/error human messages
    - tool/tool_calls pairing for recent messages
    """
    from browser_use.agent.message_manager.service import MessageManager

    _original_get_messages = MessageManager.get_messages
    MAX_RECENT = 16

    def _msg_content_text(message) -> str:
        content = getattr(message, 'content', None)
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = []
            for item in content:
                if isinstance(item, dict) and item.get('type') == 'text':
                    parts.append(str(item.get('text') or ''))
                elif isinstance(item, str):
                    parts.append(item)
            return '\n'.join(parts)
        return ''

    def _is_keepalive(managed) -> bool:
        meta = getattr(managed, 'metadata', None)
        mt = getattr(meta, 'message_type', None) if meta is not None else None
        if mt in ('init', 'memory'):
            return True
        text = _msg_content_text(getattr(managed, 'message', None)).lstrip()
        if text.startswith('Action result:') or text.startswith('Action error:'):
            return True
        return False

    def _patched_get_messages(self):
        history = getattr(getattr(self, 'state', None), 'history', None)
        managed_list = getattr(history, 'messages', None) if history is not None else None
        if not managed_list:
            return _original_get_messages(self)

        # P1：走 ContextCompiler —— 同裁剪逻辑 + 丢弃明细审计；
        # compiler 异常时回退下方内联逻辑（保持旧行为可用）。
        try:
            from .context_compiler import (
                compile_message_window,
                emit_context_drop,
                message_window_budget,
            )
            max_recent = message_window_budget()
            kept_messages, dropped_detail = compile_message_window(
                managed_list,
                max_recent=max_recent,
                is_keepalive=_is_keepalive,
            )
            if dropped_detail:
                from scripts.memory.writer import emit_memory_event
                emit_context_drop(
                    emit_memory_event,
                    dropped_detail,
                    len(managed_list),
                    len(kept_messages),
                    max_recent,
                )
            return kept_messages
        except Exception:
            pass  # fall through to legacy inline truncation

        total = len(managed_list)
        if total <= MAX_RECENT + 2:
            return [m.message for m in managed_list]

        keep = set()
        for i, m in enumerate(managed_list):
            if _is_keepalive(m):
                keep.add(i)

        # Always keep the first message (system)
        keep.add(0)

        recent_start = max(0, total - MAX_RECENT)
        for i in range(recent_start, total):
            keep.add(i)

        # Ensure tool/tool_calls pairing: if an index is a tool message, keep predecessor
        for i in sorted(keep):
            msg = managed_list[i].message
            role = getattr(msg, 'role', '') or getattr(msg, 'type', '')
            class_name = type(msg).__name__
            if role == 'tool' or class_name == 'ToolMessage':
                if i > 0:
                    keep.add(i - 1)

        indices = sorted(keep)
        dropped = total - len(indices)

        # P0：上下文裁剪可审计 —— 丢弃数量写入外部记忆（feature flag 控制）
        if dropped > 0:
            try:
                from scripts.memory.writer import emit_memory_event
                emit_memory_event(
                    'context_drop',
                    {'dropped_messages': dropped, 'total': total, 'kept': len(indices), 'max_recent': MAX_RECENT},
                    source='system',
                )
            except Exception:
                pass

        return [managed_list[i].message for i in indices]

    MessageManager.get_messages = _patched_get_messages


def patch_icon_tooltip_labels():
    """Before DomService scans, stamp aria-label from el-tooltip aria-describedby.

    Icon-only triggers often have empty text; browser-use already surfaces
    aria-label in the indexed element list, so resolving tooltips into
    aria-label lets the agent recognize buttons like 「新增产品」.
    """
    from browser_use.browser.context import BrowserContext
    from .controller.actions._js_snippets import JS_STAMP_ICON_ARIA_LABELS

    _original_get_state = BrowserContext.get_state

    async def _patched_get_state(self, cache_clickable_elements_hashes: bool):
        try:
            page = await self.get_current_page()
            await page.evaluate(JS_STAMP_ICON_ARIA_LABELS)
        except Exception:
            pass
        return await _original_get_state(self, cache_clickable_elements_hashes)

    BrowserContext.get_state = _patched_get_state


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


def make_done_callback(output_path, case_data_store=None):
    """Create a done callback that saves trajectory and emits JSON event.

    When case_data_store is provided, sets case_data_store['_done_fired'] = True
    so the quality gate can detect whether done() was triggered.
    """
    def on_done(history_list):
        try:
            if case_data_store is not None:
                case_data_store['_done_fired'] = True
            output_path.parent.mkdir(parents=True, exist_ok=True)
            history_list.save_to_file(str(output_path))
            emit_json({"event": "done", "data": {"output_file": str(output_path), "steps": len(history_list.history), "is_done": history_list.is_done(), "is_successful": history_list.is_successful(), "final_result": history_list.final_result(), "errors": history_list.errors()}})
        except:
            pass
    return on_done
