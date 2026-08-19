/**
 * Pending (local, not-yet-uploaded) screenshots board for /api/docs.
 * Data: GET /api/v2/screenshots/pending
 * Actions: 一键上传全部 (POST /api/v2/screenshots/pending/upload)
 *          单行上传 (POST /api/v2/screenshots/:id/upload)
 *          删除 (DELETE /api/v2/screenshots/:id)
 *
 * These endpoints return plain JSON (no { code, data } envelope), so apiJson
 * returns the parsed body as-is.
 */
const $ = (sel, el = document) => el.querySelector(sel);

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Unwrap v2 envelope { code, message, data } if present; else return parsed body. */
async function apiJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    if (!res.ok) throw new Error(text || res.statusText);
    throw new Error('Invalid JSON response');
  }
  if (parsed && typeof parsed === 'object' && 'code' in parsed && 'data' in parsed) {
    if (Number(parsed.code) !== 200) {
      const extra = parsed.data?.error || parsed.data?.message;
      throw new Error(extra || parsed.message || `code ${parsed.code}`);
    }
    return parsed.data;
  }
  if (!res.ok) {
    throw new Error(parsed?.error || parsed?.message || res.statusText);
  }
  return parsed;
}

function formatBytes(n) {
  const n0 = Number(n) || 0;
  if (n0 < 1024) return `${n0} B`;
  if (n0 < 1024 * 1024) return `${(n0 / 1024).toFixed(1)} KB`;
  return `${(n0 / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDateTime(val) {
  if (!val) return '—';
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return escapeHtml(String(val));
  return d.toLocaleString();
}

const KIND_LABEL = {
  before: '步骤前',
  after: '步骤后',
  phase_highlight: '阶段高亮',
};

function kindBadge(kind) {
  const label = KIND_LABEL[kind] || escapeHtml(kind || '—');
  return `<span class="ps-badge ps-badge-${escapeHtml(kind || 'unknown')}">${label}</span>`;
}

function renderRow(item) {
  const id = Number(item.id);
  const retry = Number(item.retryCount) || 0;
  const retryTag = retry > 0
    ? `<span class="ps-muted" title="已重试 ${retry} 次">重试 ${retry}</span>`
    : '<span class="ps-muted">—</span>';
  const traj = item.trajectoryId != null ? `#${item.trajectoryId}` : '—';
  const step = item.trajectoryStepId != null
    ? `步骤 #${item.trajectoryStepId}`
    : (item.trajectoryPhaseId != null ? `阶段 #${item.trajectoryPhaseId}` : '—');
  const size = formatBytes(item.fileSize);
  const mime = escapeHtml(item.mimeType || 'image/png');

  return `
    <tr class="ps-row" data-id="${id}">
      <td><code>#${id}</code></td>
      <td>${kindBadge(item.kind)}</td>
      <td class="ps-traj"><code>${escapeHtml(traj)}</code> <span class="ps-muted">${escapeHtml(step)}</span></td>
      <td><code class="ps-mono">${mime}</code></td>
      <td class="ps-muted">${escapeHtml(size)}</td>
      <td class="ps-muted">${retryTag}</td>
      <td class="ps-muted">${formatDateTime(item.lastRetryAt)}</td>
      <td class="ps-muted">${formatDateTime(item.createdAt)}</td>
      <td class="ps-actions">
        <button type="button" class="btn ps-btn" data-act="upload-one" data-id="${id}">上传</button>
        <a class="btn ps-btn ps-btn-link" target="_blank" rel="noopener"
           href="/api/v2/screenshots/${id}/image">预览</a>
        <button type="button" class="btn ps-btn ps-btn-danger" data-act="delete" data-id="${id}">删除</button>
      </td>
    </tr>
  `;
}

/**
 * @param {HTMLElement} wrap
 */
