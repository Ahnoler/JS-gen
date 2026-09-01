"""归一化天阳 localStorage 字典缓存（vue_Tansun_dict*）。

输入形态防御式处理：对象（key=来源 key）/ 扁平 list / 嵌套 JSON 字符串均可；
缺 dctTp 的条目剔除（type 字段作后备，如 WarrantTypeCd_01 → 取 _ 前段不在此处做，
归一映射走 dict_alias.json）。
"""
import json


def _flatten_entries(raw):
    if isinstance(raw, list):
        out = []
        for item in raw:
            out.extend(_flatten_entries(item))
        return out
    if isinstance(raw, dict):
        if any(k in raw for k in ("text", "value", "dctTp")):
            return [raw]
        out = []
        for v in raw.values():
            out.extend(_flatten_entries(v))
        return out
    if isinstance(raw, str):
        try:
            return _flatten_entries(json.loads(raw))
        except Exception:
            return []
    return []


def normalize_raw(raw):
    entries = _flatten_entries(raw)
    by_type = {}
    for e in entries:
        dct_tp = str(e.get("dctTp") or "").strip()
        if not dct_tp:
            continue
        by_type.setdefault(dct_tp, []).append({
            "text": str(e.get("text") or "").strip(),
            "value": str(e.get("value") if e.get("value") is not None else "").strip(),
            "seq": str(e.get("seq") or "").strip(),
            "group": str(e.get("group") or "").strip(),
        })
    for tp in by_type:
        by_type[tp].sort(key=lambda x: (x["seq"] == "", x["seq"]))
    return {
        "by_type": by_type,
        "counts": {
            "types": len(by_type),
            "entries": sum(len(v) for v in by_type.values()),
        },
    }
