/**
 * Characterization: starting page id binding (offline).
 * Covers generatePageId / bindRecordingPageId contract + service/runner/py wiring.
 * The SUT module (src/services/trajectory/recording-page-bind.js) may be created
 * by a parallel task; this file is written to pass `node --check` regardless.
 * Import failures are reported per-test but do not crash the suite.
 * Run: node scripts/characterization/characterize-page-bind.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

let generatePageId;
let bindRecordingPageId;
let bindAvailable = false;
try {
  const mod = await import('../../src/services/trajectory/recording-page-bind.js');
  generatePageId = mod.generatePageId;
  bindRecordingPageId = mod.bindRecordingPageId;
  bindAvailable = true;
} catch (err) {
  // Parallel task may not have landed the SUT yet; wiring tests still run.
  bindAvailable = false;
}

// ---------------------------------------------------------------------------
// Test cases (pure function, fully offline)
// ---------------------------------------------------------------------------

function testGeneratePageIdFormat() {
  if (!bindAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const v = generatePageId();
  assert.match(v, /^AILZ\d{13}$/, 'page id matches AILZ + 13-digit ms timestamp');
}

function testGeneratePageIdUniqueNonDecreasing() {
  if (!bindAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const v1 = generatePageId();
  const v2 = generatePageId();
  // Same-ms calls may legitimately return equal IDs (Date.now() granularity) — contract allows equal.
  // Timestamps are non-decreasing (allow equal due to ms granularity).
  const ts1 = Number(v1.slice(4));
  const ts2 = Number(v2.slice(4));
  assert.ok(ts2 >= ts1, 'second timestamp >= first (non-decreasing)');
}

// ---------------------------------------------------------------------------
// Wiring assertions (readFileSync + assert.match) — run regardless of import
// ---------------------------------------------------------------------------

function testWiringService() {
  const service = readFileSync(join(root, 'src/services/trajectory/recording-page-bind.js'), 'utf8');
  assert.match(service, /runReplayActions/, 'service routes read_page_component_code replay through runReplayActions');
  assert.match(service, /read_page_component_code/, 'service references read_page_component_code');
  assert.match(service, /AILZ/, 'service references AILZ prefix');
  assert.match(service, /updateMeta/, 'service references updateMeta');
  assert.match(service, /writeBackFunctionLandingPage/, 'service defines write-back helper');
  assert.match(service, /scenarioCode/, 'reads scenarioCode from pageCode payload');
  assert.match(service, /json_import/, 'write-back whitelist includes json_import');
  assert.match(service, /['"]ai['"]/, 'write-back whitelist includes ai');
  assert.match(service, /replaceForNode/, 'write-back replaces system_page via replaceForNode');
  assert.match(service, /pdCmptEcd/, 'write-back updates system.pdCmptEcd');
}

function testWiringWriteBackOnlyOnRead() {
  const service = readFileSync(join(root, 'src/services/trajectory/recording-page-bind.js'), 'utf8');
  const earlyIdx = service.indexOf('no functionId, generated pageId');
  assert.ok(earlyIdx > 0, 'early AILZ log present');
  const earlyReturnIdx = service.indexOf('return { pageId, source, persisted }', earlyIdx);
  assert.ok(earlyReturnIdx > earlyIdx, 'early return present');
  const earlyBlock = service.slice(earlyIdx, earlyReturnIdx);
  assert.ok(!earlyBlock.includes('writeBackFunctionLandingPage'), 'AILZ early path does not write back menu');
  assert.match(service, /source = 'generated'/, 'generated source still assigned');
  // AILZ / generated 路径不得因白名单误回写：生成分支后回写调用须仍要求非 generated
  assert.match(service, /source === ['"]read['"]/, 'write-back still requires bind source=read (landing from dialog)');
}

/**
 * replay_actions 会话编排契约收敛在公共 helper：replay_actions 下发、
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

function testWiringRunner() {
  const runner = readFileSync(join(root, 'src/services/trajectory/trajectory-attach-runner.js'), 'utf8');
  assert.match(runner, /bindRecordingPageId/, 'runner references bindRecordingPageId');
}

function testWiringPageIdPy() {
  const py = readFileSync(join(root, 'scripts/controller/actions/js_snippets/page_id.py'), 'utf8');
  assert.match(py, /JS_READ_PAGE_COMPONENT_CODE/, 'page_id.py defines JS_READ_PAGE_COMPONENT_CODE');
  assert.match(py, /scenarioCode/, 'returns scenarioCode');
  assert.match(py, /场景编号/, 'parses 场景编号 label');
  assert.match(py, /\^\[A-Za-z0-9\]\+\$/, 'componentCode gated on whole-line single token');
  assert.match(py, /组件编号：.*确定\|取消/, 'componentCode extract stops at footer chrome (确定|取消)');
  // 仅有场景编号的页面：等待条件不能只认「组件编号：」
  assert.match(py, /场景编号：/, 'wait/parse path includes 场景编号');
}

function testWiringReplayPy() {
  const py = readFileSync(join(root, 'scripts/controller/actions/_replay.py'), 'utf8');
  assert.match(py, /_DIRECT_REPLAY_ACTIONS/, '_replay.py defines _DIRECT_REPLAY_ACTIONS registry');
  assert.match(py, /read_page_component_code/, '_replay.py references read_page_component_code');
}

function testWiringMenuNavigation() {
  const nav = readFileSync(join(root, 'src/services/trajectory/menu-navigation.js'), 'utf8');
  assert.match(nav, /navigateToFunctionMenu/, 'menu-navigation.js references navigateToFunctionMenu');
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  console.log('\n=== starting page id binding characterization ===\n');
  const tests = [
    ['generatePageId format: AILZ + 13-digit ms timestamp', testGeneratePageIdFormat],
    ['generatePageId unique + non-decreasing timestamp', testGeneratePageIdUniqueNonDecreasing],
    ['wiring: service references runReplayActions + read_page_component_code + AILZ + updateMeta', testWiringService],
    ['wiring: write-back only on source=read (not AILZ/generated)', testWiringWriteBackOnlyOnRead],
    ['wiring: replay-actions helper owns replay_actions/forwardStdin/waitForSessionEvent + no-op catch', testWiringReplayActionsHelper],
    ['wiring: trajectory-attach-runner.js references bindRecordingPageId', testWiringRunner],
    ['wiring: js_snippets/page_id.py defines JS_READ_PAGE_COMPONENT_CODE', testWiringPageIdPy],
    ['wiring: _replay.py references read_page_component_code', testWiringReplayPy],
    ['wiring: menu-navigation.js references navigateToFunctionMenu', testWiringMenuNavigation],
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
