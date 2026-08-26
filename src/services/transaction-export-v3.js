/**
 * V3 partner transaction export — 优化版（截图合并进 transcationProperties）。
 *
 * 相对旧 V3.0 变化：
 *   - 截图条目与控件步骤条目同构，统一进 `transcationProperties`，
 *     消费方后端只需一张表存储（用 `type` 区分：page/dialog=截图，ele=控件）。
 *   - 发给 partner 的 payload 只含 `transcationEventTypeList`（顶层无 screenshots）。
 *   - `id` 为纯数字顺序号（截图先占 1..N，控件续接 N+1..），移除 `scanIndex`。
 *   - 控件 `pid` 指向所属截图条目的数字 `id`（控件→截图关联键）。
 *   - `rect` 输出为 JSON 字符串（"{"x1":..,"y1":..,"x2":..,"y2":..}"，消费方单列存储方便；空给 ""）；
 *     `label`/`regionId`/`regionLabel`/`screenshot` 统一恒有（空给 ""/[]）。
 */
import { mapStepToTransactionEvent, uniquifyPropertiesNames } from './transaction-export.js';
import { sanitizeTranscationName } from './transaction-name.js';
import { MINIO_BUCKET, MINIO_PUBLIC_URL } from '../../config/config.js';

/**
 * 构建截图永久直链 URL。
 * 优先用 screenshot.image_url（上传时由 uploadScreenshot 存的 MinIO 公网直链）；
 * 若缺失（老数据），用 MINIO_PUBLIC_URL + MINIO_BUCKET + storagePath 兜底拼接。
 * 两者都拿不到时返回 null（调用方据此跳过该截图）。
 * @param {object} opts 选项
 * @param {string|null} [opts.imageUrl] 公网直链
 * @param {string|null} [opts.storagePath] MinIO 存储路径
 * @returns {string|null} 永久直链 URL 或 null
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

/**
 * 将控件 action_type 映射为同事格式的 {command, action} 对象。
 * @param {string} actionType - 原始 action 类型
 * @returns {{command: string, action: string}} 映射后的同事格式对象
 */
export function mapControlAction(actionType) {
  const m = ACTION_MAP[actionType];
  return m ? { command: m[0], action: m[1] } : { command: actionType || '', action: actionType || '' };
}

/**
 * 将控件 target_kind 映射为同事格式的 kind。
 * @param {string} targetKind - 原始 target kind
 * @returns {string} 映射后的同事格式 kind
 */
export function mapControlKind(targetKind) {
  return KIND_MAP[targetKind] || targetKind || '';
}

/** region_id 分层链（'|' 分段，role:label）中含 overlay 段 → 返回该段；否则 null。 */
/**
 * 检查 region_id 分层链中是否包含 overlay 段。
 * @param {string} regionId - region_id 字符串
 * @returns {{role: string, label: string}|null} 如果包含 overlay 段则返回 {role: 'overlay', label: '...'}，否则返回 null
 */
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

/** 从 region_id 链提取页面 key（第一段 page:...）。 */
/**
 * 从 region_id 链中提取页面 key（第一段 page:...）。
 * @param {string} regionId - region_id 字符串
 * @returns {string} 提取的页面 key，如果没有则返回空字符串
 */
export function pageKeyFromRegionId(regionId) {
  const rid = String(regionId || '').trim();
  if (!rid) return '';
  const first = rid.split('|').map((s) => s.trim()).filter(Boolean)[0] || '';
  return first.startsWith('page:') ? first : '';
}

/** 从 region_id 链提取弹窗 key（前两段 page:...|dialog:...）。 */
/**
 * 从 region_id 链中提取弹窗 key（前两段 page:...|dialog:...）。
 * @param {string} regionId - region_id 字符串
 * @returns {string} 提取的弹窗 key，如果没有则返回空字符串
 */
export function popupKeyFromRegionId(regionId) {
  const rid = String(regionId || '').trim();
  if (!rid) return '';
  const segs = rid.split('|').map((s) => s.trim()).filter(Boolean);
  if (segs.length < 2 || !segs[0].startsWith('page:') || !segs[1].startsWith('dialog:')) return '';
  return `${segs[0]}|${segs[1]}`;
}

/**
 * 剥掉页面级 key 中 hash 内的易变 query（`#/route?x=1` → `#/route`，截到下一个 `|` 段边界）。
 * 存量数据在 2026-08-20 修复前把 in-fragment query 写进了 level_key / region_id page 前缀，
 * 导出侧用规范化 key 兜底匹配，让新旧两代 key 互相对齐。
 */
/**
 * 剥掉页面级 key 中 hash 内的易变 query（`#/route?x=1` → `#/route`，截到下一个 `|` 段边界）。
 * 用于规范化 key 以兼容新旧两代数据。
 * @param {string} key - 原始 key
 * @returns {string} 规范化后的 key
 */
