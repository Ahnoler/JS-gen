#!/usr/bin/env node
/**
 * Characterize v3-payload-size ②③: field completeness validation + truncation + pre-push preflight.
 * All checks are non-blocking (record/log only, never block push).
 */
import { validateFieldCompleteness, buildTransactionEntryV3 } from '../../src/services/transaction-export-v3.js';
import { preflightCheck, toPartnerImportPayload } from '../../src/services/partner-platform.js';

const failures = [];
function check(label, cond) { if (!cond) failures.push(label); }

// validateFieldCompleteness: ele 缺 elementType+realLabel → issue
const entry1 = { transcationProperties: [
  { type: 'page', propertiesID: '1', propertiesPID: '0', screenshot: ['url'], propertiesName: 'page' },
  { type: 'ele', propertiesID: '2', propertiesPID: '1', elementType: '', realLabel: '', propertiesName: 'orphan', regionId: 'x', rect: '{"x1":1,"y1":1,"x2":2,"y2":2}' },
]};
const c1 = validateFieldCompleteness(entry1);
check('ele missing elementType+label', c1.missing.some(m => m.issues.includes('missingElementTypeAndLabel')));

// section 节点不报 issue
const entry2 = { transcationProperties: [
  { type: 'page', propertiesID: '1', propertiesPID: '0', screenshot: ['url'], propertiesName: 'page' },
  { type: 'section', propertiesID: '2', propertiesPID: '1', screenshot: [], propertiesName: 'tab1', elementType: '', realLabel: 'tab1' },
  { type: 'ele', propertiesID: '3', propertiesPID: '2', elementType: '//x', realLabel: 'btn', propertiesName: 'btn', regionId: 'x', rect: '' },
]};
const c2 = validateFieldCompleteness(entry2);
check('section no issue', !c2.missing.some(m => m.propertiesID === '2'));

// page 无 screenshot → issue
const entry3 = { transcationProperties: [
  { type: 'page', propertiesID: '1', propertiesPID: '0', screenshot: [], propertiesName: 'page' },
]};
const c3 = validateFieldCompleteness(entry3);
check('page empty screenshot', c3.missing.some(m => m.issues.includes('emptyScreenshot')));

// 截断：buildTransactionEntryV3 合并后截断超长字段（propertiesName > 100）
const longTraj = {
  id: 88,
  name: '超长字段截断测试交易',
  steps: [
    {
      stepNumber: 1, actionType: 'click_element_by_index', source: 'agent',
      trajectoryPhaseId: 1, phaseNumber: 1,
      elementJson: {
        tag: 'li', xpath_smart: '//li[1]', target_kind: 'menu',
        text: '客户管理', region_id: 'tab:客户管理',
        bbox: { x1: 1, y1: 2, x2: 30, y2: 20 },
      },
      // params.text 不经过 prepareElementJson 的 40 字截断，能可靠构造 >100 的超长 propertiesName
      paramsJson: { text: 'x'.repeat(150) },
    },
  ],
};
const builtTrunc = buildTransactionEntryV3(longTraj, {
  systemId: '98', projectId: '31',
  phases: [{ id: 1, phaseNumber: 1, description: '点击客户管理' }],
  phaseScreenshots: [{ id: 101, trajectoryPhaseId: 1, imageUrl: 'http://minio/x.png' }],
});
const truncEle = builtTrunc.entry.transcationProperties.find((p) => p.type === 'ele');
check('propertiesName truncated', String(truncEle.propertiesName).length === 100 && String(truncEle.propertiesName).endsWith('...truncated'));
check('truncatedFields stats counted', builtTrunc.stats.truncatedFields?.propertiesName >= 1);

// preflight: undefined 值检测
const wirePayload = toPartnerImportPayload({
  transcationEventTypeList: [{
    transcationProperties: [
      { type: 'page', propertiesID: '1', propertiesPID: '0', screenCapture: 'http://x/p.png', propertiesName: 'page', elementType: undefined },
    ],
  }],
});
const pf = preflightCheck(wirePayload);
check('preflight undefined detected', pf.issues.some(i => i.issue === 'undefinedValue'));

if (failures.length) { console.error('FAIL:', failures); process.exit(1); }
console.log('OK: field completeness + truncation + preflight');
