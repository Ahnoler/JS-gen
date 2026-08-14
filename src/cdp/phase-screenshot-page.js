import { PAGE_LOCATOR_HELPERS } from './locator-candidates.js';

export function buildPhaseScreenshotScrollExpression({ top }) {
  const y = Number(top) || 0;
  return `(() => {
    const cands = document.querySelectorAll('.el-main, .app-main');
    let root = document.scrollingElement || document.documentElement;
    for (let k = 0; k < cands.length; k++) {
      const el = cands[k];
      const s = getComputedStyle(el);
      const oy = s.overflowY || s.overflow;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 8) { root = el; break; }
    }
    root.scrollTop = ${y};
    const isDoc = root === document.scrollingElement || root === document.documentElement;
    const box = isDoc
      ? { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }
      : (() => {
          const r = root.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
        })();
    return {
      top: root.scrollTop,
      clientHeight: root.clientHeight,
      scrollHeight: root.scrollHeight,
      box,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  })()`;
}

export function buildPhaseScreenshotCollectExpression() {
  return `(() => {
    ${PAGE_LOCATOR_HELPERS}
    function pickScrollRoot() {
      const cands = document.querySelectorAll('.el-main, .app-main');
      for (let k = 0; k < cands.length; k++) {
        const el = cands[k];
        const s = getComputedStyle(el);
        const oy = s.overflowY || s.overflow;
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 8) return el;
      }
      return document.scrollingElement || document.documentElement;
    }
    const root = pickScrollRoot();
    const isDoc = root === document.scrollingElement || root === document.documentElement;
    const box = isDoc
      ? { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }
      : (() => {
          const r = root.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
        })();
    const hosts = collectL2Hosts();
    const out = [];
    for (let i = 0; i < hosts.length; i++) {
      const host = hosts[i].el;
      if (!host || !host.getBoundingClientRect) continue;
      if (host.hasAttribute('data-jsgen-rect')) continue;
      const rect = host.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.bottom <= box.y || rect.top >= box.y + box.height) continue;
      const region = assignRegion(host);
      host.setAttribute('data-jsgen-rect', '1');
      out.push({
        kind: hosts[i].kind || '',
        text: hosts[i].text || '',
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        layers: Array.isArray(region.layers) ? region.layers : [],
        region_id: region.region_id || '',
        region_label: region.region_label || '',
        outsideRoot: !root.contains(host),
      });
    }
    return out;
  })()`;
}

export function buildPhaseScreenshotCleanExpression() {
  return `(() => {
    const els = document.querySelectorAll('[data-jsgen-rect]');
    for (let i = 0; i < els.length; i++) els[i].removeAttribute('data-jsgen-rect');
    return { removed: els.length };
  })()`;
}
