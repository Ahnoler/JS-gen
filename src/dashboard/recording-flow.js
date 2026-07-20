// Real-time action flow — prefers phase-step tree (GET /api/v2/trajectories/:id/tree)
import { escapeHtml } from './swagger-api.js';
import { on } from './ws-client.js';
import { readV2, apiErrorMessage } from './api-envelope.js';

const ACTION_ICONS = {
  fill_form_field:        '📝', select_option:          '📋',
  click_element_by_index: '👆', click_menu_item:         '🔗',
  click_table_row_button: '🖱️', click_table_row_radio:   '◉',
  click_radio:            '⭕', click_adjacent_button:   '🔘',
  fill_date_field:        '📅', switch_tab:              '📑',
  close_dialog:           '❌', close_notification:      '🔔',
  wait_for_loading:       '⏳', login:                   '🔐',
  go_to_url:              '🌐', scroll_down:             '⬇️',
  scroll_up:              '⬆️',
};

const ACTION_COLORS = {
  fill_form_field: 'indigo', select_option: 'emerald',
  click_element_by_index: 'amber', click_menu_item: 'amber',
  click_table_row_button: 'sky', click_adjacent_button: 'slate',
  click_radio: 'emerald', fill_date_field: 'indigo',
  switch_tab: 'sky', close_dialog: 'red',
  close_notification: 'amber', login: 'indigo', go_to_url: 'sky',
};

/** @type {string|null} */
let currentSessionId = null;
/** @type {number|null} */
let currentTrajectoryDbId = null;
/** @type {number|null} selected trajectory_phase.id for manual persist / highlight */
let selectedPhaseId = null;
let reloadTimer = null;

/** @type {{ onPhaseSelect?: Function, onPhaseExecute?: Function, onPhaseCreate?: Function }|null} */
let actionFlowHandlers = null;

export function setActionFlowHandlers(handlers = {}) {
  actionFlowHandlers = handlers || {};
}

export function getSelectedActionFlowPhaseId() {
  return selectedPhaseId;
}

export function setSelectedActionFlowPhaseId(phaseId, { silent = false } = {}) {
  const next = phaseId != null && phaseId !== '' ? Number(phaseId) : null;
  selectedPhaseId = Number.isFinite(next) && next > 0 ? next : null;
  highlightSelectedPhase();
  if (!silent && typeof actionFlowHandlers?.onPhaseSelect === 'function') {
    actionFlowHandlers.onPhaseSelect(selectedPhaseId);
  }
}

export function setActionFlowSession(sessionId, trajectoryDbId = null) {
  currentSessionId = sessionId || null;
  if (trajectoryDbId != null) currentTrajectoryDbId = Number(trajectoryDbId);
  if (currentSessionId || currentTrajectoryDbId) reloadActionFlow();
  else replaceTree([], 0);
}

export function setActionFlowTrajectory(trajectoryDbId) {
  currentTrajectoryDbId = trajectoryDbId != null && trajectoryDbId !== ''
    ? Number(trajectoryDbId)
    : null;
  selectedPhaseId = null;
  reloadActionFlow();
}

/**
 * Prefer tree API when a trajectory is selected; fall back to session action-flow.
 */
export async function reloadActionFlow(sessionId = currentSessionId) {
  const flowEl = document.getElementById('sessActionFlow');
  const countEl = document.getElementById('sessActionFlowCount');
  if (!flowEl || !countEl) return;

  if (currentTrajectoryDbId != null && Number.isFinite(currentTrajectoryDbId)) {
    try {
      const res = await fetch('/api/v2/trajectories/' + encodeURIComponent(String(currentTrajectoryDbId)) + '/tree');
      const data = await readV2(res);
      renderTree(data);
      return;
    } catch (err) {
      console.warn('[action-flow] tree reload failed:', err.message);
    }
  }

  if (!sessionId) {
    replaceTree([], 0);
    return;
  }

  // Fallback: flat session action-flow (legacy / no trajectory selected)
  try {
    const qs = currentTrajectoryDbId != null
      ? ('?trajectoryId=' + encodeURIComponent(String(currentTrajectoryDbId)))
      : '';
    const res = await fetch('/api/browser/session/' + encodeURIComponent(sessionId) + '/action-flow' + qs);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'load failed');
    replaceFlatEntries(data.entries || [], data.count || 0, {
      persistedCount: data.persistedCount || 0,
      pendingCount: data.pendingCount || 0,
    });
  } catch (err) {
    console.warn('[action-flow] reload failed:', err.message);
  }
}