export function stripVolatileQuery(key) {
  const s = String(key || '');
  const h = s.indexOf('#');
  if (h < 0) return s;
  const rest = s.slice(h + 1);
  const q = rest.indexOf('?');
  if (q < 0) return s;
  const afterQ = rest.slice(q);
  const bar = afterQ.indexOf('|');
  return s.slice(0, h + 1) + rest.slice(0, q) + (bar < 0 ? '' : afterQ.slice(bar));
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

/**
 * 合法 rect 判定：四值有限且 x2>x1、y2>y1。
 * @param {object|null|undefined} bbox rect 对象
 * @returns {boolean} 是否为合法 rect
 */
function isLegalRect(bbox) {
  return !!bbox && typeof bbox === 'object'
    && Number.isFinite(Number(bbox.x1)) && Number.isFinite(Number(bbox.y1))
    && Number.isFinite(Number(bbox.x2)) && Number.isFinite(Number(bbox.y2))
    && Number(bbox.x2) > Number(bbox.x1) && Number(bbox.y2) > Number(bbox.y1);
}

/**
 * rect 输出序列化：非空对象 → 紧凑 JSON 字符串；空 → ""（消费方单列存储）。
 * @param {object|null|undefined} rect rect 对象
 * @returns {string} 序列化后的 rect 字符串
 */
function rectToString(rect) {
  return rect && typeof rect === 'object' && Object.keys(rect).length > 0
    ? JSON.stringify(rect)
    : '';
}

/**
 * 构建截图 properties 条目（与控件步骤条目同构，合并进 transcationProperties）。
 * 优先使用页面级截图（kind='page_level'）；未重录数据回退 phase_highlight +
 * dialogScreenshots 旧链路。
 *
 * 每个条目的 `screenshot` 数组含一个永久有效的直链（MinIO 公网，bucket 已设公开读策略，
 * 匿名可访问）。消费方直接用该 URL 访问图片，无需 MinIO SDK、无需自建预签名。
 * 拿不到 URL 的截图（本地暂存未上传且无公网直链兜底）会被跳过（其 id 不占号，后续顺延）。
 * @param {object} [opts] - 配置选项
 * @param {object} [opts.traj] - 轨迹对象
 * @param {Array} [opts.phases] - 阶段数组
 * @param {Array} [opts.phaseScreenshots] - 阶段截图数组
 * @param {Array} [opts.dialogScreenshots] - 弹窗截图数组
 * @param {Array} [opts.pageLevelScreenshots] - 页面级截图数组
 * @returns {{ entries: Array, idByPhase: Map<number,number>, idByDialog: Map<string,number>, idByPageLevel: Map<string,number>, idByPageLevelNorm: Map<string,number>, pageLevelById: Map<string,object> }}
 *   entries           — 截图 properties 条目数组（同构于控件条目）
 *   idByPhase         — 旧链路 phaseId → entryId
 *   idByDialog        — dialog 标题（含页面作用域 key）→ entryId
 *   idByPageLevel     — pageKey/popupKey → entryId
 *   idByPageLevelNorm — 规范化（剥 hash 内易变 query）pageKey/popupKey → entryId
 *   pageLevelById     — entryId → 截图条目（弹窗 rect 换算用）
 */
export function buildScreenshotEntries({
  traj = {},
  phases = [],
  phaseScreenshots = [],
  dialogScreenshots = [],
  pageLevelScreenshots = [],
} = {}) {
  const entries = [];
  const idByPhase = new Map();
  const idByDialog = new Map();
  const idByPageLevel = new Map();
  const idByPageLevelNorm = new Map();
  const pageLevelById = new Map();
  let nextId = 1;

  const rememberPageLevelKey = (levelKey, entryId) => {
    idByPageLevel.set(levelKey, entryId);
    const norm = stripVolatileQuery(levelKey);
    if (norm && !idByPageLevelNorm.has(norm)) idByPageLevelNorm.set(norm, entryId);
  };

  const pageLevels = Array.isArray(pageLevelScreenshots) ? pageLevelScreenshots : [];
  if (pageLevels.length) {
    // 新链路：页面级截图（kind='page_level'）。一个 page/popup 一个条目。
    for (const shot of pageLevels) {
      const url = resolveScreenshotUrl(shot);
      if (!url) continue; // 本地暂存未上传，跳过
      const meta = shot.metadataJson || {};
      const levelType = shot.levelType === 'popup' ? 'popup' : 'page';
      const levelKey = String(shot.levelKey || meta.levelKey || '').trim();
      if (!levelKey) continue;
      const parentKey = String(shot.parentLevelKey || meta.parentLevelKey || '').trim();
      const entryId = nextId;
      nextId += 1;
      const rawRect = levelType === 'popup'
        ? (meta.popupRect || meta.rect || shot.rect || {})
        : {};
      const rect = isLegalRect(rawRect)
        ? {
            x1: Number(rawRect.x1),
            y1: Number(rawRect.y1),
            x2: Number(rawRect.x2),
            y2: Number(rawRect.y2),
          }
        : {};
      const parentId = parentKey ? idByPageLevel.get(parentKey) : null;
      const entry = {
        propertiesName: String(meta.displayName || shot.name || (levelType === 'popup' ? '弹窗' : '页面')).trim(),
        eventTypeValue: 'click',
        eventTypeName: '点击',
        elementType: '',
        mothed: '',
        options: '',
        objectValue: '',
        transcationType: 'playwright',
        type: levelType === 'popup' ? 'popup' : 'page',
        screenshot: [url],
        propertiesID: String(entryId),
        propertiesPID: parentId != null ? String(parentId) : '0',
        realLabel: '',
        regionId: levelKey,
        regionLabel: String(meta.displayName || shot.name || '').trim(),
        rect,
      };
      entries.push(entry);
      rememberPageLevelKey(levelKey, entryId);
      pageLevelById.set(String(entryId), entry);
      if (levelType === 'popup') {
        const title = String(meta.dialogTitle || shot.name || '').trim();
        if (title) {
          const scopedTitleKey = parentKey ? `${parentKey}|dialog:${title}` : `dialog:${title}`;
          idByDialog.set(scopedTitleKey, entryId);
          if (!idByDialog.has(title)) idByDialog.set(title, entryId);
        }
      }
    }
    return { entries, idByPhase, idByDialog, idByPageLevel, idByPageLevelNorm, pageLevelById, usedPageLevelScreenshots: true };
  }

  // 旧链路（phase_highlight + 步骤弹窗截图）保留，兼容未重录数据。
  const shotByPhase = new Map();
  for (const s of phaseScreenshots || []) {
    if (s?.trajectoryPhaseId != null && !shotByPhase.has(Number(s.trajectoryPhaseId))) {
      shotByPhase.set(Number(s.trajectoryPhaseId), s);
    }
  }

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
    if (!url) continue;
    const desc = String(phase.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 20);
    const entryId = nextId;
    nextId += 1;
    const entry = {
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
    };
    entries.push(entry);
    pageLevelById.set(String(entryId), entry);
    idByPhase.set(phaseId, entryId);
  }

  for (const dlg of dialogScreenshots || []) {
    const meta = dlg.metadataJson || {};
    const name = dlg.name || meta.dialogTitle || '';
    const url = resolveScreenshotUrl(dlg);
    if (!url) continue;
    const entryId = nextId;
    nextId += 1;
    const stepId = dlg.trajectoryStepId != null ? Number(dlg.trajectoryStepId) : null;
    const phaseId = stepId != null ? stepPhaseById.get(stepId) : null;
    const parentPageId = phaseId != null ? idByPhase.get(phaseId) : null;
    const rawRect = meta?.rect || dlg.rect || {};
    const rect = isLegalRect(rawRect)
      ? {
          x1: Number(rawRect.x1),
          y1: Number(rawRect.y1),
          x2: Number(rawRect.x2),
          y2: Number(rawRect.y2),
        }
      : {};
    const entry = {
      propertiesName: name || 'overlay',
      eventTypeValue: 'click',
      eventTypeName: '点击',
      elementType: '',
      mothed: '',
      options: '',
      objectValue: '',
      transcationType: 'playwright',
      type: dlg.type || 'popup',
      screenshot: [url],
      propertiesID: String(entryId),
      propertiesPID: parentPageId != null ? String(parentPageId) : '0',
      realLabel: '',
      regionId: '',
      regionLabel: '',
      rect,
    };
    entries.push(entry);
    pageLevelById.set(String(entryId), entry);
    if (name) idByDialog.set(name, entryId);
  }

  return { entries, idByPhase, idByDialog, idByPageLevel, idByPageLevelNorm, pageLevelById, usedPageLevelScreenshots: false };
}

