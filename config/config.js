/**
 * Application configuration — reads from config/.env, falls back to environment variables.
 *
 * Search order: .env file value → process.env → hardcoded default
 */
import path from 'path';
import os from 'os';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = __dirname;
const PROJECT_ROOT = path.resolve(CONFIG_DIR, '..');

// ── Load .env file (manual parser, no dependency) ──────────────────────
const _envPath = path.join(CONFIG_DIR, '.env');
const _env = {};
if (existsSync(_envPath)) {
  try {
    const _content = readFileSync(_envPath, 'utf-8');
    for (const line of _content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      if (val) _env[key] = val;
    }
  } catch {}
}

// Resolver: .env file → process.env → default
function _resolve(key, defaultValue = '') {
  return _env[key] || process.env[key] || defaultValue;
}

// ── Exports ───────────────────────────────────────────────────────────
export const PORT = parseInt(_resolve('PORT', '4097'), 10);
export const HOST = _resolve('HOST', '0.0.0.0');
export const PROJECT_DIR = _resolve('PROJECT_DIR') || PROJECT_ROOT;
export const SKILL_DIR = path.join(PROJECT_ROOT, '.opencode', 'skills', 'playwright-skill');
export const TMP_DIR = process.env.TMPDIR || process.env.TMP || process.env.TEMP || os.tmpdir();
export const DASHBOARD_DIR = PROJECT_ROOT;

// LLM
export const LLM_BASE_URL = _resolve('LLM_BASE_URL');
export const LLM_API_KEY = _resolve('LLM_API_KEY');
export const FORM_LLM_MODEL = _resolve('FORM_LLM_MODEL', 'deepseek-v4-flash');
export const FORM_LLM_BASE_URL = _resolve('FORM_LLM_BASE_URL', LLM_BASE_URL || 'https://api.deepseek.com');
export const FORM_LLM_API_KEY = _resolve('FORM_LLM_API_KEY', LLM_API_KEY);

// Python — fall back to "python" on system PATH instead of hardcoded conda path
export const PYTHON_EXE = _resolve('PYTHON_EXE') || 'python';

// Legacy compatibility (used by explore-utils.js)
export const PYTHON_EXE_CONFIG = PYTHON_EXE;
export const STANDALONE_LLM = true;
