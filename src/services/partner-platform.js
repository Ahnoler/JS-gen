/**
 * Partner automation platform HTTP client.
 * Default prefix: http://172.20.101.162:11001/api（联调指向同事本地服务，原 test.atp 已停用）
 * Outbound auth: 转发调用方的 access_token（SSO JWT，与账号中心同源）；
 * 调用方未带 token 时回落 PARTNER_ACCESS_TOKEN env（服务级 token，需在 .env 显式配置，
 * 无默认兜底——缺失时 requireAccessToken 显式 400）。
 * Override: PARTNER_API_BASE / PARTNER_SYSTEM_BASE_URL / PARTNER_IMPORT_DEMAND_URL / PARTNER_ACCESS_TOKEN
 */
import { resolve as configResolve, PARTNER_SECTION_TYPE } from '../../config/config.js';

const DEFAULT_API_BASE = 'http://172.20.101.162:11001/api';
const DEFAULT_MENU_PUSH_BASE = 'http://172.20.101.63:11002/api';
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

/** 菜单推送专用基址：新联调服务器（发版后切线上地址时改 PARTNER_MENU_PUSH_BASE） */
function menuPushApiBase() {
  return envOrConfig('PARTNER_MENU_PUSH_BASE') || DEFAULT_MENU_PUSH_BASE;
}

/**
 * Token for partner outbound calls (projects / systems / importDemand).
 * 优先转发调用方 access_token（header/body/query，Vue 登录态 SSO JWT——
 * 伙伴平台与账号中心同源，直接复用登录 token，按登录用户身份调用）；
 * 调用方未带 token 时回落 PARTNER_ACCESS_TOKEN（服务级 token，供无登录态的脚本/联调；
 * 需在 .env 显式配置，无硬编码兜底）。
 * @param {import('express').Request | { headers?: object, body?: object, query?: object }} req incoming request
 * @returns {string|null} resolved access token（两处均无时为 null）
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
  const fromEnv = envOrConfig('PARTNER_ACCESS_TOKEN');
  if (fromEnv) return fromEnv;
  return null;
}

/**
 * Resolve access token or throw 400 when none is available.
 * @param {import('express').Request} req incoming request
 * @returns {string} access token
 */
export function requireAccessToken(req) {
  const token = resolveAccessToken(req);
  if (!token) {
    const err = new Error('access_token is required (header, body, or env PARTNER_ACCESS_TOKEN；需配置 PARTNER_ACCESS_TOKEN)');
    err.statusCode = 400;
    throw err;
  }
  return token;
}

/**
 * @param {object} src source object with systemId/projectId
 * @returns {{ systemId: string, projectId: string }} resolved ids (with defaults)
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

/**
 * 伙伴 schema 不认识的字段（V3 调试辅助，partner Jackson 严格反序列化会拒收；
 * attr 为本地/replay 元数据，确认伙伴认后再放开）
 */
const PARTNER_PROP_DROP_KEYS = ['regionId', 'regionLabel', 'attr'];

/**
 * 把本仓 payload 适配成伙伴 importDemand 契约：
 * - transcationProperties 全量保留（ele/page/dialog；伙伴 V3 契约 page 步骤需透传），仅过滤空条目
 * - 剥除 regionId/regionLabel（伙伴 V3 契约暂不接受）
 * - screenshot(URL[]) → 并入 screenCapture(逗号串) 后删除 screenshot 字段
 *   （伙伴 V3 契约：字段名改 screenCapture；screenshot 旧语义=是否执行截图 integer，
 *   V3 塞 URL 数组会 Jackson 反序列化失败 → 400）
 * 纯函数、浅拷贝；仅影响发送体，不影响 dry-run / 响应中的 payload。
 * @param {object} payload local import payload
 * @returns {object} partner-adapted payload
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
          // section type fallback：伙伴不接受 'section' 时改用 'object'+elementType='partition'
          if (out.type === 'section' && PARTNER_SECTION_TYPE !== 'section') {
            out.type = 'object';
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
 * - page/popup 无 screenCapture
 * @param {object} wirePayload partner-adapted payload
 * @returns {{ ok: boolean, issues: Array }} preflight result
 */
