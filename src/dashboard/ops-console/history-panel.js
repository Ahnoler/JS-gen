/* global document, fetch */
import { renderLogCards } from './log-cards.js';

/**
 * A DOM element or document used as query scope.
 * @typedef {object} DomRoot
 * @property {string} [tagName] element tag name (document has none)
 */

/**
 * Query a single element within a root scope.
 * @param {string} sel CSS selector
 * @param {DomRoot} [el] root scope
 * @returns {DomRoot|null} first match or null
 */
const $ = (sel, el = document) => el.querySelector(sel);

/**
 * Escape HTML for safe interpolation.
 * @param {string} str raw string
 * @returns {string} escaped HTML
 */
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Unwrap v2 envelope { code, message, data }.
 * @param {string} url fetch target
 * @param {object} [options] fetch options
 * @returns {Promise<object|null>} unwrapped data
 */
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
  if (!res.ok) throw new Error(parsed?.error || parsed?.message || res.statusText);
  return parsed;
}

/**
 * Format a byte size for the history list.
 * @param {number} n byte count
 * @returns {string} short size
 */
function formatBytes(n) {
  const n0 = Number(n) || 0;
  if (n0 < 1024) return `${n0} B`;
  if (n0 < 1024 * 1024) return `${(n0 / 1024).toFixed(1)} KB`;
  return `${(n0 / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Format an ISO time for the history list.
 * @param {string} iso ISO timestamp
 * @returns {string} local time or em dash
 */
function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

/**
 * Mount the historical stderr browser: file list on the left, cards on the right.
 * @param {DomRoot} wrap container (#ops-panel-history)
 * @returns {void}
 */
export function mountHistoryPanel(wrap) {
  wrap.innerHTML = `
    <div class="ops-exec-layout">
      <div class="ops-exec-slots">
        <div class="ops-slot-panel">
          <div class="ops-toolbar">
            <button type="button" class="btn btn-primary ops-hist-refresh">刷新</button>
            <input type="search" class="ops-hist-filter" placeholder="筛选交易号或会话" />
            <span class="ops-summary ops-muted ops-hist-summary">—</span>
          </div>
          <div class="ops-status ops-hist-status" hidden></div>
          <div class="ops-node-list ops-hist-list"><div class="ops-muted">加载中…</div></div>
        </div>
      </div>
      <div class="ops-log-shell">
        <div class="ops-log-toolbar">
          <span class="ops-hist-current ops-muted">选择左侧一条历史日志</span>
        </div>
        <div class="ops-log ops-hist-log"></div>
      </div>
    </div>
  `;

  const listEl = $('.ops-hist-list', wrap);
  const statusEl = $('.ops-hist-status', wrap);
  const summary = $('.ops-hist-summary', wrap);
  const filterEl = $('.ops-hist-filter', wrap);
  const logEl = $('.ops-hist-log', wrap);
  const currentEl = $('.ops-hist-current', wrap);
  const followState = { stickToBottom: true };
  let files = [];
  let selectedId = '';

  /**
   * Show a status line on the history list.
   * @param {string} msg message
   * @param {boolean} [isErr] error styling
   * @returns {void}
   */
  function setStatus(msg, isErr = false) {
    if (!msg) {
      statusEl.hidden = true;
      statusEl.textContent = '';
      return;
    }
    statusEl.hidden = false;
    statusEl.className = `ops-status ops-hist-status ${isErr ? 'ops-status-err' : 'ops-status-ok'}`;
    statusEl.textContent = msg;
  }

  /**
   * Files matching the search box.
   * @returns {object[]} filtered history rows
   */
  function visibleFiles() {
    const q = (filterEl.value || '').trim().toLowerCase();
    if (!q) return files;
    return files.filter((file) => {
      const traj = file.trajectoryId != null ? String(file.trajectoryId) : '';
      const name = String(file.trajectoryName || '').toLowerCase();
      return file.sessionId.toLowerCase().includes(q)
        || String(file.sid || '').toLowerCase().includes(q)
        || traj.includes(q)
        || name.includes(q);
    });
  }

  /**
   * Render the sidebar list.
   * @returns {void}
   */
  function paint() {
    const rows = visibleFiles();
    summary.textContent = `${rows.length} / ${files.length}`;
    if (!rows.length) {
      listEl.innerHTML = '<div class="ops-muted ops-slot-empty">没有匹配的历史日志</div>';
      return;
    }
    listEl.innerHTML = rows.map((file) => {
      const title = file.trajectoryId != null
        ? `#${file.trajectoryId}${file.trajectoryName ? ` ${file.trajectoryName}` : ''}`
        : file.sid || file.sessionId;
      const selected = file.sessionId === selectedId ? ' ops-row-selected' : '';
      return `
        <article class="ops-slot ops-row-stderr ops-hist-item${selected}" data-session="${escapeHtml(file.sessionId)}">
          <div class="ops-slot-top">
            <strong>${escapeHtml(title)}</strong>
          </div>
          <div class="ops-slot-meta">${escapeHtml(formatTime(file.mtime))} · ${escapeHtml(formatBytes(file.bytes))}</div>
          <div class="ops-slot-meta">${escapeHtml(file.sid || file.sessionId)}</div>
        </article>
      `;
    }).join('');
  }

  /**
   * Load one session file into the log pane.
   * @param {string} sessionId agent session id
   * @returns {Promise<void>}
   */
  async function openFile(sessionId) {
    selectedId = sessionId;
    paint();
    const file = files.find((row) => row.sessionId === sessionId);
    const label = file?.trajectoryId != null
      ? `#${file.trajectoryId}${file.trajectoryName ? ` ${file.trajectoryName}` : ''}`
      : sessionId;
    currentEl.textContent = label;
    setStatus('读取日志…');
    try {
      const res = await fetch('/api/v2/recording/agent-stderr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, format: 'text' }),
      });
      const text = await res.text();
      if (!res.ok) {
        renderLogCards(logEl, text || `HTTP ${res.status}`, followState);
        setStatus(`读取失败 HTTP ${res.status}`, true);
        return;
      }
      renderLogCards(logEl, text || '(空日志)', followState);
      setStatus('');
    } catch (err) {
      setStatus(`读取失败：${err.message}`, true);
    }
  }

  /**
   * Reload the history index.
   * @returns {Promise<void>}
   */
  async function refresh() {
    setStatus('');
    try {
      const data = await apiJson('/api/v2/recording/agent-stderr/history');
      files = Array.isArray(data?.files) ? data.files : [];
      paint();
    } catch (err) {
      setStatus(`刷新失败：${err.message}`, true);
      listEl.innerHTML = '<div class="ops-muted">无法加载历史日志</div>';
    }
  }

  listEl.addEventListener('click', (e) => {
    const item = e.target.closest('.ops-hist-item');
    if (!item?.dataset.session) return;
    openFile(item.dataset.session);
  });
  $('.ops-hist-refresh', wrap)?.addEventListener('click', () => refresh());
  filterEl.addEventListener('input', () => paint());
  refresh();
}
