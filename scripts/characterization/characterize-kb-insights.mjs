/**
 * characterize-kb-insights: KB Insights 纯函数 pin（matcher/cards-loader/rollup/影响推导）。
 * 全部 fixture 驱动（临时目录/内存数组），不依赖真实 data/kb 与 DB。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
let passed = 0;
/** 单例断言包装：通过计数，失败抛出。 */
function run(name, fn) {
  try { fn(); passed += 1; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n${e.message}`); throw e; }
}

// ── 段 1：menu-path matcher ──
async function testMatcher() {
  const m = await import(pathToFileURL(join(ROOT, 'src/services/menu-path-matcher.js')).href);
  const nodes = [
    { id: 1, parentId: 0, name: '信贷系统', type: 1 },
    { id: 11, parentId: 1, name: '授信管理', type: 2 },
    { id: 111, parentId: 11, name: '对公授信管理', type: 2 },
    { id: 1111, parentId: 111, name: '新增对公授信管理', type: 3 },
    { id: 12, parentId: 1, name: '押品管理', type: 2 },
    { id: 121, parentId: 12, name: ' 押品信息管理 ', type: 2 }, // 名字带空格
  ];
  run('matcher: 三级路径解析到功能节点', () => {
    const r = m.resolveMenuPath('授信管理/对公授信管理/新增对公授信管理', nodes);
    assert.equal(r.matchStatus, 'matched');
    assert.equal(r.matchedNodeId, 1111);
    assert.equal(r.matchedNodeType, 3);
  });
  run('matcher: 段名与节点名空白规范化后相等', () => {
    const r = m.resolveMenuPath('押品管理/押品信息管理', nodes);
    assert.equal(r.matchStatus, 'matched');
    assert.equal(r.matchedNodeId, 121);
  });
  run('matcher: 卡停在模块层也算 matched', () => {
    const r = m.resolveMenuPath('信贷系统/授信管理', nodes);
    assert.equal(r.matchStatus, 'matched');
    assert.equal(r.matchedNodeId, 11);
  });
  run('matcher: 中段缺失 → possibly-stale 带缺失段名与前缀', () => {
    const r = m.resolveMenuPath('授信管理/已删除菜单/新增对公授信管理', nodes);
    assert.equal(r.matchStatus, 'possibly-stale');
    assert.equal(r.missingSegment, '已删除菜单');
    assert.equal(r.resolvedPrefix, '授信管理');
  });
  run('matcher: 首段就缺失 → possibly-stale 空前缀', () => {
    const r = m.resolveMenuPath('不存在系统/某菜单', nodes);
    assert.equal(r.matchStatus, 'possibly-stale');
    assert.equal(r.missingSegment, '不存在系统');
  });
  run('matcher: 自由文本（含括号说明）→ unparsed', () => {
    const r = m.resolveMenuPath('未采到（押品管理菜单树普查未发现专属子菜单）', nodes);
    assert.equal(r.matchStatus, 'unparsed');
  });
  run('matcher: 单段路径 → unparsed', () => {
    assert.equal(m.resolveMenuPath('首页', nodes).matchStatus, 'unparsed');
  });
  run('matcher: 同级同名兄弟 → matched 且 ambiguous', () => {
    const dup = [...nodes, { id: 999, parentId: 1, name: '授信管理', type: 2 }];
    const r = m.resolveMenuPath('信贷系统/授信管理', dup);
    assert.equal(r.matchStatus, 'matched');
    assert.equal(r.ambiguous, true);
  });
  run('matcher: isFreeTextMenuPath 括号/「未采到」判定', () => {
    assert.equal(m.isFreeTextMenuPath('未采到（xxx）'), true);
    assert.equal(m.isFreeTextMenuPath('工作台/任务事项/待办任务'), false);
  });
}
// ── 段 2：KB 卡只读器（临时目录 fixture）──
async function testCardsLoader() {
  const { listFlowCards } = await import(pathToFileURL(join(ROOT, 'src/services/kb-flow-cards.js')).href);
  const dir = mkdtempSync(join(tmpdir(), 'kb-cards-'));
  writeFileSync(join(dir, 'b.json'), JSON.stringify({ flow: '卡片B', menu_path: '授信管理/对公授信管理', source: 'K1 笔记', source_refs: { trajectory_ids: ['26081317115618826'] } }));
  writeFileSync(join(dir, 'a.json'), JSON.stringify({ flow: '卡片A', menu_path: '押品管理/押品信息管理' }));
  writeFileSync(join(dir, 'broken.json'), '{ not json');
  writeFileSync(join(dir, 'nocard.json'), JSON.stringify({ menu_path: 'x/y' })); // 缺 flow 键
  try {
    const cards = await listFlowCards({ dir });
    run('cards: 按文件名排序且透传字段', () => {
      assert.equal(cards.length, 2);
      assert.equal(cards[0].flow, '卡片A');
      assert.equal(cards[1].source_refs.trajectory_ids[0], '26081317115618826');
    });
    run('cards: 损坏/缺 flow 键跳过', () => {
      assert.ok(!cards.some((c) => c.flow == null));
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
await testCardsLoader();
await testMatcher();
// ── 段 3：dao 聚合方法源码 pin ──
async function testDaoPins() {
  const { readFileSync } = await import('node:fs');
  const tj = readFileSync(join(ROOT, 'src/dao/trajectory-dao.js'), 'utf-8');
  run('dao pin: statsByFunctionIds 按 function_id 分组且取 MAX(updated_at)', () => {
    const i = tj.indexOf('export async function statsByFunctionIds');
    assert.ok(i > 0, 'statsByFunctionIds 存在');
    const body = tj.slice(i, i + 1200);
    assert.match(body, /whereIn\('function_id'/);
    assert.match(body, /max\('updated_at' as last_at\)|MAX\(updated_at\) as last_at/);
    assert.match(body, /groupBy\('function_id'\)/);
  });
  const bd = readFileSync(join(ROOT, 'src/dao/batch-recording-dao.js'), 'utf-8');
  run('dao pin: statsByFunctionId join batch_id 且 success 计数', () => {
    const i = bd.indexOf('export async function statsByFunctionId');
    assert.ok(i > 0, 'statsByFunctionId 存在');
    const body = bd.slice(i, i + 1600);
    assert.match(body, /batch_recording_item/);
    assert.match(body, /batch_id/);
    assert.match(body, /'success'/);
    assert.match(body, /groupBy\('function_id'\)|groupBy\('j\.function_id'\)/);
  });
}
await testDaoPins();
console.log(`characterize-kb-insights(matcher+cards+dao): OK (${passed} checks)`);
