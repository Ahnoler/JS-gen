"""Shared fill attempt order for record + replay (unify spec Phase A)."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FillAttempt:
    path: str  # "xpath" | "label" | "placeholder" | "xpath_full"
    xpath: str = ""
    locate_src: str = ""  # "element" | "full" | "label" | "placeholder"
    hint: str = ""  # label or placeholder passed to JS_FILL_BY_XPATH
    js_kind: str = ""  # "by_xpath" | "form_field"


def resolve_fill_attempt_order(
    *,
    label: str = "",
    placeholder: str = "",
    xpath_smart: str = "",
    xpath_smart_src: str = "",
    xpath_full: str = "",
) -> list[FillAttempt]:
    """Return ordered fill attempts matching current replay locate ladder.

    Callers pass precomputed xpaths (from ``_resolve_replay_xpath`` / element
    extractors). Never consult ``params['xpath_smart']`` here — dirty-param
    lesson (traj 130).

    Order: primary xpath → label → placeholder (≠ label) → placeholder-only
    ``JS_FILL_BY_XPATH`` → ``xpath_full`` when distinct from primary xpath.
    """
    attempts: list[FillAttempt] = []
    lab = str(label or "").strip()
    ph = str(placeholder or "").strip()
    xp = str(xpath_smart or "").strip()
    xp_src = str(xpath_smart_src or "").strip()
    full = str(xpath_full or "").strip()

    if xp:
        attempts.append(FillAttempt(
            path="xpath",
            xpath=xp,
            locate_src=xp_src or "element",
            hint=lab or ph,
            js_kind="by_xpath",
        ))
    if lab:
        attempts.append(FillAttempt(
            path="label",
            locate_src="label",
            hint=lab,
            js_kind="form_field",
        ))
    if ph and ph != lab:
        attempts.append(FillAttempt(
            path="placeholder",
            locate_src="label",
            hint=ph,
            js_kind="form_field",
        ))
    if not lab and ph:
        attempts.append(FillAttempt(
            path="placeholder",
            locate_src="placeholder",
            hint=ph,
            xpath="",
            js_kind="by_xpath",
        ))
    if full and full != xp:
        attempts.append(FillAttempt(
            path="xpath_full",
            xpath=full,
            locate_src="full",
            hint=lab or ph,
            js_kind="by_xpath",
        ))
    return attempts
