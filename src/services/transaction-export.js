/**
 * V2 partner transaction export (参数.txt envelope).
 * // TODO: partial export (stepIds/phaseIds) + export coverage
 * // TODO: placeholder — wait for partner / relative xpath guidance
 */
import { normalizeActionName } from '../models/action-name.js';
import { trajectoryStepToActionEntry } from '../models/element.js';
import {
  ACTION_TO_ENGINE_TYPE,
  pickExportTarget,
  buildOperationName,
  pickOperationValue,
  SKIP_ACTIONS,
} from './legacy-engine-export.js';

export const EVENT_TYPE_NAME = Object.freeze({
  click: '点击',
  input: '文本框输入',
  'select:click': '下拉框点击选择',
  'select:tree': '下拉框树形选择',
  radio: '单选框选择',
  date: '日期',
});

export const TRANSACTION_ENVELOPE_FIELDS = Object.freeze([
  { key: 'transcId', zh: '录制/交易 id' },
  { key: 'transcationName', zh: '交易名称' },
  { key: 'systemId', zh: '系统树 id' },
  { key: 'projectId', zh: '项目 id' },
  { key: 'transcationType', zh: '类型（默认 web）' },
  { key: 'testFrame', zh: '框架（默认 selenium）' },
  { key: 'transcationEventType', zh: '事件数组' },
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
  const { target, source } = pickExportTarget(entry);
  const options = resolveOptions(entry);

  return {
    options,
    elementType: target || null,
    eventTypeName: EVENT_TYPE_NAME[eventTypeValue] || eventTypeValue,
    eventTypeValue,
    transcationType: 'selenium',
    objectValue: pickOperationValue(action, params),
    propertiesName: buildOperationName(action, params, element),
    mothed: 'By.XPATH',
    _meta: { targetSource: source || null, missingOptions: options === '' && (eventTypeValue.startsWith('select') || eventTypeValue === 'radio') },
  };
}

export function buildTransactionPayload(traj, { systemId, projectId } = {}) {
  if (systemId == null || systemId === '' || projectId == null || projectId === '') {
    const err = new Error('systemId and projectId are required');
    err.statusCode = 400;
    throw err;
  }
  const events = [];
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
    events.push(publicEv);
  }

  const id = traj.id != null ? String(traj.id) : '';
  const name = String(traj.name || '').trim() || `trajectory-${id}`;

  return {
    payload: {
      transcId: id,
      transcationName: name,
      systemId: String(systemId),
      projectId: String(projectId),
      transcationType: 'web',
      testFrame: 'selenium',
      transcationEventType: events,
    },
    count: events.length,
    skipped: { metaActions },
    stats: { absoluteFallback, missingOptions },
  };
}
