// Phase plan carousel + intervention alerts

import { escapeHtml } from '../swagger-api.js';

export function parseExplorePhases(text) {
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
    const task = content || m.name;
    phases.push({
      num: m.num,
      name: '阶段' + m.num + '：' + m.name,
      task,
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

function bindPhaseCarouselEvents(ctx, list, phases) {
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
      if (!ctx.sessActive.value) { ctx.sessLog('error', '无活跃会话'); return; }
      ctx.executeSessionStep(ctx.sessActive.value, phase.task, phase.maxSteps, phase.name, idx, phase.num);
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

export function wirePhaseUi(ctx) {
  ctx.renderPhasePlan = function renderPhasePlan(phases) {
    const plan = document.getElementById('sessPhasePlan');
    const list = document.getElementById('sessPhaseList');
    const countEl = document.getElementById('sessPhaseCount');
    if (!plan || !list) return;
    if (!phases || phases.length === 0) { plan.style.display = 'none'; ctx.sessionPhases = []; return; }
    plan.style.display = 'block';
    ctx.sessionPhases = phases;
    countEl.textContent = phases.length + ' 个阶段';

    list.innerHTML = buildPhaseCarouselHtml(phases);
    bindPhaseCarouselEvents(ctx, list, phases);
  };

  ctx.sessPhaseUpdateStatus = function sessPhaseUpdateStatus(idx, status) {
    const list = document.getElementById('sessPhaseList');
    if (!list) return;
    const el = list.querySelector('.sess-phase-status[data-index="' + idx + '"]');
    if (!el) return;
    const colors = { running: 'var(--indigo-500)', success: 'var(--green-500)', failed: 'var(--red-500)', pending: 'var(--slate-400)' };
    el.textContent = status;
    el.style.color = colors[status] || 'var(--slate-400)';
    const execBtn = list.querySelector('.sess-phase-exec[data-index="' + idx + '"]');
    if (execBtn && (status === 'success' || status === 'failed')) execBtn.textContent = status === 'success' ? '重跑' : '重试';
  };

  ctx.setInterventionCardMode = function setInterventionCardMode(mode) {
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
  };

  ctx.showInterventionAlerts = function showInterventionAlerts(data) {
    const alerts = document.getElementById('sessInterventionAlerts');
    const badge = document.getElementById('sessInterventionBadge');
    if (!alerts) return;
    const fields = data.fields || [];
    const source = data.source || '';

    ctx.interventionFields = fields;

    if (fields.length === 0) {
      alerts.innerHTML = '';
      if (badge) badge.style.display = 'none';
      ctx.setInterventionCardMode('normal');
      return;
    }

    ctx.setInterventionCardMode('warn');
    if (badge) {
      badge.textContent = fields.length + ' field' + (fields.length > 1 ? 's' : '');
      badge.style.display = 'inline-block';
    }

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
  };

  // Load phases from task text (merge with preserved executed phases)
  ctx.sessLoadBtn.addEventListener('click', async () => {
    const sessionId = ctx.sessActive.value;
    const caseText = ctx.sessTask.value.trim();
    if (!sessionId) { ctx.sessLog('error', '无活跃会话 — 请先创建一个'); return; }
    if (!caseText || !(/【阶段|^##\s+Phase\s+\d+/m.test(caseText))) {
      ctx.sessLog('warn', '未找到阶段标记。请在文本区域中使用 【阶段N：名称】 或 ## Phase N: 格式。');
      return;
    }

    const preservedMap = {};
    ctx.sessionPhases.forEach((p) => {
      if (p.status !== 'pending') preservedMap[p.num] = p;
    });
    const keptCount = Object.keys(preservedMap).length;

    const newPhases = parseExplorePhases(caseText);
    const merged = [];
    newPhases.forEach(p => {
      if (preservedMap[p.num] !== undefined) {
        merged.push(preservedMap[p.num]);
      } else {
        merged.push(p);
      }
    });

    const newNums = new Set(newPhases.map(p => p.num));
    Object.values(preservedMap).forEach(p => {
      if (!newNums.has(p.num)) merged.push(p);
    });

    merged.sort((a, b) => a.num - b.num);

    ctx.renderPhasePlan(merged);
    ctx.sessLog('system', 'Loaded: ' + keptCount + ' preserved, ' + Math.max(0, merged.length - keptCount) + ' imported (' + merged.length + ' total)');
  });

  // Intervention Send button
  const interventionSendBtn = document.getElementById('sessInterventionSendBtn');
  if (interventionSendBtn) {
    interventionSendBtn.addEventListener('click', async () => {
      if (!ctx.sessActive.value) { ctx.sessLog('error', '无活跃会话'); return; }
      const intervention = document.getElementById('sessInterventionInput')?.value?.trim() || '';
      if (!intervention) {
        ctx.sessLog('system', '未输入干预文本。请在上方描述工作流，然后点击发送。');
        return;
      }
      document.getElementById('sessInterventionInput').value = '';
      const maxSteps = parseInt(document.getElementById('sessMaxSteps')?.value) || 40;
      await ctx.executeSessionStep(ctx.sessActive.value, intervention, maxSteps, '干预: ' + intervention.slice(0, 50));
    });
  }
}