export function preflightCheck(wirePayload) {
  const list = wirePayload?.transcationEventTypeList || [];
  const issues = [];
  for (const entry of list) {
    for (const p of entry.transcationProperties || []) {
      for (const [k, v] of Object.entries(p)) {
        if (v === undefined) issues.push({ id: p.propertiesID, field: k, issue: 'undefinedValue' });
      }
      if ((p.type === 'page' || p.type === 'popup') && !p.screenCapture)
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
 * @param {object} [opts] request options
 * @param {string} opts.accessToken partner access token
 * @returns {Promise<{ id: number|string, name: string }[]>} partner projects
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
  // 内部递归剪枝用（不可枚举，不会出现在 JSON 响应里）：
  // 伙伴懒加载树以 isLeaf=true 标记叶子，无需再按 parentId 探测一层
  Object.defineProperty(out, '_isLeaf', { value: node.isLeaf === true, enumerable: false });
  return out;
}

/**
 * 拉取伙伴平台懒加载系统树的某一层。
 * @param {object} opts 请求参数
 * @param {string} opts.accessToken partner access token
 * @param {string|number} opts.projectId partner project id
 * @param {string|number} [opts.parentId] 父系统 ID；缺省取根层
 * @returns {Promise<object[]>} 归一化的系统节点列表
 */
async function fetchPartnerSystemLevel({ accessToken, projectId, parentId } = {}) {
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
 * 菜单推送专用系统查询（partner 平台 getSystemNodeLevel，POST 无参数）。
 * 当前指向新联调服务器 172.20.101.63:11002（PARTNER_MENU_PUSH_BASE 可覆盖，发版后切线上地址）。
 * @param {object} [opts] 请求参数
 * @param {string} opts.accessToken partner access token
 * @returns {Promise<object[]>} 归一化的系统节点列表（扁平，id/systemName）
 */
export async function listPartnerMenuPushSystems({ accessToken } = {}) {
  const url = `${menuPushApiBase()}/system/system/getSystemNodeLevel`;
  const { json, text, httpStatus } = await partnerFetch(url, {
    method: 'POST',
    accessToken,
    body: {},
  });
  if (!json) {
    console.warn(
      `[partner] menu-push systems non-JSON HTTP ${httpStatus}:`,
      String(text).slice(0, 200),
    );
    const err = new Error(PARTNER_NETWORK_ERROR_MSG);
    err.statusCode = 502;
    err.partnerDetail = { httpStatus, preview: String(text).slice(0, 200) };
    throw err;
  }
  assertPartnerBusinessOk(json, PARTNER_NETWORK_ERROR_MSG);
  const raw = json.data ?? json.rows ?? json.list ?? [];
  const list = Array.isArray(raw) ? raw : [];
  return list.map(normalizeSystemNode).filter(Boolean);
}

/**
 * List partner systems under a project — single lazy level.
 * 兼容旧懒加载调用方；批量推送弹窗应使用 listPartnerSystemTree。
 * @param {object} [opts] request options
 * @param {string} opts.accessToken partner access token
 * @param {string|number} opts.projectId partner project id
 * @param {string|number} [opts.parentId] optional parent system id
 * @returns {Promise<object[]>} partner system nodes
 */
export async function listPartnerSystems({ accessToken, projectId, parentId } = {}) {
  if (projectId == null || projectId === '') {
    const err = new Error('projectId is required');
    err.statusCode = 400;
    throw err;
  }
  return fetchPartnerSystemLevel({ accessToken, projectId, parentId });
}

/**
 * List the FULL partner system tree for a project: 自根向下按 parentId
 * 逐层展开非叶节点，组装成嵌套树。同层并发拉取；maxDepth 防御环。
 * @param {object} [opts] request options
 * @param {string} opts.accessToken partner access token
 * @param {string|number} opts.projectId partner project id
 * @param {number} [opts.maxDepth] 递归深度上限（缺省 8）
 * @returns {Promise<object[]>} nested partner system nodes
 */
export async function listPartnerSystemTree({ accessToken, projectId, maxDepth = 8 } = {}) {
  if (projectId == null || projectId === '') {
    const err = new Error('projectId is required');
    err.statusCode = 400;
    throw err;
  }
  const roots = await fetchPartnerSystemLevel({ accessToken, projectId });
  const expand = async (node, depth) => {
    if (depth >= maxDepth || node._isLeaf === true) return;
    try {
      const kids = await fetchPartnerSystemLevel({ accessToken, projectId, parentId: node.id });
      if (!kids.length) return;
      node.children = kids;
      await Promise.all(kids.map((kid) => expand(kid, depth + 1)));
    } catch (err) {
      // 单层展开失败不阻断整棵树，只记日志、该分支缺子级
      process.stderr.write(
        `[partner] system-tree expand failed at project=${projectId} parentId=${node.id}: ${err?.message || err}\n`,
      );
    }
  };
  await Promise.all(roots.map((root) => expand(root, 0)));
  return roots;
}

/**
 * POST partner importDemand body.
 * 发送前做伙伴契约适配：
 * - transcationProperties 剥除伙伴 schema 之外的字段（regionId/regionLabel 为 V3 调试辅助，
 *   partner Jackson 严格反序列化会因未知字段报「参数错误」）
 * - 伙伴 schema：screenshot=是否执行截图(integer)，screenshots=截图(string)；
 *   V3 原样把 URL 数组塞在 screenshot —— 合并进 screenshots（逗号串）
 * 浅拷贝改造，不影响本地 dry-run / 响应中的 payload。
 * @param {object} payload local import payload
 * @param {object} [opts] request options
 * @param {string} opts.accessToken partner access token
 * @returns {Promise<{ code: number, msg?: string, data?: unknown }>} partner response
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

/**
 * 把 v1.2 本地 payload 适配成伙伴 importData 契约（剥 schemaVersion，保留 menus 明细）。
 * @param {object} payload buildMenuPushPayload 输出
 * @returns {{ systemNodeId: number, systemName?: string, menuVersion?: number, menus: object[] }}
 */
export function toPartnerMenuPushPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const out = {
    systemNodeId: payload.systemNodeId,
    menus: Array.isArray(payload.menus) ? payload.menus : [],
  };
  if (payload.systemName != null && String(payload.systemName).trim() !== '') {
    out.systemName = String(payload.systemName);
  }
  if (payload.menuVersion != null && payload.menuVersion !== '') {
    out.menuVersion = Number(payload.menuVersion) || 0;
  }
  return out;
}

/**
 * POST 伙伴菜单 importData（`/system/umlElementData/importData`）。
 * 基址：`PARTNER_MENU_PUSH_BASE`，默认 `http://172.20.101.63:11002/api`（联调；发版后切线上）。
 * @param {object} payload v1.2 wire body（schemaVersion/systemNodeId/systemName/menuVersion/menus）
 * @param {{ accessToken?: string }} [opts]
 * @returns {Promise<{ code: number, msg?: string, data?: unknown }>} partner response
 */
export async function pushMenusToPartner(payload, { accessToken } = {}) {
  const url = `${menuPushApiBase()}/system/umlElementData/importData`;
  const wirePayload = toPartnerMenuPushPayload(payload);
  console.log('[partner] menu importData wire', {
    systemNodeId: wirePayload.systemNodeId,
    systemName: wirePayload.systemName,
    menuVersion: wirePayload.menuVersion,
    menuCount: wirePayload.menus?.length ?? 0,
  });
  const { json, text, httpStatus } = await partnerFetch(url, {
    method: 'POST',
    accessToken,
    body: wirePayload,
  });
  if (!json) {
    console.warn(
      `[partner] menu importData non-JSON HTTP ${httpStatus}:`,
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
