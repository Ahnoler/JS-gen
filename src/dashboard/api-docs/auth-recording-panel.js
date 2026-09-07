/**
 * Auth recording (login/logout) live panel for /api/docs.
 * Data: GET/POST /api/v2/systems/{id}/auth-recording · GET /api/v2/systems · GET /api/v2/systems/{id}/accounts
 * Actions: 触发/重录 · 每 5s 自动轮询（pending/running 时）· 账密变更提示
 */

/**
 * A DOM element or document used as query scope.
 * @typedef {object} DomRoot
 * @property {string} [tagName] element tag name (document has none)
 */

/**
 * Query a single element within a root scope (document by default).
 * @param {string} sel CSS selector
 * @param {DomRoot} [el] root scope to query within (defaults to document)
 * @returns {DomRoot|null} first matching element or null
 */
const $ = (sel, el = document) => el.querySelector(sel);

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Unwrap v2 envelope { code, message, data } (same semantics as slot-monitor).
 * @param {string} url fetch target
 * @param {object} [options] fetch options (defaults to {})
 * @returns {Promise<object|null>} unwrapped data (envelope data, or parsed body)
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
  if (!res.ok) {
    throw new Error(parsed?.error || parsed?.message || res.statusText);
  }
  return parsed;
}

/**
 * Format a timestamp as 'YYYY-MM-DD HH:mm:ss' local time (or '—' when unparsable).
 * @param {Date|string|number|null} v timestamp value (Date / ISO string / epoch ms)
 * @returns {string} formatted local time or '—' when unparsable
 */
