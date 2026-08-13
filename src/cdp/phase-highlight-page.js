import { PAGE_LOCATOR_HELPERS } from './locator-candidates.js';

export function buildPhaseHighlightMarkExpression(targets) {
  const list = JSON.stringify(Array.isArray(targets) ? targets : []);
  return `(() => {
    ${PAGE_LOCATOR_HELPERS}
    const targets = ${list};
    function evalXp(xp) {
      if (!xp) return null;
      try {
        return document.evaluate(xp, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      } catch (e) { return null; }
    }
    function regionMatch(el, t) {
      if (!t.region_id && !t.region_label) return true;
      const r = assignRegion(el);
      if (t.region_id && r.region_id === t.region_id) return true;
      if (t.region_label && r.region_label === t.region_label) return true;
      return false;
    }
    function pickFromSnap(snap, t) {
      if (!snap || !snap.snapshotLength) return null;
      const vis = [];
      for (let i = 0; i < snap.snapshotLength; i++) {
        const n = snap.snapshotItem(i);
        if (n && isVisible(n)) vis.push(n);
      }
      if (vis.length === 1) return vis[0];
      if (vis.length > 1) {
        const scoped = vis.filter(function (n) { return regionMatch(n, t); });
        if (scoped.length === 1) return scoped[0];
        if (scoped.length > 1) return scoped[0];
      }
      return null;
    }
    function resolveHit(t) {
      const a = pickFromSnap(evalXp(t.xpath_smart), t);
      if (a) return a;
      return pickFromSnap(evalXp(t.xpath_full), t);
    }
    const seen = new Set();
    const hits = [];
    for (let i = 0; i < targets.length; i++) {
      const el = resolveHit(targets[i] || {});
      if (!el || seen.has(el)) continue;
      seen.add(el);
      hits.push(el);
    }
    if (!document.getElementById('jsgen-phase-hl-style')) {
      const st = document.createElement('style');
      st.id = 'jsgen-phase-hl-style';
      st.textContent = '[data-jsgen-phase-hl="1"]{outline:2px solid #1a73e8;outline-offset:0;box-shadow:inset 0 0 0 9999px rgba(111,168,220,.45);}';
      document.documentElement.appendChild(st);
    }
    for (let j = 0; j < hits.length; j++) hits[j].setAttribute('data-jsgen-phase-hl', '1');
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
    return {
      hitCount: hits.length,
      scroll: {
        top: root.scrollTop || 0,
        clientHeight: root.clientHeight || 0,
        scrollHeight: root.scrollHeight || 0,
        overlap: 48,
      },
    };
  })()`;
}

export function buildPhaseHighlightUnmarkExpression() {
  return `(() => {
    document.querySelectorAll('[data-jsgen-phase-hl]').forEach(function (el) {
      el.removeAttribute('data-jsgen-phase-hl');
    });
    const st = document.getElementById('jsgen-phase-hl-style');
    if (st) st.remove();
    return { ok: true };
  })()`;
}

export function buildPhaseHighlightScrollExpression({ top }) {
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
    return { top: root.scrollTop, clientHeight: root.clientHeight, scrollHeight: root.scrollHeight };
  })()`;
}
