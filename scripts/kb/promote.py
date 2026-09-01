"""KB staging 晋升工具：把 staging 回流记录半自动晋升为流程卡规则。

机械部分（分组/去重/草稿生成）由本模块完成；审核决策在人。
CLI：
    python -m scripts.kb.promote                 # dry-run，仅打印建议表
    python -m scripts.kb.promote --apply         # 实际写回流程卡
    python -m scripts.kb.promote --staging PATH  # 覆盖 staging 路径
"""
import argparse
import json
import os

from scripts.kb import store

_DRAFT_PREFIX = "_draft_"


def load_staging(staging_path=None):
    """Read staging JSONL entries; skip bad lines.

    @param {str|None} staging_path overrides store.STAGING_FILE when given
    @returns {list[dict]} parsed entries, each with ts/flow/done_text/summary keys
    """
    path = staging_path or store.STAGING_FILE
    entries = []
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except ValueError:
                    continue
                if isinstance(obj, dict) and obj.get("flow"):
                    entries.append(obj)
    except OSError:
        return []
    return entries


def group_by_flow(entries):
    """Group entries by flow; dedupe identical done_text keeping latest ts.

    @param {list[dict]} entries
    @returns {dict} flow -> list[dict] (ts-ascending, deduped)
    """
    groups = {}
    for e in entries:
        groups.setdefault(e.get("flow") or "", []).append(e)
    out = {}
    for flow, items in groups.items():
        latest = {}
        for e in items:
            key = e.get("done_text") or ""
            cur = latest.get(key)
            if cur is None or str(e.get("ts") or "") > str(cur.get("ts") or ""):
                latest[key] = e
        out[flow] = sorted(latest.values(), key=lambda e: str(e.get("ts") or ""))
    return out


def propose(entries_by_flow, flows_dir=None):
    """Produce promotion proposals; never writes anything.

    @param {dict} entries_by_flow result of group_by_flow
    @param {str|None} flows_dir optional flows dir override (for testing)
    @returns {list[dict]} proposals with flow/action/keyword/rule/target_file
    """
    proposals = []
    flows_dir = flows_dir or store.FLOWS_DIR
    for flow, items in entries_by_flow.items():
        card_path = _find_flow_path_in(flows_dir, flow)
        for e in items:
            done = e.get("done_text") or ""
            if card_path is None:
                proposals.append({
                    "flow": flow,
                    "action": "new_card_draft",
                    "keyword": done[:8],
                    "rule": done,
                    "target_file": os.path.join(flows_dir, _DRAFT_PREFIX + flow + ".json"),
                })
            else:
                proposals.append({
                    "flow": flow,
                    "action": "append_rule",
                    "keyword": done[:8],
                    "rule": done,
                    "target_file": card_path,
                })
    return proposals


def _find_flow_path_in(flows_dir, flow_name):
    """Return the path of the matching flow card in a specific flows dir, or None.

    @param {str} flows_dir
    @param {str} flow_name
    @returns {str|None}
    """
    if not os.path.isdir(flows_dir):
        return None
    want = str(flow_name or "").replace(" ", "")
    if not want:
        return None
    for name in sorted(os.listdir(flows_dir)):
        if not name.endswith(".json"):
            continue
        path = os.path.join(flows_dir, name)
        card = store.load_json(path)
        if not (isinstance(card, dict) and card.get("flow")):
            continue
        names = [card.get("flow", "")] + [a for a in (card.get("aliases") or [])]
        for n in names:
            n2 = str(n or "").replace(" ", "")
            if n2 and (want in n2 or n2 in want):
                return path
    return None


def apply(proposals, flows_dir=None):
    """Write append_rule proposals to flow cards; skip new_card_draft (needs human).

    Dedupe: skip if same keyword+rule already present on the card.
    @param {list[dict]} proposals result of propose()
    @param {str|None} flows_dir optional flows dir override (unused, kept for symmetry)
    @returns {list[dict]} proposals actually written, each with + "written": True
    """
    written = []
    by_file = {}
    for p in proposals:
        if p.get("action") != "append_rule":
            continue
        by_file.setdefault(p.get("target_file"), []).append(p)
    for target_file, props in by_file.items():
        card = store.load_json(target_file)
        if not isinstance(card, dict):
            continue
        rules = card.setdefault("rules", [])
        changed = False
        for p in props:
            if any(r.get("keyword") == p["keyword"] and r.get("rule") == p["rule"] for r in rules):
                continue
            rules.append({"keyword": p["keyword"], "rule": p["rule"], "source": "staging"})
            written.append(dict(p, written=True))
            changed = True
        if changed:
            store.save_json(target_file, card)
    return written


def main(argv=None):
    """CLI entry: dry-run table by default, --apply to write, --staging to override path."""
    parser = argparse.ArgumentParser(description="Promote KB staging records into flow-card rules")
    parser.add_argument("--apply", action="store_true", help="actually write proposals (default: dry-run)")
    parser.add_argument("--staging", default=None, help="override staging jsonl path")
    args = parser.parse_args(argv)

    entries = load_staging(args.staging)
    grouped = group_by_flow(entries)
    proposals = propose(grouped)
    for p in proposals:
        print("[{}] flow={} keyword={} target={}".format(p["action"], p["flow"], p["keyword"], p["target_file"]))
        print("    rule: {}".format(p["rule"]))
    if args.apply:
        written = apply(proposals)
        print("applied: {} rule(s) written; {} new_card_draft skipped (needs human)".format(
            len(written), sum(1 for p in proposals if p["action"] == "new_card_draft")))
    else:
        print("dry-run: {} proposal(s); use --apply to write".format(len(proposals)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
