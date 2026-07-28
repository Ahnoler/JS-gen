/**
 * Minimal Remote Browser-in-Browser canvas (CDP screencast + normalized input).
 * Display uses object-fit:contain letterboxing; clicks map only over the image area.
 */
import { on, send, isConnected, waitUntilConnected } from './ws-client.js';
import { readV2, unwrapApi, isApiFail, apiErrorMessage } from './api-envelope.js';

const MAGIC = 'RSCF';

let canvas, ctx, statusEl, inputHintEl, stageEl, stageWrapEl;
let attached = false;
let inputEnabled = false;
let remoteSessionId = null;
/** UUID embedded in RSCF frames — only draw matching frames. */
let remoteSessionUuid = null;
/** Open page tabs from BiB ({ targetId, url, title, active }). */
let remoteTabs = [];
let activeTargetId = null;
let switchingTab = false;
let streaming = false;
let lastBitmap = null;
/** Latest JPEG waiting to paint (coalesce — drop stale frames). */
let pendingJpeg = null;
let drawPumpRunning = false;
let lastLayoutKey = '';
let cdpReady = false;
let browserConnected = false;
let attaching = false;
/** Prefer this browser session when calling attach-live (product prepare path). */
let preferredSessionId = null;
/** Current studio trajectory — filter WS events to this traj only. */
let preferredTrajectoryId = null;
/** Optional sink for studio / dashboard logs: (msg, level?) => void */
let remoteLogFn = null;
/** Logical CSS viewport of remote Chrome (from status / frames) */
let remoteViewport = { w: 1920, h: 1080 };
/** Effective display scale currently applied */
let displayScale = 1;
/**
 * Scale mode:
 * - 'auto' → fit into wrap (may go small)
 * - number string / manual → fixed % of remote frame (scroll if needed)
 */
const SCALE_STORAGE_KEY = 'jsgen.remoteDisplayScale';
let scaleMode = 'auto'; // 'auto' | 'manual' — default fit to canvas wrap
let manualScale = 0.6;
/** Where the JPEG is drawn inside the canvas (letterbox), in canvas CSS pixels */
let contentBox = { x: 0, y: 0, w: 0, h: 0 };

function $(id) {
  return document.getElementById(id);
}

function setUiStatus(text, tone = 'neutral') {
  if (!statusEl) return;
  statusEl.textContent = text;
  const colors = {
    ok: '#065f46',
    warn: '#92400e',
    bad: '#991b1b',
    neutral: 'var(--slate-500)',
  };
  const bgs = {
    ok: '#d1fae5',
    warn: '#fef3c7',
    bad: '#fee2e2',
    neutral: 'var(--slate-100)',
  };
  statusEl.style.color = colors[tone] || colors.neutral;
  statusEl.style.background = bgs[tone] || bgs.neutral;
}

function updateInputHint() {
  if (!inputHintEl) return;
  if (!attached) {
    inputHintEl.textContent = '未附着 — 先启动 Session，再点「附着画面」';
    return;
  }
  const vh = remoteViewport.w && remoteViewport.h
    ? `远端 ${remoteViewport.w}×${remoteViewport.h}`
    : '远端';
  const sc = `显示 ${(displayScale * 100).toFixed(0)}%${scaleMode === 'auto' ? '（自适应）' : ''}`;
  const rec = (typeof window !== 'undefined' && document.getElementById('sessManualRecStatus')?.textContent === '录制中')
    ? ' · 画布录制中'
    : '';
  if (!inputEnabled) {
    inputHintEl.textContent = `仅观看（AI/Agent 执行中）· 悬停可高亮，点击/按键暂不可用 · ${vh} · ${sc}${rec}`;
    return;
  }
  inputHintEl.textContent = `可操作：点击/按键 · ${vh} · ${sc}${rec}`;
}

function syncScaleControls() {
  const sel = $('sessRemoteScaleMode');
  const slider = $('sessRemoteScaleSlider');
  const label = $('sessRemoteScaleLabel');
  const pct = Math.round(manualScale * 100);
  if (sel) {
    const optVals = [...sel.options].map((o) => o.value);
    if (scaleMode === 'auto') sel.value = 'auto';
    else if (optVals.includes(String(manualScale)) || optVals.includes(manualScale.toFixed(2))) {
      sel.value = String(manualScale);
    } else {
      // custom — keep select on nearest preset without forcing
      sel.value = optVals.includes('0.6') ? '0.6' : sel.value;
    }
  }
  if (slider && scaleMode !== 'auto') slider.value = String(pct);
  if (label) label.textContent = scaleMode === 'auto' ? '自适应' : `${pct}%`;
}

