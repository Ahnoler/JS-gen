"""characterize-kb-store: KB store 纯逻辑语义 pin（临时目录，无 SUT）。"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


def main():
    from scripts.kb import store

    tmp = tempfile.mkdtemp(prefix="kb-store-")
    store.DATA_DIR = tmp
    store.FLOWS_DIR = os.path.join(tmp, "flows")
    store.DICTS_FILE = os.path.join(tmp, "dicts_normalized.json")
    store.ALIAS_FILE = os.path.join(tmp, "dict_alias.json")

    # 1) 缺失文件 → 默认值
    assert store.load_json(store.DICTS_FILE) == {}, "missing dicts file should default to {}"
    assert store.load_flows() == [], "missing flows dir should yield []"

    # 2) 原子 roundtrip
    store.save_json(store.DICTS_FILE, {"by_type": {"cstSt": [{"text": "信贷正式客户", "value": "1"}]}})
    assert store.load_json(store.DICTS_FILE)["by_type"]["cstSt"][0]["value"] == "1"
    assert not os.path.exists(store.DICTS_FILE + ".tmp"), "tmp file must be replaced"

    # 3) 流程卡检索：flow/别名 双向包含 + 空格归一
    os.makedirs(store.FLOWS_DIR, exist_ok=True)
    card = {
        "flow": "对公授信申请",
        "aliases": ["新增对公授信管理", "授信申请"],
        "rules": [{"keyword": "选择客户", "rule": "三段式"}],
        "state_actions": [{"entity": "授信申请", "status": "审批中", "allow": ["撤销"]}],
    }
    store.save_json(os.path.join(store.FLOWS_DIR, "credit_application.json"), card)
    store.save_json(os.path.join(store.FLOWS_DIR, "not_a_card.txt"), "{}")
    assert len(store.load_flows()) == 1, "only .json cards with flow key count"
    assert store.find_flow("对公授信申请")["flow"] == "对公授信申请"
    assert store.find_flow("新增对公授信管理")["flow"] == "对公授信申请"  # alias
    assert store.find_flow("授信申请")["flow"] == "对公授信申请"          # alias substring
    assert store.find_flow("不存在的流程") is None

    # 4) 规则/状态 跨卡片收集
    assert store.collect_rules()[0]["keyword"] == "选择客户"
    assert store.collect_rules()[0]["flow"] == "对公授信申请"
    assert store.collect_state_actions()[0]["entity"] == "授信申请"

    # 5) 别名解析
    store.save_json(store.ALIAS_FILE, {"cstTpcd": "cstTp"})
    assert store.resolve_alias(store.load_alias_map(), "cstTpcd") == "cstTp"
    assert store.resolve_alias(store.load_alias_map(), "cstTp") == "cstTp"

    print("ok: characterize-kb-store")


if __name__ == "__main__":
    main()
