// Action card rendering and interaction for Trajectory History page
// Extracted from trajectory.js — handles add, modify, sort, and delete of action commands
import { escapeHtml } from './swagger-api.js';

const ACTION_TYPES = ['go_to_url', 'fill_form_field', 'select_option', 'click_element_by_index', 'fill_date_field', 'selectDate'];

/**
 * Render action cards into summaryEl based on the commands array.
 * After setting innerHTML, calls wireFn to attach event listeners.
 *
 * @param {Array} commands - mutable commands array from jsonData.tests[0].commands
 * @param {HTMLElement} summaryEl - the #trajDetailSummary container
 * @param {string} url - the URL string from jsonData.url
 * @param {Function|null} wireFn - callback invoked after rendering to wire event listeners
 */
export function renderActionCards(commands, summaryEl, url, wireFn) {
  const cardsHtml = commands.map((c, i) => {
    if (c === null) return '';
    const action = c.action || c.command || '';
    const label = c.params?.label_text || '';
    const value = c.params?.value || c.params?.option_text || '';
    if (!action) {
      return `<div class="traj-card" data-index="${i}" style="border:1px solid var(--slate-200);border-radius:8px;margin-bottom:8px;overflow:hidden;background:#fff">
        <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--slate-50);border-bottom:1px solid var(--slate-200);font-size:12px">
          <span style="background:var(--indigo-100);color:var(--indigo-700);padding:1px 8px;border-radius:4px;font-weight:600;font-size:11px">#${i+1}</span>
          <select class="traj-type-select" data-index="${i}" style="flex:1;padding:3px 8px;border:1px solid var(--slate-200);border-radius:4px;font-size:12px;background:#fff;color:var(--slate-600)">
            <option value="">-- Select type --</option>
            ${ACTION_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}
          </select>
        </div>
        <div style="padding:16px 12px;font-size:13px;color:var(--slate-400);text-align:center">Select an action type</div>
      </div>`;
    }
    return `<div class="traj-card" data-index="${i}" style="border:1px solid var(--slate-200);border-radius:8px;margin-bottom:8px;overflow:hidden;background:#fff">
      <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--slate-50);border-bottom:1px solid var(--slate-200);font-size:12px">
        <span style="background:var(--indigo-100);color:var(--indigo-700);padding:1px 8px;border-radius:4px;font-weight:600;font-size:11px">#${i+1}</span>
        <span style="color:var(--slate-600);font-weight:600;font-family:var(--font-mono);font-size:11px">${escapeHtml(action)}</span>
        <span style="flex:1"></span>
      </div>
      <div style="padding:8px 12px;font-size:13px">
        ${action === 'go_to_url' ? `<div style="margin-bottom:4px"><span style="color:var(--slate-400);font-size:11px">URL</span><br><span class="traj-value-display-${i}" style="word-break:break-all">${escapeHtml(c.params?.url || '')}</span>
          <input class="traj-value-input-${i}" type="text" value="${escapeHtml(c.params?.url || '')}" style="display:none;width:100%;padding:4px 8px;border:1px solid var(--slate-300);border-radius:4px;font-size:13px;margin-top:2px;box-sizing:border-box"></div>` : ''}
        ${action === 'fill_form_field' ? `<div style="margin-bottom:4px"><span style="color:var(--slate-400);font-size:11px">Label</span><br><span class="traj-label-${i}" style="font-weight:500">${escapeHtml(label)}</span></div>
          <div style="margin-bottom:4px"><span style="color:var(--slate-400);font-size:11px">Value</span><br><span class="traj-value-display-${i}" style="font-weight:500">${escapeHtml(value)}</span>
          <input class="traj-value-input-${i}" type="text" value="${escapeHtml(value)}" style="display:none;width:100%;padding:4px 8px;border:1px solid var(--slate-300);border-radius:4px;font-size:13px;margin-top:2px;box-sizing:border-box"></div>` : ''}
        ${action === 'select_option' ? `<div style="margin-bottom:4px"><span style="color:var(--slate-400);font-size:11px">Label</span><br><span style="font-weight:500">${escapeHtml(label)}</span></div>
          <div style="margin-bottom:4px"><span style="color:var(--slate-400);font-size:11px">Option</span><br><span class="traj-value-display-${i}">${escapeHtml(value)}</span>
          <input class="traj-value-input-${i}" type="text" value="${escapeHtml(value)}" style="display:none;width:100%;padding:4px 8px;border:1px solid var(--slate-300);border-radius:4px;font-size:13px;margin-top:2px;box-sizing:border-box"></div>` : ''}
        ${action === 'click_element_by_index' ? `<div style="margin-bottom:4px"><span style="color:var(--slate-400);font-size:11px">Element</span><br><span style="font-weight:500;font-family:var(--font-mono);font-size:12px">${escapeHtml(c.params?.text || '')}</span></div>
          <div style="margin-bottom:4px"><span style="color:var(--slate-400);font-size:11px">XPath</span><br><span class="traj-value-display-${i}" style="font-size:11px;color:var(--slate-500);word-break:break-all;font-family:var(--font-mono)">${escapeHtml(c.target || '')}</span>
          <input class="traj-value-input-${i}" type="text" value="${escapeHtml(c.target || '')}" style="display:none;width:100%;padding:4px 8px;border:1px solid var(--slate-300);border-radius:4px;font-size:13px;margin-top:2px;box-sizing:border-box"></div>` : ''}
        ${action === 'fill_date_field' || action === 'selectDate' ? `<div style="margin-bottom:4px"><span style="color:var(--slate-400);font-size:11px">Label</span><br><span style="font-weight:500">${escapeHtml(label)}</span></div>
          <div style="margin-bottom:4px"><span style="color:var(--slate-400);font-size:11px">Date</span><br><span class="traj-value-display-${i}">${escapeHtml(value)}</span>
          <input class="traj-value-input-${i}" type="text" value="${escapeHtml(value)}" style="display:none;width:100%;padding:4px 8px;border:1px solid var(--slate-300);border-radius:4px;font-size:13px;margin-top:2px;box-sizing:border-box"></div>` : ''}
        ${!ACTION_TYPES.includes(action) ? `<div style="color:var(--slate-500);font-size:12px">${escapeHtml(label || value || JSON.stringify(c.params || ''))}</div>` : ''}
      </div>
      <div style="display:flex;gap:4px;padding:4px 12px 8px">
        <button class="traj-move-up-btn btn btn-outline btn-sm" data-index="${i}" style="font-size:11px;padding:3px 8px" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="traj-move-down-btn btn btn-outline btn-sm" data-index="${i}" style="font-size:11px;padding:3px 8px" ${i === commands.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="traj-edit-btn btn btn-outline btn-sm" data-index="${i}" style="font-size:11px">Edit</button>
        <button class="traj-del-btn btn btn-outline btn-sm" data-index="${i}" style="color:var(--red-500);border-color:var(--red-200);font-size:11px">Delete</button>
      </div>
    </div>`;
  }).join('');

  const addBtnHtml = `<div id="trajAddActionBtn" style="border:2px dashed var(--slate-300);border-radius:8px;padding:12px;text-align:center;cursor:pointer;font-size:13px;color:var(--slate-400);margin-top:8px;transition:all .2s"
    onmouseenter="this.style.borderColor='var(--indigo-400)';this.style.color='var(--indigo-600)'"
    onmouseleave="this.style.borderColor='var(--slate-300)';this.style.color='var(--slate-400)'">+ Add Action</div>`;

  summaryEl.innerHTML = `
    <div style="margin-bottom:12px;padding:10px 12px;background:var(--slate-50);border-radius:8px;font-size:13px">
      <div style="margin-bottom:4px"><span style="color:var(--slate-400);font-size:11px">URL</span></div>
      <div style="word-break:break-all;font-family:var(--font-mono);font-size:12px;color:var(--indigo-600)">${escapeHtml(url || '(none)')}</div>
      <div style="margin-top:6px;font-size:11px;color:var(--slate-400)">${commands.length} actions</div>
    </div>
    ${cardsHtml}
    ${addBtnHtml}`;

  if (wireFn) wireFn();
}

