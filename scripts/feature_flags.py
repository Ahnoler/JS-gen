"""
特性开关模块。

本模块管理 agent / recorder / replay 的所有 Python 侧布尔行为开关。
所有开关通过环境变量驱动，支持灰度发布。

环境变量设置方式：通过进程环境变量或 config/.env 文件设置。

布尔值解析规则：
- 未设置 → 使用默认值
- 'false' / '0' / 'off' / 'no' → False
- 其他任何值 → True
"""

from __future__ import annotations

import os
from pathlib import Path

_CONFIG_ENV = Path(__file__).resolve().parents[1] / 'config' / '.env'


def dotenv_value(text: str, name: str) -> str | None:
    """Return the last assignment of name in dotenv text, ignoring comments."""
    prefix = name + '='
    found = None
    for line in str(text or '').splitlines():
        trimmed = line.strip()
        if not trimmed or trimmed.startswith('#') or not trimmed.startswith(prefix):
            continue
        value = trimmed[len(prefix):].strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
            value = value[1:-1].strip()
        found = value
    return found


def _config_env_value(name: str) -> str | None:
    """Read one key from config/.env. Missing file or key returns None."""
    try:
        text = _CONFIG_ENV.read_text(encoding='utf-8')
    except OSError:
        return None
    return dotenv_value(text, name)


def _env_flag(name: str, default: bool = True) -> bool:
    """
    从环境变量读取布尔标志。

    参数：
        name (str): 环境变量名称
        default (bool): 默认值，默认为 True

    返回：
        bool: 解析后的布尔值
    """
    raw = os.environ.get(name)
    if raw is None or str(raw).strip() == '':
        return default
    return str(raw).strip().lower() not in ('0', 'false', 'no', 'off')


def relative_xpath_primary_enabled() -> bool:
    """
    检查相对 XPath 主定位器是否启用。

    环境变量：RELATIVE_XPATH_PRIMARY（默认开启）

    当关闭时：主定位器回退到绝对 xpath_full；xpath_smart 仍存储在候选列表中。
    回放时跳过 xpath_smart 优先匹配。
    """
    return _env_flag('RELATIVE_XPATH_PRIMARY', True)


def xpath_smart_fill_only_enabled() -> bool:
    """
    检查 xpath_smart 填充模式是否启用。

    环境变量：XPATH_SMART_FILL_ONLY（默认关闭）

    当关闭时（默认）：测试人员保留 label-DOM 回退，如果 scan/resolve 未找到 xpath。
    当开启时：fill_form_field 等拒绝仅 label 填充 —— 要求 xpath_smart。
    """
    return _env_flag('XPATH_SMART_FILL_ONLY', False)


def phase_preamble_enabled() -> bool:
    """
    检查阶段前言是否启用。

    环境变量：AI_PHASE_PREAMBLE（默认开启）

    启用时，在阶段开始前组装【业务场景】前序阶段块。
    """
    return _env_flag('AI_PHASE_PREAMBLE', True)


def memory_whitelist_enabled() -> bool:
    """
    检查记忆白名单是否启用。

    环境变量：AI_MEMORY_WHITELIST（默认开启）

    启用时，关键操作的 ActionResult.include_in_memory 标记生效。
    """
    return _env_flag('AI_MEMORY_WHITELIST', True)


def scenario_describer_enabled() -> bool:
    """
    检查场景描述器是否启用。

    环境变量：AI_SCENARIO_DESCRIBER（默认开启）

    启用时，在 agent 步骤开始时注入业务场景摘要。
    """
    return _env_flag('AI_SCENARIO_DESCRIBER', True)


def phase_intent_contract_enabled() -> bool:
    """
    检查阶段意图契约是否启用。

    环境变量：AI_PHASE_INTENT_CONTRACT（默认开启）

    启用时，AI 录制使用阶段意图硬契约。
    """
    return _env_flag('AI_PHASE_INTENT_CONTRACT', True)


def phase_boundary_enabled() -> bool:
    """
    检查阶段边界是否启用。

    环境变量：AI_PHASE_BOUNDARY（默认开启）

    启用时（默认），录制使用 _phase_boundary 作为权威；传统 _phase_intent 从中适配。
    设置 AI_PHASE_BOUNDARY=off 回退到仅使用边界前的意图契约。
    """
    return _env_flag('AI_PHASE_BOUNDARY', True)


def scenario_describer_interval() -> int:
    """
    获取场景描述器运行间隔。

    环境变量：SCENARIO_DESCRIBER_INTERVAL（默认 3）

    每 N 个 agent 微步骤运行一次场景 LLM。

    返回：
        int: 运行间隔，最小为 1，默认为 3
    """
    raw = os.environ.get('SCENARIO_DESCRIBER_INTERVAL')
    if raw is None or str(raw).strip() == '':
        return 3
    try:
        n = int(str(raw).strip())
    except (TypeError, ValueError):
        return 3
    return n if n >= 1 else 3

