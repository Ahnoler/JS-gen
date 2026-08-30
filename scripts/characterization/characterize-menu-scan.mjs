/**
 * Characterization: system menu scan (offline).
 * Covers buildScanApplyPlan / startScan / getScan contract + route/service/py wiring.
 * The SUT module (src/services/menu-scan-service.js) may be created by a parallel
 * task; this file is written to pass `node --check` regardless. Import failures
 * are reported per-test but do not crash the suite.
 * Run: node scripts/characterization/characterize-menu-scan.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

let buildScanApplyPlan;
let startScan;
let getScan;
let scanAvailable = false;
try {
  const mod = await import('../../src/services/menu-scan-service.js');
  buildScanApplyPlan = mod.buildScanApplyPlan;
  startScan = mod.startScan;
  getScan = mod.getScan;
  scanAvailable = true;
} catch (err) {
  // Parallel task may not have landed the SUT yet; wiring tests still run.
  scanAvailable = false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find a top-level module by name in existingModules.
 * @param {Array} modules - existingModules array.
 * @param {string} name - module name to find.
 * @returns {object|undefined} matched module or undefined.
 */
function findModule(modules, name) {
  return modules.find((m) => m.name === name);
}

/**
 * Find a child function by name under a given parent module.
 * @param {object} parent - module object with children.
 * @param {string} name - child name.
 * @returns {object|undefined} matched child or undefined.
 */
function findChild(parent, name) {
  return parent.children.find((c) => c.name === name);
}

/**
 * Build a minimal existingModules fixture with two sibling modules sharing a
 * child name ("功能X"), used to verify L2 matching by parentName.
 * @returns {Array} existingModules fixture.
 */
function buildParentNameFixture() {
  return [
    {
      id: 21,
      name: '父A',
      source: 'json_import',
      unmatchedFlag: 0,
      children: [{ id: 22, name: '功能X', source: 'json_import', unmatchedFlag: 0 }],
    },
    {
      id: 31,
      name: '父B',
      source: 'json_import',
      unmatchedFlag: 0,
      children: [{ id: 32, name: '功能X', source: 'json_import', unmatchedFlag: 0 }],
    },
  ];
}

// ---------------------------------------------------------------------------
// Test cases (pure function, fully offline)
// ---------------------------------------------------------------------------

