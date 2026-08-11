/**
 * Partner automation platform HTTP client.
 * Default prefix: http://test.atp.tansun.com.cn/api/
 * Outbound auth: PARTNER_ACCESS_TOKEN（三个接口共用），缺省用联调 JWT。
 * Override: PARTNER_API_BASE / PARTNER_SYSTEM_BASE_URL / PARTNER_IMPORT_DEMAND_URL
 */
import { resolve as configResolve } from '../../config/config.js';

const DEFAULT_API_BASE = 'http://test.atp.tansun.com.cn/api';
/** 联调默认 token（项目 / 系统树 / importDemand 共用）；可用 PARTNER_ACCESS_TOKEN 覆盖 */
// TODO: 去掉硬编码，改为动态伙伴 token（见 resolveAccessToken）
const DEFAULT_PARTNER_ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjE1MTAwNzY4MTA1Nzg2NDQ5OTIsImlhdCI6MTc4MTc0NjMyNCwianRpIjoidG9rZW5JZCJ9.RC81sU9-7mQ7HHxz47dBqIXg0ZWfPGL_uPN0vt-p4qI';
const DEFAULT_TIMEOUT_MS = 30_000;

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
 * Prefer dedicated PARTNER_ACCESS_TOKEN；其次请求头/body；最后联调默认 JWT。
 *
 * TODO: 当前为联调硬编码 / PARTNER_ACCESS_TOKEN，故意不转发前端 SSO 的 access_token。
 *       后续改为动态取伙伴平台 token（登录换票 / 前端显式传入 partner token 等）。
 *
 * @param {import('express').Request | { headers?: object, body?: object, query?: object }} req
 */
export function resolveAccessToken(req = {}) {
  const configured = envOrConfig('PARTNER_ACCESS_TOKEN', DEFAULT_PARTNER_ACCESS_TOKEN);
  if (configured) return configured;

  const headers = req.headers || {};
  const body = req.body || {};
  const query = req.query || {};
  const fromHeader = headers.access_token || headers['access-token'] || headers.Access_Token;
  const fromBody = body.access_token ?? body.accessToken;
  const fromQuery = query.access_token ?? query.accessToken;
  const raw = fromHeader ?? fromBody ?? fromQuery;
  const token = raw == null ? '' : String(raw).trim();
  return token || null;
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
      const err = new Error(`Partner request timed out after ${timeoutMs}ms`);
      err.statusCode = 504;
      throw err;
    }
    const err = new Error(e?.message || 'Partner request failed');
    err.statusCode = 502;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function assertPartnerBusinessOk(json, fallbackMsg = 'Partner API error') {
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
    const err = new Error(`Partner projects failed (HTTP ${httpStatus}): ${String(text).slice(0, 200)}`);
    err.statusCode = 502;
    throw err;
  }
  assertPartnerBusinessOk(json, 'Partner projects error');
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
    const err = new Error(`Partner systems failed (HTTP ${httpStatus}): ${String(text).slice(0, 200)}`);
    err.statusCode = 502;
    throw err;
  }
  assertPartnerBusinessOk(json, 'Partner systems error');
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
    const err = new Error(`importDemand failed (HTTP ${httpStatus}): ${String(text).slice(0, 200)}`);
    err.statusCode = 502;
    throw err;
  }
  assertPartnerBusinessOk(json, 'importDemand rejected');
  return {
    code: json.code ?? 200,
    msg: json.msg || json.message || 'ok',
    data: json.data,
  };
}
