#!/usr/bin/env node
/**
 * Characterize transaction-export-v3 (优化版：transcationProperties 单轨 + payload.screenshots).
 */
import { getDB } from '../../config/database.js';
import * as trajectoryDao from '../../src/dao/trajectory-dao.js';
import * as screenshotDao from '../../src/dao/screenshot-dao.js';
import * as trajectoryPhaseDao from '../../src/dao/trajectory-phase-dao.js';
import {
  buildV3Properties,
  buildV3Screenshots,
  buildTransactionEntryV3,
  buildTransactionPayloadV3,
  wrapTransactionListV3,
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

// ── 纯函数：buildV3Properties 合成数据 ──
function testBuildV3Properties() {
  console.log('[pure] buildV3Properties');
  const { properties, metaActions, noRectControls } = buildV3Properties({
    traj: {
      id: 99,
      name: '测试交易',
      steps: [
        {
          stepNumber: 1, actionType: 'click_element_by_index', source: 'agent',
          trajectoryPhaseId: 1, phaseNumber: 1,
          elementJson: {
            tag: 'li', xpath_smart: '//li[@data-id="RES1"]', target_kind: 'menu',
            text: '客户管理', region_id: 'tab:客户管理', region_label: '客户管理',
            bbox: { x1: 1, y1: 2, x2: 30, y2: 20 },
          },
          paramsJson: { label_text: '客户管理' },
        },
        {
          stepNumber: 2, actionType: 'select_option', source: 'agent',
          trajectoryPhaseId: 1, phaseNumber: 1,
          elementJson: {
            tag: 'input', xpath_smart: '//div[@label="省份"]//input', target_kind: 'form_select',
            formLabel: '省份', region_id: 'overlay:地址选择器', region_label: '地址选择器',
            bbox: { x1: 100, y1: 200, x2: 300, y2: 220 },
          },
          paramsJson: { label_text: '省份', value: '福建省' },
        },
        { stepNumber: 3, actionType: 'save_form_snapshot', source: 'agent', trajectoryPhaseId: 1, phaseNumber: 1, elementJson: null, paramsJson: {} },
      ],
    },
    phases: [{ id: 1, phaseNumber: 1, description: '点击客户管理' }],
  });

  check(properties.length === 2, `2 条属性（meta 跳过；实际 ${properties.length}）`);
  check(metaActions === 1, 'metaActions = 1');
  check(noRectControls === 0, 'noRectControls = 0');

  const first = properties[0];
  check(first.id === 'step-1' && first.pid === 'page-1', '页面控件 id/pid');
  check(first.scanIndex === 0, 'scanIndex 从 0 开始');
  check(first.label === '客户管理', 'label 输出');
  check(first.regionId === 'tab:客户管理' && first.regionLabel === '客户管理', 'regionId/regionLabel');
  check(JSON.stringify(first.rect) === '{"x1":1,"y1":2,"x2":30,"y2":20}', 'rect 输出');
  check(first.type === 'ele', 'type=ele');
  check(first.url === undefined, '属性中不输出 url');
  check(first.recorded === undefined && first.manualRecord === undefined, '已删除 recorded/manualRecord');
  check(first.targetType === undefined, '已删除 targetType');

  const second = properties[1];
  check(second.scanIndex === 1, 'scanIndex 全局递增');
  check(second.pid === 'page-1|dialog:地址选择器', '弹窗控件 pid 使用简洁弹窗 key');
  check(second.regionId === 'overlay:地址选择器', '弹窗控件 regionId');
}

// ── 纯函数：buildV3Screenshots ──
function testBuildV3Screenshots() {
  console.log('[pure] buildV3Screenshots');
  const shots = buildV3Screenshots({
    traj: { id: 99 },
    phases: [
      { id: 1, phaseNumber: 1, description: '点击客户管理' },
      { id: 2, phaseNumber: 2, description: '填写表单' },
    ],
    phaseScreenshots: [
      { id: 101, trajectoryPhaseId: 1 },
      { id: 202, trajectoryPhaseId: 2 },
    ],
  });
  check(shots.length === 2, `2 个页面截图（实际 ${shots.length}）`);
  check(shots[0].type === 'page' && shots[0].key === 'page-1', 'page key/type');
  check(shots[0].bucket === 'uara', 'bucket 默认 uara');
  check(shots[0].url === '/api/v2/screenshots/101/image', '截图 url');
  check(shots[0].expires === 3600, 'expires 默认 3600');
  check(shots[0].trajectoryId === undefined, '单条截图不输出 trajectoryId（批量时由 wrap 补充）');
}

// ── 纯函数：buildTransactionEntryV3 / Payload / Wrap ──
function testPayloadStructure() {
  console.log('[pure] payload 结构');
  const traj = {
    id: 99,
    name: '测试交易',
    steps: [
      {
        stepNumber: 1, actionType: 'click_element_by_index', source: 'agent',
        trajectoryPhaseId: 1, phaseNumber: 1,
        elementJson: { tag: 'li', xpath_smart: '//li[1]', target_kind: 'menu', text: '客户管理', region_id: 'tab:客户管理', bbox: { x1: 1, y1: 2, x2: 30, y2: 20 } },
        paramsJson: {},
      },
    ],
  };
  const phases = [{ id: 1, phaseNumber: 1, description: '点击客户管理' }];
  const shots = [{ id: 101, trajectoryPhaseId: 1 }];

  const built = buildTransactionEntryV3(traj, { systemId: '98', projectId: '31', phases, phaseScreenshots: shots });
  check(built.entry.result === undefined, 'entry 不再有 result');
  check(Array.isArray(built.screenshots) && built.screenshots.length === 1, 'screenshots 独立返回');
  check(built.entry.transcationProperties.length === 1, 'transcationProperties 保留');

  const payload = buildTransactionPayloadV3(traj, { systemId: '98', projectId: '31', phases, phaseScreenshots: shots });
  check(Array.isArray(payload.payload.screenshots), 'payload.screenshots 存在');
  check(payload.payload.transcationEventTypeList.length === 1, 'transcationEventTypeList 存在');

  const wrapped = wrapTransactionListV3([built]);
  check(wrapped.payload.screenshots.length === 1, '批量合并 screenshots');
  check(wrapped.payload.transcationEventTypeList.length === 1, '批量合并 entries');
  check(wrapped.stats.noRectControls === 0, '批量 stats.noRectControls');
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
    const props = entry.transcationProperties;
    check(entry.result === undefined, '真实数据 entry 无 result');
    check(props.length >= 110, `transcationProperties >= 110（实际 ${props.length}）`);
    const withRect = props.filter((p) => p.rect).length;
    check(withRect >= 110, `带 rect 属性 >= 110（实际 ${withRect}）`);
    const withPid = props.filter((p) => p.pid).length;
    check(withPid === props.length, '所有属性都有 pid');
    const withRegion = props.filter((p) => p.regionId).length;
    check(withRegion > 0, '存在 regionId');
    const pageShots = built.screenshots.filter((s) => s.type === 'page');
    check(pageShots.length >= 1, `页面截图 >= 1（实际 ${pageShots.length}）`);
    // 抽样 rect 与 DB bbox 一致
    const stepRows = await db('trajectory_step').select('step_number', 'element_json').where({ trajectory_id: 38 }).limit(500);
    let rectOk = 0, rectChecked = 0;
    for (const s of stepRows) {
      let el = null;
      try { el = typeof s.element_json === 'string' ? JSON.parse(s.element_json) : s.element_json; } catch {}
      if (!el || !el.bbox) continue;
      const expected = { x1: Number(el.bbox.x1), y1: Number(el.bbox.y1), x2: Number(el.bbox.x2), y2: Number(el.bbox.y2) };
      const node = props.find((e) => e.id === `step-${s.step_number}`);
      if (!node || !node.rect) continue;
      rectChecked++;
      if (JSON.stringify(node.rect) === JSON.stringify(expected)) rectOk++;
    }
    check(rectChecked >= 5 && rectOk === rectChecked, `抽样 rect 与 DB bbox 一致（${rectOk}/${rectChecked}）`);
  } finally {
    await db.destroy();
  }
}

async function main() {
  testMappings();
  testOverlay();
  testBuildV3Properties();
  testBuildV3Screenshots();
  testPayloadStructure();
  await testRealData();
  if (failures) {
    console.error(`\ncharacterize-export-v3: ${failures} FAILURE(S)`);
    process.exit(1);
  }
  console.log('\ncharacterize-export-v3: OK');
}

main();
