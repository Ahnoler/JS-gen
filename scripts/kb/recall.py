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


def _norm_name(s):
    """名称归一：去全部空白（含全角空格），用于精确等名判断。"""
    return ''.join(str(s or '').split())


def find_flow_for_task(flows, task_text, page_hash=None):
    """按 hash 强匹配 → keywords 弱匹配 → 词条匹配三层打分。

    返回 (card, score)；无命中 (None, 0)。
    - 查询词归一后长度 <2 → 直接 (None, 0)（防短查询误命中）。
    - hash 强匹配：card 的 hash_markers 任一是 page_hash 子串 → score=100；
      多卡命中取 markers 总长最长者（页面级 hash 段越长越特异）。
    - keywords 弱匹配：card 的 keywords 任一是 task_text 子串 → score += 关键词长度。
    - 词条匹配（向后兼容）：flow/aliases/nodes.page 词条命中 → score += 词条长度和。
    - 精确等名：flow/alias 归一后与查询全等 → 该卡 score += 1000。
    - 同分并列时优先 flow 名更短者（更特异）；仍并列保持先到先得。
    """
    text = str(task_text or '')
    if len(text.strip()) < 2:
        return (None, 0)
    phash = str(page_hash or '')
    best, best_score = None, 0
    best_hash_strength = -1

    def _consider(card, score):
        """同分并列取 flow 名更短者，严格更高分直接替换。"""
        nonlocal best, best_score
        if score > best_score or (
                score == best_score and best is not None
                and len(_norm_name(card.get('flow'))) < len(_norm_name(best.get('flow')))):
            best, best_score = card, score

    for card in flows or []:
        # 1) hash 强匹配（score 恒 100，多卡命中取 markers 总长最长者）
        markers = [str(m) for m in (card.get('hash_markers') or []) if m]
        if phash and markers:
            hits = [m for m in markers if m in phash]
            if hits:
                strength = sum(len(m) for m in markers)
                if strength > best_hash_strength:
                    best, best_score = card, 100
                    best_hash_strength = strength
                continue
        # 2) keywords 弱匹配 + 精确等名加分
        score = 0
        for kw in card.get('keywords') or []:
            kw = str(kw or '')
            if kw and kw in text:
                score += len(kw)
        names = [_norm_name(card.get('flow'))] + [_norm_name(a) for a in (card.get('aliases') or [])]
        exact = text.strip() and _norm_name(text) in names
        if score > 0:
            _consider(card, score + (1000 if exact else 0))
            continue
        # 3) 词条匹配（原有逻辑，向后兼容）+ 精确等名加分
        terms = set()
        for n in [card.get('flow', '')] + list(card.get('aliases') or []) + [
                node.get('page', '') for node in (card.get('nodes') or [])]:
            terms |= _terms(n)
        tscore = sum(len(t) for t in terms if t in text)
        if tscore > 0 or exact:
            _consider(card, tscore + (1000 if exact else 0))
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
    for se in card.get('special_elements') or []:
        if isinstance(se, dict):
            lines.append('特殊元素：{} — {}'.format(se.get('tag', ''), se.get('note', '')))
    for node in card.get('nodes') or []:
        for se in (node.get('special_elements') if isinstance(node, dict) else None) or []:
            if isinstance(se, dict):
                lines.append('特殊元素：{} — {}'.format(se.get('tag', ''), se.get('note', '')))
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
