#!/usr/bin/env node
/**
 * Characterize partition-via-pid: buildV3Properties 插入 type='section' 中间节点，
 * 用 propertiesID/propertiesPID 父子树表达分区层级（同页同名控件可区分）。
 */
import { buildV3Properties, buildScreenshotEntries, buildTransactionEntryV3, validatePageLevelCoverage } from '../../src/services/transaction-export-v3.js';

const failures = [];
function check(label, cond) { if (!cond) failures.push(label); }

// 构造 1 个 page 截图 + 2 个 ele（不同分区段，同名"保存"）
const shotEntries = buildScreenshotEntries({
  pageLevelScreenshots: [{
    levelType: 'page', levelKey: 'page:url#/home',
    metadataJson: { displayName: '首页' },
    imageUrl: 'http://minio/page1.png',
  }],
});
const { properties } = buildV3Properties({
  traj: { steps: [
    { id: 1, trajectoryPhaseId: 1, actionType: 'click_element_by_index', params: { text: '保存' },
      elementJson: JSON.stringify({ region_id: 'page:url#/home|tab:基本信息|section:概况', region_label: '概况', formLabel: '保存', bbox: {x1:1,y1:1,x2:2,y2:2}, page_level_key: 'page:url#/home' }) },
    { id: 2, trajectoryPhaseId: 1, actionType: 'click_element_by_index', params: { text: '保存' },
      elementJson: JSON.stringify({ region_id: 'page:url#/home|tab:详情|section:详情', region_label: '详情', formLabel: '保存', bbox: {x1:3,y1:3,x2:4,y2:4}, page_level_key: 'page:url#/home' }) },
  ]},
  phases: [],
  screenshotCount: shotEntries.entries.length,
  idByPageLevel: shotEntries.idByPageLevel,
  idByDialog: shotEntries.idByDialog,
  idByPhase: shotEntries.idByPhase,
  idByPageLevelNorm: shotEntries.idByPageLevelNorm,
  pageLevelById: shotEntries.pageLevelById,
});

// section 节点存在
const sections = properties.filter(p => p.type === 'section');
check('section count >= 2', sections.length >= 2);

// ele pid 指向 section 而非 page
const eles = properties.filter(p => p.type === 'ele');
check('ele count === 2', eles.length === 2);
check('ele[0] pid not page id', eles[0].propertiesPID !== '1');
check('ele[1] pid not page id', eles[1].propertiesPID !== '1');

// 同名"保存"pid 不同 → 可区分
check('same-name ele pids differ', eles[0].propertiesPID !== eles[1].propertiesPID);

// section 嵌套层级：tab → section 两层
const tabSections = sections.filter(s => s.propertiesPID === '1'); // pid 指向 page
check('tab-level sections >= 2', tabSections.length >= 2);

// legacy：无分区段的 ele → pid 直指 page（无 section 节点创建）
const { properties: legacyProps } = buildV3Properties({
  traj: { steps: [
    { id: 10, trajectoryPhaseId: 1, actionType: 'click_element_by_index', params: { text: '按钮' },
      elementJson: JSON.stringify({ region_id: 'page:url#/home', region_label: '', formLabel: '按钮', bbox: {x1:1,y1:1,x2:2,y2:2}, page_level_key: 'page:url#/home' }) },
  ]},
  phases: [],
  screenshotCount: 1,
  idByPageLevel: new Map([['page:url#/home', 1]]),
  idByDialog: new Map(), idByPhase: new Map(),
  idByPageLevelNorm: new Map(), pageLevelById: new Map(),
});
const legacyEles = legacyProps.filter(p => p.type === 'ele');
const legacySections = legacyProps.filter(p => p.type === 'section');
check('legacy no section', legacySections.length === 0);
check('legacy ele pid = page id', legacyEles[0].propertiesPID === '1');

// validatePageLevelCoverage 向上追溯：含 section 节点时覆盖校验应通过
const built = buildTransactionEntryV3(
  { id: 1, name: 'test', steps: [
    { id: 1, trajectoryPhaseId: 1, actionType: 'click_element_by_index', params: { text: '保存' },
      elementJson: JSON.stringify({ region_id: 'page:url#/home|tab:基本信息|section:概况', region_label: '概况', formLabel: '保存', bbox: {x1:1,y1:1,x2:2,y2:2}, page_level_key: 'page:url#/home' }) },
  ]},
  { systemId: 1, projectId: 1, phases: [], phaseScreenshots: [], dialogScreenshots: [],
    pageLevelScreenshots: [{ levelType: 'page', levelKey: 'page:url#/home', metadataJson: { displayName: '首页' }, imageUrl: 'http://minio/p.png' }] },
);
const coverage = validatePageLevelCoverage(built.entry);
check('coverage ok with section nodes', coverage.ok);
check('coverage missing empty', coverage.missing.length === 0);

if (failures.length) { console.error('FAIL:', failures); process.exit(1); }
console.log('OK: section nodes created, ele pids point to sections, same-name distinguishable, coverage traversal passes');
