"""Shared select-family dispatch for record + replay (unify spec Phase A)."""
from __future__ import annotations

from dataclasses import dataclass

from .js_snippets.base import JS_FIELD_ITEM_CANDIDATES

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
  const candidatesOf = ''' + JS_FIELD_ITEM_CANDIDATES + ''';
  // 精确匹配优先：前缀兄弟（如「组件要素名称」）DOM 序在前时不得以兄弟的
  // 无 tssc 控件短路判定——先解析到真正会被操作的字段，再验其控件。
  const hit = (root) => {
    const item = candidatesOf(root, want)[0];
    return item ? !!(item.querySelector('.tssc-multi-select')) : false;
  };
  if (hit(document)) return true;
  for (const dlg of document.querySelectorAll('.el-dialog, .el-drawer')) {
    if (dlg.offsetParent === null) continue;
    if (hit(dlg)) return true;
  }
  return false;
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
