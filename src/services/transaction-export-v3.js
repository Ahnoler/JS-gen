/**
 * V3 partner transaction export — 优化版（截图合并进 transcationProperties）。
 *
 * 相对旧 V3.0 变化：
 *   - 截图条目与控件步骤条目同构，统一进 `transcationProperties`，
 *     消费方后端只需一张表存储（用 `type` 区分：page/dialog=截图，ele=控件）。
 *   - 发给 partner 的 payload 只含 `transcationEventTypeList`（顶层无 screenshots）。
 *   - `id` 为纯数字顺序号（截图先占 1..N，控件续接 N+1..），移除 `scanIndex`。
 *   - 控件 `pid` 指向所属截图条目的数字 `id`（控件→截图关联键）。
 *   - `rect`/`label`/`regionId`/`regionLabel`/`screenshot` 统一恒有（空给 ""/{}/[]）。
 */
import { mapStepToTransactionEvent, uniquifyPropertiesNames } from './transaction-export.js';
import { MINIO_BUCKET, MINIO_PUBLIC_URL } from '../../config/config.js';

/**
 * 构建截图永久直链 URL。
 * 优先用 screenshot.image_url（上传时由 uploadScreenshot 存的 MinIO 公网直链）；
 * 若缺失（老数据），用 MINIO_PUBLIC_URL + MINIO_BUCKET + storagePath 兜底拼接。
 * 两者都拿不到时返回 null（调用方据此跳过该截图）。
 */
function resolveScreenshotUrl({ imageUrl, storagePath }) {
  if (imageUrl) return imageUrl;
  if (storagePath && MINIO_PUBLIC_URL) {
    return `${MINIO_PUBLIC_URL.replace(/\/+$/, '')}/${MINIO_BUCKET}/${storagePath}`;
  }
  return null;
}

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
 * 构建截图 properties 条目（与控件步骤条目同构，合并进 transcationProperties）。
 * 页面截图来自 phase_highlight；弹窗截图由后续开发传入 dialogScreenshots。
 *
 * 每个条目的 `screenshot` 数组含一个永久有效的直链（MinIO 公网，bucket 已设公开读策略，
 * 匿名可访问）。消费方直接用该 URL 访问图片，无需 MinIO SDK、无需自建预签名。
 * 拿不到 URL 的截图（本地暂存未上传且无公网直链兜底）会被跳过（其 id 不占号，后续顺延）。
 *
 * @returns {{ entries: Array, idByPhase: Map<number,number>, idByDialog: Map<string,number> }}
 *   entries      — 截图 properties 条目数组（同构于控件条目）
 *   idByPhase    — Map<phaseId, entryId>，供页面控件 pid 引用
 *   idByDialog   — Map<dialogKey, entryId>，供弹窗控件 pid 引用
 */
