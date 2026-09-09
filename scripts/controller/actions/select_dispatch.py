"""Shared select-family dispatch for record + replay (unify spec Phase A)."""
from __future__ import annotations

from dataclasses import dataclass

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

_JS_LIVE_TSSC = r'''([lab]) => {
  const want = String(lab || '').replace(/\s+/g, ' ').trim();
  if (!want) return false;
  const hit = (root) => {
    for (const item of root.querySelectorAll('.el-form-item')) {
      const l = (item.querySelector('.el-form-item__label')?.textContent || '')
        .replace(/\s+/g, ' ').trim();
      if (l === want || l.includes(want)) {
        return !!(item.querySelector('.tssc-multi-select'));
      }
    }
    return false;
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
