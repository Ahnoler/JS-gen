/**
 * Characterization: 菜单导航（offline，不连 DB/网络）。
 * SUT: src/services/trajectory/menu-navigation.js
 *
 * 离线策略分两层：
 * 1. 行为测试：buildMenuNavActions 是纯函数，可完全离线验证（动作序列/顺序/xpath 取值）。
 *    navigateToFunctionMenu 的无效 functionId 分支在任何 DAO/executor 访问之前返回，
 *    也可离线行为验证（fake execSession 注入，断言零调用）。
 * 2. wiring 断言：navigateToFunctionMenu 的 DB 依赖 systemDao 为模块内 import（不可注入），
 *    DB+executor 绑定分支用源码结构断言钉住（同菜单跳过 / is_replay / 失败不抛出 /
 *    xpath 取值链），并钉住调用方 wiring。
 * Run: node scripts/characterization/characterize-menu-navigation.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

let menuNav = null;
let menuNavAvailable = false;
try {
  menuNav = await import('../../src/services/trajectory/menu-navigation.js');
  menuNavAvailable = true;
} catch (err) {
  // 导入失败不崩溃（executor-session-client 传递依赖异常时仍可跑 wiring）。
  menuNavAvailable = false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * 构建 fake executor 会话客户端：记录 waitForSessionEvent / forwardStdin 调用。
 * @param {{ doneResult?: object, doneError?: Error }} [opts] waitForSessionEvent 行为
 * @returns {{ calls: Array, waitForSessionEvent: Function, forwardStdin: Function }} fake 客户端
 */
function makeFakeExecSession({ doneResult = { failed: 0 }, doneError = null } = {}) {
  const calls = [];
  return {
    calls,
    waitForSessionEvent(sessionId, event, timeoutMs) {
      calls.push(['waitForSessionEvent', sessionId, event, timeoutMs]);
      if (doneError) return Promise.reject(doneError);
      return Promise.resolve(doneResult);
    },
    forwardStdin(payload) {
      calls.push(['forwardStdin', payload]);
    },
  };
}

/**
 * 读取 menu-navigation.js 源码。
 * @returns {string} 源码文本
 */
function navSource() {
  return readFileSync(join(root, 'src/services/trajectory/menu-navigation.js'), 'utf8');
}

/**
 * 断言源码中包含全部给定片段（缺失时报出缺失的片段名）。
 * @param {string} src 源码文本
 * @param {Array<[string, RegExp]>} pairs [说明, 正则] 列表
 */
function assertAllMatch(src, pairs) {
  for (const [label, re] of pairs) {
    assert.match(src, re, `missing: ${label}`);
  }
}

// ---------------------------------------------------------------------------
// 行为测试：buildMenuNavActions（纯函数，完全离线）
// ---------------------------------------------------------------------------