function loadScalePreference() {
  try {
    const raw = localStorage.getItem(SCALE_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed?.mode === 'auto') {
      scaleMode = 'auto';
    } else if (typeof parsed?.scale === 'number' && parsed.scale > 0) {
      // Migrate former default 60% → auto fit to canvas.
      if (parsed.mode === 'manual' && Math.abs(parsed.scale - 0.6) < 0.001) {
        scaleMode = 'auto';
        return;
      }
      scaleMode = 'manual';
      manualScale = Math.min(1, Math.max(0.25, parsed.scale));
    } else if (typeof parsed === 'string' && parsed === 'auto') {
      scaleMode = 'auto';
    } else if (typeof parsed === 'number') {
      if (Math.abs(parsed - 0.6) < 0.001) {
        scaleMode = 'auto';
        return;
      }
      scaleMode = 'manual';
      manualScale = Math.min(1, Math.max(0.25, parsed));
    }
  } catch {}
}

function saveScalePreference() {
  try {
    localStorage.setItem(SCALE_STORAGE_KEY, JSON.stringify(
      scaleMode === 'auto' ? { mode: 'auto' } : { mode: 'manual', scale: manualScale },
    ));
  } catch {}
}

function setScaleFromUi(modeOrScale) {
  if (modeOrScale === 'auto') {
    scaleMode = 'auto';
  } else {
    const n = Number(modeOrScale);
    if (!Number.isFinite(n) || n <= 0) return;
    scaleMode = 'manual';
    manualScale = Math.min(1, Math.max(0.25, n));
  }
  saveScalePreference();
  syncScaleControls();
  fitCanvasToStage();
}

function syncButtons() {
  const attachBtn = $('sessRemoteAttachBtn');
  const detachBtn = $('sessRemoteDetachBtn');
  // Keep attach enabled when already attached — user can re-start stream (prepare already BiB-attached).
  if (attachBtn) {
    attachBtn.disabled = attaching;
    attachBtn.textContent = attached ? '重新推流' : '附着/推流';
    attachBtn.title = attached
      ? '仅重启画面推流（不释放执行机槽位）'
      : '附着 CDP 并开始推流（不释放/不占用新槽位以外的资源）';
  }
  if (detachBtn) {
    detachBtn.disabled = (!attached && !remoteSessionId) || attaching;
    detachBtn.textContent = '断开画面';
    detachBtn.title = '断开 BiB 推流，不释放执行机槽位；离开工作室也不会自动释放';
  }
}

function remoteLog(msg, level = 'info') {
  try { remoteLogFn?.(msg, level); } catch {}
}

export function setRemotePreferredSessionId(sessionId) {
  preferredSessionId = sessionId || null;
}

export function setRemotePreferredTrajectoryId(trajectoryId) {
  const tid = Number(trajectoryId);
  preferredTrajectoryId = Number.isFinite(tid) && tid > 0 ? tid : null;
}

export function setRemoteLog(fn) {
  remoteLogFn = typeof fn === 'function' ? fn : null;
}

function eventBelongsHere(payload = {}) {
  if (preferredTrajectoryId == null) return true;
  if (payload.trajectoryId != null) {
    return Number(payload.trajectoryId) === preferredTrajectoryId;
  }
  // Unscoped attach/identity updates must not clobber a traj-scoped studio
  // (e.g. global live/status with attached:false while prepare frames still flow).
  if (
    'attached' in payload
    || 'remoteSessionId' in payload
    || 'remoteSessionUuid' in payload
    || 'inputEnabled' in payload
  ) {
    return false;
  }
  return true;
}

function tabLabel(tab) {
  const title = (tab.title || '').trim();
  const url = (tab.url || '').trim();
  if (title && title !== 'ignore this tab and do not use it') return title;
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname === '/' ? '' : u.pathname.slice(0, 24));
  } catch {
    return url.slice(0, 40) || '空白页';
  }
}

function renderTabs() {
  const el = $('sessRemoteTabs');
  if (!el) return;
  if (!remoteTabs.length) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = remoteTabs.map((tab) => {
    const active = tab.active || tab.targetId === activeTargetId;
    const title = escapeAttr(tabLabel(tab));
    const url = escapeAttr(tab.url || '');
    return `<button type="button" class="rs-tab${active ? ' active' : ''}" data-target-id="${escapeAttr(tab.targetId)}" title="${url}">
      <span class="rs-tab-title">${title}</span>
      <span class="rs-tab-url">${url}</span>
    </button>`;
  }).join('');
  el.querySelectorAll('.rs-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tid = btn.getAttribute('data-target-id');
      const tab = remoteTabs.find((t) => t.targetId === tid);
      if (tab) switchRemoteTab(tab).catch((e) => remoteLog(`切换标签失败: ${e.message}`, 'err'));
    });
  });
}