/**
 * Wire DOM event listeners for all interactive action card elements:
 * edit, delete, move-up, move-down, add-action, and type-selector change.
 *
 * @param {Array} commands - mutable commands array
 * @param {HTMLElement} summaryEl - the #trajDetailSummary container (for querySelectorAll scope)
 * @param {Function} showSaveBall - callback that shows the floating save button
 * @param {Function} rerenderFn - callback that performs a full re-render (for operations that restructure cards)
 */
export function wireActionButtons(commands, summaryEl, showSaveBall, rerenderFn) {
  // Edit buttons
  summaryEl.querySelectorAll('.traj-edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index);
      const display = summaryEl.querySelector(`.traj-value-display-${idx}`);
      const input = summaryEl.querySelector(`.traj-value-input-${idx}`);
      if (display && input) {
        if (input.style.display === 'none') {
          display.style.display = 'none';
          input.style.display = 'block';
          input.focus();
          btn.textContent = 'Confirm';
        } else {
          const newVal = input.value;
          display.textContent = newVal;
          display.style.display = '';
          input.style.display = 'none';
          const cmd = commands[idx];
          if (cmd.params?.value !== undefined) cmd.params.value = newVal;
          if (cmd.action === 'go_to_url' && cmd.params) cmd.params.url = newVal;
          if (cmd.action === 'click_element_by_index') cmd.target = newVal;
          btn.textContent = 'Edit';
          showSaveBall();
        }
      }
    });
  });

  // Delete buttons
  summaryEl.querySelectorAll('.traj-del-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index);
      const card = summaryEl.querySelector(`.traj-card[data-index="${idx}"]`);
      if (card && confirm('Delete action #' + (idx+1) + '?')) {
        card.style.display = 'none';
        commands[idx] = null;
        showSaveBall();
      }
    });
  });

  // Move up
  summaryEl.querySelectorAll('.traj-move-up-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index);
      if (idx > 0) {
        [commands[idx-1], commands[idx]] = [commands[idx], commands[idx-1]];
        rerenderFn();
        showSaveBall();
      }
    });
  });

  // Move down
  summaryEl.querySelectorAll('.traj-move-down-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index);
      if (idx < commands.length - 1) {
        [commands[idx], commands[idx+1]] = [commands[idx+1], commands[idx]];
        rerenderFn();
        showSaveBall();
      }
    });
  });

  // Add action
  const addBtn = document.getElementById('trajAddActionBtn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      commands.push({ action: '', value: '', params: {} });
      rerenderFn();
      showSaveBall();
    });
  }

  // Type selector change
  summaryEl.querySelectorAll('.traj-type-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const idx = parseInt(sel.dataset.index);
      commands[idx].action = sel.value;
      rerenderFn();
      showSaveBall();
    });
  });
}