/**
 * 构建控件步骤 properties 条目（与截图条目同构，合并进 transcationProperties）。
 * 在 V2 五个核心字段基础上，增加控件树/分层/点亮字段。
 *
 * `id` 为纯数字顺序号，续接截图条目之后（起始 id = screenshotCount + 1）。
 * `pid` 指向所属截图条目的数字 id（页面控件→idByPhase，弹窗控件→idByDialog；
 *   找不到父截图给 ""，不丢步骤）。
 * `rect` 构建期为对象（弹窗坐标换算需要），由 buildTransactionEntryV3 合并后统一序列化为
 * JSON 字符串（空给 ""）；`label`/`regionId`/`regionLabel`/`screenshot` 统一恒有（空给 ""/[]）。
 * @param {object} [opts] - 配置选项
 * @param {object} [opts.traj] - 轨迹对象
 * @param {Array} [opts.phases] - 阶段数组
 * @param {number} [opts.screenshotCount] - 截图数量，用于计算控件 id 起始值
 * @param {Map<number,number>} [opts.idByPhase] - 旧链路 phaseId → entryId 映射
 * @param {Map<string,number>} [opts.idByDialog] - dialog 标题 → entryId 映射
 * @param {Map<string,number>} [opts.idByPageLevel] - pageKey/popupKey → entryId 映射
 * @param {Map<string,number>} [opts.idByPageLevelNorm] - 规范化 pageKey/popupKey → entryId 映射
 * @param {Map<string,object>} [opts.pageLevelById] - entryId → 截图条目映射
 * @returns {{properties: Array, metaActions: number, absoluteFallback: number, missingOptions: number, noRectControls: number, normalizedRects: number}}
 *   properties - 控件 properties 数组
 *   metaActions - 元操作计数
 *   absoluteFallback - 绝对回退计数
 *   missingOptions - 缺少选项计数
 *   noRectControls - 无 rect 控件计数
 *   normalizedRects - 归一化 rect 计数
 */
