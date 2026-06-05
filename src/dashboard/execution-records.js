// Execution Records
// Extracted from test-dashboard.js (loadExecutionRecords, viewExecutionRecord, continueExecutionRecord, deleteExecutionRecord)

import { escapeHtml } from './swagger-api.js';

export let execRecordCurrentId = null;

export function initExecutionRecords() {
  document.getElementById('execRecordsRefreshBtn').addEventListener('click', loadExecutionRecords);
  document.getElementById('execRecordDetailCloseBtn').addEventListener('click', () => {
    document.getElementById('execRecordDetailPanel').style.display = 'none';
    execRecordCurrentId = null;
  });
}

export async function loadExecutionRecords() {
  const loading = document.getElementById('execRecordsLoading');
  const empty = document.getElementById('execRecordsEmpty');
  const list = document.getElementById('execRecordsList');
  const body = document.getElementById('execRecordsBody');
  const detail = document.getElementById('execRecordDetailPanel');

  loading.style.display = 'block';
  empty.style.display = 'none';
  list.style.display = 'none';
  detail.style.display = 'none';
  execRecordCurrentId = null;

  try {
    const res = await fetch('/api/browser/session/execution-records');
    const records = await res.json();

    loading.style.display = 'none';

    if (!records || records.length === 0) {
      empty.style.display = 'block';
      return;
    }

    list.style.display = 'block';
    body.innerHTML = records.map(r => {
      const stepCount = r.stepIndex || r.steps?.length || 0;
      const created = r.createdAt ? new Date(r.createdAt).toLocaleString() : '-';
      const archived = r.archivedAt ? new Date(r.archivedAt).toLocaleString() : '-';
      const shortId = r.sessionId?.slice(0, 8) || '???';
      return `<tr style="border-bottom:1px solid var(--slate-100)">
        <td style="padding:8px;font-family:var(--font-mono);font-size:11px;color:var(--indigo-600)" title="${escapeHtml(r.sessionId)}">${escapeHtml(shortId)}...</td>
        <td style="padding:8px">${escapeHtml(r.model || '-')}</td>
        <td style="padding:8px">${stepCount}</td>
        <td style="padding:8px;font-size:12px;color:var(--slate-500)">${escapeHtml(created)}</td>
        <td style="padding:8px;font-size:12px;color:var(--slate-500)">${escapeHtml(archived)}</td>
        <td style="padding:8px">
          <button class="btn btn-outline btn-sm exec-record-view" data-id="${escapeHtml(r.sessionId)}" style="margin-right:4px">Review</button>
          <button class="btn btn-outline btn-sm exec-record-continue" data-id="${escapeHtml(r.sessionId)}" style="margin-right:4px;color:var(--green-600);border-color:var(--green-300)">Continue</button>
          <button class="btn btn-outline btn-sm exec-record-del" data-id="${escapeHtml(r.sessionId)}" style="color:var(--red-500);border-color:var(--red-200)">Delete</button>
        </td>
      </tr>`;
    }).join('');

    body.querySelectorAll('.exec-record-view').forEach(btn => {
      btn.addEventListener('click', () => viewExecutionRecord(btn.dataset.id));
    });
    body.querySelectorAll('.exec-record-continue').forEach(btn => {
      btn.addEventListener('click', () => continueExecutionRecord(btn.dataset.id));
    });
    body.querySelectorAll('.exec-record-del').forEach(btn => {
      btn.addEventListener('click', () => deleteExecutionRecord(btn.dataset.id));
    });
  } catch (err) {
    loading.style.display = 'none';
    empty.style.display = 'block';
    empty.innerHTML = `<p style="color:var(--red-500)">Failed to load: ${escapeHtml(err.message)}</p>`;
  }
}

