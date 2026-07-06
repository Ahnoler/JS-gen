// Multi-Turn Session Mode
// Extracted from test-dashboard.js initSessionMode IIFE

import { ts } from './utils.js';
import { escapeHtml } from './swagger-api.js';

export function initSessionMode() {
  const sessNewBtn = document.getElementById('sessNewBtn');
  const sessLoadBtn = document.getElementById('sessLoadBtn');
  const sessStepBtn = document.getElementById('sessStepBtn');
  const sessTrajBtn = document.getElementById('sessTrajBtn');
  const sessResetTrajBtn = document.getElementById('sessResetTrajBtn');
  const sessCaseDataBtn = document.getElementById('sessCaseDataBtn');
  const sessCancelBtn = document.getElementById('sessCancelBtn');
  const sessTask = document.getElementById('sessTask');
  const sessModel = document.getElementById('sessModel');
  const sessMaxSteps = document.getElementById('sessMaxSteps');
  const sessActive = document.getElementById('sessActive');
  const sessStatus = document.getElementById('sessStatus');
  const sessTimeline = document.getElementById('sessTimeline');
  const sessStepCount = document.getElementById('sessStepCount');
  const sessTrajectoryId = document.getElementById('sessTrajectoryId');
  const sessTrajPath = document.getElementById('sessTrajPath');
  const exploreLogTerminal = document.getElementById('exploreLogTerminal');
  const sessCloseBrowserBtn = document.getElementById('sessCloseBrowserBtn');
  const sessUploadBtn = document.getElementById('sessUploadBtn');
  const sessFileInput = document.getElementById('sessFileInput');
  const sessFileName = document.getElementById('sessFileName');
  const sessLoginToggle = document.getElementById('sessLoginToggle');
  const sessLoginSection = document.getElementById('sessLoginSection');
  const sessLoginUrl = document.getElementById('sessLoginUrl');
  const sessLoginUser = document.getElementById('sessLoginUser');
  const sessLoginPass = document.getElementById('sessLoginPass');
  const sessLoginBtn = document.getElementById('sessLoginBtn');

  if (!sessNewBtn) return;

  let sessAbortController = null;
  let sessRunning = false;
  let sessionPhases = [];

  function sessLog(type, msg) {
    const line = document.createElement('div');
    line.className = 'log-line ' + type;
    line.innerHTML = '<span class="ts">' + ts() + '</span>' + msg.replace(/</g,'&lt;').replace(/>/g,'&gt;');
    if (exploreLogTerminal) {
      exploreLogTerminal.appendChild(line);
      exploreLogTerminal.scrollTop = exploreLogTerminal.scrollHeight;
    }
  }

  function sessTimelineStep(id, status, label, detail) {
    if (!sessTimeline) return;
    const emptyState = sessTimeline.querySelector('.empty-state');
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
      sessTimeline.appendChild(existing);
    }
    existing.innerHTML = '<div class="timeline-dot ' + status + '">' + (icons[status] || icons.pending) + '</div>' +
      '<div class="timeline-content"><div class="timeline-label">' + escapeHtml(label) + '</div>' +
      (detail ? '<div class="timeline-detail open"><pre>' + escapeHtml(detail) + '</pre></div>' : '') +
      '<div class="timeline-status ' + (status === 'success' ? 'pass' : status === 'failed' ? 'fail' : 'running') + '">' + status + '</div></div>';
  }

  function updateButtons() {
    const active = sessActive.value;
    const hasSession = !!active;
    const locked = sessRunning || window.__execLock__.running;
    const loadEnabled = hasSession && !locked;
    const stepEnabled = hasSession && !locked;
    const trajEnabled = hasSession && !locked;
    const resetEnabled = hasSession && !locked;
    const cancelEnabled = sessRunning;
    const newEnabled = !locked;

    sessStepBtn.disabled = !stepEnabled;
    sessTrajBtn.disabled = !trajEnabled;
    sessCaseDataBtn.disabled = !trajEnabled;
    if (sessResetTrajBtn) sessResetTrajBtn.disabled = !resetEnabled;
    sessCancelBtn.disabled = !cancelEnabled;
    sessNewBtn.disabled = !newEnabled;

    // Phase card execute buttons
    document.querySelectorAll('.sess-phase-exec').forEach(btn => { btn.disabled = locked; });

    const hasPhaseMarkers = (sessTask && (sessTask.value.trim().includes('【阶段') || /^##\s+Phase\s+\d+/m.test(sessTask.value.trim())));
    if (loadEnabled) {
      sessLoadBtn.disabled = !hasPhaseMarkers;
      sessLoadBtn.title = hasPhaseMarkers ? '解析测试用例文本，提取阶段计划' : '请添加 【阶段N：xxx】 或 ## Phase N: 格式的阶段标记';
    } else {
      sessLoadBtn.disabled = true;
      sessLoadBtn.title = locked ? '任务执行中…' : '无活跃会话';
    }

    if (!hasSession) sessStatus.textContent = '无活跃会话';

    console.log('[sess-mode] updateButtons:', JSON.stringify({
      hasSession, sessRunning, locked, hasPhaseMarkers,
      loadDisabled: sessLoadBtn.disabled,
      stepDisabled: sessStepBtn.disabled,
    }));
  }

  function parseExplorePhases(text) {
    const bracketRegex = /【阶段(\d+)[：:]\s*(.+?)】/g;
    const markdownRegex = /^##\s+Phase\s+(\d+)[：:]\s*(.+)$/gm;

    const usesMarkdown = new RegExp(markdownRegex.source, 'm').test(text);
    const phaseRegex = usesMarkdown ? markdownRegex : bracketRegex;

    const phases = [];
    let prefix = '';
    phaseRegex.lastIndex = 0;
    const firstMatch = phaseRegex.exec(text);
    if (firstMatch && usesMarkdown) {
      prefix = text.slice(0, firstMatch.index).trim();
    }
    phaseRegex.lastIndex = 0;
    let match;
    const matches = [];
    while ((match = phaseRegex.exec(text)) !== null) {
      matches.push({ num: parseInt(match[1]), name: match[2].trim(), index: match.index, endIndex: phaseRegex.lastIndex });
    }
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const contentStart = m.endIndex;
      const contentEnd = i + 1 < matches.length ? matches[i + 1].index : text.length;
      let content = text.slice(contentStart, contentEnd).trim();
      if (i === 0 && prefix) content = prefix + '\n\n' + content;
      content = content.replace(/^\d+[\.\)、]\s*截图[^：:\n]*$/gm, '').trim();

      if (usesMarkdown) {
        content = content.replace(/\n{3,}/g, '\n\n').trim();
      }

      const navPhases = ['登录', '导航'];
      const isNav = navPhases.some(kw => m.name.includes(kw));
      phases.push({
        num: m.num,
        name: '阶段' + m.num + '：' + m.name,
        task: content,
        maxSteps: isNav ? 50 : 100,
        status: 'pending',
      });
    }
    return phases;
  }

  function buildPhaseCarouselHtml(phases) {
    let html = '<div class="sess-phase-carousel" style="position:relative;overflow:hidden;padding:0 40px">';
    html += '<div class="sess-phase-track" style="display:flex;transition:transform 0.35s cubic-bezier(.4,0,.2,1)">';
    phases.forEach((p, i) => {
      const shortTask = p.task;
      html += '<div class="sess-phase-slide" data-index="' + i + '" style="flex:0 0 100%;padding:0 8px">';
      html += '<div class="sess-phase-item" style="border:1px solid var(--slate-200);border-radius:var(--radius-sm);padding:14px 16px;background:var(--slate-50)">';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">';
      html += '<strong style="font-size:14px;color:var(--slate-700)">' + escapeHtml(p.name) + '</strong>';
      html += '<div style="display:flex;gap:8px;align-items:center">';
      html += '<span class="sess-phase-status" data-index="' + i + '" style="font-size:12px;font-weight:600;color:var(--slate-400)">' + p.status + '</span>';
      html += '<button class="btn btn-sm btn-primary sess-phase-exec" data-index="' + i + '" style="font-size:11px">执行</button>';
      html += '</div></div>';
      html += '<pre style="font-size:12px;color:var(--slate-500);white-space:pre-wrap;max-height:500px;overflow-y:auto;margin:0 0 6px;font-family:var(--font-mono)">' + escapeHtml(shortTask) + '</pre>';
      html += '<div style="font-size:11px;color:var(--slate-400)">最大步数：' + p.maxSteps + '</div>';
      html += '</div></div>';
    });
    html += '</div>';
    html += '<button class="sess-phase-prev" style="position:absolute;left:0;top:50%;transform:translateY(-50%);background:var(--indigo-600);color:#fff;border:none;border-radius:50%;width:32px;height:32px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,.2);z-index:2">‹</button>';
    html += '<button class="sess-phase-next" style="position:absolute;right:0;top:50%;transform:translateY(-50%);background:var(--indigo-600);color:#fff;border:none;border-radius:50%;width:32px;height:32px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,.2);z-index:2">›</button>';
    html += '<div style="padding:8px 0 0;text-align:center">';
    html += '<input type="range" class="sess-phase-slider" min="0" max="' + (phases.length - 1) + '" value="0" style="width:80%;height:4px;cursor:pointer;accent-color:var(--indigo-500)">';
    html += '<span class="sess-phase-slider-label" style="font-size:11px;color:var(--slate-400);margin-left:8px">1 / ' + phases.length + '</span>';
    html += '</div>';
    return html;
  }

  function bindPhaseCarouselEvents(list, phases) {
    let currentSlide = 0;

    function showSlide(idx) {
      if (idx < 0) idx = 0;
      if (idx >= phases.length) idx = phases.length - 1;
      currentSlide = idx;
      const track = list.querySelector('.sess-phase-track');
      if (track) track.style.transform = 'translateX(-' + (idx * 100) + '%)';
      const slider = list.querySelector('.sess-phase-slider');
      if (slider) { slider.value = idx; }
      const label = list.querySelector('.sess-phase-slider-label');
      if (label) label.textContent = (idx + 1) + ' / ' + phases.length;
    }

    list.querySelector('.sess-phase-prev').addEventListener('click', () => showSlide(currentSlide - 1));
    list.querySelector('.sess-phase-next').addEventListener('click', () => showSlide(currentSlide + 1));
    const slider = list.querySelector('.sess-phase-slider');
    if (slider) {
      slider.addEventListener('input', () => showSlide(parseInt(slider.value)));
    }

    list.querySelectorAll('.sess-phase-exec').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index);
        const phase = phases[idx];
        if (!phase) return;
        if (!sessActive.value) { sessLog('error', '无活跃会话'); return; }
        executeSessionStep(sessActive.value, phase.task, phase.maxSteps, phase.name, idx);
      });
    });

    const handleKey = (e) => {
      if (e.key === 'ArrowLeft') { showSlide(currentSlide - 1); e.preventDefault(); }
      if (e.key === 'ArrowRight') { showSlide(currentSlide + 1); e.preventDefault(); }
    };
    list.addEventListener('keydown', handleKey);
    list.tabIndex = 0;

    showSlide(0);
  }

  function renderPhasePlan(phases) {
    const plan = document.getElementById('sessPhasePlan');
    const list = document.getElementById('sessPhaseList');
    const countEl = document.getElementById('sessPhaseCount');
    const runAllBtn = document.getElementById('sessRunAllBtn');
    if (!plan || !list) return;
    if (!phases || phases.length === 0) { plan.style.display = 'none'; sessionPhases = []; return; }
    plan.style.display = 'block';
    sessionPhases = phases;
    countEl.textContent = phases.length + ' 个阶段';
    if (runAllBtn) runAllBtn.style.display = (phases.length > 1) ? '' : 'none';

    list.innerHTML = buildPhaseCarouselHtml(phases);
    bindPhaseCarouselEvents(list, phases);
  }

  async function runAllPhases() {
    if (!sessionPhases || sessionPhases.length === 0) return;
    if (!sessActive.value) { sessLog('error', '无活跃会话'); return; }
    const runAllBtn = document.getElementById('sessRunAllBtn');
    if (runAllBtn) runAllBtn.disabled = true;
    setUILocked(true);
    sessLog('system', '▶ 正在执行全部 ' + sessionPhases.length + ' 个阶段…');

    for (let i = 0; i < sessionPhases.length; i++) {
      const phase = sessionPhases[i];
      sessLog('system', '▶ 阶段 ' + (i + 1) + '/' + sessionPhases.length + ': ' + phase.name);
      sessPhaseUpdateStatus(i, 'running');
      try {
        await executeSessionStep(sessActive.value, phase.task, phase.maxSteps, phase.name, i);
        sessPhaseUpdateStatus(i, 'success');
      } catch (err) {
        sessPhaseUpdateStatus(i, 'failed');
        sessLog('error', 'Phase ' + (i + 1) + ' failed: ' + (err.message || err));
        break;
      }
    }

    setUILocked(false);
    if (runAllBtn) runAllBtn.disabled = false;
    sessLog('success', '所有阶段已完成');
  }

  function sessPhaseUpdateStatus(idx, status) {
    const list = document.getElementById('sessPhaseList');
    if (!list) return;
    const el = list.querySelector('.sess-phase-status[data-index="' + idx + '"]');
    if (!el) return;
    const colors = { running: 'var(--indigo-500)', success: 'var(--green-500)', failed: 'var(--red-500)', pending: 'var(--slate-400)' };
    el.textContent = status;
    el.style.color = colors[status] || 'var(--slate-400)';
    const execBtn = list.querySelector('.sess-phase-exec[data-index="' + idx + '"]');
    if (execBtn && (status === 'success' || status === 'failed')) execBtn.textContent = status === 'success' ? '重跑' : '重试';
  }

  function setInterventionCardMode(mode) {
    const card = document.getElementById('sessInterventionCard');
    const header = document.getElementById('sessInterventionHeader');
    const icon = document.getElementById('sessInterventionIcon');
    if (!card || !header || !icon) return;

    if (mode === 'warn') {
      card.style.borderColor = '#f59e0b';
      header.style.background = '#fffbeb';
      icon.style.stroke = '#f59e0b';
      icon.innerHTML = '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>';
    } else {
      card.style.borderColor = '';
      header.style.background = '';
      icon.style.stroke = 'currentColor';
      icon.innerHTML = '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>';
    }
  }

  let _interventionFields = [];  // tracked across SSE events for incremental updates

  function showInterventionAlerts(data) {
    const alerts = document.getElementById('sessInterventionAlerts');
    const badge = document.getElementById('sessInterventionBadge');
    if (!alerts) return;
    const fields = data.fields || [];
    const source = data.source || '';

    // Track for incremental removal
    _interventionFields = fields;

    if (fields.length === 0) {
      alerts.innerHTML = '';
      if (badge) badge.style.display = 'none';
      setInterventionCardMode('normal');
      return;
    }

    // Switch to warning mode + update badge
    setInterventionCardMode('warn');
    if (badge) {
      badge.textContent = fields.length + ' field' + (fields.length > 1 ? 's' : '');
      badge.style.display = 'inline-block';
    }

    // Build field detail cards
    let html = '';
    for (const f of fields) {
      html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:#fffbeb;border:1px solid #fde68a;border-radius:4px;margin-bottom:4px;font-size:12px">';
      html += '<span style="font-weight:600;color:var(--slate-800)">' + escapeHtml(f.label) + '</span>';
      html += '<span style="color:var(--slate-400)">kind:</span><code style="font-size:10px;background:var(--slate-100);padding:1px 4px;border-radius:2px">' + escapeHtml(f.kind || 'input') + '</code>';
      html += '<span style="color:var(--slate-400)">button:</span><code style="font-size:10px;background:#fef3c7;padding:1px 4px;border-radius:2px;color:#92400e">' + escapeHtml(f.hasButton || '(none)') + '</code>';
      html += '</div>';
    }
    if (source) {
      html += '<div style="font-size:10px;color:var(--slate-400);margin-bottom:4px">Source: ' + escapeHtml(source) + '</div>';
    }
    alerts.innerHTML = html;
  }

  function createSSEEventHandler(stepNum, label, phaseIdx) {
    return (evt, d) => {
      switch (evt) {
        case 'step': sessLog('info', '步骤 ' + d.step + ': ' + (d.next_goal || (d.actions || []).join(', '))); break;
        case 'phase_start': sessLog('system', '已开始：' + d.name); break;
        case 'phase_done':
          sessLog('success', '已完成：' + label);
          sessTimelineStep('step-' + stepNum, 'success', label, '完成');
          if (phaseIdx !== undefined) sessPhaseUpdateStatus(phaseIdx, 'success');
          if (sessTrajPath && d.cumulative_file) {
            sessTrajPath.style.display = 'block';
            sessTrajPath.textContent = '轨迹：' + d.cumulative_file;
          }
          setTimeout(() => loadActiveSessions(), 300);
          break;
        case 'phase_error': case 'error':
          sessLog('error', d.message || '执行错误');
          sessTimelineStep('step-' + stepNum, 'failed', label, d.message || '');
          if (phaseIdx !== undefined) sessPhaseUpdateStatus(phaseIdx, 'failed');
          break;
        case 'nav_step': sessLog('info', 'Nav: ' + d.label); break;
        case 'done': sessLog('system', '已完成'); break;
        case 'intervention_needed':
          showInterventionAlerts(d);
          sessLog('system', '🔔 Intervention needed: ' + (d.fields || []).map(f => f.label).join(', '));
          break;
        case 'intervention_resolved':
          // Remove resolved field from tracked list and re-render remaining
          _interventionFields = _interventionFields.filter(f => f.label !== d.label);
          showInterventionAlerts({ fields: _interventionFields, source: 'updated' });
          sessLog('success', '✅ Intervention resolved: ' + d.label + (d.remaining && d.remaining.length ? ' — ' + d.remaining.length + ' remaining' : ' — all clear'));
          break;
      }
    };
  }

  function parseSSEStream(text, handler) {
    const lines = text.split('\n');
    let evt = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) evt = line.slice(7).trim();
      else if (line.startsWith('data: ') && evt) {
        try { handler(evt, JSON.parse(line.slice(6))); } catch (e) {}
        evt = '';
      }
    }
  }

  async function readSSEStream(reader, handler) {
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!sessRunning) { reader.cancel(); break; }
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop();
      for (const part of parts) { if (part.trim()) parseSSEStream(part + '\n', handler); }
    }
  }

  function setUILocked(locked) {
    const btns = document.querySelectorAll('#genBtn, #exploreStartBtn, #sessStepBtn, #genRunBtn, #sessLoginBtn');
    btns.forEach(b => { if (b) b.disabled = locked; });
    sessRunning = locked;
    window.__execLock__.running = locked;
    updateButtons();
  }

  async function executeSessionStep(sessionId, task, maxSteps, label, phaseIdx) {
    setUILocked(true);
    sessStatus.textContent = '执行中…';
    const stepNum = (parseInt(sessStepCount.textContent) || 0) + 1;
    sessStepCount.textContent = stepNum + ' steps';
    sessTimelineStep('step-' + stepNum, 'running', label, task.slice(0, 80));
    sessLog('system', '步骤 ' + stepNum + ': ' + label);
    if (phaseIdx !== undefined) sessPhaseUpdateStatus(phaseIdx, 'running');

    sessAbortController = new AbortController();
    try {
      const resp = await fetch('/api/browser/session/' + sessionId + '/step', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task, maxSteps,
          caseDataFile: document.getElementById('sessCaseDataFile')?.value?.trim() || undefined,
        }),
        signal: sessAbortController.signal,
      });
      if (!resp.ok) { const err = await resp.json().catch(() => ({ error: 'HTTP ' + resp.status })); throw new Error(err.error || 'Request failed'); }

      const handler = createSSEEventHandler(stepNum, label, phaseIdx);
      await readSSEStream(resp.body.getReader(), handler);
    } catch (err) {
      const isAbort = err.name === 'AbortError';
      sessLog(isAbort ? 'system' : 'error', isAbort ? '已取消' : err.message);
      sessTimelineStep('step-' + stepNum, 'failed', label, isAbort ? '已取消' : err.message.slice(0, 100));
      if (phaseIdx !== undefined) sessPhaseUpdateStatus(phaseIdx, 'failed');
    }
    sessAbortController = null;
    setUILocked(false);
  }

  window.loadActiveSessions = async function () {
    if (!sessActive) return;
    try {
      const res = await fetch('/api/browser/sessions');
      const list = await res.json();
      const currentVal = sessActive.value;
      sessActive.innerHTML = '<option value="">(none)</option>';
      list.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.sessionId;
        const short = s.sessionId.slice(0, 8);
        const busy = s.busy ? ' [busy]' : '';
        opt.textContent = short + '... [' + s.stepIndex + ']' + busy + ' ' + (s.model || '').slice(0, 20);
        sessActive.appendChild(opt);
      });
      if (currentVal && Array.from(sessActive.options).some(o => o.value === currentVal)) {
        sessActive.value = currentVal;
      }
      if (sessCloseBrowserBtn) sessCloseBrowserBtn.style.display = list.length > 0 ? '' : 'none';
      onSessionChange();
      return list;
    } catch (e) {
      console.error('Failed to load sessions:', e);
    }
  };

  function onSessionChange() {
    const active = sessActive.value;
    if (!active) {
      sessStatus.textContent = '无活跃会话';
      sessTrajectoryId.textContent = '';
      if (sessTrajPath) { sessTrajPath.style.display = 'none'; sessTrajPath.textContent = ''; }
      sessStepCount.textContent = '0 步';
      sessTimeline.innerHTML = '<div class="empty-state" style="padding:20px"><p>发送步骤指令以开始</p></div>';
      document.getElementById('sessPhasePlan').style.display = 'none';
      // Clear intervention alerts + reset to normal style on session change
      _interventionFields = [];
      const alerts = document.getElementById('sessInterventionAlerts');
      const badge = document.getElementById('sessInterventionBadge');
      if (alerts) alerts.innerHTML = '';
      if (badge) badge.style.display = 'none';
      setInterventionCardMode('normal');
      sessionPhases = [];
      updateButtons();
      return;
    }
    fetch('/api/browser/session/' + active + '/trajectories').then(r => r.json()).then(data => {
      sessStatus.textContent = '活跃 ' + active.slice(0, 8) + '... | ' + data.stepIndex + ' 步' + (data.busy ? ' (忙碌)' : '');
      sessStepCount.textContent = data.stepIndex + ' steps';
      if (sessTimeline && data.steps && data.steps.length > 0) {
        sessTimeline.innerHTML = '';
        data.steps.forEach(s => {
          const time = s.time ? new Date(s.time).toLocaleString() : '';
          sessTimelineStep('step-' + s.step, 'success', '步骤 ' + s.step, time);
        });
      }
      updateButtons();
      if (data.busy) {
        sessStepBtn.disabled = true;
        sessCancelBtn.disabled = false;
      }
    }).catch(() => {
      sessStatus.textContent = '会话已退出';
      sessActive.value = '';
      updateButtons();
    });
  }

  sessActive.addEventListener('change', onSessionChange);

  sessNewBtn.addEventListener('click', async () => {
    const model = sessModel.value;
    sessNewBtn.disabled = true;
    sessStatus.textContent = '创建中…';
    sessLog('system', '正在创建新会话…');
    try {
      const res = await fetch('/api/browser/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model || undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      const data = await res.json();
      sessLog('success', '会话已创建：' + data.sessionId);
      await loadActiveSessions();
      sessActive.value = data.sessionId;
      onSessionChange();
    } catch (err) {
      sessLog('error', '创建会话失败：' + err.message);
      sessStatus.textContent = '创建失败';
    }
    sessNewBtn.disabled = false;
    updateButtons();
  });

  sessLoadBtn.addEventListener('click', async () => {
    const sessionId = sessActive.value;
    const caseText = sessTask.value.trim();
    if (!sessionId) { sessLog('error', '无活跃会话 — 请先创建一个'); return; }
    if (!caseText || !(/【阶段|^##\s+Phase\s+\d+/m.test(caseText))) {
      sessLog('warn', '未找到阶段标记。请在文本区域中使用 【阶段N：名称】 或 ## Phase N: 格式。');
      return;
    }

    // 1. Preserve executed phases (success/failed) from current cards
    const preservedMap = {};
    sessionPhases.forEach((p, i) => {
      if (p.status !== 'pending') preservedMap[p.num] = p;
    });
    const keptCount = Object.keys(preservedMap).length;

    // 2. Parse new phases from text — only import those not already executed
    const newPhases = parseExplorePhases(caseText);
    const merged = [];
    newPhases.forEach(p => {
      if (preservedMap[p.num] !== undefined) {
        merged.push(preservedMap[p.num]); // keep executed phase as-is
      } else {
        merged.push(p); // import new/updated phase as pending
      }
    });

    // 3. Append any preserved phases whose num no longer exists in new text
    const newNums = new Set(newPhases.map(p => p.num));
    Object.values(preservedMap).forEach(p => {
      if (!newNums.has(p.num)) merged.push(p);
    });

    // Sort by phase num
    merged.sort((a, b) => a.num - b.num);

    renderPhasePlan(merged);
    const imported = merged.length - keptCount - (Object.values(preservedMap).filter(p => !newNums.has(p.num)).length);
    sessLog('system', 'Loaded: ' + keptCount + ' preserved, ' + Math.max(0, merged.length - keptCount) + ' imported (' + merged.length + ' total)');
  });

  // File upload
  if (sessUploadBtn && sessFileInput) {
    sessUploadBtn.addEventListener('click', () => sessFileInput.click());
    sessFileInput.addEventListener('change', async () => {
      const file = sessFileInput.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        sessTask.value = text;
        if (sessFileName) sessFileName.textContent = file.name + ' (' + (text.length / 1024).toFixed(1) + ' KB)';
        sessLog('system', '已加载文件：' + file.name);
        updateButtons();
        // Auto-trigger Load if session active and markers present
        if (sessActive.value && (/【阶段|^##\s+Phase\s+\d+/m.test(text))) {
          setTimeout(() => sessLoadBtn.click(), 300);
        }
      } catch (err) {
        sessLog('error', '文件读取失败：' + err.message);
      }
      sessFileInput.value = '';
    });
  }

  // Login & Navigate
  if (sessLoginToggle && sessLoginSection) {
    sessLoginToggle.addEventListener('click', () => {
      const hidden = sessLoginSection.style.display === 'none';
      sessLoginSection.style.display = hidden ? '' : 'none';
      sessLoginToggle.textContent = hidden ? '收起' : '展开';
    });
  }

  if (sessLoginBtn) {
    sessLoginBtn.addEventListener('click', async () => {
      const url = sessLoginUrl?.value.trim();
      const user = sessLoginUser?.value.trim();
      const pass = sessLoginPass?.value.trim();
      if (!url) { sessLog('error', '目标地址不能为空'); return; }

      // Create a session if none active
      let sessionId = sessActive.value;
      if (!sessionId) {
        sessNewBtn.disabled = true;
        sessStatus.textContent = '创建中…';
        sessLog('system', '正在为登录创建新会话…');
        try {
          const res = await fetch('/api/browser/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: sessModel?.value || undefined }),
          });
          if (!res.ok) throw new Error((await res.json()).error || 'Failed');
          const data = await res.json();
          sessionId = data.sessionId;
          await loadActiveSessions();
          sessActive.value = data.sessionId;
          onSessionChange();
          sessLog('success', '会话已创建：' + data.sessionId);
        } catch (err) {
          sessLog('error', '创建会话失败：' + err.message);
          sessNewBtn.disabled = false;
          return;
        }
        sessNewBtn.disabled = false;
      }

      // Build login task
      let loginTask = 'Navigate to ' + url;
      if (user) loginTask += '\nEnter username: ' + user;
      if (pass) loginTask += '\nEnter password: ' + pass;
      if (user && pass) loginTask += '\nClick the login/submit button\nWait for the page to fully load after login';

      await executeSessionStep(sessionId, loginTask, 30, 'Login: ' + url);
    });
  }

  sessStepBtn.addEventListener('click', () => {
    const sessionId = sessActive.value;
    const task = sessTask.value.trim();
    const maxSteps = parseInt(sessMaxSteps.value) || 100;
    if (!sessionId || !task) return;
    executeSessionStep(sessionId, task, maxSteps, task.slice(0, 60));
  });

  sessCancelBtn.addEventListener('click', () => {
    if (sessAbortController) { sessAbortController.abort(); sessAbortController = null; }
    sessRunning = false;
    sessLog('system', '步骤已取消');
    updateButtons();
  });

  sessTrajBtn.addEventListener('click', async () => {
    const sessionId = sessActive.value;
    if (!sessionId) return;
    if (!confirm('保存动作文件 + 操作日志 + 表单快照？')) return;
    sessTrajBtn.disabled = true;
    sessLog('system', '正在保存…');
    try {
      const res = await fetch('/api/browser/session/' + sessionId + '/trajectory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: sessTask.value || undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Server error');
      const data = await res.json();
      const actionName = (data.action_file || '').split(/[\\/]/).pop() || '';
      const logName = (data.log_file || '').split(/[\\/]/).pop() || '';
      sessTrajectoryId.textContent = actionName.replace('.json','').slice(0,20) + '... |' + logName.replace('.txt','').slice(0,20) + '...';
      sessLog('success', data.action_count + ' 个动作 + ' + data.log_count + ' 条日志行已保存');
    } catch (err) {
      sessLog('error', '保存失败：' + err.message);
    }
    sessTrajBtn.disabled = false;
  });

  sessCaseDataBtn.addEventListener('click', async () => {
    const sessionId = sessActive.value;
    if (!sessionId) return;
    if (!confirm('保存案例数据到 JSON 文件？这将持久化当前案例数据存储。')) return;
    sessCaseDataBtn.disabled = true;
    sessLog('system', '正在保存案例数据…');
    try {
      const res = await fetch('/api/browser/session/' + sessionId + '/save-case-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Server error');
      const data = await res.json();
      sessLog('success', '案例数据已保存：' + data.caseDataFile + ' (' + data.keys + ' 个键)');
    } catch (err) {
      sessLog('error', '保存案例数据失败：' + err.message);
    }
    sessCaseDataBtn.disabled = false;
  });

  sessResetTrajBtn.addEventListener('click', async () => {
    const sessionId = sessActive.value;
    if (!sessionId) return;
    if (!confirm('重置轨迹录制？将创建新的累积轨迹文件，旧文件保留在 /tmp/ 中。')) return;
    sessResetTrajBtn.disabled = true;
    sessLog('system', '正在重置轨迹录制…');
    try {
      let res, data;
      for (let attempt = 0; attempt < 5; attempt++) {
        res = await fetch('/api/browser/session/' + sessionId + '/reset-trajectory', { method: 'POST' });
        if (res.status === 409) {
          sessLog('system', 'Browser busy, retrying in 2s... (' + (attempt + 1) + '/5)');
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        break;
      }
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))).error) || 'Server error');
      data = await res.json();
      if (sessTrajPath) {
        sessTrajPath.style.display = 'block';
        const parts = [];
        if (data.cumulative_file) parts.push('轨迹：' + data.cumulative_file);
        if (data.case_data_file) parts.push('CaseData: ' + data.case_data_file);
        sessTrajPath.textContent = parts.join(' | ');
      }
      sessLog('success', '新轨迹文件：' + (data.cumulative_file || 'ready'));
    } catch (err) {
      sessLog('error', '重置失败：' + err.message);
    }
    sessResetTrajBtn.disabled = false;
  });


  if (sessCloseBrowserBtn) {
    sessCloseBrowserBtn.addEventListener('click', async () => {
      if (!confirm('关闭全局浏览器？所有会话将被清除。')) return;
      sessLog('system', '正在关闭全局浏览器…');
      try {
        await fetch('/api/browser/browser', { method: 'DELETE' });
        sessLog('success', '浏览器已关闭');
        sessActive.innerHTML = '<option value="">(none)</option>';
        onSessionChange();
      } catch (err) {
        sessLog('error', '关闭失败：' + err.message);
      }
    });
  }

  setTimeout(() => loadActiveSessions(), 500);
  setInterval(() => loadActiveSessions(), 5000);

  // Listen for task content changes so Load button auto-enables when 【阶段 markers appear
  if (sessTask) {
    sessTask.addEventListener('input', () => {
      updateButtons();
    });
  }

  // Intervention Send button — sends instruction to running agent
  const interventionSendBtn = document.getElementById('sessInterventionSendBtn');
  if (interventionSendBtn) {
    interventionSendBtn.addEventListener('click', async () => {
      if (!sessActive.value) { sessLog('error', '无活跃会话'); return; }
      const intervention = document.getElementById('sessInterventionInput')?.value?.trim() || '';
      if (!intervention) {
        sessLog('system', '未输入干预文本。请在上方描述工作流，然后点击发送。');
        return;
      }
      sessLog('system', '正在发送干预指令：' + intervention.slice(0, 80));
      try {
        const resp = await fetch('/api/browser/session/' + sessActive.value + '/intervene', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instruction: intervention }),
        });
        if (!resp.ok) throw new Error((await resp.json()).error || 'Failed');
        document.getElementById('sessInterventionInput').value = '';
        sessLog('success', 'Intervention sent — agent will process it on the next step');
      } catch (err) {
        sessLog('error', '干预发送失败：' + err.message);
      }
    });
  }

  // ---- Quick Actions (CDP Watcher) ----

  const QUICK_ACTIONS = [
    { name: 'fill_form_field', label: '填写字段', params: ['label', 'value'], desc: '通过标签文本填写表单字段' },
    { name: 'select_option', label: '选择下拉', params: ['label', 'option'], desc: '选择 el-select 下拉选项' },
    { name: 'click_table_row_radio', label: '选中表格行', params: ['row'], desc: '选中 el-table 中的单选按钮' },
    { name: 'click_table_row_button', label: '点击表格按钮', params: ['row', 'button'], desc: '点击 el-table 行中的操作按钮' },
    { name: 'click_adjacent_button', label: '点击相邻按钮', params: ['label'], desc: '点击字段旁的引入/选择按钮' },
    { name: 'click_radio', label: '点击单选', params: ['label', 'option'], desc: '点击 el-radio 组中的选项' },
    { name: 'click_menu_item', label: '点击菜单', params: ['text'], desc: '点击 el-menu 菜单项（自动展开子菜单）' },
    { name: 'close_dialog', label: '关闭弹窗', params: [], desc: '关闭最上层对话框/抽屉' },
    { name: 'close_notification', label: '关闭通知', params: [], desc: '关闭并读取 el-notification' },
    { name: 'get_page_state', label: '页面状态', params: [], desc: '获取当前页面状态 JSON' },
    { name: 'wait_for_loading', label: '等待加载', params: [], desc: '等待 Element UI 加载遮罩消失' },
  ];

  const quickActionSelect = document.getElementById('sessQuickAction');
  const quickParam1 = document.getElementById('sessQuickParam1');
  const quickParam2 = document.getElementById('sessQuickParam2');
  const quickExecBtn = document.getElementById('sessQuickExecBtn');
  const quickResult = document.getElementById('sessQuickResult');
  const watcherStatus = document.getElementById('sessWatcherStatus');

  // Populate action dropdown
  if (quickActionSelect) {
    QUICK_ACTIONS.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.name;
      const sig = a.params.length ? '(' + a.params.join(', ') + ')' : '';
      opt.textContent = a.label + ' - ' + a.name + ' ' + sig;
      quickActionSelect.appendChild(opt);
    });
    quickActionSelect.addEventListener('change', () => {
      const sel = QUICK_ACTIONS.find(a => a.name === quickActionSelect.value);
      const p1 = quickParam1?.parentElement;
      const p2 = quickParam2?.parentElement;
      if (sel && sel.params.length === 0) { if (p1) p1.style.display = 'none'; if (p2) p2.style.display = 'none'; }
      else if (sel && sel.params.length === 1) { if (p1) { p1.style.display = ''; p1.querySelector('label').textContent = sel.params[0]; } if (p2) p2.style.display = 'none'; }
      else { if (p1) { p1.style.display = ''; p1.querySelector('label').textContent = sel?.params[0] || 'param1'; } if (p2) { p2.style.display = ''; p2.querySelector('label').textContent = sel?.params[1] || 'param2'; } }
    });
    quickActionSelect.dispatchEvent(new Event('change'));
  }

  // Execute button
  if (quickExecBtn) {
    quickExecBtn.addEventListener('click', async () => {
      const action = quickActionSelect?.value;
      if (!action) return;
      const params = [];
      if (quickParam1?.value?.trim()) params.push(quickParam1.value.trim());
      if (quickParam2?.value?.trim()) params.push(quickParam2.value.trim());

      quickExecBtn.disabled = true;
      quickResult.style.display = 'none';
      try {
        const resp = await fetch('/api/browser/watcher/action', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, params }),
        });
        const data = await resp.json();
        if (data.error) {
          quickResult.style.display = 'block';
          quickResult.style.background = '#fef2f2'; quickResult.style.border = '1px solid #fecaca'; quickResult.style.color = '#991b1b';
          quickResult.textContent = '✗ ' + data.error;
        } else {
          quickResult.style.display = 'block';
          quickResult.style.background = '#f0fdf4'; quickResult.style.border = '1px solid #bbf7d0'; quickResult.style.color = '#166534';
          quickResult.textContent = '✓ ' + (data.result || 'ok');
        }
      } catch (err) {
        quickResult.style.display = 'block';
        quickResult.style.background = '#fef2f2'; quickResult.style.border = '1px solid #fecaca'; quickResult.style.color = '#991b1b';
        quickResult.textContent = '✗ ' + err.message;
      }
      quickExecBtn.disabled = false;
    });
  }

  // Poll watcher status
  async function checkWatcher() {
    if (!watcherStatus) return;
    try {
      const r = await fetch('/api/browser/watcher/status');
      const data = await r.json();
      const online = data.connected;
      watcherStatus.textContent = online ? '已连接' : '离线';
      watcherStatus.style.background = online ? '#dcfce7' : 'var(--slate-100)';
      watcherStatus.style.color = online ? '#166534' : 'var(--slate-400)';
      if (quickExecBtn) quickExecBtn.disabled = !online;
    } catch { watcherStatus.textContent = '离线'; if (quickExecBtn) quickExecBtn.disabled = true; }
  }
  checkWatcher();
  setInterval(checkWatcher, 5000);

  // Run All Phases button — sequentially execute all parsed phases
  const runAllBtn = document.getElementById('sessRunAllBtn');
  if (runAllBtn) {
    runAllBtn.addEventListener('click', () => runAllPhases());
  }

  // Initial Load button state
  updateButtons();
}