export function buildV3Properties({
  traj = {},
  phases = [],
  screenshotCount = 0,
  idByPhase,
  idByDialog,
  idByPageLevel,
  idByPageLevelNorm,
  pageLevelById,
} = {}) {
  const properties = [];
  let metaActions = 0;
  let absoluteFallback = 0;
  let missingOptions = 0;
  let noRectControls = 0;
  let normalizedRects = 0;
  let nextId = Number(screenshotCount) || 0;

  // 分区 → propertiesID/propertiesPID 父子树（partition-via-pid）。
  // 把 region_id 链里 page:/overlay: 之外的分区段编码为 type 按 §8 映射的中间节点，
  // 插入 page/popup 截图与 object 之间；同页同分区段复用同一节点。
  const sectionCache = new Map();

  // §8 层级类型映射：region_id 段的 role → V3 type 值。
  // 不在此列的 role 按 §8 归 section（区块）；collapse 显式独立（录制插件格式对齐）。
  const REGION_ROLE_TO_TYPE = {
    tab: 'tab',
    wizard: 'wizard',
    card: 'card',
    collapse: 'collapse',
    section: 'section',
    titlebox: 'section',
    table: 'section',
    todo: 'section',
    // dialog/overlay 段映射为 popup（截图条目侧已统一 popup）
    dialog: 'popup',
    overlay: 'popup',
  };
  // 结构性 role：不单独建节点，ele pid 直接跳过该段沿用上层 id（用户决策：main 归 page 级）
  const SKIP_SECTION_ROLES = new Set(['main', 'shell-header', 'shell-aside', 'other']);

  // 从 region_id 链提取分区段（跳过 page: 和 overlay: 段）
  function extractPartitionSegments(regionId) {
    const rid = String(regionId || '').trim();
    if (!rid) return [];
    return rid.split('|')
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('page:') && !s.startsWith('overlay:'));
  }

  // 从分区段提取 role（"role:label" → "role"；无冒号则整段作 role）
  function segmentRole(seg) {
    const i = seg.indexOf(':');
    return i > 0 ? seg.slice(0, i).trim() : seg;
  }
  // 从分区段提取 label（"role:label" → "label"；无冒号则整段）
  function segmentLabel(seg) {
    const i = seg.indexOf(':');
    return i > 0 ? seg.slice(i + 1).trim() : seg;
  }

  // 为 step 的分区段创建/复用中间节点，返回最近节点的 id（无分区段或全被跳过返回 null）
  // role 按 §8 映射 type；SKIP_SECTION_ROLES 的段跳过（不建节点，parentId 不变）
  function ensureSectionNodes(segments, rootPid) {
    if (!segments.length) return null;
    let parentId = rootPid;
    let lastCreatedId = null;
    for (let i = 0; i < segments.length; i++) {
      const role = segmentRole(segments[i]);
      if (SKIP_SECTION_ROLES.has(role)) continue;
      const key = rootPid + '|' + segments.slice(0, i + 1).join('|');
      let sectionId = sectionCache.get(key);
      if (sectionId == null) {
        nextId += 1;
        sectionId = String(nextId);
        sectionCache.set(key, sectionId);
        const segType = REGION_ROLE_TO_TYPE[role] || 'section';
        properties.push({
          propertiesName: segmentLabel(segments[i]),
          eventTypeValue: '', eventTypeName: '', elementType: '',
          mothed: '', options: '', objectValue: '',
          transcationType: 'playwright',
          type: segType,
          screenshot: [],
          propertiesID: sectionId,
          propertiesPID: String(parentId),
          realLabel: segmentLabel(segments[i]),
          regionId: '', regionLabel: '',
          rect: {},
        });
      }
      parentId = sectionId;
      lastCreatedId = sectionId;
    }
    return lastCreatedId;
  }

  const phaseById = new Map();
  for (const p of phases || []) {
    phaseById.set(Number(p.id), p);
  }
  // 页面上下文：步骤无页面锚点（人工/抓取步骤，region 常为 table 等区域标记）时，
  // 继承前序最近步骤所在页面 —— 步骤按执行顺序流转，操作发生在该页面，归属同一页面截图
  let lastPageKey = '';
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
    const rawRegionId = el ? String(el.region_id ?? '').trim() : '';
    const overlay = isOverlayRegion(rawRegionId);

    let pageKey = el
      ? String(el.page_level_key || el.pageLevelKey || pageKeyFromRegionId(rawRegionId)).trim()
      : '';
    if (!pageKey) pageKey = lastPageKey;
    if (pageKey) lastPageKey = pageKey;
    const popupKey = el
      ? String(el.popup_level_key || el.popupLevelKey || popupKeyFromRegionId(rawRegionId)).trim()
      : '';

    // pid 指向所属截图条目的 id（字符串）：弹窗控件→弹窗截图，否则→页面截图；找不到给 "0"
    // 精确 key 未命中时用规范化 key（剥 hash 内易变 query）兜底，对齐存量两代数据
    let pid = '0';
    if (popupKey && idByPageLevel?.has(popupKey)) {
      pid = String(idByPageLevel.get(popupKey));
    }
    if (pid === '0' && popupKey) {
      const normPopup = idByPageLevelNorm?.get(stripVolatileQuery(popupKey));
      if (normPopup != null) pid = String(normPopup);
    }
    if (pid === '0' && overlay) {
      const title = overlay.label || 'overlay';
      const scopedTitleKey = pageKey ? `${pageKey}|dialog:${title}` : '';
      const found = (scopedTitleKey && idByDialog?.get(scopedTitleKey))
        || idByDialog?.get(title);
      pid = found != null ? String(found) : '0';
    }
    if (pid === '0' && pageKey && idByPageLevel?.has(pageKey)) {
      pid = String(idByPageLevel.get(pageKey));
    }
    if (pid === '0' && pageKey) {
      const normPage = idByPageLevelNorm?.get(stripVolatileQuery(pageKey));
      if (normPage != null) pid = String(normPage);
    }
    if (pid === '0' && phaseId != null) {
      const found = idByPhase?.get(phaseId);
      pid = found != null ? String(found) : '0';
    }

    const label = el ? String(el.formLabel ?? el.text ?? el.matchedLabel ?? '').trim() : '';

    // 分区段 → 中间节点（§8 type 按 role 映射）；object pid 指向最近中间节点（无分区段则用原 pid）
    const segments = extractPartitionSegments(rawRegionId);
    const sectionPid = ensureSectionNodes(segments, pid);
    const elePid = sectionPid || pid;

    nextId += 1;

    let rect = {};
    if (el) {
      // 归一化坐标优先：录制侧已在 element_json 写入 rect_norm {x1,y1,x2,y2}（0~1，相对所属截图）。
      // 直出归一化 rect，不做弹窗减法（rect_norm 已相对弹窗截图），不 clamp 原值透传。
      const rn = el.rect_norm;
      const isNorm = isLegalRect(rn)
        && [rn.x1, rn.y1, rn.x2, rn.y2].every((v) => Number(v) >= -0.001 && Number(v) <= 1.0001);
      if (isNorm) {
        rect = {
          x1: Number(rn.x1), y1: Number(rn.y1),
          x2: Number(rn.x2), y2: Number(rn.y2),
        };
        normalizedRects += 1;
      } else {
        // 页面级截图使用 document 坐标；新录制有 page_bbox 时优先用它，旧数据回退 bbox
        const usePageCoords = !!(idByPageLevel && idByPageLevel.size > 0);
        const sourceBBox = usePageCoords && el.page_bbox && isLegalRect(el.page_bbox)
          ? el.page_bbox
          : el.bbox;
        if (isLegalRect(sourceBBox)) {
          rect = {
            x1: Number(sourceBBox.x1), y1: Number(sourceBBox.y1),
            x2: Number(sourceBBox.x2), y2: Number(sourceBBox.y2),
          };
          // 弹窗控件 bbox 是页面长图坐标；V3 要求相对弹窗截图，减去弹窗在页面上的 rect
          if (popupKey) {
            const dialogEntry = pageLevelById?.get(pid);
            const popupRect = dialogEntry?.rect;
            if (isLegalRect(popupRect)) {
              rect = {
                x1: rect.x1 - Number(popupRect.x1),
                y1: rect.y1 - Number(popupRect.y1),
                x2: rect.x2 - Number(popupRect.x1),
                y2: rect.y2 - Number(popupRect.y1),
              };
            }
          }
        } else {
          noRectControls += 1;
        }
      }
      let regionId = rawRegionId;
      if (pageKey && !regionId.startsWith(pageKey)) {
        regionId = pageKey + (regionId ? '|' + regionId : '');
      }
      const node = {
        ...publicEv,
        type: 'object',
        screenshot: [],
        propertiesID: String(nextId),
        propertiesPID: elePid,
        realLabel: label,
        regionId,
        regionLabel: String(el.region_label ?? '').trim(),
        rect,
        attr: el.attr && typeof el.attr === 'object'
          ? {
              disabled: el.attr.disabled === true,
              required: el.attr.required === true,
              readonly: el.attr.readonly === true,
            }
          : {},
      };
      properties.push(node);
    } else {
      noRectControls += 1;
      const node = {
        ...publicEv,
        type: 'object',
        screenshot: [],
        propertiesID: String(nextId),
        propertiesPID: elePid,
        realLabel: '',
        regionId: '',
        regionLabel: '',
        rect: {},
        attr: {},
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
    normalizedRects,
  };
}

