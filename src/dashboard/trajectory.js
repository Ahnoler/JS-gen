// Trajectory Tab — [EXPERIMENT] lists action JSON from scripts/action via /api/test/assemble/files
// (DB path via /api/v2/trajectories commented out below for easy restore)
import { escapeHtml } from './swagger-api.js';
import { formatTime } from './utils.js';
import { pipelineState, displayGeneratedScript } from './script-pipeline.js';
import { renderActionCards, wireActionButtons } from './trajectory-actions.js';
import { fetchHierarchyTree, flattenFunctionOptions } from './hierarchy.js';
// [EXPERIMENT] readV2 only needed when restoring DB path
// import { readV2 } from './api-envelope.js';

export let trajCurrentDetailId = null;

/** Relative path under project, e.g. scripts/action/action_20260619_183411.json */
function actionFilePath(nameOrPath) {
  if (!nameOrPath) return '';
  const s = String(nameOrPath).replace(/\\/g, '/');
  if (s.startsWith('scripts/action/')) return s;
  return 'scripts/action/' + s.replace(/^.*\//, '');
}

export function initTrajectory() {
  document.getElementById('trajRefreshBtn').addEventListener('click', loadSnapshots);
  document.getElementById('trajDetailCloseBtn').addEventListener('click', () => {
    document.getElementById('trajDetailPanel').style.display = 'none';
    const ball = document.getElementById('trajSaveBall');
    if (ball) ball.style.display = 'none';
  });
  const filter = document.getElementById('trajFunctionFilter');
  if (filter) {
    // [EXPERIMENT] function filter N/A for action-file mode
    filter.style.display = 'none';
    filter.addEventListener('change', () => loadSnapshots());
    // populateFunctionFilter();
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

  loading.style.display = 'block';
  empty.style.display = 'none';
  list.style.display = 'none';
  if (detail) detail.style.display = 'none';

  try {
    // ── [EXPERIMENT] file-based list ──
    const res = await fetch('/api/test/assemble/files');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    loading.style.display = 'none';

    const rows = (data.actionFiles || []).map((f) => ({
      id: f.name,
      path: f.path || actionFilePath(f.name),
      task: f.name,
      functionId: null,
      phaseCount: 0,
      stepCount: null,
      createdAt: f.mtime,
      size: f.size,
    }));

    /* ── DB path (restore later) ──
    await populateFunctionFilter();
    const filter = document.getElementById('trajFunctionFilter');
    const functionId = filter?.value || '';
    const qs = new URLSearchParams({ page: '1', pageSize: '100' });
    if (functionId) qs.set('functionId', functionId);
    const res = await fetch('/api/v2/trajectories?' + qs.toString());
    const data = await readV2(res);
    loading.style.display = 'none';
    const rows = data.rows || [];
    ── end DB path ── */

    if (!rows.length) {
      empty.style.display = 'block';
      empty.innerHTML = '<p>scripts/action 下暂无 action_*.json</p>';
      return;
    }

    list.style.display = 'block';
    body.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px">
        <thead><tr style="border-bottom:2px solid var(--slate-200)">
          <th style="padding:8px;text-align:left;color:var(--slate-500);font-weight:600">File</th>
          <th style="padding:8px;text-align:left;color:var(--slate-500);font-weight:600">Path</th>
          <th style="padding:8px;text-align:left;color:var(--slate-500);font-weight:600">Size</th>
          <th style="padding:8px;text-align:left;color:var(--slate-500);font-weight:600">Modified</th>
          <th style="padding:8px;color:var(--slate-500);font-weight:600">Actions</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => {
            const tid = String(r.id || '');
            const path = r.path || actionFilePath(tid);
            const sizeKb = r.size != null ? (Math.round(r.size / 102.4) / 10) + ' KB' : '—';
            return `<tr style="border-bottom:1px solid var(--slate-100)">
              <td style="padding:8px;font-family:var(--font-mono);font-size:11px;color:var(--indigo-600)" title="${escapeHtml(tid)}">${escapeHtml(tid)}</td>
              <td style="padding:8px;color:var(--slate-600);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px" title="${escapeHtml(path)}">${escapeHtml(path)}</td>
              <td style="padding:8px;color:var(--slate-500);font-size:12px">${sizeKb}</td>
              <td style="padding:8px;color:var(--slate-400);font-size:11px">${formatTime(r.createdAt)}</td>
              <td style="padding:8px;white-space:nowrap">
                <button class="btn btn-outline btn-sm traj-view" data-id="${escapeHtml(tid)}" data-path="${escapeHtml(path)}" style="margin-right:4px">View</button>
                <button class="btn btn-outline btn-sm traj-assemble" data-id="${escapeHtml(tid)}" data-path="${escapeHtml(path)}" style="color:var(--emerald-600);border-color:var(--emerald-200);margin-right:4px">Assemble</button>
                <button class="btn btn-outline btn-sm traj-delete" data-id="${escapeHtml(tid)}" data-path="${escapeHtml(path)}" style="color:var(--red-500);border-color:var(--red-200)">Delete</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;

    body.querySelectorAll('.traj-view').forEach(b => b.addEventListener('click', () => viewTrajectory(b.dataset.id, b.dataset.path)));
    body.querySelectorAll('.traj-assemble').forEach(b => b.addEventListener('click', () => assembleTrajectory(b)));
    body.querySelectorAll('.traj-delete').forEach(b => b.addEventListener('click', () => deleteTrajectory(b.dataset.id, b.dataset.path)));
  } catch (err) {
    loading.style.display = 'none';
    empty.style.display = 'block';
    empty.innerHTML = '<p style="font-size:13px;color:var(--red-400)">Load failed: ' + err.message + '</p>';
  }
}

async function viewTrajectory(trajectoryId, filePath) {
  try {
    // ── [EXPERIMENT] load action JSON from static /scripts ──
    const rel = actionFilePath(filePath || trajectoryId);
    const res = await fetch('/' + rel);
    if (!res.ok) throw new Error('Failed to load ' + rel + ' (' + res.status + ')');
    const json = await res.json();
    const commands = json?.tests?.[0]?.commands || json?.commands || [];
    const url = json?.url || '';
    const stepCount = commands.filter((c) => c != null).length;

    const detailPanel = document.getElementById('trajDetailPanel');
    document.getElementById('trajDetailId').textContent = trajectoryId;
    document.getElementById('trajDetailInfo').textContent =
      `file ${rel} · Steps ${stepCount} · ${url}`;

    /* ── DB path (restore later) ──
    const res = await fetch('/api/v2/trajectories/' + encodeURIComponent(trajectoryId));
    const traj = await readV2(res);
    document.getElementById('trajDetailId').textContent = trajectoryId;
    document.getElementById('trajDetailInfo').textContent =
      `id #${traj.id} · Phases ${traj.phaseCount ?? (traj.phases || []).length} · Steps ${traj.stepCount ?? 0} · Fn ${traj.functionId ?? '—'} · ${traj.url || ''}`;
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
    ── end DB path ── */

    const summaryEl = document.getElementById('trajDetailSummary');
    document.getElementById('trajDetailJson').style.display = 'none';
    const sectionTitles = document.querySelectorAll('#trajDetailPanel .section-title');
    if (sectionTitles[1]) sectionTitles[1].style.display = 'none';
    const sendToGenBtn = document.getElementById('trajSendToGenBtn');
    if (sendToGenBtn) sendToGenBtn.style.display = 'none';

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
  const actionFile = actionFilePath(btn.dataset.path || trajectoryId);
  btn.disabled = true;
  btn.textContent = 'Assembling...';
  try {
    // ── [EXPERIMENT] assemble directly from action file ──
    const res = await fetch('/api/test/assemble', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionFile }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    /* ── DB path (restore later) ──
    const fileRes = await fetch('/api/v2/trajectories/' + encodeURIComponent(trajectoryId) + '/assemble-file', {
      method: 'POST',
    });
    const fileData = await readV2(fileRes);
    const res = await fetch('/api/test/assemble', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionFile: fileData.actionFile }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    ── end DB path ── */

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
      'Assembled from ' + actionFile +
      ' | ' + data.stats.original + ' → ' + data.stats.deduped + ' (removed ' + data.stats.removed + ')';
  } catch (err) {
    alert('Assemble failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Assemble';
  }
}

async function deleteTrajectory(trajectoryId, filePath) {
  const path = actionFilePath(filePath || trajectoryId);
  if (!confirm('Delete action file ' + path + '？')) return;
  try {
    // ── [EXPERIMENT] delete disk file ──
    const res = await fetch('/api/test/assemble/file', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);

    /* ── DB path (restore later) ──
    const res = await fetch('/api/v2/trajectories/' + encodeURIComponent(trajectoryId), { method: 'DELETE' });
    await readV2(res);
    ── end DB path ── */

    if (trajCurrentDetailId === trajectoryId) {
      document.getElementById('trajDetailPanel').style.display = 'none';
      trajCurrentDetailId = null;
    }
    loadSnapshots();
  } catch (err) {
    alert('Delete failed: ' + err.message);
  }
}