function escapeAttr(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function applyTabsPayload(payload = {}) {
  if (Array.isArray(payload.tabs)) {
    remoteTabs = payload.tabs.map((t) => ({
      targetId: t.targetId,
      url: t.url || '',
      title: t.title || '',
      index: t.index,
      active: !!t.active,
      pageId: t.pageId,
    }));
  }
  if (payload.activeTargetId) activeTargetId = payload.activeTargetId;
  renderTabs();
}

async function switchRemoteTab(tab) {
  if (!tab?.targetId || switchingTab) return;
  if (tab.targetId === activeTargetId && tab.active) return;
  switchingTab = true;
  try {
    remoteLog(`切换标签 → ${tabLabel(tab)}`);
    const sent = sendRemote('remote:switch_tab', {
      targetId: tab.targetId,
      url: tab.url || '',
      pageId: tab.pageId ?? null,
    });
    if (!sent) throw new Error('/ws 未连接');
    activeTargetId = tab.targetId;
    remoteTabs = remoteTabs.map((t) => ({ ...t, active: t.targetId === tab.targetId }));
    renderTabs();
    // Refresh authoritative list after switch
    setTimeout(() => sendRemote('remote:tabs', {}), 300);
  } finally {
    switchingTab = false;
  }
}

function refreshRemoteTabs() {
  if (!attached && !remoteSessionId) return;
  sendRemote('remote:tabs', {});
}

function applyStatus(payload = {}) {
  if (!eventBelongsHere(payload)) return;
  if ('attached' in payload) attached = !!payload.attached;
  if ('inputEnabled' in payload) inputEnabled = !!payload.inputEnabled;
  if ('remoteSessionId' in payload) remoteSessionId = payload.remoteSessionId ?? null;
  if ('remoteSessionUuid' in payload) {
    remoteSessionUuid = payload.remoteSessionUuid ? String(payload.remoteSessionUuid) : null;
  }
  if (payload.attached === false && !('remoteSessionUuid' in payload)) {
    remoteSessionUuid = null;
  }
  if ('cdpReady' in payload) cdpReady = !!payload.cdpReady;
  if ('connected' in payload) browserConnected = !!payload.connected;
  if ('agentBusy' in payload && !('inputEnabled' in payload)) {
    inputEnabled = attached && !payload.agentBusy;
  }
  if (payload.viewportW > 0) remoteViewport.w = Math.round(payload.viewportW);
  if (payload.viewportH > 0) remoteViewport.h = Math.round(payload.viewportH);
  if (Array.isArray(payload.tabs)) applyTabsPayload(payload);

  updateInputHint();
  syncButtons();
  fitCanvasToStage();

  if (attached) {
    setUiStatus(
      payload.agentBusy
        ? `已附着 #${remoteSessionId} · AI 执行中（画布锁定）· ${remoteViewport.w}×${remoteViewport.h}`
        : `已附着 #${remoteSessionId} · 可操作 · ${remoteViewport.w}×${remoteViewport.h} · ${
          scaleMode === 'auto'
            ? `自适应 ${(displayScale * 100).toFixed(0)}%`
            : `显示${(displayScale * 100).toFixed(0)}%`
        }`,
      payload.agentBusy ? 'warn' : 'ok',
    );
  } else if (
    payload.reason === 'idle'
    || payload.reason === 'manual'
    || payload.reason === 'stream_detach'
  ) {
    stopStream();
    if (lastBitmap) {
      try { lastBitmap.close(); } catch {}
      lastBitmap = null;
    }
    if (canvas && ctx) {
      try {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, canvas.width || 1, canvas.height || 1);
      } catch {}
    }
    // Full resource release clears preferred session; stream-only detach keeps it.
    if (payload.reason === 'idle' || payload.reason === 'manual') {
      preferredSessionId = null;
    }
    remoteTabs = [];
    activeTargetId = null;
    renderTabs();
    setUiStatus(
      payload.reason === 'idle'
        ? '执行资源已空闲回收 — 请重新 prepare 后再附着'
        : payload.reason === 'stream_detach'
          ? '已断开画面（浏览器仍空闲，可再附着）'
          : '执行资源已释放 — 请重新 prepare 后再附着',
      'warn',
    );
  } else if (cdpReady) {
    setUiStatus('CDP 就绪 · 未附着', 'neutral');
    remoteTabs = [];
    activeTargetId = null;
    renderTabs();
  } else if (browserConnected) {
    setUiStatus('浏览器已就绪 · CDP 探测中（仍可尝试附着）', 'warn');
  } else {
    setUiStatus('先新建 Session 再附着', 'neutral');
  }
}

function parseFrame(buf) {
  const view = new DataView(buf);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== MAGIC || buf.byteLength < 10) return null;
  const frameId = view.getUint32(4, false);
  const uuidLen = view.getUint16(8, false);
  if (buf.byteLength < 10 + uuidLen) return null;
  const uuidBytes = new Uint8Array(buf, 10, uuidLen);
  const sessionUuid = new TextDecoder().decode(uuidBytes);
  const jpeg = buf.slice(10 + uuidLen);
  return { frameId, sessionUuid, jpeg };
}

/**
 * Layout stage by user scale or auto-fit. Never crops the remote frame.
 * Manual 60% of 1920×1080 → 1152×648 (scroll wrap if needed).
 */