function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => reloadActionFlow(), 200);
}

function formatTime(ts) {
  if (!ts) return '';
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}

function stepToEntry(step) {
  const params = typeof step.paramsJson === 'string'
    ? (() => { try { return JSON.parse(step.paramsJson); } catch { return {}; } })()
    : (step.paramsJson || step.params || {});
  const element = typeof step.elementJson === 'string'
    ? (() => { try { return JSON.parse(step.elementJson); } catch { return {}; } })()
    : (step.elementJson || step.element || {});
  return {
    id: step.id,
    action: step.actionType || step.action || '',
    params: params || {},
    target: element?.xpath || element?.target || '',
    result: step.extractedContent || step.result || '',
    source: step.source || 'agent',
    phase: step.phaseNumber ?? 0,
    persisted: true,
    confirmed: !!(step.confirmed === true || step.confirmed === 1),
    timestamp: step.createdAt || step.confirmedAt || null,
    description: step.description || '',
  };
}

function renderEntryCard(entry) {
  const icon = ACTION_ICONS[entry.action] || '🔹';
  const p = entry.params || {};
  const label = p.label_text || p.menu_text || p.tab_name || p.row_text || p.text || p.username || p.key
    || entry.description || '';
  const value = p.value || p.option_text || p.expected || p.reason || p.amount
    || String(p.index != null ? p.index : '')
    || (entry.action === 'login' ? (p.password ? '(已填写)' : '') : p.output_dir || '');
  const color = ACTION_COLORS[entry.action] || 'slate';
  const time = formatTime(entry.timestamp);
  const result = entry.result || '';
  const persisted = entry.persisted !== false;
  const confirmed = !!entry.confirmed;
  const dotColor = result.startsWith('field-disabled') || result.startsWith('no-')
    ? 'var(--amber-400)'
    : result.startsWith('not-found') || result.startsWith('error')
      ? 'var(--red-400)'
      : confirmed ? 'var(--emerald-500)' : persisted ? 'var(--slate-400)' : 'var(--emerald-400)';

  const card = document.createElement('div');
  card.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--slate-100);transition:background .15s;position:relative';
  if (persisted) card.style.opacity = '0.92';

  const labelHtml = label ? '<strong>' + escapeHtml(String(label)) + '</strong>' : '';
  const valueHtml = value ? ' = <span style="color:var(--emerald-600)">' + escapeHtml(String(value)) + '</span>' : '';
  const fallbackHtml = (!label && !value) ? '<span style="color:var(--slate-400)">(无参数)</span>' : '';
  const badge = persisted
    ? '<span style="font-size:9px;color:var(--slate-400);border:1px solid var(--slate-200);border-radius:3px;padding:0 4px;flex-shrink:0">已入库</span>'
    : '<span style="font-size:9px;color:#b45309;border:1px solid #fcd34d;border-radius:3px;padding:0 4px;flex-shrink:0;background:#fffbeb">待保存</span>';
  const confirmBadge = confirmed
    ? '<span style="font-size:9px;color:#047857;border:1px solid #6ee7b7;border-radius:3px;padding:0 4px;flex-shrink:0;background:#ecfdf5">已确认</span>'
    : '';
  const src = entry.source || '';
  const sourceBadge = (src === 'manual' || src === 'cdp')
    ? '<span style="font-size:9px;color:' + (src === 'manual' ? '#9a3412' : '#1d4ed8') + ';border:1px solid ' + (src === 'manual' ? '#fdba74' : '#93c5fd') + ';border-radius:3px;padding:0 4px;flex-shrink:0;background:' + (src === 'manual' ? '#fff7ed' : '#eff6ff') + '">' + src + '</span>'
    : '';

  card.innerHTML = [
    '<span style="font-size:14px;flex-shrink:0">', icon, '</span>',
    '<code style="background:var(--', color, '-50);color:var(--', color, '-700);padding:1px 6px;border-radius:3px;font-size:11px;font-family:var(--font-mono);white-space:nowrap;flex-shrink:0">', escapeHtml(entry.action), '</code>',
    sourceBadge,
    badge,
    confirmBadge,
    '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--slate-700)">',
    labelHtml, valueHtml, fallbackHtml,
    '</span>',
    time ? '<span style="color:var(--slate-400);font-size:10px;white-space:nowrap;flex-shrink:0">' + time + '</span>' : '',
    '<span style="width:7px;height:7px;border-radius:50%;background:', dotColor, ';flex-shrink:0;box-shadow:0 0 4px ', dotColor, '"></span>',
  ].join('');

  const detail = document.createElement('div');
  detail.className = 'rec-action-detail';
  detail.style.cssText = 'display:none;padding:4px 0 4px 34px;font-size:10px;color:var(--slate-500);font-family:var(--font-mono);line-height:1.5';
  const detailLines = ['action: ' + entry.action];
  if (Object.keys(p).length) detailLines.push('params: ' + JSON.stringify(p));
  if (result) detailLines.push('result: ' + result);
  if (entry.target) detailLines.push('xpath: ' + String(entry.target).slice(0, 80));
  if (persisted) detailLines.push('status: persisted');
  if (src) detailLines.push('source: ' + src);
  if (entry.id != null) detailLines.push('stepId: ' + entry.id);
  detail.innerHTML = detailLines.map((l) => '<div>' + escapeHtml(l) + '</div>').join('');
  card.appendChild(detail);

  let detailTimer = null;
  card.addEventListener('mouseenter', () => {
    card.style.background = 'var(--slate-50)';
    clearTimeout(detailTimer);
    detailTimer = setTimeout(() => { detail.style.display = 'block'; }, 300);
  });
  card.addEventListener('mouseleave', () => {
    card.style.background = '';
    clearTimeout(detailTimer);
    detail.style.display = 'none';
  });

  return card;
}

