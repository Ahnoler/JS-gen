/* global document */
const tabExec = document.getElementById('ops-tab-exec');
const tabShots = document.getElementById('ops-tab-shots');
const panelExec = document.getElementById('ops-panel-exec');
const panelShots = document.getElementById('ops-panel-shots');

/**
 * Activate one ops tab and show its panel; hide the other panel.
 * @param {'exec' | 'shots'} which - Which tab to select.
 * @returns {void}
 */
function selectOpsTab(which) {
  const execActive = which === 'exec';
  tabExec.setAttribute('aria-selected', execActive ? 'true' : 'false');
  tabShots.setAttribute('aria-selected', execActive ? 'false' : 'true');
  tabExec.classList.toggle('is-active', execActive);
  tabShots.classList.toggle('is-active', !execActive);
  panelExec.hidden = !execActive;
  panelShots.hidden = execActive;
  panelExec.classList.toggle('is-active', execActive);
  panelShots.classList.toggle('is-active', !execActive);
}

tabExec.addEventListener('click', () => selectOpsTab('exec'));
tabShots.addEventListener('click', () => selectOpsTab('shots'));
