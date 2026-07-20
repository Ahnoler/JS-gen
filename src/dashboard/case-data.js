import { formatTime } from './utils.js';
import { escapeHtml } from './swagger-api.js';
import { readV2 } from './api-envelope.js';

export let caseDataCurrentId = null;

export function initCaseData() {
  document.getElementById('caseDataRefreshBtn').addEventListener('click', loadCaseDataHistory);
  document.getElementById('caseDataDetailCloseBtn').addEventListener('click', () => {
    document.getElementById('caseDataDetailPanel').style.display = 'none';
    caseDataCurrentId = null;
  });
}

export async function loadCaseDataHistory() {
  const loading = document.getElementById('caseDataLoading');
  const empty = document.getElementById('caseDataEmpty');
  const list = document.getElementById('caseDataList');
  const body = document.getElementById('caseDataBody');
  const detail = document.getElementById('caseDataDetailPanel');

  loading.style.display = 'block';
  empty.style.display = 'none';
  list.style.display = 'none';
  if (detail) detail.style.display = 'none';
  caseDataCurrentId = null;

  try {
    const res = await fetch('/api/v2/case-data?page=1&pageSize=100');
    const data = await readV2(res);
    loading.style.display = 'none';

    const rows = data.rows || data || [];
    if (!rows.length) {
      empty.style.display = 'block';
      return;
    }

    list.style.display = 'block';
    body.innerHTML = rows.map(r => {
      const recordId = r.recordId || '';
      const shortDesc = (r.description || '').slice(0, 60);
      return `
        <tr style="border-bottom:1px solid var(--slate-100)">
          <td style="padding:8px;font-family:var(--font-mono);font-size:11px;color:var(--indigo-600)" title="${escapeHtml(recordId)}">${escapeHtml(recordId.slice(0, 24))}...</td>
          <td style="padding:8px;color:var(--slate-600);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(r.description || '')}">${escapeHtml(shortDesc)}</td>
          <td style="padding:8px;color:var(--slate-500);font-size:12px">${r.keyCount ?? 0}</td>
          <td style="padding:8px;color:var(--slate-400);font-size:11px">${formatTime(r.createdAt)}</td>
          <td style="padding:8px;text-align:right;white-space:nowrap">
            <button class="btn btn-outline btn-sm cdata-view" data-id="${escapeHtml(recordId)}" style="margin-right:4px">View</button>
            <button class="btn btn-outline btn-sm cdata-import" data-id="${escapeHtml(recordId)}" style="margin-right:4px;color:var(--green-600);border-color:var(--green-300)">Import</button>
            <button class="btn btn-outline btn-sm cdata-del" data-id="${escapeHtml(recordId)}" style="color:var(--red-500);border-color:var(--red-200)">Delete</button>
          </td>
        </tr>`;
    }).join('');

    body.querySelectorAll('.cdata-view').forEach(b => b.addEventListener('click', () => viewCaseDataDetail(b.dataset.id)));
    body.querySelectorAll('.cdata-import').forEach(b => b.addEventListener('click', () => importCaseData(b.dataset.id)));
    body.querySelectorAll('.cdata-del').forEach(b => b.addEventListener('click', () => deleteCaseData(b.dataset.id)));
  } catch (err) {
    loading.style.display = 'none';
    empty.style.display = 'block';
    empty.innerHTML = '<p style="font-size:13px;color:var(--red-400)">Load failed: ' + err.message + '</p>';
  }
}

async function viewCaseDataDetail(recordId) {
  const detail = document.getElementById('caseDataDetailPanel');
  const idSpan = document.getElementById('caseDataDetailId');
  const info = document.getElementById('caseDataDetailInfo');
  const jsonPre = document.getElementById('caseDataDetailJson');

  caseDataCurrentId = recordId;
  idSpan.textContent = recordId;
  detail.style.display = '';
  jsonPre.textContent = '';

  try {
    const res = await fetch('/api/v2/case-data/' + encodeURIComponent(recordId));
    const data = await readV2(res);

    info.innerHTML = '<b>Keys:</b> ' + (data.keyCount || 0) +
      ' | <b>Created:</b> ' + formatTime(data.createdAt);

    const payload = data.rawJson
      || Object.fromEntries((data.entries || []).map(e => [
        e.fieldKey || e.field_key,
        e.fieldValue ?? e.field_value ?? null,
      ]));
    jsonPre.textContent = payload && Object.keys(payload).length
      ? JSON.stringify(payload, null, 2)
      : '(no data)';
  } catch (err) {
    document.getElementById('caseDataDetailSummary').textContent = 'Error: ' + err.message;
  }
}

async function importCaseData(recordId) {
  try {
    const res = await fetch('/api/v2/case-data/' + encodeURIComponent(recordId) + '/file');
    const data = await readV2(res);

    const input = document.getElementById('sessCaseDataFile');
    if (input) {
      input.value = data.filePath;
      input.dataset.recordId = recordId;
      window.alert('Case data imported: ' + recordId.slice(0, 16) + '... (' + data.filePath + ')');
    }
  } catch (err) {
    window.alert('Import failed: ' + err.message);
  }
}

async function deleteCaseData(recordId) {
  if (!confirm('Delete case data ' + recordId.slice(0, 20) + '...?')) return;
  try {
    const res = await fetch('/api/v2/case-data/' + encodeURIComponent(recordId), { method: 'DELETE' });
    await readV2(res);

    if (caseDataCurrentId === recordId) {
      document.getElementById('caseDataDetailPanel').style.display = 'none';
      caseDataCurrentId = null;
    }
    loadCaseDataHistory();
  } catch (err) {
    window.alert('Delete failed: ' + err.message);
  }
}
