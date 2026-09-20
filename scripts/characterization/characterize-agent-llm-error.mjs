/**
 * Characterization: AI 录制 LLM 网关失败识别与上报契约（离线，无 DB/服务器）。
 *
 * 覆盖：
 *   - 识别真机 stderr 行（402 余额不足 / 401 鉴权 / 429 限流 / 5xx / 其他）
 *   - 类别文案（前端 toast/悬浮统一 `LLM 调用异常`）+ 详细日志文案（仅后端）
 *   - 误报守卫：正常步骤/引导行、无 LLM 锚点的页面文案不识别
 *   - 去重器：同 session+kind 只通知一次
 *   - 接线：executor-ws.js 识别 → ERROR 日志 / 落库失败原因 / stderr 标记 / broadcast
 *   - 失败分类表 + api-docs websocket 契约登记
 *
 * Run: node scripts/characterization/characterize-agent-llm-error.mjs
 */
import { readFileSync } from 'fs';
import {
  detectAgentLlmError,
  classifyAgentLlmErrorLine,
  createAgentLlmErrorDeduper,
} from '../../src/services/agent-llm-error.js';
import {
  failReasonText,
  isLlmFailKind,
  TRAJECTORY_FAIL_REASONS,
} from '../../src/models/failure-reason.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const PHASE_REVIEWER_402 =
  "[slot:0 sid:66f97c26] [phase_reviewer] failed: Error code: 402 - "
  + "{'error': {'message': 'Insufficient Balance', 'type': 'unknown_error', "
  + "'param': None, 'code': 'invalid_request_error'}}";
const STEP_402 =
  "[slot:0 sid:66f97c26] [step 1] done=no stopped=no | goal=- | act=- | "
  + "err=Error code: 402 - {'error': {'message': '{\"error\":{\"message\":\"Insufficient Balance\"";

function testInsufficientBalance() {
  const hit = detectAgentLlmError([PHASE_REVIEWER_402]);
  assert(hit, '402 line must be detected');
  assert(hit.kind === 'llm_insufficient_balance', `402 kind expected llm_insufficient_balance, got ${hit?.kind}`);
  assert(hit.reason === 'LLM 调用异常', 'user-facing reason must be the unified category');
  assert(hit.logReason === 'LLM 账户余额不足', 'backend log reason keeps the specific cause');
  assert(hit.upstream.includes('Insufficient Balance'), 'upstream keeps raw provider text');
  assert(isLlmFailKind(hit.kind), 'llm kind recognized');

  const stepHit = detectAgentLlmError([STEP_402]);
  assert(stepHit?.kind === 'llm_insufficient_balance', 'per-step 402 line must also be detected');
}

function testAuthRateLimitServer() {
  const auth = classifyAgentLlmErrorLine(
    "Error code: 401 - {'error': {'message': 'Authentication Fails, Your api key is invalid'}}",
  );
  assert(auth?.kind === 'llm_auth', `401 expected llm_auth, got ${auth?.kind}`);
  assert(auth.reason === 'LLM 调用异常', 'auth reason unified');

  const rate = classifyAgentLlmErrorLine('Error code: 429 - rate limit exceeded');
  assert(rate?.kind === 'llm_rate_limit', `429 expected llm_rate_limit, got ${rate?.kind}`);

  const server = classifyAgentLlmErrorLine('Error code: 500 - internal server error');
  assert(server?.kind === 'llm_server', `500 expected llm_server, got ${server?.kind}`);

  const other = classifyAgentLlmErrorLine("Error code: 403 - {'error': {'message': 'forbidden'}}");
  assert(other?.kind === 'llm_unknown', `403 expected llm_unknown, got ${other?.kind}`);
  assert(other.reason === 'LLM 调用异常', 'unknown reason unified');
}

function testFalsePositiveGuard() {
  const normalStep =
    '[slot:0 sid:66f97c26] [step 1] done=no stopped=no | goal=点击保存 | act=click_save | res=ok-save-success';
  assert(detectAgentLlmError([normalStep]) === null, 'normal step line must not be classified');

  const cue = '[recorder] Injected empty-act cue (streak=1 last_step=False save_ok=False)';
  assert(detectAgentLlmError([cue]) === null, 'recorder cue line must not be classified');

  assert(detectAgentLlmError(['Unauthorized access to resource']) === null,
    'bare Unauthorized without LLM anchor must not be classified');
  assert(detectAgentLlmError(['internal server error while saving']) === null,
    'non-anchored server phrase must not be classified');
  assert(detectAgentLlmError([]) === null, 'empty batch must not be classified');
  assert(detectAgentLlmError('') === null, 'empty string must not be classified');
}

function testDeduper() {
  const shouldNotify = createAgentLlmErrorDeduper({ max: 10 });
  assert(shouldNotify('s1', 'llm_insufficient_balance') === true, 'first notify passes');
  assert(shouldNotify('s1', 'llm_insufficient_balance') === false, 'repeat same key suppressed');
  assert(shouldNotify('s1', 'llm_auth') === true, 'different kind passes');
  assert(shouldNotify('s2', 'llm_insufficient_balance') === true, 'different session passes');
}

