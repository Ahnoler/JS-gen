// Trajectory Tab — shows action_*.json and log_*.txt from scripts/snapshots/
import { escapeHtml } from './swagger-api.js';
import { pipelineState, displayGeneratedScript } from './script-pipeline.js';

export let trajCurrentDetailId = null;

export function initTrajectory() {
  document.getElementById('trajRefreshBtn').addEventListener('click', loadSnapshots);
  document.getElementById('trajDetailCloseBtn').addEventListener('click', () => {
    document.getElementById('trajDetailPanel').style.display = 'none';
    const ball = document.getElementById('trajSaveBall');
    if (ball) ball.style.display = 'none';
  });
}

export async function loadSnapshots() {
  const loading = document.getElementById('trajLoading');
  const empty = document.getElementById('trajEmpty');
  const list = document.getElementById('trajList');
  const body = document.getElementById('trajBody');
  const detail = document.getElementById('trajDetailPanel');

  loading.style.display = 'block';
  empty.style.display = 'none';
  list.style.display = 'none';
  if (detail) detail.style.display = 'none';

  try {
    const res = await fetch('/api/test/assemble/files');
    const data = await res.json();
    loading.style.display = 'none';

    const actionFiles = data.actionFiles || [];
    const logFiles = data.logFiles || [];

    if (!actionFiles.length && !logFiles.length) {
      empty.style.display = 'block';
      return;
    }

    list.style.display = 'block';

    // Build sections
    let html = '';

    // Action files section
    html += `<div class="section-title traj-toggle" data-target="traj-action-section" style="cursor:pointer;font-size:14px;font-weight:600;padding:8px 0">
      <span class="traj-toggle-icon">▼</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      Action Files (${actionFiles.length})
    </div>`;

    if (actionFiles.length) {
      html += `<div id="traj-action-section">
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px">
        <thead><tr style="border-bottom:2px solid var(--slate-200)">
          <th style="padding:8px;text-align:left;color:var(--slate-500);font-weight:600">File</th>
          <th style="padding:8px;text-align:left;color:var(--slate-500);font-weight:600">Size</th>
          <th style="padding:8px;text-align:left;color:var(--slate-500);font-weight:600">Modified</th>
          <th style="padding:8px;color:var(--slate-500);font-weight:600">Actions</th>
        </tr></thead><tbody>`;
      for (const f of actionFiles) {
        const mtime = new Date(f.mtime).toLocaleString();
        const sizeKb = (f.size / 1024).toFixed(1) + 'KB';
        html += `<tr style="border-bottom:1px solid var(--slate-100)">
          <td style="padding:8px;font-family:var(--font-mono);font-size:11px;color:var(--indigo-600)">${escapeHtml(f.name)}</td>
          <td style="padding:8px;color:var(--slate-400);font-size:12px">${sizeKb}</td>
          <td style="padding:8px;color:var(--slate-400);font-size:11px">${mtime}</td>
          <td style="padding:8px;white-space:nowrap">
            <button class="btn btn-outline btn-sm snap-view" data-path="${escapeHtml(f.path)}" data-type="action" style="margin-right:4px">View</button>
            <button class="btn btn-outline btn-sm snap-assemble" data-path="${escapeHtml(f.path)}" style="color:var(--emerald-600);border-color:var(--emerald-200)">Assemble</button>
          </td>
        </tr>`;
      }
      html += '</tbody></table></div>';
    }

    // Log files section
    html += `<div class="section-title traj-toggle" data-target="traj-log-section" style="cursor:pointer;font-size:14px;font-weight:600;padding:8px 0">
      <span class="traj-toggle-icon">▼</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
      Log Files (${logFiles.length})
    </div>`;

    if (logFiles.length) {
      html += `<div id="traj-log-section">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="border-bottom:2px solid var(--slate-200)">
          <th style="padding:8px;text-align:left;color:var(--slate-500);font-weight:600">File</th>
          <th style="padding:8px;text-align:left;color:var(--slate-500);font-weight:600">Size</th>
          <th style="padding:8px;text-align:left;color:var(--slate-500);font-weight:600">Modified</th>
          <th style="padding:8px;color:var(--slate-500);font-weight:600">Actions</th>
        </tr></thead><tbody>`;
      for (const f of logFiles) {
        const mtime = new Date(f.mtime).toLocaleString();
        const sizeKb = (f.size / 1024).toFixed(1) + 'KB';
        html += `<tr style="border-bottom:1px solid var(--slate-100)">
          <td style="padding:8px;font-family:var(--font-mono);font-size:11px;color:var(--slate-600)">${escapeHtml(f.name)}</td>
          <td style="padding:8px;color:var(--slate-400);font-size:12px">${sizeKb}</td>
          <td style="padding:8px;color:var(--slate-400);font-size:11px">${mtime}</td>
          <td style="padding:8px;white-space:nowrap">
            <button class="btn btn-outline btn-sm snap-view" data-path="${escapeHtml(f.path)}" data-type="log">View</button>
          </td>
        </tr>`;
      }
      html += '</tbody></table></div>';
    }

    body.innerHTML = html;

    // Wire collapsible toggles
    body.querySelectorAll('.traj-toggle').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const target = document.getElementById(el.dataset.target);
        const icon = el.querySelector('.traj-toggle-icon');
        if (target && icon) {
          const hidden = target.style.display === 'none';
          target.style.display = hidden ? '' : 'none';
          icon.textContent = hidden ? '▼' : '▶';
        }
      });
    });

    // Wire view buttons
    body.querySelectorAll('.snap-view').forEach(b => b.addEventListener('click', async () => {
      const filePath = b.dataset.path;
      const fileType = b.dataset.type;
      try {
        const res = await fetch('/' + filePath);
        if (!res.ok) throw new Error('Not found');
        const content = await res.text();
        const detailPanel = document.getElementById('trajDetailPanel');
        document.getElementById('trajDetailId').textContent = filePath.split('/').pop();
        document.getElementById('trajDetailInfo').textContent = fileType === 'action' ? 'Action file — ' + filePath : 'Log file — ' + filePath;

        if (fileType === 'action') {
          try {
            const jsonData = JSON.parse(content);
            const commands = jsonData?.tests?.[0]?.commands || [];
            const url = jsonData?.url || '';

            const summaryEl = document.getElementById('trajDetailSummary');

            function renderActionCards() {
              const actionTypes = ['go_to_url','fill_form_field','select_option','click_element_by_index','fill_date_field','selectDate'];
              const cardsHtml = commands.map((c, i) => {
                if (c === null) return '';
                const action = c.action || c.command || '';
                const label = c.propertiesName || c.params?.label_text || '';
                const value = c.value || c.params?.value || c.params?.option_text || '';
                if (!action) {
                  return `<div class="traj-card" data-index="${i}" style="border:1px solid var(--slate-200);border-radius:8px;margin-bottom:8px;overflow:hidden;background:#fff">
                    <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--slate-50);border-bottom:1px solid var(--slate-200);font-size:12px">
                      <span style="background:var(--indigo-100);color:var(--indigo-700);padding:1px 8px;border-radius:4px;font-weight:600;font-size:11px">#${i+1}</span>
                      <select class="traj-type-select" data-index="${i}" style="flex:1;padding:3px 8px;border:1px solid var(--slate-200);border-radius:4px;font-size:12px;background:#fff;color:var(--slate-600)">
                        <option value="">-- Select type --</option>
                        ${actionTypes.map(t => `<option value="${t}">${t}</option>`).join('')}
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
                    ${action === 'click_element_by_index' ? `<div style="margin-bottom:4px"><span style="color:var(--slate-400);font-size:11px">Element</span><br><span style="font-weight:500;font-family:var(--font-mono);font-size:12px">${escapeHtml(c.propertiesName || c.params?.text || '')}</span></div>
                      <div style="margin-bottom:4px"><span style="color:var(--slate-400);font-size:11px">XPath</span><br><span class="traj-value-display-${i}" style="font-size:11px;color:var(--slate-500);word-break:break-all;font-family:var(--font-mono)">${escapeHtml(c.target || '')}</span>
                      <input class="traj-value-input-${i}" type="text" value="${escapeHtml(c.target || '')}" style="display:none;width:100%;padding:4px 8px;border:1px solid var(--slate-300);border-radius:4px;font-size:13px;margin-top:2px;box-sizing:border-box"></div>` : ''}
                    ${action === 'fill_date_field' || action === 'selectDate' ? `<div style="margin-bottom:4px"><span style="color:var(--slate-400);font-size:11px">Label</span><br><span style="font-weight:500">${escapeHtml(label)}</span></div>
                      <div style="margin-bottom:4px"><span style="color:var(--slate-400);font-size:11px">Date</span><br><span class="traj-value-display-${i}">${escapeHtml(value)}</span>
                      <input class="traj-value-input-${i}" type="text" value="${escapeHtml(value)}" style="display:none;width:100%;padding:4px 8px;border:1px solid var(--slate-300);border-radius:4px;font-size:13px;margin-top:2px;box-sizing:border-box"></div>` : ''}
                    ${!['go_to_url','fill_form_field','select_option','click_element_by_index','fill_date_field','selectDate'].includes(action) ? `<div style="color:var(--slate-500);font-size:12px">${escapeHtml(label || value || JSON.stringify(c.params || ''))}</div>` : ''}
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

              wireActionButtons();
            }

            function wireActionButtons() {
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
                      if (cmd.value !== undefined) cmd.value = newVal;
                      if (cmd.params?.value !== undefined) cmd.params.value = newVal;
                      if (cmd.attributes?.value !== undefined) cmd.attributes.value = newVal;
                      if (cmd.element?.attributes?.value !== undefined) cmd.element.attributes.value = newVal;
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
                    renderActionCards();
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
                    renderActionCards();
                    showSaveBall();
                  }
                });
              });

              // Add action
              const addBtn = document.getElementById('trajAddActionBtn');
              if (addBtn) {
                addBtn.addEventListener('click', () => {
                  commands.push({ action: '', value: '', params: {} });
                  renderActionCards();
                  showSaveBall();
                });
              }

              // Type selector change
              summaryEl.querySelectorAll('.traj-type-select').forEach(sel => {
                sel.addEventListener('change', () => {
                  const idx = parseInt(sel.dataset.index);
                  commands[idx].action = sel.value;
                  renderActionCards();
                  showSaveBall();
                });
              });
            }

            // Hide raw JSON section and Send to Script Gen button
            document.getElementById('trajDetailJson').style.display = 'none';
            document.querySelectorAll('#trajDetailPanel .section-title')[1].style.display = 'none';
            const sendToGenBtn = document.getElementById('trajSendToGenBtn');
            if (sendToGenBtn) sendToGenBtn.style.display = 'none';

            // Create floating save ball
            let saveBall = document.getElementById('trajSaveBall');
            if (!saveBall) {
              saveBall = document.createElement('div');
              saveBall.id = 'trajSaveBall';
              saveBall.innerHTML = 'Save';
              Object.assign(saveBall.style, {
                position: 'fixed', left: '16px', bottom: '120px',
                width: '56px', height: '56px', borderRadius: '50%',
                background: 'var(--indigo-500)', color: '#fff',
                display: 'none', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', fontSize: '13px', fontWeight: '600',
                boxShadow: '0 4px 14px rgba(99,102,241,.4)',
                zIndex: '1000', transition: 'transform .15s, opacity .15s',
                border: 'none', fontFamily: 'inherit',
              });
              saveBall.onmouseenter = () => saveBall.style.transform = 'scale(1.08)';
              saveBall.onmouseleave = () => saveBall.style.transform = '';
              document.body.appendChild(saveBall);
            }

            function showSaveBall() { saveBall.style.display = 'flex'; }
            function hideSaveBall() { saveBall.style.display = 'none'; }
            hideSaveBall();

            // Store original data for save
            summaryEl._trajectoryData = jsonData;

            renderActionCards();

            // Wire save ball
            saveBall.onclick = async () => {
              const cleaned = commands.filter(c => c !== null);
              jsonData.tests[0].commands = cleaned;
              try {
                saveBall.textContent = '...';
                const saveRes = await fetch('/api/test/assemble/save', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ path: filePath, data: jsonData }),
                });
                const saveData = await saveRes.json();
                if (!saveRes.ok) throw new Error(saveData.error);
                saveBall.textContent = '✓';
                saveBall.style.background = 'var(--emerald-500)';
                setTimeout(() => {
                  hideSaveBall();
                  saveBall.textContent = 'Save';
                  saveBall.style.background = 'var(--indigo-500)';
                }, 1500);
              } catch (err) {
                alert('Save failed: ' + err.message);
                saveBall.textContent = 'Save';
              }
            };

          } catch {
            document.getElementById('trajDetailSummary').textContent = 'Failed to parse JSON';
            document.getElementById('trajDetailJson').textContent = content;
          }
        } else {
          document.getElementById('trajDetailSummary').textContent = 'Total lines: ' + content.split('\n').length;
          document.getElementById('trajDetailJson').textContent = content;
        }
        detailPanel.style.display = '';
      } catch (err) {
        alert('View failed: ' + err.message);
      }
    }));

    // Wire assemble buttons
    body.querySelectorAll('.snap-assemble').forEach(b => b.addEventListener('click', async () => {
      const filePath = b.dataset.path;
      b.disabled = true;
      b.textContent = 'Assembling...';
      try {
        const res = await fetch('/api/test/assemble', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actionFile: filePath }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        // Switch to gen tab
        const genTab = document.querySelector('.tab-btn[data-tab="gen"]');
        if (genTab) genTab.click();
        // Set pipeline state so Run button works
        pipelineState.currentTestId = data.testId;
        pipelineState.currentFileName = data.fileName;
        // Use the pipeline's display function — sets currentScript, shows run area, etc.
        displayGeneratedScript({
          script: data.script,
          testId: data.testId,
          fileName: data.fileName,
          steps: [],
          stats: data.stats,
        });
        // Add assembly info
        document.getElementById('genInfo').textContent = 'Assembled from ' + filePath.split('/').pop() +
          ' | ' + data.stats.original + ' entries → ' + data.stats.deduped + ' after dedup (removed ' + data.stats.removed + ')';
      } catch (err) {
        alert('Assemble failed: ' + err.message);
      } finally {
        b.disabled = false;
        b.textContent = 'Assemble';
      }
    }));

  } catch (err) {
    loading.style.display = 'none';
    empty.style.display = 'block';
    empty.innerHTML = '<p style="font-size:13px;color:var(--red-400)">Load failed: ' + err.message + '</p>';
  }
}