function layoutStage() {
  if (!stageEl || !stageWrapEl) return { cssW: 640, cssH: 360 };

  // Prefer remote CSS viewport for scale base so status matches Session (1920×1080).
  // Fall back to bitmap when status not yet known.
  const srcW = remoteViewport.w || lastBitmap?.width || 1920;
  const srcH = remoteViewport.h || lastBitmap?.height || 1080;
  const wrapRect = stageWrapEl.getBoundingClientRect();
  const maxW = Math.max(160, stageWrapEl.clientWidth || wrapRect.width || 160);
  // Prefer the actual canvas pane height (studio / dashboard wrap), not a fixed 75vh guess.
  const wrapH = stageWrapEl.clientHeight || wrapRect.height || 0;
  const maxH = Math.max(
    120,
    wrapH > 80 ? wrapH - 4 : Math.min(window.innerHeight * 0.75, 900),
  );

  let scale;
  if (scaleMode === 'auto') {
    scale = Math.min(maxW / srcW, maxH / srcH, 1);
  } else {
    scale = manualScale;
  }
  displayScale = scale;
  const cssW = Math.max(1, Math.round(srcW * scale));
  const cssH = Math.max(1, Math.round(srcH * scale));

  stageEl.style.width = `${cssW}px`;
  stageEl.style.height = `${cssH}px`;
  stageEl.style.maxWidth = 'none';
  stageEl.style.aspectRatio = 'auto';
  // Wheel must go to CDP, not scroll the Dashboard / wrap
  if (stageWrapEl) {
    stageWrapEl.style.overflow = 'hidden';
    stageWrapEl.style.overscrollBehavior = 'contain';
    stageWrapEl.style.alignItems = scaleMode === 'auto' ? 'center' : 'flex-start';
  }

  return { cssW, cssH, srcW, srcH, scale };
}

/** Size canvas buffer to the scaled stage and redraw full frame (contain / no crop). */
function fitCanvasToStage() {
  if (!canvas || !stageEl) return;
  const { cssW, cssH } = layoutStage();
  const dpr = window.devicePixelRatio || 1;
  const bw = Math.round(cssW * dpr);
  const bh = Math.round(cssH * dpr);
  const key = `${cssW}x${cssH}@${dpr}`;
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  if (lastLayoutKey !== key) {
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    lastLayoutKey = key;
  }
  if (lastBitmap) paintBitmap(lastBitmap);
  updateInputHint();
}

function paintBitmap(bitmap) {
  if (!canvas || !ctx || !bitmap) return;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.width / dpr;
  const cssH = canvas.height / dpr;

  // Stretch frame into the scaled stage box (stage already matches remote aspect).
  contentBox = { x: 0, y: 0, w: cssW, h: cssH };

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  // medium is enough for live stream and much cheaper than high
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, cssW, cssH);
}

/**
 * Coalesce incoming JPEGs: always paint the latest, drop intermediates so decode
 * backlog cannot make the canvas lag behind realtime.
 */
function enqueueJpeg(arrayBuffer) {
  pendingJpeg = arrayBuffer;
  if (!drawPumpRunning) pumpDraw();
}

async function pumpDraw() {
  if (drawPumpRunning) return;
  drawPumpRunning = true;
  try {
    while (pendingJpeg) {
      const jpeg = pendingJpeg;
      pendingJpeg = null;
      await paintJpegFrame(jpeg);
    }
  } finally {
    drawPumpRunning = false;
    if (pendingJpeg) pumpDraw();
  }
}

async function paintJpegFrame(arrayBuffer) {
  if (!canvas || !ctx) return;
  try {
    const bitmap = await createImageBitmap(new Blob([arrayBuffer], { type: 'image/jpeg' }));
    if (lastBitmap) lastBitmap.close();
    lastBitmap = bitmap;
    // ResizeObserver / scale UI already call fitCanvasToStage — avoid layout thrash per frame.
    if (!canvas.width || !lastLayoutKey) fitCanvasToStage();
    else paintBitmap(bitmap);
  } catch (e) {
    console.warn('[remote-browser] draw failed', e);
  }
}

async function drawJpeg(arrayBuffer) {
  enqueueJpeg(arrayBuffer);
}

/**
 * Map pointer → normalized 0–1 over the *image content* (not letterbox bars).
 * Returns null if click is outside the image.
 */
