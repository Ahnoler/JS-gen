"""ContextCompiler v1 — 上下文窗口预算裁剪 + 丢弃审计明细。

替代 patch_message_manager 的内联截断：保留 keepalive / 最近 N 条 / tool 配对
逻辑不变，但每次裁剪产出结构化 dropped 明细（index / role / preview），随
context_drop 事件上报 —— 丢弃可见、可审计（设计文档 §5.5）。

P1 边界：事实包 / 任务块 / 合约已在 preamble 组装（P1 最小切片），本模块只
负责消息窗口层；预算上限经 AI_MEMORY_MAX_RECENT 可配（默认 16，与旧行为一致）。
"""

from __future__ import annotations

import os

_MAX_RECENT_DEFAULT = 16
_MAX_DROPPED_ITEMS_REPORT = 20  # 明细上报条数上限（避免事件载荷过大）


def message_window_budget() -> int:
    """最近消息保留条数（AI_MEMORY_MAX_RECENT，默认 16 保持旧行为）。"""
    try:
        return max(4, int(os.getenv('AI_MEMORY_MAX_RECENT', str(_MAX_RECENT_DEFAULT))))
    except (TypeError, ValueError):
        return _MAX_RECENT_DEFAULT


def msg_preview(message, limit=80) -> str:
    """取消息文本前 N 字（审计用，不进模型上下文）。"""
    content = getattr(message, 'content', None)
    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        parts = []
        for p in content:
            if isinstance(p, dict) and p.get('type') == 'text':
                parts.append(str(p.get('text') or ''))
            elif isinstance(p, str):
                parts.append(p)
        text = '\n'.join(parts)
    else:
        text = str(content or '')
    return ' '.join(text.split())[:limit]


def compile_message_window(managed_list, *, max_recent=None, is_keepalive=None):
    """裁剪消息窗口，返回 (kept_messages, dropped_detail)。

    dropped_detail: [{index, role, preview}] —— 每条被裁消息的审计明细。
    is_keepalive: 可调用对象（msg → bool），None 时只保留首条 system。
    """
    if max_recent is None:
        max_recent = message_window_budget()
    total = len(managed_list)
    if total <= max_recent + 2:
        return [m.message for m in managed_list], []

    keep = set()
    for i, m in enumerate(managed_list):
        if is_keepalive is not None and is_keepalive(m):
            keep.add(i)
    # 始终保留首条（system）
    keep.add(0)

    recent_start = max(0, total - max_recent)
    for i in range(recent_start, total):
        keep.add(i)

    # 保证 tool/tool_calls 配对：tool 消息的前一条必须保留
    for i in sorted(keep):
        msg = managed_list[i].message
        role = getattr(msg, 'role', '') or getattr(msg, 'type', '')
        class_name = type(msg).__name__
        if role == 'tool' or class_name == 'ToolMessage':
            if i > 0:
                keep.add(i - 1)

    indices = sorted(keep)
    dropped_detail = []
    for i, m in enumerate(managed_list):
        if i in keep:
            continue
        msg = m.message
        role = getattr(msg, 'role', '') or getattr(msg, 'type', '')
        dropped_detail.append({
            'index': i,
            'role': str(role),
            'preview': msg_preview(msg),
        })
    return [managed_list[i].message for i in indices], dropped_detail


def emit_context_drop(emit, dropped_detail, total, kept_count, max_recent):
    """上报 context_drop 事件（含明细；emit 为 scripts.memory.writer.emit_memory_event）。"""
    if not dropped_detail:
        return
    try:
        emit(
            'context_drop',
            {
                'dropped_messages': len(dropped_detail),
                'total': total,
                'kept': kept_count,
                'max_recent': max_recent,
                'dropped_items': dropped_detail[:_MAX_DROPPED_ITEMS_REPORT],
            },
            source='system',
        )
    except Exception:
        pass