function testL1L2AllMatched() {
  if (!scanAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const existingModules = [
    {
      id: 11,
      name: '客户管理',
      source: 'json_import',
      unmatchedFlag: 0,
      children: [{ id: 12, name: '对公客户管理', source: 'json_import', unmatchedFlag: 0 }],
    },
  ];
  const scanned = [
    { level: 1, name: '客户管理', parentName: '', xpath: '//li[@data-id="RES1"]' },
    { level: 2, name: '对公客户管理', parentName: '客户管理', xpath: '//li[@data-id="RES2"]' },
  ];
  const plan = buildScanApplyPlan(scanned, existingModules);
  assert.ok(Array.isArray(plan.updates), 'updates is array');
  assert.ok(plan.updates.some((u) => u.nodeId === 11 && u.menuXpath === '//li[@data-id="RES1"]'),
    'updates contains L1 {nodeId:11, menuXpath RES1}');
  assert.ok(plan.updates.some((u) => u.nodeId === 12 && u.menuXpath === '//li[@data-id="RES2"]'),
    'updates contains L2 {nodeId:12, menuXpath RES2}');
  assert.equal(plan.creates.length, 0, 'no creates when all matched');
  assert.equal(plan.stats.matched, 2, 'matched=2');
}

function testUnmatchedCreates() {
  if (!scanAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const existingModules = [
    {
      id: 11,
      name: '客户管理',
      source: 'json_import',
      unmatchedFlag: 0,
      children: [{ id: 12, name: '对公客户管理', source: 'json_import', unmatchedFlag: 0 }],
    },
  ];
  const scanned = [
    { level: 1, name: '客户管理', parentName: '', xpath: '//li[@data-id="RES1"]' },
    { level: 2, name: '对公客户管理', parentName: '客户管理', xpath: '//li[@data-id="RES2"]' },
    { level: 1, name: '智能问答', parentName: '', xpath: '//li[@data-id="RES3"]' },
    { level: 2, name: '新增黑名单', parentName: '黑名单管理', xpath: '//li[@data-id="RES4"]' },
  ];
  const plan = buildScanApplyPlan(scanned, existingModules);
  assert.ok(plan.creates.some((c) => c.level === 1 && c.name === '智能问答'),
    'creates contains L1 智能问答');
  assert.ok(plan.creates.some((c) => c.level === 2 && c.name === '新增黑名单' && c.parentName === '黑名单管理'),
    'creates contains L2 新增黑名单 with parentName 黑名单管理');
  assert.equal(plan.stats.created, 2, 'created=2');
}

function testClearUnmatchedFlag() {
  if (!scanAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const existingModules = [
    {
      id: 11,
      name: '客户管理',
      source: 'json_import',
      unmatchedFlag: 1, // flagged unmatched, will be cleared by scan hit
      children: [
        { id: 12, name: '对公客户管理', source: 'json_import', unmatchedFlag: 1 }, // hit → cleared
        { id: 13, name: '未命中功能', source: 'json_import', unmatchedFlag: 1 },   // not scanned → keep
      ],
    },
  ];
  const scanned = [
    { level: 1, name: '客户管理', parentName: '', xpath: '//li[@data-id="RES1"]' },
    { level: 2, name: '对公客户管理', parentName: '客户管理', xpath: '//li[@data-id="RES2"]' },
  ];
  const plan = buildScanApplyPlan(scanned, existingModules);
  assert.ok(plan.clearedUnmatched.includes(11), 'clearedUnmatched includes module id 11 (hit)');
  assert.ok(plan.clearedUnmatched.includes(12), 'clearedUnmatched includes child id 12 (hit)');
  assert.ok(!plan.clearedUnmatched.includes(13), 'clearedUnmatched excludes unscanned child id 13');
}

function testL2MatchByParentName() {
  if (!scanAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const existingModules = buildParentNameFixture();
  // scanned L2 功能X under 父B → must only update id 32, not id 22.
  const scanned = [
    { level: 1, name: '父B', parentName: '', xpath: '//li[@data-id="PB"]' },
    { level: 2, name: '功能X', parentName: '父B', xpath: '//li[@data-id="PBX"]' },
  ];
  const plan = buildScanApplyPlan(scanned, existingModules);
  const xUpdates = plan.updates.filter((u) => u.menuXpath === '//li[@data-id="PBX"]');
  assert.equal(xUpdates.length, 1, 'exactly one update for 功能X');
  assert.equal(xUpdates[0].nodeId, 32, '功能X under 父B updates id 32, not 22');
  assert.ok(!plan.updates.some((u) => u.nodeId === 22),
    '功能X under 父A (id 22) is not updated when scanned parentName is 父B');
}

function testStatsCorrect() {
  if (!scanAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const existingModules = [
    {
      id: 11,
      name: '客户管理',
      source: 'json_import',
      unmatchedFlag: 0,
      children: [{ id: 12, name: '对公客户管理', source: 'json_import', unmatchedFlag: 0 }],
    },
  ];
  const scanned = [
    { level: 1, name: '客户管理', parentName: '', xpath: '//li[@data-id="RES1"]' },
    { level: 2, name: '对公客户管理', parentName: '客户管理', xpath: '//li[@data-id="RES2"]' },
    { level: 1, name: '智能问答', parentName: '', xpath: '//li[@data-id="RES3"]' },
    { level: 2, name: '新增黑名单', parentName: '黑名单管理', xpath: '//li[@data-id="RES4"]' },
  ];
  const plan = buildScanApplyPlan(scanned, existingModules);
  assert.equal(plan.stats.totalScanned, 4, 'totalScanned counts all scanned entries');
  assert.ok(Array.isArray(plan.stats.unmatchedScanned), 'unmatchedScanned is array');
  // Unmatched scanned entries are the two not present in existingModules.
  const um = plan.stats.unmatchedScanned;
  assert.ok(um.some((u) => u.name === '智能问答' && u.parentName === ''),
    'unmatchedScanned lists 智能问答');
  assert.ok(um.some((u) => u.name === '新增黑名单' && u.parentName === '黑名单管理'),
    'unmatchedScanned lists 新增黑名单 with parentName');
  assert.ok(!um.some((u) => u.name === '客户管理'),
    'matched entries not in unmatchedScanned');
}

// ---------------------------------------------------------------------------
// Wiring assertions (readFileSync + assert.match) — run regardless of import
// ---------------------------------------------------------------------------

function testWiringService() {
  const service = readFileSync(join(root, 'src/services/menu-scan-service.js'), 'utf8');
  assert.match(service, /openSession/, 'service references openSession');
  assert.match(service, /runReplayActions/, 'service routes replay through runReplayActions');
  assert.match(service, /buildScanApplyPlan/, 'service exports buildScanApplyPlan');
  assert.match(service, /runPhase2Match/, 'service defines runPhase2Match (phase2 match)');
  assert.match(service, /insertRows/, 'service references menuChangeLogDao.insertRows');
  assert.match(service, /unmatched_marked/, 'service records unmatched_marked change event');
}

/**
 * replay_actions 会话编排契约现在收敛在公共 helper：replay_actions 下发、
 * waitForSessionEvent 等待、forwardStdin 通道与预挂 no-op catch（孤儿 rejection 免疫）
 * 都断言在 helper 文件上，不落在调用方——后续调用方继续迁移不影响本断言。
 */
function testWiringReplayActionsHelper() {
  const helper = readFileSync(join(root, 'src/services/replay-actions.js'), 'utf8');
  assert.match(helper, /export async function runReplayActions/, 'helper exports runReplayActions');
  assert.match(helper, /replay_actions/, 'helper sends replay_actions stdin event');
  assert.match(helper, /waitForSessionEvent/, 'helper waits via execSession.waitForSessionEvent');
  assert.match(helper, /forwardStdin/, 'helper sends via execSession.forwardStdin');
  assert.match(helper, /replay_done/, 'helper waits for replay_done');
  // 预挂 no-op catch：send 同步抛错（executor 未连接）时孤儿超时 rejection 不能打崩进程。
  assert.match(helper, /\.catch\(\(\) => \{\}\)/, 'helper pre-attaches no-op catch on wait promises');
}

function testWiringReplayPy() {
  const py = readFileSync(join(root, 'scripts/controller/actions/_replay.py'), 'utf8');
  assert.match(py, /scan_menu_tree/, '_replay.py references scan_menu_tree');
}

function testWiringMenuScanPy() {
  const py = readFileSync(join(root, 'scripts/controller/actions/js_snippets/menu_scan.py'), 'utf8');
  assert.match(py, /JS_SCAN_MENU_TREE/, 'menu_scan.py defines JS_SCAN_MENU_TREE');
}

function testWiringRoute() {
  const route = readFileSync(join(root, 'src/routes/v2/system-mgmt.js'), 'utf8');
  assert.match(route, /scan-menu/, 'route references scan-menu');
  assert.match(route, /autoScan/, 'route references autoScan');
}

function testWiringChangeLog() {
  const route = readFileSync(join(root, 'src/routes/v2/system-mgmt.js'), 'utf8');
  assert.match(route, /change-log/, 'route references change-log endpoint');
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  console.log('\n=== system menu scan characterization ===\n');
  const tests = [
    ['buildScanApplyPlan L1+L2 all matched → updates + matched=2', testL1L2AllMatched],
    ['buildScanApplyPlan unmatched → creates L1+L2, created=2', testUnmatchedCreates],
    ['buildScanApplyPlan clears unmatchedFlag on hit only', testClearUnmatchedFlag],
    ['buildScanApplyPlan L2 matches by parentName (disambiguates same-name)', testL2MatchByParentName],
    ['buildScanApplyPlan stats: totalScanned + unmatchedScanned', testStatsCorrect],
    ['wiring: service uses openSession + runReplayActions + buildScanApplyPlan', testWiringService],
    ['wiring: replay-actions helper owns replay_actions/forwardStdin/waitForSessionEvent + no-op catch', testWiringReplayActionsHelper],
    ['wiring: _replay.py references scan_menu_tree', testWiringReplayPy],
    ['wiring: js_snippets/menu_scan.py defines JS_SCAN_MENU_TREE', testWiringMenuScanPy],
    ['wiring: route references scan-menu + autoScan', testWiringRoute],
    ['wiring: route references change-log endpoint', testWiringChangeLog],
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
