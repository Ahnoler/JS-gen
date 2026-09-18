/**
 * Detect upstream LLM gateway/billing failures in executor agent stderr and map
 * them to a user-facing failure notice.
 *
 * Context: when the LLM account has no balance (or the key is invalid / rate
 * limited), browser-use retries the model call, the agent produces zero actions,
 * the phase "completes" and the control plane otherwise reports AI recording as
 * successful. These helpers let the control plane classify the raw stderr line,
 * log it, and broadcast `recording:llm_error` so the frontend can show a real
 * failure instead of a misleading success toast.
 *
 * Pure module: no IO, no broadcast, no DB.
 */

/** Ordered classification rules — first match wins. */
const RULES = [
  {
    kind: 'insufficient_balance',
    re: /insufficient[_\s-]?balance|insufficient[_\s-]?quota|余额不足|账户余额|欠费|no\s+balance|exceeded\s+your\s+current\s+quota/i,
    message: 'LLM 服务账户余额不足，AI 录制未能执行任何操作。请为 LLM 账户充值或更换可用的模型密钥后重试。',
  },
  {
    kind: 'auth',
    re: /invalid[_\s-]?api[_\s-]?key|incorrect\s+api\s+key|invalid\s+authentication|authentication\s+failed|no\s+auth\s+credentials|unauthorized|error\s+code:\s*401\b/i,
    message: 'LLM 服务鉴权失败（密钥无效或已过期），AI 录制未能执行任何操作。请检查 LLM_API_KEY / LLM_BASE_URL 配置。',
  },
  {
    kind: 'rate_limit',
    re: /rate\s*limit|too\s+many\s+requests|error\s+code:\s*429\b|tpm\s+limit|rpm\s+limit/i,
    message: 'LLM 服务触发限流（请求过于频繁），AI 录制未能执行操作。请稍后重试或降低并发。',
  },
  {
    kind: 'server',
    re: /error\s+code:\s*5\d{2}\b|internal\s+server\s+error|service\s+(?:temporarily\s+)?unavailable|bad\s+gateway/i,
    message: 'LLM 服务端错误，AI 录制未能执行操作。请稍后重试。',
  },
];

/**
 * Anchor that a stderr line is plausibly an upstream LLM/gateway error rather
 * than arbitrary page text captured into a tool result (false-positive guard).
 */
const LLM_ERROR_ANCHOR_RE = /error\s+code:\s*\d{3}|llm\s+request\s+failed|invalid_request_error|invalid[_\s-]?api[_\s-]?key|incorrect\s+api\s+key|insufficient[_\s-]?(?:balance|quota)|rate\s*limit|too\s+many\s+requests|authentication\s+error|authenticationerror|ratelimiterror/i;

const GENERIC_MESSAGE = 'LLM 调用失败，AI 录制未能执行操作。详情请查看执行机日志。';

/** @typedef {'insufficient_balance'|'auth'|'rate_limit'|'server'|'unknown'} LlmErrorKind */
/** @typedef {{ kind: LlmErrorKind, message: string, upstream: string }} AgentLlmError */

/**
 * Classify a single stderr line as an LLM error, or null when it is not one.
 * @param {string} line raw agent stderr line
 * @returns {AgentLlmError|null} classified error or null
 */
export function classifyAgentLlmErrorLine(line) {
  const text = String(line || '');
  if (!text || !LLM_ERROR_ANCHOR_RE.test(text)) return null;
  for (const rule of RULES) {
    if (rule.re.test(text)) {
      return { kind: rule.kind, message: rule.message, upstream: text.trim().slice(0, 300) };
    }
  }
  return { kind: 'unknown', message: GENERIC_MESSAGE, upstream: text.trim().slice(0, 300) };
}

/**
 * Scan a batch of stderr lines and return the first classified LLM error.
 * @param {string[]|string} lines stderr line batch (or a single line)
 * @returns {AgentLlmError|null} classified error or null
 */
export function detectAgentLlmError(lines) {
  const list = Array.isArray(lines) ? lines : (lines ? [lines] : []);
  for (const raw of list) {
    const hit = classifyAgentLlmErrorLine(raw);
    if (hit) return hit;
  }
  return null;
}

/**
 * Build a bounded de-duper so repeated identical errors (the model is retried
 * every step) only notify once per session+kind.
 * @param {{ max?: number }} [opts] max distinct keys kept
 * @returns {(sessionId: string, kind: string) => boolean} true when this key is first seen
 */
export function createAgentLlmErrorDeduper({ max = 500 } = {}) {
  const seen = new Set();
  return function shouldNotify(sessionId, kind) {
    const key = `${sessionId || ''}::${kind || 'unknown'}`;
    if (seen.has(key)) return false;
    seen.add(key);
    if (seen.size > max) {
      const oldest = seen.values().next().value;
      seen.delete(oldest);
    }
    return true;
  };
}
