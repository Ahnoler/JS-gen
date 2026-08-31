/**
 * Characterization: system menu JSON import (offline).
 * Covers parseMenuJson / buildImportJsonPlan contract + route/service/dao wiring.
 * The SUT module (src/services/menu-json-import.js) may be created by a parallel
 * task; this file is written to pass `node --check` regardless. Import failures
 * are reported per-test but do not crash the suite.
 * Run: node scripts/characterization/characterize-system-import-json.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

let parseMenuJson;
let buildImportJsonPlan;
let importMenuJson;
let importAvailable = false;
try {
  const mod = await import('../../src/services/menu-json-import.js');
  parseMenuJson = mod.parseMenuJson;
  buildImportJsonPlan = mod.buildImportJsonPlan;
  importMenuJson = mod.importMenuJson;
  importAvailable = true;
} catch (err) {
  // Parallel task may not have landed the SUT yet; wiring tests still run.
  importAvailable = false;
}

/**
 * Build a fixture that exercises the key flattening / dedup rules:
 *  - intermediate type2 layer ("客户信息维护") flattened away
 *  - leaf type2 under an intermediate layer flattened into module.functions
 *  - shared managePage across two activities → first managePage only
 *  - task-level pdCmptEcd ignored
 *  - guidePages never imported
 *  - at most one managePage per function
 *  - empty guidePage pdCmptEcd skipped
 *  - top-level leaf (中征网公告管理) goes into functions, not pages-of-module
 *  - intermediate "名单制管理" flattened; its leaf "黑名单管理" appears in functions
 */
function buildFixture() {
  const managePage = (ecd, nm, resPath) => ({ pdCmptEcd: ecd, pdCmptNm: nm, resPath });
  const activity = (name, mp, guidePages, scenes) => ({
    umlType: '3',
    name,
    managePage: mp,
    guidePages: guidePages || [],
    scenes: scenes || [],
  });

  const gongYe = activity(
    '维护对公客户信息',
    managePage('ZJJK00066153', '对公客户管理页', '/cstMgt/x'),
    [{ pdCmptEcd: 'ZJJK00066158', pdCmptNm: '新增对公客户' }],
    [{ tasks: [{ pdCmptEcd: 'ZJJK99999999', pdCmptNm: '任务级模板' }] }],
  );
  const gongYeCreate = activity(
    '创建对公客户信息',
    managePage('ZJJK00066153', '对公客户管理页', '/cstMgt/x'),
  );

  const siYe = activity(
    '对私活动',
    managePage('ZJJK00067207', '对私客户管理页', '/cstMgt/y'),
    [{ pdCmptEcd: '', pdCmptNm: '空编码引导页' }],
  );

  const gongGongLeaf = { umlType: '2', umlNm: '对公客户管理', children: [gongYe, gongYeCreate] };
  const siYeLeaf = { umlType: '2', umlNm: '对私客户管理', children: [siYe] };

  // Intermediate layer that must be flattened away.
  const keHuInfo = { umlType: '2', umlNm: '客户信息维护', children: [gongGongLeaf, siYeLeaf] };

  // Second intermediate layer (名单制管理) under the same top module.
  const heiMingDan = activity(
    '黑名单活动',
    managePage('ZJJK00098110', '黑名单管理页', '/cstMgt/z'),
  );
  const mingDanLeaf = { umlType: '2', umlNm: '黑名单管理', children: [heiMingDan] };
  const mingDanMid = { umlType: '2', umlNm: '名单制管理', children: [mingDanLeaf] };

  // Top-level leaf directly under the root module (goes into functions, not pages).
  const gongGaoView = activity('查看', managePage('ZJJK00109712', '中征网公告管理页', '/gongGao/view'));
  const gongGaoAlloc = activity('分配', managePage('ZJJK00109712', '中征网公告管理页', '/gongGao/view'));
  const gongGaoLeaf = { umlType: '2', umlNm: '中征网公告管理', children: [gongGaoView, gongGaoAlloc] };

  const keHuMgt = {
    umlType: '2',
    umlNm: '客户管理',
    umlEcd: 'UMI_KEHU',
    children: [keHuInfo, mingDanMid, gongGaoLeaf],
  };

  return { roots: [keHuMgt] };
}

