"""characterize-kb-recall: recall 纯逻辑 pin（fixture 流程卡，无 SUT）。"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
os.environ.setdefault("KB_DATA_DIR", tempfile.mkdtemp(prefix="kb-recall-"))


def main():
    from scripts.kb import store
    from scripts.kb.recall import find_flow_for_task, flow_summary_text, dict_candidates_for_values

    card = {
        "flow": "对公授信申请",
        "aliases": ["新增对公授信管理"],
        "preconditions": ["nextBefore 风控闸门：信贷预客户被拦截"],
        "nodes": [{"id": "list", "page": "新增对公授信管理列表页"}],
        "state_actions": [{"entity": "授信申请", "status": "审批中", "allow": ["撤销", "流程轨迹"]}],
        "field_deps": [{"if": "上市公司标志", "then": ["上市地", "股票代码"]}],
        "rules": [{"keyword": "草稿客户", "rule": "选择器排除草稿客户"}],
    }
    flows = [card, {"flow": "登录与会话", "aliases": ["登录"], "nodes": []}]

    hit, score = find_flow_for_task(flows, "阶段1：在新增对公授信管理里发起授信申请")
    assert hit is card and score > 0
    miss, s0 = find_flow_for_task(flows, " completely unrelated ")
    assert miss is None and s0 == 0

    text = flow_summary_text(card, limit=800)
    assert "【KB 流程知识】对公授信申请" in text and "nextBefore" in text and "撤销" in text and len(text) <= 820

    by_type = {"cstSt": [{"text": "信贷预客户", "value": "2", "seq": "2", "group": ""}]}
    cands = dict_candidates_for_values(["信贷预客户", "x"], by_type)
    assert cands == [{"value": "信贷预客户", "dict_type": "cstSt", "text": "信贷预客户", "value_code": "2"}]
    assert dict_candidates_for_values(["不存在"], by_type) == []

    print("ok: characterize-kb-recall")


if __name__ == "__main__":
    main()
