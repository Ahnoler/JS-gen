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
 *
 * 本文件为 V3 导出的 barrel + 条目/载荷装配层；region/key 工具、截图装配、
 * 属性构建、校验分别拆分至 transaction-export-v3-{region,screenshot,properties,validate}.js，
 * 全部 15 个具名导出仍从本路径导出（消费方与特征化测试按原路径 import）。
 */
import { uniquifyPropertiesNames } from './transaction-export.js';
import { sanitizeTranscationName } from './transaction-name.js';
import { buildScreenshotEntries } from './transaction-export-v3-screenshot.js';
import { buildV3Properties } from './transaction-export-v3-properties.js';
import {
  validatePageLevelCoverage,
  validateFieldCompleteness,
} from './transaction-export-v3-validate.js';

export { isOverlayRegion, pageKeyFromRegionId, popupKeyFromRegionId, stripVolatileQuery } from './transaction-export-v3-region.js';
export { buildScreenshotEntries } from './transaction-export-v3-screenshot.js';
export { buildV3Properties, resolveRootScreenshotId } from './transaction-export-v3-properties.js';
export {
  validatePageLevelCoverage,
  validateFieldCompleteness,
  coverageBlocksPush,
} from './transaction-export-v3-validate.js';

export const TRANSACTION_SCHEMA_VERSION_V3 = 3;

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
    // 交易起点页面 ID（trajectory.page_id，菜单切换；组件编号或 AILZ+13位时间戳）。
    // dao fromDbRow 输出 camelCase（pageId）；page_id 兜底兼容原始 snake_case 形态
    pageId: String(traj.pageId ?? traj.page_id ?? ''),
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
