/**
 * 菜单推送 D1/D2：组 v1.2 payload、stub 调 partner、落库状态、短时 auto-sync。
 */
import { resolve as configResolve } from '../../config/config.js';
import * as systemDao from '../dao/system-dao.js';
import * as systemMenuSnapshotDao from '../dao/system-menu-snapshot-dao.js';
import { NODE_TYPE } from '../dao/system-dao.js';
import { pushMenusToPartner, toPartnerMenuPushPayload } from './partner-platform.js';

const DEFAULT_AUTO_SYNC_MS = 5000;
const DEFAULT_SOURCE_PREFIX = 'JSGEN:';
const timers = new Map(); // systemNodeId → Timeout

/**
 * 菜单推送来源前缀（标识本仓 system id/name）；`MENU_PUSH_SOURCE_PREFIX` 可覆盖，默认 `JSGEN:`。
 * @returns {string} 来源前缀
 */
export function getMenuPushSourcePrefix() {
  const raw = String(configResolve('MENU_PUSH_SOURCE_PREFIX', DEFAULT_SOURCE_PREFIX) || '').trim();
  return raw || DEFAULT_SOURCE_PREFIX;
}

/**
 * 本仓系统 id 加来源前缀（如 `JSGEN:1`）。
 * @param {number|string} localId 本仓系统节点 id
 * @param {string} [prefix] 来源前缀
 * @returns {string} 带来源前缀的 id
 */
export function formatSourceSystemId(localId, prefix = getMenuPushSourcePrefix()) {
  return `${prefix}${localId}`;
}

/**
 * 本仓系统名加来源前缀（如 `JSGEN:信贷系统`）。
 * @param {string} localName 本仓系统名称
 * @param {string} [prefix] 来源前缀
 * @returns {string} 带来源前缀的名称
 */
export function formatSourceSystemName(localName, prefix = getMenuPushSourcePrefix()) {
  return `${prefix}${String(localName || '')}`;
}

/**
 * 菜单推送 auto-sync 窗口（毫秒）；`MENU_PUSH_AUTO_SYNC_MS` 配置，默认 5s。
 * @returns {number} auto-sync 毫秒数
 */
export function getAutoSyncMs() {
  const n = Number(configResolve('MENU_PUSH_AUTO_SYNC_MS', DEFAULT_AUTO_SYNC_MS));
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_AUTO_SYNC_MS;
}

function normalizeStatus(raw) {
  const s = String(raw || '').trim();
  return s || 'idle';
}

/**
 * 推送用 umlEcd（库值优先；空则回退节点 id）。
 *
 * `system.uml_ecd` 有两种来源格式，推送时同等当作 menus[].umlEcd / parentUmlEcd：
 * 1. **建模 JSON 导入**（`source=json_import`）：被测系统《建模组件关系》里的 UML 编码，
 *    形如 `UML00005556`（全库唯一，幂等键）。
 * 2. **AI 菜单扫描新建**（`source=ai`）：无建模编码，落库时写 `String(node.id)`（纯数字串）；
 *    若历史行尚未回填，此处再回退一次 id，保证 parentUmlEcd 仍能建树。
 *
 * @param {object|null|undefined} n 系统树节点
 * @returns {string} 非空时可用于建树的编码
 */
export function resolveMenuUmlEcd(n) {
  if (!n) return '';
  const ecd = String(n.umlEcd || '').trim();
  if (ecd) return ecd;
  return n.id != null && n.id !== '' ? String(n.id) : '';
}

/**
 * 纯函数：组装推送 wire body。
 * @param {object} system type=1 节点
 * @param {object[]} nodes 该系统下 type=2|3 节点（含 parent 信息所需字段）
 * @param {{ menuVersion: number, partnerSystemId: number|string, partnerSystemName: string }} opts 快照版本号与伙伴目标系统
 * @returns {object} v1.2 wire body
 */
export function buildMenuPushPayload(system, nodes, { menuVersion, partnerSystemId, partnerSystemName }) {
  if (partnerSystemId == null || partnerSystemId === '') {
    throw Object.assign(new Error('partnerSystemId is required for menu push wire body'), { code: 'VALIDATION' });
  }
  if (partnerSystemName == null || String(partnerSystemName).trim() === '') {
    throw Object.assign(new Error('partnerSystemName is required for menu push wire body'), { code: 'VALIDATION' });
  }
  const byId = new Map((nodes || []).map((n) => [Number(n.id), n]));
  const list = [...(nodes || [])].sort((a, b) => {
    const so = (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0);
    return so !== 0 ? so : (Number(a.id) || 0) - (Number(b.id) || 0);
  });
  const menus = list.map((n) => {
    const type = Number(n.type);
    const parent = byId.get(Number(n.parentId));
    const name = String(n.name || '');
    const parentName = parent ? String(parent.name || '') : '';
    return {
      umlEcd: resolveMenuUmlEcd(n),
      type,
      name,
      parentPath: type === NODE_TYPE.MODULE ? name : (parentName ? `${parentName}-${name}` : name),
      parentUmlEcd: type === NODE_TYPE.MODULE ? '' : resolveMenuUmlEcd(parent),
      xpath: String(n.menuXpath || ''),
      source: String(n.source || ''),
      unmatched: Number(n.unmatchedFlag) === 1,
      removed: Number(n.removedFlag) === 1,
      pageId: type === NODE_TYPE.MODULE ? '' : String(n.pdCmptEcd || ''),
    };
  });
  return {
    schemaVersion: 1,
    systemNodeId: Number(partnerSystemId) || partnerSystemId,
    systemName: String(partnerSystemName),
    menuVersion: Number(menuVersion) || 0,
    menus,
  };
}

