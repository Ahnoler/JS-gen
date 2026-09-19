/**
 * CDP popup precheck before record/start — close known blocking dialogs via page script.
 */

import fs from 'node:fs';
import path from 'node:path';

/** @type {readonly string[]} */
export const DEFAULT_NEEDLES = ['天元相关配置', '维度参数配置', '公告', '通知'];

const CDP_TIMEOUT_MS = 15_000;

/**
 * @param {number} ms
 * @returns {AbortSignal|undefined}
 */
function abortAfter(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  return undefined;
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} label
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timeout after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * @param {number} port
 */
async function listTargets(port) {
  const signal = abortAfter(CDP_TIMEOUT_MS);
  const fetchOpts = signal ? { signal } : {};
  const res = await withTimeout(
    fetch(`http://127.0.0.1:${port}/json`, fetchOpts),
    CDP_TIMEOUT_MS,
    'CDP listTargets fetch',
  );
  if (!res.ok) throw new Error(`CDP list failed: HTTP ${res.status}`);
  return res.json();
}

/**
 * @param {string} wsUrl
 */
function connectCdp(wsUrl) {
  const WS = globalThis.WebSocket;
  if (!WS) throw new Error('WebSocket unavailable');
  return withTimeout(
    new Promise((resolve, reject) => {
      const ws = new WS(wsUrl);
      let id = 0;
      /** @type {Map<number, { resolve: (v: unknown) => void, reject: (e: Error) => void, timer: ReturnType<typeof setTimeout> }>} */
      const pending = new Map();
      ws.onopen = () =>
        resolve({
          /**
           * @param {string} method
           * @param {object} [params]
           */
          call(method, params = {}) {
            return new Promise((res2, rej2) => {
              const mid = ++id;
              const timer = setTimeout(() => {
                if (pending.has(mid)) {
                  pending.delete(mid);
                  rej2(new Error(`CDP call timeout: ${method}`));
                }
              }, CDP_TIMEOUT_MS);
              pending.set(mid, { resolve: res2, reject: rej2, timer });
              ws.send(JSON.stringify({ id: mid, method, params }));
            });
          },
          close: () => ws.close(),
        });
      ws.onerror = () => reject(new Error('ws error'));
      ws.onmessage = (ev) => {
        const m = JSON.parse(String(ev.data));
        if (m.id && pending.has(m.id)) {
          const { resolve: res2, reject: rej2, timer } = pending.get(m.id);
          pending.delete(m.id);
          clearTimeout(timer);
          if (m.error) rej2(new Error(JSON.stringify(m.error)));
          else res2(m.result);
        }
      };
    }),
    CDP_TIMEOUT_MS,
    'CDP WebSocket open',
  );
}

/**
 * @param {string[]} needles
 */
function buildCloseScript(needles) {
  const needleJson = JSON.stringify(needles);
  return `(() => {
  const needles = ${needleJson};
  const out = { dialogs: [], closed: [] };
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const selectors = ['.el-dialog', '.el-drawer', '.el-message-box'];
  const containers = [];
  for (const sel of selectors) {
    document.querySelectorAll(sel).forEach((el) => {
      if (!vis(el)) return;
      const txt = (el.innerText || '').replace(/\\s+/g, ' ').trim();
      out.dialogs.push(sel + ' :: ' + txt.slice(0, 120));
      containers.push({ el, txt });
    });
  }
  for (const needle of needles) {
    for (const { el, txt } of containers) {
      if (!txt.includes(needle)) continue;
      if (txt.includes('选择客户')) continue;
      const btn = Array.from(
        el.querySelectorAll(
          'button, .el-dialog__headerbtn, .el-message-box__headerbtn, .el-drawer__close-btn',
        ),
      ).find((b) => {
        if (!vis(b)) return false;
        const t = (b.innerText || '').trim();
        const cls = String(b.className || '');
        if (/headerbtn|close-btn/i.test(cls)) return true;
        if (t === '关闭' || t === '取消') return true;
        return false;
      });
      if (btn) {
        btn.click();
        out.closed.push(
          needle + ' -> clicked: ' + String(btn.innerText || btn.className || '').slice(0, 40),
        );
      }
    }
  }
  return out;
})()`;
}

/**
 * @param {object} cdp
 * @param {string} expr
 */
async function evalJs(cdp, expr) {
  const r = await cdp.call('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (r?.exceptionDetails) {
    const text =
      r.exceptionDetails.exception?.description ||
      r.exceptionDetails.text ||
      'page script failed';
    throw new Error(text);
  }
  if (!r?.result || r.result.type === 'undefined') return undefined;
  if (r.result.type === 'object' && r.result.subtype === 'error') {
    throw new Error(r.result.description || 'page script error');
  }
  return r.result.value;
}

/**
 * @param {{ port: number, evidenceDir?: string, needles?: string[] }} opts
 * @returns {Promise<{ dialogs: string[], closed: string[], port: number, at: string, page?: { title?: string, url?: string } }>}
 */
export async function cdpPrecheck({ port, evidenceDir, needles } = {}) {
  const p = Number(port);
  if (!Number.isInteger(p) || p <= 0) {
    throw new Error('cdp port missing');
  }
  const needleList = Array.isArray(needles) && needles.length ? needles : DEFAULT_NEEDLES;

  const targets = await listTargets(p);
  const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!page) throw new Error('no CDP page target');

  const cdp = await connectCdp(page.webSocketDebuggerUrl);
  let pageResult;
  try {
    pageResult = await evalJs(cdp, buildCloseScript(needleList));
  } finally {
    cdp.close();
  }

  const dialogs = Array.isArray(pageResult?.dialogs) ? pageResult.dialogs : [];
  const closed = Array.isArray(pageResult?.closed) ? pageResult.closed : [];
  const report = {
    port: p,
    at: new Date().toISOString(),
    needles: needleList,
    page: { title: page.title, url: String(page.url || '').slice(0, 150) },
    dialogs,
    closed,
  };

  if (evidenceDir) {
    fs.writeFileSync(path.join(evidenceDir, 'cdp-precheck.json'), JSON.stringify(report, null, 2), 'utf8');
  }

  return report;
}
