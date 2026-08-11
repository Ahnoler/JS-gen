/**
 * Executor Agent configuration — reads process.env (and optional executor/.env).
 */
import path from 'path';
import os from 'os';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXECUTOR_DIR = __dirname;
const PROJECT_ROOT = path.resolve(EXECUTOR_DIR, '..');
export const BROWSER_DIR = path.join(PROJECT_ROOT, 'browser');

function loadDotEnv(filePath) {
  const out = {};
  if (!existsSync(filePath)) return out;
  try {
    for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (val) out[key] = val;
    }
  } catch {}
  return out;
}

const _dotEnv = {
  ...loadDotEnv(path.join(PROJECT_ROOT, 'config', '.env')),
  ...loadDotEnv(path.join(EXECUTOR_DIR, '.env')),
};

/** Cursor sandbox injects a temp PLAYWRIGHT_BROWSERS_PATH without Chromium binaries. */
function isSandboxPlaywrightPath(value) {
  if (!value || typeof value !== 'string') return false;
  const norm = value.replace(/\\/g, '/').toLowerCase();
  return norm.includes('cursor-sandbox-cache') || norm.includes('/temp/cursor-');
}

/**
 * Explicit override only. When unset, leave Playwright's default cache
 * (e.g. %LOCALAPPDATA%\\ms-playwright) so each executor host can just run
 * `npx playwright install chromium` / `playwright install chromium` with no path config.
 * Optional: set PLAYWRIGHT_BROWSERS_PATH to pin a custom dir (incl. project `browser/`).
 */
function resolvePlaywrightBrowsersPath() {
  const fromFile = _dotEnv.PLAYWRIGHT_BROWSERS_PATH || '';
  if (fromFile && !isSandboxPlaywrightPath(fromFile)) return fromFile;

  const fromEnv = process.env.PLAYWRIGHT_BROWSERS_PATH || '';
  if (fromEnv && !isSandboxPlaywrightPath(fromEnv)) return fromEnv;

  return '';
}

export const PLAYWRIGHT_BROWSERS_PATH = resolvePlaywrightBrowsersPath();
// Pin only when configured; otherwise clear sandbox / stale overrides so Playwright uses its default cache.
if (PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = PLAYWRIGHT_BROWSERS_PATH;
} else {
  delete process.env.PLAYWRIGHT_BROWSERS_PATH;
}

function resolve(key, defaultValue = '') {
  return process.env[key] || _dotEnv[key] || defaultValue;
}

/** Build ws://host:port/ws/executor from CONTROL_PLANE_URL or use EXECUTOR_WS_URL. */
function resolveWsUrl() {
  const direct = resolve('EXECUTOR_WS_URL');
  if (direct) return direct;

  const base = resolve('CONTROL_PLANE_URL', 'http://127.0.0.1:4097').replace(/\/$/, '');
  const wsBase = base.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');
  return `${wsBase}/ws/executor`;
}

const NODE_ID_FILE = path.join(EXECUTOR_DIR, '.node-uuid');

function resolveNodeUuidSync() {
  const fromEnv = resolve('EXECUTOR_NODE_UUID');
  if (fromEnv) return fromEnv;

  if (existsSync(NODE_ID_FILE)) {
    const id = readFileSync(NODE_ID_FILE, 'utf-8').trim();
    if (id) return id;
  }

  mkdirSync(EXECUTOR_DIR, { recursive: true });
  const id = randomUUID();
  writeFileSync(NODE_ID_FILE, id, 'utf-8');
  return id;
}

