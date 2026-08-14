/**
 * V2 partner transaction export (importDemand body).
 * Shape:
 * {
 *   transcationEventTypeList: [
 *     {
 *       transcationName, systemId, projectId, transcationType, testFrame,
 *       transcId?,  // optional recording id
 *       transcationProperties: [ { options, elementType, eventTypeName, eventTypeValue, ... } ]
 *     }
 *   ]
 * }
 * // TODO: partial export (stepIds/phaseIds) + export coverage
 * // TODO: placeholder — wait for partner / relative xpath guidance
 */
import { deriveRegionRef } from './region-tree.js';
import { normalizeActionName } from '../models/action-name.js';
import { trajectoryStepToActionEntry } from '../models/element.js';
import {
  ACTION_TO_ENGINE_TYPE,
  pickExportTarget,
  buildOperationName,
  pickOperationValue,
  SKIP_ACTIONS,
} from './legacy-engine-export.js';

export const TRANSACTION_SCHEMA_VERSION = 2;

export const EVENT_TYPE_NAME = Object.freeze({
  click: '点击',
  input: '文本框输入',
  'select:click': '下拉框点击选择',
  'select:tree': '下拉框树形选择',
  radio: '单选框选择',
  date: '日期',
});

export const TRANSACTION_ENVELOPE_FIELDS = Object.freeze([
  { key: 'transcationEventTypeList', zh: '交易列表（单轨也包一层数组）' },
  { key: 'transcationName', zh: '交易名称' },
  { key: 'systemId', zh: '系统树 id' },
  { key: 'projectId', zh: '项目 id' },
  { key: 'transcationType', zh: '类型（默认 web）' },
  { key: 'testFrame', zh: '框架（默认 playwright）' },
  { key: 'transcId', zh: '录制/交易 id（可选）' },
  { key: 'transcationProperties', zh: '步骤/事件数组' },
  { key: 'regionId', zh: '步骤所属区域节点 id（最内层 region_id 段 role:label）' },
  { key: 'parentRegionId', zh: '父区域节点 id（上一层段；根为空串）' },
  { key: 'phases', zh: '阶段数组（截图引用 + 元数据；旧截图 metadata 为 null）' },
]);

function resolveOptions(entry) {
  const fromEl = entry?.element?.options;
  const fromParams = entry?.params?.options;
  const raw = Array.isArray(fromEl) && fromEl.length
    ? fromEl
    : (Array.isArray(fromParams) ? fromParams : []);
  const opts = [];
  const seen = new Set();
  for (const o of raw) {
    const s = String(o ?? '').trim();
    if (!s || s === '请选择' || seen.has(s)) continue;
    seen.add(s);
    opts.push(s);
  }
  return opts.length ? JSON.stringify(opts) : '';
}