/**
 * 沿 propertiesPID 链向上追溯，返回最近的 type=page/popup 条目的 propertiesID；无则 null。
 * partition-via-pid 后 object 的 propertiesPID 可能指向中间节点（section/tab/wizard/card），需上溯到截图条目。
 * @param {object} prop - properties 对象
 * @param {Map<string,object>} propsById - propertiesID 到 properties 对象的映射
 * @returns {string|null} 最近的 page/popup 条目的 propertiesID，如果没有则返回 null
 */
export function resolveRootScreenshotId(prop, propsById) {
  let cur = prop;
  let guard = 0; // 防环
  while (cur && cur.type !== 'page' && cur.type !== 'popup' && guard < 100) {
    const pid = String(cur.propertiesPID || '0');
    if (pid === '0' || pid === '') return null;
    cur = propsById.get(pid);
    guard += 1;
  }
  return cur ? String(cur.propertiesID) : null;
}

/**
 * 页面级截图覆盖校验：每个可定位的 object 必须能找到 type=page/popup 的父截图条目。
 * object 的 propertiesPID 现在可能指向中间节点（partition-via-pid），
 * 校验沿 pid 链向上追溯（resolveRootScreenshotId）到最近的 page/popup 截图。
 * 无可定位信息的可导出步骤（无 elementType / regionId / rect / realLabel）不作为控件参与校验，
 * 避免无 element_json 的历史可导出步骤在新链路上硬阻断整条交易。
 * @param {object} entry - 交易条目对象
 * @returns {{ ok: boolean, missing: Array, exempt: Array }}
 *   ok - 是否所有可定位 object 都有父截图
 *   missing - 缺少父截图的可定位 object 列表
 *   exempt - 被豁免的可导出步骤列表（无可定位信息）
 */
