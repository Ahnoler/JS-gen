"""Section scope helpers — LLM-declared section filter for pending/save/assistant."""
from __future__ import annotations

import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from scripts.models.task import TaskList


def norm_sec(s: str) -> str:
    return " ".join((s or "").split()).strip()


def strip_sec_suffix(s: str) -> str:
    return re.sub(r"#\d+$", "", norm_sec(s))


def section_matches(want: str, section_id: str = "", section_title: str = "") -> bool:
    """Align with JS_CLICK_SAVE_BUTTON secMatches (exact id/title; strip #n)."""
    want_norm = norm_sec(want)
    if not want_norm:
        return True
    sid = norm_sec(section_id)
    title = norm_sec(section_title)
    want_base = strip_sec_suffix(want_norm)
    return (
        sid == want_norm
        or title == want_norm
        or strip_sec_suffix(sid) == want_norm
        or strip_sec_suffix(sid) == want_base
        or title == want_base
    )


def pending_fillable_items(tl: "TaskList") -> list:
    return [i for i in tl.pending if not i.needs_intervention and (i.label or "").strip()]


def filter_pending_labels(tl: "TaskList", section: str = "") -> list[str]:
    items = pending_fillable_items(tl)
    if norm_sec(section):
        items = [
            i for i in items
            if section_matches(section, i.section_id, i.section_title)
        ]
    return [i.label for i in items]


def pending_by_section(tl: "TaskList") -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for i in pending_fillable_items(tl):
        key = (i.section_title or i.section_id or "__root__").strip() or "__root__"
        out.setdefault(key, []).append(i.label)
    return out


def requires_section_declaration(tl: "TaskList") -> bool:
    """True when click_save must receive section= (pending spans ≥2 blocks)."""
    return len(pending_by_section(tl)) >= 2


def unique_button_section(buttons: list | None, button_text: str = "保存") -> str | None:
    """If exactly one distinct section among buttons matching ``button_text``, return it.

    Uses DOM scan buttons (not phase NL). Prefer ``section_title``, else ``section_id``.
    Returns None when 0 or ≥2 matching sections (LLM must declare section=).
    """
    needle = re.sub(r"\s+", "", norm_sec(button_text) or "保存")
    if not needle:
        needle = "保存"
    keys: list[str] = []
    seen: set[str] = set()
    for b in buttons or []:
        if not isinstance(b, dict):
            continue
        lab = re.sub(r"\s+", "", norm_sec(b.get("label") or ""))
        if not lab:
            continue
        if needle not in lab and lab not in needle:
            continue
        key = norm_sec(b.get("section_title") or "") or norm_sec(b.get("section_id") or "")
        if not key or key == "__root__":
            continue
        if key not in seen:
            seen.add(key)
            keys.append(key)
    if len(keys) == 1:
        return keys[0]
    return None
