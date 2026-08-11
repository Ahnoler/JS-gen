/**
 * Playwright test helpers — stubs for maintaining compatibility with SKILL.md references.
 *
 * These functions are referenced by run.js (wrapCodeIfNeeded path) and SKILL.md documentation.
 * Full implementations can be added as needed for specific test scenarios.
 */

/** Read extra headers from environment variables (PW_EXTRA_HEADERS). */
function getExtraHeadersFromEnv() {
  const raw = process.env.PW_EXTRA_HEADERS;
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

/** Create a browser context with optional extra headers from environment. */
async function createContext(browser, options = {}) {
  const extraHeaders = getExtraHeadersFromEnv();
  if (Object.keys(extraHeaders).length > 0) {
    options.extraHTTPHeaders = { ...(options.extraHTTPHeaders || {}), ...extraHeaders };
  }
  return browser.newContext(options);
}

/** Detect local dev servers on common ports. Useful for targeting the right URL. */
async function detectDevServers() {
  const http = require('http');
  const ports = [3000, 5173, 8080, 3001, 4000];
  const results = [];
  for (const port of ports) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}`, (res) => {
          results.push({ port, status: res.statusCode });
          res.resume(); resolve();
        });
        req.on('error', reject);
        req.setTimeout(1000, () => { req.destroy(); resolve(); });
      });
    } catch {}
  }
  return results;
}

/** Safe click with Element UI awareness. Clicks the inner span for el-radio and el-checkbox. */
async function safeClick(page, selector, options = {}) {
  const el = await page.$(selector);
  if (!el) throw new Error(`Element not found: ${selector}`);
  const tagName = await el.evaluate(n => n.tagName.toLowerCase());
  if (tagName === 'label') {
    const inner = await el.$('.el-radio__inner, .el-checkbox__inner');
    if (inner) return inner.click(options);
  }
  return el.click(options);
}

module.exports = {
  getExtraHeadersFromEnv,
  createContext,
  detectDevServers,
  safeClick,
};
