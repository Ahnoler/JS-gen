# 信贷业务流程知识库（KB v1）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为天阳信贷被测系统搭建五层知识库（值语义/导航/序列/字段映射/流程依赖）的文件型 v1：字典导出入库、6 张流程卡、`kb_*` 召回控制器动作，并在产品 API 通道上湿测召回。

**Architecture:** 知识以版本化 JSON 存放在 `data/kb/`（流程卡与别名表入库；字典归一数据为生成物、gitignore）。Python 侧新增 `scripts/kb/` 纯逻辑模块（store/normalize/matcher），控制器动作集中在 `scripts/controller/actions/_kb.py`（复用 `_workspace.py` 的注册/返回范式）。**设计修正（对设计文档 §二 存储列的 YAGNI 修订）**：v1 不建 MySQL 表——召回发生在 Agent 进程内，文件读取即可；DB 表留到有 API/UI 消费方时再做。

**Tech Stack:** Python（browser_use Controller 动作注册）、JS 片段（page.evaluate 注入，单一语言面在 `scripts/controller/actions/js_snippets/`）、JSON 数据文件、characterization 特征化测试（仓库测试范式）、verify-all 门禁。

## Global Constraints

- 解释器：开发自测用 `D:/anaconda3/envs/browser_use/python.exe`；verify-all 自行解析 `$PY`。
- `scripts/controller/actions/js_snippets/` 是 JS 唯一语言面；`_locator_helpers_js.py` 是生成物禁手改。
- `form_autofill.py`/`form_action_engines.py`/`form_scan_actions.py` 被特征化钉住——本计划**不改这三个文件**。
- 新 Python 文件须过 `py_compile` + 真实 import（cwd=仓库根）。
- 每个 Task 结束 `git commit`（不推送）；CHANGELOG 约定已废止，不追加。
- 禁触不可逆业务动作（提交/撤销/删除/审批）；湿测仅在测试环境。
- watcher 响应信封：result 形如 `is_done=... extracted_content='ok:{...}'`——解析必须先剥 `extracted_content` 信封（见 Task 2 自测样例）。
- 不启动/停止服务；湿测阶段由主线程确认控制面+executor 在线后再跑。

## 文件结构总览

```
data/kb/                            # KB 数据目录
  flows/*.json                      # 6 张流程卡（入库）
  dict_alias.json                   # 同义 dictType 归一映射（入库）
  dicts_normalized.json             # 字典归一数据（生成物，gitignore）
scripts/kb/
  __init__.py
  store.py                          # 路径/JSON 读写/流程卡检索/别名（KB_DATA_DIR 可覆盖）
  normalize.py                      # localStorage payload → 归一字典
  matcher.py                        # 选项文本集 ↔ 字典 text 集匹配
scripts/controller/actions/
  js_snippets/kb_export.py          # JS_EXPORT_DICTS
  _kb.py                            # _register_kb_actions：export_dicts/kb_dict/kb_flow/kb_state/kb_rule/kb_field
scripts/characterization/
  characterize-kb-store.py          # store 纯逻辑 pin
  characterize-kb-normalize.py      # normalize+matcher 纯逻辑 pin
scripts/controller/service.py       # +2 行：import 与注册
scripts/refactor/verify-all.sh      # +2 行：注册两个新特征化
scripts/prompts/agent-tools-common.md  # +知识召回 cue 小节
.gitignore                          # +dicts_normalized.json
```

---

### Task 1: KB 存储模块 `scripts/kb/store.py`

**Files:**
- Create: `scripts/kb/__init__.py`（空文件）
- Create: `scripts/kb/store.py`
- Create: `scripts/characterization/characterize-kb-store.py`
- Modify: `scripts/refactor/verify-all.sh`（characterize 系列末尾追加 1 行）

**Interfaces:**
- Produces（后续任务依赖的精确签名）:
  - `store.DATA_DIR / FLOWS_DIR / DICTS_FILE / FIELD_MAP_FILE / ALIAS_FILE`（路径常量，`KB_DATA_DIR` 环境变量可整体覆盖 DATA_DIR）
  - `store.load_json(path, default=None) -> object`（文件缺失/损坏返回 default 或 {}）
  - `store.save_json(path, payload) -> None`（临时文件 + `os.replace` 原子写）
  - `store.load_alias_map() -> dict`、`store.resolve_alias(alias_map, dict_type) -> str`
  - `store.load_flows() -> list[dict]`（读 FLOWS_DIR 下 *.json，仅收含 `flow` 键的卡片）
  - `store.find_flow(flow_name) -> dict | None`（flow/aliases 空格归一后双向包含匹配）
  - `store.collect_rules() -> list[dict]`（跨卡片 rules，附 flow 名）
  - `store.collect_state_actions() -> list[dict]`（跨卡片 state_actions，附 flow 名）

- [ ] **Step 1: 写失败的特征化脚本**

创建 `scripts/characterization/characterize-kb-store.py`：

```python
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
```

- [ ] **Step 2: 跑特征化确认失败**

Run: `cd D:/dev/JS-gen && D:/anaconda3/envs/browser_use/python.exe scripts/characterization/characterize-kb-store.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.kb'`

- [ ] **Step 3: 实现 `scripts/kb/store.py`**