function testFailureTaxonomy() {
  assert(failReasonText('llm_insufficient_balance') === 'LLM 调用异常', 'llm category');
  assert(failReasonText('llm_auth') === 'LLM 调用异常', 'llm category unified');
  assert(failReasonText('phase_failed') === '阶段执行失败', 'phase category');
  assert(failReasonText('quality_failed') === '录制质量未达标', 'quality category');
  assert(failReasonText('zero_step') === '未录制到步骤', 'zero_step category');
  assert(failReasonText('runner_error') === '录制执行异常', 'runner category');
  assert(failReasonText('user_marked_failed') === '人工标记录制异常', 'user category');
  assert(failReasonText('batch_failed') === '批量任务失败', 'batch category');
  assert(failReasonText('nope') === '录制异常', 'unknown category fallback');
  assert(!isLlmFailKind('phase_failed'), 'non-llm kind not llm');
  // 前端只需看到类别，不出现具体供应商文案
  for (const [kind, text] of Object.entries(TRAJECTORY_FAIL_REASONS)) {
    assert(!/余额|鉴权|限流/.test(text), `category text must not be too specific: ${kind}`);
  }
}

function testExecutorWsWiring() {
  const src = readFileSync(new URL('../../src/executor-ws.js', import.meta.url), 'utf8');
  assert(/from '\.\/services\/agent-llm-error\.js'/.test(src), 'executor-ws imports detector');
  assert(/detectAgentLlmError\(payload\.lines\)/.test(src), 'executor-ws scans agent_stderr lines');
  assert(/shouldNotifyAgentLlmError\(payload\.sessionId, llmError\.kind\)/.test(src),
    'executor-ws dedupes by session+kind');
  assert(/announceAgentLlmError\(payload\.sessionId, llmError\)/.test(src),
    'executor-ws announces classified error');
  assert(/\[agent-llm-error\]/.test(src), 'control-plane ERROR log marker present');
  assert(/reason=\$\{llmError\.logReason\}/.test(src), 'log line carries detailed logReason');
  assert(/markFailedReason\(trajectoryId/.test(src), 'persists failed reason on trajectory');
  assert(/broadcast\('recording:llm_error'/.test(src), 'broadcasts recording:llm_error');
  assert(/appendLines\(sessionId, \[/.test(src), 'appends category marker to session stderr log');
}

function testPersistenceWiring() {
  const runner = readFileSync(
    new URL('../../src/services/trajectory/trajectory-recording-runner.js', import.meta.url), 'utf8',
  );
  assert(/import \{ failReasonText \}/.test(runner), 'runner imports failure taxonomy');
  assert(/persistFailReason\('zero_step'\)/.test(runner), 'runner records zero_step');
  // Step 1 收敛后：quality_failed/phase_failed 取值在 gate 模块 evaluateFinalVerdict
  //（qualityFails 非空 → 'quality_failed'，否则 'phase_failed'），runner 消费其输出。
  assert(/const finalVerdict = evaluateFinalVerdict\(\{ failedPhases: failedOutcomeKeys, qualityFails, trajSuccess \}\)/.test(runner),
    'runner consumes gate module final verdict');
  assert(/persistFailReason\(finalVerdict\.failKind\)/.test(runner),
    'runner records quality_failed / phase_failed (via evaluateFinalVerdict.failKind)');
  assert(/persistFailReason\('runner_error'\)/.test(runner), 'runner records runner_error');

  const lifecycle = readFileSync(
    new URL('../../src/services/trajectory/trajectory-record-lifecycle.js', import.meta.url), 'utf8',
  );
  assert(/failedKind: 'user_marked_failed'/.test(lifecycle), 'manual stop records user_marked_failed');
  assert(/failedKind = 'batch_failed'/.test(lifecycle), 'batch stop defaults to batch_failed');

  const dao = readFileSync(new URL('../../src/dao/trajectory-dao.js', import.meta.url), 'utf8');
  assert(/export async function markFailedReason/.test(dao), 'dao exposes markFailedReason');
  assert(/export async function clearFailedReason/.test(dao), 'dao exposes clearFailedReason');
  assert(/whereNull\('failed_kind'\)/.test(dao), 'first cause wins (whereNull guard)');
  assert(/clearFailedReason\(trajectoryDbId\)/.test(dao), 'new attempt clears previous reason');
}

function testApiDocsContract() {
  const src = readFileSync(
    new URL('../../src/dashboard/api-docs/groups/websocket.js', import.meta.url),
    'utf8',
  );
  assert(/recording:llm_error/.test(src), 'api-docs documents recording:llm_error');
  assert(/insufficient_balance/.test(src), 'api-docs documents error kinds');

  const initSql = readFileSync(new URL('../../schemas/init.sql', import.meta.url), 'utf8');
  assert(/`failed_kind`/.test(initSql), 'schema has failed_kind');
  assert(/`failed_reason`/.test(initSql), 'schema has failed_reason');
  assert(/`failed_at`/.test(initSql), 'schema has failed_at');
}

function main() {
  console.log('\n=== agent LLM error detection characterization ===\n');
  const tests = [
    ['402 insufficient balance', testInsufficientBalance],
    ['401/429/5xx classification', testAuthRateLimitServer],
    ['false-positive guard', testFalsePositiveGuard],
    ['deduper', testDeduper],
    ['failure taxonomy', testFailureTaxonomy],
    ['executor-ws wiring', testExecutorWsWiring],
    ['persistence wiring', testPersistenceWiring],
    ['api-docs contract', testApiDocsContract],
  ];
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed += 1;
      console.log(`  ✗ ${name} — ${err.message}`);
    }
  }
  console.log(failed ? `\nFAILED (${failed})\n` : '\nOK\n');
  process.exit(failed ? 1 : 0);
}

main();
