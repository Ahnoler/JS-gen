#!/usr/bin/env node
/**
 * Characterize layer-tree-from-properties.mjs (元素分层工具).
 * 纯函数断言（合成数据）+ 真实 DB 数据断言（traj 38 phase 3 / screenshot #8734）+
 * HTML 交互结构源码断言（buildHtml 为模块内函数，未导出，做源码级检查）。
 */
import { readFileSync } from 'node:fs';
import { getDB } from '../../config/database.js';
import {
  buildTreeFromProperties,
  buildTreeFromElements,
  buildTreeFromSteps,
  buildTreeFromGroups,
  buildTreeFromV3Flat,
} from '../../scripts/tools/layer-tree-from-properties.mjs';

let failures = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ ${msg}`);
  }
}

function countLeaves(node) {
  return node.items.length + node.children.reduce((n, c) => n + countLeaves(c), 0);
}

function countBranches(node) {
  return node.children.reduce((n, c) => n + 1 + countBranches(c), 0);
}

// ── 纯函数：buildTreeFromSteps（step 分层，本工具核心）──
function testStepsSynthetic() {
  console.log('[synthetic] buildTreeFromSteps');
  const steps = [
    {
      label: '客户名称', action: '输入', actionValue: 'fill_form_field',
      layers: [
        { role: 'tab', label: '客户基本信息' },
        { role: 'section', label: '经营情况' },
        { role: 'titlebox', label: '客户经营概况' },
      ],
      regionId: 'tab:客户基本信息|section:经营情况|titlebox:客户经营概况',
      hasBbox: true,
    },
    {
      label: '评级等级', action: '选择', actionValue: 'select_option',
      regionId: 'tab:评级信息|section:评级概况',
      hasBbox: false,
    },
    { label: '无分区步骤', action: '点击', actionValue: 'click', regionId: '', hasBbox: false },
  ];
  const tree = buildTreeFromSteps(steps);
  check(countLeaves(tree) === 3, `3 步骤全部挂树（实际 ${countLeaves(tree)}）`);
  check(tree.children.length === 2, `2 个顶层分区节点（实际 ${tree.children.length}）`);
  const tab1 = tree.children.find((c) => c.label === '客户基本信息');
  check(!!tab1, 'tab:客户基本信息 存在');
  const sec = tab1 && tab1.children.find((c) => c.label === '经营情况');
  check(!!sec, 'section:经营情况 存在');
  const tb = sec && sec.children.find((c) => c.label === '客户经营概况');
  check(!!tb, 'titlebox:客户经营概况 存在');
  check(!!tb && tb.items[0] && tb.items[0].hasBbox === true, '叶子携带 hasBbox=true');
  check(!!tb && tb.items[0] && tb.items[0].name === '客户名称', '叶子名称正确');
  const tab2 = tree.children.find((c) => c.label === '评级信息');
  const sec2 = tab2 && tab2.children.find((c) => c.label === '评级概况');
  check(!!sec2 && !!sec2.items[0] && sec2.items[0].hasBbox === false, 'region_id fallback 分层 + hasBbox=false');
  check(tree.items.length === 1, '未分区步骤挂 root.items');
}

// ── 纯函数：buildTreeFromElements（阶段截图元素）──
function testElementsSynthetic() {
  console.log('[synthetic] buildTreeFromElements');
  const elements = [
    { label: '保存', kind: 'button', layers: [{ role: 'tab', label: 'T1' }, { role: 'titlebox', label: 'B1' }], regionId: 'tab:T1|titlebox:B1' },
    { label: '查询', kind: 'button', layers: [{ role: 'tab', label: 'T1' }], regionId: 'tab:T1' },
    { label: '孤立元素', kind: 'input', layers: [], regionId: '' },
  ];
  const tree = buildTreeFromElements(elements);
  check(countLeaves(tree) === 3, `3 元素全部挂树（实际 ${countLeaves(tree)}）`);
  const t1 = tree.children.find((c) => c.label === 'T1');
  check(!!t1, 'tab:T1 存在');
  check(!!t1 && !!t1.children[0] && t1.children[0].label === 'B1', 'titlebox:B1 挂在 T1 下');
  check(tree.items.length === 1, '无 layers 元素挂 root');
}

// ── 纯函数：buildTreeFromProperties（transcationProperties 导出）──
function testPropertiesSynthetic() {
  console.log('[synthetic] buildTreeFromProperties');
  const props = [
    { regionId: 'tab:基本信息|titlebox:客户概况', propertiesName: '操作一', eventTypeValue: 'click' },
    { regionId: 'tab:基本信息|titlebox:客户概况', propertiesName: '操作二', eventTypeValue: 'fill_form_field' },
    { regionId: '', propertiesName: '无分区', eventTypeValue: 'select_option' },
  ];
  const tree = buildTreeFromProperties(props);
  check(countLeaves(tree) === 3, `3 操作全部挂树（实际 ${countLeaves(tree)}）`);
  check(tree.children.length === 1 && tree.children[0].label === '基本信息', 'tab:基本信息 存在');
  check(tree.items.length === 1, '无 regionId 操作挂 root');
}

// ── HTML 交互结构（源码断言，buildHtml 为模块内函数）──
function testGroupsSynthetic() {
  console.log('[synthetic] buildTreeFromGroups（V3 payload 分层）');
  const groups = [
    { id: 'page-1', pid: null, type: 'page', name: '页面1', screenshots: [] },
    { id: 'step-1', pid: 'page-1', type: 'ele', propertiesName: '客户管理', kind: 'menu', rect: { x1: 1, y1: 2, x2: 30, y2: 20 } },
    { id: 'page-2', pid: null, type: 'page', name: '页面2', screenshots: [] },
    { id: 'page-2|dialog:地址选择器@@anchor=//button[1]', pid: 'page-2', type: 'dialog', name: '地址选择器', screenshots: [] },
    { id: 'step-3', pid: 'page-2|dialog:地址选择器@@anchor=//button[1]', type: 'ele', propertiesName: '省份', kind: 'select', rect: { x1: 100, y1: 200, x2: 300, y2: 220 } },
    { id: 'step-4', pid: 'page-2', type: 'ele', propertiesName: '保存', kind: 'button' },
  ];
  const tree = buildTreeFromGroups(groups);
  check(countLeaves(tree) === 3, `3 控件全部挂树（实际 ${countLeaves(tree)}）`);
  check(tree.children.length === 2, `2 个顶层页面组（实际 ${tree.children.length}）`);
  const p1 = tree.children.find((c) => c.label === '页面1');
  check(!!p1 && p1.items.length === 1, '页面1 挂 1 个控件');
  const p2 = tree.children.find((c) => c.label === '页面2');
  check(!!p2 && p2.children.length === 1 && p2.children[0].role === 'dialog', '弹窗组挂页面2（dialog role）');
  check(!!p2 && p2.children[0].items.length === 1 && p2.children[0].items[0].hasBbox === true, '弹窗控件挂弹窗组 + hasBbox');
  check(!!p2 && p2.items.length === 1 && p2.items[0].hasBbox === false, '无 rect 控件 hasBbox=false');
}

// ── 纯函数：buildTreeFromV3Flat（V3.1 flat 分层）──
function testV3FlatSynthetic() {
  console.log('[synthetic] buildTreeFromV3Flat');
  const props = [
    { type: 'page', propertiesID: '1', propertiesPID: '0', propertiesName: '页面1' },
    { type: 'popup', propertiesID: '2', propertiesPID: '1', propertiesName: '地址选择器' },
    { type: 'object', propertiesID: '3', propertiesPID: '2', propertiesName: '省份', eventTypeValue: 'select', regionId: 'overlay:地址选择器', rect: { x1: 1, y1: 2, x2: 30, y2: 20 } },
    { type: 'object', propertiesID: '4', propertiesPID: '1', propertiesName: '产品名称', eventTypeValue: 'input', regionId: 'card:产品目录', rect: { x1: 1, y1: 2, x2: 30, y2: 20 } },
  ];
  const tree = buildTreeFromV3Flat(props);
  check(countLeaves(tree) === 2, `2 个控件全部挂树（实际 ${countLeaves(tree)}）`);
  check(tree.children.length === 1, `1 个顶层页面节点（实际 ${tree.children.length}）`);
  const page = tree.children[0];
  check(!!page && page.role === 'page' && page.label === '页面1', 'page 节点存在');
  const dialog = page && page.children.find((c) => c.role === 'dialog' && c.label === '地址选择器');
  check(!!dialog, 'dialog 挂在 page 下');
  check(!!dialog && dialog.items.length === 1 && dialog.items[0].name === '省份', '弹窗控件挂 dialog 下（跳过重复 overlay 层）');
  const card = page && page.children.find((c) => c.role === 'card' && c.label === '产品目录');
  check(!!card, 'card 挂在 page 下');
  check(!!card && card.items.length === 1 && card.items[0].name === '产品名称', '卡片控件挂 card 下');
}

function testHtmlSource() {
  console.log('[html] buildHtml 交互结构（源码）');
  const src = readFileSync(new URL('../../scripts/tools/layer-tree-from-properties.mjs', import.meta.url), 'utf8');
  check(src.includes('function buildHtml'), 'buildHtml 存在');
  check(src.includes('tree-branch'), '分支节点 class 存在（可折叠）');
  check(src.includes('tree-chevron'), 'chevron 渲染');
  check(src.includes('tree-children'), 'children 容器（折叠目标）');
  check(src.includes('tree-bbox-tag'), 'bbox 标签渲染');
  check(src.includes("addEventListener('click'"), '点击 toggle 监听');
  check(src.includes('treeSearch'), '搜索逻辑存在');
  check(src.includes('expandAll') && src.includes('collapseAll'), '全部展开/收起按钮');
  check(src.includes('treeStat'), '统计节点存在');
}

// ── 真实数据（traj 38 phase 3 / screenshot #8734）──
async function testRealData() {
  console.log('[real data] traj 38 latest phase_highlight');
  const db = getDB();
  try {
    const stepPhaseRows = await db('trajectory_step')
      .select('trajectory_phase_id')
      .where({ trajectory_id: 38 })
      .whereNotNull('trajectory_phase_id')
      .distinct();
    const stepPhaseIds = stepPhaseRows.map((r) => Number(r.trajectory_phase_id)).filter((n) => Number.isFinite(n) && n > 0);
    const shot = stepPhaseIds.length
      ? await db('screenshot')
          .where({ trajectory_id: 38, kind: 'phase_highlight' })
          .whereIn('trajectory_phase_id', stepPhaseIds)
          .orderBy('id', 'desc')
          .first()
      : null;
    check(!!shot, 'traj 38 存在有步骤的 phase_highlight 截图');
    if (!shot) return;
    const meta = typeof shot.metadata_json === 'string' ? JSON.parse(shot.metadata_json) : shot.metadata_json;
    const elements = (meta?.elements || []).filter((e) => e && e.rect);
    check(elements.length >= 1, `阶段截图元素 >= 1（实际 ${elements.length}）`);
    const withLayers = elements.filter((e) => Array.isArray(e.layers) && e.layers.length).length;
    check(withLayers === elements.length, `全部元素带 layers（实际 ${withLayers}/${elements.length}）`);
    const tree = buildTreeFromElements(elements);
    check(countBranches(tree) >= 1, `分层树分支 >= 1（实际 ${countBranches(tree)}）`);
    check(countLeaves(tree) === elements.length, `叶子数 = 元素数（实际 ${countLeaves(tree)}）`);

    // step 模式：旧数据无 layers/region_id → 多数未分区；新录制才会完整分层
    const phaseId = shot.trajectory_phase_id;
    const steps = await db('trajectory_step').select('element_json').where({ trajectory_id: 38, trajectory_phase_id: phaseId }).limit(200);
    const normalized = [];
    for (const s of steps) {
      let el = null;
      try { el = typeof s.element_json === 'string' ? JSON.parse(s.element_json) : s.element_json; } catch {}
      normalized.push({
        label: String(el?.formLabel ?? el?.text ?? '').trim() || '(无标签)',
        action: String(el?.target_kind ?? '').trim(),
        regionId: String(el?.region_id ?? '').trim(),
        layers: Array.isArray(el?.layers) ? el.layers : null,
        hasBbox: !!el?.bbox,
      });
    }
    check(normalized.length >= 1, `步骤 >= 1（实际 ${normalized.length}）`);
    const zoned = normalized.filter((s) => s.layers || s.regionId).length;
    check(zoned >= 1, `至少 1 个步骤带分层（实际 ${zoned} 分区）`);
  } finally {
    await db.destroy();
  }
}

async function main() {
  testStepsSynthetic();
  testElementsSynthetic();
  testPropertiesSynthetic();
  testGroupsSynthetic();
  testV3FlatSynthetic();
  testHtmlSource();
  await testRealData();
  if (failures) {
    console.error(`\ncharacterize-layer-tree: ${failures} FAILURE(S)`);
    process.exit(1);
  }
  console.log('\ncharacterize-layer-tree: OK');
}

main();
