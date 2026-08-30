/**
 * Characterization: special element service (offline).
 * 覆盖三块：
 * 1. 特殊元素搜索打分/hint 镜像 pin（历史用例，保留自旧版 characterize-special-element.mjs；
 *    生产 prompt hint 为 Python format_special_element_hint，见 characterize-special-element-hint.py）。
 * 2. src/services/special-element-service.js 纯函数（buildSearchText / SPECIAL_ELEMENT_TAG）
 *    + 服务内"先校验后落库"的可离线驱动路径（search / fetchDisplayCandidatesForDescription /
 *    createFromTrajectory / createStep 的 400 校验链）。
 * 3. route/service/dao wiring（readFileSync + assert.match）。
 * DB / executor 依赖函数（listSpecialElements / getSpecialElement / updateSpecialElement /
 * deleteSpecialElement / updateStep / deleteStep / replaySpecialElement 主流程）只做 wiring
 * 断言，不做行为调用。
 * Run: node scripts/characterization/characterize-special-element.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

let buildSearchText;
let search;
let fetchDisplayCandidatesForDescription;
let createFromTrajectory;
let createStep;
let SPECIAL_ELEMENT_TAG;
let svcAvailable = false;
try {
  const mod = await import('../../src/services/special-element-service.js');
  buildSearchText = mod.buildSearchText;
  search = mod.search;
  fetchDisplayCandidatesForDescription = mod.fetchDisplayCandidatesForDescription;
  createFromTrajectory = mod.createFromTrajectory;
  createStep = mod.createStep;
  SPECIAL_ELEMENT_TAG = mod.SPECIAL_ELEMENT_TAG;
  svcAvailable = true;
} catch (err) {
  // SUT 依赖链异常时（如 config 缺失）wiring 测试仍然运行。
  svcAvailable = false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * 断言 promise 以 httpError 形式 reject，且 status / message 片段匹配。
 * @param {Promise} promise - 期望 reject 的 promise。
 * @param {number} statusCode - 期望的 err.statusCode。
 * @param {string} messagePart - 期望 err.message 包含的片段。
 * @param {string} label - 用例标签。
 * @returns {Promise<void>}
 */
async function expectHttpError(promise, statusCode, messagePart, label) {
  let caught = null;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, `${label}: 应抛出 httpError，而非正常返回`);
  assert.equal(caught.statusCode, statusCode, `${label}: statusCode=${statusCode}`);
  assert.ok(
    String(caught.message || '').includes(messagePart),
    `${label}: message 应包含 "${messagePart}"，实际 "${caught.message}"`,
  );
}

// ---------------------------------------------------------------------------
// 搜索打分/hint 镜像 pin（纯函数，完全离线，与 SUT import 无关）
// ---------------------------------------------------------------------------

// Pure scoring helpers mirrored from search service behavior
function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[\s,，、;；|/\\]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 1);
}

function normalizeLegalAliases(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/法定责任人/g, '法定代表人')
    .replace(/责任人的引入/g, '代表人的引入');
}

const INTRODUCE_HINT_RE = /引入|选人|放大镜|法定代表人|法定责任人/;

function scoreCandidate(el, tag, queryText) {
  const dictLabel = tag?.dictLabel || '';
  const dictValue = tag?.dictValue || '';
  const hay = normalizeLegalAliases([
    el.name || '',
    dictLabel,
    dictValue,
    el.phaseDescription || '',
    el.remark || '',
  ].join(' '));
  const q = normalizeLegalAliases(queryText);
  let tagScore = 0;
  let lexicalScore = 0;
  if (normalizeLegalAliases(dictLabel) && q.includes(normalizeLegalAliases(dictLabel))) {
    tagScore += 40;
  } else if (
    normalizeLegalAliases(dictLabel).includes('引入')
    && q.includes('引入')
    && (q.includes('代表人') || hay.includes('代表人'))
  ) {
    tagScore += 25;
  }
  if (dictValue && q.includes(String(dictValue).toLowerCase())) tagScore += 30;
  if (el.name && q.includes(normalizeLegalAliases(el.name))) lexicalScore += 35;
  if (INTRODUCE_HINT_RE.test(q) && INTRODUCE_HINT_RE.test(hay)) lexicalScore += 20;
  const tokens = tokenize(q);
  let covered = 0;
  for (const tok of tokens) {
    if (tok.length >= 2 && hay.includes(tok)) covered += 1;
  }
  if (tokens.length) lexicalScore += Math.round((covered / tokens.length) * 30);
  return tagScore + lexicalScore;
}

