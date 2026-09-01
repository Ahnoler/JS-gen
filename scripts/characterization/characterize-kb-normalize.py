"""characterize-kb-normalize: normalize + matcher 纯逻辑 pin（fixture 无 SUT）。"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


def main():
    from scripts.kb.normalize import normalize_raw
    from scripts.kb.matcher import match_dict_for_options

    # 1) localStorage 单 key payload（对象，键为来源 key）
    raw = {
        "vue_Tansun_dict-test.creditv5p2.tansun.com.cn": [
            {"text": "信贷正式客户", "value": "1", "dctTp": "cstSt", "group": "", "seq": "1"},
            {"text": "信贷预客户", "value": "2", "dctTp": "cstSt", "group": "", "seq": "2"},
            {"text": "企业客户", "value": "04", "dctTp": "cstTp", "group": "", "seq": "4"},
        ]
    }
    norm = normalize_raw(raw)
    assert norm["counts"]["types"] == 2, norm["counts"]
    assert norm["counts"]["entries"] == 3
    assert norm["by_type"]["cstSt"][0] == {"text": "信贷正式客户", "value": "1", "seq": "1", "group": ""}

    # 2) 扁平 list / 嵌套 JSON 字符串 / 缺 dctTp 剔除
    norm2 = normalize_raw([{"text": "存单", "value": "01", "type": "WarrantTypeCd_01", "dctTp": "WarrantTypeCd", "seq": "1"}])
    assert norm2["by_type"]["WarrantTypeCd"][0]["value"] == "01"
    norm3 = normalize_raw('{"k": [{"text": "护照", "value": "124", "dctTp": "crdtTpcd"}]}')
    assert norm3["by_type"]["crdtTpcd"][0]["text"] == "护照"
    norm4 = normalize_raw([{"text": "无类型", "value": "x"}])
    assert norm4["counts"]["types"] == 0

    # 3) matcher：选项集 ↔ 字典 text 集
    by_type = normalize_raw(raw)["by_type"]
    hit = match_dict_for_options(["信贷正式客户", "信贷预客户"], by_type)
    assert hit["best"]["dict_type"] == "cstSt" and hit["best"]["score"] >= 0.6, hit
    miss = match_dict_for_options(["不存在A", "不存在B"], by_type)
    assert miss["best"] is None
    # brief 定稿笔误：partial 案例命中 1/2=0.5，低于默认 min_score=0.6 会得 best=None；
    # 显式放宽阈值以验证 "best 存在且 score<1.0" 的部分命中路径。
    partial = match_dict_for_options(["信贷正式客户", "企业客户"], by_type, min_score=0.5)
    assert partial["best"]["dict_type"] in ("cstSt", "cstTp") and partial["best"]["score"] < 1.0

    print("ok: characterize-kb-normalize")


if __name__ == "__main__":
    main()
