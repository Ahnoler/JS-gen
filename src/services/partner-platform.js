/**
 * Partner automation platform HTTP client.
 * Default prefix: http://test.atp.tansun.com.cn/api/
 * Outbound auth: 转发调用方的 access_token（SSO JWT，与账号中心同源）；
 * 调用方未带 token 时回落 PARTNER_ACCESS_TOKEN（服务级 token，供脚本/联调）。
 * Override: PARTNER_API_BASE / PARTNER_SYSTEM_BASE_URL / PARTNER_IMPORT_DEMAND_URL / PARTNER_ACCESS_TOKEN
 */
import { resolve as configResolve } from '../../config/config.js';

const DEFAULT_API_BASE = 'http://test.atp.tansun.com.cn/api';
const DEFAULT_TIMEOUT_MS = 30_000;

/** User-facing copy when partner nginx/upstream is unreachable or returns non-JSON. */
export const PARTNER_NETWORK_ERROR_MSG = '网络异常，自动化平台无法连接';

export const DEFAULT_PARTNER_SYSTEM_ID = '98';
export const DEFAULT_PARTNER_PROJECT_ID = '31';

function envOrConfig(key, fallback = '') {
  return String(configResolve(key, fallback) || '').trim();
}

function partnerApiBase() {
  const raw = envOrConfig('PARTNER_API_BASE')
    || envOrConfig('PARTNER_SYSTEM_BASE_URL')
    || DEFAULT_API_BASE;
  return String(raw).replace(/\/$/, '');
}

function systemBaseUrl() {
  return partnerApiBase();
}

function importDemandUrl() {
  const override = envOrConfig('PARTNER_IMPORT_DEMAND_URL');
  if (override) return override;
  return `${partnerApiBase()}/demand/demandtranscation/importDemand`;
}

/**
 * Token for partner outbound calls (projects / systems / importDemand).
 * 优先转发调用方 access_token（header/body/query，Vue 登录态 SSO JWT——
 * 伙伴平台与账号中心同源，直接复用登录 token，按登录用户身份调用）；
 * 调用方未带 token 时回落 PARTNER_ACCESS_TOKEN（服务级 token，供无登录态的脚本/联调）。
 *
 * @param {import('express').Request | { headers?: object, body?: object, query?: object }} req
 */
export function resolveAccessToken(req = {}) {
  const headers = req.headers || {};
  const body = req.body || {};
  const query = req.query || {};
  const fromHeader = headers.access_token || headers['access-token'] || headers.Access_Token;
  const fromBody = body.access_token ?? body.accessToken;
  const fromQuery = query.access_token ?? query.accessToken;
  const raw = fromHeader ?? fromBody ?? fromQuery;
  const fromRequest = raw == null ? '' : String(raw).trim();
  if (fromRequest) return fromRequest;
  return envOrConfig('PARTNER_ACCESS_TOKEN') || null;
}

export function requireAccessToken(req) {
  const token = resolveAccessToken(req);
  if (!token) {
    const err = new Error('access_token is required (header, body, or PARTNER_ACCESS_TOKEN)');
    err.statusCode = 400;
    throw err;
  }
  return token;
}

/**
 * @param {object} src
 * @returns {{ systemId: string, projectId: string }}
 */
export function resolveSystemProject(src = {}) {
  const systemIdRaw = src.systemId ?? src.system_id;
  const projectIdRaw = src.projectId ?? src.project_id;
  const systemId = systemIdRaw == null || systemIdRaw === ''
    ? DEFAULT_PARTNER_SYSTEM_ID
    : String(systemIdRaw);
  const projectId = projectIdRaw == null || projectIdRaw === ''
    ? DEFAULT_PARTNER_PROJECT_ID
    : String(projectIdRaw);
  return { systemId, projectId };
}

