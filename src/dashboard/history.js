// History Management
// Extracted from test-dashboard.js (loadHistory, viewHistory, downloadHistory, deleteHistory)

import { formatTime } from './utils.js';
import { escapeHtml } from './swagger-api.js';
import { pipelineState, displayGeneratedScript } from './script-pipeline.js';

export function initHistory() {
  // History loads on tab switch; no dedicated refresh button needed.
}

export async function loadHistory() {
  const loading = document.getElementById('historyLoading');
  const empty = document.getElementById('historyEmpty');
  const list = document.getElementById('historyList');
  const body = document.getElementById('historyBody');

  loading.style.display = 'block';
  empty.style.display = 'none';
  list.style.display = 'none';

  try {
    const res = await fetch('/api/test/history');
    const data = await res.json();
    loading.style.display = 'none';

    if (!data.length) {
      empty.style.display = 'block';
      return;
    }

    list.style.display = 'block';
    body.innerHTML = data.map(r => `
      <tr style="border-bottom:1px solid var(--slate-100)">
        <td style="padding:8px;font-family:var(--font-mono);font-size:11px">${escapeHtml(r.fileName)}</td>
        <td style="padding:8px;color:var(--slate-600)">${escapeHtml(r.description || '').slice(0, 40)}</td>
        <td style="padding:8px;color:var(--slate-400)">${r.stepCount || 0}</td>
        <td style="padding:8px;color:var(--slate-400);font-size:11px">${formatTime(r.createdAt)}</td>
        <td style="padding:8px;text-align:right">
          <button class="btn btn-outline btn-sm hist-view" data-id="${r.testId}" style="margin-right:4px">查看</button>
          <button class="btn btn-outline btn-sm hist-dl" data-id="${r.testId}" data-file="${r.fileName}" style="margin-right:4px">下载</button>
          <button class="btn btn-outline btn-sm hist-del" data-id="${r.testId}" style="color:var(--red-500);border-color:var(--red-200)">删除</button>
        </td>
      </tr>
    `).join('');

    // Bind history buttons
    body.querySelectorAll('.hist-view').forEach(b => b.addEventListener('click', () => viewHistory(b.dataset.id)));
    body.querySelectorAll('.hist-dl').forEach(b => b.addEventListener('click', () => downloadHistory(b.dataset.id, b.dataset.file)));
    body.querySelectorAll('.hist-del').forEach(b => b.addEventListener('click', () => deleteHistory(b.dataset.id)));
  } catch (err) {
    loading.style.display = 'none';
    empty.style.display = 'block';
    empty.innerHTML = '<p style="font-size:13px;color:var(--red-400)">加载失败: ' + err.message + '</p>';
  }
}

async function viewHistory(testId) {
  try {
    const res = await fetch('/api/test/history/' + testId);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    // Switch to generate tab and show the script
    document.querySelector('.tab-btn[data-tab="gen"]').click();
    pipelineState.currentTestId = data.testId;
    pipelineState.currentFileName = data.fileName;
    document.getElementById('genDesc').value = data.description || '';
    document.getElementById('genUrl').value = data.url || '';
    displayGeneratedScript(data);
    document.getElementById('genStatus').textContent = `📄 已加载 ${data.fileName}`;
  } catch (err) {
    alert('查看失败: ' + err.message);
  }
}

async function downloadHistory(testId, fileName) {
  try {
    const res = await fetch('/api/test/history/' + testId);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const blob = new Blob([data.script || ''], { type: 'application/javascript' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName || 'test-script.js';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    alert('下载失败: ' + err.message);
  }
}

async function deleteHistory(testId) {
  if (!confirm('确定删除这条记录？')) return;
  try {
    const res = await fetch('/api/test/history/' + testId, { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json()).error || 'Delete failed');
    loadHistory();
  } catch (err) {
    alert('删除失败: ' + err.message);
  }
}
