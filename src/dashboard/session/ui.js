// Session mode UI helpers: log, timeline, button lock state

import { ts } from '../utils.js';
import { escapeHtml } from '../swagger-api.js';

export function wireUi(ctx) {
  ctx.sessLog = function sessLog(type, msg) {
    const line = document.createElement('div');
    line.className = 'log-line ' + type;
    line.innerHTML = '<span class="ts">' + ts() + '</span>' + msg.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (ctx.exploreLogTerminal) {
      ctx.exploreLogTerminal.appendChild(line);
      ctx.exploreLogTerminal.scrollTop = ctx.exploreLogTerminal.scrollHeight;
    }
  };

  ctx.sessTimelineStep = function sessTimelineStep(id, status, label, detail) {
    if (!ctx.sessTimeline) return;
    const emptyState = ctx.sessTimeline.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    const icons = {
      pending: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>',
      running: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
      success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>',
      failed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    };

    let existing = document.getElementById('sess-ti-' + id);
    if (!existing) {
      existing = document.createElement('div');
      existing.className = 'timeline-item';
      existing.id = 'sess-ti-' + id;
      ctx.sessTimeline.appendChild(existing);
    }
    existing.innerHTML = '<div class="timeline-dot ' + status + '">' + (icons[status] || icons.pending) + '</div>' +
      '<div class="timeline-content"><div class="timeline-label">' + escapeHtml(label) + '</div>' +
      (detail ? '<div class="timeline-detail open"><pre>' + escapeHtml(detail) + '</pre></div>' : '') +
      '<div class="timeline-status ' + (status === 'success' ? 'pass' : status === 'failed' ? 'fail' : 'running') + '">' + status + '</div></div>';
  };

  ctx.updateButtons = function updateButtons() {
    const active = ctx.sessActive.value;
    const hasSession = !!active;
    const locked = ctx.sessRunning || window.__execLock__.running;
    const loadEnabled = hasSession && !locked;
    const stepEnabled = hasSession && !locked;
    const trajEnabled = hasSession && !locked;
    const resetEnabled = hasSession && !locked;
    const cancelEnabled = ctx.sessRunning;
    const newEnabled = !locked;

    ctx.sessStepBtn.disabled = !stepEnabled;
    ctx.sessTrajBtn.disabled = !trajEnabled;
    ctx.sessCaseDataBtn.disabled = !trajEnabled;
    if (ctx.sessResetTrajBtn) ctx.sessResetTrajBtn.disabled = !resetEnabled;
    ctx.sessCancelBtn.disabled = !cancelEnabled;
    ctx.sessNewBtn.disabled = !newEnabled;

    document.querySelectorAll('.sess-phase-exec').forEach(btn => { btn.disabled = locked; });

    const hasPhaseMarkers = (ctx.sessTask && (ctx.sessTask.value.trim().includes('【阶段') || /^##\s+Phase\s+\d+/m.test(ctx.sessTask.value.trim())));
    if (loadEnabled) {
      ctx.sessLoadBtn.disabled = !hasPhaseMarkers;
      ctx.sessLoadBtn.title = hasPhaseMarkers ? '解析测试用例文本，提取阶段计划' : '请添加 【阶段N：xxx】 或 ## Phase N: 格式的阶段标记';
    } else {
      ctx.sessLoadBtn.disabled = true;
      ctx.sessLoadBtn.title = locked ? '任务执行中…' : '无活跃会话';
    }

    if (!hasSession) ctx.sessStatus.textContent = '无活跃会话';

    console.log('[sess-mode] updateButtons:', JSON.stringify({
      hasSession, sessRunning: ctx.sessRunning, locked, hasPhaseMarkers,
      loadDisabled: ctx.sessLoadBtn.disabled,
      stepDisabled: ctx.sessStepBtn.disabled,
    }));
  };

  ctx.setUILocked = function setUILocked(locked) {
    const btns = document.querySelectorAll('#genBtn, #exploreStartBtn, #sessStepBtn, #genRunBtn, #sessLoginBtn');
    btns.forEach(b => { if (b) b.disabled = locked; });
    ctx.sessRunning = locked;
    window.__execLock__.running = locked;
    ctx.updateButtons();
  };
}
