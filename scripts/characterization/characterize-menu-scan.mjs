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

let listEmptyPageIdFunctions;
let pageIdFillAvailable = false;
try {
  const pageidMod = await import('../../src/services/menu-scan-pageid.js');
  listEmptyPageIdFunctions = pageidMod.listEmptyPageIdFunctions;
  pageIdFillAvailable = true;
} catch (err) {
  pageIdFillAvailable = false;
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

/** xpath data-id 命中错名幽灵 → updates 带 name 改为 SUT 文案 */
function testL2XpathMatchRenamesWrongName() {
  if (!scanAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const existingModules = [
    {
      id: 2,
      name: '产品管理',
      source: 'json_import',
      unmatchedFlag: 0,
      children: [
        {
          id: 230,
          name: '产品信息管理',
          source: 'json_import',
          unmatchedFlag: 0,
          menuXpath: "//li[@data-id='RES04066']",
        },
      ],
    },
  ];
  const scanned = [
    { level: 1, name: '产品管理', parentName: '', xpath: "//li[@data-id='RES000000016']" },
    {
      level: 2,
      name: '核心产品映射',
      parentName: '产品管理',
      xpath: "//li[@data-id='RES04066']",
    },
  ];
  const plan = buildScanApplyPlan(scanned, existingModules);
  const u = plan.updates.find((x) => x.nodeId === 230);
  assert.ok(u, 'xpath hit updates ghost 230');
  assert.equal(u.name, '核心产品映射', 'rename to SUT leaf label');
  assert.ok(!plan.creates.some((c) => c.name === '核心产品映射'), 'no duplicate create');
}

/** 同名幽灵已占用其他 data-id → 扫描新叶应 create，勿覆盖 */
function testL2NameMatchSkipsForeignXpath() {
  if (!scanAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const existingModules = [
    {
      id: 2,
      name: '产品管理',
      source: 'json_import',
      unmatchedFlag: 0,
      children: [
        {
          id: 230,
          name: '产品信息管理',
          source: 'json_import',
          unmatchedFlag: 0,
          menuXpath: "//li[@data-id='RES04066']",
        },
      ],
    },
  ];
  const scanned = [
    { level: 1, name: '产品管理', parentName: '', xpath: "//li[@data-id='RES000000016']" },
    {
      level: 2,
      name: '产品信息管理',
      parentName: '产品管理',
      xpath: "//li[@data-id='RES99999']",
    },
  ];
  const plan = buildScanApplyPlan(scanned, existingModules);
  assert.ok(
    plan.creates.some((c) => c.level === 2 && c.name === '产品信息管理'),
    'creates instead of overwriting foreign xpath on same name'
  );
  assert.ok(!plan.updates.some((u) => u.nodeId === 230 && String(u.menuXpath).includes('RES99999')),
    'does not steal 230 onto RES99999');
}

/** 父模块下仅有 intermediate=1 同名叶 → 扫描同名 L2 升格合入，不 create */
function testL2PromoteSameNameIntermediate() {
  if (!scanAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const existingModules = [
    {
      id: 11,
      name: '客户管理',
      source: 'json_import',
      unmatchedFlag: 0,
      children: [
        {
          id: 12,
          name: '对公客户管理',
          source: 'json_import',
          unmatchedFlag: 0,
          intermediateFlag: 1,
          menuXpath: '',
        },
      ],
    },
  ];
  const scanned = [
    { level: 1, name: '客户管理', parentName: '', xpath: '//li[@data-id="RES1"]' },
    { level: 2, name: '对公客户管理', parentName: '客户管理', xpath: '//li[@data-id="RES2"]' },
  ];
  const plan = buildScanApplyPlan(scanned, existingModules);
  const promoted = plan.updates.find((u) => u.nodeId === 12);
  assert.ok(promoted, 'updates contains intermediate id 12');
  assert.equal(promoted.promote, true, 'promote semantics on intermediate match');
  assert.equal(promoted.menuXpath, '//li[@data-id="RES2"]', 'writes scanned xpath onto intermediate');
  assert.ok(!plan.creates.some((c) => c.name === '对公客户管理'),
    'creates must not contain promoted name');
  assert.equal(plan.stats.matched, 2, 'matched=2 (L1 + promoted L2)');
}

/** intermediate 分组标题与扫描叶异名 → 不升格，走 create */
function testL2DifferentNameDoesNotPromoteIntermediate() {
  if (!scanAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const existingModules = [
    {
      id: 2,
      name: '产品管理',
      source: 'json_import',
      unmatchedFlag: 0,
      children: [
        {
          id: 230,
          name: '产品信息管理',
          source: 'json_import',
          unmatchedFlag: 0,
          intermediateFlag: 1,
          menuXpath: '',
        },
      ],
    },
  ];
  const scanned = [
    { level: 1, name: '产品管理', parentName: '', xpath: "//li[@data-id='RES000000016']" },
    {
      level: 2,
      name: '产品阶段管理',
      parentName: '产品管理',
      xpath: "//li[@data-id='RES04070']",
    },
  ];
  const plan = buildScanApplyPlan(scanned, existingModules);
  assert.ok(!plan.updates.some((u) => u.nodeId === 230),
    'does not update intermediate 产品信息管理 for异名叶');
  assert.ok(!plan.updates.some((u) => u.promote === true), 'no promote updates');
  assert.ok(
    plan.creates.some((c) => c.level === 2 && c.name === '产品阶段管理' && c.parentName === '产品管理'),
    'creates 产品阶段管理',
  );
}

/** 已有可导航同名叶 → 仍更新可导航 id，不升格 sibling intermediate */
function testL2NavigableWinsOverIntermediateSibling() {
  if (!scanAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const existingModules = [
    {
      id: 11,
      name: '客户管理',
      source: 'json_import',
      unmatchedFlag: 0,
      children: [
        {
          id: 1478,
          name: '对公客户管理',
          source: 'ai',
          unmatchedFlag: 0,
          intermediateFlag: 0,
          menuXpath: '',
        },
        {
          id: 7,
          name: '对公客户管理',
          source: 'json_import',
          unmatchedFlag: 0,
          intermediateFlag: 1,
          menuXpath: '',
        },
      ],
    },
  ];
  const scanned = [
    { level: 1, name: '客户管理', parentName: '', xpath: '//li[@data-id="RES1"]' },
    { level: 2, name: '对公客户管理', parentName: '客户管理', xpath: '//li[@data-id="RES2"]' },
  ];
  const plan = buildScanApplyPlan(scanned, existingModules);
  const l2Updates = plan.updates.filter((u) => u.menuXpath === '//li[@data-id="RES2"]');
  assert.equal(l2Updates.length, 1, 'exactly one L2 update for scanned xpath');
  assert.equal(l2Updates[0].nodeId, 1478, 'updates navigable id 1478, not intermediate 7');
  assert.ok(!plan.updates.some((u) => u.nodeId === 7),
    'does not promote intermediate sibling when navigable same-name exists');
  assert.ok(!plan.creates.some((c) => c.name === '对公客户管理'),
    'no duplicate create for same-name leaf');
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
  // W5-A 拆分：menu-scan-service.js 变薄 re-export + buildScanApplyPlan 纯函数，
  // 其余职责迁至 menu-scan-job/session/apply——断言改为拼接读取四文件（AGENTS.md
  // "keep markers + tests read concatenated files"），断言语义不变。
  const service = [
    'src/services/menu-scan-service.js',
    'src/services/menu-scan-job.js',
    'src/services/menu-scan-session.js',
    'src/services/menu-scan-apply.js',
    'src/services/menu-scan-pageid.js',
  ].map((p) => readFileSync(join(root, p), 'utf8')).join('\n');
  assert.match(service, /openSession/, 'service references openSession');
  assert.match(service, /runReplayActions/, 'service routes replay through runReplayActions');
  assert.match(service, /buildScanApplyPlan/, 'service exports buildScanApplyPlan');
  assert.match(service, /runPhase2Match/, 'service defines runPhase2Match (phase2 match)');
  assert.match(service, /insertRows/, 'service references menuChangeLogDao.insertRows');
  assert.match(service, /unmatched_marked/, 'service records unmatched_marked change event');
  assert.match(service, /assignAiUmlEcdFromId/, 'AI creates assign umlEcd from node id');
  assert.match(service, /adoptModelingUmlEcdUnderSystem|pickUmlEcdFromIntermediates/,
    'scan adopts modeling umlEcd from intermediate');
}

function testWiringSessionPageIdFill() {
  const session = readFileSync(join(root, 'src/services/menu-scan-session.js'), 'utf8');
  assert.match(session, /fillEmptyPageIdsForSystem/, 'runScan calls pageId fill after apply');
  assert.match(session, /pageIdCandidates|pageIdFilled|pageIdSkipped/, 'runScan merges pageId stats into job.stats');
  assert.match(
    session,
    /fillEmptyPageIdsForSystem[\s\S]*?adoptModelingUmlEcdUnderSystem/,
    'runScan re-adopts modeling umlEcd after pageId fill',
  );
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
  assert.match(py, /_DIRECT_REPLAY_ACTIONS/, '_replay.py defines _DIRECT_REPLAY_ACTIONS registry');
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

function testWiringPageIdFill() {
  const pageid = readFileSync(join(root, 'src/services/menu-scan-pageid.js'), 'utf8');
  assert.match(pageid, /export function listEmptyPageIdFunctions/, 'lists empty pd_cmpt_ecd L2');
  assert.match(pageid, /export async function fillEmptyPageIdsForSystem/, 'fill entry exported');
  assert.match(pageid, /read_page_component_code/, 'reads tianyuan codes');
  assert.match(pageid, /click_menu_xpath/, 'clicks menu xpath');
  assert.match(pageid, /lastModuleXpath/, 'skips redundant L1 menu click when same parent');
  assert.match(pageid, /\.sort\(\(a, b\) => \(a\.parentId/, 'orders candidates by parentId for L1 coalescing');
  assert.match(pageid, /if \(!functionXpath\)/, 'skips when L2 menu_xpath empty');
  assert.match(pageid, /const functionClickRow = results\.find/, 'locates function click result row');
  assert.match(pageid, /if \(!functionClickRow\?\.ok\)/, 'skips when L2 click failed');
  assert.match(pageid, /writeFunctionLandingPage/, 'writes landing via shared helper');
  assert.match(pageid, /if \(wrote\)/, 'pageIdFilled only when write returns true');
  assert.match(pageid, /pageIdSkipped|pageIdFilled/, 'returns fill stats');
  assert.match(pageid, /opts\.sources|sourceSet/, 'supports optional source filter');
  assert.match(pageid, /PAGEID_FILL_MAX = 500/, 'fill max covers large AI empty sets');
}

function testListEmptyPageIdFunctionsPure() {
  if (!pageIdFillAvailable) { console.log('    (skipped: menu-scan-pageid not importable)'); return; }
  const nodes = [
    { id: 1, type: 1, parentId: 0, name: 'S', pdCmptEcd: '', menuXpath: '' },
    { id: 10, type: 2, parentId: 1, name: 'M', pdCmptEcd: '', menuXpath: '//m' },
    { id: 11, type: 3, parentId: 10, name: 'empty', pdCmptEcd: '', menuXpath: '//a', source: 'ai' },
    { id: 12, type: 3, parentId: 10, name: 'filled', pdCmptEcd: 'ZJJK1', menuXpath: '//b', source: 'ai' },
    { id: 13, type: 3, parentId: 10, name: 'no-xpath', pdCmptEcd: '', menuXpath: '', source: 'json_import' },
  ];
  const list = listEmptyPageIdFunctions(nodes, 1);
  assert.equal(list.length, 2, 'empty pd_cmpt_ecd L2 includes no-xpath');
  assert.equal(list[0].id, 11, 'first candidate is empty with xpath');
  assert.ok(list.some((n) => n.id === 13), 'no-xpath empty L2 still listed as candidate');
  const aiOnly = listEmptyPageIdFunctions(nodes, 1, { sources: ['ai'] });
  assert.equal(aiOnly.length, 1, 'sources=["ai"] keeps only ai empty');
  assert.equal(aiOnly[0].id, 11);
}

function testWiringFillPageIdRoute() {
  const route = readFileSync(join(root, 'src/routes/v2/system-mgmt.js'), 'utf8');
  assert.match(route, /fill-pageid/, 'route exposes fill-pageid');
  assert.match(route, /startFillPageIds/, 'route calls startFillPageIds');
  const job = readFileSync(join(root, 'src/services/menu-scan-job.js'), 'utf8');
  assert.match(job, /export async function startFillPageIds/, 'job exports startFillPageIds');
  const session = readFileSync(join(root, 'src/services/menu-scan-session.js'), 'utf8');
  assert.match(session, /export async function runFillPageIds/, 'session exports runFillPageIds');
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
    ['buildScanApplyPlan L2 xpath hit renames wrong-name ghost', testL2XpathMatchRenamesWrongName],
    ['buildScanApplyPlan L2 name match skips node with foreign xpath', testL2NameMatchSkipsForeignXpath],
    ['buildScanApplyPlan L2 same-name intermediate → promote, no create', testL2PromoteSameNameIntermediate],
    ['buildScanApplyPlan L2 异名叶 does not promote intermediate → create', testL2DifferentNameDoesNotPromoteIntermediate],
    ['buildScanApplyPlan L2 navigable same-name wins over intermediate sibling', testL2NavigableWinsOverIntermediateSibling],
    ['buildScanApplyPlan stats: totalScanned + unmatchedScanned', testStatsCorrect],
    ['wiring: service uses openSession + runReplayActions + buildScanApplyPlan', testWiringService],
    ['wiring: runScan calls fillEmptyPageIdsForSystem after apply', testWiringSessionPageIdFill],
    ['wiring: replay-actions helper owns replay_actions/forwardStdin/waitForSessionEvent + no-op catch', testWiringReplayActionsHelper],
    ['wiring: _replay.py references scan_menu_tree', testWiringReplayPy],
    ['wiring: js_snippets/menu_scan.py defines JS_SCAN_MENU_TREE', testWiringMenuScanPy],
    ['wiring: route references scan-menu + autoScan', testWiringRoute],
    ['wiring: route references change-log endpoint', testWiringChangeLog],
    ['wiring: menu-scan-pageid lists/fills empty L2 pageIds', testWiringPageIdFill],
    ['listEmptyPageIdFunctions filters empty pd_cmpt_ecd L2 only', testListEmptyPageIdFunctionsPure],
    ['wiring: fill-pageid route + startFillPageIds + runFillPageIds', testWiringFillPageIdRoute],
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