创建 `scripts/kb/__init__.py`（空）。创建 `scripts/kb/store.py`：

```python
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
```

- [ ] **Step 4: 跑特征化确认通过**

Run: `cd D:/dev/JS-gen && D:/anaconda3/envs/browser_use/python.exe scripts/characterization/characterize-kb-store.py`
Expected: `ok: characterize-kb-store`

- [ ] **Step 5: verify-all 注册**

`scripts/refactor/verify-all.sh` 的 characterize 系列块（`run "characterize-capture-element-xpath" ...` 行之后）追加：

```bash
run "characterize-kb-store" "$PY" scripts/characterization/characterize-kb-store.py
```

Run: `bash scripts/refactor/verify-all.sh 2>&1 | grep -E "characterize-kb-store|FAILED"`
Expected: `ok: characterize-kb-store` 且（除已知存量 export-v3 外）无新 FAILED。

- [ ] **Step 6: Commit**

```bash
git add scripts/kb/__init__.py scripts/kb/store.py scripts/characterization/characterize-kb-store.py scripts/refactor/verify-all.sh
git commit -m "feat(kb): KB 存储基础 scripts/kb/store.py + 特征化（KB-1 前置）"
```

---

### Task 2: 字典导出链路（JS 片段 + normalize + 特征化）

**Files:**
- Create: `scripts/controller/actions/js_snippets/kb_export.py`
- Create: `scripts/kb/normalize.py`
- Create: `scripts/characterization/characterize-kb-normalize.py`
- Modify: `scripts/refactor/verify-all.sh`（追加 1 行）

**Interfaces:**
- Consumes: Task 1 的 store（无直接依赖，本任务独立）。
- Produces:
  - `JS_EXPORT_DICTS`（字符串，`() => {...}`，返回 JSON 字符串 `{"ok":true,"keys":[...],"payload":{...}}` / `{"ok":false,"error":"dict-keys-not-found"}`）
  - `normalize.normalize_raw(raw) -> {"by_type": {dctTp: [{"text","value","seq","group"}...]}, "counts": {"types":N,"entries":M}}`
  - `matcher` 在 Task 5；本任务不实现。

- [ ] **Step 1: 写失败的特征化脚本**

创建 `scripts/characterization/characterize-kb-normalize.py`：

```python
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
    partial = match_dict_for_options(["信贷正式客户", "企业客户"], by_type)
    assert partial["best"]["dict_type"] in ("cstSt", "cstTp") and partial["best"]["score"] < 1.0

    print("ok: characterize-kb-normalize")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 跑特征化确认失败**

Run: `cd D:/dev/JS-gen && D:/anaconda3/envs/browser_use/python.exe scripts/characterization/characterize-kb-normalize.py`
Expected: FAIL — `No module named 'scripts.kb.normalize'`（或 matcher）

- [ ] **Step 3: 实现 `scripts/kb/normalize.py`**

```python
"""归一化天阳 localStorage 字典缓存（vue_Tansun_dict*）。

输入形态防御式处理：对象（key=来源 key）/ 扁平 list / 嵌套 JSON 字符串均可；
缺 dctTp 的条目剔除（type 字段作后备，如 WarrantTypeCd_01 → 取 _ 前段不在此处做，
归一映射走 dict_alias.json）。
"""
import json


def _flatten_entries(raw):
    if isinstance(raw, list):
        out = []
        for item in raw:
            out.extend(_flatten_entries(item))
        return out
    if isinstance(raw, dict):
        if any(k in raw for k in ("text", "value", "dctTp")):
            return [raw]
        out = []
        for v in raw.values():
            out.extend(_flatten_entries(v))
        return out
    if isinstance(raw, str):
        try:
            return _flatten_entries(json.loads(raw))
        except Exception:
            return []
    return []


def normalize_raw(raw):
    entries = _flatten_entries(raw)
    by_type = {}
    for e in entries:
        dct_tp = str(e.get("dctTp") or "").strip()
        if not dct_tp:
            continue
        by_type.setdefault(dct_tp, []).append({
            "text": str(e.get("text") or "").strip(),
            "value": str(e.get("value") if e.get("value") is not None else "").strip(),
            "seq": str(e.get("seq") or "").strip(),
            "group": str(e.get("group") or "").strip(),
        })
    for tp in by_type:
        by_type[tp].sort(key=lambda x: (x["seq"] == "", x["seq"]))
    return {
        "by_type": by_type,
        "counts": {
            "types": len(by_type),
            "entries": sum(len(v) for v in by_type.values()),
        },
    }
```

创建 `scripts/kb/matcher.py`：

```python
"""字段选项文本集 ↔ 字典 text 集匹配（label→dictType 打通）。"""


def match_dict_for_options(options, by_type, min_score=0.6):
    """options: 选项文本 list[str]；by_type: normalize_raw 输出的 by_type。

    得分 = |选项∩text| / |选项|；≥min_score 才给 best。返回
    {"best": {"dict_type","score","hits"} | None, "score": float, "ranked": [...前10]}。
    """
    opts = {str(o or "").strip() for o in (options or []) if str(o or "").strip()}
    if not opts:
        return {"best": None, "score": 0.0, "ranked": []}
    ranked = []
    for tp, entries in (by_type or {}).items():
        texts = {e.get("text", "") for e in entries}
        hits = len(opts & texts)
        if not hits:
            continue
        ranked.append({"dict_type": tp, "score": round(hits / len(opts), 3), "hits": hits})
    ranked.sort(key=lambda x: (-x["score"], -x["hits"], x["dict_type"]))
    best = ranked[0] if ranked and ranked[0]["score"] >= min_score else None
    return {"best": best, "score": best["score"] if best else 0.0, "ranked": ranked[:10]}
