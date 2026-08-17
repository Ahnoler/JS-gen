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
  console.log('[real data] traj 38 / #8734');
  const db = getDB();
  try {
    const shot = await db('screenshot').where({ id: 8734 }).first();
    const meta = typeof shot.metadata_json === 'string' ? JSON.parse(shot.metadata_json) : shot.metadata_json;
    const elements = (meta?.elements || []).filter((e) => e && e.rect);
    check(elements.length >= 150, `阶段截图元素 >= 150（实际 ${elements.length}）`);
    const withLayers = elements.filter((e) => Array.isArray(e.layers) && e.layers.length).length;
    check(withLayers === elements.length, `全部元素带 layers（实际 ${withLayers}/${elements.length}）`);
    const tree = buildTreeFromElements(elements);
    check(countBranches(tree) >= 5, `分层树分支 >= 5（实际 ${countBranches(tree)}）`);
    check(countLeaves(tree) === elements.length, `叶子数 = 元素数（实际 ${countLeaves(tree)}）`);

    // step 模式：旧数据无 layers/region_id → 全未分区（修复后新录制才会分层）
    const steps = await db('trajectory_step').select('element_json').where({ trajectory_id: 38, trajectory_phase_id: 629 }).limit(200);
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
    check(normalized.length >= 90, `步骤 >= 90（实际 ${normalized.length}）`);
    const zoned = normalized.filter((s) => s.layers || s.regionId).length;
    check(zoned === 0, `旧数据全未分区（实际 ${zoned} 分区）——修复后新数据应 >0`);
  } finally {
    await db.destroy();
  }
}

async function main() {
  testStepsSynthetic();
  testElementsSynthetic();
  testPropertiesSynthetic();
  testHtmlSource();
  await testRealData();
  if (failures) {
    console.error(`\ncharacterize-layer-tree: ${failures} FAILURE(S)`);
    process.exit(1);
  }
  console.log('\ncharacterize-layer-tree: OK');
}

main();
