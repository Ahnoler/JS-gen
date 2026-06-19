// Trajectory Tab — shows action_*.json and log_*.txt from scripts/snapshots/
import { escapeHtml } from './swagger-api.js';

export let trajCurrentDetailId = null;

export function initTrajectory() {
  document.getElementById('trajRefreshBtn').addEventListener('click', loadSnapshots);
  document.getElementById('trajDetailCloseBtn').addEventListener('click', () => {
    document.getElementById('trajDetailPanel').style.display = 'none';
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
    html += `<div class="section-title" style="font-size:14px;font-weight:600;padding:8px 0">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      Action Files (${actionFiles.length})
    </div>`;

    if (actionFiles.length) {
      html += `<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px">
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
      html += '</tbody></table>';
    }

    // Log files section
    html += `<div class="section-title" style="font-size:14px;font-weight:600;padding:8px 0">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
      Log Files (${logFiles.length})
    </div>`;

    if (logFiles.length) {
      html += `<table style="width:100%;border-collapse:collapse;font-size:13px">
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
      html += '</tbody></table>';
    }

    body.innerHTML = html;

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
        // Show steps summary for action files
        if (fileType === 'action') {
          try {
            const jsonData = JSON.parse(content);
            const cmds = jsonData?.tests?.[0]?.commands || [];
            document.getElementById('trajDetailSummary').innerHTML = cmds.map((c, i) =>
              `<div style="padding:2px 0;font-size:12px"><span style="color:var(--slate-400);font-family:var(--font-mono);font-size:11px">#${i+1}</span> [${c.command}] ${escapeHtml(c.propertiesName || '')} → ${escapeHtml(c.value || '')}</div>`
            ).join('');
            document.getElementById('trajDetailJson').textContent = JSON.stringify(jsonData, null, 2);
          } catch {
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
        // Switch to gen tab and show the generated script
        const genTab = document.querySelector('.tab-btn[data-tab="gen"]');
        if (genTab) genTab.click();
        document.getElementById('genScriptPre').textContent = data.script;
        document.getElementById('genScriptArea').style.display = '';
        document.getElementById('genSteps').style.display = 'none';
        document.getElementById('genInfo').style.display = '';
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
