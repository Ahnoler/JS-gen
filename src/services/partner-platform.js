/**
 * Partner automation platform HTTP client.
 * Default prefix: http://test.atp.tansun.com.cn/api/
 * Outbound auth: 转发调用方的 access_token（SSO JWT，与账号中心同源）；
 * 调用方未带 token 时回落 PARTNER_ACCESS_TOKEN（服务级 token，供脚本/联调）。
 * Override: PARTNER_API_BASE / PARTNER_SYSTEM_BASE_URL / PARTNER_IMPORT_DEMAND_URL / PARTNER_ACCESS_TOKEN
 */
import { resolve as configResolve, PARTNER_SECTION_TYPE } from '../../config/config.js';

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

/** 伙伴 schema 不认识的字段（V3 调试辅助，partner Jackson 严格反序列化会拒收） */
const PARTNER_PROP_DROP_KEYS = ['regionId', 'regionLabel'];

/**
 * 把本仓 payload 适配成伙伴 importDemand 契约：
 * - transcationProperties 全量保留（ele/page/dialog；伙伴 V3 契约 page 步骤需透传），仅过滤空条目
 * - 剥除 regionId/regionLabel（伙伴 V3 契约暂不接受）
 * - screenshot(URL[]) → 并入 screenCapture(逗号串) 后删除 screenshot 字段
 *   （伙伴 V3 契约：字段名改 screenCapture；screenshot 旧语义=是否执行截图 integer，
 *   V3 塞 URL 数组会 Jackson 反序列化失败 → 400）
 * 纯函数、浅拷贝；仅影响发送体，不影响 dry-run / 响应中的 payload。
 */
export function toPartnerImportPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const clone = { ...payload };
  const list = clone.transcationEventTypeList;
  if (Array.isArray(list)) {
    clone.transcationEventTypeList = list.map((entry) => {
      const e = { ...entry };
      const props = Array.isArray(e.transcationProperties) ? e.transcationProperties : [];
      e.transcationProperties = props
        .filter(Boolean)
        .map((p) => {
          const out = { ...p };
          // section type fallback：伙伴不接受 'section' 时改用 'ele'+elementType='partition'
          if (out.type === 'section' && PARTNER_SECTION_TYPE !== 'section') {
            out.type = 'ele';
            out.elementType = 'partition';
          }
          for (const k of PARTNER_PROP_DROP_KEYS) delete out[k];
          const shots = Array.isArray(out.screenshot) ? out.screenshot : [];
          if (shots.length) {
            out.screenCapture = shots.filter(Boolean).join(',');
          }
          delete out.screenshot;
          return out;
        });
      return e;
    });
  }
  return clone;
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

/**
 * 推送前自检：检查 wire payload 的信息丢失风险（只统计不阻断）。
 * - undefined 值检测（JSON.stringify 静默丢弃 undefined key）
 * - page/dialog 无 screenCapture
 * @returns {{ ok: boolean, issues: Array }}
 */
export function preflightCheck(wirePayload) {
  const list = wirePayload?.transcationEventTypeList || [];
  const issues = [];
  for (const entry of list) {
    for (const p of entry.transcationProperties || []) {
      for (const [k, v] of Object.entries(p)) {
        if (v === undefined) issues.push({ id: p.propertiesID, field: k, issue: 'undefinedValue' });
      }
      if ((p.type === 'page' || p.type === 'dialog') && !p.screenCapture)
        issues.push({ id: p.propertiesID, issue: 'emptyScreenCapture' });
    }
  }
  return { ok: issues.length === 0, issues };
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
  const childrenRaw = node.children ?? node.childList ?? node.childSystems ?? node.nodes;
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
 * 发送前做伙伴契约适配：
 * - transcationProperties 剥除伙伴 schema 之外的字段（regionId/regionLabel 为 V3 调试辅助，
 *   partner Jackson 严格反序列化会因未知字段报「参数错误」）
 * - 伙伴 schema：screenshot=是否执行截图(integer)，screenshots=截图(string)；
 *   V3 原样把 URL 数组塞在 screenshot —— 合并进 screenshots（逗号串）
 * 浅拷贝改造，不影响本地 dry-run / 响应中的 payload。
 * @returns {Promise<{ code: number, msg?: string, data?: unknown }>}
 */
export async function pushImportDemand(payload, { accessToken } = {}) {
  const url = importDemandUrl();
  const wirePayload = toPartnerImportPayload(payload);
  // 推送前自检（只统计不阻断）：信息丢失风险写入 stderr，继续推送
  const preflight = preflightCheck(wirePayload);
  if (!preflight.ok) {
    process.stderr.write(`[preflight] ${preflight.issues.length} issues found (non-blocking)\n`);
  }
  const { json, text, httpStatus } = await partnerFetch(url, {
    method: 'POST',
    accessToken,
    body: wirePayload,
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