```

- [ ] **Step 4: 跑特征化确认通过**

Run: `cd D:/dev/JS-gen && D:/anaconda3/envs/browser_use/python.exe scripts/characterization/characterize-kb-normalize.py`
Expected: `ok: characterize-kb-normalize`

- [ ] **Step 5: JS_EXPORT_DICTS 片段**

创建 `scripts/controller/actions/js_snippets/kb_export.py`：

```python
"""
JS snippet constant: JS_EXPORT_DICTS。

导出天阳前端 localStorage 的全量业务字典缓存（key 前缀 vue_Tansun_dict，
实测单 key `vue_Tansun_dict-<域名>` 约 1MB / 1333 个字典类型，条目
{text, value, dctTp, group, seq}）。返回原始 payload，归一化在 Python 侧
（scripts/kb/normalize.py）完成——JS 只做读取与防御式 JSON.parse。
"""
import json  # noqa: F401  (占位：本文件仅含 JS 字符串常量)

JS_EXPORT_DICTS = '''() => {
    const KEY_PREFIX = 'vue_Tansun_dict';
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(KEY_PREFIX) === 0) keys.push(k);
    }
    if (!keys.length) return JSON.stringify({ ok: false, error: 'dict-keys-not-found' });
    const payload = {};
    const skipped = [];
    for (const k of keys) {
        try {
            payload[k] = JSON.parse(localStorage.getItem(k));
        } catch (e) {
            skipped.push(k);
        }
    }
    return JSON.stringify({ ok: true, keys: keys, skipped: skipped, payload: payload });
}'''
```

注：文件末尾 `import json` 若触发 lint 不满可删除（本文件只导出字符串常量，无 Python 逻辑）。

- [ ] **Step 6: JS 语法校验**

Run: `cd D:/dev/JS-gen && node -e "const fs=require('fs'); const src=fs.readFileSync('scripts/controller/actions/js_snippets/kb_export.py','utf8'); const m=src.match(/JS_EXPORT_DICTS = r?'''([\s\S]*?)'''/); new Function('return ('+m[1]+')'); console.log('JS parse OK')"`
Expected: `JS parse OK`

- [ ] **Step 7: verify-all 注册**

`scripts/refactor/verify-all.sh` characterize-kb-store 行后追加：

```bash
run "characterize-kb-normalize" "$PY" scripts/characterization/characterize-kb-normalize.py
```

Run: `bash scripts/refactor/verify-all.sh 2>&1 | grep -E "characterize-kb|FAILED"`
Expected: 两个 kb 特征化 ok，无新 FAILED。

- [ ] **Step 8: Commit**

```bash
git add scripts/kb/normalize.py scripts/kb/matcher.py scripts/controller/actions/js_snippets/kb_export.py scripts/characterization/characterize-kb-normalize.py scripts/refactor/verify-all.sh
git commit -m "feat(kb): 字典导出链路——JS_EXPORT_DICTS + normalize/matcher + 特征化（KB-1）"
```

---

### Task 3: `data/kb` 落地 + `kb_dict` 召回动作（含 6 张流程卡与前 4 个动作）

**Files:**
- Create: `scripts/controller/actions/_kb.py`
- Create: `data/kb/dict_alias.json`
- Create: `data/kb/flows/customer_onboarding.json`、`credit_application.json`、`credit_usage.json`、`approval_todo.json`、`customer_360.json`、`session_login.json`
- Modify: `.gitignore`（追加 `data/kb/dicts_normalized.json`）
- Modify: `scripts/controller/service.py`（+2 行：import 与注册，紧随 `_register_observe_actions`）
- Create: `scripts/characterization/characterize-kb-actions.py`
- Modify: `scripts/refactor/verify-all.sh`（追加 1 行）

**Interfaces:**
- Consumes: Task 1 store 全部签名；Task 2 normalize/matcher。
- Produces（控制器动作，registry 名）:
  - `export_dicts()` → `_ok('ok:' + json{types, entries, file})`
  - `kb_dict(dict_type, text='')` → `_ok('ok:' + json{dict_type, entries})` / `_err('kb-dict-type-not-found | known: ...')`
  - `kb_flow(flow_name)` → `_ok('ok:' + json card)` / `_err('kb-flow-not-found | known: ...')`
  - `kb_state(entity, status='')` → `_ok('ok:' + json[...])` / `_err('kb-state-not-found | known entities: ...')`
  - `kb_rule(keyword='')` → `_ok('ok:' + json[...])`
  - `kb_field(label, options_json='')` → `_ok('ok:' + json{label, deps, dict_match})`

- [ ] **Step 1: 写失败的特征化脚本**

创建 `scripts/characterization/characterize-kb-actions.py`：

```python
"""characterize-kb-actions: kb_* 召回动作语义 pin（FakeCtx，无浏览器）。

依赖 data/kb/flows/*.json 已入库（Task 4 内容前置到本任务前执行：
本脚本只要求 credit_application.json 存在——由 Task 3 Step 2 先写卡）。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


class FakeCtx:
    async def get_current_page(self):
        raise RuntimeError("no page in characterization")


def main():
    from scripts.controller.service import build_controller

    ctrl = build_controller(FakeCtx())
    acts = ctrl.registry.registry.actions
    need = ["kb_dict", "kb_flow", "kb_state", "kb_rule", "kb_field", "export_dicts"]
    missing = [n for n in need if n not in acts]
    assert not missing, "missing actions: %s" % missing

    # kb_flow：别名命中流程卡
    r = acts["kb_flow"].function("对公授信申请")
    s = str(r)
    assert "nextBefore" in s, "flow card must carry nextBefore gate: %s" % s[:200]

    # kb_flow：未知流程 → 已知清单
    r2 = str(acts["kb_flow"].function("不存在的流程"))
    assert "kb-flow-not-found" in r2 and "对公授信申请" in r2

    # kb_dict：无数据文件 → 结构化 not-found（不抛异常）
    r3 = str(acts["kb_dict"].function("cstSt", ""))
    assert "kb-dict-type-not-found" in r3 or '"ok"' in r3 or "ok:" in r3

    # kb_state / kb_rule：流程卡入库后可召回
    r4 = str(acts["kb_state"].function("授信申请", "审批中"))
    assert "撤销" in r4, r4[:200]
    r5 = str(acts["kb_rule"].function("退回"))
    assert "退回" in r5, r5[:200]

    # kb_field：依赖组检索（无需 options）
    r6 = str(acts["kb_field"].function("上市公司标志", ""))
    assert "deps" in r6, r6[:200]

    print("ok: characterize-kb-actions")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 先写 6 张流程卡（特征化的数据前置）**

创建 `data/kb/dict_alias.json`：

```json
{
  "cstTpcd": "cstTp",
  "CstTpCd": "cstTp",
  "PcsgStcd": "pcsgSt"
}
```

创建 `data/kb/flows/customer_onboarding.json`：

```json
{
  "flow": "对公客户建档",
  "aliases": ["对公客户管理", "客户建档", "新增客户"],
  "menu_path": "客户管理/客户信息维护/对公客户管理",
  "biz_key_prefix": [],
  "preconditions": [
    "测试环境登录仅需账号密码（验证码/法人可留空）；生产环境转人工（环境开关）",
    "新增前查重：按客户名称/证件号码查询确认不存在"
  ],
  "nodes": [
    {"id": "list", "page": "对公客户管理列表页", "enter": "菜单 客户管理/客户信息维护/对公客户管理", "buttons": ["查询", "重置", "新增", "修改", "查看", "撤销", "流程轨迹"]},
    {"id": "check_drawer", "page": "新增客户校验抽屉", "enter": "点击新增", "fields": ["客户状态(默认信贷预客户)", "对公客户类型*", "证件类型*(+OCR识别,禁入)", "客户名称*", "证件号码*"], "buttons": ["保存", "取消"]},
    {"id": "edit_page", "page": "客户编辑上下文页(hostCstmgrCrtCpctInf)", "enter": "校验抽屉保存后跳转", "note": "26字段过半disabled；日期 native setter+blur 提交；登记日期=真实时间非营业日期"},
    {"id": "view360", "page": "客户360视图(FS00008308)", "enter": "列表点客户名称按钮", "tabs": ["客户概况", "基本信息", "业务信息", "五级分类", "征信分析"]}
  ],
  "field_deps": [
    {"if": "中征码标志", "then": ["中征码"]},
    {"if": "上市公司标志", "then": ["上市地", "股票代码"]},
    {"if": "政府平台标志", "then": ["政府平台级别", "政府平台属性", "政府平台类型"]},
    {"if": "科创标志", "then": ["科创类型"]}
  ],
  "state_actions": [
    {"entity": "客户", "status": "草稿客户", "allow": ["修改", "删除"]},
    {"entity": "客户", "status": "信贷预客户", "allow": ["修改", "查看"]},
    {"entity": "客户", "status": "信贷正式客户", "allow": ["修改", "查看", "发起授信", "发起用信"]}
  ],
  "rules": [
    {"keyword": "查重", "rule": "新增前按客户名称/证件号码查询，命中即中止"},
    {"keyword": "360", "rule": "360 URL 携带完整业务上下文（cstNo/cstSt/crdtNo/fcnScnEcd/avyEcd），不可手工构造，必须走 UI 链"}
  ],
  "exceptions": [],
  "source": "K1 2026-08-31（tmp/k1_notes.md）"
}
```

创建 `data/kb/flows/credit_application.json`：

```json
{
  "flow": "对公授信申请",
  "aliases": ["新增对公授信管理", "授信申请", "对公授信"],
  "menu_path": "授信管理/对公授信管理/新增对公授信管理",
  "biz_key_prefix": [],
  "preconditions": [
    "nextBefore 风控闸门：客户状态=信贷预客户时点「下一步」被静默拦截（控制台 调用nextBefore结果为false）——须信贷正式客户或走「二合一（授信+用信）」路径",
    "列表页（浏览态）无保存/提交按钮：选择客户回填的是列表查询区，必须先点「新增」进入表单（交易 205 实证）",
    "表单未完成态 click_save 守卫判 not-form-save 拒绝——正确防御（交易 206 实证）"
  ],
  "nodes": [
    {"id": "list", "page": "新增对公授信管理列表页", "enter": "菜单链", "buttons": ["查询", "重置", "新增", "修改", "查看", "撤销", "流程轨迹"], "columns": ["申请编号", "客户编号", "客户名称", "授信额度", "期限", "期限单位", "审批状态", "经办日期", "客户经理"]},
    {"id": "form", "page": "授信申请表单(新增后)", "enter": "点击新增", "note": "向导式：业务主体选择→风险阻断→授信表单分区（金额/期限/品种组织方式待正式客户补采）", "buttons": ["选择客户", "保存", "提交"]},
    {"id": "picker", "page": "选择对公授信客户弹窗", "enter": "表单内点击选择客户", "fields": ["客户编号", "客户名称", "对公客户类型", "证件类型", "证件号码", "客户状态"], "buttons": ["查询", "重置", "取消", "确认"], "note": "三段式：查询→单选(radio)→确认；确认回填 客户编号/客户名称(+证件号码)"}
  ],
  "field_deps": [],
  "state_actions": [
    {"entity": "授信申请", "status": "草稿/待发起", "allow": ["修改", "删除", "提交"]},
    {"entity": "授信申请", "status": "审批中", "allow": ["撤销", "流程轨迹"]},
    {"entity": "授信批复", "status": "生效", "allow": ["查看", "作废", "重新发起", "下载批复文件"]}
  ],
  "rules": [
    {"keyword": "选择客户", "rule": "三段式专用动作 picker_dialog_query/picker_dialog_select；回填 diff 用于断言"},
    {"keyword": "草稿客户", "rule": "授信选择器排除草稿客户（信贷预客户/正式客户可见）"}
  ],
  "exceptions": ["测试环境 vCratNo is not defined（前端缺陷，2026-08-31 实证）"],
  "source": "K1 2026-08-31 + 交易 203-206 实测"
}
```

创建 `data/kb/flows/credit_usage.json`：

```json
{
  "flow": "对公用信申请",
  "aliases": ["用信申请", "对公用信管理"],
  "menu_path": "用信管理/对公用信管理/对公用信申请",
  "biz_key_prefix": ["YXPC=用信业务流水号前缀"],
  "preconditions": ["授信批复生效后才可用信（额度管控冻结/解冻流程佐证）"],
  "nodes": [
    {"id": "list", "page": "对公用信申请列表页", "enter": "菜单 用信管理/对公用信管理/对公用信申请", "buttons": ["引入", "查询", "重置", "新增", "修改", "删除", "查看", "撤销", "流程轨迹"], "columns": ["用信业务流水号(YXPC*)", "业务发生类型", "产品名称(多值)", "申请金额", "流程状态", "发起模式", "创建时间"]},
    {"id": "picker", "page": "客户放大镜弹窗", "enter": "点击引入", "note": "引入=回填客户查询上下文（查询区三框 disabled），不是授信数据导入"}
  ],
  "field_deps": [],
  "state_actions": [
    {"entity": "用信申请", "status": "待发起", "allow": ["修改", "删除"]},
    {"entity": "用信申请", "status": "审批中", "allow": ["撤销", "流程轨迹"]}
  ],
  "rules": [
    {"keyword": "引入", "rule": "查询区 disabled，仅能经「引入」→客户放大镜选客户回填查询条件"},
    {"keyword": "二合一", "rule": "发起模式含「二合一（授信+用信）」合并发起路径"},
    {"keyword": "多产品", "rule": "一笔申请可挂多产品（逗号串）"}
  ],
  "exceptions": [],
  "source": "K1 2026-08-31"
}
```

创建 `data/kb/flows/approval_todo.json`：

```json
{
  "flow": "审批待办",
  "aliases": ["待办任务", "任务事项", "工作流审批"],
  "menu_path": "工作台/任务事项/待办任务",
  "biz_key_prefix": ["PMS=权限申请", "ZXJC=专项检查", "PJ=评级", "LS=履约", "YPSTFF=押品", "PRTNA=合作方", "ZG=资格", "GJ=归档", "EXIST=存量", "DGSX=对公授信"],
  "preconditions": ["审批动作不可逆：提交/通过/退回须 LLM 声明意图 + wf_submit_guard 复核 + 审批历史回读"],
  "nodes": [
    {"id": "cards", "page": "待办任务页(#/portal/wfPendTask)", "enter": "菜单 工作台/任务事项/待办任务", "structure": "状态页签(待办/已办未结/已办已结) + 业务域树 + todo-item 卡片", "card_fields": ["【流程名】节点名", "业务主键", "上一节点处理人(姓名丨岗位)", "发起人(工号)", "审批中徽标"], "actions": ["处理", "转交", "流程跟踪"]},
    {"id": "track", "page": "审批历史弹窗", "enter": "卡片点流程跟踪", "columns": ["节点名称", "处理日期", "处理人", "处理机构", "处理状态", "审批耗时", "操作", "审批意见"]}
  ],
  "field_deps": [],
  "state_actions": [
    {"entity": "审批任务", "status": "待办", "allow": ["处理", "转交", "流程跟踪"]},
    {"entity": "审批任务", "status": "已办未结", "allow": ["流程跟踪"]},
    {"entity": "审批任务", "status": "已办已结", "allow": ["流程跟踪"]}
  ],
  "rules": [
    {"keyword": "退回", "rule": "节点名「退回_xxx」表示退回重办节点"},
    {"keyword": "业务主键", "rule": "前缀编码定位业务域；主键+节点即可还原业务上下文"},
    {"keyword": "转交", "rule": "标准待办再分配手段"}
  ],
  "exceptions": [],
  "source": "K1 2026-08-31 + 交易 203-206"
}
```

创建 `data/kb/flows/customer_360.json`：

```json
{
  "flow": "客户360视图",
  "aliases": ["360视图", "客户视图"],
  "menu_path": "对公客户管理列表页点客户名称按钮",
  "biz_key_prefix": [],
  "preconditions": ["URL 携带完整业务上下文（cstNo/cstSt/crdtNo/fcnScnEcd/avyEcd），不可手工构造，必须走 UI 链"],
  "nodes": [
    {"id": "view", "page": "客户360视图(FS00008308)", "enter": "列表点客户名称", "tabs": ["客户概况(集群指标/贷款产品持有/客户标签/风险预警/关联关系图谱)", "基本信息(约60只读字段)", "业务信息", "五级分类", "征信分析"]}
  ],
  "field_deps": [],
  "state_actions": [],
  "rules": [{"keyword": "只读", "rule": "360 视图全只读，用于核对建档/业务数据"}],
  "exceptions": [],
  "source": "K1 2026-08-31"
}
```

创建 `data/kb/flows/session_login.json`：

```json
{
  "flow": "登录与会话",
  "aliases": ["登录", "W0"],
  "menu_path": "#/login",
  "biz_key_prefix": [],
  "preconditions": ["测试环境：图形/手机验证码均不拦截（全留空）；法人下拉可留空", "生产环境转人工（环境开关）"],
  "nodes": [
    {"id": "login", "page": "登录页(#/login)", "fields": ["法人下拉(可空)", "用户名*", "密码*", "图形验证码(可空)", "手机验证码(可空)"], "buttons": ["登录"]},
    {"id": "home", "page": "首页(#/home)", "structure": "会话倒计时+营业时间条 / 24 一级模块 / 任务三分卡 / 公告 / 日历 / 贷款统计卡"}
  ],
  "field_deps": [],
  "state_actions": [],
  "rules": [
    {"keyword": "会话", "rule": "登录约 50 分钟倒计时，剩余<20min 告警；过期自动回登录页"},
    {"keyword": "营业日期", "rule": "localStorage businessDate（滞后真实日期）为业务日期字段默认；登记日期类系统戳用真实时间"}
  ],
  "exceptions": [],
  "source": "K1/K2 2026-08-31 + 多轮实测"
}
```

- [ ] **Step 3: 实现 `scripts/controller/actions/_kb.py`**

```python
"""Knowledge base (KB) recall/ingest actions for the credit SUT.

