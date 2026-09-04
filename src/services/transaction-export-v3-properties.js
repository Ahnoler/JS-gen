/**
 * V3 partner transaction export — 控件属性构建。
 * 从 transaction-export-v3.js 拆出（行为保持重构），原路径继续作为 barrel 导出这些名字。
 */
import { mapStepToTransactionEvent } from './transaction-export.js';
import {
  isOverlayRegion,
  pageKeyFromRegionId,
  popupKeyFromRegionId,
  stripVolatileQuery,
} from './transaction-export-v3-region.js';

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