export function validatePageLevelCoverage(entry) {
  const props = Array.isArray(entry?.transcationProperties) ? entry.transcationProperties : [];
  const propsById = new Map(props.map((p) => [String(p.propertiesID ?? ''), p]));
  const shotIds = new Set(
    props
      .filter((p) => p.type === 'page' || p.type === 'popup')
      .map((p) => String(p.propertiesID ?? '')),
  );
  const missing = [];
  const exempt = [];
  // rect 在 payload 中为 JSON 字符串（空 ""）；构建期/手搓 entry 仍可能是对象，两种形式都认
  const hasRect = (p) => (typeof p.rect === 'string'
    ? p.rect.trim() !== ''
    : !!(p.rect && Object.keys(p.rect).length > 0));
  const isLocatable = (p) => !!(
    String(p.elementType || '').trim()
    || String(p.regionId || '').trim()
    || hasRect(p)
    || String(p.realLabel || '').trim()
  );
  for (const p of props) {
    if (p.type !== 'object') continue;
    if (!isLocatable(p)) {
      exempt.push({
        propertiesID: p.propertiesID || '',
        propertiesPID: p.propertiesPID || '0',
        propertiesName: p.propertiesName || '',
      });
      continue;
    }
    const rootId = resolveRootScreenshotId(p, propsById);
    if (!rootId || !shotIds.has(rootId)) {
      missing.push({
        propertiesID: p.propertiesID || '',
        propertiesPID: p.propertiesPID || '0',
        propertiesName: p.propertiesName || '',
        regionId: p.regionId || '',
      });
    }
  }
  return { ok: missing.length === 0, missing, exempt };
}

/**
 * 字段完整性校验：统计缺失字段，不阻断推送。
 * 中间节点（section/tab/wizard/card）无 elementType/screenshot 是正常的，不报 issue。
 * @param {object} entry - 交易条目对象
 * @returns {{ ok: boolean, missing: Array }}
 *   ok - 是否所有字段都完整
 *   missing - 缺失字段的 object 列表
 */
