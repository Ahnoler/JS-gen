/**
 * V3 partner transaction export — 覆盖/完整性校验。
 * 从 transaction-export-v3.js 拆出（行为保持重构），原路径继续作为 barrel 导出这些名字。
 */
import { resolveRootScreenshotId } from './transaction-export-v3-properties.js';

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
