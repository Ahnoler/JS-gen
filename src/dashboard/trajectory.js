// Trajectory Tab — lists DB trajectories via /api/v2/trajectories
import { escapeHtml } from './swagger-api.js';
import { formatTime } from './utils.js';
import { pipelineState, displayGeneratedScript } from './script-pipeline.js';
import { renderActionCards, wireActionButtons } from './trajectory-actions.js';
import { fetchHierarchyTree, flattenFunctionOptions } from './hierarchy.js';

export let trajCurrentDetailId = null;

export function initTrajectory() {
  document.getElementById('trajRefreshBtn').addEventListener('click', loadSnapshots);
  document.getElementById('trajDetailCloseBtn').addEventListener('click', () => {
    document.getElementById('trajDetailPanel').style.display = 'none';
    const ball = document.getElementById('trajSaveBall');
    if (ball) ball.style.display = 'none';
  });
  const filter = document.getElementById('trajFunctionFilter');
  if (filter) {
    filter.addEventListener('change', () => loadSnapshots());
    populateFunctionFilter();
  }
}

async function populateFunctionFilter() {
  const filter = document.getElementById('trajFunctionFilter');
  if (!filter) return;
  const prev = filter.value;
  try {
    const tree = await fetchHierarchyTree();
    const opts = flattenFunctionOptions(tree);
    filter.innerHTML = '<option value="">全部功能点</option>' +
      opts.map(o => `<option value="${o.id}">${escapeHtml(o.label)}</option>`).join('');
    if (prev) filter.value = prev;
  } catch (err) {
    console.warn('[trajectory] function filter load failed:', err.message);
  }
}