async function partnerFetch(url, { method = 'GET', accessToken, body, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!accessToken) {
    const err = new Error('access_token is required');
    err.statusCode = 400;
    throw err;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const init = {
      method,
      headers: {
        access_token: accessToken,
        Accept: 'application/json',
      },
      signal: ctrl.signal,
    };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const res = await fetch(url, init);
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { httpStatus: res.status, ok: res.ok, json, text };
  } catch (e) {
    if (e?.name === 'AbortError') {
      console.warn(`[partner] timeout ${timeoutMs}ms url=${url}`);
      const err = new Error(PARTNER_NETWORK_ERROR_MSG);
      err.statusCode = 504;
      err.partnerDetail = `timed out after ${timeoutMs}ms`;
      throw err;
    }
    console.warn(`[partner] fetch failed url=${url}:`, e?.message || e);
    const err = new Error(PARTNER_NETWORK_ERROR_MSG);
    err.statusCode = 502;
    err.partnerDetail = e?.message || 'Partner request failed';
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function assertPartnerBusinessOk(json, fallbackMsg = PARTNER_NETWORK_ERROR_MSG) {
  if (json == null || typeof json !== 'object') {
    const err = new Error(fallbackMsg);
    err.statusCode = 502;
    err.partner = json;
    throw err;
  }
  const code = json.code;
  // Partner uses 200 for success; some APIs use 0.
  if (code !== 200 && code !== 0 && code != null) {
    const err = new Error(String(json.msg || json.message || fallbackMsg));
    err.statusCode = 502;
    err.partner = { code, msg: json.msg || json.message, data: json.data };
    throw err;
  }
  return json;
}

function normalizeProjectRow(row) {
  if (!row || typeof row !== 'object') return null;
  const id = row.id ?? row.projectId ?? row.project_id;
  if (id == null || id === '') return null;
  const name = String(row.name ?? row.projectName ?? row.project_name ?? `project-${id}`);
  return { id: Number(id) || id, name };
}

/**
 * List partner projects.
 * @returns {Promise<{ id: number|string, name: string }[]>}
 */
export async function listPartnerProjects({ accessToken } = {}) {
  const url = `${systemBaseUrl()}/system/systemproject/list`;
  const { json, text, httpStatus } = await partnerFetch(url, {
    method: 'POST',
    accessToken,
    body: {},
  });
  if (!json) {
    console.warn(
      `[partner] projects non-JSON HTTP ${httpStatus}:`,
      String(text).slice(0, 200),
    );
    const err = new Error(PARTNER_NETWORK_ERROR_MSG);
    err.statusCode = 502;
    err.partnerDetail = { httpStatus, preview: String(text).slice(0, 200) };
    throw err;
  }
  assertPartnerBusinessOk(json, PARTNER_NETWORK_ERROR_MSG);
  const rows = json.rows ?? json.data?.rows ?? json.data ?? json.list ?? [];
  const list = Array.isArray(rows) ? rows : [];
  return list.map(normalizeProjectRow).filter(Boolean);
}

function normalizeSystemNode(node) {
  if (!node || typeof node !== 'object') return null;
  const id = node.id ?? node.systemId ?? node.system_id;
  if (id == null || id === '') return null;
  const name = String(node.name ?? node.systemName ?? node.label ?? `system-${id}`);
  const childrenRaw = node.children ?? node.childList ?? node.nodes;
  const children = Array.isArray(childrenRaw)
    ? childrenRaw.map(normalizeSystemNode).filter(Boolean)
    : undefined;
  const out = { id: Number(id) || id, name };
  if (children?.length) out.children = children;
  if (node.parentId != null) out.parentId = node.parentId;
  return out;
}

/**
 * List partner systems under a project (lazy tree roots or children).
 * @returns {Promise<object[]>}
 */
export async function listPartnerSystems({ accessToken, projectId, parentId } = {}) {
  if (projectId == null || projectId === '') {
    const err = new Error('projectId is required');
    err.statusCode = 400;
    throw err;
  }
  const qs = new URLSearchParams({
    projectId: String(projectId),
    menuType: '1',
    from: '0',
    searchName: '',
  });
  if (parentId != null && parentId !== '') qs.set('parentId', String(parentId));
  const url = `${systemBaseUrl()}/system/system/lazySystemTree?${qs.toString()}`;
  const { json, text, httpStatus } = await partnerFetch(url, {
    method: 'GET',
    accessToken,
  });
  if (!json) {
    console.warn(
      `[partner] systems non-JSON HTTP ${httpStatus}:`,
      String(text).slice(0, 200),
    );
    const err = new Error(PARTNER_NETWORK_ERROR_MSG);
    err.statusCode = 502;
    err.partnerDetail = { httpStatus, preview: String(text).slice(0, 200) };
    throw err;
  }
  assertPartnerBusinessOk(json, PARTNER_NETWORK_ERROR_MSG);
  const raw = json.data ?? json.rows ?? json.list ?? json;
  const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.children) ? raw.children : []);
  return list.map(normalizeSystemNode).filter(Boolean);
}

/**
 * POST partner importDemand body.
 * @returns {Promise<{ code: number, msg?: string, data?: unknown }>}
 */
export async function pushImportDemand(payload, { accessToken } = {}) {
  const url = importDemandUrl();
  const { json, text, httpStatus } = await partnerFetch(url, {
    method: 'POST',
    accessToken,
    body: payload,
  });
  if (!json) {
    console.warn(
      `[partner] importDemand non-JSON HTTP ${httpStatus}:`,
      String(text).slice(0, 200),
    );
    const err = new Error(PARTNER_NETWORK_ERROR_MSG);
    err.statusCode = 502;
    err.partnerDetail = { httpStatus, preview: String(text).slice(0, 200) };
    throw err;
  }
  assertPartnerBusinessOk(json, PARTNER_NETWORK_ERROR_MSG);
  return {
    code: json.code ?? 200,
    msg: json.msg || json.message || 'ok',
    data: json.data,
  };
}