export function mapStepToTransactionEvent(step) {
  const entry = step?.action && step?.element !== undefined && !step?.actionType
    ? step
    : trajectoryStepToActionEntry(step || {});
  const action = normalizeActionName(entry.action || step?.actionType || '');
  if (!action || SKIP_ACTIONS.has(action)) return null;
  const eventTypeValue = ACTION_TO_ENGINE_TYPE[action];
  if (!eventTypeValue) return null;

  const params = entry.params || {};
  const element = entry.element || {};
  const { regionId, parentRegionId } = deriveRegionRef(element);
  const { target, source } = pickExportTarget(entry);
  const options = resolveOptions(entry);

  // Partner: no separator in propertiesName (点击客户管理); also strip \ / : * ? " < > | '
  const propertiesName = String(buildOperationName(action, params, element) || '')
    .replace(/[\\/:*?"<>|']/g, '');

  // elementType=xpath、eventTypeValue=click 等：ATP 历史字段语义，按对方约定保持
  return {
    options,
    elementType: target || null,
    eventTypeName: EVENT_TYPE_NAME[eventTypeValue] || eventTypeValue,
    eventTypeValue,
    transcationType: 'playwright',
    objectValue: pickOperationValue(action, params),
    propertiesName,
    mothed: 'By.XPATH',
    regionId,
    parentRegionId,
    _meta: {
      targetSource: source || null,
      missingOptions: options === '' && (eventTypeValue.startsWith('select') || eventTypeValue === 'radio'),
    },
  };
}

/**
 * Ensure propertiesName unique within one transaction (partner requirement).
 * First keeps base; later get numeric suffix: 填写客户名称 → 填写客户名称2.
 */
export function uniquifyPropertiesNames(properties) {
  const used = new Set();
  for (const p of properties || []) {
    const base = String(p?.propertiesName || '').trim() || '步骤';
    let name = base;
    let n = 2;
    while (used.has(name)) {
      name = `${base}${n}`;
      n += 1;
    }
    used.add(name);
    p.propertiesName = name;
  }
  return properties;
}

/**
 * Build phases[] for one transaction: per-phase screenshot reference + metadata.
 * @param {Array<{ id: number, phaseNumber: number }>} [phases]
 * @param {Array<{ id: number, trajectoryPhaseId: number, metadataJson?: object|null }>} [phaseScreenshots]
 * @returns {Array<{ phaseId: number|null, phaseNumber: number, screenshotId: number|null, stitchScreenshotUrl: string|null, metadata: object|null }>}
 */
export function buildTransactionPhases(phases = [], phaseScreenshots = []) {
  const byPhase = new Map();
  for (const s of phaseScreenshots || []) {
    if (s?.trajectoryPhaseId != null && !byPhase.has(Number(s.trajectoryPhaseId))) {
      byPhase.set(Number(s.trajectoryPhaseId), s);
    }
  }
  return (phases || []).map((p) => {
    const shot = p?.id != null ? byPhase.get(Number(p.id)) || null : null;
    const screenshotId = shot ? Number(shot.id) : null;
    return {
      phaseId: p?.id != null ? Number(p.id) : null,
      phaseNumber: p?.phaseNumber != null ? Number(p.phaseNumber) : 0,
      screenshotId,
      stitchScreenshotUrl: screenshotId ? `/api/v2/screenshots/${screenshotId}/image` : null,
      metadata: shot?.metadataJson ?? null,
    };
  });
}

/**
 * Build one transaction entry (inside transcationEventTypeList).
 * @returns {{ entry: object, count: number, skipped: object, stats: object }}
 */
export function buildTransactionEntry(traj, { systemId, projectId, phases, phaseScreenshots } = {}) {
  if (systemId == null || systemId === '' || projectId == null || projectId === '') {
    const err = new Error('systemId and projectId are required');
    err.statusCode = 400;
    throw err;
  }
  const properties = [];
  let metaActions = 0;
  let absoluteFallback = 0;
  let missingOptions = 0;

  for (const step of traj.steps || []) {
    const ev = mapStepToTransactionEvent(step);
    if (!ev) {
      metaActions += 1;
      continue;
    }
    if (ev._meta?.targetSource === 'xpath_full') absoluteFallback += 1;
    if (ev._meta?.missingOptions) missingOptions += 1;
    const { _meta, ...publicEv } = ev;
    properties.push(publicEv);
  }
  uniquifyPropertiesNames(properties);

  const id = traj.id != null ? String(traj.id) : '';
  const name = String(traj.name || '').trim() || `trajectory-${id}`;

  return {
    entry: {
      transcId: id,
      transcationName: name,
      systemId: String(systemId),
      projectId: String(projectId),
      transcationType: 'web',
      testFrame: 'playwright',
      transcationProperties: properties,
      phases: buildTransactionPhases(phases, phaseScreenshots),
    },
    count: properties.length,
    skipped: { metaActions },
    stats: { absoluteFallback, missingOptions },
  };
}

/**
 * Single-trajectory importDemand body (always wraps list of length 1).
 */
export function buildTransactionPayload(traj, opts = {}) {
  const built = buildTransactionEntry(traj, opts);
  return {
    payload: {
      transcationEventTypeList: [built.entry],
    },
    count: built.count,
    skipped: built.skipped,
    stats: built.stats,
  };
}

/**
 * Multi-trajectory importDemand body.
 * @param {Array<{ entry: object, count: number, skipped?: object, stats?: object }>} builtEntries
 */
export function wrapTransactionList(builtEntries = []) {
  const list = [];
  let count = 0;
  let metaActions = 0;
  let absoluteFallback = 0;
  let missingOptions = 0;
  for (const b of builtEntries) {
    if (!b?.entry) continue;
    list.push(b.entry);
    count += Number(b.count) || 0;
    metaActions += Number(b.skipped?.metaActions) || 0;
    absoluteFallback += Number(b.stats?.absoluteFallback) || 0;
    missingOptions += Number(b.stats?.missingOptions) || 0;
  }
  return {
    payload: { transcationEventTypeList: list },
    count,
    skipped: { metaActions },
    stats: { absoluteFallback, missingOptions },
  };
}
