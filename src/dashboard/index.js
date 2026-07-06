// test-dashboard.js - Entry point
// Bootstrap all modules

import { renderSwaggerUI } from './swagger-api.js';
import { initScriptPipeline, checkWorkerHealth } from './script-pipeline.js';
import { initHistory, loadHistory } from './history.js';
import { initTrajectory, loadSnapshots } from './trajectory.js';
import { initCaseData, loadCaseDataHistory } from './case-data.js';
import { initSessionMode } from './session-mode.js';
import { initParticles } from './particles.js';

// ====== DOM refs helper (kept in global scope for inline onclick) ======
const $ = s => document.querySelector(s);

// ====== Image overlay ======
document.getElementById('overlayClose').addEventListener('click', () => {
  document.getElementById('imageOverlay').classList.remove('open');
});
document.getElementById('imageOverlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) document.getElementById('imageOverlay').classList.remove('open');
});

// Global screenshot viewer (called from inline onclick)
window.viewScreenshot = function(url) {
  const overlay = document.getElementById('imageOverlay');
  const img = document.getElementById('overlayImage');
  img.src = url;
  overlay.classList.add('open');
};

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

// ====== Server Health ======
async function checkHealth() {
  try {
    const r = await fetch('/api/health');
    const data = await r.json();
    const dot = document.querySelector('#serverStatus .status-dot');
    dot.className = 'status-dot ' + (data.status === 'ok' ? 'online' : 'offline');
    document.getElementById('serverStatus').innerHTML = `<span class="status-dot ${data.status === 'ok' ? 'online' : 'offline'}"></span>${data.opencode}`;
    const agents = data.agents || [];
    document.getElementById('agentBadge').textContent = agents.length + ' 个智能体';
    const skills = data.skills || [];
    document.getElementById('skillBadge').textContent = skills.length + ' 个技能';
  } catch (e) {
    document.getElementById('serverStatus').innerHTML = '<span class="status-dot offline"></span>Disconnected';
  }
}

// ====== Init ======
checkHealth();
setInterval(checkHealth, 10000);
setInterval(checkWorkerHealth, 15000);

// ====== Global execution lock ======
// Prevents multiple execution buttons from running simultaneously
window.__execLock__ = { running: false };

// ====== Module init ======
initScriptPipeline();
initHistory();
initTrajectory();
initCaseData();
initSessionMode();
initParticles();