function highlightSelectedPhase() {
  const flowEl = document.getElementById('sessActionFlow');
  if (!flowEl) return;
  flowEl.querySelectorAll('.rec-phase-row').forEach((row) => {
    const pid = Number(row.dataset.phaseId);
    const selected = selectedPhaseId != null && pid === selectedPhaseId;
    row.style.background = selected ? 'var(--indigo-50)' : 'var(--slate-50)';
    row.style.outline = selected ? '1px solid var(--indigo-300)' : 'none';
    const badge = row.querySelector('.rec-phase-selected-badge');
    if (badge) badge.style.display = selected ? '' : 'none';
  });
}

function addPhaseHeader(phase, { selectable = false } = {}) {
  const sep = document.createElement('div');
  sep.className = 'rec-action-sep' + (selectable ? ' rec-phase-row' : '');
  const phaseId = phase.id != null ? Number(phase.id) : null;
  if (selectable && Number.isFinite(phaseId)) {
    sep.dataset.phaseId = String(phaseId);
  }
  const selected = selectable && selectedPhaseId != null && phaseId === selectedPhaseId;
  sep.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;color:var(--slate-600);font-size:11px;font-weight:600;background:'
    + (selected ? 'var(--indigo-50)' : 'var(--slate-50)')
    + ';border-bottom:1px solid var(--slate-100);cursor:' + (selectable ? 'pointer' : 'default')
    + (selected ? ';outline:1px solid var(--indigo-300)' : '');
  const num = phase.phaseNumber ?? phase.phase_number ?? '?';
  const status = phase.status || '';
  const desc = (phase.description || '').trim();
  const statusColor = status === 'completed' ? '#059669'
    : status === 'running' ? '#d97706'
      : status === 'failed' ? '#dc2626'
        : 'var(--slate-400)';
  const statusLabel = status || 'pending';
  const stepCount = Array.isArray(phase.steps) ? phase.steps.length : 0;

  const left = document.createElement('div');
  left.style.cssText = 'display:flex;align-items:center;gap:8px;flex:1;min-width:0';
  left.innerHTML = [
    '<span style="background:var(--indigo-50);color:var(--indigo-700);padding:1px 8px;border-radius:999px;font-size:10px;flex-shrink:0">阶段 ', num, '</span>',
    '<span class="rec-phase-selected-badge" style="display:' + (selected ? '' : 'none') + ';font-size:9px;color:#3730a3;border:1px solid #a5b4fc;border-radius:3px;padding:0 4px;background:#eef2ff;flex-shrink:0">已选中</span>',
    '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escapeHtml(desc || '') + '">', escapeHtml(desc || '(无描述)'), '</span>',
    '<span style="font-size:10px;color:', statusColor, ';font-weight:500;flex-shrink:0">', escapeHtml(statusLabel), '</span>',
    '<span style="font-size:10px;color:var(--slate-400);flex-shrink:0">', stepCount, ' 步</span>',
  ].join('');
  sep.appendChild(left);

  if (selectable && Number.isFinite(phaseId)) {
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:4px;flex-shrink:0';
    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'btn btn-outline btn-sm';
    selectBtn.style.cssText = 'font-size:10px;padding:2px 6px;height:22px';
    selectBtn.textContent = selected ? '取消' : '选中';
    selectBtn.title = '选中后人工录制写入此 phase';
    selectBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setSelectedActionFlowPhaseId(selected ? null : phaseId);
    });
    const execBtn = document.createElement('button');
    execBtn.type = 'button';
    execBtn.className = 'btn btn-primary btn-sm';
    execBtn.style.cssText = 'font-size:10px;padding:2px 8px;height:22px';
    execBtn.textContent = '执行';
    execBtn.title = '用此阶段描述启动 AI 步骤';
    execBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setSelectedActionFlowPhaseId(phaseId, { silent: true });
      if (typeof actionFlowHandlers?.onPhaseSelect === 'function') {
        actionFlowHandlers.onPhaseSelect(phaseId);
      }
      if (typeof actionFlowHandlers?.onPhaseExecute === 'function') {
        actionFlowHandlers.onPhaseExecute({
          id: phaseId,
          phaseNumber: Number(phase.phaseNumber) || null,
          description: desc || `阶段 ${num}`,
          status,
        });
      }
    });
    actions.appendChild(selectBtn);
    actions.appendChild(execBtn);
    sep.appendChild(actions);

    sep.addEventListener('click', () => {
      setSelectedActionFlowPhaseId(phaseId);
    });
  }

  return sep;
}