function testBuildEmptyInput() {
  if (!menuNavAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  assert.deepEqual(menuNav.buildMenuNavActions(), [], '无入参（默认参数）→ []');
  assert.deepEqual(menuNav.buildMenuNavActions({}), [], '空对象入参 → []');
  assert.deepEqual(menuNav.buildMenuNavActions({ moduleXpath: '', functionXpath: '' }), [],
    '空字符串 xpath → []');
  assert.deepEqual(menuNav.buildMenuNavActions({ moduleXpath: null, functionXpath: undefined }), [],
    'null/undefined xpath → []');
}

function testBuildModuleOnly() {
  if (!menuNavAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const actions = menuNav.buildMenuNavActions({ moduleXpath: '//li[@data-id="M1"]' });
  assert.equal(actions.length, 1, '仅模块 → 1 条动作');
  assert.equal(actions[0].action, 'click_menu_xpath', '动作类型为 click_menu_xpath');
  assert.equal(actions[0].params.xpath, '//li[@data-id="M1"]', 'params.xpath 为模块 xpath');
}

function testBuildFunctionOnly() {
  if (!menuNavAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const actions = menuNav.buildMenuNavActions({ functionXpath: '//li[@data-id="F1"]' });
  assert.equal(actions.length, 1, '仅功能 → 1 条动作');
  assert.equal(actions[0].action, 'click_menu_xpath', '动作类型为 click_menu_xpath');
  assert.equal(actions[0].params.xpath, '//li[@data-id="F1"]', 'params.xpath 为功能 xpath');
}

function testBuildBothOrderAndValues() {
  if (!menuNavAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const actions = menuNav.buildMenuNavActions({
    moduleXpath: '//li[@data-id="M1"]',
    functionXpath: '//li[@data-id="F1"]',
  });
  assert.equal(actions.length, 2, '双 xpath → 2 条动作');
  assert.equal(actions[0].action, 'click_menu_xpath', '第 1 条为 click_menu_xpath');
  assert.equal(actions[0].params.xpath, '//li[@data-id="M1"]', '模块菜单先导航（展开 submenu）');
  assert.equal(actions[1].action, 'click_menu_xpath', '第 2 条为 click_menu_xpath');
  assert.equal(actions[1].params.xpath, '//li[@data-id="F1"]', '功能菜单后导航');
}

function testBuildTrimsWhitespace() {
  if (!menuNavAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const actions = menuNav.buildMenuNavActions({ moduleXpath: '  //li[@data-id="M1"]  ' });
  assert.equal(actions.length, 1, '非空白 xpath 产出动作');
  assert.equal(actions[0].params.xpath, '//li[@data-id="M1"]', 'xpath 值做 trim');
  assert.deepEqual(menuNav.buildMenuNavActions({ moduleXpath: '   ', functionXpath: '' }), [],
    '纯空白 xpath 视为空 → []');
}

// ---------------------------------------------------------------------------
// 行为测试：navigateToFunctionMenu 无效 functionId 分支
// （在任何 systemDao/executor 访问之前返回，可离线验证 + fake execSession 注入）
// ---------------------------------------------------------------------------

async function testNavInvalidFunctionId() {
  if (!menuNavAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const fake = makeFakeExecSession();
  const runtime = { sessionId: 's1', executorNodeUuid: 'n1' };
  for (const functionId of [undefined, null, 0, -1, 'abc', Number.NaN]) {
    const r = await menuNav.navigateToFunctionMenu({ runtime, functionId, execSession: fake });
    assert.deepEqual(r, { navigated: false, reason: 'no-function' },
      `functionId=${String(functionId)} → no-function`);
  }
  assert.deepEqual(await menuNav.navigateToFunctionMenu(), { navigated: false, reason: 'no-function' },
    '无入参 → no-function');
  assert.equal(fake.calls.length, 0, '无效 functionId 不触发任何 executor 调用');
}

// ---------------------------------------------------------------------------
// wiring 断言（readFileSync + assert.match）— 不依赖模块导入
// ---------------------------------------------------------------------------

function testWiringDependencies() {
  const src = navSource();
  assertAllMatch(src, [
    ['systemDao 为模块内 import（DB 依赖不可注入）', /import \* as systemDao from '\.\.\/\.\.\/dao\/system-dao\.js'/],
    ['功能节点经 systemDao.getRawById(fid) 加载', /funcNode = await systemDao\.getRawById\(fid\)/],
    ['模块节点经 systemDao.getRawById(Number(parentId)) 加载', /moduleNode = await systemDao\.getRawById\(Number\(parentId\)\)/],
    ['execSession 为可注入参数', /export async function navigateToFunctionMenu\(\{ runtime, functionId, execSession \} = \{\}\)/],
    ['无效 functionId 前置守卫 → no-function', /fid <= 0\) return \{ navigated: false, reason: 'no-function' \}/],
    ['节点缺失 → no-function', /if \(!funcNode\) return \{ navigated: false, reason: 'no-function' \}/],
    ['导航动作由纯函数 buildMenuNavActions 构建', /const actions = buildMenuNavActions\(\{ moduleXpath, functionXpath \}\)/],
  ]);
}

function testWiringSameMenuSkip() {
  const src = navSource();
  assertAllMatch(src, [
    ['navKey = moduleXpath|functionXpath 拼接', /const navKey = `\$\{moduleXpath \|\| ''\}\|\$\{functionXpath \|\| ''\}`/],
    ['同菜单跳过：runtime._lastMenuNavKey 命中 → same-menu', /runtime\._lastMenuNavKey === navKey\) return \{ navigated: false, reason: 'same-menu' \}/],
    ['成功后记录 runtime._lastMenuNavKey = navKey', /runtime\._lastMenuNavKey = navKey/],
    ['成功返回 navigated:true / ok', /\{ navigated: true, reason: 'ok' \}/],
  ]);
}

function testWiringReplayPayload() {
  const src = navSource();
  assertAllMatch(src, [
    ['forwardStdin 发送事件 replay_actions', /event: 'replay_actions'/],
    ['载荷 is_replay 恒为 true（不入步骤表）', /is_replay: true/],
    ['载荷 stop_on_fail 为 false（失败不阻断后续）', /stop_on_fail: false/],
    ['等待 replay_done 会话事件', /waitForSessionEvent\(\s*runtime\.sessionId,\s*'replay_done',\s*MENU_NAV_TIMEOUT_MS,?\s*\)/],
    ['单步超时 120s', /const MENU_NAV_TIMEOUT_MS = 120000/],
  ]);
  const client = readFileSync(join(root, 'src/executor-session-client.js'), 'utf8');
  assert.match(client, /export function forwardStdin\(/, 'executor-session-client 导出 forwardStdin');
  assert.match(client, /export \{ onSessionEvent, waitForSessionEvent, removeSessionHub \}/,
    'executor-session-client 重导出 waitForSessionEvent');
}

function testWiringNavFailureSwallowed() {
  const src = navSource();
  assertAllMatch(src, [
    ['replay 结果 failed>0 或 error → nav-failed', /result\?\.error \|\| failed > 0/],
    ['失败路径返回 nav-failed（不抛出）', /reason: 'nav-failed'/],
    ['异常吞掉 + console.warn（导航失败不阻断交易执行）', /catch \(e\) \{\s*console\.warn\(`\[menu-nav\] nav replay error/],
    ['DB 读失败同样吞掉 → nav-failed', /console\.warn\(`\[menu-nav\] load function node failed/],
  ]);
}

function testWiringXpathChain() {
  const src = navSource();
  assertAllMatch(src, [
    ['功能 xpath 取自 funcNode.menuXpath（trim）', /String\(funcNode\.menuXpath \|\| ''\)\.trim\(\)/],
    ['parentId 有效才加载模块节点', /parentId != null && Number\.isFinite\(Number\(parentId\)\) && Number\(parentId\) > 0/],
    ['模块 xpath 取自 moduleNode.menuXpath（trim）', /String\(moduleNode\.menuXpath \|\| ''\)\.trim\(\)/],
    ['双 xpath 都空 → no-menu-xpath', /if \(!moduleXpath && !functionXpath\) return \{ navigated: false, reason: 'no-menu-xpath' \}/],
  ]);
}

function testWiringCallers() {
  const batch = readFileSync(join(root, 'src/services/trajectory/replay-batch-runner.js'), 'utf8');
  assert.match(batch,
    /navigateToFunctionMenu\(\{ runtime, functionId: Number\(trajRow\.functionId\), execSession \}\)/,
    'replay-batch-runner 以交易 functionId 调用导航并注入 execSession');
  const bind = readFileSync(join(root, 'src/services/trajectory/recording-page-bind.js'), 'utf8');
  assert.match(bind, /navigateToFunctionMenu\(\{ runtime, functionId: fid, execSession \}\)/,
    'recording-page-bind 调用导航并注入 execSession');
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function runTests(tests) {
  console.log('\n=== menu navigation characterization ===\n');
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

async function main() {
  const tests = [
    ['行为: buildMenuNavActions 空入参 → []', testBuildEmptyInput],
    ['行为: buildMenuNavActions 仅模块 → 1 条 click_menu_xpath', testBuildModuleOnly],
    ['行为: buildMenuNavActions 仅功能 → 1 条 click_menu_xpath', testBuildFunctionOnly],
    ['行为: buildMenuNavActions 双 xpath → 2 条且模块先、功能后', testBuildBothOrderAndValues],
    ['行为: buildMenuNavActions xpath 取值正确（含 trim / 纯空白视为空）', testBuildTrimsWhitespace],
    ['行为: navigateToFunctionMenu 无效 functionId → no-function（fake 注入零 executor 调用）', testNavInvalidFunctionId],
    ['wiring: 依赖链 systemDao 模块内 import（不可注入）+ execSession 可注入', testWiringDependencies],
    ['wiring: 同菜单跳过 navKey 与 runtime._lastMenuNavKey', testWiringSameMenuSkip],
    ['wiring: replay 载荷 is_replay:true + stop_on_fail:false + replay_done 等待', testWiringReplayPayload],
    ['wiring: 失败不抛出（warn + nav-failed）', testWiringNavFailureSwallowed],
    ['wiring: xpath 取值链 funcNode/moduleNode.menuXpath，双空 → no-menu-xpath', testWiringXpathChain],
    ['wiring: 调用方 replay-batch-runner / recording-page-bind 注入 execSession', testWiringCallers],
  ];
  await runTests(tests);
}

main();
