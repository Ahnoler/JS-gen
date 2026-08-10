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


def section_matches(
    want: str,
    section_id: str = "",
    section_title: str = "",
    region_label: str = "",
) -> bool:
    """Align with JS_CLICK_SAVE_BUTTON secMatches; also accept L1 region_label."""
    want_norm = norm_sec(want)
    if not want_norm:
        return True
    sid = norm_sec(section_id)
    title = norm_sec(section_title)
    region = norm_sec(region_label)
    want_base = strip_sec_suffix(want_norm)
    return (
        sid == want_norm
        or title == want_norm
        or region == want_norm
        or strip_sec_suffix(sid) == want_norm
        or strip_sec_suffix(sid) == want_base
        or title == want_base
        or region == want_base
    )


def pending_fillable_items(tl: "TaskList") -> list:
    return [i for i in tl.pending if not i.needs_intervention and (i.label or "").strip()]


def filter_pending_labels(tl: "TaskList", section: str = "") -> list[str]:
    items = pending_fillable_items(tl)
    if norm_sec(section):
        items = [
            i for i in items
            if section_matches(
                section,
                i.section_id,
                i.section_title,
                getattr(i, "region_label", "") or "",
            )
        ]
    return [i.label for i in items]


def pending_by_section(tl: "TaskList") -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for i in pending_fillable_items(tl):
        key = (
            (getattr(i, "region_label", None) or "")
            or i.section_title
            or i.section_id
            or "__root__"
        ).strip() or "__root__"
        out.setdefault(key, []).append(i.label)
    return out


def requires_section_declaration(tl: "TaskList") -> bool:
    """True when click_save must receive section= (pending spans ≥2 blocks)."""
    return len(pending_by_section(tl)) >= 2


def same_label_section_keys(buttons: list | None, button_text: str = "保存") -> list[str]:
    """Distinct section titles/ids for visible scan buttons matching ``button_text``.

    Empty / __root__ sections omitted. Order = first-seen in ``buttons``.
    """
    needle = re.sub(r"\s+", "", norm_sec(button_text) or "保存") or "保存"
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
        key = (
            norm_sec(b.get("region_label") or "")
            or norm_sec(b.get("section_title") or "")
            or norm_sec(b.get("section_id") or "")
        )
        if not key or key == "__root__":
            continue
        if key not in seen:
            seen.add(key)
            keys.append(key)
    return keys


def unique_button_section(buttons: list | None, button_text: str = "保存") -> str | None:
    """If exactly one distinct region/section among buttons matching ``button_text``, return it.

    Prefer ``region_label``, then ``section_title`` / ``section_id``.
    Returns None when 0 or ≥2 matching keys (LLM must declare section=).
    """
    keys = same_label_section_keys(buttons, button_text)
    if len(keys) == 1:
        return keys[0]
    return None


def preferred_submit_button(store: dict | None, section: str = "") -> str:
    """Pick submit/save button text for this phase/section from scanned buttons.

    Prefer ``暂存`` (评级等级测算) over ``保存``/``提交`` so already-matched loop
    breaks and NEXT_ACTION do not send the agent hunting a non-existent 保存.
    """
    sec = norm_sec(section) or (resolve_phase_section(store) if store else "")
    buttons = (store or {}).get("_scan_buttons") or []
    labels: list[str] = []
    for b in buttons:
        if not isinstance(b, dict):
            continue
        lab = norm_sec(b.get("label") or "")
        if not lab:
            continue
        if sec and not section_matches(
            sec,
            b.get("section_id") or "",
            b.get("section_title") or "",
            b.get("region_label") or "",
        ):
            continue
        labels.append(lab)
    for prefer in ("暂存", "保存", "提交"):
        for lab in labels:
            compact = re.sub(r"\s+", "", lab)
            if prefer == compact or prefer in compact:
                return prefer
    return "保存"


def preferred_submit_cue(store: dict | None, section: str = "") -> str:
    """Human/agent cue: click_save with preferred button + section when known."""
    explicit_sec = norm_sec(section)
    sec = explicit_sec or (resolve_phase_section(store) if store else "")
    btn = preferred_submit_button(store, section=sec)
    keys = same_label_section_keys((store or {}).get("_scan_buttons"), btn)
    if len(keys) >= 2:
        return (
            f"Multiple '{btn}' buttons in {keys!r}. "
            f"Call click_save(button_text='{btn}', section='…') with the phase block title. "
            f"Do NOT call bare click_save() — sticky section is ignored when ambiguous."
        )
    sec_part = f", section='{sec}'" if sec else ""
    has_calc = False
    for b in (store or {}).get("_scan_buttons") or []:
        if not isinstance(b, dict):
            continue
        lab = norm_sec(b.get("label") or "")
        if sec and not section_matches(
            sec,
            b.get("section_id") or "",
            b.get("section_title") or "",
            b.get("region_label") or "",
        ):
            continue
        if "测算" in lab and "等级测算" not in lab:  # button 测算, not section title alone
            has_calc = True
            break
        if lab == "测算":
            has_calc = True
            break
    prefix = ""
    if has_calc and btn == "暂存":
        prefix = "If 测算 is required and not yet done, click 测算 once; then "
    return (
        f"{prefix}click_save(button_text='{btn}'{sec_part}). "
        f"Do NOT click_element_by_index for {btn}. "
        "Do NOT re-select already-matched fields."
    )


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
        t = (
            norm_sec(b.get("region_label") or "")
            or norm_sec(b.get("section_title") or "")
            or norm_sec(b.get("section_id") or "")
        )
        if t and t != "__root__" and t not in seen:
            seen.add(t)
            titles.append(t)
    try:
        from scripts.models.task import TaskList
        tl = TaskList.from_store(store.get("task_list"))
        for i in list(tl.pending) + list(tl.done):
            t = (
                norm_sec(getattr(i, "region_label", "") or "")
                or norm_sec(getattr(i, "section_title", "") or "")
                or norm_sec(getattr(i, "section_id", "") or "")
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


def final_save_urgency_message(store: dict | None) -> str | None:
    """Penultimate-step / post-introduce cue: force click_save while tools still exist.

    Last browser-use step is DoneAgentOutput-only — never prescribe click_save there.
    Call this on near-last actionable steps or when picker/query UI just closed.
    """
    if not store:
        return None
    if store.get("_last_save_ok") or store.get("_query_ui") or store.get("_query_task"):
        return None
    if _phase_submit_not_required(store):
        return None
    sec = resolve_phase_section(store)
    try:
        cue = preferred_submit_cue(store, section=sec)
    except Exception:
        sec_part = f", section='{sec}'" if sec else ""
        cue = f"click_save(button_text='保存'{sec_part})"
    return (
        "[SYSTEM] Final save still required before the done-only last step. "
        f"NEXT_ACTION: {cue}. Do NOT only check_field_value / re-fill. "
        "Do NOT call done(success=true) until click_save returns ok-save-*."
    )


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
    try:
        from scripts.controller.actions.section_scope import preferred_submit_cue
        return (
            '[SYSTEM] Empty/invalid action. Return exactly one tool call. '
            f'NEXT_ACTION: {preferred_submit_cue(store, section=sec)}'
        )
    except Exception:
        sec_part = f", section='{sec}'" if sec else ""
        return (
            '[SYSTEM] Empty/invalid action. Return exactly one tool call. '
            f"NEXT_ACTION: click_save(button_text='保存'{sec_part}). "
            'Do not return empty actions.'
        )