def memory_events_enabled() -> bool:
    """
    检查记忆事件是否启用。

    环境变量：AI_MEMORY_EVENTS（默认开启）

    启用时，记忆事件旁路摄取（只写不读）。
    """
    return _env_flag('AI_MEMORY_EVENTS', True)


def memory_fact_pack_enabled() -> bool:
    """
    检查事实包注入是否启用。

    环境变量：AI_MEMORY_FACT_PACK（默认关闭）

    启用时，P1 阶段的事实包注入生效。
    """
    return _env_flag('AI_MEMORY_FACT_PACK', True)


def memory_decisions_enabled() -> bool:
    """
    检查 LLM 决策记录是否启用。

    环境变量：AI_MEMORY_DECISIONS（默认开启）

    启用时，记录 LLM 的决策过程。
    """
    return _env_flag('AI_MEMORY_DECISIONS', True)


def phase_reviewer_enabled() -> bool:
    """
    检查阶段审查器是否启用。

    环境变量：AI_PHASE_REVIEWER（默认开启）

    启用时，每个阶段进行 LLM 契约审查。
    """
    return _env_flag('AI_PHASE_REVIEWER', True)


def phase_reviewer_timeout_s() -> float:
    """
    获取阶段审查器超时时间。

    环境变量：AI_PHASE_REVIEWER_TIMEOUT_S（默认 20.0 秒）

    返回：
        float: 超时时间（秒），最小为 1.0
    """
    raw = os.environ.get('AI_PHASE_REVIEWER_TIMEOUT_S')
    if raw is None or str(raw).strip() == '':
        return 20.0
    try:
        return max(1.0, float(str(raw).strip()))
    except (TypeError, ValueError):
        return 20.0


def form_batch_heartbeat_enabled() -> bool:
    """
    检查表单批量心跳是否启用。

    环境变量：AI_FORM_BATCH_HEARTBEAT（默认开启）

    启用时，在表单批量 LLM 生成期间发送 form_batch_started/done 占位事件，
    保持 WebSocket 链路活跃，防止 NAT/LB 空闲回收导致半开连接。
    """
    return _env_flag('AI_FORM_BATCH_HEARTBEAT', True)

def duplicate_failure_cue_enabled() -> bool:
    """
    检查重复失败提示是否启用。

    环境变量：AI_DUP_FAILURE_CUE（默认关闭）

    启用时，在重复相同失败操作时注入 [纠偏] 提示。
    """
    return _env_flag('AI_DUP_FAILURE_CUE', False)

def kb_flow_inject_enabled() -> bool:
    """
    检查 KB 流程注入是否启用。

    环境变量：AI_KB_FLOW_INJECT（默认开启）

    启用时，阶段开始时自动注入 kb_flow 流程卡摘要。
    """
    return _env_flag('AI_KB_FLOW_INJECT', True)


def click_nav_cue_enabled() -> bool:
    """
    检查点击导航提示是否启用。

    环境变量：AI_CLICK_NAV_CUE（默认开启）

    启用时，当索引点击导航到新页面时注入 [导航] 提示。
    """
    return _env_flag('AI_CLICK_NAV_CUE', True)


def step_notice_scan_enabled() -> bool:
    """
    检查步骤通知扫描是否启用。

    环境变量：AI_STEP_NOTICE_SCAN（默认开启）

    启用时，每个 agent 步骤后扫描可见的 toast/notification 到记忆中。
    轻量级一次性 DOM 扫描（使用 __notify_log 游标），不是新的业务端
    MutationObserver 架构。去重确保同一 toast 不会被重复注入。
    """
    return _env_flag('AI_STEP_NOTICE_SCAN', True)


def record_gate_cue_enabled() -> bool:
    """
    检查录制门禁一行提示是否启用。

    环境变量：AI_RECORD_GATE_CUE（默认开启）

    启用时，每个录制步骤开始前注入一行 [门禁] 结论。不看图，不改 done 判定。
    """
    return _env_flag('AI_RECORD_GATE_CUE', True)


def record_vision_enabled() -> bool:
    """
    检查录制旁路识图是否启用。

    配置：config/.env 的 AI_RECORD_VISION（true 开，false 关）。
    进程环境变量同名键优先于文件。两处都没有时默认开启。

    启用时，结束复核与高风险点击在落步前可以单独看一张视口。调用失败则当没看。
    不看图的 [门禁] 一行由 AI_RECORD_GATE_CUE 单独控制。
    """
    raw = os.environ.get('AI_RECORD_VISION')
    if raw is None or str(raw).strip() == '':
        raw = _config_env_value('AI_RECORD_VISION')
    if raw is None or str(raw).strip() == '':
        return True
    return str(raw).strip().lower() not in ('0', 'false', 'no', 'off')