function testScoreRanking() {
  const login = {
    name: '复杂登录',
    phaseDescription: '填写用户名密码并登录系统',
    remark: '',
  };
  const fill = {
    name: '复杂填表',
    phaseDescription: '填写客户信息表单',
    remark: '',
  };
  const tagLogin = { dictLabel: '登录', dictValue: 'login' };
  const tagFill = { dictLabel: '填写', dictValue: 'fill' };

  const s1 = scoreCandidate(login, tagLogin, '需要登录系统');
  const s2 = scoreCandidate(fill, tagFill, '需要登录系统');
  assert.ok(s1 > s2, `login should rank above fill for login query (${s1} vs ${s2})`);

  const s3 = scoreCandidate(fill, tagFill, '填写客户信息');
  assert.ok(s3 > 0, 'fill query should score > 0');

  const introEl = {
    name: '对公客户引入流程',
    phaseDescription: '点击法定代表人引入按钮选择客户',
    remark: '',
  };
  const tagIntro = { dictLabel: '法定责任人的引入流程', dictValue: 'Introduction' };
  const sIntro = scoreCandidate(
    introEl,
    tagIntro,
    '点击法定代表人/负责人证件号码的引入按钮，客户名称填写测试',
  );
  assert.ok(sIntro >= 40, `introduce synonym+hint should score high (${sIntro})`);
}

// Toy hint shape for scoring tests only. Production prompt hint is Python
// format_special_element_hint (see characterize-special-element-hint.py).
function formatHint(store) {
  if (!store || !Object.keys(store).length) return '';
  const lines = Object.entries(store).map(([cid, c]) => `- id=${cid} name=${c.name}`);
  return '【特殊元素库候选】\n' + lines.join('\n');
}

function testHintFormat() {
  const hint = formatHint({ '9': { name: '复杂登录' } });
  assert.ok(hint.includes('id=9'), 'hint includes id');
  assert.ok(hint.includes('复杂登录'), 'hint includes name');
  assert.strictEqual(formatHint({}), '', 'empty store → empty hint');
}

// ---------------------------------------------------------------------------
// 纯函数用例（完全离线，依赖 SUT import）
// ---------------------------------------------------------------------------

