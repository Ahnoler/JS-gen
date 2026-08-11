"""Action registry introspection — registration → schema (browser_use style).

Additive scaffold mirroring ``browser_use.controller.registry``:
  registration (``_register_*_actions`` in ``scripts.controller.actions.*``)
  → schema (param model fields) → dispatch (unchanged; not wired yet).

Nothing in any execution path calls this module yet — it only provides
``registered_actions()`` for tooling / future dispatch wiring.
"""

from __future__ import annotations

from typing import Any


def _param_schema_from_model(action: Any) -> dict[str, dict[str, Any]]:
    """Derive {name: {type, required, default}} from a browser_use param model."""
    out: dict[str, dict[str, Any]] = {}
    model = getattr(action, 'param_model', None)
    fields = getattr(model, 'model_fields', None)
    if not isinstance(fields, dict):
        return out
    for fname, finfo in fields.items():
        if fname in ('browser', 'page_extraction_llm', 'available_file_paths'):
            continue
        out[fname] = {
            'type': str(getattr(finfo, 'annotation', '') or ''),
            'required': bool(getattr(finfo, 'is_required', False)),
        }
    return out


def registered_actions(controller: Any = None, *, exclude_actions: list[str] | None = None) -> list[dict[str, Any]]:
    """Introspect a built Controller's action registry → [{name, params_schema}].

    ``controller`` may be any object exposing ``.registry.registry.actions``
    (a browser_use Controller). When omitted, a registry-only controller is
    built lazily via ``scripts.controller.service.build_controller`` — the
    build path performs no browser access, so this is safe for tooling.
    """
    if controller is None:
        from .service import build_controller
        controller = build_controller(None, exclude_actions=exclude_actions)
    registry = getattr(controller, 'registry', None)
    actions = getattr(registry, 'registry', None)
    entries = getattr(actions, 'actions', None)
    if not isinstance(entries, dict):
        return []
    out: list[dict[str, Any]] = []
    for name, action in entries.items():
        try:
            params_schema = _param_schema_from_model(action)
        except Exception:
            params_schema = {}
        out.append({'name': name, 'params_schema': params_schema})
    return sorted(out, key=lambda e: e['name'])