function normCoords(evt) {
  const rect = canvas.getBoundingClientRect();
  const cssX = evt.clientX - rect.left;
  const cssY = evt.clientY - rect.top;
  if (contentBox.w <= 0 || contentBox.h <= 0) return null;
  const x = (cssX - contentBox.x) / contentBox.w;
  const y = (cssY - contentBox.y) / contentBox.h;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

function remoteRoutePayload(extra = {}) {
  const payload = { ...extra };
  if (preferredTrajectoryId != null) payload.trajectoryId = preferredTrajectoryId;
  if (preferredSessionId) payload.sessionId = preferredSessionId;
  return payload;
}

function sendRemote(type, extra = {}) {
  return send(type, remoteRoutePayload(extra));
}

function sendMouse(type, evt, extra = {}) {
  if (!streaming) return;
  const coords = normCoords(evt);
  if (!coords) return;
  // Hover highlight allowed even when input disabled (agent busy)
  const hoverOnly = !!extra.hoverOnly;
  if (!hoverOnly && !inputEnabled) return;
  if (!hoverOnly) evt.preventDefault();
  sendRemote('remote:input', {
    kind: 'mouse',
    type,
    x: coords.x,
    y: coords.y,
    button: evt.button === 2 ? 'right' : 'left',
    clickCount: evt.detail || 1,
    buttons: evt.buttons || 0,
    hoverOnly,
  });
}

async function fetchLiveStatus() {
  const q = new URLSearchParams();
  if (preferredTrajectoryId != null) q.set('trajectoryId', String(preferredTrajectoryId));
  if (preferredSessionId) q.set('sessionId', preferredSessionId);
  const qs = q.toString();
  const res = await fetch(`/api/v2/remote-sessions/live/status${qs ? `?${qs}` : ''}`);
  return readV2(res);
}

/**
 * Subscribe to remote frames before/without attach-live.
 * Used so prepare's login is visible on the canvas while the HTTP call runs.
 */
export async function armRemoteStream(opts = {}) {
  if (opts.sessionId) preferredSessionId = opts.sessionId;
  if (opts.trajectoryId != null) setRemotePreferredTrajectoryId(opts.trajectoryId);
  const wsOk = await waitUntilConnected(10000);
  if (!wsOk) return false;
  streaming = true;
  sendRemote('remote:subscribe', {});
  fitCanvasToStage();
  return true;
}

/**
 * Ensure BiB is attached and dashboard WS is subscribed + bib_start.
 * If prepare already attached on the server, only re-start stream (no second attach-live).
 * @param {{ sessionId?: string, trajectoryId?: number, forceAttach?: boolean }} [opts]
 */
export async function ensureRemoteStream(opts = {}) {
  if (opts.sessionId) preferredSessionId = opts.sessionId;
  if (opts.trajectoryId != null) setRemotePreferredTrajectoryId(opts.trajectoryId);
  attaching = true;
  syncButtons();
  try {
    const wsOk = await waitUntilConnected(10000);
    if (!wsOk) {
      throw new Error('Dashboard WebSocket (/ws) 未连接，无法收画面。请刷新页面后重试');
    }

    let status = await fetchLiveStatus().catch(() => null);
    const sameSession = !preferredSessionId
      || !status?.sessionId
      || status.sessionId === preferredSessionId;
    const already = !!(status?.attached && status?.remoteSessionId && sameSession);
    const force = opts.forceAttach === true || (status?.attached && !sameSession);

    if (!already || force) {
      remoteLog(already ? '强制重新附着 BiB…' : '附着 BiB（attach-live）…');
      const body = { quality: 75 };
      if (preferredSessionId) body.sessionId = preferredSessionId;
      if (preferredTrajectoryId != null) body.trajectoryId = preferredTrajectoryId;
      const res = await fetch('/api/v2/remote-sessions/attach-live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await readV2(res);
      status = data.status || status;
      applyStatus(status || {});
    } else {
      applyStatus(status || {});
      remoteLog(`已附着 #${status.remoteSessionId}，仅重新推流…`, 'ok');
    }

    await startStream();
    setUiStatus(
      attached
        ? `已附着 #${remoteSessionId} · 推流中 · ${remoteViewport.w}×${remoteViewport.h}`
        : '推流已请求',
      'ok',
    );
    refreshRemoteTabs();
    return { ok: true, attached: !!attached, remoteSessionId, reused: already && !force };
  } catch (e) {
    const raw = e?.message || String(e);
    const gone = /No executor-backed browser session|not found|未找到|sessionId is required/i.test(raw);
    if (gone) {
      resetRemoteBrowserUi({
        reason: 'manual',
        message: '浏览器会话已失效。请重新 prepare 后再附着推流。',
      });
    } else {
      setUiStatus(`附着/推流失败: ${raw}`, 'bad');
      remoteLog(`附着/推流失败: ${raw}`, 'err');
    }
    throw e;
  } finally {
    attaching = false;
    syncButtons();
  }
}

async function attachLiveHttp() {
  // Button path: re-stream if already attached; otherwise attach-live.
  await ensureRemoteStream({ sessionId: preferredSessionId || undefined });
}

async function detachLiveHttp() {
  const id = remoteSessionId;
  stopStream();
  // Prefer trajectory-scoped stream detach when we know the traj
  if (preferredTrajectoryId != null) {
    const res = await fetch(`/api/v2/trajectories/${preferredTrajectoryId}/stream/detach`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const raw = await res.json().catch(() => ({}));
    if (res.ok || res.status === 404) {
      applyStatus({
        ...(unwrapApi(raw)?.status || { attached: false, cdpReady: true }),
        reason: 'stream_detach',
        trajectoryId: preferredTrajectoryId,
      });
      return;
    }
    if (isApiFail(res, raw) && res.status !== 404) {
      // fall through to remote-session detach
    }
  }
  if (!id) {
    applyStatus({ attached: false, cdpReady: true, reason: 'stream_detach', trajectoryId: preferredTrajectoryId });
    return;
  }
  const res = await fetch(`/api/v2/remote-sessions/${id}/detach`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      trajectoryId: preferredTrajectoryId || undefined,
    }),
  });
  const raw = await res.json().catch(() => ({}));
  if (res.status === 404) {
    applyStatus({ attached: false, cdpReady: true, reason: 'stream_detach', trajectoryId: preferredTrajectoryId });
    return;
  }
  if (isApiFail(res, raw)) throw new Error(apiErrorMessage(raw, res.statusText));
  const data = unwrapApi(raw);
  applyStatus({
    ...(data.status || { attached: false, cdpReady: true }),
    reason: 'stream_detach',
    trajectoryId: preferredTrajectoryId,
  });
}