async function listMenuNodesUnderSystem(systemId) {
  const all = await systemDao.listAll();
  const modules = all.filter((n) => Number(n.type) === NODE_TYPE.MODULE && Number(n.parentId) === Number(systemId));
  const moduleIds = new Set(modules.map((m) => Number(m.id)));
  const functions = all.filter((n) => Number(n.type) === NODE_TYPE.FUNCTION && moduleIds.has(Number(n.parentId)));
  return [...modules, ...functions];
}

function scheduleAutoSync(systemNodeId) {
  const ms = getAutoSyncMs();
  if (timers.has(systemNodeId)) clearTimeout(timers.get(systemNodeId));
  if (ms <= 0) {
    void markSynced(systemNodeId);
    return;
  }
  const t = setTimeout(() => {
    timers.delete(systemNodeId);
    void markSynced(systemNodeId);
  }, ms);
  timers.set(systemNodeId, t);
}

async function markSynced(systemNodeId) {
  const node = await systemDao.getById(systemNodeId);
  if (!node || normalizeStatus(node.menuPushStatus) !== 'pushing') return;
  await systemDao.update(systemNodeId, {
    menuPushStatus: 'synced',
    menuPushSyncedAt: new Date(),
    menuPushError: '',
  });
}

/**
 * 若 pushing 已超过 autoSyncMs，纠偏为 synced。
 * @param {number} systemNodeId 系统节点 id
 * @returns {Promise<object|null>} 纠偏后的节点行，或原节点 / null
 */
export async function reconcilePushStatus(systemNodeId) {
  const node = await systemDao.getById(systemNodeId);
  if (!node) return null;
  const status = normalizeStatus(node.menuPushStatus);
  if (status === 'pushing' && node.menuPushAt) {
    const age = Date.now() - new Date(node.menuPushAt).getTime();
    if (Number.isFinite(age) && age >= getAutoSyncMs()) {
      await markSynced(systemNodeId);
      return systemDao.getById(systemNodeId);
    }
  }
  return node;
}

/**
 * 查询系统节点菜单推送状态（含超时纠偏）。
 * @param {number} systemNodeId 系统节点 id
 * @returns {Promise<{ status: string, menuVersion: number, pushedAt: Date|null, syncedAt: Date|null, error: string }>} 推送状态视图
 */
export async function getMenuPushStatus(systemNodeId) {
  const node = await reconcilePushStatus(systemNodeId);
  if (!node || Number(node.type) !== NODE_TYPE.SYSTEM) {
    throw Object.assign(new Error('系统节点不存在'), { code: 'NOT_FOUND' });
  }
  return {
    status: normalizeStatus(node.menuPushStatus),
    menuVersion: Number(node.menuPushVersion) || 0,
    pushedAt: node.menuPushAt || null,
    syncedAt: node.menuPushSyncedAt || null,
    error: String(node.menuPushError || ''),
  };
}

/**
 * 推送系统菜单至伙伴平台并落库 pushing 状态。
 * @param {number} systemNodeId 本仓系统节点 id（菜单数据源）
 * @param {{ accessToken?: string, partnerSystemId?: number|string, partnerSystemName?: string }} [opts] 伙伴目标系统 + token
 * @returns {Promise<{ status: string, menuVersion: number, menuCount: number, partner: object, partnerWire: object, source: object, autoSyncMs: number }>} 202 响应体字段
 */
export async function pushMenuForSystem(systemNodeId, { accessToken, partnerSystemId, partnerSystemName } = {}) {
  const system = await systemDao.getById(systemNodeId);
  if (!system || Number(system.type) !== NODE_TYPE.SYSTEM) {
    throw Object.assign(new Error('系统节点不存在或类型不正确'), { code: 'VALIDATION' });
  }
  if (partnerSystemId == null || partnerSystemId === '') {
    throw Object.assign(new Error('伙伴平台 systemNodeId 必填（body.systemNodeId 或 body.partnerSystemId）'), { code: 'VALIDATION' });
  }
  if (partnerSystemName == null || String(partnerSystemName).trim() === '') {
    throw Object.assign(new Error('伙伴平台 systemName 必填（body.systemName 或 body.partnerSystemName）'), { code: 'VALIDATION' });
  }
  const current = normalizeStatus(system.menuPushStatus);
  if (current === 'pushing') {
    const reconciled = await reconcilePushStatus(systemNodeId);
    if (normalizeStatus(reconciled?.menuPushStatus) === 'pushing') {
      throw Object.assign(new Error('菜单推送进行中，请稍后再试'), { code: 'CONFLICT' });
    }
  }
  const menuVersion = await systemMenuSnapshotDao.getLatestVersion(systemNodeId);
  const nodes = await listMenuNodesUnderSystem(systemNodeId);
  const payload = buildMenuPushPayload(system, nodes, {
    menuVersion,
    partnerSystemId,
    partnerSystemName,
  });
  const partnerWire = toPartnerMenuPushPayload(payload);
  const partner = await pushMenusToPartner(payload, { accessToken });
  const now = new Date();
  await systemDao.update(systemNodeId, {
    menuPushStatus: 'pushing',
    menuPushVersion: menuVersion,
    menuPushAt: now,
    menuPushSyncedAt: null,
    menuPushError: '',
  });
  scheduleAutoSync(systemNodeId);
  return {
    status: 'pushing',
    menuVersion,
    menuCount: payload.menus.length,
    partner,
    partnerWire: {
      systemNodeId: partnerWire.systemNodeId,
      systemName: partnerWire.systemName,
      menuVersion: partnerWire.menuVersion,
      menuCount: partnerWire.menus?.length ?? 0,
    },
    source: {
      systemId: formatSourceSystemId(system.id),
      systemName: formatSourceSystemName(system.name),
    },
    autoSyncMs: getAutoSyncMs(),
  };
}
