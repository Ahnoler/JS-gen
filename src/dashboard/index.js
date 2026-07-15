// test-dashboard.js - Entry point
// Bootstrap all modules

import { renderSwaggerUI } from './swagger-api.js';
import { initScriptPipeline, checkWorkerHealth } from './script-pipeline.js';
import { initHistory, loadHistory } from './history.js';
import { initTrajectory, loadSnapshots } from './trajectory.js';
import { initCaseData, loadCaseDataHistory } from './case-data.js';
import { initSessionMode } from './session-mode.js';
import { initParticles } from './particles.js';
import { initActionFlow } from './recording-flow.js';
import { initHierarchy, loadHierarchyTree } from './hierarchy.js';
import { initRemoteBrowser } from './remote-browser.js';
import { connect, on } from './ws-client.js';

// ====== DOM refs helper (kept in global scope for inline onclick) ======
const $ = s => document.querySelector(s);

// ====== Image overlay ======
let _screenshots = [];
let _ssIndex = 0;

document.getElementById('overlayClose').addEventListener('click', closeOverlay);
document.getElementById('imageOverlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeOverlay();
});

function closeOverlay() {
  document.getElementById('imageOverlay').classList.remove('open');
  document.removeEventListener('keydown', onOverlayKey);
}

function showImage(index) {
  if (_screenshots.length === 0) return;
  _ssIndex = Math.max(0, Math.min(index, _screenshots.length - 1));
  const img = document.getElementById('overlayImage');
  img.src = _screenshots[_ssIndex];
  document.getElementById('overlayPrev').style.visibility = _ssIndex > 0 ? '' : 'hidden';
  document.getElementById('overlayNext').style.visibility = _ssIndex < _screenshots.length - 1 ? '' : 'hidden';
  document.getElementById('overlayCounter').textContent =
    `${_ssIndex + 1} / ${_screenshots.length}`;
}

function onOverlayKey(e) {
  if (e.key === 'ArrowLeft') showImage(_ssIndex - 1);
  else if (e.key === 'ArrowRight') showImage(_ssIndex + 1);
  else if (e.key === 'Escape') closeOverlay();
}

// Global screenshot viewer (called from inline onclick)
window.viewScreenshot = function(url) {
  const overlay = document.getElementById('imageOverlay');
  overlay.classList.add('open');
  document.addEventListener('keydown', onOverlayKey);
  showImage(_screenshots.indexOf(url));
};

// Register a batch of screenshots (called from script-pipeline)
window.registerScreenshots = function(urls) {
  _screenshots = urls || [];
};

document.getElementById('overlayPrev').addEventListener('click', (e) => {
  e.stopPropagation();
  showImage(_ssIndex - 1);
});
document.getElementById('overlayNext').addEventListener('click', (e) => {
  e.stopPropagation();
  showImage(_ssIndex + 1);
});

// ====== Tab Switching ======
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
    const target = document.getElementById('tab' + btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1));
    if (target) target.style.display = 'block';
    if (btn.dataset.tab === 'history') loadHistory();
    if (btn.dataset.tab === 'trajectories') loadSnapshots();
    if (btn.dataset.tab === 'caseData') loadCaseDataHistory();
    if (btn.dataset.tab === 'hierarchy') loadHierarchyTree();
  });
});

// ====== API Reference Toggle ======
document.getElementById('apiDocHeader').addEventListener('click', () => {
  const content = document.getElementById('apiDocContent');
  const toggle = document.getElementById('apiDocToggle');
  const isOpen = content.style.display !== 'none';
  content.style.display = isOpen ? 'none' : 'block';
  toggle.textContent = isOpen ? 'Show' : 'Hide';
  if (!isOpen && !document.querySelector('.api-endpoint')) renderSwaggerUI();
});
if (document.getElementById('apiDocContent').style.display !== 'none') renderSwaggerUI();

// ====== Server Health (via WebSocket) ======
function updateServerStatus(data) {
  const dot = document.querySelector('#serverStatus .status-dot');
  dot.className = 'status-dot ' + (data.status === 'ok' ? 'online' : 'offline');
  document.getElementById('serverStatus').innerHTML = `<span class="status-dot ${data.status === 'ok' ? 'online' : 'offline'}"></span>${data.opencode || 'Connected (WS)'}`;
  const agents = data.agents || [];
  document.getElementById('agentBadge').textContent = agents.length + ' 个智能体';
  const skills = data.skills || [];
  document.getElementById('skillBadge').textContent = skills.length + ' 个技能';
}

function setServerDisconnected() {
  document.getElementById('serverStatus').innerHTML = '<span class="status-dot offline"></span>Disconnected';
}

// ====== Init ======
// 连接 WebSocket，连接后 server:init 事件会推送全量状态
connect();

// 监听 WebSocket 事件代替轮询
on('server:status', updateServerStatus);
on('ws:disconnected', setServerDisconnected);
on('ws:reconnect_failed', setServerDisconnected);

// 初始时先尝试一次 HTTP 健康检查作为回退（如果 WS 还没连上）
fetch('/api/health').then(r => r.json()).then(updateServerStatus).catch(setServerDisconnected);

// ====== Global execution lock ======
// Prevents multiple execution buttons from running simultaneously
window.__execLock__ = { running: false };

// ====== Module init ======
initScriptPipeline();
initHistory();
initTrajectory();
initCaseData();
initSessionMode();
initActionFlow();
initHierarchy();
initRemoteBrowser();
initParticles();
