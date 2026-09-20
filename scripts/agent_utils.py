"""
Agent 工具函数模块。

本模块提供 browser-use-agent 各模块共享的工具函数，
包括参数解析、JSON 输出、LLM 创建、消息管理器修补等功能。
"""
import argparse
import json
import sys
import re
import os
from pathlib import Path

def parse_args():
    """
    解析命令行参数。

    返回：
        argparse.Namespace: 解析后的参数对象，包含：
            - model: 模型 ID（必需）
            - base_url: LLM 基础 URL
            - api_key: LLM API 密钥
            - output: 输出文件路径
            - playwright_output: Playwright 脚本输出路径
            - session: 是否使用会话模式
            - session_id: 会话 ID
            - cdp_url: CDP 连接 URL
            - cdp_port: CDP 端口号
    """
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
    """
    将数据以 JSON 格式输出到标准输出。

    参数：
        data (dict): 要输出的数据字典
    """
    sys.stdout.write(json.dumps(data, ensure_ascii=False) + "\n")
    sys.stdout.flush()

def extract_first_url(task):
    """
    从任务文本中提取第一个 URL。

    参数：
        task (str): 任务文本

    返回：
        str | None: 找到的第一个 URL，如果没有找到返回 None
    """
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
    """
    解析单步最大动作数（browser_use max_actions_per_step）。

    规则（与 Node 配置链一致）：
    1. instruction_value 非空（Node 显式传 MAX_ACTIONS_PER_STEP）→ 用之；
       0 / 空串 / None 视为未显式指定，不覆盖，继续走模式映射；
    2. 否则按 contract 模式映射：create/modify/introduce_pick → 5，
       navigate/query/login → 3，其它模式 → 默认 3；
    3. 结果 clamp 到 [1, 10]（框架默认 10 封顶）。

    参数：
        instruction_value: 指令值（来自 Node 配置）
        contract_mode (str, optional): 合约模式

    返回：
        tuple: (value, source) — source ∈ {'config', 'mode', 'default'}
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
    """
    执行页面导航。

    导航到指定 URL，处理 HTTPS-First 拦截页面，
    等待页面加载完成。

    参数：
        page: Playwright 页面对象
        url (str): 目标 URL
    """
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
    # 纯 HTTP 可能遇到 HTTPS-First 拦截页面（「此网站不支持安全连接」）
    bypass = await dismiss_https_first_interstitial(page)
    if bypass and bypass.startswith('proceeded'):
        # 继续后等待真实页面
        try:
            await page.wait_for_load_state('domcontentloaded', timeout=15000)
        except Exception:
            pass
        await dismiss_https_first_interstitial(page)
    await page.wait_for_timeout(2000)
    emit_json({"event": "nav_step", "data": {"step": 1, "label": "Page loaded"}})

# ========== 从外部 markdown 文件加载系统提示词 ==========
# 编辑 prompts/ 下的包文件或 agent-prompt.md 垫片来更改提示词
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_PACK_DIR = os.path.join(_SCRIPT_DIR, 'prompts')
_PROMPT_PATH = os.path.join(_PACK_DIR, 'agent-prompt.md')

# 解析 {{include}} 指令 —— 将 {{filename.md}} 替换为文件内容
_DIRECTIVE_RE = re.compile(r'\{\{([^}]+\.md)\}\}')

def _resolve_directives(text):
    """
    解析文本中的 {{include}} 指令。

    将 {{filename.md}} 替换为对应文件的内容。

    参数：
        text (str): 包含指令的文本

    返回：
        str: 解析后的文本
    """
    def _replacer(m):
        fname = m.group(1)
        fpath = os.path.join(_SCRIPT_DIR, fname)
        if os.path.exists(fpath):
            with open(fpath, 'r', encoding='utf-8') as _f:
                return _f.read().strip()
        return m.group(0)  # 回退：保持不变
    return _DIRECTIVE_RE.sub(_replacer, text)


def _read_pack(name: str) -> str:
    """
    读取提示词包文件。

    参数：
        name (str): 包文件名

    返回：
        str: 文件内容
    """
    path = os.path.join(_PACK_DIR, name)
    with open(path, 'r', encoding='utf-8') as f:
        return f.read().strip()


def build_agent_system_message(contract: dict | None = None) -> str:
    """
    根据阶段意图合约组装系统提示词。

    根据合约模式选择相应的提示词包组合：
    - heal 模式：仅恢复规则
    - navigate/query/introduce_pick/login/create/modify 模式：包含表格工具
    - introduce_pick/create/modify 模式：包含表单工具
    - create/modify 模式：包含树形工具
    - 未知模式：回退到完整包组合

    参数：
        contract (dict, optional): 阶段意图合约

    返回：
        str: 组装后的系统提示词
    """
    mode = (contract or {}).get('mode') if contract else None
    allow_assistant = bool((contract or {}).get('allow_form_assistant')) if contract else False

    packs = ['agent-core.md', 'agent-tools-common.md']

    # 修复模式：仅恢复规则 —— 无表单/表格/树形录制包
    if mode == 'heal':
        packs.append('agent-tools-heal.md')
    else:
        # 表格工具用于 navigate/query/introduce（行选择、图标按钮）
        # 和 create/modify（行编辑/删除、工具栏图标）
        if mode in ('navigate', 'query', 'introduce_pick', 'login', 'create', 'modify', None):
            packs.append('agent-tools-table.md')

        # 表单工具用于 introduce_pick 和 create/modify
        if mode in ('introduce_pick', 'create', 'modify') or allow_assistant:
            packs.append('agent-tools-form.md')

        # 树形工具用于 create/modify（默认）
        if mode in ('create', 'modify'):
            packs.append('agent-tools-tree.md')

        # 完整回退：未知模式或 None 合约
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


# 向后兼容的默认值：完整组装（所有包）
OVERRIDE_SYSTEM_MESSAGE = build_agent_system_message(None)

# 传统垫片文件（薄包含链 → 通过 _resolve_directives 完整组装）
with open(_PROMPT_PATH, 'r', encoding='utf-8') as _f:
    _prompt_content = _resolve_directives(_f.read()).strip()

# 规划器提示词：优先使用独立文件，回退到 agent-prompt.md 中的内联部分
_PLANNER_PATH = os.path.join(_SCRIPT_DIR, 'prompts', 'planner-prompt.md')
if os.path.exists(_PLANNER_PATH):
    with open(_PLANNER_PATH, 'r', encoding='utf-8') as _f:
        PLANNER_SYSTEM_PROMPT = _resolve_directives(_f.read()).strip()
else:
    _planner_idx = _prompt_content.find('# PLANNER SYSTEM PROMPT')
    PLANNER_SYSTEM_PROMPT = _prompt_content[_planner_idx:].strip() if _planner_idx != -1 else ''


def patch_planner_prompt():
    """
    猴子补丁 PlannerPrompt.get_system_message() 以使用 extend 作为覆盖。

    修改前：内置（硬编码）+ extended_planner_system_prompt（追加）
    修改后：extended_planner_system_prompt 作为完整替换（包含内置部分）

    这允许在 planner-prompt.md 中编辑完整的规划器提示词，
    而不受库的硬编码前缀干扰。
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
    """
    猴子补丁 MessageManager 以限制上下文大小，同时保留：
    - init / memory message_type
    - include_in_memory Action result/error human messages
    - tool/tool_calls 配对（最近消息）

    使用 ContextCompiler 进行裁剪，并上报丢弃明细审计。
    """
    from browser_use.agent.message_manager.service import MessageManager

    _original_get_messages = MessageManager.get_messages
    MAX_RECENT = 16

    def _msg_content_text(message) -> str:
        """
        提取消息文本内容。

        参数：
            message: 消息对象

        返回：
            str: 消息文本
        """
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
        """
        判断消息是否为 keepalive 消息。

        参数：
            managed: 管理的消息对象

        返回：
            bool: 如果是 init/memory 类型或 Action result/error 消息返回 True
        """
        meta = getattr(managed, 'metadata', None)
        mt = getattr(meta, 'message_type', None) if meta is not None else None
        if mt in ('init', 'memory'):
            return True
        text = _msg_content_text(getattr(managed, 'message', None)).lstrip()
        if text.startswith('Action result:') or text.startswith('Action error:'):
            return True
        return False

    def _patched_get_messages(self):
        """
        补丁后的 get_messages 方法。

        使用 ContextCompiler 进行消息窗口裁剪，上报丢弃明细。
        异常时回退到内联逻辑。
        """
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
            pass  # 回退到传统内联截断

        total = len(managed_list)
        if total <= MAX_RECENT + 2:
            return [m.message for m in managed_list]

        keep = set()
        for i, m in enumerate(managed_list):
            if _is_keepalive(m):
                keep.add(i)

        # 始终保留首条（system）
        keep.add(0)

        recent_start = max(0, total - MAX_RECENT)
        for i in range(recent_start, total):
            keep.add(i)

        # 确保 tool/tool_calls 配对：如果索引是 tool 消息，保留前一条
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
    """
    猴子补丁 BrowserContext.get_state() 在 DomService 扫描前
    将 el-tooltip aria-describedby 标记为 aria-label。

    图标触发器通常文本为空；browser-use 已在索引元素列表中
    显示 aria-label，因此将工具提示解析为 aria-label
    让 agent 识别「新增产品」等按钮。
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


def patch_dom_tree_js():
    """
    猴子补丁 DomService.__init__：原初始化后用本仓 vendor 副本覆写 self.js_code。

    生产事故 #910④：browser_use 0.1.48 自带 buildDomTree.js 的 isTopElement 在
    Element-UI 浮层（el-select tree-popover 等）展开时误判 el-dialog footer 元素
    非 top，不分配 index，agent 元素表缺确定钮。修复载体是
    scripts/vendor/browser_use/buildDomTree.js（上游包不受版本控制，见
    scripts/vendor/browser_use/buildDomTree.js 文件头同步须知）；本补丁在
    DomService 实例化后以副本全文覆写 js_code。

    - vendor 副本缺失/读取异常：stderr 写告警并保持 stock js_code，不抛错。
    - 幂等：重复调用不重复 wrap。
    """
    from browser_use.dom.service import DomService

    if getattr(DomService.__init__, '_agent_domtree_patched', False):
        return

    _vendor_path = os.path.join(_SCRIPT_DIR, 'vendor', 'browser_use', 'buildDomTree.js')
    _original_init = DomService.__init__

    def _patched_init(self, *args, **kwargs):
        _original_init(self, *args, **kwargs)
        try:
            with open(_vendor_path, 'r', encoding='utf-8') as f:
                js = f.read()
            self.js_code = js
        except Exception as e:
            sys.stderr.write(
                f'[agent-domtree-patch] vendor buildDomTree.js unavailable, using stock js: {type(e).__name__}: {e}\n'
            )
            sys.stderr.flush()

    _patched_init._agent_domtree_patched = True
    DomService.__init__ = _patched_init


def create_llm(model, base_url, api_key=None, timeout=None):
    """
    创建 LLM 客户端。

    参数：
        model (str): 模型 ID
        base_url (str): LLM 基础 URL
        api_key (str, optional): API 密钥，从环境变量获取
        timeout (float, optional): 超时时间（秒）

    返回：
        ChatOpenAI: LLM 客户端实例
    """
    from langchain_openai import ChatOpenAI
    effective_key = api_key or os.getenv("OPENAI_API_KEY") or os.getenv("LLM_API_KEY")
    if not base_url:
        print("Error: --base-url or LLM_BASE_URL env is required", file=sys.stderr)
        sys.exit(1)
    if not effective_key:
        print("Error: --api-key, OPENAI_API_KEY, or LLM_API_KEY env is required", file=sys.stderr)
        sys.exit(1)
    kwargs = dict(model=model, base_url=base_url, api_key=effective_key, temperature=0.2)
    if timeout is not None:
        kwargs['timeout'] = timeout
    return ChatOpenAI(**kwargs)


def make_step_callback(phase_offset=0):
    """
    创建步骤回调函数。

    参数：
        phase_offset (int): 阶段偏移量，默认为 0

    返回：
        callable: 步骤回调函数
    """
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
        except Exception as e:
            sys.stderr.write(f'[step-callback] on_step_end emit failed: {type(e).__name__}: {e}\n')
            sys.stderr.flush()
    return on_step_end


def make_done_callback(output_path, business_data_store=None):
    """
    创建完成回调函数。

    参数：
        output_path (Path): 输出文件路径
        business_data_store (dict, optional): 业务数据存储，
            提供时设置 business_data_store['_done_fired'] = True

    返回：
        callable: 完成回调函数
    """
    def on_done(history_list):
        try:
            if business_data_store is not None:
                business_data_store['_done_fired'] = True
            output_path.parent.mkdir(parents=True, exist_ok=True)
            history_list.save_to_file(str(output_path))
            emit_json({"event": "done", "data": {"output_file": str(output_path), "steps": len(history_list.history), "is_done": history_list.is_done(), "is_successful": history_list.is_successful(), "final_result": history_list.final_result(), "errors": history_list.errors()}})
        except Exception as e:
            sys.stderr.write(f'[done-callback] on_done emit failed: {type(e).__name__}: {e}\n')
            sys.stderr.flush()
    return on_done