function fmtTime(v) {
  if (v == null) return '—';
  const t = v instanceof Date ? v.getTime() : Date.parse(String(v));
  if (!Number.isFinite(t)) return String(v);
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const JOB_STATUS_BADGE = {
  pending: 'ar-badge ar-badge-pending',
  running: 'ar-badge ar-badge-running',
  success: 'ar-badge ar-badge-success',
  failed: 'ar-badge ar-badge-failed',
};

const JOB_STATUS_TEXT = {
  pending: '排队中',
  running: '录制中',
  success: '成功',
  failed: '失败',
};

/**
 * Render one auth trajectory summary line.
 * @param {string} label display label
 * @param {object|null} traj trajectory summary ({ id, recordStatus, stepCount, authKind })
 * @returns {string} html
 */
function trajLine(label, traj) {
  if (!traj) return `<div class="ar-traj-row"><span class="ar-traj-label">${escapeHtml(label)}</span><span class="mon-muted">—</span></div>`;
  return `
    <div class="ar-traj-row">
      <span class="ar-traj-label">${escapeHtml(label)}</span>
      <code class="mon-mono">#${escapeHtml(String(traj.id))}</code>
      <span class="ar-badge ar-badge-${escapeHtml(String(traj.recordStatus || 'unknown'))}">${escapeHtml(String(traj.recordStatus || 'unknown'))}</span>
      <span class="mon-muted">${escapeHtml(String(traj.stepCount ?? 0))} 步</span>
    </div>
  `;
}

/**
 * Mount the auth-recording panel into the given wrapper element.
 * @param {DomRoot} wrap container element to render the panel into
 * @returns {void}
 */
export function mountAuthRecordingPanel(wrap) {
  wrap.innerHTML = `
    <h2 class="docs-section-title">登录/登出录制 · 操作面板</h2>
    <p class="docs-section-desc">选择系统 → 触发/重录（登录 + 登出两段式演练录制，fire-and-forget）→ pending/running 时每 5s 自动轮询状态。成功后自动沉淀 login/logout 组件；账密在最近一次成功录制之后被修改过会给出重录提示。交易列表（<code>GET /api/v2/trajectories</code>）行内 <code>authKind</code>（login/logout）可用于渲染「登录/登出」徽标。</p>
    <div class="mon-panel ar-panel">
      <div class="mon-toolbar">
        <label class="mon-label">系统
          <select class="ar-system">
            <option value="">加载中…</option>
          </select>
        </label>
        <label class="mon-label">登录账号
          <select class="ar-account">
            <option value="">默认（第一个账号）</option>
          </select>
        </label>
        <button type="button" class="btn btn-primary ar-trigger">录制登录/登出</button>
        <button type="button" class="btn mon-refresh ar-refresh">刷新状态</button>
        <label class="mon-check"><input type="checkbox" class="ar-auto" checked /> 每 5s 自动刷新</label>
        <span class="mon-summary mon-muted ar-summary"></span>
      </div>
      <div class="mon-status ar-status" hidden></div>
      <div class="ar-alert" hidden></div>
      <div class="ar-body"><div class="mon-muted">选择系统后加载状态…</div></div>
    </div>
  `;

  const systemSel = $('.ar-system', wrap);
  const accountSelEl = $('.ar-account', wrap);
  const trigger = $('.ar-trigger', wrap);
  const statusEl = $('.ar-status', wrap);
  const alertEl = $('.ar-alert', wrap);
  const summary = $('.ar-summary', wrap);
  const body = $('.ar-body', wrap);
  const autoBox = $('.ar-auto', wrap);
  let timer = null;
  let lastJob = null;

  function setStatus(msg, isErr = false) {
    if (!msg) {
      statusEl.hidden = true;
      statusEl.textContent = '';
      return;
    }
    statusEl.hidden = false;
    statusEl.className = `mon-status ar-status ${isErr ? 'mon-status-err' : 'mon-status-ok'}`;
    statusEl.textContent = msg;
  }

  function setAlert(html) {
    if (!html) {
      alertEl.hidden = true;
      alertEl.innerHTML = '';
      return;
    }
    alertEl.hidden = false;
    alertEl.innerHTML = html;
  }

  function stopTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function restartAutoPoll() {
    stopTimer();
    if (!autoBox?.checked) return;
    if (!lastJob || (lastJob.status !== 'pending' && lastJob.status !== 'running')) return;
    timer = setInterval(() => refresh(), 5000);
  }

  function updateSummary() {
    const s = lastJob?.status;
    summary.textContent = lastJob
      ? `最近 job #${lastJob.id} · ${JOB_STATUS_TEXT[s] || s || '—'}`
      : '该系统从未触发过自动录制';
  }

  /**
   * 账密变更提示：最近 success job 之后任一账号 updated_at 更新 → 建议重录。
   * @param {object|null} job job entity（含 updatedAt/status）
   * @param {object[]} accounts account entities（含 updatedAt）
   * @returns {string} html ('' = no alert)
   */
  function passwordChangedAlert(job, accounts) {
    if (!job || job.status !== 'success') return '';
    const jobTs = job.updatedAt ?? job.updated_at;
    if (jobTs == null) return '';
    const jobTime = jobTs instanceof Date ? jobTs.getTime() : Date.parse(String(jobTs));
    if (!Number.isFinite(jobTime)) return '';
    const changed = (accounts || []).some((a) => {
      const ts = a?.updatedAt ?? a?.updated_at;
      if (ts == null) return false;
      const t = ts instanceof Date ? ts.getTime() : Date.parse(String(ts));
      return Number.isFinite(t) && t > jobTime;
    });
    return changed
      ? '<div class="ar-warn">⚠ 账密已变更，建议重录（最近一次成功录制早于账号修改时间）</div>'
      : '';
  }

  function paintStatus(payload) {
    const job = payload?.job || null;
    lastJob = job;
    if (!job) {
      body.innerHTML = '<div class="mon-muted">该系统从未触发过自动录制 — 点「录制登录/登出」开始。</div>';
      setAlert('');
      updateSummary();
      restartAutoPoll();
      return;
    }
    const badgeCls = JOB_STATUS_BADGE[job.status] || 'ar-badge ar-badge-unknown';
    const errHtml = job.error
      ? `<pre class="ep-pre ar-error">${escapeHtml(String(job.error))}</pre>`
      : '';
    body.innerHTML = `
      <div class="ar-card">
        <div class="ar-job-row">
          <span class="${badgeCls}">${escapeHtml(job.status)} · ${escapeHtml(JOB_STATUS_TEXT[job.status] || '')}</span>
          <code class="mon-mono">job #${escapeHtml(String(job.id))}</code>
          <span class="mon-muted">账号 #${escapeHtml(String(job.accountId ?? '—'))}</span>
        </div>
        <div class="ar-job-row ar-job-meta">
          <span class="mon-muted">创建 ${escapeHtml(fmtTime(job.createdAt ?? job.created_at))}</span>
          <span class="mon-muted">更新 ${escapeHtml(fmtTime(job.updatedAt ?? job.updated_at))}</span>
        </div>
        ${errHtml}
        <div class="ar-traj-list">
          ${trajLine('登录', payload?.loginTrajectory)}
          ${trajLine('登出', payload?.logoutTrajectory)}
        </div>
      </div>
    `;
    updateSummary();
    restartAutoPoll();
  }

  async function refresh() {
    const systemId = systemSel.value;
    if (!systemId) return;
    try {
      const [status, accounts] = await Promise.all([
        apiJson(`/api/v2/systems/${encodeURIComponent(systemId)}/auth-recording`),
        apiJson(`/api/v2/systems/${encodeURIComponent(systemId)}/accounts`).catch(() => []),
      ]);
      paintStatus(status);
      setAlert(passwordChangedAlert(lastJob, Array.isArray(accounts) ? accounts : []));
    } catch (err) {
      setStatus(`刷新失败：${err.message}`, true);
    }
  }

  async function loadSystems() {
    try {
      const systems = await apiJson('/api/v2/systems');
      const list = Array.isArray(systems) ? systems : [];
      systemSel.innerHTML = '<option value="">— 选择系统 —</option>'
        + list.map((s) => `<option value="${escapeHtml(String(s.id))}">${escapeHtml(`#${s.id} ${s.name || ''}`)}</option>`).join('');
      const first = list[0];
      if (first) {
        systemSel.value = String(first.id);
        await onSystemChange();
      } else {
        systemSel.innerHTML = '<option value="">暂无系统</option>';
      }
    } catch (err) {
      systemSel.innerHTML = '<option value="">加载失败</option>';
      setStatus(`系统列表加载失败：${err.message}`, true);
    }
  }

  async function onSystemChange() {
    stopTimer();
    lastJob = null;
    setAlert('');
    const systemId = systemSel.value;
    if (!systemId) {
      body.innerHTML = '<div class="mon-muted">选择系统后加载状态…</div>';
      accountSelEl.innerHTML = '<option value="">默认（第一个账号）</option>';
      return;
    }
    body.innerHTML = '<div class="mon-muted">加载中…</div>';
    try {
      const accounts = await apiJson(`/api/v2/systems/${encodeURIComponent(systemId)}/accounts`).catch(() => []);
      const list = Array.isArray(accounts) ? accounts : [];
      accountSelEl.innerHTML = '<option value="">默认（第一个账号）</option>'
        + list.map((a) => `<option value="${escapeHtml(String(a.id))}">${escapeHtml(`#${a.id} ${a.name || a.account || ''}`)}</option>`).join('');
    } catch { /* accounts optional */ }
    await refresh();
  }

  async function doTrigger() {
    const systemId = systemSel.value;
    if (!systemId) {
      setStatus('请先选择系统', true);
      return;
    }
    const bodyObj = {};
    if (accountSelEl.value) bodyObj.accountId = Number(accountSelEl.value);
    trigger.disabled = true;
    trigger.textContent = '触发中…';
    setStatus('');
    try {
      const result = await apiJson(`/api/v2/systems/${encodeURIComponent(systemId)}/auth-recording`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyObj),
      });
      setStatus(`已触发 job #${result?.jobId ?? '—'}，每 5s 轮询状态中…`);
      await refresh();
    } catch (err) {
      setStatus(`触发失败：${err.message}`, true);
      if (/409|already/.test(err.message)) {
        setStatus('已有进行中的录制任务（409）— 等待其结束或刷新状态', true);
      }
    } finally {
      trigger.disabled = false;
      trigger.textContent = '录制登录/登出';
    }
  }

  systemSel.addEventListener('change', () => onSystemChange());
  trigger.addEventListener('click', () => doTrigger());
  $('.ar-refresh', wrap)?.addEventListener('click', () => refresh());
  autoBox?.addEventListener('change', () => restartAutoPoll());

  loadSystems();
}
