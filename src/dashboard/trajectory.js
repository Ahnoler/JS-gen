// Trajectory History
// Extracted from test-dashboard.js (loadTrajectoryHistory, viewTrajectoryDetail, sendToScriptGen, deleteTrajectory)

import { formatTime } from './utils.js';
import { escapeHtml } from './swagger-api.js';

export let trajCurrentDetailId = null;

export function initTrajectory() {
  document.getElementById('trajRefreshBtn').addEventListener('click', loadTrajectoryHistory);
  document.getElementById('trajDetailCloseBtn').addEventListener('click', () => {
    document.getElementById('trajDetailPanel').style.display = 'none';
    trajCurrentDetailId = null;
  });
  document.getElementById('trajSendToGenBtn').addEventListener('click', () => {
    if (trajCurrentDetailId) sendToScriptGen(trajCurrentDetailId);
  });
}

export async function loadTrajectoryHistory() {
  const loading = document.getElementById('trajLoading');
  const empty = document.getElementById('trajEmpty');
  const list = document.getElementById('trajList');
  const body = document.getElementById('trajBody');
  const detail = document.getElementById('trajDetailPanel');

  loading.style.display = 'block';
  empty.style.display = 'none';
  list.style.display = 'none';
  if (detail) detail.style.display = 'none';
  trajCurrentDetailId = null;

  try {
    const res = await fetch('/api/trajectory');
    const data = await res.json();
    loading.style.display = 'none';

    if (!data.length) {
      empty.style.display = 'block';
      return;
    }

    list.style.display = 'block';
    body.innerHTML = data.map(r => {
      const statusBadge = r.isSuccessful === true
        ? '<span style="background:#ecfdf5;color:#065f46;padding:1px 8px;border-radius:10px;font-size:11px">Success</span>'
        : r.isSuccessful === false
          ? '<span style="background:#fef2f2;color:#991b1b;padding:1px 8px;border-radius:10px;font-size:11px">Failed</span>'
          : '<span style="color:var(--slate-400);font-size:11px">-</span>';
      return `
        <tr style="border-bottom:1px solid var(--slate-100)">
          <td style="padding:8px;font-family:var(--font-mono);font-size:11px;color:var(--indigo-600)" title="${escapeHtml(r.trajectoryId)}">${escapeHtml(r.trajectoryId.slice(0, 24))}...</td>
          <td style="padding:8px;color:var(--slate-600);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(r.task || '')}">${escapeHtml((r.task || '').slice(0, 60))}</td>
          <td style="padding:8px;color:var(--slate-500);font-size:12px">${r.stepCount || 0} / ${r.actionCount || 0}</td>
          <td style="padding:8px">${statusBadge}</td>
          <td style="padding:8px;color:var(--slate-400);font-size:11px">${formatTime(r.createdAt)}</td>
          <td style="padding:8px;text-align:right;white-space:nowrap">
            <button class="btn btn-outline btn-sm traj-view" data-id="${escapeHtml(r.trajectoryId)}" style="margin-right:4px">View</button>
            <button class="btn btn-outline btn-sm traj-sendgen" data-id="${escapeHtml(r.trajectoryId)}" style="margin-right:4px">Send to Script Gen</button>
            <button class="btn btn-outline btn-sm traj-del" data-id="${escapeHtml(r.trajectoryId)}" style="color:var(--red-500);border-color:var(--red-200)">Delete</button>
          </td>
        </tr>`;
    }).join('');

    body.querySelectorAll('.traj-view').forEach(b => b.addEventListener('click', () => viewTrajectoryDetail(b.dataset.id)));
    body.querySelectorAll('.traj-sendgen').forEach(b => b.addEventListener('click', () => sendToScriptGen(b.dataset.id)));
    body.querySelectorAll('.traj-del').forEach(b => b.addEventListener('click', () => deleteTrajectory(b.dataset.id)));
  } catch (err) {
    loading.style.display = 'none';
    empty.style.display = 'block';
    empty.innerHTML = '<p style="font-size:13px;color:var(--red-400)">Load failed: ' + err.message + '</p>';
  }
}

