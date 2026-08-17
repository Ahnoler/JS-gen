/**
 * Application configuration — reads from config/.env, falls back to environment variables.
 *
 * Search order: process.env → .env file value → hardcoded default
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

// Resolver: process.env → .env file → default (env vars override file for deployment/tests)
export function resolve(key, defaultValue = '') {
  return process.env[key] || _env[key] || defaultValue;
}

// Legacy alias used inside this module
const _resolve = resolve;

// ── Exports ───────────────────────────────────────────────────────────
export const PORT = parseInt(_resolve('PORT', '4097'), 10);
export const HOST = _resolve('HOST', '0.0.0.0');
export const PROJECT_DIR = _resolve('PROJECT_DIR') || PROJECT_ROOT;
export const SKILL_DIR = path.join(PROJECT_ROOT, 'src', 'playwright-runner');
export const TMP_DIR = process.env.TMPDIR || process.env.TMP || process.env.TEMP || os.tmpdir();
export const DASHBOARD_DIR = PROJECT_ROOT;
export const GENERATED_DIR = path.join(PROJECT_ROOT, 'scripts', 'generated');
export const TRAJECTORIES_DIR = path.join(PROJECT_ROOT, 'scripts', 'trajectories');
export const CASE_DATA_DIR = path.join(PROJECT_ROOT, 'scripts', 'case_data');
export const BROWSER_DIR = path.join(PROJECT_ROOT, 'browser');

// Redirect Playwright browsers to project-local directory (portable)
process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSER_DIR;

// LLM
export const LLM_BASE_URL = _resolve('LLM_BASE_URL');
export const LLM_API_KEY = _resolve('LLM_API_KEY');
export const FORM_LLM_MODEL = _resolve('FORM_LLM_MODEL', 'deepseek-v4-flash');
export const FORM_LLM_BASE_URL = _resolve('FORM_LLM_BASE_URL', LLM_BASE_URL || 'https://api.deepseek.com');
export const FORM_LLM_API_KEY = _resolve('FORM_LLM_API_KEY', LLM_API_KEY);

// Python — detection chain: explicit env → embedded in install dir → system PATH
function _findPython() {
  const explicit = _resolve('PYTHON_EXE');
  if (explicit) return explicit;
  // Check embedded Python (portable install alongside project)
  const embedded = path.join(PROJECT_ROOT, 'python', 'python.exe');
  if (existsSync(embedded)) return embedded;
  // Fall back to system PATH
  return 'python';
}
export const PYTHON_EXE = _findPython();

// Legacy compatibility export
export const PYTHON_EXE_CONFIG = PYTHON_EXE;

// Executor agent (WS /ws/executor) — unset token rejects all executor connections
export const EXECUTOR_TOKEN = _resolve('EXECUTOR_TOKEN', '');
export const EXECUTOR_HEARTBEAT_TIMEOUT_MS = parseInt(
  _resolve('EXECUTOR_HEARTBEAT_TIMEOUT_MS', '45000'),
  10,
);
export const EXECUTOR_DISCONNECT_GRACE_MS = parseInt(
  _resolve('EXECUTOR_DISCONNECT_GRACE_MS', String(EXECUTOR_HEARTBEAT_TIMEOUT_MS)),
  10,
);
export const REMOTE_SESSION_GRACE_MS = parseInt(
  _resolve('REMOTE_SESSION_GRACE_MS', '900000'),
  10,
);

// ── SSO / 账号中心（产品登录 + 用户隔离）──
export const SSO_APP_KEY = _resolve('SSO_APP_KEY', '1920710182837141505');
export const SSO_BASE_URL = _resolve('SSO_BASE_URL', 'http://test.paas.tansun.com.cn');
/** 仅 /api/v2/* 强制鉴权；关闭时 req.paasUserId=null（全可见，向后兼容） */
export const SSO_AUTH_REQUIRED = _resolve('SSO_AUTH_REQUIRED', 'false').toLowerCase() === 'true';

/** Route browser sessions to online executor agent instead of local globalBrowser */
export const USE_EXECUTOR = _resolve('USE_EXECUTOR', 'false').toLowerCase() === 'true';

/** Max non-empty Excel rows accepted by batch import (whole file rejected when exceeded). */
export const BATCH_IMPORT_MAX_ROWS = parseInt(_resolve('BATCH_IMPORT_MAX_ROWS', '500'), 10);

/** Global analysis concurrency for batch jobs (default serial to protect LLM). */
export const BATCH_ANALYZE_CONCURRENCY = Math.max(
  1,
  parseInt(_resolve('BATCH_ANALYZE_CONCURRENCY', '1'), 10) || 1,
);

/** How often the batch scheduler wakes waiting_executor items (ms). */
export const BATCH_SCHEDULER_INTERVAL_MS = Math.max(
  1000,
  parseInt(_resolve('BATCH_SCHEDULER_INTERVAL_MS', '5000'), 10) || 5000,
);

/** Transient LLM / analyze retries before marking an item failed. */
export const BATCH_ANALYZE_MAX_ATTEMPTS = Math.max(
  1,
  parseInt(_resolve('BATCH_ANALYZE_MAX_ATTEMPTS', '3'), 10) || 3,
);

/** Worker claim lease duration for batch items (ms). */
export const BATCH_ITEM_LEASE_MS = Math.max(
  30000,
  parseInt(_resolve('BATCH_ITEM_LEASE_MS', '600000'), 10) || 600000,
);

// 鈹€鈹€ AI 璁板繂绯荤粺锛圥0 鏃佽矾鎽勫彇锛氫簨浠跺啓榛樿寮€銆佷簨瀹炲寘璇婚粯璁ゅ叧锛夆攢鈹€

// ── AI 记忆系统（P0 旁路摄取：事件写默认开、事实包读默认关）──
export const AI_MEMORY_EVENTS = _resolve('AI_MEMORY_EVENTS', 'true').toLowerCase() !== 'false';
export const AI_MEMORY_FACT_PACK = _resolve('AI_MEMORY_FACT_PACK', 'false').toLowerCase() === 'true';
export const AI_MEMORY_HISTORY = _resolve('AI_MEMORY_HISTORY', 'false').toLowerCase() === 'true';
export const AI_MEMORY_DECISIONS = _resolve('AI_MEMORY_DECISIONS', 'true').toLowerCase() !== 'false';
export const AI_MEMORY_AUDIT_STRICT = _resolve('AI_MEMORY_AUDIT_STRICT', 'false').toLowerCase() === 'true';

// L1c: low-confidence region classify via LLM (default off → rules + L1d read only)
export const L1C_LLM = _resolve('L1C_LLM', 'false').toLowerCase() === 'true';
export const L1C_LLM_TIMEOUT_MS = Number(_resolve('L1C_LLM_TIMEOUT_MS', '8000')) || 8000;

export const AGENT_STDERR_LOG_DIR = _resolve('AGENT_STDERR_LOG_DIR')
  || path.join(PROJECT_DIR, 'logs', 'agent-stderr');
