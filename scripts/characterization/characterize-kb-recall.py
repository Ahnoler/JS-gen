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
        "hash_markers": ["crgMgt", "newCorpCrgMgtPg"],
        "keywords": ["授信申请", "授信额度"],
        "preconditions": ["nextBefore 风控闸门：信贷预客户被拦截"],
        "nodes": [{"id": "list", "page": "新增对公授信管理列表页"}],
        "state_actions": [{"entity": "授信申请", "status": "审批中", "allow": ["撤销", "流程轨迹"]}],
        "field_deps": [{"if": "上市公司标志", "then": ["上市地", "股票代码"]}],
        "rules": [{"keyword": "草稿客户", "rule": "选择器排除草稿客户"}],
    }
    intro_card = {
        "flow": "对公客户建档",
        "hash_markers": ["cstMgt"],
        "keywords": ["草稿客户", "法定代表人引入"],
        "nodes": [
            {"id": "edit_page", "page": "客户编辑上下文页", "special_elements": [
                {"tag": "Introduction", "note": "法定代表人引入操作组（tag=4）"}]},
        ],
    }
    flows = [card, intro_card, {"flow": "登录与会话", "aliases": ["登录"], "nodes": []}]

    hit, score = find_flow_for_task(flows, "阶段1：在新增对公授信管理里发起授信申请")
    assert hit is card and score > 0
    miss, s0 = find_flow_for_task(flows, " completely unrelated ")
    assert miss is None and s0 == 0

    # hash 强匹配：任务文本完全无关也能命中（多卡命中取 markers 总长最长者）
    h_card = {
        "flow": "短卡", "hash_markers": ["cstMgt"], "nodes": [],
    }
    h_card2 = {
        "flow": "长卡", "hash_markers": ["cstMgt", "cpctMgtPg"], "nodes": [],
    }
    h_hit, h_score = find_flow_for_task(
        [h_card, h_card2], "任意任务文本", page_hash="#/cstMgt/hostCstmgrCrtCpctInf/cpctMgtPg")
    assert h_hit is h_card2 and h_score == 100
    # keywords 弱匹配：task 含「草稿客户」→ 命中 customer_onboarding
    k_hit, k_score = find_flow_for_task(flows, "选择一个草稿客户，点击修改")
    assert k_hit is intro_card and k_score == len("草稿客户")
    # 不相关任务 + 无 hash → None
    n_hit, n_score = find_flow_for_task(flows, "打开另一个页面看看", page_hash=None)
    assert n_hit is None and n_score == 0
    # keywords 优先级低于 hash：hash 命中优先返回 100
    h_hit2, h_score2 = find_flow_for_task(
        flows, "在客户信息维护里维护草稿客户", page_hash="#/crgMgt/newCorpCrgMgtPg")
    assert h_hit2 is card and h_score2 == 100

    # 精确等名优先：两卡 keywords 都含「客户」，查「客户建档」应命中等名卡而非客户360视图
    cust_360 = {"flow": "客户360视图", "keywords": ["客户"], "nodes": []}
    cust_jd = {"flow": "客户建档", "keywords": ["客户"], "nodes": []}
    e_hit, e_score = find_flow_for_task([cust_360, cust_jd], "客户建档")
    assert e_hit is cust_jd and e_score >= 1000, (e_hit, e_score)
    # 同分并列：查「客户」两卡同分 → flow 名更短者（客户建档）优先
    t_hit, t_score = find_flow_for_task([cust_360, cust_jd], "客户")
    assert t_hit is cust_jd, (t_hit, t_score)
    # 短查询（归一后长度 <2）直接不命中
    s_hit, s_score = find_flow_for_task(flows, "客")
    assert s_hit is None and s_score == 0

    text = flow_summary_text(card, limit=800)
    assert "【KB 流程知识】对公授信申请" in text and "nextBefore" in text and "撤销" in text and len(text) <= 820
    # 节点内 special_elements → 摘要含「特殊元素：Introduction」行
    intro_text = flow_summary_text(intro_card)
    assert "特殊元素：Introduction" in intro_text and "tag=4" in intro_text

    by_type = {"cstSt": [{"text": "信贷预客户", "value": "2", "seq": "2", "group": ""}]}
    cands = dict_candidates_for_values(["信贷预客户", "x"], by_type)
    assert cands == [{"value": "信贷预客户", "dict_type": "cstSt", "text": "信贷预客户", "value_code": "2"}]
    assert dict_candidates_for_values(["不存在"], by_type) == []

    print("ok: characterize-kb-recall")


if __name__ == "__main__":
    main()