function renderTree(tree) {
  const flowEl = document.getElementById('sessActionFlow');
  const countEl = document.getElementById('sessActionFlowCount');
  if (!flowEl || !countEl) return;

  const phases = Array.isArray(tree?.phases) ? tree.phases : [];
  const orphans = Array.isArray(tree?.orphanSteps) ? tree.orphanSteps : [];
  let total = 0;
  for (const p of phases) total += (p.steps || []).length;
  total += orphans.length;

  flowEl.innerHTML = '';
  if (!phases.length && !orphans.length) {
    flowEl.innerHTML = '<div class="empty-state" style="padding:24px;text-align:center;color:var(--slate-400);font-size:12px">暂无阶段 — 点右上角「+ 阶段」创建，或执行后自动出现</div>';
    countEl.textContent = 'traj#' + (tree?.id || tree?.trajectoryId || currentTrajectoryDbId || '?') + ' · 空';
    countEl.style.color = 'var(--slate-400)';
    return;
  }

  for (const phase of phases) {
    flowEl.appendChild(addPhaseHeader(phase, { selectable: true }));
    const steps = phase.steps || [];
    if (!steps.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:6px 14px 10px 28px;font-size:11px;color:var(--slate-400)';
      empty.textContent = '（该阶段暂无操作步骤）';
      flowEl.appendChild(empty);
      continue;
    }
    for (const step of steps) {
      flowEl.appendChild(renderEntryCard(stepToEntry(step)));
    }
  }

  if (orphans.length) {
    flowEl.appendChild(addPhaseHeader({
      phaseNumber: '—',
      description: '未绑定阶段的步骤',
      status: '',
      steps: orphans,
    }, { selectable: false }));
    for (const step of orphans) {
      flowEl.appendChild(renderEntryCard(stepToEntry(step)));
    }
  }

  countEl.textContent = 'traj#' + (tree?.id || currentTrajectoryDbId) + ' · '
    + phases.length + ' 阶段 / ' + total + ' 步'
    + (selectedPhaseId != null ? ' · 已选 phase#' + selectedPhaseId : '');
  countEl.style.color = total > 0 || phases.length > 0 ? 'var(--indigo-600)' : 'var(--slate-400)';
  highlightSelectedPhase();
}

