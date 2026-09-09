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

    # hash 强匹配：任务文本完全无关也能命中（多卡命中取**命中** markers 总长最长者）
    h_card = {
        "flow": "短卡", "hash_markers": ["cstMgt"], "nodes": [],
    }
    h_card2 = {
        "flow": "长卡", "hash_markers": ["cstMgt", "cpctMgtPg"], "nodes": [],
    }
    h_hit, h_score = find_flow_for_task(
        [h_card, h_card2], "任意任务文本", page_hash="#/cstMgt/hostCstmgrCrtCpctInf/cpctMgtPg")
    assert h_hit is h_card2 and h_score == 100
    # 共享短 hash 段不得压过更特异命中：pdMgt 大卡 vs pdElmtMgt 小卡
    lib = {
        "flow": "产品库管理（新增/启用）",
        "hash_markers": ["pdMgt", "pdInfMgt", "pdMgtMgtPg", "ZJJK00110131", "RES04067"],
        "nodes": [],
    }
    elmt = {
        "flow": "产品要素库（分组/组件）",
        "hash_markers": ["pdMgt", "pdElmtMgt", "elmtgroupOfIndex", "RES04070"],
        "nodes": [],
    }
    e_hit, e_score = find_flow_for_task(
        [lib, elmt], "阶段：产品要素库新增类型",
        page_hash="#/pdMgt/pdElmtMgt/elmtgroupOfIndex?x=1")
    assert e_hit is elmt and e_score == 100, (e_hit, e_score)
    l_hit, l_score = find_flow_for_task(
        [lib, elmt], "产品库新增启用",
        page_hash="#/pdMgt/pdInfMgt/pdMgtMgtPg?part=1")
    assert l_hit is lib and l_score == 100, (l_hit, l_score)
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

    # 跨语言金样例（与 JS 侧 characterize-flow-card-recall 共用同一 fixture）：
    # py 侧对真实语料断言 pyFlowRef（缺省=expectFlowRef）；divergenceAccepted 条目
    # 记录两侧已知算法分歧（D3：先共享契约、不合并实现）。
    import glob as _glob
    import json as _json

    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    real_flows_dir = os.path.join(root, "data", "kb", "flows")
    real_cards = []
    name2stem = {}
    for path in sorted(_glob.glob(os.path.join(real_flows_dir, "*.json"))):
        with open(path, encoding="utf-8") as f:
            c = _json.load(f)
        if isinstance(c, dict) and c.get("flow"):
            real_cards.append(c)
            name2stem[c["flow"]] = os.path.splitext(os.path.basename(path))[0]

    with open(os.path.join(root, "scripts", "characterization", "fixtures", "kb-recall-golden.json"), encoding="utf-8") as f:
        golden = _json.load(f)
    assert len(golden["entries"]) >= 20, "golden fixture must keep >=20 entries"
    for entry in golden["entries"]:
        hit, _score = find_flow_for_task(real_cards, entry["query"])
        got = name2stem.get(hit["flow"]) if hit else None
        want = entry.get("pyFlowRef", entry["expectFlowRef"])
        assert got == want, (
            f"golden py mismatch: query={entry['query']!r} want={want} got={got}"
            f" divergenceAccepted={entry.get('divergenceAccepted', False)}"
        )
    # 绊线（R-3 修订）：不得存在「已收敛却仍登记为分歧」的条目——py 收敛并清理
    # fixture 后本断言自然通过；只有漏删 divergenceAccepted 时才失败。
    stale = [
        e["query"] for e in golden["entries"]
        if e.get("divergenceAccepted")
        and e.get("pyFlowRef", e["expectFlowRef"]) == e["expectFlowRef"]
    ]
    assert not stale, (
        "divergenceAccepted entries have converged — remove pyFlowRef/divergenceAccepted "
        f"from the fixture: {stale}"
    )
    registered = sum(1 for e in golden['entries'] if e.get('divergenceAccepted'))
    print(f"golden fixture: {len(golden['entries'])} entries, {registered} accepted divergences")

    # 质量评测集 v1（kb-recall-eval.v1.json，spec 2026-09-09-kb-recall-eval-design D6）：
    # py 侧只断言正样本 flowRef 与 gold 的一致性——命不命中记为分歧登记（不阻塞，
    # py 算法未升级不参与 JS 指标门禁）；无阈值，避免长期红。
    with open(os.path.join(root, "scripts", "characterization", "fixtures", "kb-recall-eval.v1.json"), encoding="utf-8") as f:
        eval_v1 = _json.load(f)
    positives = [e for e in eval_v1["entries"] if e["tier"] != "N"]
    agree = 0
    mismatches = []
    for entry in positives:
        hit, _score = find_flow_for_task(real_cards, entry["query"])
        got = name2stem.get(hit["flow"]) if hit else None
        if got in entry["gold"]:
            agree += 1
        else:
            mismatches.append(f"{entry['id']} {entry['query']!r} gold={entry['gold']} py={got}")
    rate = agree / len(positives)
    print(f"py agreement: {agree}/{len(positives)} ({rate:.0%})")
    for m in mismatches[:20]:
        print(f"  py-divergence: {m}")
    if len(mismatches) > 20:
        print(f"  ... and {len(mismatches) - 20} more")

    print("ok: characterize-kb-recall")


if __name__ == "__main__":
    main()
