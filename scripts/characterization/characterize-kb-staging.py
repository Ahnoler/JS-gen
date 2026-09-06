"""characterize-kb-staging: staging 追加语义 pin（tmp 路径，无 SUT）。"""
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


def main():
    from scripts.agent.recorder_emitters import _append_kb_staging

    path = os.path.join(tempfile.mkdtemp(prefix="kb-staging-"), "staged_flows.jsonl")
    store = {"_kb_flow_name": "对公授信申请", "_kb_flow_summary": "【KB 流程知识】…"}
    e1 = _append_kb_staging(store, "授信申请完成", staging_path=path)
    assert e1 and e1["flow"] == "对公授信申请" and "授信申请完成" in e1["done_text"]
    e2 = _append_kb_staging(store, "第二次", staging_path=path)
    lines = open(path, encoding="utf-8").read().strip().splitlines()
    assert len(lines) == 2 and json.loads(lines[1])["done_text"] == "第二次"
    assert _append_kb_staging({"无标记": True}, "x", staging_path=path) is None  # 无 _kb_flow_name 静默跳过
    print("ok: characterize-kb-staging")


if __name__ == "__main__":
    main()
