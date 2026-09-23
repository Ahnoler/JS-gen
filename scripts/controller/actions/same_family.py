"""Same-label multi-control dispatch for fill/select."""

from __future__ import annotations


def _norm_label(label: str) -> str:
    s = (label or "").strip()
    while s.endswith("：") or s.endswith(":"):
        s = s[:-1].rstrip()
    return s


def format_same_family_candidates(candidates: list | None) -> str:
    """Same listing used by record ``err_with`` next_action and replay ambiguous returns."""
    parts = [
        f"field_slot={c.get('field_slot')!r} xpath_smart={c.get('xpath_smart')!r}"
        for c in (candidates or [])
        if isinstance(c, dict)
    ]
    return "; ".join(parts) or "scan_form_fields 后带 xpath_smart 重试"


def resolve_same_family_target(
    fields: list,
    *,
    label: str,
    xpath_smart: str,
    action: str,
) -> dict:
    """Pick one same-label control for fill/select.

    action 为 'fill' 或 'select'。
    成功: {'ok': True, 'xpath_smart': str, 'field_slot': str, 'kind': str}
    歧义: {'ok': False, 'error': 'err-ambiguous-field-slot', 'candidates': [...]}
    不相关: {'ok': True, 'xpath_smart': xpath_smart, 'field_slot': '', 'kind': ''}
    """
    want = _norm_label(label)
    xp = (xpath_smart or "").strip()
    if action == "fill":
        allowed = {"input"}
    elif action == "select":
        allowed = {"select", "tssc-multi-select"}
    else:
        allowed = set()

    matches: list[dict] = []
    for f in fields or []:
        if not isinstance(f, dict):
            continue
        if _norm_label(str(f.get("label") or "")) != want:
            continue
        kind = (f.get("kind") or "").strip()
        if kind not in allowed:
            continue
        matches.append(f)

    if not matches:
        return {"ok": True, "xpath_smart": xp, "field_slot": "", "kind": ""}

    def _ok_hit(f: dict) -> dict:
        return {
            "ok": True,
            "xpath_smart": (f.get("xpath_smart") or "").strip(),
            "field_slot": str(f.get("field_slot") or ""),
            "kind": (f.get("kind") or "").strip(),
        }

    def _ambiguous() -> dict:
        return {
            "ok": False,
            "error": "err-ambiguous-field-slot",
            "candidates": [
                {
                    "field_slot": str(f.get("field_slot") or ""),
                    "xpath_smart": (f.get("xpath_smart") or "").strip(),
                    "kind": (f.get("kind") or "").strip(),
                }
                for f in matches
            ],
        }

    if xp:
        for f in matches:
            if (f.get("xpath_smart") or "").strip() == xp:
                return _ok_hit(f)
        return _ambiguous()

    if len(matches) == 1:
        return _ok_hit(matches[0])
    return _ambiguous()