export function mountPendingScreenshots(wrap) {
  wrap.innerHTML = `
    <h2 class="docs-section-title">待上传截图</h2>
    <p class="docs-section-desc">尚未上传到 MinIO 的本地暂存截图（<code>storage_type='local'</code>，文件在 <code>tmp/pending-screenshots/</code>）。数据来自 <code>GET /api/v2/screenshots/pending</code>。「一键上传」调用 <code>POST /api/v2/screenshots/pending/upload</code>，立即把全部待传项推送到 MinIO 并更新数据库；后台每 ${Math.round((Number(import.meta.env?.SCREENSHOT_RETRY_INTERVAL_MS) || 180000) / 60000)} 分钟也会自动重试一次。</p>
    <div class="mon-panel ps-panel">
      <div class="mon-toolbar">
        <button type="button" class="btn btn-primary ps-upload-all">一键上传全部</button>
        <button type="button" class="btn mon-refresh">刷新</button>
        <label class="mon-check"><input type="checkbox" class="ps-auto" /> 每 5s 自动刷新</label>
        <span class="mon-summary ps-summary mon-muted">—</span>
      </div>
      <div class="mon-status ps-status" hidden></div>
      <div class="ps-body"><div class="mon-muted">加载中…</div></div>
    </div>
  `;

  const body = $('.ps-body', wrap);
  const statusEl = $('.ps-status', wrap);
  const summary = $('.ps-summary', wrap);
  let timer = null;
  let lastList = null;
  let busy = false;

  function setStatus(msg, isErr = false) {
    if (!msg) {
      statusEl.hidden = true;
      statusEl.textContent = '';
      return;
    }
    statusEl.hidden = false;
    statusEl.className = `mon-status ps-status ${isErr ? 'mon-status-err' : 'mon-status-ok'}`;
    statusEl.textContent = msg;
  }

  function paint() {
    const list = lastList || [];
    summary.textContent = list.length ? `待上传 ${list.length} 项` : '无待上传项';
    if (!list.length) {
      body.innerHTML = `
        <div class="ps-empty">
          <div class="mon-muted">没有待上传的截图 🎉（MinIO 已配置，新截图会直接上传）</div>
        </div>`;
      return;
    }
    body.innerHTML = `
      <div class="mon-table-wrap">
        <table class="mon-table ps-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>类型</th>
              <th>归属</th>
              <th>MIME</th>
              <th>大小</th>
              <th>重试</th>
              <th>上次重试</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>${list.map(renderRow).join('')}</tbody>
        </table>
      </div>`;
  }

  async function refresh() {
    if (busy) return;
    try {
      const data = await apiJson('/api/v2/screenshots/pending');
      lastList = Array.isArray(data) ? data : [];
      paint();
    } catch (err) {
      setStatus(`刷新失败：${err.message}`, true);
      body.innerHTML = `<div class="mon-muted">无法加载（控面是否已启动？）</div>`;
    }
  }

  async function uploadAll() {
    if (busy) return;
    const count = (lastList || []).length;
    if (!count) {
      setStatus('没有待上传项');
      return;
    }
    if (!window.confirm(`确认把 ${count} 项待上传截图全部推送到 MinIO（bucket: ${escapeHtml('uara-step-phase-picture')}）？`)) return;
    busy = true;
    const btn = $('.ps-upload-all', wrap);
    if (btn) { btn.disabled = true; btn.textContent = '上传中…'; }
    setStatus('正在上传…');
    try {
      const summary2 = await apiJson('/api/v2/screenshots/pending/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const s = summary2 || {};
      setStatus(`完成：成功 ${s.uploaded ?? 0} · 失败 ${s.failed ?? 0} · 跳过 ${s.skipped ?? 0} · 扫描 ${s.scanned ?? 0}`);
      await refresh();
    } catch (err) {
      setStatus(`一键上传失败：${err.message}`, true);
    } finally {
      busy = false;
      if (btn) { btn.disabled = false; btn.textContent = '一键上传全部'; }
    }
  }

  async function uploadOne(id) {
    if (busy) return;
    busy = true;
    setStatus(`上传 #${id} 中…`);
    try {
      const result = await apiJson(`/api/v2/screenshots/${id}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (result?.status === 'uploaded') {
        setStatus(`#${id} 已上传到 MinIO`);
      } else if (result?.status === 'not_pending') {
        setStatus(`#${id} 不是待上传项（可能已上传）`);
      } else if (result?.status === 'not_found') {
        setStatus(`#${id} 不存在`, true);
      }
      await refresh();
    } catch (err) {
      setStatus(`#${id} 上传失败：${err.message}`, true);
    } finally {
      busy = false;
    }
  }

  async function deleteOne(id) {
    if (busy) return;
    if (!window.confirm(`确认删除截图 #${id}？该操作不可恢复（同时删除本地暂存文件和数据库行）。`)) return;
    busy = true;
    setStatus(`删除 #${id} 中…`);
    try {
      await apiJson(`/api/v2/screenshots/${id}`, { method: 'DELETE' });
      setStatus(`#${id} 已删除`);
      await refresh();
    } catch (err) {
      setStatus(`#${id} 删除失败：${err.message}`, true);
    } finally {
      busy = false;
    }
  }

  wrap.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const id = Number(btn.dataset.id);
    if (act === 'upload-one' && Number.isFinite(id)) uploadOne(id);
    if (act === 'delete' && Number.isFinite(id)) deleteOne(id);
  });

  $('.ps-upload-all', wrap)?.addEventListener('click', () => uploadAll());
  $('.mon-refresh', wrap)?.addEventListener('click', () => refresh());
  $('.ps-auto', wrap)?.addEventListener('change', (e) => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (e.target.checked) {
      timer = setInterval(() => refresh(), 5000);
    }
  });

  refresh();
}
