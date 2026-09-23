/* global document */
import { mountExecutorPanel } from './executor-panel.js';
import { mountScreenshotsPanel } from './screenshots-panel.js';
import { mountHistoryPanel } from './history-panel.js';

const tabs = {
  exec: {
    tab: document.getElementById('ops-tab-exec'),
    panel: document.getElementById('ops-panel-exec'),
  },
  shots: {
    tab: document.getElementById('ops-tab-shots'),
    panel: document.getElementById('ops-panel-shots'),
  },
  history: {
    tab: document.getElementById('ops-tab-history'),
    panel: document.getElementById('ops-panel-history'),
  },
};

/**
 * Activate one ops tab and show its panel.
 * @param {'exec' | 'shots' | 'history'} which - Which tab to select.
 * @returns {void}
 */
function selectOpsTab(which) {
  for (const [key, entry] of Object.entries(tabs)) {
    const active = key === which;
    entry.tab.setAttribute('aria-selected', active ? 'true' : 'false');
    entry.tab.classList.toggle('is-active', active);
    entry.panel.hidden = !active;
    entry.panel.classList.toggle('is-active', active);
  }
}

tabs.exec.tab.addEventListener('click', () => selectOpsTab('exec'));
tabs.shots.tab.addEventListener('click', () => selectOpsTab('shots'));
tabs.history.tab.addEventListener('click', () => selectOpsTab('history'));

mountExecutorPanel(tabs.exec.panel);
mountScreenshotsPanel(tabs.shots.panel);
mountHistoryPanel(tabs.history.panel);
