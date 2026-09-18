/**
 * Characterization: AI 录制 LLM 网关失败识别与上报契约（离线，无 DB/服务器）。
 *
 * 覆盖：
 *   - 识别真机 stderr 行（402 余额不足 / 401 鉴权 / 429 限流 / 5xx / 其他）
 *   - 误报守卫：正常步骤/引导行、无 LLM 锚点的页面文案不识别
 *   - 去重器：同 session+kind 只通知一次
 *   - 接线：executor-ws.js 识别 → ERROR 日志 / stderr 标记 / broadcast recording:llm_error
 *   - api-docs websocket 契约登记
 *
 * Run: node scripts/characterization/characterize-agent-llm-error.mjs
 */
import { readFileSync } from 'fs';
import {
  detectAgentLlmError,
  classifyAgentLlmErrorLine,
  createAgentLlmErrorDeduper,
} from '../../src/services/agent-llm-error.js';

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
  assert(hit.kind === 'insufficient_balance', `402 kind expected insufficient_balance, got ${hit?.kind}`);
  assert(/余额不足/.test(hit.message), 'balance message must mention 余额不足');
  assert(hit.upstream.includes('Insufficient Balance'), 'upstream keeps raw provider text');

  const stepHit = detectAgentLlmError([STEP_402]);
  assert(stepHit?.kind === 'insufficient_balance', 'per-step 402 line must also be detected');
}

function testAuthRateLimitServer() {
  const auth = classifyAgentLlmErrorLine(
    "Error code: 401 - {'error': {'message': 'Authentication Fails, Your api key is invalid'}}",
  );
  assert(auth?.kind === 'auth', `401 expected auth, got ${auth?.kind}`);

  const rate = classifyAgentLlmErrorLine('Error code: 429 - rate limit exceeded');
  assert(rate?.kind === 'rate_limit', `429 expected rate_limit, got ${rate?.kind}`);

  const server = classifyAgentLlmErrorLine('Error code: 500 - internal server error');
  assert(server?.kind === 'server', `500 expected server, got ${server?.kind}`);

  const other = classifyAgentLlmErrorLine("Error code: 403 - {'error': {'message': 'forbidden'}}");
  assert(other?.kind === 'unknown', `403 expected unknown, got ${other?.kind}`);
}

function testFalsePositiveGuard() {
  const normalStep =
    '[slot:0 sid:66f97c26] [step 1] done=no stopped=no | goal=点击保存 | act=click_save | res=ok-save-success';
  assert(detectAgentLlmError([normalStep]) === null, 'normal step line must not be classified');

  const cue = '[recorder] Injected empty-act cue (streak=1 last_step=False save_ok=False)';
  assert(detectAgentLlmError([cue]) === null, 'recorder cue line must not be classified');

  // 无 LLM 锚点的页面文案（可能出现在工具结果里）不识别
  assert(detectAgentLlmError(['Unauthorized access to resource']) === null,
    'bare Unauthorized without LLM anchor must not be classified');
  assert(detectAgentLlmError(['internal server error while saving']) === null,
    'non-anchored server phrase must not be classified');
  assert(detectAgentLlmError([]) === null, 'empty batch must not be classified');
  assert(detectAgentLlmError('') === null, 'empty string must not be classified');
}

function testDeduper() {
  const shouldNotify = createAgentLlmErrorDeduper({ max: 10 });
  assert(shouldNotify('s1', 'insufficient_balance') === true, 'first notify passes');
  assert(shouldNotify('s1', 'insufficient_balance') === false, 'repeat same key suppressed');
  assert(shouldNotify('s1', 'auth') === true, 'different kind passes');
  assert(shouldNotify('s2', 'insufficient_balance') === true, 'different session passes');
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
  assert(/broadcast\('recording:llm_error'/.test(src), 'broadcasts recording:llm_error');
  assert(/appendLines\(sessionId, \[/.test(src), 'appends Chinese marker to session stderr log');
}

function testApiDocsContract() {
  const src = readFileSync(
    new URL('../../src/dashboard/api-docs/groups/websocket.js', import.meta.url),
    'utf8',
  );
  assert(/recording:llm_error/.test(src), 'api-docs documents recording:llm_error');
  assert(/insufficient_balance \| auth \| rate_limit \| server \| unknown/.test(src),
    'api-docs documents error kinds');
}

function main() {
  console.log('\n=== agent LLM error detection characterization ===\n');
  const tests = [
    ['402 insufficient balance', testInsufficientBalance],
    ['401/429/5xx classification', testAuthRateLimitServer],
    ['false-positive guard', testFalsePositiveGuard],
    ['deduper', testDeduper],
    ['executor-ws wiring', testExecutorWsWiring],
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
