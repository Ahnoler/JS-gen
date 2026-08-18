/**
 * V3 partner transaction export — 优化版（合并 result 到 transcationProperties）。
 *
 * 相对旧 V3.0 变化：
 *   - 移除 `result.groups` 双轨结构。
 *   - `transcationProperties` 作为唯一业务事件数组，并合并控件树信息：
 *     id / pid / label / regionId / regionLabel / rect / scanIndex。
 *   - 页面/弹窗截图统一放在 `payload.screenshots`。
 *   - 属性中不重复输出 `url`，通过 `pid` 关联截图。
 */
import { mapStepToTransactionEvent, uniquifyPropertiesNames } from './transaction-export.js';
import { PUSH_V3_SCREENSHOT_BUCKET, PUSH_V3_SCREENSHOT_EXPIRES } from '../../config/config.js';

export const TRANSACTION_SCHEMA_VERSION_V3 = 3;

/** action_type → 同事格式的 {command, action}；未映射保留原名。 */
const ACTION_MAP = Object.freeze({
  fill_form_field: ['input', 'input'],
  select_option: ['select', 'select'],
  select_tree_option: ['select', 'select'],
  fill_date_field: ['fill_date_field', 'fill_date_field'],
  select_date: ['fill_date_field', 'fill_date_field'],
  click_element_by_index: ['click', 'click_element_by_index'],
  click_menu_item: ['click', 'click'],
  click_adjacent_button: ['click', 'click'],
  click_table_row_button: ['click', 'click'],
  click_table_row_radio: ['click', 'click'],
  click_radio: ['click', 'click'],
  click_icon_button: ['click', 'click'],
  click_save: ['click', 'click'],
  switch_tab: ['click', 'click'],
  close_dialog: ['click', 'close'],
});

/** target_kind → 同事格式的 kind；未映射保留原名。 */
const KIND_MAP = Object.freeze({
  form_input: 'input',
  form_select: 'select',
  form_date: 'date',
  form_tree_select: 'tree',
  form_radio: 'radio',
  form_checkbox: 'checkbox',
  button: 'button',
  menu: 'menu',
  table_row_button: 'button',
  adjacent_button: 'button',
  tree_node: 'tree',
  tab: 'tab',
  submenu: 'menu',
  icon: 'icon',
  breadcrumb: 'breadcrumb',
  card: 'card',
  collapse: 'collapse',
  dialog: 'dialog',
  drawer: 'drawer',
});

export function mapControlAction(actionType) {
  const m = ACTION_MAP[actionType];
  return m ? { command: m[0], action: m[1] } : { command: actionType || '', action: actionType || '' };
}

export function mapControlKind(targetKind) {
  return KIND_MAP[targetKind] || targetKind || '';
}

/** region_id 分层链（'|' 分段，role:label）中含 overlay 段 → 返回该段；否则 null。 */
export function isOverlayRegion(regionId) {
  const rid = String(regionId || '').trim();
  if (!rid) return null;
  for (const seg of rid.split('|').map((s) => s.trim()).filter(Boolean)) {
    const i = seg.indexOf(':');
    if (i > 0 && seg.slice(0, i).trim() === 'overlay') {
      return { role: 'overlay', label: seg.slice(i + 1).trim() };
    }
  }
  return null;
}