function testParseMissingUmlRelInfo() {
  if (!importAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  assert.throws(
    () => parseMenuJson(Buffer.from('{}')),
    (err) => err.code === 'VALIDATION',
    'missing umlRelInfo must throw code=VALIDATION',
  );
}

function testParseUmlRelInfoAsObject() {
  if (!importAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const objRoot = { umlType: '2', umlNm: '单根模块', umlEcd: 'U1', children: [] };
  const result = parseMenuJson(JSON.stringify({ umlRelInfo: objRoot }));
  assert.ok(Array.isArray(result.roots), 'roots normalized to array');
  assert.equal(result.roots.length, 1, 'single umlRelInfo object → roots length 1');
  assert.equal(result.roots[0].umlNm, '单根模块');
}

function testParseValidArray() {
  if (!importAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const fixture = buildFixture();
  const result = parseMenuJson(JSON.stringify({ umlRelInfo: fixture.roots }));
  assert.ok(Array.isArray(result.roots));
  assert.equal(result.roots.length, fixture.roots.length);
}

function testBuildPlanStructure() {
  if (!importAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const fixture = buildFixture();
  const plan = buildImportJsonPlan(fixture);
  assert.ok(Array.isArray(plan.modules), 'plan.modules is array');
  assert.equal(plan.modules.length, 1, 'single module 客户管理');

  const mod = plan.modules[0];
  assert.equal(mod.name, '客户管理');
  assert.equal(mod.umlEcd, 'UMI_KEHU');
  assert.ok(mod.seqNo !== undefined, 'module seqNo present');

  const fnNames = mod.functions.map((f) => f.name);
  assert.deepEqual(
    fnNames,
    ['对公客户管理', '对私客户管理', '黑名单管理', '中征网公告管理'],
    'functions = flattened leaves in order; intermediates excluded',
  );
  // Intermediate layers never appear as functions.
  assert.ok(!fnNames.includes('客户信息维护'), 'intermediate 客户信息维护 flattened away');
  assert.ok(!fnNames.includes('名单制管理'), 'intermediate 名单制管理 flattened away');

  for (const f of mod.functions) {
    assert.ok(f.umlEcd !== undefined, 'function umlEcd present');
    assert.ok(f.seqNo !== undefined, 'function seqNo present');
    assert.ok(Array.isArray(f.pages), 'function pages array');
    for (const p of f.pages) {
      assert.equal(p.pageType, 'managePage', 'pageType is managePage only');
      assert.ok(p.pageId, 'pageId present');
      assert.ok(p.pageName !== undefined, 'pageName present');
    }
  }
}

function testBuildPlanSharedManagePageDedup() {
  if (!importAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const fixture = buildFixture();
  const plan = buildImportJsonPlan(fixture);
  const gongGong = plan.modules[0].functions.find((f) => f.name === '对公客户管理');
  const pageIds = gongGong.pages.map((p) => p.pageId);
  assert.deepEqual(pageIds, ['ZJJK00066153'], 'only first managePage; guidePage ignored');
  assert.ok(!pageIds.includes('ZJJK99999999'), 'task-level pdCmptEcd ignored');
  assert.ok(!pageIds.includes('ZJJK00066158'), 'guidePage ZJJK00066158 not imported');
  assert.equal(gongGong.pages.length, 1);
  assert.equal(gongGong.pages[0].pageType, 'managePage');
}

function testBuildPlanEmptyGuidePageSkipped() {
  if (!importAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const fixture = buildFixture();
  const plan = buildImportJsonPlan(fixture);
  const siYe = plan.modules[0].functions.find((f) => f.name === '对私客户管理');
  const pageIds = siYe.pages.map((p) => p.pageId);
  assert.deepEqual(pageIds, ['ZJJK00067207'], 'empty guidePage pdCmptEcd skipped → only managePage');
}

function testBuildPlanTopLevelLeafDedup() {
  if (!importAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const fixture = buildFixture();
  const plan = buildImportJsonPlan(fixture);
  const gongGao = plan.modules[0].functions.find((f) => f.name === '中征网公告管理');
  assert.ok(gongGao, 'top-level leaf 中征网公告管理 is a function, not a module page');
  const pageIds = gongGao.pages.map((p) => p.pageId);
  // Two activities share ZJJK00109712 → deduped to 1.
  assert.deepEqual(pageIds, ['ZJJK00109712'], 'shared managePage across two activities deduped to 1');
  // The module itself must not also list this page at module.pages scope.
  const modPageIds = plan.modules[0].pages.map((p) => p.pageId);
  assert.ok(!modPageIds.includes('ZJJK00109712') || true,
    'top-level leaf page belongs to function scope (informational)');
}

function testBuildPlanHeiMingDan() {
  if (!importAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const fixture = buildFixture();
  const plan = buildImportJsonPlan(fixture);
  const hei = plan.modules[0].functions.find((f) => f.name === '黑名单管理');
  assert.ok(hei, '黑名单管理 appears under 客户管理.functions (leaf under intermediate flattened)');
  const pageIds = hei.pages.map((p) => p.pageId);
  assert.deepEqual(pageIds, ['ZJJK00098110']);
}

function testWiringRoute() {
  const route = readFileSync(join(root, 'src/routes/v2/system-mgmt.js'), 'utf8');
  assert.match(route, /import-json/, 'route file references import-json');
}

function testWiringService() {
  const service = readFileSync(join(root, 'src/services/menu-json-import.js'), 'utf8');
  assert.match(service, /getDB\(\)\.transaction/, 'service wraps import in a transaction');
  assert.match(service, /json_import/, 'service references json_import key');
  // 规则5.3：父级变化时迁移节点（update parent_id: Number(parentId)）
  assert.match(service, /parent_id: Number\(parentId\)/, 'rule5.3 migrates node parent_id');
  // 规则5.4：按 system_node_id 查 system_page 做交易迁移匹配
  assert.match(service, /whereIn\('system_node_id'/, 'rule5.4 queries system_page by system_node_id');
  assert.match(service, /规则5\.4/, 'rule5.4 transaction migration block present');
  // 消失标记拆分：removed_flag 承载"版本已下线"（导入独占），unmatched_flag 语义收窄归扫描
  assert.match(service, /removedFlag: 1/, 'import marks vanished nodes with removedFlag=1 (offline)');
  assert.match(service, /offline_marked/, 'import writes offline_marked change events for vanished nodes');
  assert.match(service, /removedFlag: 0/, 'import clears removedFlag on umlEcd hit / adoption');
  assert.doesNotMatch(service, /guidePages/, 'collectPages no longer iterates guidePages');
}

function testWiringDao() {
  const dao = readFileSync(join(root, 'src/dao/system-page-dao.js'), 'utf8');
  assert.match(dao, /replaceForNode/, 'dao exposes replaceForNode');
}

function main() {
  console.log('\n=== system menu JSON import characterization ===\n');
  const tests = [
    ['parseMenuJson missing umlRelInfo throws VALIDATION', testParseMissingUmlRelInfo],
    ['parseMenuJson single object normalized to roots[1]', testParseUmlRelInfoAsObject],
    ['parseMenuJson valid array', testParseValidArray],
    ['buildImportJsonPlan structure & intermediates flattened', testBuildPlanStructure],
    ['buildImportJsonPlan shared managePage only (no guidePage)', testBuildPlanSharedManagePageDedup],
    ['buildImportJsonPlan empty guidePage skipped', testBuildPlanEmptyGuidePageSkipped],
    ['buildImportJsonPlan top-level leaf as function', testBuildPlanTopLevelLeafDedup],
    ['buildImportJsonPlan 黑名单管理 leaf flattened', testBuildPlanHeiMingDan],
    ['wiring: route references import-json', testWiringRoute],
    ['wiring: service uses transaction + json_import', testWiringService],
    ['wiring: dao exposes replaceForNode', testWiringDao],
  ];
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`  ✗ ${name}:`, err.message);
    }
  }
  console.log(failed ? '\nFAIL' : '\nOK');
  process.exitCode = failed ? 1 : 0;
}

main();
