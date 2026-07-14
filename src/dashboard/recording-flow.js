// Real-time action flow — merges DB-persisted steps + live _ACTION_LOG
import { escapeHtml } from './swagger-api.js';
import { on } from './ws-client.js';

const ACTION_ICONS = {
  fill_form_field:        '📝', select_option:          '📋',
  click_menu_item:        '🔗', click_table_row_button:  '🖱️',
  click_table_row_radio:  '◉',  click_radio:            '⭕',
  click_adjacent_button:  '🔘', fill_date_field:         '📅',
  switch_tab:             '📑', close_dialog:            '❌',
  close_notification:     '🔔', wait_for_loading:        '⏳',
  login:                  '🔐', go_to_url:               '🌐',
  scroll_down:            '⬇️', scroll_up:               '⬆️',
};

const ACTION_COLORS = {
  fill_form_field: 'indigo', select_option: 'emerald',
  click_menu_item: 'amber', click_table_row_button: 'sky',
  click_adjacent_button: 'slate', click_radio: 'emerald',
  fill_date_field: 'indigo', switch_tab: 'sky',
  close_dialog: 'red', close_notification: 'amber',
  login: 'indigo', go_to_url: 'sky',
};

/** @type {string|null} */
let currentSessionId = null;
let reloadTimer = null;

export function setActionFlowSession(sessionId) {
  currentSessionId = sessionId || null;
  if (currentSessionId) reloadActionFlow();
  else replaceAll([], 0);
}

export async function reloadActionFlow(sessionId = currentSessionId) {
  const flowEl = document.getElementById('sessActionFlow');
  const countEl = document.getElementById('sessActionFlowCount');
  if (!flowEl || !countEl) return;
  if (!sessionId) {
    replaceAll([], 0);
    return;
  }
  try {
    const res = await fetch('/api/browser/session/' + encodeURIComponent(sessionId) + '/action-flow');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'load failed');
    replaceAll(data.entries || [], data.count || 0, {
      persistedCount: data.persistedCount || 0,
      pendingCount: data.pendingCount || 0,
    });
  } catch (err) {
    console.warn('[action-flow] reload failed:', err.message);
  }
}

function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => reloadActionFlow(), 150);
}

function formatTime(ts) {
  if (!ts) return new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  if (Number.isNaN(d.getTime())) return new Date().toLocaleTimeString('zh-CN', { hour12: false });
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}

function renderEntryCard(entry) {
  const icon = ACTION_ICONS[entry.action] || '🔹';
  const p = entry.params || {};
  const label = p.label_text || p.menu_text || p.tab_name || p.row_text || p.text || p.username || p.key || '';
  const value = p.value || p.option_text || p.expected || p.reason || p.amount || String(p.index != null ? p.index : '') || (entry.action === 'login' ? (p.password ? '(已填写)' : '') : p.output_dir || '');
  const color = ACTION_COLORS[entry.action] || 'slate';
  const time = formatTime(entry.timestamp);
  const result = entry.result || '';
  const persisted = !!entry.persisted;
  const dotColor = result.startsWith('field-disabled') || result.startsWith('no-')
    ? 'var(--amber-400)'
    : result.startsWith('not-found') || result.startsWith('error')
      ? 'var(--red-400)'
      : persisted ? 'var(--slate-400)' : 'var(--emerald-400)';

  const card = document.createElement('div');
  card.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--slate-100);transition:background .15s;position:relative';
  if (persisted) card.style.opacity = '0.85';

  const labelHtml = label ? '<strong>' + escapeHtml(label) + '</strong>' : '';
  const valueHtml = value ? ' = <span style="color:var(--emerald-600)">' + escapeHtml(String(value)) + '</span>' : '';
  const fallbackHtml = (!label && !value) ? '<span style="color:var(--slate-400)">(无参数)</span>' : '';
  const badge = persisted
    ? '<span style="font-size:9px;color:var(--slate-400);border:1px solid var(--slate-200);border-radius:3px;padding:0 4px;flex-shrink:0">已入库</span>'
    : '';

  card.innerHTML = [
    '<span style="font-size:14px;flex-shrink:0">', icon, '</span>',
    '<code style="background:var(--', color, '-50);color:var(--', color, '-700);padding:1px 6px;border-radius:3px;font-size:11px;font-family:var(--font-mono);white-space:nowrap;flex-shrink:0">', escapeHtml(entry.action), '</code>',
    badge,
    '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--slate-700)">',
    labelHtml, valueHtml, fallbackHtml,
    '</span>',
    '<span style="color:var(--slate-400);font-size:10px;white-space:nowrap;flex-shrink:0">', time, '</span>',
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
  detail.innerHTML = detailLines.map(l => '<div>' + escapeHtml(l) + '</div>').join('');
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

function addStepSeparator(phase) {
  const sep = document.createElement('div');
  sep.className = 'rec-action-sep';
  sep.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 10px;color:var(--slate-400);font-size:10px;font-weight:600;background:var(--slate-50);border-bottom:1px solid var(--slate-100)';
  sep.innerHTML = '<span style="flex:1;height:1px;background:var(--slate-200)"></span>阶段 ' + phase + '<span style="flex:1;height:1px;background:var(--slate-200)"></span>';
  return sep;
}

function replaceAll(entries, count, meta = {}) {
  const flowEl = document.getElementById('sessActionFlow');
  const countEl = document.getElementById('sessActionFlowCount');
  if (!flowEl || !countEl) return;

  flowEl.innerHTML = '';

  if (!entries || entries.length === 0 || count === 0) {
    flowEl.innerHTML = '<div class="empty-state" style="padding:24px;text-align:center;color:var(--slate-400);font-size:12px">暂无动作</div>';
    countEl.textContent = '等待中…';
    countEl.style.color = 'var(--slate-400)';
    return;
  }

  let currentPhase = null;
  entries.forEach((entry) => {
    const entryPhase = entry.phase != null ? entry.phase : 0;
    if (entryPhase !== currentPhase) {
      currentPhase = entryPhase;
      flowEl.appendChild(addStepSeparator(currentPhase));
    }
    flowEl.appendChild(renderEntryCard(entry));
  });

  const persisted = meta.persistedCount ?? entries.filter(e => e.persisted).length;
  const pending = meta.pendingCount ?? entries.filter(e => !e.persisted).length;
  countEl.textContent = count + ' 条（已入库 ' + persisted + ' / 待保存 ' + pending + '）';
  countEl.style.color = count > 0 ? 'var(--indigo-600)' : 'var(--slate-400)';
  flowEl.scrollTop = flowEl.scrollHeight;
}

export function initActionFlow() {
  const flowEl = document.getElementById('sessActionFlow');
  if (!flowEl) return;

  on('action_log_sync', () => {
    // After save Python clears log → sync empty; reload merges DB + pending
    scheduleReload();
  });
}