async function startStream() {
  streaming = true;
  const wsOk = await waitUntilConnected(8000);
  if (!wsOk) {
    console.warn('[remote] startStream: WS not connected');
    remoteLog('推流指令未发出：/ws 未连接', 'err');
    return false;
  }
  sendRemote('remote:subscribe', {});
  // No viewportW/H — must not Emulation-resize Session Chrome
  const sent = sendRemote('remote:start', { quality: 75 });
  fitCanvasToStage();
  if (!sent) {
    remoteLog('remote:start 发送失败', 'err');
    return false;
  }
  remoteLog('已发送 remote:start（执行机 bib_start）', 'ok');
  return true;
}

function stopStream() {
  streaming = false;
  sendRemote('remote:stop', {});
  sendRemote('remote:unsubscribe', {});
}

/** Clear canvas + local attach state after full resource release (idle / detach). */
export function resetRemoteBrowserUi(opts = {}) {
  stopStream();
  preferredSessionId = null;
  remoteSessionId = null;
  remoteSessionUuid = null;
  attached = false;
  inputEnabled = false;
  cdpReady = false;
  browserConnected = false;
  remoteTabs = [];
  activeTargetId = null;
  renderTabs();
  if (lastBitmap) {
    try { lastBitmap.close(); } catch {}
    lastBitmap = null;
  }
  if (canvas && ctx) {
    try {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, canvas.width || 1, canvas.height || 1);
    } catch {}
  }
  const reason = opts.reason || '';
  const msg = opts.message || (
    reason === 'idle'
      ? '执行资源已空闲回收（约 10 分钟无步骤）— 请重新 prepare 后再附着'
      : '执行资源已释放 — 请重新 prepare 后再附着'
  );
  setUiStatus(msg, 'warn');
  remoteLog(msg, 'err');
  updateInputHint();
  syncButtons();
}