async function viewExecutionRecord(sessionId) {
  const detail = document.getElementById('execRecordDetailPanel');
  const idSpan = document.getElementById('execRecordDetailId');
  const info = document.getElementById('execRecordDetailInfo');
  const stepsDiv = document.getElementById('execRecordSteps');

  execRecordCurrentId = sessionId;
  idSpan.textContent = sessionId.slice(0, 12) + '...';
  detail.style.display = 'block';
  info.textContent = 'Loading...';
  stepsDiv.textContent = '';

  try {
    const res = await fetch('/api/browser/session/execution-record/' + sessionId);
    if (!res.ok) throw new Error('Record not found');
    const r = await res.json();

    const created = r.createdAt ? new Date(r.createdAt).toLocaleString() : '-';
    const archived = r.archivedAt ? new Date(r.archivedAt).toLocaleString() : '-';
    info.innerHTML = `
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:4px 8px;color:var(--slate-500);width:100px">Session ID</td><td style="padding:4px 8px;font-family:var(--font-mono);font-size:12px">${escapeHtml(r.sessionId)}</td></tr>
        <tr><td style="padding:4px 8px;color:var(--slate-500)">Model</td><td style="padding:4px 8px">${escapeHtml(r.model || '-')}</td></tr>
        <tr><td style="padding:4px 8px;color:var(--slate-500)">Steps</td><td style="padding:4px 8px">${r.stepIndex || 0}</td></tr>
        <tr><td style="padding:4px 8px;color:var(--slate-500)">Created</td><td style="padding:4px 8px">${escapeHtml(created)}</td></tr>
        <tr><td style="padding:4px 8px;color:var(--slate-500)">Archived</td><td style="padding:4px 8px">${escapeHtml(archived)}</td></tr>
      </table>
    `;

    if (r.steps && r.steps.length > 0) {
      stepsDiv.innerHTML = '<div style="padding:4px 0">' + r.steps.map((s, i) => {
        const time = s.time ? new Date(s.time).toLocaleString() : '-';
        return `<div style="padding:6px 12px;border-left:2px solid var(--indigo-200);margin-bottom:4px">
          <strong>Step ${i + 1}</strong>
          <span style="font-size:12px;color:var(--slate-500);margin-left:8px">${escapeHtml(time)}</span>
          <span style="font-size:11px;color:var(--slate-400);margin-left:8px;font-family:var(--font-mono)">${escapeHtml(s.path || '')}</span>
        </div>`;
      }).join('') + '</div>';
    } else {
      stepsDiv.textContent = 'No step history recorded.';
    }
  } catch (err) {
    info.textContent = 'Error: ' + err.message;
  }
}

async function continueExecutionRecord(sessionId) {
  try {
    const res = await fetch('/api/browser/session/execution-record/' + sessionId);
    if (!res.ok) throw new Error('Record not found');
    const record = await res.json();

    const createRes = await fetch('/api/browser/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: record.model || undefined }),
    });
    if (!createRes.ok) throw new Error('Failed to create session');
    const newSession = await createRes.json();

    document.querySelector('.tab-btn[data-tab="explore"]').click();

    const exploreTask = document.getElementById('exploreTask');
    const prefix = record.steps?.length > 0
      ? `[Continuing from archived session ${sessionId.slice(0, 8)}..., previously completed ${record.stepIndex} steps]\n\n`
      : '';
    exploreTask.value = prefix + (exploreTask.value || '');

    alert(`New session created: ${newSession.sessionId.slice(0, 12)}...\nSwitch to AI Explore tab to send steps.\nModel: ${newSession.model}`);
  } catch (err) {
    alert('Failed to continue: ' + err.message);
  }
}

async function deleteExecutionRecord(sessionId) {
  if (!confirm('Permanently delete execution record ' + sessionId.slice(0, 12) + '...?')) return;
  try {
    const res = await fetch('/api/browser/session/execution-record/' + sessionId, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete failed');
    if (execRecordCurrentId === sessionId) {
      document.getElementById('execRecordDetailPanel').style.display = 'none';
      execRecordCurrentId = null;
    }
    loadExecutionRecords();
  } catch (err) {
    alert('Failed to delete: ' + err.message);
  }
}
