"""characterize-kb-actions: kb_* 召回动作语义 pin（FakeCtx，无浏览器）。

依赖 data/kb/flows/*.json 已入库（Task 4 内容前置到本任务前执行：
本脚本只要求 credit_application.json 存在——由 Task 3 Step 2 先写卡）。
"""
import asyncio
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

# 隔离：KB 数据重定向到临时目录，绝不读写真实 data/kb/（store.py 在 import 期读 KB_DATA_DIR）。
_tmp_kb = tempfile.mkdtemp(prefix="kb-actions-")
os.environ["KB_DATA_DIR"] = _tmp_kb
# flows/*.json 与 dict_alias.json 是入库 fixture，只读复制进临时目录供召回测试使用
_src_kb = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                       "data", "kb")
if os.path.isdir(os.path.join(_src_kb, "flows")):
    shutil.copytree(os.path.join(_src_kb, "flows"), os.path.join(_tmp_kb, "flows"))
for _name in ("dict_alias.json", "field_map.json"):
    _p = os.path.join(_src_kb, _name)
    if os.path.isfile(_p):
        shutil.copy2(_p, os.path.join(_tmp_kb, _name))


class FakeCtx:
    async def get_current_page(self):
        raise RuntimeError("no page in characterization")


def main():
    from scripts.controller.service import build_controller
    from scripts.kb import store as kb_store

    # kb_dict 需要归一字典数据（运行期生成物，不入库）：特征化内注入最小 fixture，
    # 使 kb_dict("cstSt") 走 kb-dict-type-not-found 分支（结构化错误，不抛异常）
    kb_store.save_json(kb_store.DICTS_FILE, {
        "by_type": {"cstTp": [{"text": "有限责任公司", "value": "1"}]},
        "counts": {"types": 1, "entries": 1},
    })

    ctrl = build_controller(FakeCtx())
    acts = ctrl.registry.registry.actions
    need = ["kb_dict", "kb_flow", "kb_state", "kb_rule", "kb_field", "export_dicts"]
    missing = [n for n in need if n not in acts]
    assert not missing, "missing actions: %s" % missing

    # kb_flow：别名命中流程卡
    r = asyncio.run(acts["kb_flow"].function("对公授信申请"))
    s = str(r)
    assert "nextBefore" in s, "flow card must carry nextBefore gate: %s" % s[:200]

    # kb_flow：未知流程 → 已知清单
    r2 = str(asyncio.run(acts["kb_flow"].function("不存在的流程")))
    assert "kb-flow-not-found" in r2 and "对公授信申请" in r2

    # kb_dict：无数据文件 → 结构化 not-found（不抛异常）
    r3 = str(asyncio.run(acts["kb_dict"].function("cstSt", "")))
    assert "kb-dict-type-not-found" in r3 or '"ok"' in r3 or "ok:" in r3

    # kb_state / kb_rule：流程卡入库后可召回
    r4 = str(asyncio.run(acts["kb_state"].function("授信申请", "审批中")))
    assert "撤销" in r4, r4[:200]
    r5 = str(asyncio.run(acts["kb_rule"].function("退回")))
    assert "退回" in r5, r5[:200]

    # kb_field：依赖组检索（无需 options）
    r6 = str(asyncio.run(acts["kb_field"].function("上市公司标志", "")))
    assert "deps" in r6, r6[:200]

    print("ok: characterize-kb-actions")


if __name__ == "__main__":
    try:
        main()
    finally:
        # 临时目录留给系统清理，绝不触碰真实 data/kb/
        shutil.rmtree(_tmp_kb, ignore_errors=True)