async function viewTrajectoryDetail(trajectoryId) {
  const detail = document.getElementById('trajDetailPanel');
  const idSpan = document.getElementById('trajDetailId');
  const info = document.getElementById('trajDetailInfo');
  const summary = document.getElementById('trajDetailSummary');
  const jsonPre = document.getElementById('trajDetailJson');
  const modelSelect = document.getElementById('trajDetailModel');

  trajCurrentDetailId = trajectoryId;
  idSpan.textContent = trajectoryId;
  detail.style.display = '';
  jsonPre.textContent = '';

  if (modelSelect.options.length <= 1) {
    try {
      const r = await fetch('/api/models');
      const d = await r.json();
      const models = d.models || [];
      modelSelect.innerHTML = '<option value="">Default</option>' +
        models.map(m => `<option value="${m.id}">${m.provider} / ${m.name}</option>`).join('');
    } catch {}
  }

  try {
    const res = await fetch('/api/trajectory/' + trajectoryId);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    info.innerHTML = '<b>Task:</b> ' + escapeHtml(data.task || '') +
      ' | <b>Model:</b> ' + escapeHtml(data.model || '-') +
      ' | <b>Steps:</b> ' + (data.stepCount || 0) +
      ' | <b>Actions:</b> ' + (data.actionCount || 0) +
      ' | <b>Created:</b> ' + formatTime(data.createdAt);

    if (data.steps) {
      summary.innerHTML = data.steps.map(s =>
        `<div style="padding:2px 0"><span style="color:var(--slate-400);font-family:var(--font-mono);font-size:11px">#${s.step}</span> ${escapeHtml(s.goal)}</div>`
      ).join('');
    }

    fetch('/api/trajectory/' + trajectoryId + '?full=1').then(r => r.json()).then(d => {
      if (d.trajectory) jsonPre.textContent = JSON.stringify(d.trajectory, null, 2);
      else jsonPre.textContent = '(no trajectory data)';
    }).catch(() => {
      jsonPre.textContent = '(failed to load)';
    });
  } catch (err) {
    summary.textContent = 'Error: ' + err.message;
    console.error(err);
  }
}

async function sendToScriptGen(trajectoryId) {
  const genBtn = document.getElementById('trajSendToGenBtn');
  genBtn.disabled = true;
  genBtn.textContent = 'Loading...';

  try {
    const [basicRes, fullRes] = await Promise.all([
      fetch('/api/trajectory/' + trajectoryId),
      fetch('/api/trajectory/' + trajectoryId + '?full=1'),
    ]);
    const basic = await basicRes.json();
    const full = await fullRes.json();
    if (!basicRes.ok) throw new Error(basic.error);

    // Build compact table from trajectory flow
    let desc = '根据以下浏览器操作轨迹生成 Playwright 测试脚本。\n\n## 操作轨迹\n| # | 操作 | 目标 | 元素 | XPath | 标签 | 值 |\n|---|------|------|------|-------|------|------|\n';
    if (full.trajectory) {
      const history = full.trajectory.history || [];
      let row = 0;
      for (const h of history) {
        const mo = h.model_output;
        if (!mo) continue;
        const actions = mo.action || [];
        const goal = mo.current_state?.next_goal || '';
        for (let ai = 0; ai < actions.length; ai++) {
          const a = actions[ai];
          if (!a || typeof a !== 'object') continue;
          const type = Object.keys(a)[0];
          const p = a[type] || {};
          const el = (h.state?.interacted_element || [])[ai] || {};
          const xpath = el.xpath || '';
          const tag = el.tag_name || '';
          let label = p.label_text || p.label || '';
          let value = p.text || p.value || '';
          if (p.url) value = p.url;
          row++;
          desc += `| ${row} | ${type} | ${goal} | ${tag} | ${xpath || '-'} | ${label} | ${value} |\n`;
        }
      }
    } else {
      // Fallback: use basic steps
      const steps = basic.steps || [];
      for (const s of steps) {
        desc += `| ${s.step} | | ${s.goal} | | |\n`;
      }
    }

    const genTab = document.querySelector('.tab-btn[data-tab="gen"]');
    if (genTab) genTab.click();

    document.getElementById('trajPromptContent').textContent = desc;
    document.getElementById('trajPromptCard').style.display = '';
    document.getElementById('genDesc').value = '';
    document.getElementById('genUrl').value = '';
    document.getElementById('genScriptArea').style.display = 'none';
    document.getElementById('genSteps').style.display = 'none';
    document.getElementById('genInfo').style.display = 'none';
    document.getElementById('genRefineArea').style.display = 'none';
    document.getElementById('genRunArea').style.display = 'none';
    document.getElementById('genStatus').textContent = 'Ready — click Generate';
  } catch (err) {
    alert('Failed to load trajectory: ' + err.message);
  } finally {
    genBtn.disabled = false;
    genBtn.textContent = 'Send to Script Gen';
  }
}

async function deleteTrajectory(trajectoryId) {
  if (!confirm('Delete trajectory ' + trajectoryId.slice(0, 20) + '...?')) return;
  try {
    const res = await fetch('/api/trajectory/' + trajectoryId, { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json()).error || 'Delete failed');

    if (trajCurrentDetailId === trajectoryId) {
      document.getElementById('trajDetailPanel').style.display = 'none';
      trajCurrentDetailId = null;
    }
    loadTrajectoryHistory();
  } catch (err) {
    alert('Delete failed: ' + err.message);
  }
}