export async function loadSnapshots() {
  const loading = document.getElementById('trajLoading');
  const empty = document.getElementById('trajEmpty');
  const list = document.getElementById('trajList');
  const body = document.getElementById('trajBody');
  const detail = document.getElementById('trajDetailPanel');
  const filter = document.getElementById('trajFunctionFilter');

  loading.style.display = 'block';
  empty.style.display = 'none';
  list.style.display = 'none';
  if (detail) detail.style.display = 'none';

  try {
    await populateFunctionFilter();
    const functionId = filter?.value || '';
    const qs = new URLSearchParams({ page: '1', pageSize: '100' });
    if (functionId) qs.set('functionId', functionId);
    const res = await fetch('/api/v2/trajectories?' + qs.toString());
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Load failed');
    loading.style.display = 'none';

    const rows = data.rows || [];
    if (!rows.length) {
      empty.style.display = 'block';
      empty.innerHTML = functionId
        ? '<p>该功能点下暂无轨迹</p>'
        : '<p>暂无保存的轨迹</p>';
      return;
    }

    list.style.display = 'block';
    body.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px">
        <thead><tr style="border-bottom:2px solid var(--slate-200)">
          <th style="padding:8px;text-align:left;color:var(--slate-500);font-weight:600">ID</th>
          <th style="padding:8px;text-align:left;color:var(--slate-500);font-weight:600">Task</th>
          <th style="padding:8px;text-align:left;color:var(--slate-500);font-weight:600">Fn ID</th>
          <th style="padding:8px;text-align:left;color:var(--slate-500);font-weight:600">Phases / Steps</th>
          <th style="padding:8px;text-align:left;color:var(--slate-500);font-weight:600">Created</th>
          <th style="padding:8px;color:var(--slate-500);font-weight:600">Actions</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => {
            const tid = String(r.id || '');
            const task = (r.task || '').slice(0, 60);
            return `<tr style="border-bottom:1px solid var(--slate-100)">
              <td style="padding:8px;font-family:var(--font-mono);font-size:11px;color:var(--indigo-600)" title="${escapeHtml(tid)}">#${escapeHtml(tid)}</td>
              <td style="padding:8px;color:var(--slate-600);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(r.task || '')}">${escapeHtml(task)}</td>
              <td style="padding:8px;font-family:var(--font-mono);font-size:11px;color:var(--slate-500)">${r.functionId ?? '—'}</td>
              <td style="padding:8px;color:var(--slate-500);font-size:12px">${r.phaseCount ?? 0} / ${r.stepCount ?? 0}</td>
              <td style="padding:8px;color:var(--slate-400);font-size:11px">${formatTime(r.createdAt)}</td>
              <td style="padding:8px;white-space:nowrap">
                <button class="btn btn-outline btn-sm traj-view" data-id="${escapeHtml(tid)}" style="margin-right:4px">View</button>
                <button class="btn btn-outline btn-sm traj-assemble" data-id="${escapeHtml(tid)}" style="color:var(--emerald-600);border-color:var(--emerald-200);margin-right:4px">Assemble</button>
                <button class="btn btn-outline btn-sm traj-delete" data-id="${escapeHtml(tid)}" style="color:var(--red-500);border-color:var(--red-200)">Delete</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;

    body.querySelectorAll('.traj-view').forEach(b => b.addEventListener('click', () => viewTrajectory(b.dataset.id)));
    body.querySelectorAll('.traj-assemble').forEach(b => b.addEventListener('click', () => assembleTrajectory(b)));
    body.querySelectorAll('.traj-delete').forEach(b => b.addEventListener('click', () => deleteTrajectory(b.dataset.id)));
  } catch (err) {
    loading.style.display = 'none';
    empty.style.display = 'block';
    empty.innerHTML = '<p style="font-size:13px;color:var(--red-400)">Load failed: ' + err.message + '</p>';
  }
}

async function viewTrajectory(trajectoryId) {
  try {
    const res = await fetch('/api/v2/trajectories/' + encodeURIComponent(trajectoryId));
    const traj = await res.json();
    if (!res.ok) throw new Error(traj.error || 'Not found');

    const detailPanel = document.getElementById('trajDetailPanel');
    document.getElementById('trajDetailId').textContent = trajectoryId;
    document.getElementById('trajDetailInfo').textContent =
      `id #${traj.id} · Phases ${traj.phaseCount ?? (traj.phases || []).length} · Steps ${traj.stepCount ?? 0} · Fn ${traj.functionId ?? '—'} · ${traj.url || ''}`;

    const summaryEl = document.getElementById('trajDetailSummary');
    document.getElementById('trajDetailJson').style.display = 'none';
    const sectionTitles = document.querySelectorAll('#trajDetailPanel .section-title');
    if (sectionTitles[1]) sectionTitles[1].style.display = 'none';
    const sendToGenBtn = document.getElementById('trajSendToGenBtn');
    if (sendToGenBtn) sendToGenBtn.style.display = 'none';

    const commands = (traj.steps || []).map(s => {
      const params = s.params ?? s.paramsJson ?? {};
      return {
        action: s.actionType || '',
        params: typeof params === 'string' ? (() => { try { return JSON.parse(params); } catch { return {}; } })() : (params || {}),
        result: s.extractedContent || '',
        phase: s.phaseNumber ?? 0,
      };
    });
    const url = traj.url || '';
    renderActionCards(commands, summaryEl, url, () => {
      wireActionButtons(commands, summaryEl, () => {}, () => {
        renderActionCards(commands, summaryEl, url, () => wireActionButtons(commands, summaryEl, () => {}, () => {}));
      });
    });

    detailPanel.style.display = '';
    trajCurrentDetailId = trajectoryId;
  } catch (err) {
    alert('View failed: ' + err.message);
  }
}

async function assembleTrajectory(btn) {
  const trajectoryId = btn.dataset.id;
  btn.disabled = true;
  btn.textContent = 'Assembling...';
  try {
    const fileRes = await fetch('/api/v2/trajectories/' + encodeURIComponent(trajectoryId) + '/assemble-file', {
      method: 'POST',
    });
    const fileData = await fileRes.json();
    if (!fileRes.ok) throw new Error(fileData.error || 'Materialize failed');

    const res = await fetch('/api/test/assemble', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionFile: fileData.actionFile }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const genTab = document.querySelector('.tab-btn[data-tab="gen"]');
    if (genTab) genTab.click();
    pipelineState.currentTestId = data.testId;
    pipelineState.currentFileName = data.fileName;
    displayGeneratedScript({
      script: data.script,
      testId: data.testId,
      fileName: data.fileName,
      actionFile: data.actionFile,
      steps: [],
      stats: data.stats,
    });
    document.getElementById('genInfo').textContent =
      'Assembled from trajectory ' + trajectoryId.slice(0, 16) +
      ' | ' + data.stats.original + ' → ' + data.stats.deduped + ' (removed ' + data.stats.removed + ')';
  } catch (err) {
    alert('Assemble failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Assemble';
  }
}

async function deleteTrajectory(trajectoryId) {
  if (!confirm('Delete trajectory ' + trajectoryId.slice(0, 20) + '…?')) return;
  try {
    const res = await fetch('/api/v2/trajectories/' + encodeURIComponent(trajectoryId), { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json()).error || 'Delete failed');
    if (trajCurrentDetailId === trajectoryId) {
      document.getElementById('trajDetailPanel').style.display = 'none';
      trajCurrentDetailId = null;
    }
    loadSnapshots();
  } catch (err) {
    alert('Delete failed: ' + err.message);
  }
}
