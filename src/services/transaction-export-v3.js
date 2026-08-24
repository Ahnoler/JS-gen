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

/** 从 region_id 链提取页面 key（第一段 page:...）。 */
export function pageKeyFromRegionId(regionId) {
  const rid = String(regionId || '').trim();
  if (!rid) return '';
  const first = rid.split('|').map((s) => s.trim()).filter(Boolean)[0] || '';
  return first.startsWith('page:') ? first : '';
}

/** 从 region_id 链提取弹窗 key（前两段 page:...|dialog:...）。 */
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

/** 合法 rect 判定：四值有限且 x2>x1、y2>y1。 */
function isLegalRect(bbox) {
  return !!bbox && typeof bbox === 'object'
    && Number.isFinite(Number(bbox.x1)) && Number.isFinite(Number(bbox.y1))
    && Number.isFinite(Number(bbox.x2)) && Number.isFinite(Number(bbox.y2))
    && Number(bbox.x2) > Number(bbox.x1) && Number(bbox.y2) > Number(bbox.y1);
}

/** rect 输出序列化：非空对象 → 紧凑 JSON 字符串；空 → ""（消费方单列存储）。 */
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
 *
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
        type: levelType === 'popup' ? 'dialog' : 'page',
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
      type: dlg.type || 'dialog',
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
  let nextId = Number(screenshotCount) || 0;

  // 分区 → propertiesID/propertiesPID 父子树（partition-via-pid）。
  // 把 region_id 链里 page:/overlay: 之外的分区段编码为 type='section' 中间节点，
  // 插入 page/dialog 截图与 ele 之间；同页同分区段复用同一 section 节点。
  const sectionCache = new Map();

  // 从 region_id 链提取分区段（跳过 page: 和 overlay: 段）
  function extractPartitionSegments(regionId) {
    const rid = String(regionId || '').trim();
    if (!rid) return [];
    return rid.split('|')
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('page:') && !s.startsWith('overlay:'));
  }

  // 从分区段提取 label（"role:label" → "label"；无冒号则整段）
  function segmentLabel(seg) {
    const i = seg.indexOf(':');
    return i > 0 ? seg.slice(i + 1).trim() : seg;
  }

  // 为 step 的分区段创建/复用 section 节点，返回最近 section 的 id（无分区段返回 null）
  function ensureSectionNodes(segments, rootPid) {
    if (!segments.length) return null;
    let parentId = rootPid;
    for (let i = 0; i < segments.length; i++) {
      const key = rootPid + '|' + segments.slice(0, i + 1).join('|');
      let sectionId = sectionCache.get(key);
      if (sectionId == null) {
        nextId += 1;
        sectionId = String(nextId);
        sectionCache.set(key, sectionId);
        properties.push({
          propertiesName: segmentLabel(segments[i]),
          eventTypeValue: '', eventTypeName: '', elementType: '',
          mothed: '', options: '', objectValue: '',
          transcationType: 'playwright',
          type: 'section',
          screenshot: [],
          propertiesID: sectionId,
          propertiesPID: String(parentId),
          realLabel: segmentLabel(segments[i]),
          regionId: '', regionLabel: '',
          rect: {},
        });
      }
      parentId = sectionId;
    }
    return parentId;
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

    // 分区段 → section 节点；ele pid 指向最近 section（无分区段则用原 pid）
    const segments = extractPartitionSegments(rawRegionId);
    const sectionPid = ensureSectionNodes(segments, pid);
    const elePid = sectionPid || pid;

    nextId += 1;

    let rect = {};
    if (el) {
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
      let regionId = rawRegionId;
      if (pageKey && !regionId.startsWith(pageKey)) {
        regionId = pageKey + (regionId ? '|' + regionId : '');
      }
      const node = {
        ...publicEv,
        type: 'ele',
        screenshot: [],
        propertiesID: String(nextId),
        propertiesPID: elePid,
        realLabel: label,
        regionId,
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
        propertiesPID: elePid,
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
 * 沿 propertiesPID 链向上追溯，返回最近的 type=page/dialog 条目的 propertiesID；无则 null。
 * partition-via-pid 后 ele 的 propertiesPID 可能指向 section 中间节点，需上溯到截图条目。
 */
export function resolveRootScreenshotId(prop, propsById) {
  let cur = prop;
  let guard = 0; // 防环
  while (cur && cur.type !== 'page' && cur.type !== 'dialog' && guard < 100) {
    const pid = String(cur.propertiesPID || '0');
    if (pid === '0' || pid === '') return null;
    cur = propsById.get(pid);
    guard += 1;
  }
  return cur ? String(cur.propertiesID) : null;
}

/**
 * 页面级截图覆盖校验：每个可定位的 ele 必须能找到 type=page/dialog 的父截图条目。
 * ele 的 propertiesPID 现在可能指向 section 节点（partition-via-pid），
 * 校验沿 pid 链向上追溯（resolveRootScreenshotId）到最近的 page/dialog 截图。
 * 无可定位信息的可导出步骤（无 elementType / regionId / rect / realLabel）不作为控件参与校验，
 * 避免无 element_json 的历史可导出步骤在新链路上硬阻断整条交易。
 * @returns {{ ok: boolean, missing: Array, exempt: Array }}
 */
export function validatePageLevelCoverage(entry) {
  const props = Array.isArray(entry?.transcationProperties) ? entry.transcationProperties : [];
  const propsById = new Map(props.map((p) => [String(p.propertiesID ?? ''), p]));
  const shotIds = new Set(
    props
      .filter((p) => p.type === 'page' || p.type === 'dialog')
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
    if (p.type !== 'ele') continue;
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
 * section 节点无 elementType/screenshot 是正常的，不报 issue。
 * @returns {{ ok: boolean, missing: Array }}
 */
export function validateFieldCompleteness(entry) {
  const props = Array.isArray(entry?.transcationProperties) ? entry.transcationProperties : [];
  const missing = [];
  for (const p of props) {
    const issues = [];
    if (p.type === 'ele') {
      if (!String(p.elementType || '').trim() && !String(p.realLabel || '').trim())
        issues.push('missingElementTypeAndLabel');
      if (String(p.propertiesPID || '0') === '0')
        issues.push('orphanPid');
    }
    if (p.type === 'page' || p.type === 'dialog') {
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
 * @returns {{ value: string, truncated: boolean }}
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
 */
export function coverageBlocksPush(coverage, stats) {
  if (coverage?.ok) return false;
  return stats?.coverageMode === 'page_level';
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

  const id = traj.id != null ? String(traj.id) : '';
  const name = String(traj.name || '').trim() || `trajectory-${id}`;

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
      coverageMode: coverageModes.size === 1 ? [...coverageModes][0] : [...coverageModes].join('+'),
      coverageExemptSteps,
      missingPageLevelScreenshots,
      missingPageLevelKeys,
      fieldCompletenessIssues,
      truncatedFields,
    },
  };
}
