"""Shared select-family dispatch for record + replay (unify spec Phase A)."""
from __future__ import annotations

from dataclasses import dataclass

from .js_snippets.base import JS_FIELD_ITEM_PICK
from .js_snippets.container import JS_GET_CONTAINER

_TSSC_TARGET = frozenset({
    "form_tssc_multi_select",
    "tssc_multi_select",
    "form-tssc-multi-select",
})
_TREE_TARGET = frozenset({
    "form_tree_select",
    "tree_select",
    "form-tree-select",
})
_TSSC_KIND = frozenset({"tssc-multi-select", "tssc_multi_select"})
_TREE_KIND = frozenset({"tree-select", "tree", "tree_select"})

_JS_LIVE_TSSC = '''([lab]) => {
  const want = String(lab || '').replace(/\\s+/g, ' ').trim();
  if (!want) return false;
  const container = ''' + JS_GET_CONTAINER + ''';
  const pick = ''' + JS_FIELD_ITEM_PICK + ''';
  // 与动作体 findFieldItem 同源解析（JS_FIELD_ITEM_PICK）：可见精确 → 隐藏精确
  // → 唯一包含兜底，多命中=歧义。作用域对齐动作体：JS_GET_CONTAINER 优先，
  // 未中补扫可见 dialog/drawer（替换旧的 document 全域 [0] 盲取——隐藏同名
  // tssc 节点曾致 live 判定假阳性，与 fill 侧 err-use-tssc-multi-select 互相矛盾）。
  // 解析失败或歧义 → false（非 tssc 路径）。
  const resolveField = () => {
    const hit = pick(container, want);
    if (hit && hit.ambiguous) return { ambiguous: true };
    if (hit && hit.item) return { item: hit.item };
    for (const dlg of document.querySelectorAll('.el-dialog, .el-drawer')) {
      if (dlg.offsetParent === null) continue;
      const h2 = pick(dlg, want);
      if (h2 && h2.ambiguous) return { ambiguous: true };
      if (h2 && h2.item) return { item: h2.item };
    }
    return null;
  };
  const field = resolveField();
  return (field && field.item) ? !!(field.item.querySelector('.tssc-multi-select')) : false;
}'''


@dataclass(frozen=True)
class SelectDispatch:
    path: str
    reason: str


def _norm_tk(raw: str) -> str:
    return str(raw or "").strip().lower().replace("-", "_")


async def resolve_select_dispatch(
    *,
    label: str = "",
    element: dict | None = None,
    field_kind: str | None = None,
    page=None,
    force_path: str | None = None,
) -> SelectDispatch:
    if force_path in ("tssc", "tree", "el-select"):
        return SelectDispatch(path=force_path, reason="legacy_action" if force_path == "tssc" else "force")

    el = element if isinstance(element, dict) else {}
    tk = _norm_tk(str(el.get("target_kind") or ""))
    if tk in {_norm_tk(x) for x in _TSSC_TARGET}:
        return SelectDispatch(path="tssc", reason="target_kind")
    if tk in {_norm_tk(x) for x in _TREE_TARGET}:
        return SelectDispatch(path="tree", reason="target_kind")

    fk = str(field_kind or "").strip().lower()
    if fk in _TSSC_KIND or fk.replace("_", "-") == "tssc-multi-select":
        return SelectDispatch(path="tssc", reason="field_kind")
    if fk in _TREE_KIND or fk.replace("_", "-") == "tree-select":
        return SelectDispatch(path="tree", reason="field_kind")

    if page is not None and str(label or "").strip():
        try:
            live = bool(await page.evaluate(_JS_LIVE_TSSC, [label]))
        except Exception:
            live = False
        if live:
            return SelectDispatch(path="tssc", reason="live")

    return SelectDispatch(path="el-select", reason="default")
