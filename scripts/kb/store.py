"""KB data store: JSON files under data/kb.

flows/*.json 与 dict_alias.json 入库；dicts_normalized.json 为生成物（gitignore）。
KB_DATA_DIR 环境变量可整体覆盖数据目录（特征化/隔离运行用）。
"""
import json
import os

_SCRIPTS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_PROJECT_ROOT = os.path.dirname(_SCRIPTS_DIR)

DATA_DIR = os.environ.get("KB_DATA_DIR") or os.path.join(_PROJECT_ROOT, "data", "kb")
FLOWS_DIR = os.path.join(DATA_DIR, "flows")
DICTS_FILE = os.path.join(DATA_DIR, "dicts_normalized.json")
FIELD_MAP_FILE = os.path.join(DATA_DIR, "field_map.json")
ALIAS_FILE = os.path.join(DATA_DIR, "dict_alias.json")
STAGING_FILE = os.path.join(DATA_DIR, "staging", "staged_flows.jsonl")


def load_json(path, default=None):
    if default is None:
        default = {}
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save_json(path, payload):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def load_alias_map():
    return load_json(ALIAS_FILE, {})


def resolve_alias(alias_map, dict_type):
    return (alias_map or {}).get(dict_type, dict_type)


def load_flows():
    cards = []
    if not os.path.isdir(FLOWS_DIR):
        return cards
    for name in sorted(os.listdir(FLOWS_DIR)):
        if not name.endswith(".json"):
            continue
        card = load_json(os.path.join(FLOWS_DIR, name))
        if isinstance(card, dict) and card.get("flow"):
            cards.append(card)
    return cards


def _norm_name(name):
    return str(name or "").replace(" ", "")


def find_flow(flow_name):
    want = _norm_name(flow_name)
    if not want:
        return None
    for card in load_flows():
        names = [card.get("flow", "")] + [a for a in (card.get("aliases") or [])]
        for n in names:
            n2 = _norm_name(n)
            if n2 and (want in n2 or n2 in want):
                return card
    return None


def collect_rules():
    out = []
    for card in load_flows():
        for r in card.get("rules") or []:
            out.append({"flow": card.get("flow"), **r})
    return out


def collect_state_actions():
    out = []
    for card in load_flows():
        for s in card.get("state_actions") or []:
            out.append({"flow": card.get("flow"), **s})
    return out
