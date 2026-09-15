"""Phase-scoped duplicate protection for AI form actions."""

from __future__ import annotations

import re


def _element_key(label_text: str) -> str:
    """Return a stable field identity for phase-local duplicate checks."""
    return re.sub(r"\s+", "", str(label_text or "")).strip().lower()


def _operation_key(identity: str) -> str:
    """Normalize an already namespaced operation identity."""
    return re.sub(r"\s+", " ", str(identity or "")).strip().lower()


def duplicate_element_action(
    business_data_store: dict | None,
    label_text: str,
) -> str:
    """Return the first successful action name when this field was already operated."""
    if business_data_store is None:
        return ""
    touched = business_data_store.get("_phase_ai_operated_elements")
    if not isinstance(touched, dict):
        return ""
    return str(touched.get(_element_key(label_text)) or "")


def duplicate_phase_operation(
    business_data_store: dict | None,
    identity: str,
) -> str:
    """Return the first successful action for an exact phase-local identity."""
    if business_data_store is None:
        return ""
    touched = business_data_store.get("_phase_ai_operations")
    if not isinstance(touched, dict):
        return ""
    return str(touched.get(_operation_key(identity)) or "")


def remember_successful_element_action(
    business_data_store: dict | None,
    label_text: str,
    action_name: str,
    result,
) -> None:
    """Remember successful AI writes; failed attempts remain retryable."""
    if business_data_store is None or getattr(result, "success", None) is False:
        return
    content = str(getattr(result, "extracted_content", "") or "").strip()
    if not content.startswith("ok") or content.startswith("ok-skip:"):
        return
    touched = business_data_store.setdefault("_phase_ai_operated_elements", {})
    if not isinstance(touched, dict):
        touched = {}
        business_data_store["_phase_ai_operated_elements"] = touched
    touched.setdefault(_element_key(label_text), action_name)


def remember_successful_phase_operation(
    business_data_store: dict | None,
    identity: str,
    action_name: str,
) -> None:
    """Remember an AI operation after its browser interaction succeeded."""
    if business_data_store is None:
        return
    touched = business_data_store.setdefault("_phase_ai_operations", {})
    if not isinstance(touched, dict):
        touched = {}
        business_data_store["_phase_ai_operations"] = touched
    touched.setdefault(_operation_key(identity), action_name)
