"""characterize-kb-promote: staging 晋升工具语义 pin（临时目录，不碰真实 data/kb）。"""
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


def main():
    from scripts.kb import store
    from scripts.kb import promote

    tmp = tempfile.mkdtemp(prefix="kb-promote-")
    store.DATA_DIR = tmp
    store.FLOWS_DIR = os.path.join(tmp, "flows")
    store.STAGING_FILE = os.path.join(tmp, "staging", "staged_flows.jsonl")

    # 造临时 flows 目录：一张有卡 flow + 一张无关卡
    os.makedirs(store.FLOWS_DIR, exist_ok=True)
    card = {
        "flow": "对公客户建档",
        "aliases": [],
        "rules": [{"keyword": "已有规则", "rule": "原有规则内容"}],
    }
    card_path = os.path.join(store.FLOWS_DIR, "customer_onboarding.json")
    store.save_json(card_path, card)

    # 造 staging jsonl：同 done_text 2 行（去 1 重，留最新 ts）+ 1 行无卡 flow + 1 坏行
    os.makedirs(os.path.dirname(store.STAGING_FILE), exist_ok=True)
    lines = [
        {"ts": "2026-09-01T10:00:00", "flow": "对公客户建档",
         "done_text": "阶段1完成：选中草稿客户并保存", "summary": "s1"},
        {"ts": "2026-09-01T11:00:00", "flow": "对公客户建档",
         "done_text": "阶段1完成：选中草稿客户并保存", "summary": "s1-later"},
        {"ts": "2026-09-01T12:00:00", "flow": "不存在的流程",
         "done_text": "神秘流程的完成描述", "summary": "s2"},
        {"ts": "2026-09-01T13:00:00", "flow": "对公客户建档",
         "done_text": "阶段2完成：批量覆盖字段后提交", "summary": "s3"},
    ]
    with open(store.STAGING_FILE, "w", encoding="utf-8") as f:
        for obj in lines:
            f.write(json.dumps(obj, ensure_ascii=False) + "\n")
        f.write("{not json\n")

    # 1) load_staging：读出 3 条原始记录，坏行跳过
    entries = promote.load_staging()
    assert len(entries) == 4, "bad line skipped, 4 valid entries"

    # 2) group_by_flow：同 done_text 去重留最新 ts
    grouped = promote.group_by_flow(entries)
    assert set(grouped.keys()) == {"对公客户建档", "不存在的流程"}
    assert len(grouped["对公客户建档"]) == 2, "duplicate done_text deduped to latest ts"
    assert grouped["对公客户建档"][0]["summary"] == "s1-later"

    # 3) propose：append_rule 与 new_card_draft 各就位，不写任何文件
    proposals = promote.propose(grouped)
    by_action = {}
    for p in proposals:
        by_action.setdefault(p["action"], []).append(p)
    assert len(by_action.get("append_rule", [])) == 2, "2 append_rule proposals for known flow"
    assert len(by_action.get("new_card_draft", [])) == 1, "1 new_card_draft for unknown flow"
    ar = by_action["append_rule"][0]
    assert ar["target_file"] == card_path, "append_rule targets the real card file"
    assert ar["keyword"] == ar["rule"][:8]
    draft = by_action["new_card_draft"][0]
    assert draft["target_file"] == os.path.join(store.FLOWS_DIR, "_draft_不存在的流程.json")
    assert store.load_json(card_path)["rules"] == [{"keyword": "已有规则", "rule": "原有规则内容"}], \
        "propose must not write anything"

    # 4) apply：只写 append_rule，卡内去重，new_card_draft 不落盘
    written = promote.apply(proposals)
    assert len(written) == 2, "both append_rule proposals written once"
    after = store.load_json(card_path)
    assert len(after["rules"]) == 3, "2 rules appended to existing 1"
    assert all(r["source"] == "staging" for r in after["rules"][1:])
    assert after["rules"][1]["keyword"] == "阶段1完成：选中", "keyword is first 8 chars"
    # 幂等：重跑 apply 不重复追加
    written2 = promote.apply(proposals)
    assert written2 == [], "same keyword+rule deduped on re-apply"
    assert len(store.load_json(card_path)["rules"]) == 3, "no duplicate rules after re-apply"
    assert not os.path.exists(draft["target_file"]), "new_card_draft must not be written by apply"

    print("ok: characterize-kb-promote")


if __name__ == "__main__":
    main()