function parseJson(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseStepElement(step) {
  const el = parseJson(step?.elementJson);
  return el && typeof el === 'object' ? el : null;
}

/** 合法 rect 判定：四值有限且 x2>x1、y2>y1。 */
function isLegalRect(bbox) {
  return !!bbox && typeof bbox === 'object'
    && Number.isFinite(Number(bbox.x1)) && Number.isFinite(Number(bbox.y1))
    && Number.isFinite(Number(bbox.x2)) && Number.isFinite(Number(bbox.y2))
    && Number(bbox.x2) > Number(bbox.x1) && Number(bbox.y2) > Number(bbox.y1);
}

/**
 * 构建 payload.screenshots。
 * 页面截图来自 phase_highlight；弹窗截图由后续开发传入 dialogScreenshots。
 */
export function buildV3Screenshots({
  traj = {},
  phases = [],
  phaseScreenshots = [],
  dialogScreenshots = [],
} = {}) {
  const shotByPhase = new Map();
  for (const s of phaseScreenshots || []) {
    if (s?.trajectoryPhaseId != null && !shotByPhase.has(Number(s.trajectoryPhaseId))) {
      shotByPhase.set(Number(s.trajectoryPhaseId), s);
    }
  }

  const screenshots = [];
  const phaseList = [...(phases || [])]
    .sort((a, b) => Number(a.phaseNumber ?? a.phase_number ?? 0) - Number(b.phaseNumber ?? b.phase_number ?? 0));

  for (const phase of phaseList) {
    const phaseId = Number(phase.id);
    const phaseNumber = Number(phase.phaseNumber ?? phase.phase_number ?? 0);
    const shot = shotByPhase.get(phaseId) || null;
    if (!shot) continue;
    const desc = String(phase.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 20);
    screenshots.push({
      phaseNumber,
      bucket: PUSH_V3_SCREENSHOT_BUCKET,
      type: 'page',
      key: `page-${phaseNumber}`,
      name: `页面${phaseNumber}${desc ? ` · ${desc}` : ''}`,
      url: `/api/v2/screenshots/${Number(shot.id)}/image`,
      expires: PUSH_V3_SCREENSHOT_EXPIRES,
    });
  }

  for (const dlg of dialogScreenshots || []) {
    const meta = dlg.metadataJson || {};
    const phaseNumber = Number(dlg.phaseNumber ?? meta.phaseNumber ?? 0);
    const key = dlg.key || meta.dialogKey || '';
    const name = dlg.name || meta.dialogTitle || 'overlay';
    screenshots.push({
      phaseNumber,
      bucket: dlg.bucket || PUSH_V3_SCREENSHOT_BUCKET,
      type: dlg.type || 'dialog',
      key,
      name,
      url: dlg.url || `/api/v2/screenshots/${Number(dlg.id)}/image`,
      expires: dlg.expires ?? PUSH_V3_SCREENSHOT_EXPIRES,
    });
  }

  return screenshots;
}

/**
 * 构建合并后的 transcationProperties。
 * 在 V2 五个核心字段基础上，增加控件树/分层/点亮字段。
 */
export function buildV3Properties({ traj = {}, phases = [] } = {}) {
  const properties = [];
  let metaActions = 0;
  let absoluteFallback = 0;
  let missingOptions = 0;
  let noRectControls = 0;
  let scanIndex = 0;

  const phaseById = new Map();
  for (const p of phases || []) {
    phaseById.set(Number(p.id), p);
  }
  for (const step of traj.steps || []) {
    const ev = mapStepToTransactionEvent(step);
    if (!ev) {
      metaActions += 1;
      continue;
    }
    if (ev._meta?.targetSource === 'xpath_full') absoluteFallback += 1;
    if (ev._meta?.missingOptions) missingOptions += 1;
    const { _meta, ...publicEv } = ev;

    const el = parseStepElement(step);
    const phaseId = step.trajectoryPhaseId != null ? Number(step.trajectoryPhaseId) : null;
    const phase = phaseId != null ? phaseById.get(phaseId) : null;
    const phaseNumber = phase
      ? Number(phase.phaseNumber ?? phase.phase_number ?? 0)
      : Number(step.phaseNumber ?? 0);
    const pageId = `page-${phaseNumber}`;
    const overlay = el ? isOverlayRegion(String(el.region_id ?? '').trim()) : null;

    let pid = pageId;
    if (overlay) {
      const title = overlay.label || 'overlay';
      pid = `${pageId}|dialog:${title}`;
    }

    const label = el ? String(el.formLabel ?? el.text ?? el.matchedLabel ?? '').trim() : '';
    const currentScanIndex = scanIndex;
    scanIndex += 1;

    const node = {
      ...publicEv,
      scanIndex: currentScanIndex,
      type: 'ele',
      id: step.stepNumber != null ? `step-${step.stepNumber}` : `step-${currentScanIndex + 1}`,
      pid,
    };
    if (label) node.label = label;

    if (el) {
      const regionId = String(el.region_id ?? '').trim();
      const regionLabel = String(el.region_label ?? '').trim();
      if (regionId) node.regionId = regionId;
      if (regionLabel) node.regionLabel = regionLabel;
      if (isLegalRect(el.bbox)) {
        node.rect = {
          x1: Number(el.bbox.x1), y1: Number(el.bbox.y1),
          x2: Number(el.bbox.x2), y2: Number(el.bbox.y2),
        };
      } else {
        noRectControls += 1;
      }
    } else {
      noRectControls += 1;
    }

    properties.push(node);
  }

  uniquifyPropertiesNames(properties);

  return {
    properties,
    metaActions,
    absoluteFallback,
    missingOptions,
    noRectControls,
  };
}

/**
 * Build one V3 transaction entry.
 * @returns {{ entry: object, screenshots: Array, count: number, skipped: object, stats: object }}
 */
export function buildTransactionEntryV3(traj, {
  systemId,
  projectId,
  phases,
  phaseScreenshots,
  dialogScreenshots,
} = {}) {
  if (systemId == null || systemId === '' || projectId == null || projectId === '') {
    const err = new Error('systemId and projectId are required');
    err.statusCode = 400;
    throw err;
  }

  const {
    properties,
    metaActions,
    absoluteFallback,
    missingOptions,
    noRectControls,
  } = buildV3Properties({ traj, phases });

  const screenshots = buildV3Screenshots({
    traj,
    phases,
    phaseScreenshots,
    dialogScreenshots,
  });

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
    },
    screenshots,
    count: properties.length,
    skipped: { metaActions },
    stats: { absoluteFallback, missingOptions, noRectControls },
  };
}

/**
 * Single-trajectory V3 importDemand body.
 */
export function buildTransactionPayloadV3(traj, opts = {}) {
  const built = buildTransactionEntryV3(traj, opts);
  return {
    payload: {
      screenshots: built.screenshots,
      transcationEventTypeList: [built.entry],
    },
    count: built.count,
    skipped: built.skipped,
    stats: built.stats,
  };
}

/**
 * Multi-trajectory V3 importDemand body.
 */
export function wrapTransactionListV3(builtEntries = []) {
  const list = [];
  const screenshots = [];
  let count = 0;
  let metaActions = 0;
  let absoluteFallback = 0;
  let missingOptions = 0;
  let noRectControls = 0;

  for (const b of builtEntries) {
    if (!b?.entry) continue;
    list.push(b.entry);
    const tid = b.entry.transcId != null ? Number(b.entry.transcId) : null;
    for (const s of b.screenshots || []) {
      screenshots.push({
        ...s,
        trajectoryId: s.trajectoryId ?? tid,
      });
    }
    count += Number(b.count) || 0;
    metaActions += Number(b.skipped?.metaActions) || 0;
    absoluteFallback += Number(b.stats?.absoluteFallback) || 0;
    missingOptions += Number(b.stats?.missingOptions) || 0;
    noRectControls += Number(b.stats?.noRectControls) || 0;
  }

  return {
    payload: {
      screenshots,
      transcationEventTypeList: list,
    },
    count,
    skipped: { metaActions },
    stats: { absoluteFallback, missingOptions, noRectControls },
  };
}
