"""Form action engines barrel — engines live in dedicated modules (split 2026-09-10).

Layout (split spec: docs/superpowers/specs/2026-09-10-form-action-engines-split-design.md):
  form_engine_base.py  — _FormActionEngineBase + replay adapters/三件套
  login_engine.py      — LoginEngine
  fill_engine.py       — FillEngine (+ STRICT_FILL_GUARDS)
  select_engine.py     — SelectEngine (+ select JS 常量)
  radio_engine.py      — RadioEngine (+ _unwrap_action_result)
  tree_engine.py       — TreeEngine

Public surface preserved for consumers (零改动兼容):
  _form.py / replay_form_action.py / form_save.py / autofill_round.py(lazy) /
  characterization (characterize-form-engine-wiring).
"""
from .form_engine_base import (
    _FormActionEngineBase,
    _ReplayAutofillStub,
    _ReplayPageAdapter,
    _replay_engine_store,
)
from .login_engine import LoginEngine
from .fill_engine import FillEngine
from .select_engine import SelectEngine
from .radio_engine import RadioEngine, _unwrap_action_result
from .tree_engine import TreeEngine
