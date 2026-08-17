#!/usr/bin/env node
/**
 * Characterize transaction-export-v3 (批量推送 V3.0：阶段长图控件点亮 groups 结构).
 * 纯函数断言（合成数据）+ 真实 DB 数据断言（traj 38）。
 */
import { getDB } from '../../config/database.js';
import * as trajectoryDao from '../../src/dao/trajectory-dao.js';
import * as screenshotDao from '../../src/dao/screenshot-dao.js';
import * as trajectoryPhaseDao from '../../src/dao/trajectory-phase-dao.js';
import {
  buildControlNode,
  buildGroupsResult,
  buildTransactionEntryV3,
  mapControlAction,
  mapControlKind,
  isOverlayRegion,
} from '../../src/services/transaction-export-v3.js';

let failures = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ ${msg}`);
  }
}

// ── 纯函数：action/kind 映射 ──
function testMappings() {
  console.log('[pure] action/kind 映射');
  check(mapControlAction('fill_form_field').action === 'input', 'fill_form_field → input');
  check(mapControlAction('select_option').command === 'select', 'select_option → select');
  check(mapControlAction('fill_date_field').action === 'fill_date_field', 'fill_date_field 保留');
  check(mapControlAction('click_element_by_index').command === 'click', 'click_element_by_index → click');
  check(mapControlAction('unknown_action').action === 'unknown_action', '未知动作保留原名');
  check(mapControlKind('form_input') === 'input', 'form_input → input');
  check(mapControlKind('form_select') === 'select', 'form_select → select');
  check(mapControlKind('form_date') === 'date', 'form_date → date');
  check(mapControlKind('button') === 'button', 'button → button');
  check(mapControlKind('menu') === 'menu', 'menu → menu');
  check(mapControlKind('weird_kind') === 'weird_kind', '未知 kind 保留原名');
}

// ── 纯函数：overlay 判定 ──
function testOverlay() {
  console.log('[pure] 弹窗归属判定');
  check(isOverlayRegion('tab:客户基本信息|section:对公客户概况') === null, '页面 region 非弹窗');
  check(isOverlayRegion('overlay:地址选择器')?.label === '地址选择器', 'overlay: 段识别');
  check(isOverlayRegion('tab:A|overlay:引入|section:B')?.label === '引入', '分层链中 overlay 段识别');
  check(isOverlayRegion('') === null, '空 region 非弹窗');
}

// ── 纯函数：控件节点构建 ──
function testControlNode() {
  console.log('[pure] buildControlNode');
  const node = buildControlNode(
    { stepNumber: 17, actionType: 'fill_form_field', source: 'agent', createdAt: '2026-08-17T16:40:00.000Z' },
    {
      tag: 'input', xpath_smart: '//div[@label="客户编号"]//input', target_kind: 'form_input',
      formLabel: '客户编号', text: '客户编号',
      attributes: { placeholder: '请输入', disabled: 'disabled' },
      bbox: { x1: 29, y1: 1997, x2: 336, y2: 2029 },
    },
    { label_text: '客户编号', value: '26081316264601222' },
    { pid: 'page-3', group: [], anchor: null, scanIndex: 5 },
  );
  check(node.id === 'step-17', 'id = step-<stepNumber>');
  check(node.pid === 'page-3' && node.type === 'ele', 'pid/type');
  check(node.kind === 'input' && node.tagName === 'input', 'kind/tagName');
  check(node.target === '//div[@label="客户编号"]//input' && node.targetType === 'xpath', 'target/targetType');
  check(node.propertiesName === '客户编号' && node.label === '客户编号', 'propertiesName/label');
  check(node.value === '26081316264601222', 'value from params');
  check(node.placeholder === '请输入' && node.disabled === true, 'attributes 透传');
  check(JSON.stringify(node.rect) === '{"x1":29,"y1":1997,"x2":336,"y2":2029}', 'rect 输出');
  check(node.manualRecord === false && node.recorded === true, 'recorded/manualRecord');
  check(JSON.stringify(node.params) === '{"label_text":"客户编号","value":"26081316264601222"}', 'params 透传');
  check(Number.isFinite(node.timestamp) && node.timestamp > 0, 'timestamp 毫秒');

  // 非法 bbox → 无 rect
  const noRect = buildControlNode(
    { stepNumber: 18, actionType: 'click_element_by_index', source: 'agent' },
    { tag: 'button', xpath: '//button[1]', target_kind: 'button', bbox: { x1: 0, y1: 0, x2: 0, y2: 0 } },
    { label_text: '保存' },
    { pid: 'page-3', group: [], anchor: null, scanIndex: 6 },
  );
  check(noRect.rect === undefined, '非法 bbox 省略 rect');
  check(noRect.id === 'step-18', '无 createdAt 时 id 仍稳定');

  // anchor 透传
  const anchorNode = buildControlNode(
    { stepNumber: 22, actionType: 'select_option', source: 'agent' },
    { tag: 'input', xpath_smart: '//div[@label="省份"]//input', target_kind: 'form_select', formLabel: '省份' },
    { label_text: '省份', value: '福建省' },
    { pid: 'page-3|dialog:地址选择器@@anchor=//button[1]', group: [{ type: 'dialog', name: '地址选择器', key: 'page-3|dialog:地址选择器@@anchor=//button[1]' }], anchor: { xpath: '//button[normalize-space()="选择"]', name: '登记注册地址 选择' }, scanIndex: 8 },
  );
  check(anchorNode.anchorTarget === '//button[normalize-space()="选择"]', 'anchorTarget');
  check(anchorNode.anchorPropertiesName === '登记注册地址 选择', 'anchorPropertiesName');
  check(anchorNode.group[0].type === 'dialog' && anchorNode.group[0].name === '地址选择器', 'group 字段');
}

// ── 纯函数：groups 树构建（合成数据）──
function testGroupsSynthetic() {
  console.log('[pure] buildGroupsResult 合成数据');
  const result = buildGroupsResult({
    traj: { id: 99, name: '测试交易', url: 'http://x/' },
    phases: [
      { id: 1, phaseNumber: 1, description: '点击客户管理' },
      { id: 2, phaseNumber: 2, description: '填写表单' },
    ],
    phaseScreenshots: [
      { id: 101, trajectoryPhaseId: 1 },
      { id: 202, trajectoryPhaseId: 2 },
    ],
    stepsByPhase: {
      1: [
        { stepNumber: 1, actionType: 'click_element_by_index', source: 'agent', elementJson: { tag: 'li', xpath_smart: '//li[@data-id="RES1"]', target_kind: 'menu', text: '客户管理', region_id: 'tab:客户管理', bbox: { x1: 1, y1: 2, x2: 30, y2: 20 } }, paramsJson: { label_text: '客户管理' } },
      ],
      2: [
        { stepNumber: 1, actionType: 'click_adjacent_button', source: 'agent', elementJson: { tag: 'button', xpath_smart: '//button[normalize-space()="选择"]', target_kind: 'button', text: '登记注册地址 选择', region_id: 'tab:登记信息', bbox: { x1: 10, y1: 10, x2: 50, y2: 30 } }, paramsJson: { label_text: '登记注册地址 选择' } },
        { stepNumber: 2, actionType: 'select_option', source: 'agent', elementJson: { tag: 'input', xpath_smart: '//div[@label="省份"]//input', target_kind: 'form_select', formLabel: '省份', region_id: 'overlay:地址选择器', bbox: { x1: 100, y1: 200, x2: 300, y2: 220 } }, paramsJson: { label_text: '省份', value: '福建省' } },
        { stepNumber: 3, actionType: 'save_form_snapshot', source: 'agent', elementJson: null, paramsJson: {} },
      ],
    },
  });
  const groups = result.groups;
  const pages = groups.filter((g) => g.type === 'page');
  check(pages.length === 2, `2 个页面组（实际 ${pages.length}）`);
  check(pages[0].id === 'page-1' && pages[0].pid === null, 'page-1 id/pid');
  check(pages[0].screenshots[0].url === '/api/v2/screenshots/101/image' && pages[0].screenshots[0].phaseNumber === 1, 'screenshots 条目（无尺寸字段）');
  check(pages[1].name.startsWith('页面2'), '页面组 name');
  const dialogs = groups.filter((g) => g.type === 'dialog');
  check(dialogs.length === 1, `1 个弹窗组（实际 ${dialogs.length}）`);
  check(dialogs[0].id === 'page-2|dialog:地址选择器@@anchor=//button[normalize-space()="选择"]', '弹窗组 key 含 anchor');
  check(dialogs[0].pid === 'page-2' && dialogs[0].screenshots.length === 0, '弹窗组 pid/screenshots 空');
  const eles = groups.filter((g) => g.type === 'ele');
  check(eles.length === 3, `3 个控件节点（save_form_snapshot 跳过；实际 ${eles.length}）`);
  const province = eles.find((e) => e.propertiesName === '省份');
  check(province && province.pid === dialogs[0].id, '弹窗控件 pid 挂弹窗组');
  check(province && province.anchorTarget === '//button[normalize-space()="选择"]', '弹窗控件 anchor 推断');
  check(province && province.group[0].name === '地址选择器', '弹窗控件 group 字段');
  const menu = eles.find((e) => e.propertiesName === '客户管理');
  check(menu && menu.pid === 'page-1' && menu.group.length === 0, '页面控件 pid 挂页面组');
  check(result.id === 'traj-99' && result.url === 'http://x/', 'result id/url');
}

// ── 真实数据（traj 38）──
async function testRealData() {
  console.log('[real data] traj 38');
  const db = getDB();
  try {
    const traj = await trajectoryDao.getById(38);
    const phases = await trajectoryPhaseDao.listByTrajectory(38);
    const shots = await screenshotDao.listPhaseHighlightsByTrajectory(38);
    const built = buildTransactionEntryV3(traj, { systemId: 'sys', projectId: 'proj', phases, phaseScreenshots: shots });
    const entry = built.entry;
    const groups = entry.result.groups;
    const pages = groups.filter((g) => g.type === 'page');
    const eles = groups.filter((g) => g.type === 'ele');
    const dialogs = groups.filter((g) => g.type === 'dialog');
    check(pages.length === 3, `3 个页面组（实际 ${pages.length}）`);
    check(eles.length >= 110, `控件节点 >= 110（实际 ${eles.length}）`);
    const withRect = eles.filter((e) => e.rect).length;
    check(withRect >= 110, `带 rect 控件 >= 110（实际 ${withRect}）`);
    const page1 = pages.find((p) => p.id === 'page-1');
    check(page1 && page1.screenshots.length === 1 && page1.screenshots[0].url.includes('/screenshots/'), 'page-1 screenshots 含长图');
    check(entry.transcationProperties.length >= 110, `transcationProperties >= 110（实际 ${entry.transcationProperties.length}）`);
    // 抽样 rect 与 DB element_json.bbox 一致
    const stepRows = await db('trajectory_step').select('step_number', 'phase_number', 'element_json').where({ trajectory_id: 38 }).limit(500);
    let rectOk = 0, rectChecked = 0;
    for (const s of stepRows) {
      let el = null;
      try { el = typeof s.element_json === 'string' ? JSON.parse(s.element_json) : s.element_json; } catch {}
      if (!el || !el.bbox) continue;
      const expected = { x1: Number(el.bbox.x1), y1: Number(el.bbox.y1), x2: Number(el.bbox.x2), y2: Number(el.bbox.y2) };
      const node = eles.find((e) => e.id === `step-${s.step_number}` && e.pid === `page-${s.phase_number ?? ''}`.replace('page-0', 'page-'));
      if (!node || !node.rect) continue;
      rectChecked++;
      if (JSON.stringify(node.rect) === JSON.stringify(expected)) rectOk++;
    }
    check(rectChecked >= 5 && rectOk === rectChecked, `抽样 rect 与 DB bbox 一致（${rectOk}/${rectChecked}）`);
    // pid 归属合法性：无孤儿（所有 ele 的 pid 存在于 groups）
    const ids = new Set(groups.map((g) => g.id));
    const orphans = eles.filter((e) => !ids.has(e.pid));
    check(orphans.length === 0, `无孤儿控件（实际 ${orphans.length}）`);
  } finally {
    await db.destroy();
  }
}

async function main() {
  testMappings();
  testOverlay();
  testControlNode();
  testGroupsSynthetic();
  await testRealData();
  if (failures) {
    console.error(`\ncharacterize-export-v3: ${failures} FAILURE(S)`);
    process.exit(1);
  }
  console.log('\ncharacterize-export-v3: OK');
}

main();
