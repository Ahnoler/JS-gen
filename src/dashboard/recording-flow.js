// Real-time action flow display — full state sync mode
// Receives the entire _ACTION_LOG on every change, replaces local state

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

export function initActionFlow() {
  const flowEl = document.getElementById('sessActionFlow');
  const countEl = document.getElementById('sessActionFlowCount');
  if (!flowEl) return;

  function formatTime(ts) {
    if (!ts) return new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
    return d.toLocaleTimeString('zh-CN', { hour12: false });
  }

  function renderEntryCard(entry, index) {
    const icon = ACTION_ICONS[entry.action] || '🔹';
    const p = entry.params || {};
    const label = p.label_text || p.menu_text || p.tab_name || p.row_text || p.text || p.username || p.key || '';
    const value = p.value || p.option_text || p.expected || p.reason || p.amount || String(p.index != null ? p.index : '') || (entry.action === 'login' ? (p.password ? '(已填写)' : '') : p.output_dir || '');
    const color = ACTION_COLORS[entry.action] || 'slate';
    const time = formatTime(entry.timestamp);
    const result = entry.result || '';
    const dotColor = result.startsWith('field-disabled') || result.startsWith('no-')
      ? 'var(--amber-400)'
      : result.startsWith('not-found') || result.startsWith('error')
        ? 'var(--red-400)'
        : 'var(--emerald-400)';

    const card = document.createElement('div');
    card.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--slate-100);transition:background .15s;position:relative';
    card.onmouseenter = () => card.style.background = 'var(--slate-50)';
    card.onmouseleave = () => { if (!card.classList.contains('hover-detail')) card.style.background = ''; };

    const labelHtml = label ? '<strong>' + escapeHtml(label) + '</strong>' : '';
    const valueHtml = value ? ' = <span style="color:var(--emerald-600)">' + escapeHtml(String(value)) + '</span>' : '';
    const fallbackHtml = (!label && !value) ? '<span style="color:var(--slate-400)">(无参数)</span>' : '';

    card.innerHTML = [
      '<span style="font-size:14px;flex-shrink:0">', icon, '</span>',
      '<code style="background:var(--', color, '-50);color:var(--', color, '-700);padding:1px 6px;border-radius:3px;font-size:11px;font-family:var(--font-mono);white-space:nowrap;flex-shrink:0">', escapeHtml(entry.action), '</code>',
      '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--slate-700)">',
      labelHtml, valueHtml, fallbackHtml,
      '</span>',
      '<span style="color:var(--slate-400);font-size:10px;white-space:nowrap;flex-shrink:0">', time, '</span>',
      '<span style="width:7px;height:7px;border-radius:50%;background:', dotColor, ';flex-shrink:0;box-shadow:0 0 4px ', dotColor, '"></span>',
    ].join('');

    // Hover detail
    const detail = document.createElement('div');
    detail.className = 'rec-action-detail';
    detail.style.cssText = 'display:none;padding:4px 0 4px 34px;font-size:10px;color:var(--slate-500);font-family:var(--font-mono);line-height:1.5';
    const detailLines = ['action: ' + entry.action];
    if (Object.keys(p).length) detailLines.push('params: ' + JSON.stringify(p));
    if (result) detailLines.push('result: ' + result);
    if (entry.target) detailLines.push('xpath: ' + entry.target.slice(0, 80));
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

  function replaceAll(entries, count) {
    flowEl.innerHTML = '';

    if (!entries || entries.length === 0 || count === 0) {
      flowEl.innerHTML = '<div class="empty-state" style="padding:24px;text-align:center;color:var(--slate-400);font-size:12px">暂无动作</div>';
      countEl.textContent = '等待中…';
      countEl.style.color = 'var(--slate-400)';
      return;
    }

    let currentPhase = null;
    entries.forEach((entry, i) => {
      const entryPhase = entry.phase != null ? entry.phase : 0;
      if (entryPhase !== currentPhase) {
        currentPhase = entryPhase;
        flowEl.appendChild(addStepSeparator(currentPhase));
      }
      const card = renderEntryCard(entry, i);
      flowEl.appendChild(card);
    });

    countEl.textContent = count + ' 条';
    countEl.style.color = count > 0 ? 'var(--indigo-600)' : 'var(--slate-400)';
    flowEl.scrollTop = flowEl.scrollHeight;
  }

  on('action_log_sync', (data) => {
    replaceAll(data.entries || [], data.count || 0);
  });
}