export const EXECUTOR_WS_URL = resolveWsUrl();
export const EXECUTOR_TOKEN = resolve('EXECUTOR_TOKEN', '');
export const EXECUTOR_NODE_UUID = resolveNodeUuidSync();
export const EXECUTOR_NAME = resolve('EXECUTOR_NAME', os.hostname());
export const EXECUTOR_HOST = resolve('EXECUTOR_HOST', os.hostname());
export const EXECUTOR_CAPACITY = parseInt(resolve('EXECUTOR_CAPACITY', '16'), 10);
/** Base Chrome remote-debugging port; slot i uses base + i (avoids multi-session CDP collision). */
export const EXECUTOR_CDP_PORT_BASE = parseInt(resolve('EXECUTOR_CDP_PORT_BASE', '19242'), 10);
export const EXECUTOR_AGENT_VERSION = resolve('EXECUTOR_AGENT_VERSION', '0.1.0');
export const EXECUTOR_HEARTBEAT_INTERVAL_MS = parseInt(
  resolve('EXECUTOR_HEARTBEAT_INTERVAL_MS', '20000'),
  10,
);
/** heartbeat ack 超过该时长未收到 → 判定半开连接，主动 terminate 强制重连（默认 2×心跳间隔）。 */
export const EXECUTOR_HEARTBEAT_ACK_TIMEOUT_MS = parseInt(
  resolve('EXECUTOR_HEARTBEAT_ACK_TIMEOUT_MS', '40000'),
  10,
);
export const EXECUTOR_RECONNECT_MIN_MS = parseInt(resolve('EXECUTOR_RECONNECT_MIN_MS', '1000'), 10);
export const EXECUTOR_RECONNECT_MAX_MS = parseInt(resolve('EXECUTOR_RECONNECT_MAX_MS', '30000'), 10);
/** WS 断线超过该时长仍未恢复 → 杀全部 Python 会话（防录制事件静默丢失）。 */
export const EXECUTOR_DISCONNECT_TIMEOUT_MS = parseInt(
  resolve('EXECUTOR_DISCONNECT_TIMEOUT_MS', '30000'),
  10,
);

export function buildLabels() {
  let labels = {};
  const raw = resolve('EXECUTOR_LABELS_JSON');
  if (raw) {
    try {
      labels = JSON.parse(raw);
    } catch {}
  }
  const headlessRaw = String(resolve('CHROME_HEADLESS', '')).trim().toLowerCase();
  const headless = ['1', 'true', 'yes', 'on'].includes(headlessRaw);
  return {
    os: process.platform,
    headed: !headless,
    ...labels,
  };
}

export function validateConfig() {
  const errors = [];
  if (!EXECUTOR_TOKEN) errors.push('EXECUTOR_TOKEN is required');
  if (!EXECUTOR_WS_URL.startsWith('ws://') && !EXECUTOR_WS_URL.startsWith('wss://')) {
    errors.push('EXECUTOR_WS_URL / CONTROL_PLANE_URL must resolve to a ws:// or wss:// URL');
  }
  return errors;
}

export function wsUrlWithToken() {
  const url = new URL(EXECUTOR_WS_URL);
  url.searchParams.set('token', EXECUTOR_TOKEN);
  return url.toString();
}

export { PROJECT_ROOT };
export const PYTHON_EXE = resolve('PYTHON_EXE') || (() => {
  const embedded = path.join(PROJECT_ROOT, 'python', 'python.exe');
  if (existsSync(embedded)) return embedded;
  return 'python';
})();
export const LLM_BASE_URL = resolve('LLM_BASE_URL', 'https://api.deepseek.com');
export const LLM_API_KEY = resolve('LLM_API_KEY', '');
export const CONTROL_PLANE_HTTP = resolve('CONTROL_PLANE_URL', 'http://127.0.0.1:4097').replace(/\/$/, '');

/** Env for Python browser-use subprocess — never inherit sandbox Playwright cache. */
export function buildPythonSubprocessEnv(extraEnv = {}) {
  const env = { ...process.env };
  if (isSandboxPlaywrightPath(env.PLAYWRIGHT_BROWSERS_PATH) || !PLAYWRIGHT_BROWSERS_PATH) {
    delete env.PLAYWRIGHT_BROWSERS_PATH;
  } else {
    env.PLAYWRIGHT_BROWSERS_PATH = PLAYWRIGHT_BROWSERS_PATH;
  }
  env.PYTHONIOENCODING = 'utf-8';
  env.PYTHONUNBUFFERED = '1';
  env.PYTHONPATH = PROJECT_ROOT;
  // Propagate from executor/.env / config/.env when not already in process.env
  const headless = resolve('CHROME_HEADLESS', '');
  if (headless && !env.CHROME_HEADLESS) {
    env.CHROME_HEADLESS = headless;
  }
  return { ...env, ...extraEnv };
}
