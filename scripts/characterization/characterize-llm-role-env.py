#!/usr/bin/env python3
"""Characterization: role-level LLM env unification (keys, config exports, spawn injection, timeouts).

String-level assertions that .env.example, config.js, global-browser.js, reviewer.py,
_llm_values.py, _scenario_describer.py, and agent_utils.py all carry the expected
role-level LLM configuration markers. No live LLM calls.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

failures: list[str] = []


def check(label: str, cond: bool) -> None:
    if not cond:
        failures.append(label)


# ── .env.example: 8 new keys + 4 documented existing keys ──────────────────
env_example = (ROOT / 'config' / '.env.example').read_text(encoding='utf-8')

new_keys = [
    'REVIEWER_LLM_MODEL',
    'REVIEWER_LLM_BASE_URL',
    'REVIEWER_LLM_API_KEY',
    'REVIEWER_LLM_TIMEOUT_MS',
    'SCENARIO_LLM_MODEL',
    'SCENARIO_LLM_BASE_URL',
    'SCENARIO_LLM_API_KEY',
    'SCENARIO_LLM_TIMEOUT_MS',
    'FORM_LLM_TIMEOUT_MS',
    'L1C_LLM_MODEL',
]
for k in new_keys:
    check(f'.env.example has {k}', k in env_example)

doc_keys = [
    'AI_PHASE_REVIEWER',
    'AI_PHASE_REVIEWER_TIMEOUT_S',
    'AI_SCENARIO_DESCRIBER',
    'SCENARIO_DESCRIBER_INTERVAL',
]
for k in doc_keys:
    check(f'.env.example documents {k}', k in env_example)

# ── config/config.js: corresponding exports ────────────────────────────────
config_js = (ROOT / 'config' / 'config.js').read_text(encoding='utf-8')

config_exports = [
    'REVIEWER_LLM_MODEL',
    'REVIEWER_LLM_BASE_URL',
    'REVIEWER_LLM_API_KEY',
    'REVIEWER_LLM_TIMEOUT_MS',
    'SCENARIO_LLM_MODEL',
    'SCENARIO_LLM_BASE_URL',
    'SCENARIO_LLM_API_KEY',
    'SCENARIO_LLM_TIMEOUT_MS',
    'FORM_LLM_TIMEOUT_MS',
    'L1C_LLM_MODEL',
]
for k in config_exports:
    check(f'config.js exports {k}', f'export const {k}' in config_js)

# ── global-browser.js: SCENARIO_LLM_MODEL injection ────────────────────────
gb_js = (ROOT / 'src' / 'routes' / 'browser-session' / 'global-browser.js').read_text(encoding='utf-8')
check('global-browser.js injects SCENARIO_LLM_MODEL', 'SCENARIO_LLM_MODEL' in gb_js)
check('global-browser.js injects REVIEWER_LLM_MODEL', 'REVIEWER_LLM_MODEL' in gb_js)
check('global-browser.js injects FORM_LLM_TIMEOUT_MS', 'FORM_LLM_TIMEOUT_MS' in gb_js)
check('global-browser.js injects L1C_LLM_MODEL', 'L1C_LLM_MODEL' in gb_js)

# ── reviewer.py: _get_reviewer_llm + REVIEWER_LLM_TIMEOUT_MS ───────────────
reviewer_py = (ROOT / 'scripts' / 'controller' / 'actions' / 'phase' / 'reviewer.py').read_text(encoding='utf-8')
check('reviewer.py has _get_reviewer_llm', 'def _get_reviewer_llm' in reviewer_py)
check('reviewer.py reads REVIEWER_LLM_TIMEOUT_MS', 'REVIEWER_LLM_TIMEOUT_MS' in reviewer_py)

# ── _llm_values.py: timeout= in _get_form_llm ──────────────────────────────
llm_values_py = (ROOT / 'scripts' / 'controller' / 'actions' / '_llm_values.py').read_text(encoding='utf-8')
check('_llm_values.py has FORM_LLM_TIMEOUT_MS', 'FORM_LLM_TIMEOUT_MS' in llm_values_py)
check('_llm_values.py passes timeout', "['timeout']" in llm_values_py or 'timeout=' in llm_values_py)

# ── _scenario_describer.py: timeout= in _get_scenario_llm ──────────────────
scenario_py = (ROOT / 'scripts' / 'controller' / 'actions' / '_scenario_describer.py').read_text(encoding='utf-8')
check('_scenario_describer.py has SCENARIO_LLM_TIMEOUT_MS', 'SCENARIO_LLM_TIMEOUT_MS' in scenario_py)
check('_scenario_describer.py passes timeout', "['timeout']" in scenario_py or 'timeout=' in scenario_py)

# ── agent_utils.py: create_llm with timeout=None ───────────────────────────
agent_utils_py = (ROOT / 'scripts' / 'agent_utils.py').read_text(encoding='utf-8')
check('agent_utils create_llm has timeout=None', 'def create_llm(model, base_url, api_key=None, timeout=None)' in agent_utils_py)

# ── session_runner.py: _env_llm_timeout_sec ────────────────────────────────
session_runner_py = (ROOT / 'scripts' / 'session_runner.py').read_text(encoding='utf-8')
check('session_runner has _env_llm_timeout_sec', '_env_llm_timeout_sec' in session_runner_py)

# ── Budget functions unchanged (regression guard) ──────────────────────────
check('reviewer.py still has compute_budget_extension', 'def compute_budget_extension' in reviewer_py)
check('reviewer.py still has _BUDGET_EXTEND_MAX_ROUNDS', '_BUDGET_EXTEND_MAX_ROUNDS' in reviewer_py)

# ── Functional: _get_reviewer_llm returns agent_llm when no env set ────────
from scripts.controller.actions.phase.reviewer import _get_reviewer_llm  # noqa: E402

# With no REVIEWER_LLM_MODEL env → returns the passed-in llm unchanged
_sentinel = object()
result = _get_reviewer_llm(_sentinel)
check('_get_reviewer_llm returns agent_llm when no REVIEWER_LLM_MODEL', result is _sentinel)

# ── Functional: _env_llm_timeout_sec ───────────────────────────────────────
from scripts.session_runner import _env_llm_timeout_sec  # noqa: E402

# Clear env to test None behavior
import os  # noqa: E402
_old = os.environ.pop('LLM_TIMEOUT_MS', None)
try:
    check('_env_llm_timeout_sec returns None when env unset', _env_llm_timeout_sec() is None)
    os.environ['LLM_TIMEOUT_MS'] = '120000'
    check('_env_llm_timeout_sec returns 120.0 for 120000ms', _env_llm_timeout_sec() == 120.0)
    os.environ['LLM_TIMEOUT_MS'] = '0'
    check('_env_llm_timeout_sec returns None for 0', _env_llm_timeout_sec() is None)
finally:
    if _old is not None:
        os.environ['LLM_TIMEOUT_MS'] = _old
    else:
        os.environ.pop('LLM_TIMEOUT_MS', None)

if failures:
    print('FAIL:', failures)
    sys.exit(1)
print('OK: role-level LLM env unification (keys, exports, injection, timeouts)')
