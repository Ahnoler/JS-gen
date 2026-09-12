/**
 * Prepare-time default-login cold-start retry: settle (event-ish) + exponential backoff.
 *
 * Replaces the old fixed 8s sleep after first failure (login-retry-heuristic).
 */
/**
 * 执行机冷启动时 prepare 阶段的登录重试策略。一次尝试失败后，可选地等待页面就绪，
 * 在墙钟时间预算内按设上限的指数退避等待，再次尝试登录。
 */

/**
 * @param {object} opts options
 * @param {() => Promise<void>} opts.runLogin attempt login once
 * @param {() => Promise<void>} [opts.settle] optional readiness settle before retry
 *   (e.g. wait_for_loading); failures here are ignored
 * @param {(ms: number) => Promise<void>} [opts.sleep] injectable sleep (tests)
 * @param {number} [opts.maxAttempts] default 3
 * @param {number} [opts.initialDelayMs] first backoff after settle (default env or 1000)
 * @param {number} [opts.maxDelayMs] backoff cap (default 8000)
 * @param {number} [opts.budgetMs] wall-clock budget for sleeps (default 24000)
 * @returns {Promise<{ attempts: number }>} attempts used on success
 */
export async function runPrepareLoginWithColdStartRetry({
  runLogin,
  settle = null,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  maxAttempts = Number(process.env.PREPARE_LOGIN_RETRY_MAX_ATTEMPTS) || 3,
  initialDelayMs = Number(process.env.PREPARE_LOGIN_RETRY_DELAY_MS) || 1000,
  maxDelayMs = Number(process.env.PREPARE_LOGIN_RETRY_MAX_DELAY_MS) || 8000,
  budgetMs = Number(process.env.PREPARE_LOGIN_RETRY_BUDGET_MS) || 24000,
} = {}) {
  if (typeof runLogin !== 'function') {
    throw new Error('runLogin is required');
  }
  const attemptsCap = Math.max(1, Math.floor(Number(maxAttempts) || 3));
  let delay = Math.max(0, Number(initialDelayMs) || 1000);
  const delayCap = Math.max(delay, Number(maxDelayMs) || 8000);
  const deadline = Date.now() + Math.max(0, Number(budgetMs) || 24000);
  let lastErr = null;

  for (let attempt = 1; attempt <= attemptsCap; attempt += 1) {
    try {
      await runLogin();
      return { attempts: attempt };
    } catch (err) {
      lastErr = err;
      if (attempt >= attemptsCap) break;
      if (typeof settle === 'function') {
        try {
          await settle();
        } catch (settleErr) {
          console.warn(
            `[prepare] login settle failed (continuing backoff): ${settleErr?.message || settleErr}`,
          );
        }
      }
      const remaining = deadline - Date.now();
      const wait = Math.min(delay, delayCap, Math.max(0, remaining));
      if (wait > 0) {
        console.warn(
          `[prepare] login attempt ${attempt}/${attemptsCap} failed, `
          + `backoff ${wait}ms then retry: ${err?.message || err}`,
        );
        await sleep(wait);
      } else {
        console.warn(
          `[prepare] login attempt ${attempt}/${attemptsCap} failed, `
          + `budget exhausted — retry immediately: ${err?.message || err}`,
        );
      }
      delay = Math.min(delay * 2, delayCap);
    }
  }
  throw lastErr || new Error('prepare login failed');
}