export function buildScreenshotEntries({
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

  const entries = [];
  const idByPhase = new Map();
  const idByDialog = new Map();
  let nextId = 1;

  // 弹窗截图行只有 trajectory_step_id，没有 trajectory_phase_id；
  // 通过 traj.steps 建立 stepId -> phaseId 映射，用于把弹窗挂到所属页面截图下。
  const stepPhaseById = new Map();
  for (const s of traj.steps || []) {
    if (s.id != null && s.trajectoryPhaseId != null) {
      stepPhaseById.set(Number(s.id), Number(s.trajectoryPhaseId));
    }
  }

  const phaseList = [...(phases || [])]
    .sort((a, b) => Number(a.phaseNumber ?? a.phase_number ?? 0) - Number(b.phaseNumber ?? b.phase_number ?? 0));

  for (const phase of phaseList) {
    const phaseId = Number(phase.id);
    const phaseNumber = Number(phase.phaseNumber ?? phase.phase_number ?? 0);
    const shot = shotByPhase.get(phaseId) || null;
    if (!shot) continue;
    const url = resolveScreenshotUrl(shot);
    if (!url) continue; // 本地暂存未上传且无公网直链兜底，跳过
    const desc = String(phase.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 20);
    const entryId = nextId;
    nextId += 1;
    entries.push({
      propertiesName: `页面${phaseNumber}${desc ? ` · ${desc}` : ''}`,
      eventTypeValue: 'click',
      eventTypeName: '点击',
      elementType: '',
      mothed: '',
      options: '',
      objectValue: '',
      transcationType: 'playwright',
      type: 'page',
      screenshot: [url],
      propertiesID: String(entryId),
      propertiesPID: '0',
      realLabel: '',
      regionId: '',
      regionLabel: '',
      rect: {},
    });
    idByPhase.set(phaseId, entryId);
  }

  for (const dlg of dialogScreenshots || []) {
    const meta = dlg.metadataJson || {};
    // 映射键用弹窗标题（name/dialogTitle），与 buildV3Properties 里从控件 region_id
    // 解析出的 overlay.label 对齐（控件侧只能拿到弹窗标题，拿不到完整 dialogKey）。
    const name = dlg.name || meta.dialogTitle || '';
    const url = resolveScreenshotUrl(dlg);
    if (!url) continue; // 本地暂存未上传，跳过
    const entryId = nextId;
    nextId += 1;
    const stepId = dlg.trajectoryStepId != null ? Number(dlg.trajectoryStepId) : null;
    const phaseId = stepId != null ? stepPhaseById.get(stepId) : null;
    const parentPageId = phaseId != null ? idByPhase.get(phaseId) : null;
    const rawRect = meta?.rect || dlg.rect || {};
    const dlgRect = Number.isFinite(Number(rawRect?.x1)) && Number.isFinite(Number(rawRect?.y1))
      && Number.isFinite(Number(rawRect?.x2)) && Number.isFinite(Number(rawRect?.y2))
      ? { x1: Number(rawRect.x1), y1: Number(rawRect.y1), x2: Number(rawRect.x2), y2: Number(rawRect.y2) }
      : {};
    entries.push({
      propertiesName: name || 'overlay',
      eventTypeValue: 'click',
      eventTypeName: '点击',
      elementType: '',
      mothed: '',
      options: '',
      objectValue: '',
      transcationType: 'playwright',
      type: dlg.type || 'dialog',
      screenshot: [url],
      propertiesID: String(entryId),
      propertiesPID: parentPageId != null ? String(parentPageId) : '0',
      realLabel: '',
      regionId: '',
      regionLabel: '',
      rect: dlgRect,
    });
    if (name) idByDialog.set(name, entryId);
  }

  return { entries, idByPhase, idByDialog };
}

/**
 * 构建控件步骤 properties 条目（与截图条目同构，合并进 transcationProperties）。
 * 在 V2 五个核心字段基础上，增加控件树/分层/点亮字段。
 *
 * `id` 为纯数字顺序号，续接截图条目之后（起始 id = screenshotCount + 1）。
 * `pid` 指向所属截图条目的数字 id（页面控件→idByPhase，弹窗控件→idByDialog；
 *   找不到父截图给 ""，不丢步骤）。
 * `rect`/`label`/`regionId`/`regionLabel`/`screenshot` 统一恒有（空给 {}/""/[]）。
 */
export function buildV3Properties({
  traj = {},
  phases = [],
  screenshotCount = 0,
  idByPhase,
  idByDialog,
} = {}) {
  const properties = [];
  let metaActions = 0;
  let absoluteFallback = 0;
  let missingOptions = 0;
  let noRectControls = 0;
  let nextId = Number(screenshotCount) || 0;

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
    const overlay = el ? isOverlayRegion(String(el.region_id ?? '').trim()) : null;

    // pid 指向所属截图条目的 id（字符串）：弹窗控件→弹窗截图，否则→页面截图；找不到给 "0"
    let pid = '0';
    if (overlay) {
      const title = overlay.label || 'overlay';
      const found = idByDialog?.get(title);
      pid = found != null ? String(found) : '0';
    }
    if (pid === '0' && phaseId != null) {
      const found = idByPhase?.get(phaseId);
      pid = found != null ? String(found) : '0';
    }

    const label = el ? String(el.formLabel ?? el.text ?? el.matchedLabel ?? '').trim() : '';
    nextId += 1;

    let rect = {};
    if (el) {
      if (isLegalRect(el.bbox)) {
        rect = {
          x1: Number(el.bbox.x1), y1: Number(el.bbox.y1),
          x2: Number(el.bbox.x2), y2: Number(el.bbox.y2),
        };
      } else {
        noRectControls += 1;
      }
      const node = {
        ...publicEv,
        type: 'ele',
        screenshot: [],
        propertiesID: String(nextId),
        propertiesPID: pid,
        realLabel: label,
        regionId: String(el.region_id ?? '').trim(),
        regionLabel: String(el.region_label ?? '').trim(),
        rect,
      };
      properties.push(node);
    } else {
      noRectControls += 1;
      const node = {
        ...publicEv,
        type: 'ele',
        screenshot: [],
        propertiesID: String(nextId),
        propertiesPID: pid,
        realLabel: '',
        regionId: '',
        regionLabel: '',
        rect: {},
      };
      properties.push(node);
    }
  }

  // propertiesName 去重在 buildTransactionEntryV3 合并截图+控件后统一做，
  // 这里只返回控件子集（已含 propertiesName 原值）。

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
 * 截图条目（buildScreenshotEntries）与控件条目（buildV3Properties）合并成一个
 * transcationProperties 数组：截图在前，控件在后，统一 schema。
 * @returns {{ entry: object, count: number, skipped: object, stats: object }}
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

  const { entries: screenshotEntries, idByPhase, idByDialog } = buildScreenshotEntries({
    traj,
    phases,
    phaseScreenshots,
    dialogScreenshots,
  });

  const {
    properties: controlProperties,
    metaActions,
    absoluteFallback,
    missingOptions,
    noRectControls,
  } = buildV3Properties({
    traj,
    phases,
    screenshotCount: screenshotEntries.length,
    idByPhase,
    idByDialog,
  });

  // 合并：截图在前，控件在后；一起参与 propertiesName 去重
  const properties = [...screenshotEntries, ...controlProperties];
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
    },
    count: properties.length,
    skipped: { metaActions },
    stats: { absoluteFallback, missingOptions, noRectControls },
  };
}

/**
 * Single-trajectory V3 importDemand body.
 * 发给 partner 的 payload 只含 transcationEventTypeList（截图已合并进每个 entry）。
 */
export function buildTransactionPayloadV3(traj, opts = {}) {
  const built = buildTransactionEntryV3(traj, opts);
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
 * Multi-trajectory V3 importDemand body.
 * 发给 partner 的 payload 只含 transcationEventTypeList（截图已合并进每个 entry）。
 */
export function wrapTransactionListV3(builtEntries = []) {
  const list = [];
  let count = 0;
  let metaActions = 0;
  let absoluteFallback = 0;
  let missingOptions = 0;
  let noRectControls = 0;

  for (const b of builtEntries) {
    if (!b?.entry) continue;
    list.push(b.entry);
    count += Number(b.count) || 0;
    metaActions += Number(b.skipped?.metaActions) || 0;
    absoluteFallback += Number(b.stats?.absoluteFallback) || 0;
    missingOptions += Number(b.stats?.missingOptions) || 0;
    noRectControls += Number(b.stats?.noRectControls) || 0;
  }

  return {
    payload: {
      transcationEventTypeList: list,
    },
    count,
    skipped: { metaActions },
    stats: { absoluteFallback, missingOptions, noRectControls },
  };
}
