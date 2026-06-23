// Trajectory Tab — shows action_*.json and log_*.txt from scripts/snapshots/
import { escapeHtml } from './swagger-api.js';
import { pipelineState, displayGeneratedScript } from './script-pipeline.js';
import { renderActionCards, wireActionButtons } from './trajectory-actions.js';
import { renderLogView } from './trajectory-log-view.js';

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
            <button class="btn btn-outline btn-sm snap-assemble" data-path="${escapeHtml(f.path)}" style="color:var(--emerald-600);border-color:var(--emerald-200);margin-right:4px">Assemble</button>
            <button class="btn btn-outline btn-sm snap-delete" data-path="${escapeHtml(f.path)}" data-name="${escapeHtml(f.name)}" style="color:var(--red-500);border-color:var(--red-200)">Delete</button>
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
            <button class="btn btn-outline btn-sm snap-view" data-path="${escapeHtml(f.path)}" data-type="log" style="margin-right:4px">View</button>
            <button class="btn btn-outline btn-sm snap-delete" data-path="${escapeHtml(f.path)}" data-name="${escapeHtml(f.name)}" style="color:var(--red-500);border-color:var(--red-200)">Delete</button>
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

        const summaryEl = document.getElementById('trajDetailSummary');

        if (fileType === 'action') {
          try {
            const jsonData = JSON.parse(content);
            const commands = jsonData?.tests?.[0]?.commands || [];
            const url = jsonData?.url || '';

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

            // Re-render adapter: wires renderActionCards + wireActionButtons from trajectory-actions.js
            function rerender() {
              renderActionCards(commands, summaryEl, url, () => {
                wireActionButtons(commands, summaryEl, showSaveBall, rerender);
              });
            }

            // Store original data for save
            summaryEl._trajectoryData = jsonData;

            rerender();

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
          // Log file — use structured log viewer
          document.querySelectorAll('#trajDetailPanel .section-title')[1].style.display = 'none';
          const jsonEl = document.getElementById('trajDetailJson');
          jsonEl.style.display = 'none';
          renderLogView(summaryEl, jsonEl, content);
        }
        detailPanel.style.display = '';
        trajCurrentDetailId = filePath;
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
          actionFile: data.actionFile,
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

    // Wire delete buttons
    body.querySelectorAll('.snap-delete').forEach(b => b.addEventListener('click', async () => {
      const filePath = b.dataset.path;
      const fileName = b.dataset.name || filePath.split('/').pop();
      if (!confirm('Delete ' + fileName + '?')) return;
      try {
        const res = await fetch('/api/test/assemble/file', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: filePath }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Delete failed');
        }
        // Close detail panel if showing the deleted file
        if (trajCurrentDetailId === filePath) {
          document.getElementById('trajDetailPanel').style.display = 'none';
          trajCurrentDetailId = null;
        }
        loadSnapshots();
      } catch (err) {
        alert('Delete failed: ' + err.message);
      }
    }));

  } catch (err) {
    loading.style.display = 'none';
    empty.style.display = 'block';
    empty.innerHTML = '<p style="font-size:13px;color:var(--red-400)">Load failed: ' + err.message + '</p>';
  }
}