存储为文件型（data/kb/）：flows/*.json 与 dict_alias.json 入库，
dicts_normalized.json 由 export_dicts 生成（gitignore）。
召回动作不触浏览器（除 export_dicts），可在无页面上下文时调用。
"""
import json

from scripts.state import _record_action
from ._helpers import _ok, _err, _as_dict
from .js_snippets.kb_export import JS_EXPORT_DICTS
from scripts.kb import store as kb_store
from scripts.kb.normalize import normalize_raw
from scripts.kb.matcher import match_dict_for_options


def _register_kb_actions(controller, browser_context):
    @controller.action(
        "KB ingest: export the SUT dict cache (localStorage vue_Tansun_dict*) and "
        "write the normalized dict data file. Requires a logged-in session. Run once "
        "per login; kb_dict recall reads the written file."
    )
    async def export_dicts():
        page = await browser_context.get_current_page()
        raw = await page.evaluate(JS_EXPORT_DICTS)
        parsed = _as_dict(raw)
        if not parsed.get("ok"):
            return _err("kb-dict-export-failed | " + str(parsed.get("error") or raw)[:120])
        norm = normalize_raw(parsed.get("payload") or {})
        if not norm["counts"]["types"]:
            return _err("kb-dict-export-empty")
        kb_store.save_json(kb_store.DICTS_FILE, norm)
        _record_action("export_dicts", {}, "ok")
        return _ok("ok:" + json.dumps({
            "types": norm["counts"]["types"],
            "entries": norm["counts"]["entries"],
            "file": kb_store.DICTS_FILE,
        }, ensure_ascii=False))

    @controller.action(
        "KB recall: SUT dict entries by dictType (编码↔名称). Alias map normalizes "
        "synonym types; unknown type falls back to prefix match. Optional text "
        "substring filter on text/value."
    )
    async def kb_dict(dict_type: str, text: str = ""):
        data = kb_store.load_json(kb_store.DICTS_FILE, {})
        by_type = data.get("by_type") or {}
        if not by_type:
            return _err("kb-dict-empty | 先在有登录态的会话调用 export_dicts")
        alias = kb_store.load_alias_map()
        tp = kb_store.resolve_alias(alias, dict_type)
        entries = by_type.get(tp)
        if entries is None:
            prefs = sorted(t for t in by_type if t.lower().startswith(dict_type.lower()))
            if len(prefs) == 1:
                tp = prefs[0]
                entries = by_type[tp]
        if entries is None:
            return _err("kb-dict-type-not-found | known: " + ", ".join(sorted(by_type)[:24]))
        if text.strip():
            key = text.strip()
            entries = [e for e in entries if key in e.get("text", "") or key in e.get("value", "")]
        _record_action("kb_dict", {"dict_type": dict_type, "text": text}, "ok")
        return _ok("ok:" + json.dumps({"dict_type": tp, "entries": entries}, ensure_ascii=False))

    @controller.action(
        "KB recall: business flow card by name/alias — node graph, preconditions "
        "(gates), state×actions, field deps, rules. Call before walking an "
        "unfamiliar business flow."
    )
    async def kb_flow(flow_name: str):
        card = kb_store.find_flow(flow_name)
        if not card:
            names = [c.get("flow", "") for c in kb_store.load_flows()]
            return _err("kb-flow-not-found | known: " + ", ".join(names))
        _record_action("kb_flow", {"flow_name": flow_name}, "ok")
        return _ok("ok:" + json.dumps(card, ensure_ascii=False))

    @controller.action(
        "KB recall: allowed actions for an entity+status (state×action matrix). "
        "Use to decide what is legal to click next; empty status lists all statuses "
        "of the entity."
    )
    async def kb_state(entity: str, status: str = ""):
        rows = kb_store.collect_state_actions()
        hit = [r for r in rows if entity in r.get("entity", "") and (not status or status in r.get("status", ""))]
        if not hit:
            entities = sorted({r.get("entity", "") for r in rows})
            return _err("kb-state-not-found | known entities: " + ", ".join(entities))
        _record_action("kb_state", {"entity": entity, "status": status}, "ok")
        return _ok("ok:" + json.dumps(hit, ensure_ascii=False))

    @controller.action(
        "KB recall: hidden business rules by keyword (编码表/命名规则/操作惯例). "
        "Empty keyword lists all rules."
    )
    async def kb_rule(keyword: str = ""):
        rows = kb_store.collect_rules()
        if keyword.strip():
            key = keyword.strip()
            rows = [r for r in rows if key in r.get("keyword", "") or key in r.get("rule", "")]
        _record_action("kb_rule", {"keyword": keyword}, "ok")
        return _ok("ok:" + json.dumps(rows, ensure_ascii=False))

    @controller.action(
        "KB recall: field dependency groups (标志→明细) by label, plus optional "
        "dictType match for the field's option texts (options_json is a JSON array "
        "of option texts, e.g. from scan_visible_fields)."
    )
    async def kb_field(label: str, options_json: str = ""):
        deps = []
        for card in kb_store.load_flows():
            for d in card.get("field_deps") or []:
                if label in (d.get("if") or "") or label in (d.get("then") or []):
                    deps.append({"flow": card.get("flow"), **d})
        dict_match = None
        if options_json.strip():
            try:
                opts = json.loads(options_json)
            except Exception:
                opts = []
            data = kb_store.load_json(kb_store.DICTS_FILE, {})
            if data.get("by_type"):
                dict_match = match_dict_for_options(opts, data["by_type"])
        _record_action("kb_field", {"label": label}, "ok")
        return _ok("ok:" + json.dumps({"label": label, "deps": deps, "dict_match": dict_match}, ensure_ascii=False))
```

- [ ] **Step 4: service.py 接线（+2 行）**

`scripts/controller/service.py`：import 块 `from .actions._observe import _register_observe_actions` 之后加 `from .actions._kb import _register_kb_actions`；注册块 `_register_observe_actions(controller, browser_context)` 之后加 `_register_kb_actions(controller, browser_context)`。

- [ ] **Step 5: .gitignore 追加生成物**

`.gitignore` 末尾追加：

```
# KB 生成物：export_dicts 写出的归一字典数据（源是运行期 localStorage）
data/kb/dicts_normalized.json
```

- [ ] **Step 6: 跑特征化确认通过**

Run: `cd D:/dev/JS-gen && D:/anaconda3/envs/browser_use/python.exe scripts/characterization/characterize-kb-actions.py`
Expected: `ok: characterize-kb-actions`（先失败：actions 未注册；实现+接线后通过）

- [ ] **Step 7: import 门禁 + lint**

Run: `cd D:/dev/JS-gen && D:/anaconda3/envs/browser_use/python.exe -c "from scripts.controller.service import build_controller; class F:\n    async def get_current_page(self): raise RuntimeError('x'); build_controller(F()); print('wiring OK')" && npx eslint src/ --quiet`
Expected: `wiring OK`；eslint 0 error（本任务只动 Python/.gitignore/JSON，eslint 应零变更）。

- [ ] **Step 8: verify-all 注册 + 全量**

`scripts/refactor/verify-all.sh` characterize-kb-normalize 行后追加：

```bash
run "characterize-kb-actions" "$PY" scripts/characterization/characterize-kb-actions.py
```

Run: `bash scripts/refactor/verify-all.sh 2>&1 | grep -E "characterize-kb|FAILED"`
Expected: 三个 kb 特征化 ok；仅已知存量 export-v3 FAILED。

- [ ] **Step 9: Commit**

```bash
git add scripts/controller/actions/_kb.py scripts/controller/service.py data/kb/ scripts/characterization/characterize-kb-actions.py scripts/refactor/verify-all.sh .gitignore
git commit -m "feat(kb): kb_* 召回/摄取动作 + 6 张流程卡 + 特征化（KB-1/KB-2）"
```

---

### Task 4: 提示词召回 cue

**Files:**
- Modify: `scripts/prompts/agent-tools-common.md`（知识召回小节，追加在「🚨 观察阶梯」小节之后）

**Interfaces:**
- Consumes: Task 3 的动作名（kb_flow/kb_dict/kb_state/kb_rule/kb_field/export_dicts）。

- [ ] **Step 1: 追加小节**

在 `scripts/prompts/agent-tools-common.md` 的「🚨 观察阶梯」小节之后追加：

```markdown
## 🚨 知识召回（kb_*，天阳信贷）

1. 走不熟悉的业务流前先 `kb_flow(流程名)` 召回节点图/前置闸门/状态×动作——召回到的前置条件（如 nextBefore 闸门）是硬边界，不得试探绕过。
2. 填 select 前对值的编码语义没把握时 `kb_dict(dictType)` 查码表；遇到「标志→明细」联动字段用 `kb_field(label)`；判断某状态下能点什么用 `kb_state(实体, 状态)`。
3. 召回不到 = 知识缺口：现场摸索成功后在最终回复中上报缺口（流程名+缺失点），不要编造知识。
4. `export_dicts` 仅在有登录态且 kb_dict 报 empty 时调用（一次登录一次）。
```

- [ ] **Step 2: 自测**

Run: `cd D:/dev/JS-gen && grep -c "kb_flow" scripts/prompts/agent-tools-common.md && git diff --stat scripts/prompts/`
Expected: ≥1；diff 仅该文件、以 + 行为主。

- [ ] **Step 3: Commit**

```bash
git add scripts/prompts/agent-tools-common.md
git commit -m "feat(prompts): kb_* 知识召回 cue（KB-3）"
```

---

### Task 5: 湿测（主线程执行，非子任务——需服务与登录态）

**Files:**
- Create: `tmp/kb_live_check.py`（临时脚本，gitignored）

**Interfaces:**
- Consumes: 控制面 4097 在线、executor LMY online、DB 隧道 13306、`tmp/api_drill.py` 的 `call/action` 同款封装。

- [ ] **Step 1: 写湿测脚本**

`tmp/kb_live_check.py`：POST 新建交易→attach→prepare→watcher/action 依次调 `export_dicts` → 断言 `data/kb/dicts_normalized.json` 存在且 types>1000 → `kb_dict(cstSt)` 断言含「信贷正式客户」→ `kb_flow(对公授信申请)` 断言含 nextBefore → `kb_field(上市公司标志)` 断言 deps 非空 → record/stop + detach。

- [ ] **Step 2: 跑并记录**

Run: `cd D:/dev/JS-gen && PYTHONIOENCODING=utf-8 D:/anaconda3/envs/browser_use/python.exe tmp/kb_live_check.py`
Expected: 全部断言通过；记录 types/entries 数值。

- [ ] **Step 3: 结果回填**

把实测数值（types/entries、kb_dict 样例）写进 `docs/superpowers/research/2026-08-31-api-drive-chain.md` 新增 §10「KB 召回实测」；agent-log 顶部追加一条。

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/research/2026-08-31-api-drive-chain.md docs/superpowers/agent-log.md
git commit -m "docs(kb): KB 召回湿测实测记录（KB-4 第一阶段）"
```

---

### Task 6: KB-4 对照湿测（有/无知识召回走「用信申请」）

**Files:**
- Create: `tmp/kb_ab_drill.py`（临时）

- [ ] **Step 1: 写 A/B 驱动**

同一条「用信申请」流程跑两遍（两笔交易）：A 轮不调 kb_*（基线），B 轮在 P0 后调 `kb_flow(对公用信申请)` 并按召回的节点图/前置条件行动。计数指标：无效操作数（err-* 结果的动作数）、到达「列表可见+引入弹窗打开」的步数、总耗时。

- [ ] **Step 2: 跑两轮并记录对照表**

Run: 两遍 `tmp/kb_ab_drill.py`（B 轮加 `--kb` 参数）
Expected: B 轮 err-* 动作数 ≤ A 轮；记录进 research 文档 §10。

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/research/2026-08-31-api-drive-chain.md docs/superpowers/agent-log.md
git commit -m "docs(kb): KB-4 有/无召回对照湿测记录"
```

---

## Self-Review 记录

- **Spec 覆盖**：设计文档 §四 管线 P1→Task 2/3；P2→Task 3（6 卡）；P3→后续批次（计划外，已在 §七 标注）；P4→Task 5 的 kb_field（matcher 已含）；§五 召回接口→Task 3/4；KB-1..4→Task 2-6。§六 首批 6 张卡→Task 3。无缺口。
- **占位符扫描**：无 TBD/TODO；所有代码块完整。
- **类型一致性**：`parse_result_json`/`ok_of` 未在本计划使用（属 tmp 驱动）；`kb_store` 签名与 Task 3 用法一致；动作名与 cue 文案一致。
