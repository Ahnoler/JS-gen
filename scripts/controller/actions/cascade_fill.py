"""Cascade round worklist helpers for run_form_assistant multi-round fill."""
from __future__ import annotations

from typing import Any

from scripts.controller.actions.section_scope import section_matches


def _item_key(label: str, xpath_smart: str = "") -> str:
    lab = (label or "").strip()
    xp = (xpath_smart or "").strip()
    return f"{lab}\0{xp}" if xp else lab


def still_empty_pending_dicts(
    pending_items: list[Any],
    *,
    section_filter: str = "",
    filled_ok_keys: set[str] | None = None,
) -> list[dict]:
    """Pending TaskItems still empty / not successfully filled — for Round2/3 retry.

    Skips needs_intervention and disabled+button (introduce) rows.
    """
    filled_ok_keys = filled_ok_keys or set()
    out: list[dict] = []
    for item in pending_items or []:
        label = (getattr(item, "label", None) or "").strip()
        if not label:
            continue
        if getattr(item, "needs_intervention", False):
            continue
        disabled = bool(getattr(item, "disabled", False))
        has_btn = bool(getattr(item, "hasButton", False) or getattr(item, "has_button", False))
        if disabled and has_btn:
            continue
        if disabled:
            continue
        if not section_matches(
            section_filter,
            getattr(item, "section_id", "") or "",
            getattr(item, "section_title", "") or "",
            getattr(item, "region_label", "") or "",
        ):
            continue
        xp = (getattr(item, "xpath_smart", None) or "").strip()
        key = _item_key(label, xp)
        if key in filled_ok_keys or label in filled_ok_keys:
            continue
        cur = (getattr(item, "currentValue", None) or getattr(item, "current_value", None) or "").strip()
        if cur:
            continue
        if hasattr(item, "model_dump"):
            out.append(item.model_dump())
        elif isinstance(item, dict):
            out.append(dict(item))
        else:
            out.append({"label": label, "xpath_smart": xp, "kind": getattr(item, "kind", "input")})
    return out


def merge_cascade_worklist(
    new_pending: list[dict],
    still_empty: list[dict],
) -> list[dict]:
    """Prefer new fields first; dedupe by label+xpath_smart."""
    seen: set[str] = set()
    out: list[dict] = []
    for d in list(new_pending or []) + list(still_empty or []):
        if not isinstance(d, dict):
            continue
        label = (d.get("label") or "").strip()
        if not label:
            continue
        key = _item_key(label, d.get("xpath_smart") or "")
        if key in seen:
            continue
        seen.add(key)
        out.append(d)
    return out


def filled_ok_keys_from_results(all_results: list[dict]) -> set[str]:
    """Labels (and label\\0xpath) that already succeeded in this assistant run."""
    from scripts.controller.actions._helpers import _is_ok_result

    keys: set[str] = set()
    for r in all_results or []:
        if not isinstance(r, dict):
            continue
        if not _is_ok_result(r.get("result")):
            continue
        label = (r.get("label") or "").strip()
        if not label:
            continue
        keys.add(label)
        xp = (r.get("xpath_smart") or "").strip()
        if xp:
            keys.add(_item_key(label, xp))
    return keys


def append_select_first_fallbacks(
    actions: list[dict],
    needs: list,
    select_items: list[dict],
) -> tuple[list[dict], list]:
    """If LLM skipped an ordinary select, append select_option option=first and drop needs."""
    acted = {(a.get("label") or "").strip() for a in (actions or []) if isinstance(a, dict)}
    extra: list[dict] = []
    fallback_labels: set[str] = set()
    for d in select_items or []:
        if not isinstance(d, dict):
            continue
        label = (d.get("label") or "").strip()
        if not label or label in acted:
            continue
        if d.get("disabled"):
            continue
        if d.get("hasButton") or d.get("has_button"):
            # introduce / adjacent-button — never first-option guess
            continue
        kind = (d.get("kind") or "select").strip().lower()
        if kind not in ("select", "select_option", "option"):
            continue
        extra.append(
            {
                "action": "select_option",
                "label": label,
                "option": "first",
                "xpath_smart": (d.get("xpath_smart") or "").strip(),
            }
        )
        fallback_labels.add(label)
    if not extra:
        return list(actions or []), list(needs or [])
    new_needs: list = []
    for n in needs or []:
        if isinstance(n, dict) and (n.get("label") or "").strip() in fallback_labels:
            continue
        new_needs.append(n)
    return list(actions or []) + extra, new_needs
