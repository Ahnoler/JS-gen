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


def remember_phase_section(store: dict | None, section: str) -> None:
    if store is None:
        return
    sec = norm_sec(section)
    if sec:
        store["_phase_section"] = sec


def clear_phase_section(store: dict | None) -> None:
    if store is None:
        return
    store.pop("_phase_section", None)


def resolve_phase_section(store: dict | None, *, task_text: str = "") -> str:
    """Return phase section scope or '' (full-table gate).

    Order: memory → unique/longest NL infer against button/task titles → ''.
    """
    if not store:
        return ""
    mem = norm_sec(str(store.get("_phase_section") or ""))
    if mem:
        return mem

    titles: list[str] = []
    seen: set[str] = set()
    for b in store.get("_scan_buttons") or []:
        if not isinstance(b, dict):
            continue
        t = norm_sec(b.get("section_title") or "") or norm_sec(b.get("section_id") or "")
        if t and t != "__root__" and t not in seen:
            seen.add(t)
            titles.append(t)
    try:
        from scripts.models.task import TaskList
        tl = TaskList.from_store(store.get("task_list"))
        for i in list(tl.pending) + list(tl.done):
            t = norm_sec(getattr(i, "section_title", "") or "") or norm_sec(
                getattr(i, "section_id", "") or ""
            )
            if t and t != "__root__" and t not in seen:
                seen.add(t)
                titles.append(t)
    except Exception:
        pass
    if not titles:
        return ""

    blob_parts: list[str] = []
    try:
        from ._phase_intent import get_phase_intent
        c = get_phase_intent(store) or {}
        blob_parts.append(str(c.get("goal") or ""))
        for x in c.get("in_scope") or []:
            blob_parts.append(str(x))
    except Exception:
        pass
    blob_parts.append(task_text or "")
    blob = norm_sec(" ".join(blob_parts))
    if not blob:
        return ""

    hits = [t for t in titles if t and t in blob]
    if not hits:
        return ""
    if len(hits) == 1:
        return hits[0]
    # nested substring: uniquely longest wins
    longest = max(hits, key=len)
    if sum(1 for t in hits if len(t) == len(longest)) == 1:
        return longest
    return ""


def is_empty_effective_actions(actions_raw, *, next_goal: str = "") -> bool:
    goal = (next_goal or "").strip()
    if not actions_raw:
        return True
    actives = []
    for a in actions_raw:
        try:
            d = a.model_dump(exclude_none=True) if hasattr(a, "model_dump") else {}
        except Exception:
            d = {}
        active = {k: v for k, v in (d or {}).items() if v is not None}
        if active:
            actives.append(active)
    if not actives:
        return True
    # treat unknown sole key AgentOutput as empty
    if len(actives) == 1 and set(actives[0].keys()) <= {"AgentOutput"}:
        return True
    if goal.startswith("Execute AgentOutput") and not any(
        k != "AgentOutput" for a in actives for k in a
    ):
        return True
    return False


def _phase_submit_not_required(store: dict | None) -> bool:
    """True when contract says no save/submit, or phase mode is non-maintain."""
    if not store:
        return False
    if store.get("_task_mode") == "query" or store.get("_query_task"):
        return True
    c = store.get("_phase_intent")
    if not isinstance(c, dict):
        return False
    mode = c.get("mode") or ""
    if mode in ("query", "navigate", "login"):
        return True
    try:
        from .phase.reviewer import coerce_bool

        submit = c.get("submit") if isinstance(c.get("submit"), dict) else {}
        return not coerce_bool(submit.get("required"))
    except Exception:
        return False


def empty_act_prescription_message(store, *, last_step: bool, save_ok: bool) -> str:
    if last_step:
        ok = bool(save_ok or (store or {}).get("_last_save_ok"))
        return (
            f'[SYSTEM] Empty action on last step. NEXT_ACTION: done(success={"true" if ok else "false"}). '
            'No other actions allowed this step.'
        )
    if save_ok or (store or {}).get("_last_save_ok"):
        return (
            '[SYSTEM] Empty action but save already succeeded. '
            'NEXT_ACTION: done(success=true). Do NOT click_save again.'
        )
    if _phase_submit_not_required(store):
        return (
            '[SYSTEM] Empty/invalid action. This phase does not require save. '
            'NEXT_ACTION: done(success=true). Do NOT click_save().'
        )
    sec = resolve_phase_section(store)
    sec_part = f", section='{sec}'" if sec else ""
    return (
        '[SYSTEM] Empty/invalid action. Return exactly one tool call. '
        f"NEXT_ACTION: click_save(button_text='保存'{sec_part}). "
        'Do not return empty actions.'
    )