export function validateFieldCompleteness(entry) {
  const props = Array.isArray(entry?.transcationProperties) ? entry.transcationProperties : [];
  const missing = [];
  for (const p of props) {
    const issues = [];
    if (p.type === 'object') {
      if (!String(p.elementType || '').trim() && !String(p.realLabel || '').trim())
        issues.push('missingElementTypeAndLabel');
      if (String(p.propertiesPID || '0') === '0')
        issues.push('orphanPid');
    }
    if (p.type === 'page' || p.type === 'popup') {
      const shots = Array.isArray(p.screenshot) ? p.screenshot : [];
      if (shots.length === 0) issues.push('emptyScreenshot');
    }
    if (!String(p.propertiesName || '').trim()) issues.push('emptyName');
    if (issues.length) missing.push({ propertiesID: p.propertiesID || '', type: p.type || '', issues });
  }
  return { ok: missing.length === 0, missing };
}

/** 超长字段截断上限（消费方单列存储长度约束）；未列字段不截断。 */
const FIELD_LENGTH_LIMITS = Object.freeze({
  elementType: 2000,
  options: 4000,
  objectValue: 500,
  propertiesName: 100,
});
const truncatedSuffix = '...truncated';

/**
 * 超长字符串截断：超过 limit 时截到 limit 长度并补 truncatedSuffix（仅统计不阻断）。
 * @param {string} field - 字段名称
 * @param {string} value - 原始值
 * @returns {{ value: string, truncated: boolean }}
 *   value - 截断后的值
 *   truncated - 是否被截断
 */
function truncateFieldValue(field, value) {
  const limit = FIELD_LENGTH_LIMITS[field];
  if (!limit || typeof value !== 'string') return { value, truncated: false };
  if (value.length <= limit) return { value, truncated: false };
  return { value: value.slice(0, limit - truncatedSuffix.length) + truncatedSuffix, truncated: true };
}

/**
 * 覆盖缺失是否阻断推送：仅 page_level 模式（新录制，830 需求适用对象）强校验；
 * legacy_phase_fallback（存量旧数据，无法不重录补页面级截图）降级为告警——
 * 缺失数/键仍进 stats（missingPageLevelScreenshots / missingPageLevelKeys）供消费方识别风险。
 * @param {{ok: boolean}} coverage - 覆盖校验结果
 * @param {object} stats - 统计信息
 * @returns {boolean} 是否阻断推送
 */
export function coverageBlocksPush(coverage, stats) {
  if (coverage?.ok) return false;
  return stats?.coverageMode === 'page_level';
}

/**
 * Build one V3 transaction entry.
 * 截图条目（buildScreenshotEntries）与控件条目（buildV3Properties）合并成一个
 * transcationProperties 数组：截图在前，控件在后，统一 schema。
 * @param {object} traj - 轨迹对象
 * @param {object} [opts] - 配置选项
 * @param {string} [opts.systemId] - 系统ID
 * @param {string} [opts.projectId] - 项目ID
 * @param {Array} [opts.phases] - 阶段数组
 * @param {Array} [opts.phaseScreenshots] - 阶段截图数组
 * @param {Array} [opts.dialogScreenshots] - 弹窗截图数组
 * @param {Array} [opts.pageLevelScreenshots] - 页面级截图数组
 * @returns {{ entry: object, count: number, skipped: object, stats: object }}
 *   entry - V3 交易条目
 *   count - properties 数量
 *   skipped - 跳过的元操作统计
 *   stats - 详细统计信息
 */
