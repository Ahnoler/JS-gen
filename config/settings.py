"""
Application configuration — reads from config/.env, falls back to env vars, then defaults.
Replaces config/config.js.
"""
import os
import sys
import tempfile
from pathlib import Path

CONFIG_DIR = Path(__file__).resolve().parent
PROJECT_DIR = CONFIG_DIR.parent

# ── Load .env (manual parser, no dependency) ──────────────────────────
_env = {}
_env_path = CONFIG_DIR / '.env'
if _env_path.exists():
    try:
        for line in _env_path.read_text(encoding='utf-8').split('\n'):
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if '=' not in line:
                continue
            key, _, val = line.partition('=')
            key, val = key.strip(), val.strip()
            if val.startswith('"') and val.endswith('"'):
                val = val[1:-1]
            if val.startswith("'") and val.endswith("'"):
                val = val[1:-1]
            if val:
                _env[key] = val
    except Exception:
        pass


def _resolve(key, default=''):
    return _env.get(key) or os.environ.get(key) or default


# ── Server ────────────────────────────────────────────────────────────
HOST = _resolve('HOST', '0.0.0.0')
PORT = int(_resolve('PORT', '4097'))

# ── Paths ─────────────────────────────────────────────────────────────
TMP_DIR = os.environ.get('TMPDIR') or os.environ.get('TMP') or os.environ.get('TEMP') or tempfile.gettempdir()
DASHBOARD_DIR = str(PROJECT_DIR)
SCRIPTS_DIR = str(PROJECT_DIR / 'scripts')
BROWSER_DIR = str(PROJECT_DIR / 'browser')
GENERATED_DIR = PROJECT_DIR / 'scripts' / 'generated'
TRAJECTORIES_DIR = PROJECT_DIR / 'scripts' / 'trajectories'
CASE_DATA_DIR = PROJECT_DIR / 'scripts' / 'case_data'
SKILL_DIR = str(PROJECT_DIR / 'src' / 'playwright-runner')

# ── LLM ───────────────────────────────────────────────────────────────
LLM_BASE_URL = _resolve('LLM_BASE_URL')
LLM_API_KEY = _resolve('LLM_API_KEY')
FORM_LLM_MODEL = _resolve('FORM_LLM_MODEL', 'deepseek-v4-flash')
FORM_LLM_BASE_URL = _resolve('FORM_LLM_BASE_URL', LLM_BASE_URL or 'https://api.deepseek.com')
FORM_LLM_API_KEY = _resolve('FORM_LLM_API_KEY', LLM_API_KEY)

# ── Python ────────────────────────────────────────────────────────────
def _find_python():
    explicit = _resolve('PYTHON_EXE')
    if explicit:
        return explicit
    embedded = str(PROJECT_DIR / 'python' / 'python.exe')
    if os.path.exists(embedded):
        return embedded
    return 'python'

PYTHON_EXE = _find_python()

# ── Playwright ────────────────────────────────────────────────────────
os.environ['PLAYWRIGHT_BROWSERS_PATH'] = BROWSER_DIR

# ── Runtime ───────────────────────────────────────────────────────────
STANDALONE_LLM = True
