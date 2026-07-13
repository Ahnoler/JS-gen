// Real-time action flow display
// Passively listens to controller_action events from the Python agent
// and renders action cards in real-time on the dashboard

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

  let actionCount = 0;

  function appendAction(data) {
    const icon = ACTION_ICONS[data.action] || '🔹';
    const p = data.params || {};
    const label = p.label_text || p.menu_text || p.tab_name || p.row_text || p.text || '';
    const value = p.value || p.option_text || '';
    const color = ACTION_COLORS[data.action] || 'slate';
    const time = data.timestamp
      ? new Date(data.timestamp).toLocaleTimeString('zh-CN', { hour12: false })
      : new Date().toLocaleTimeString('zh-CN', { hour12: false });

    const empty = flowEl.querySelector('.empty-state');
    if (empty) empty.remove();

    actionCount++;
    countEl.textContent = actionCount + ' 条';
    countEl.style.color = actionCount > 0 ? 'var(--indigo-600)' : 'var(--slate-400)';

    const card = document.createElement('div');
    card.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--slate-100);transition:background .15s';
    card.onmouseenter = () => card.style.background = 'var(--slate-50)';
    card.onmouseleave = () => card.style.background = '';
    card.innerHTML = [
      '<span style="font-size:14px;flex-shrink:0">', icon, '</span>',
      '<code style="background:var(--', color, '-50);color:var(--', color, '-700);padding:1px 6px;border-radius:3px;font-size:11px;font-family:var(--font-mono);white-space:nowrap;flex-shrink:0">', escapeHtml(data.action), '</code>',
      '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--slate-700)">',
      label ? '<strong>' + escapeHtml(label) + '</strong>' : '',
      value ? ' = <span style="color:var(--emerald-600)">' + escapeHtml(value) + '</span>' : '',
      !label && !value ? '<span style="color:var(--slate-400)">(无参数)</span>' : '',
      '</span>',
      '<span style="color:var(--slate-400);font-size:10px;white-space:nowrap;flex-shrink:0">', time, '</span>',
      '<span style="width:7px;height:7px;border-radius:50%;background:var(--emerald-400);flex-shrink:0;box-shadow:0 0 4px rgba(16,185,129,.4)"></span>',
    ].join('');

    flowEl.appendChild(card);
    flowEl.scrollTop = flowEl.scrollHeight;
  }

  function addStepSeparator(label) {
    const sep = document.createElement('div');
    sep.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 10px;color:var(--slate-400);font-size:10px;font-weight:600;background:var(--slate-50);border-bottom:1px solid var(--slate-100)';
    sep.innerHTML = '<span style="flex:1;height:1px;background:var(--slate-200)"></span>' + escapeHtml(label) + '<span style="flex:1;height:1px;background:var(--slate-200)"></span>';
    flowEl.appendChild(sep);
  }

  on('controller_action', (data) => {
    appendAction(data);
  });

  on('session:phase_start', (data) => {
    addStepSeparator(data.name || 'Step ' + data.phase);
  });

  on('session:nav_step', (data) => {
    addStepSeparator(data.label || '导航');
  });
}
