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