function replaceTree(phases, count) {
  renderTree({ phases, orphanSteps: [], id: currentTrajectoryDbId });
}

function replaceFlatEntries(entries, count, meta = {}) {
  const flowEl = document.getElementById('sessActionFlow');
  const countEl = document.getElementById('sessActionFlowCount');
  if (!flowEl || !countEl) return;

  flowEl.innerHTML = '';
  if (!entries || entries.length === 0 || count === 0) {
    flowEl.innerHTML = '<div class="empty-state" style="padding:24px;text-align:center;color:var(--slate-400);font-size:12px">暂无动作 — 请先选择轨迹或执行步骤</div>';
    countEl.textContent = '等待中…';
    countEl.style.color = 'var(--slate-400)';
    return;
  }

  let currentPhase = null;
  entries.forEach((entry) => {
    const entryPhase = entry.phase != null ? entry.phase : 0;
    if (entryPhase !== currentPhase) {
      currentPhase = entryPhase;
      flowEl.appendChild(addPhaseHeader({
        phaseNumber: currentPhase,
        description: '',
        status: '',
        steps: [],
      }, { selectable: false }));
    }
    flowEl.appendChild(renderEntryCard(entry));
  });

  const persisted = meta.persistedCount ?? entries.filter((e) => e.persisted).length;
  const pending = meta.pendingCount ?? entries.filter((e) => !e.persisted).length;
  countEl.textContent = count + ' 条（已入库 ' + persisted + ' / 待保存 ' + pending + '）';
  countEl.style.color = count > 0 ? 'var(--indigo-600)' : 'var(--slate-400)';
  flowEl.scrollTop = flowEl.scrollHeight;
}

export function initActionFlow() {
  const flowEl = document.getElementById('sessActionFlow');
  if (!flowEl) return;

  on('action_log_sync', () => scheduleReload());
  on('action_persisted', () => scheduleReload());
  on('manual_action_persisted', () => scheduleReload());
  on('manual_action_recorded', () => scheduleReload());

  const addBtn = document.getElementById('sessActionFlowAddPhaseBtn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      if (typeof actionFlowHandlers?.onPhaseCreate === 'function') {
        actionFlowHandlers.onPhaseCreate();
      }
    });
  }
}
