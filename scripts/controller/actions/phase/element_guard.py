"""Phase-scoped duplicate protection for AI form actions."""

from __future__ import annotations

import re


def _element_key(label_text: str) -> str:
    """Return a stable field identity for phase-local duplicate checks."""
    return re.sub(r"\s+", "", str(label_text or "")).strip().lower()


def element_scope_key(
    label_text: str,
    business_data_store: dict | None,
    container: str | None = None,
) -> str:
    """Return a container-scoped field identity (``label@container``).

    #909 定谳缺陷修复：纯 label identity 使同阶段两个弹窗的同名字段互相短路
    （分类弹窗填「序号」成功 → 产品弹窗 fill(序号) 被 already-operated 短路）。
    作用域取当前活动容器（``_active_container``，JS_IDENTIFY_CONTAINER id，
    由 task_completion._switch_task_list_container 维护；调用方可显式传
    container 覆盖）；缺省 ``main`` 与旧数据（无容器上下文）兼容。
    """
    label = _element_key(label_text)
    if container is None:
        container = str((business_data_store or {}).get("_active_container") or "")
    return f"{label}@{str(container or '').strip() or 'main'}"


def duplicate_element_action_scoped(
    business_data_store: dict | None,
    label_text: str,
    container: str | None = None,
) -> str:
    """Container-scoped variant of :func:`duplicate_element_action`.

    迁移兼容：旧调用/旧 run 写入的是纯 label 键（无 ``@container`` 后缀）。
    仅当解析出的作用域为缺省 ``main``（无容器上下文）时回退查纯 label 键；
    有真实容器上下文（dialog:/drawer:/main#N）时不回退——那正是本修复要隔离的
    键空间，回退会重新引入 #909 跨弹窗误吞。
    """
    if business_data_store is None:
        return ""
    touched = business_data_store.get("_phase_ai_operated_elements")
    if not isinstance(touched, dict):
        return ""
    scoped = element_scope_key(label_text, business_data_store, container)
    hit = str(touched.get(scoped) or "")
    if hit:
        return hit
    if scoped.endswith("@main"):
        return str(touched.get(_element_key(label_text)) or "")
    return ""


def remember_successful_element_action_scoped(
    business_data_store: dict | None,
    label_text: str,
    action_name: str,
    result,
    container: str | None = None,
) -> None:
    """Container-scoped variant of :func:`remember_successful_element_action`."""
    if business_data_store is None or getattr(result, "success", None) is False:
        return
    content = str(getattr(result, "extracted_content", "") or "").strip()
    if not content.startswith("ok") or content.startswith("ok-skip:"):
        return
    touched = business_data_store.setdefault("_phase_ai_operated_elements", {})
    if not isinstance(touched, dict):
        touched = {}
        business_data_store["_phase_ai_operated_elements"] = touched
    touched.setdefault(
        element_scope_key(label_text, business_data_store, container),
        action_name,
    )


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


def duplicate_phase_operation_any(
    business_data_store: dict | None,
    identities: list[str],
) -> str:
    """Return the first duplicate result across equivalent element identities."""
    for identity in identities:
        duplicate = duplicate_phase_operation(business_data_store, identity)
        if duplicate:
            return duplicate
    return ""


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


def remember_phase_operation_aliases(
    business_data_store: dict | None,
    identities: list[str],
    action_name: str,
) -> None:
    """Remember multiple identities for one successful browser operation."""
    for identity in identities:
        remember_successful_phase_operation(business_data_store, identity, action_name)
