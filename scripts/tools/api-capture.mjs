#!/usr/bin/env node
/**
 * E2E API capture tool — standalone Playwright script capturing XHR/fetch pairs to JSON.
 *
 * Opens a headed browser at --url, records every XHR/fetch response whose URL matches
 * --filter, and writes one JSON file per capture plus a final _summary.json.
 *
 * Usage:
 *   node scripts/tools/api-capture.mjs --url https://example.com [--filter "/api/"]
 *       [--out ./samples/] [--headed true] [--timeout 300000]
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (k.startsWith('--')) {
    args[k.slice(2)] = process.argv[i + 1];
    i++;
  }
}
const TARGET_URL = args.url;
const FILTER = args.filter || '/api/';
const OUT = args.out || './samples/';
const HEADED = (args.headed || 'true') !== 'false';
const TIMEOUT = parseInt(args.timeout || '300000', 10);

if (!TARGET_URL) {
  console.error('Usage: node scripts/tools/api-capture.mjs --url <url> [--filter /api/] [--out ./samples/] [--headed true] [--timeout 300000]');
  process.exit(1);
}

/**
 * Strip query/hash and replace numeric path segments with {id}.
 * @param {string} url - Absolute or relative URL to normalize.
 * @returns {string} Normalized URL path.
 */
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return u.pathname.replace(/\/\d+(?=\/|$)/g, '/{id}');
  } catch {
    return url.split('?')[0].split('#')[0].replace(/\/\d+(?=\/|$)/g, '/{id}');
  }
}

/**
 * Parse body as JSON when possible, else truncate text to 4KB.
 * @param {Buffer|null} bodyBytes - Raw body bytes.
 * @returns {Object|string|null} Parsed JSON, truncated text, or null.
 */
function safeBody(bodyBytes) {
  if (bodyBytes == null) return null;
  const text = bodyBytes.toString('utf8');
  try { return JSON.parse(text); } catch { /* not JSON */ }
  return text.length > 4096 ? text.slice(0, 4096) + '…[truncated]' : text;
}

/**
 * Filesystem-safe name fragment.
 * @param {string} s - Arbitrary string (URL fragment, method).
 * @returns {string} Sanitized fragment truncated to 80 chars.
 */
function safeName(s) {
  return s.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 80).replace(/^_+|_+$/g, '') || 'x';
}

fs.mkdirSync(OUT, { recursive: true });
const captures = [];

async function main() {
  const browser = await chromium.launch({ headless: !HEADED, args: ['--ignore-certificate-errors'] });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  const filterRe = new RegExp(FILTER);

  page.on('response', async (response) => {
    try {
      const request = response.request();
      const url = response.url();
      if (!filterRe.test(url)) return;
      const rt = request.resourceType();
      if (rt !== 'xhr' && rt !== 'fetch') return;

      let reqBody = null;
      try { reqBody = safeBody(Buffer.from(request.postDataBuffer() || '')); } catch { /* no body */ }
      let respBody = null;
      try { respBody = safeBody(await response.body()); } catch { /* body unavailable */ }

      const normalizedUrl = normalizeUrl(url);
      const entry = {
        url,
        normalizedUrl,
        method: request.method(),
        requestHeaders: request.headers(),
        requestBody: reqBody,
        responseStatus: response.status(),
        responseHeaders: response.headers(),
        responseBody: respBody,
        capturedAt: new Date().toISOString(),
      };

      const filename = `${safeName(entry.method)}_${safeName(normalizedUrl)}_${Date.now()}.json`;
      fs.writeFileSync(path.join(OUT, filename), JSON.stringify(entry, null, 2));
      captures.push(entry);
      console.log(`[${captures.length}] ${entry.method} ${normalizedUrl} -> ${entry.responseStatus} (${filename})`);
    } catch (err) {
      console.warn('[capture-error]', err?.message || err);
    }
  });

  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log(`Capturing XHR/fetch matching /${FILTER}/ at ${TARGET_URL} for ${TIMEOUT}ms… (Ctrl+C to stop early)`);

  await new Promise((resolve) => setTimeout(resolve, TIMEOUT));

  const unique = [...new Set(captures.map((c) => c.method + ' ' + c.normalizedUrl))];
  fs.writeFileSync(path.join(OUT, '_summary.json'), JSON.stringify({
    url: TARGET_URL,
    filter: FILTER,
    totalCaptured: captures.length,
    uniqueInterfaces: unique,
    endedAt: new Date().toISOString(),
  }, null, 2));
  console.log(`\nDone: ${captures.length} captures, ${unique.length} unique interfaces -> ${OUT}`);
  await browser.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
