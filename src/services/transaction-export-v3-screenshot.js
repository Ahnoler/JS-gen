/**
 * V3 partner transaction export — 截图装配。
 * 从 transaction-export-v3.js 拆出（行为保持重构），原路径继续作为 barrel 导出这些名字。
 */
import { MINIO_BUCKET, MINIO_PUBLIC_URL } from '../../config/config.js';
import { mapStepToTransactionEvent } from './transaction-export.js';
import { stripVolatileQuery } from './transaction-export-v3-region.js';

/**
 * 解析类似 JSON 的截图元数据，不向上传播格式错误的输入。
 * @param {unknown} raw 对象或序列化的 JSON 值
 * @returns {object|null} 解析后的值，无效时为 null
 */
function parseJson(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

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

  /**
   * 登记精确和规范化的页面级键，供后续查找父级使用。
   * @param {string} levelKey 页面或弹窗级键
   * @param {number} entryId 生成的截图条目 ID
   * @returns {void}
   */
  const rememberPageLevelKey = (levelKey, entryId) => {
    idByPageLevel.set(levelKey, entryId);
    const norm = stripVolatileQuery(levelKey);
    if (norm && !idByPageLevelNorm.has(norm)) idByPageLevelNorm.set(norm, entryId);
  };

  const pageLevels = Array.isArray(pageLevelScreenshots) ? pageLevelScreenshots : [];
  if (pageLevels.length) {
    // 残留弹窗清理：页面级截图行按 level_key upsert，旧录制的同页同标题弹窗行会留存。
    // 判据：同 parentKey+标题的一组 popup 中，至少一个弹窗的 anchor 能匹配到本轨迹的
    // 触发步骤（click 步元素含 anchor 或属性值），而某弹窗的 anchor 匹配不到任何步骤
    // ——匹配不到者为旧录制残留，跳过不导出。全部都匹配不到时保留（无法分辨，不误删）。
    /**
     * 从截图元数据中提取弹窗标题、锚点和父页面键。
     * @param {object} shot 截图元数据行
     * @returns {{title: string, anchor: string, parentKey: string}|null} 解析后的部分
     */
    const anchorOf = (shot) => {
      const key = String(shot?.levelKey || shot?.metadataJson?.levelKey || '');
      const m = key.match(/\|dialog:([^@|]*)@@anchor:(.*)$/);
      return m ? { title: m[1].trim(), anchor: m[2].trim(), parentKey: key.slice(0, m.index) } : null;
    };
    const stepEls = (traj.steps || [])
      .map((step) => {
        const el = parseJson(step?.elementJson);
        const ev = mapStepToTransactionEvent(step);
        return el && ev?.eventTypeValue === 'click' ? el : null;
      })
      .filter(Boolean);
    /**
     * 判断录制的点击元素是否匹配弹窗触发锚点。
     * @param {string} anchor 触发锚点表达式
     * @returns {boolean} 是否有录制点击匹配
     */
    const anchorMatched = (anchor) => {
      const a = String(anchor || '').trim();
      if (!a) return false;
      const am = a.match(/='([^']+)'/);
      const label = am ? am[1] : '';
    /**
     * 检查定位器/文本字段是否匹配完整锚点或其标签。
     * @param {unknown} s 候选定位器或文本
     * @returns {boolean} 候选值是否匹配
     */
    const inStr = (s) => {
        const str = String(s || '');
        return str.includes(a) || (label && (str.includes(`='${label}']`) || str.includes(`="${label}"]`)));
      };
      return stepEls.some((el) => inStr(el.xpath) || inStr(el.xpath_smart) || inStr(el.xpath_full)
        || el.attributes?.['aria-label'] === label || String(el.text ?? '').trim() === label);
    };
    const groups = new Map(); // parentKey|title → 至少一个弹窗被本轨迹触发
    for (const shot of pageLevels) {
      const parts = anchorOf(shot);
      if (!parts) continue;
      const gk = `${parts.parentKey}|${parts.title}`;
      if (!groups.has(gk)) groups.set(gk, false);
      if (anchorMatched(parts.anchor)) groups.set(gk, true);
    }
    /**
     * 识别旧录制遗留的未匹配重复弹窗。
     * @param {object} shot 截图元数据行
     * @returns {boolean} 弹窗是否应作为过期数据跳过
     */
    const stalePopup = (shot) => {
      const parts = anchorOf(shot);
      if (!parts) return false;
      return groups.get(`${parts.parentKey}|${parts.title}`) === true && !anchorMatched(parts.anchor);
    };

    // 新链路：页面级截图（kind='page_level'）。一个 page/popup 一个条目。
    for (const shot of pageLevels) {
      const url = resolveScreenshotUrl(shot);
      if (!url) continue; // 本地暂存未上传，跳过
      if (stalePopup(shot)) continue; // 旧录制残留弹窗，跳过
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

  // ── 合成弹窗条目（人工录制兜底）──
  // 人工录制不发页面级截图事件，但步骤 element 同样被 stamp 了 popup_level_key
  // （含 @@anchor）。从步骤 key 分组成弹窗节点，让弹窗内控件有 popup 可挂、
  // 触发链（properties 侧）能找到触发图标把弹窗挂到按钮行下。无需截图、无需重录。
  const syntheticPopups = new Map(); // levelKey → entry
  for (const step of traj.steps || []) {
    const el = parseJson(step?.elementJson);
    const key = String(el?.popup_level_key || el?.popupLevelKey || '').trim();
    if (!key || !key.includes('|dialog:') || syntheticPopups.has(key)) continue;
    if (idByPageLevel.has(key) || idByPageLevelNorm.has(stripVolatileQuery(key))) continue;
    const m = key.match(/^(.*)\|dialog:([^@|]*)(?:@@anchor:(.*))?$/);
    if (!m) continue;
    syntheticPopups.set(key, {
      propertiesName: m[2].trim() || '弹窗',
      anchor: (m[3] || '').trim(),
      parentKey: m[1],
    });
  }
  for (const [key, info] of syntheticPopups) {
    const parentEntry = idByPageLevel.get(info.parentKey)
      || idByPageLevelNorm.get(stripVolatileQuery(info.parentKey));
    const entryId = nextId;
    nextId += 1;
    const entry = {
      propertiesName: info.propertiesName,
      eventTypeValue: 'click',
      eventTypeName: '点击',
      elementType: '',
      mothed: '',
      options: '',
      objectValue: '',
      transcationType: 'playwright',
      type: 'popup',
      screenshot: [],
      propertiesID: String(entryId),
      propertiesPID: parentEntry ? String(parentEntry) : '0',
      realLabel: '',
      regionId: key,
      regionLabel: info.propertiesName,
      rect: {},
    };
    entries.push(entry);
    rememberPageLevelKey(key, entryId);
    pageLevelById.set(String(entryId), entry);
    const scopedTitleKey = info.parentKey ? `${info.parentKey}|dialog:${info.propertiesName}` : '';
    if (scopedTitleKey && !idByDialog.has(scopedTitleKey)) idByDialog.set(scopedTitleKey, entryId);
  }

  return { entries, idByPhase, idByDialog, idByPageLevel, idByPageLevelNorm, pageLevelById, usedPageLevelScreenshots: false };
}