export function buildTransactionEntryV3(traj, {
  systemId,
  projectId,
  phases,
  phaseScreenshots,
  dialogScreenshots,
  pageLevelScreenshots,
} = {}) {
  if (systemId == null || systemId === '' || projectId == null || projectId === '') {
    const err = new Error('systemId and projectId are required');
    err.statusCode = 400;
    throw err;
  }

  const {
    entries: screenshotEntries,
    idByPhase,
    idByDialog,
    idByPageLevel,
    idByPageLevelNorm,
    pageLevelById,
    usedPageLevelScreenshots,
  } = buildScreenshotEntries({
    traj,
    phases,
    phaseScreenshots,
    dialogScreenshots,
    pageLevelScreenshots,
  });

  const {
    properties: controlProperties,
    metaActions,
    absoluteFallback,
    missingOptions,
    noRectControls,
    normalizedRects,
  } = buildV3Properties({
    traj,
    phases,
    screenshotCount: screenshotEntries.length,
    idByPhase,
    idByDialog,
    idByPageLevel,
    idByPageLevelNorm,
    pageLevelById,
  });

  // 合并：截图在前，控件在后；rect 统一序列化为 JSON 字符串（空给 ""）；一起参与 propertiesName 去重
  const properties = [...screenshotEntries, ...controlProperties];
  for (const p of properties) {
    p.rect = rectToString(p.rect);
  }
  // 超长字段截断：合并后、uniquifyPropertiesNames 之前应用（只统计不阻断，截断数进 stats）
  const truncatedCounts = { elementType: 0, options: 0, objectValue: 0, propertiesName: 0 };
  for (const p of properties) {
    for (const field of Object.keys(FIELD_LENGTH_LIMITS)) {
      if (p[field] != null) {
        const { value, truncated } = truncateFieldValue(field, String(p[field]));
        if (truncated) truncatedCounts[field] += 1;
        p[field] = value;
      }
    }
  }
  uniquifyPropertiesNames(properties);
  // Partner 将每个 properties 条目作为业务对象校验名称：propertiesName 同样禁止
  // \\ / : * ? " < > | '（V2 已有同规则——transaction-export.js:85；V3 此前遗漏，
  // 如「法定代表人/负责人信息」触发“业务对象名称不能包含 \ / : * ? \" < > | '”）。
  for (const p of properties) {
    if (p && p.propertiesName != null) {
      p.propertiesName = sanitizeTranscationName(String(p.propertiesName));
    }
  }

  const id = traj.id != null ? String(traj.id) : '';
  const name = sanitizeTranscationName(String(traj.name || '').trim()) || (`trajectory-${id}`);

  const entry = {
    transcId: id,
    transcationName: name,
    systemId: String(systemId),
    projectId: String(projectId),
    transcationType: 'web',
    testFrame: 'playwright',
    transcationProperties: properties,
  };
  const coverage = validatePageLevelCoverage(entry);
  const completeness = validateFieldCompleteness(entry);
  return {
    entry,
    count: properties.length,
    skipped: { metaActions },
    stats: {
      absoluteFallback,
      missingOptions,
      noRectControls,
      normalizedRects,
      coverageMode: usedPageLevelScreenshots ? 'page_level' : 'legacy_phase_fallback',
      coverageExemptSteps: coverage.exempt.length,
      missingPageLevelScreenshots: coverage.missing.length,
      missingPageLevelKeys: coverage.missing.map((m) => m.regionId || m.propertiesPID).filter(Boolean),
      fieldCompletenessIssues: completeness.missing.length,
      truncatedFields: truncatedCounts,
    },
  };
}

/**
 * Single-trajectory V3 importDemand body.
 * 发给 partner 的 payload 只含 transcationEventTypeList（截图已合并进每个 entry）。
 * @param {object} traj - 轨迹对象
 * @param {object} [opts] - 配置选项
 * @returns {{payload: object, count: number, skipped: object, stats: object}}
 *   payload - V3 importDemand payload
 *   count - properties 数量
 *   skipped - 跳过的元操作统计
 *   stats - 详细统计信息
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
 * @param {Array} [builtEntries] - 已构建的 V3 条目数组
 * @returns {{payload: object, count: number, skipped: object, stats: object}}
 *   payload - V3 importDemand payload
 *   count - 总 properties 数量
 *   skipped - 总跳过的元操作统计
 *   stats - 总详细统计信息
 */
export function wrapTransactionListV3(builtEntries = []) {
  const list = [];
  let count = 0;
  let metaActions = 0;
  let absoluteFallback = 0;
  let missingOptions = 0;
  let noRectControls = 0;
  let normalizedRects = 0;
  let missingPageLevelScreenshots = 0;
  let coverageExemptSteps = 0;
  let fieldCompletenessIssues = 0;
  const truncatedFields = { elementType: 0, options: 0, objectValue: 0, propertiesName: 0 };
  const missingPageLevelKeys = [];
  const coverageModes = new Set();

  for (const b of builtEntries) {
    if (!b?.entry) continue;
    list.push(b.entry);
    count += Number(b.count) || 0;
    metaActions += Number(b.skipped?.metaActions) || 0;
    absoluteFallback += Number(b.stats?.absoluteFallback) || 0;
    missingOptions += Number(b.stats?.missingOptions) || 0;
    noRectControls += Number(b.stats?.noRectControls) || 0;
    normalizedRects += Number(b.stats?.normalizedRects) || 0;
    missingPageLevelScreenshots += Number(b.stats?.missingPageLevelScreenshots) || 0;
    coverageExemptSteps += Number(b.stats?.coverageExemptSteps) || 0;
    fieldCompletenessIssues += Number(b.stats?.fieldCompletenessIssues) || 0;
    for (const k of Object.keys(truncatedFields)) {
      truncatedFields[k] += Number(b.stats?.truncatedFields?.[k]) || 0;
    }
    if (b.stats?.coverageMode) coverageModes.add(b.stats.coverageMode);
    for (const key of b.stats?.missingPageLevelKeys || []) {
      if (key && !missingPageLevelKeys.includes(key)) missingPageLevelKeys.push(key);
    }
  }

  return {
    payload: {
      transcationEventTypeList: list,
    },
    count,
    skipped: { metaActions },
    stats: {
      absoluteFallback,
      missingOptions,
      noRectControls,
      normalizedRects,
      coverageMode: coverageModes.size === 1 ? [...coverageModes][0] : [...coverageModes].join('+'),
      coverageExemptSteps,
      missingPageLevelScreenshots,
      missingPageLevelKeys,
      fieldCompletenessIssues,
      truncatedFields,
    },
  };
}
