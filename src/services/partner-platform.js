/**
 * Partner automation platform HTTP client.
 * - System/project APIs (PARTNER_SYSTEM_BASE_URL)
 * - importDemand push (PARTNER_IMPORT_DEMAND_URL)
 * Auth: access_token header (same as partner + Vue request.ts).
 */

const DEFAULT_SYSTEM_BASE = 'http://172.19.87.169';
const DEFAULT_IMPORT_URL =
  'http://172.20.101.63:11002/api/demand/demandtranscation/importDemand';
const DEFAULT_TIMEOUT_MS = 30_000;

export const DEFAULT_PARTNER_SYSTEM_ID = '98';
export const DEFAULT_PARTNER_PROJECT_ID = '31';

function systemBaseUrl() {
  return String(process.env.PARTNER_SYSTEM_BASE_URL || DEFAULT_SYSTEM_BASE).replace(/\/$/, '');
}

function importDemandUrl() {
  return String(process.env.PARTNER_IMPORT_DEMAND_URL || DEFAULT_IMPORT_URL).trim();
}

/**
 * Resolve partner access_token from Express req, then env.
 * @param {import('express').Request | { headers?: object, body?: object, query?: object }} req
 */
export function resolveAccessToken(req = {}) {
  const headers = req.headers || {};
  const body = req.body || {};
  const query = req.query || {};
  const fromHeader = headers.access_token || headers['access-token'] || headers.Access_Token;
  const fromBody = body.access_token ?? body.accessToken;
  const fromQuery = query.access_token ?? query.accessToken;
  const fromEnv = process.env.PARTNER_ACCESS_TOKEN;
  const raw = fromHeader ?? fromBody ?? fromQuery ?? fromEnv;
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
  const url = `${systemBaseUrl()}/api/system/systemproject/list`;
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
  const url = `${systemBaseUrl()}/api/system/system/lazySystemTree?${qs.toString()}`;
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