function bindCanvasInput() {
  if (!canvas) return;
  // Prevent double-binding if initRemoteBrowser runs twice (HMR / re-entry)
  if (canvas.dataset.remoteBound === '1') return;
  canvas.dataset.remoteBound = '1';

  let keyboardArmed = false;
  let lastSentKey = { ch: '', t: 0 };

  const armKeyboard = () => {
    keyboardArmed = true;
    try { canvas.focus({ preventScroll: true }); } catch { try { canvas.focus(); } catch {} }
  };

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    armKeyboard();
    sendMouse('mousePressed', e);
  });
  canvas.addEventListener('mouseup', (e) => {
    armKeyboard();
    sendMouse('mouseReleased', e);
  });
  canvas.addEventListener('mousemove', (e) => {
    if (!streaming) return;
    if (e.buttons === 0) {
      sendMouse('mouseMoved', e, { hoverOnly: true });
      return;
    }
    if (!inputEnabled) return;
    const coords = normCoords(e);
    if (!coords) return;
    sendRemote('remote:input', {
      kind: 'mouse', type: 'mouseMoved', x: coords.x, y: coords.y,
      button: 'left', buttons: e.buttons,
    });
  });
  canvas.addEventListener('mouseleave', () => {
    sendRemote('remote:inspect', { clear: true });
  });

  function forwardWheel(e) {
    // Always stop Dashboard page scroll when pointer is over the remote stage
    if (!streaming) return;
    e.preventDefault();
    e.stopPropagation();
    if (!inputEnabled) return;
    const coords = normCoords(e) || { x: 0.5, y: 0.5 };
    let dx = e.deltaX;
    let dy = e.deltaY;
    if (e.deltaMode === 1) { dx *= 16; dy *= 16; }
    else if (e.deltaMode === 2) {
      const h = Math.max(240, canvas?.clientHeight || 720);
      dx *= h; dy *= h;
    }
    sendRemote('remote:input', {
      kind: 'mouse',
      type: 'mouseWheel',
      x: coords.x,
      y: coords.y,
      deltaX: dx,
      deltaY: dy,
    });
  }

  // Capture on wrap so Dashboard page scroll cannot steal the gesture (single handler — no double scroll)
  const wheelTarget = stageWrapEl || canvas;
  wheelTarget.addEventListener('wheel', forwardWheel, { passive: false, capture: true });

  canvas.setAttribute('tabindex', '0');

  function modifiersOf(e) {
    return (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
  }

  function onKeyDown(e) {
    if (!streaming || !inputEnabled || !keyboardArmed) return;
    const tag = (e.target && e.target.tagName) || '';
    if (e.target !== canvas && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const mods = modifiersOf(e);
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      // Client-side dedupe (guards double window listeners / repeat storms)
      if (lastSentKey.ch === e.key && now - lastSentKey.t < 20) return;
      lastSentKey = { ch: e.key, t: now };
      sendRemote('remote:input', { kind: 'text', text: e.key });
      return;
    }
    // Ignore browser key-repeat flood for navigation keys slightly
    if (e.repeat && (e.key === 'Backspace' || e.key === 'Delete')) {
      // allow repeat for backspace
    }
    sendRemote('remote:input', {
      kind: 'key',
      type: 'keyDown',
      key: e.key,
      code: e.code,
      keyCode: e.keyCode,
      modifiers: mods,
    });
  }

  function onKeyUp(e) {
    if (!streaming || !inputEnabled || !keyboardArmed) return;
    const tag = (e.target && e.target.tagName) || '';
    if (e.target !== canvas && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable)) {
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) return;
    e.preventDefault();
    sendRemote('remote:input', {
      kind: 'key',
      type: 'keyUp',
      key: e.key,
      code: e.code,
      keyCode: e.keyCode,
      modifiers: modifiersOf(e),
    });
  }

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  document.addEventListener('mousedown', (e) => {
    if (!canvas.contains(e.target) && e.target !== canvas
      && !(stageWrapEl && stageWrapEl.contains(e.target))) {
      keyboardArmed = false;
    }
  }, true);
}

