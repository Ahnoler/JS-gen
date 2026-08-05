"""Fact Pack 解析 / 格式化（P1 注入用；P0 提供纯函数与自检）。"""

from __future__ import annotations


def parse_fact_pack(raw):
    """解析 Node 侧 /api/v2/memory/retrieve 返回的 Fact Pack。"""
    if not isinstance(raw, dict):
        return None
    facts = raw.get('facts')
    if not isinstance(facts, list):
        return None
    return {
        'facts': facts,
        'dropped': raw.get('dropped', []),
        'budget': raw.get('budget', {}),
    }


def format_fact_pack(facts):
    """把事实列表格式化为可注入任务文本的【记忆事实包】块。"""
    if not facts:
        return ''
    lines = ['【记忆事实包】']
    for f in facts[:50]:
        if not isinstance(f, dict):
            continue
        entity = str(f.get('entity') or '?')
        attribute = str(f.get('attribute') or 'value')
        value = str(f.get('value') or '')[:200]
        stance = str(f.get('stance') or 'neutral')
        source = str(f.get('source') or 'unknown')
        # 优先检索时的有效权重（存储权重 × 时间衰减 × 冲突惩罚）
        weight = f.get('effectiveWeight', f.get('weight'))
        lines.append(
            f'- #{f.get("id")} [{stance}/{source}] {entity}.{attribute} = {value} '
            f'(weight={weight})'
        )
    return '\n'.join(lines) + '\n'
