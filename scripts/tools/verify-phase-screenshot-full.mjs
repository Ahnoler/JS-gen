/**
 * 长图截全验证：连接 CDP 浏览器，在当前页面跑一遍真实阶段长图捕获链路。
 * 报告 pickScrollRoot 解析、截片数、图高 vs scrollHeight（截全判定）。
 *
 * 用法: node scripts/tools/verify-phase-screenshot-full.mjs [cdpPort=9242] [out.png]
 */
import { PNG } from 'pngjs';
import { runPhaseScreenshotCapture } from '../../src/cdp/phase-screenshot-capture.js';
import { buildPhaseScreenshotScrollExpression } from '../../src/cdp/phase-screenshot-page.js';

const cdpPort = Number(process.argv[2] || process.env.CDP_PORT || 9242);
const outPng = process.argv[3] || `tmp/verify-full-${Date.now()}.png`;
const CDP_URL = `http://127.0.0.1:${cdpPort}`;

async function connect() {
  const list = await fetch(`${CDP_URL}/json/list`).then((r) => r.json());
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page tab');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  return {
    async send(method, params = {}) {
      const id = ++seq;
      ws.send(JSON.stringify({ id, method, params }));
      const msg = await new Promise((res) => pending.set(id, res));
      if (msg.error) throw new Error(`${method}: ${msg.error.message}`);
      return msg.result;
    },
    close() { ws.close(); },
  };
}

async function cdpEval(client, expression) {
  const r = await client.send('Runtime.evaluate', { expression, returnByValue: true });
  if (r?.exceptionDetails) throw new Error(r.exceptionDetails.text || 'evaluate failed');
  return r?.result?.value;
}

const client = await connect();
try {
  const info = await cdpEval(client, `(() => ({
    url: location.href,
    title: document.title,
    ready: document.readyState,
    bodyTextLen: document.body ? document.body.innerText.length : 0,
  }))()`);
  console.log('== 页面状态 ==');
  console.log(`url  : ${info.url}`);
  console.log(`title: ${info.title} (${info.ready}, bodyText=${info.bodyTextLen})`);

  // 预览滚动根解析结果（不滚动页面）
  const preview = await cdpEval(client, `(() => {
    const cands = document.querySelectorAll('.el-main, .app-main');
    for (let k = 0; k < cands.length; k++) {
      const el = cands[k];
      const s = getComputedStyle(el);
      const oy = s.overflowY || s.overflow;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 8) return { root: 'standard', cls: el.className, clientHeight: el.clientHeight, scrollHeight: el.scrollHeight };
    }
    let best = null;
    const all = document.querySelectorAll('div, main, section, article');
    for (let k = 0; k < all.length; k++) {
      const el = all[k];
      if (el.clientHeight < 100) continue;
      const s = getComputedStyle(el);
      const oy = s.overflowY || s.overflow;
      if (oy !== 'auto' && oy !== 'scroll') continue;
      if (el.scrollHeight <= el.clientHeight + 8) continue;
      if (!best || el.scrollHeight > best.scrollHeight) best = el;
    }
    if (best) return { root: 'generic', cls: best.className, id: best.id, clientHeight: best.clientHeight, scrollHeight: best.scrollHeight };
    return { root: 'document', clientHeight: document.scrollingElement ? document.scrollingElement.clientHeight : 0, scrollHeight: document.scrollingElement ? document.scrollingElement.scrollHeight : 0 };
  })()`);
  console.log('\n== 滚动根解析（pickScrollRoot 逻辑）==');
  console.log(JSON.stringify(preview, null, 2));

  const t0 = Date.now();
  const { buffer, meta } = await runPhaseScreenshotCapture(client);
  const dims = PNG.sync.read(buffer);
  const contentH = Number(meta?.contentHeight) || 0;
  console.log('\n== 完整捕获链路 ==');
  console.log(`用时        : ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`图片        : ${dims.width}x${dims.height}`);
  console.log(`contentHeight: ${contentH}`);
  console.log(`scrollHeight : ${preview.scrollHeight}`);
  console.log(`clientHeight : ${preview.clientHeight}`);
  console.log(`truncated    : ${meta?.truncated}`);
  console.log(`elements     : ${meta?.elements?.length ?? 0}`);
  const ratio = contentH > 0 && preview.scrollHeight > 0 ? (contentH / preview.scrollHeight).toFixed(3) : 'n/a';
  console.log(`截全判定     : ${contentH >= preview.scrollHeight - 2 ? 'PASS（图高>=scrollHeight）' : `FAIL（ratio=${ratio}）`}`);

  const { mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  mkdirSync(dirname(outPng), { recursive: true });
  await import('node:fs').then((fs) => fs.writeFileSync(outPng, buffer));
  console.log(`\n已保存: ${outPng}`);
} finally {
  client.close();
}
