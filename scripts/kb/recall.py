"""KB 召回纯逻辑：任务文本→流程卡匹配；业务值→码表候选。
供 scripts/agent/service.py 的 phase 注入使用；不依赖浏览器。"""


def _terms(text):
    """流程名/别名/页面名 → 归一词条（去空格按 / 与空格切分，长度≥3）。"""
    out = set()
    for part in str(text or '').replace('\u3000', ' ').replace('/', ' ').split():
        p = part.strip()
        if len(p) >= 3:
            out.add(p)
    return out


def find_flow_for_task(flows, task_text):
    """按卡片 flow/aliases/nodes.page 词条在任务文本中的出现打分。

    返回 (card, score)；无命中 (None, 0)。score=命中词条长度和（倾向长名优先）。
    """
    text = str(task_text or '')
    best, best_score = None, 0
    for card in flows or []:
        terms = set()
        for n in [card.get('flow', '')] + list(card.get('aliases') or []) + [
                node.get('page', '') for node in (card.get('nodes') or [])]:
            terms |= _terms(n)
        score = sum(len(t) for t in terms if t in text)
        if score > best_score:
            best, best_score = card, score
    return (best, best_score) if best_score > 0 else (None, 0)


def flow_summary_text(card, limit=800):
    """流程卡 → 紧凑文本摘要（前置闸门/节点/状态×动作/规则），截断到 limit。"""
    lines = ['【KB 流程知识】' + str(card.get('flow') or '')]
    for p in card.get('preconditions') or []:
        lines.append('前置闸门：' + str(p))
    nodes = card.get('nodes') or []
    if nodes:
        lines.append('节点：' + ' → '.join(str(n.get('id') or n.get('page') or '') for n in nodes))
    for s in card.get('state_actions') or []:
        lines.append('状态：{} {} → 允许：{}'.format(
            s.get('entity', ''), s.get('status', ''), '/'.join(s.get('allow') or [])))
    for d in card.get('field_deps') or []:
        lines.append('字段依赖：{} → {}'.format(d.get('if', ''), ', '.join(d.get('then') or [])))
    for r in card.get('rules') or []:
        lines.append('规则[{}]：{}'.format(r.get('keyword', ''), r.get('rule', '')))
    text = '\n'.join(lines)
    if len(text) > limit:
        text = text[:limit] + '\n…(截断)'
    return text


def dict_candidates_for_values(values, by_type, alias_map=None, cap=8):
    """业务数据值 → 码表候选（text 精确命中即记，每值取首个命中类型）。

    返回 [{'value','dict_type','text','value_code'}...]，≤cap 条。
    """
    out = []
    seen = set()
    for v in values or []:
        v = str(v or '').strip()
        if len(v) < 2:
            continue
        for tp, entries in (by_type or {}).items():
            for e in entries:
                if e.get('text', '') == v:
                    key = (v, tp)
                    if key in seen:
                        break
                    seen.add(key)
                    out.append({'value': v, 'dict_type': tp, 'text': e.get('text', ''), 'value_code': e.get('value', '')})
                    break
            if len(out) >= cap:
                return out[:cap]
    return out[:cap]