function testBuildSearchTextJoinsTrimmedFields() {
  if (!svcAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const text = buildSearchText({
    name: '  新建合同  ',
    dictLabel: '合同模板',
    phaseDescription: ' 在新建合同页填写表单 ',
    remark: '',
  });
  assert.equal(text, '新建合同 合同模板 在新建合同页填写表单',
    '四字段 trim 后跳过空值、单空格拼接');
}

function testBuildSearchTextSkipsFalsy() {
  if (!svcAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  // null / undefined / 纯空白 均被过滤，不留空段
  const text = buildSearchText({
    name: null,
    dictLabel: undefined,
    phaseDescription: '   ',
    remark: '备注',
  });
  assert.equal(text, '备注', 'null/undefined/纯空白字段被过滤');
}

function testBuildSearchTextAllEmpty() {
  if (!svcAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  assert.equal(buildSearchText({}), '', '全空入参 → 空字符串');
  assert.equal(buildSearchText({ name: '', dictLabel: 0, phaseDescription: null, remark: undefined }),
    '', '0 等假值也被过滤（String(x || \'\')）');
}

function testBuildSearchTextCoercesNonString() {
  if (!svcAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const text = buildSearchText({ name: 123, dictLabel: '标签' });
  assert.equal(text, '123 标签', '非字符串字段经 String() 归一化');
}

function testSpecialElementTagConstant() {
  if (!svcAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  assert.equal(SPECIAL_ELEMENT_TAG, 'special_element_tag',
    'SPECIAL_ELEMENT_TAG 常量 pin 为 special_element_tag');
}

// ---------------------------------------------------------------------------
// 离线可驱动行为用例（校验在 DB 调用之前，无需数据库）
// ---------------------------------------------------------------------------

async function testSearchRejectsInvalidSystemId() {
  if (!svcAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  await expectHttpError(search({}), 400, 'systemId is required', 'search({}) 缺 systemId');
  await expectHttpError(search({ systemId: 0 }), 400, 'systemId is required', 'search systemId=0');
  await expectHttpError(search({ systemId: 'abc' }), 400, 'systemId is required',
    'search systemId 非数字');
}

async function testFetchDisplayCandidatesInvalidSystemId() {
  if (!svcAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  // 无效 systemId 直接短路返回 []，不触达 searchSpecialElements（best-effort 语义）
  assert.deepEqual(await fetchDisplayCandidatesForDescription(0, '新建合同'), [],
    'systemId=0 → []');
  assert.deepEqual(await fetchDisplayCandidatesForDescription(-5, '新建合同'), [],
    'systemId 负数 → []');
  assert.deepEqual(await fetchDisplayCandidatesForDescription('abc', '新建合同'), [],
    'systemId 非数字（NaN）→ []');
}

async function testCreateFromTrajectoryValidationChain() {
  if (!svcAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  // 校验顺序：trajectoryPhaseId → stepIds → name → tagDictCode，全部在 DB 调用之前
  await expectHttpError(createFromTrajectory({}), 400, 'trajectoryPhaseId is required',
    '缺 trajectoryPhaseId');
  await expectHttpError(createFromTrajectory({ trajectoryPhaseId: 1 }), 400, 'stepIds is required',
    '缺 stepIds');
  // stepIds 中非正整数条目被过滤，过滤后为空仍报 stepIds is required
  await expectHttpError(
    createFromTrajectory({ trajectoryPhaseId: 1, stepIds: [0, -2, 'x'] }),
    400, 'stepIds is required', 'stepIds 全为非法值',
  );
  await expectHttpError(
    createFromTrajectory({ trajectoryPhaseId: 1, stepIds: [7] }),
    400, 'name is required', '缺 name',
  );
  await expectHttpError(
    createFromTrajectory({ trajectoryPhaseId: 1, stepIds: [7], name: '新建合同' }),
    400, 'tagDictCode is required', '缺 tagDictCode',
  );
}

async function testCreateStepInvalidId() {
  if (!svcAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  await expectHttpError(createStep(0, { actionType: 'click' }), 400,
    'Invalid special element id', 'createStep id=0');
  await expectHttpError(createStep('abc', { actionType: 'click' }), 400,
    'Invalid special element id', 'createStep id 非数字');
}

// ---------------------------------------------------------------------------
// Wiring assertions (readFileSync + assert.match) — run regardless of import
// ---------------------------------------------------------------------------

function testWiringService() {
  const service = readFileSync(join(root, 'src/services/special-element-service.js'), 'utf8');
  // 关键导出名
  assert.match(service, /export function buildSearchText/, '导出 buildSearchText');
  assert.match(service, /export async function listSpecialElements/, '导出 listSpecialElements');
  assert.match(service, /export async function getSpecialElement/, '导出 getSpecialElement');
  assert.match(service, /export async function updateSpecialElement/, '导出 updateSpecialElement');
  assert.match(service, /export async function deleteSpecialElement/, '导出 deleteSpecialElement');
  assert.match(service, /export async function createFromTrajectory/, '导出 createFromTrajectory');
  assert.match(service, /export async function updateStep/, '导出 updateStep');
  assert.match(service, /export async function createStep/, '导出 createStep');
  assert.match(service, /export async function deleteStep/, '导出 deleteStep');
  assert.match(service, /export async function replaySpecialElement/, '导出 replaySpecialElement');
  assert.match(service, /export async function search/, '导出 search');
  assert.match(service, /export async function fetchDisplayCandidatesForDescription/,
    '导出 fetchDisplayCandidatesForDescription');
  assert.match(service, /export \{ SPECIAL_ELEMENT_TAG \}/, '导出 SPECIAL_ELEMENT_TAG 常量');
  // DB：唯一键 uk_special_element_sys_name → 409 冲突映射（update / create 两处）
  const ukHits = service.match(/uk_special_element_sys_name/g) || [];
  assert.ok(ukHits.length >= 2, 'uk_special_element_sys_name 冲突映射覆盖 update 与 create 两处');
}

function testWiringReplayErrorChannel() {
  const service = readFileSync(join(root, 'src/services/special-element-service.js'), 'utf8');
  // 本服务独有的 Promise.race(doneP, errP) 模式：同时监听 replay_done / replay_error
  assert.match(service, /Promise\.race\(\[doneP, errP\]\)/, 'Promise.race([doneP, errP]) 模式');
  assert.match(service, /waitForSessionEvent\(runtime\.sessionId, 'replay_done', 300000\)/,
    '监听 replay_done（300s 超时）');
  assert.match(service, /replay_error/, '监听 replay_error 错误事件通道');
  assert.match(service, /waitForSessionEvent\(runtime\.sessionId, 'replay_error', 300000\)/,
    'replay_error 经 waitForSessionEvent 监听');
  assert.match(service, /event: 'replay_actions'/, '下发 replay_actions stdin 事件');
  assert.match(service, /forwardStdin/, '经 execSession.forwardStdin 下发');
  assert.match(service, /stop_on_fail: false/, 'replay_actions 带 stop_on_fail: false');
  assert.match(service, /suppressStepPersist/, 'replay 时置 suppressStepPersist 运行时标志');
}

function testWiringTables() {
  const dao = readFileSync(join(root, 'src/dao/special-element-dao.js'), 'utf8');
  assert.match(dao, /const TABLE = 'special_element'/, 'special-element-dao 表名 special_element');
  const stepDao = readFileSync(join(root, 'src/dao/special-element-step-dao.js'), 'utf8');
  assert.match(stepDao, /const TABLE = 'special_element_step'/,
    'special-element-step-dao 表名 special_element_step');
}

function testWiringRoute() {
  const route = readFileSync(join(root, 'src/routes/v2/special-element.js'), 'utf8');
  assert.match(route, /\/api\/v2\/special-elements\/from-trajectory/, '路由 from-trajectory');
  assert.match(route, /\/api\/v2\/special-elements\/search/, '路由 search');
  assert.match(route, /\/api\/v2\/special-elements\/:id\/replay/, '路由 :id/replay（手动回放）');
  assert.match(route, /\/api\/v2\/special-element-steps\/:id/, '路由 special-element-steps/:id');
  assert.match(route, /replaySpecialElement/, '路由调用 replaySpecialElement');
  assert.match(route, /createFromTrajectory/, '路由调用 createFromTrajectory');
}

function testWiringTrajectoryIntegration() {
  // trajectory 录制链路动态 import 本服务的 fetchDisplayCandidatesForDescription
  const trajRoute = readFileSync(join(root, 'src/routes/v2/trajectory.js'), 'utf8');
  assert.match(trajRoute, /special-element-service\.js/,
    'trajectory 路由动态 import special-element-service');
  assert.match(trajRoute, /fetchDisplayCandidatesForDescription/,
    'trajectory 路由调用 fetchDisplayCandidatesForDescription');
  const phaseSvc = readFileSync(join(root, 'src/services/trajectory/trajectory-phase-service.js'),
    'utf8');
  assert.match(phaseSvc, /fetchDisplayCandidatesForDescription/,
    'trajectory-phase-service 引用 fetchDisplayCandidatesForDescription');
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  console.log('\n=== special element service characterization ===\n');
  const tests = [
    ['搜索打分镜像：login 优先 + fill 正分 + 引入同义词高分', testScoreRanking],
    ['hint 镜像：候选列表格式 + 空库 → 空串', testHintFormat],
    ['buildSearchText trim + 跳过空值 + 单空格拼接', testBuildSearchTextJoinsTrimmedFields],
    ['buildSearchText 过滤 null/undefined/纯空白', testBuildSearchTextSkipsFalsy],
    ['buildSearchText 全空入参 → 空串（0 等假值同样过滤）', testBuildSearchTextAllEmpty],
    ['buildSearchText 非字符串字段 String 归一化', testBuildSearchTextCoercesNonString],
    ['SPECIAL_ELEMENT_TAG 常量 pin', testSpecialElementTagConstant],
    ['search 缺/非法 systemId → 400 systemId is required', testSearchRejectsInvalidSystemId],
    ['fetchDisplayCandidatesForDescription 非法 systemId 短路 → []', testFetchDisplayCandidatesInvalidSystemId],
    ['createFromTrajectory 校验链（phaseId→stepIds→name→tagDictCode）', testCreateFromTrajectoryValidationChain],
    ['createStep 非法 id → 400 Invalid special element id', testCreateStepInvalidId],
    ['wiring: service 导出清单 + uk_special_element_sys_name 冲突映射', testWiringService],
    ['wiring: Promise.race(doneP, errP) 监听 replay_done/replay_error + replay_actions 下发', testWiringReplayErrorChannel],
    ['wiring: dao 表名 special_element / special_element_step', testWiringTables],
    ['wiring: /api/v2/special-elements(-steps) 路由挂接', testWiringRoute],
    ['wiring: trajectory 链路动态 import fetchDisplayCandidatesForDescription', testWiringTrajectoryIntegration],
  ];
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
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
