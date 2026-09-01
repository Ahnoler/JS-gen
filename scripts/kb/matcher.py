"""字段选项文本集 ↔ 字典 text 集匹配（label→dictType 打通）。"""


def match_dict_for_options(options, by_type, min_score=0.6):
    """options: 选项文本 list[str]；by_type: normalize_raw 输出的 by_type。

    得分 = |选项∩text| / |选项|；≥min_score 才给 best。返回
    {"best": {"dict_type","score","hits"} | None, "score": float, "ranked": [...前10]}。
    """
    opts = {str(o or "").strip() for o in (options or []) if str(o or "").strip()}
    if not opts:
        return {"best": None, "score": 0.0, "ranked": []}
    ranked = []
    for tp, entries in (by_type or {}).items():
        texts = {e.get("text", "") for e in entries}
        hits = len(opts & texts)
        if not hits:
            continue
        ranked.append({"dict_type": tp, "score": round(hits / len(opts), 3), "hits": hits})
    ranked.sort(key=lambda x: (-x["score"], -x["hits"], x["dict_type"]))
    best = ranked[0] if ranked and ranked[0]["score"] >= min_score else None
    return {"best": best, "score": best["score"] if best else 0.0, "ranked": ranked[:10]}