export function initRemoteBrowser() {
  canvas = $('sessRemoteCanvas');
  stageEl = $('sessRemoteStage') || canvas?.parentElement;
  stageWrapEl = $('sessRemoteStageWrap') || stageEl?.parentElement;
  ctx = canvas?.getContext('2d');
  statusEl = $('sessRemoteStatus');
  inputHintEl = $('sessRemoteInputHint');
  if (!canvas) return;

  loadScalePreference();
  syncScaleControls();
  bindCanvasInput();
  fitCanvasToStage();
  window.addEventListener('resize', () => fitCanvasToStage());
  if (typeof ResizeObserver !== 'undefined' && stageWrapEl) {
    new ResizeObserver(() => fitCanvasToStage()).observe(stageWrapEl);
  }

  $('sessRemoteScaleMode')?.addEventListener('change', (e) => {
    setScaleFromUi(e.target.value);
  });
  $('sessRemoteScaleSlider')?.addEventListener('input', (e) => {
    const pct = Number(e.target.value);
    setScaleFromUi(pct / 100);
    const sel = $('sessRemoteScaleMode');
    if (sel) {
      // Reflect custom % — if exact preset exists select it, else leave previous preset
      const asStr = String(+(pct / 100).toFixed(2));
      const hit = [...sel.options].find((o) => o.value === asStr || o.value === String(pct / 100));
      if (hit) sel.value = hit.value;
    }
  });

  on('recording:detached', (payload) => {
    if (!eventBelongsHere(payload)) return;
    resetRemoteBrowserUi({ reason: payload?.reason || 'manual' });
  });
  on('recording:stream_detached', (payload) => {
    if (!eventBelongsHere(payload)) return;
    applyStatus({
      attached: false,
      cdpReady: true,
      remoteSessionId: null,
      reason: 'stream_detach',
      trajectoryId: payload?.trajectoryId,
    });
  });

  $('sessRemoteAttachBtn')?.addEventListener('click', async () => {
    try {
      if (!attached && !preferredSessionId) {
        const msg = '当前无可用浏览器会话。请先点「一键准备 / prepare」再附着推流。';
        setUiStatus(msg, 'warn');
        remoteLog(msg, 'err');
        return;
      }
      // Manual click always re-attaches BiB so stalled CDP after AI steps can recover.
      await ensureRemoteStream({
        sessionId: preferredSessionId || undefined,
        trajectoryId: preferredTrajectoryId || undefined,
        forceAttach: true,
      });
    } catch (e) {
      // ensureRemoteStream already set status + remoteLog
      console.warn('[remote] attach/stream failed:', e.message);
    }
  });

  $('sessRemoteDetachBtn')?.addEventListener('click', async () => {
    try {
      await detachLiveHttp();
      setUiStatus('已断开画面（槽位仍占用）', 'neutral');
    } catch (e) {
      setUiStatus(`断开画面失败: ${e.message}`, 'bad');
    }
  });

  on('remote:status', applyStatus);
  on('remote:tabs', (payload) => {
    applyTabsPayload(payload || {});
  });
  on('remote:inspect', (p) => {
    const el = $('sessRemoteInspectLabel');
    if (!el) return;
    const label = p?.label;
    el.textContent = label ? `悬停高亮：${label}` : '悬停高亮：—';
    el.title = label || '悬停高亮的元素';
  });
  on('remote:error', (p) => setUiStatus(`错误: ${p?.message || 'unknown'}`, 'bad'));
  on('manual_record_status', (p) => {
    // Refresh hint when user toggles 人工录制
    if ('enabled' in (p || {})) {
      applyStatus({ manualRecording: !!p.enabled });
    }
  });
  on('remote:frame', (payload) => {
    if (!streaming) return;
    if (remoteSessionUuid && payload?.sessionUuid && payload.sessionUuid !== remoteSessionUuid) {
      return;
    }
    if (!remoteSessionUuid && payload?.sessionUuid) {
      remoteSessionUuid = String(payload.sessionUuid);
    }
    // Per-frame ack removed — executor acks CDP immediately.
    if (payload?.jpeg) enqueueJpeg(payload.jpeg);
  });
  let lastAgentBusy = false;
  on('watcher:status', (p) => {
    if (!p) return;
    // Prefer traj/session-scoped live status over global agentBusy (multi-traj safe).
    if (preferredTrajectoryId != null || preferredSessionId) {
      fetchLiveStatus()
        .then((status) => {
          if (!status) return;
          applyStatus({
            ...status,
            connected: p.connected ?? status.connected,
            cdpReady: p.cdpReady != null ? !!p.cdpReady : status.cdpReady,
          });
          const busy = !!status.agentBusy;
          if (lastAgentBusy && !busy && attached) {
            sendRemote('remote:start', {});
            sendRemote('remote:status', {});
          }
          lastAgentBusy = busy;
        })
        .catch(() => {});
      return;
    }
    const busy = !!p.agentBusy;
    applyStatus({
      connected: !!p.connected,
      cdpReady: p.cdpReady != null ? !!p.cdpReady : cdpReady,
      agentBusy: busy,
      inputEnabled: attached && !busy,
    });
    if (lastAgentBusy && !busy && attached) {
      sendRemote('remote:start', {});
      sendRemote('remote:status', {});
    }
    lastAgentBusy = busy;
  });
  on('session:phase_done', () => {
    if (attached) applyStatus({ agentBusy: false, inputEnabled: true, trajectoryId: preferredTrajectoryId });
  });
  on('session:done', () => {
    if (attached) applyStatus({ agentBusy: false, inputEnabled: true, trajectoryId: preferredTrajectoryId });
  });
  on('session:phase_error', () => {
    if (attached) applyStatus({ agentBusy: false, inputEnabled: true, trajectoryId: preferredTrajectoryId });
  });
  on('session:error', () => {
    if (attached) applyStatus({ agentBusy: false, inputEnabled: true, trajectoryId: preferredTrajectoryId });
  });
  on('server:init', (data) => {
    const w = data?.watcher;
    if (w) {
      applyStatus({
        connected: !!w.connected,
        cdpReady: !!w.cdpReady,
        agentBusy: !!w.agentBusy,
      });
    }
  });
  on('ws:connected', () => {
    // Rebind traj scope after reconnect — otherwise frames keep flowing but input has no pick.
    if (streaming || attached || preferredTrajectoryId != null || preferredSessionId) {
      sendRemote('remote:subscribe', {});
      if (streaming || attached) {
        sendRemote('remote:start', { quality: 75 });
        sendRemote('remote:status', {});
      }
    }
  });

  on('ws:binary', (buf) => {
    const parsed = parseFrame(buf);
    if (!parsed) return;
    // Drop frames from other remote sessions (orphan / concurrent BiB).
    if (remoteSessionUuid && parsed.sessionUuid && parsed.sessionUuid !== remoteSessionUuid) {
      return;
    }
    if (!remoteSessionUuid && parsed.sessionUuid) {
      remoteSessionUuid = parsed.sessionUuid;
    }
    if (!streaming) streaming = true;
    // Chrome is acked on the executor; do not echo remote:ack per frame (congests /ws).
    enqueueJpeg(parsed.jpeg);
  });

  fetchLiveStatus()
    .then((status) => { if (status) applyStatus(status); })
    .catch(() => {});

  if (isConnected()) sendRemote('remote:status', {});
}

export { parseFrame };
