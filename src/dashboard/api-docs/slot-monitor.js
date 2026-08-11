/**
 * Slot / executor occupancy monitor for /api/docs.
 * Data: GET /api/v2/executors + GET /api/v2/recording/agent-stderr/active
 * Actions: stream/detach · hard detach · paste-export stderr
 */
const $ = (sel, el = document) => el.querySelector(sel);

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Unwrap v2 envelope { code, message, data }. */
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

function shortUuid(u) {
  if (!u) return '—';
  const s = String(u);
  return s.length > 12 ? `${s.slice(0, 8)}…` : s;
}

/**
 * Merge executor node slots with /active stderr rows (+ live CDP ports).
 * @returns {{ nodes: object[], freeCount: number, occupiedCount: number }}
 */
function buildViewModel(executorsPayload, activePayload) {
  const nodes = Array.isArray(executorsPayload?.nodes) ? executorsPayload.nodes : [];
  const activeRows = Array.isArray(activePayload?.rows) ? activePayload.rows : [];
  const slotPorts = Array.isArray(activePayload?.slotPorts) ? activePayload.slotPorts : [];

  const portsByNode = new Map();
  for (const entry of slotPorts) {
    if (!entry?.executorNodeUuid) continue;
    const map = new Map();
    for (const s of entry.slots || []) {
      if (Number.isFinite(Number(s.slotIndex))) map.set(Number(s.slotIndex), s);
    }
    portsByNode.set(String(entry.executorNodeUuid), map);
  }

  const bySession = new Map();
  const byTraj = new Map();
  for (const row of activeRows) {
    if (row.sessionId) bySession.set(String(row.sessionId), row);
    if (row.trajectoryId != null) byTraj.set(Number(row.trajectoryId), row);
  }

  let freeCount = 0;
  let occupiedCount = 0;

  const enriched = nodes.map((node) => {
    const capacity = Math.max(0, Number(node.capacity) || 0);
    const leaseSlots = Array.isArray(node.slots) ? node.slots : [];
    const occupiedByIndex = new Map();
    const portMap = portsByNode.get(String(node.nodeUuid)) || new Map();

    for (const s of leaseSlots) {
      const idx = Number(s.slotIndex);
      if (!Number.isFinite(idx)) continue;
      occupiedByIndex.set(idx, s);
    }
    for (const row of activeRows) {
      const sameUuid = row.executorNodeUuid && row.executorNodeUuid === node.nodeUuid;
      const sameId = row.executorNodeId != null && Number(row.executorNodeId) === Number(node.id);
      if (!sameUuid && !sameId) continue;
      const idx = Number(row.slotIndex);
      if (!Number.isFinite(idx)) continue;
      if (!occupiedByIndex.has(idx)) {
        occupiedByIndex.set(idx, {
          slotIndex: idx,
          sessionId: row.sessionId,
          trajectoryId: row.trajectoryId,
          busy: true,
        });
      }
    }

    function resolveCdp(idx, sessionId, active) {
      if (active?.cdpPort != null) return Number(active.cdpPort);
      const live = portMap.get(Number(idx));
      if (live?.cdpPort != null) return Number(live.cdpPort);
      if (sessionId && bySession.get(String(sessionId))?.cdpPort != null) {
        return Number(bySession.get(String(sessionId)).cdpPort);
      }
      return null;
    }

    const slots = [];
    for (let i = 0; i < capacity; i += 1) {
      const lease = occupiedByIndex.get(i) || null;
      const live = portMap.get(i) || null;
      const active = (lease?.sessionId && bySession.get(String(lease.sessionId)))
        || (live?.sessionId && bySession.get(String(live.sessionId)))
        || (lease?.trajectoryId != null && byTraj.get(Number(lease.trajectoryId)))
        || null;
      const sessionId = active?.sessionId || lease?.sessionId || live?.sessionId || null;
      const occupied = !!(sessionId || lease?.trajectoryId || active);
      if (occupied) occupiedCount += 1;
      else freeCount += 1;
      slots.push({
        slotIndex: i,
        occupied,
        sessionId,
        sid: active?.sid || null,
        trajectoryId: active?.trajectoryId ?? lease?.trajectoryId ?? null,
        trajectoryName: active?.trajectoryName || null,
        recordStatus: active?.recordStatus || null,
        remoteStatus: active?.remoteStatus || null,
        remoteSessionId: active?.remoteSessionId ?? null,
        hasStderrLog: !!active?.hasStderrLog,
        busy: !!lease?.busy || !!live?.busy,
        cdpPort: resolveCdp(i, sessionId, active),
        activeRow: active,
      });
    }

    // Orphan occupied indexes beyond capacity (shouldn't happen often)
    for (const [idx, lease] of occupiedByIndex) {
      if (idx >= 0 && idx < capacity) continue;
      const active = (lease?.sessionId && bySession.get(String(lease.sessionId)))
        || (lease?.trajectoryId != null && byTraj.get(Number(lease.trajectoryId)))
        || null;
      occupiedCount += 1;
      const sessionId = active?.sessionId || lease?.sessionId || null;
      slots.push({
        slotIndex: idx,
        occupied: true,
        sessionId,
        sid: active?.sid || null,
        trajectoryId: active?.trajectoryId ?? lease?.trajectoryId ?? null,
        trajectoryName: active?.trajectoryName || null,
        recordStatus: active?.recordStatus || null,
        remoteStatus: active?.remoteStatus || null,
        remoteSessionId: active?.remoteSessionId ?? null,
        hasStderrLog: !!active?.hasStderrLog,
        busy: !!lease?.busy,
        cdpPort: resolveCdp(idx, sessionId, active),
        activeRow: active,
        overflow: true,
      });
    }

    slots.sort((a, b) => a.slotIndex - b.slotIndex);
    return {
      ...node,
      capacity,
      slots,
      occupiedSlots: slots.filter((s) => s.occupied).length,
      freeSlots: slots.filter((s) => !s.occupied).length,
    };
  });

  return { nodes: enriched, freeCount, occupiedCount, activeRows };
}

function statusBadge(remoteStatus, recordStatus, occupied) {
  if (!occupied) {
    return '<span class="mon-badge mon-badge-free">空闲</span>';
  }
  const rs = remoteStatus || 'occupied';
  const rec = recordStatus || '';
  let cls = 'mon-badge-busy';
  if (rs === 'active') cls = 'mon-badge-active';
  else if (rs === 'idle') cls = 'mon-badge-idle';
  return `<span class="mon-badge ${cls}">${escapeHtml(rs)}${rec ? ` · ${escapeHtml(rec)}` : ''}</span>`;
}

function renderSlotRow(node, slot) {
  const trajLabel = slot.trajectoryId != null
    ? `#${slot.trajectoryId}${slot.trajectoryName ? ` ${slot.trajectoryName}` : ''}`
    : '—';
  const actions = slot.occupied && slot.trajectoryId != null
    ? `
      <button type="button" class="btn mon-btn" data-act="stream-detach" data-tid="${slot.trajectoryId}">断开画面</button>
      <button type="button" class="btn mon-btn mon-btn-danger" data-act="detach" data-tid="${slot.trajectoryId}">释放浏览器</button>
      <button type="button" class="btn mon-btn" data-act="stderr" data-tid="${slot.trajectoryId}"
        data-session="${escapeHtml(slot.sessionId || '')}"
        data-sid="${escapeHtml(slot.sid || '')}"
        data-slot="${slot.slotIndex}">日志</button>
      <button type="button" class="btn mon-btn" data-act="clear-log" data-tid="${slot.trajectoryId}"
        data-session="${escapeHtml(slot.sessionId || '')}"
        data-sid="${escapeHtml(slot.sid || '')}"
        title="仅清空该 session 的控面 stderr 文件">清空日志</button>
    `
    : '<span class="mon-muted">—</span>';

  return `
    <tr class="${slot.occupied ? 'mon-row-occ' : 'mon-row-free'}" data-node="${escapeHtml(node.nodeUuid)}" data-slot="${slot.slotIndex}">
      <td><code>slot ${slot.slotIndex}</code>${slot.overflow ? ' <span class="mon-muted">(溢)</span>' : ''}</td>
      <td>${statusBadge(slot.remoteStatus, slot.recordStatus, slot.occupied)}</td>
      <td class="mon-traj">${escapeHtml(trajLabel)}</td>
      <td><code class="mon-mono">${escapeHtml(shortUuid(slot.sessionId))}</code></td>
      <td><code class="mon-mono">${slot.cdpPort != null ? escapeHtml(String(slot.cdpPort)) : '—'}</code></td>
      <td class="mon-actions">${actions}</td>
    </tr>
  `;
}

function renderNodeCard(node, filter) {
  let slots = node.slots || [];
  if (filter === 'occupied') slots = slots.filter((s) => s.occupied);
  if (filter === 'free') slots = slots.filter((s) => !s.occupied);
  if (!slots.length && filter !== 'all') {
    return '';
  }

  const conn = node.connected ? '在线' : '离线';
  const connCls = node.connected ? 'mon-online' : 'mon-offline';

  return `
    <article class="mon-node" data-node-uuid="${escapeHtml(node.nodeUuid)}">
      <header class="mon-node-head">
        <div>
          <strong>${escapeHtml(node.name || node.nodeUuid)}</strong>
          <span class="mon-muted"> · ${escapeHtml(shortUuid(node.nodeUuid))}</span>
        </div>
        <div class="mon-node-meta">
          <span class="${connCls}">${conn}</span>
          <span class="mon-muted">${escapeHtml(node.status || '')}</span>
          <span>占用 <strong>${node.occupiedSlots}</strong> / 容量 <strong>${node.capacity}</strong>（空闲 ${node.freeSlots}）</span>
        </div>
      </header>
      <div class="mon-table-wrap">
        <table class="mon-table">
          <thead>
            <tr>
              <th>槽位</th>
              <th>状态</th>
              <th>交易</th>
              <th>session</th>
              <th title="Chrome remote-debugging 端口（执行机本地）">CDP</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${slots.map((s) => renderSlotRow(node, s)).join('') || '<tr><td colspan="6" class="mon-muted">无匹配槽位</td></tr>'}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

/**
 * @param {HTMLElement} wrap
 */
export function mountSlotMonitor(wrap) {
  wrap.innerHTML = `
    <h2 class="docs-section-title">执行机监视</h2>
    <p class="docs-section-desc">按执行机（路由）拆分槽位：谁占用、哪笔交易、CDP 端口、能否断开画面或释放浏览器。数据来自 <code>/api/v2/executors</code> 与 <code>/api/v2/recording/agent-stderr/active</code>（含实时 <code>slotPorts</code>）。「清空日志」只删该 session 的控面 <code>logs/agent-stderr/{sessionId}.log</code>。</p>
    <div class="mon-panel">
      <div class="mon-toolbar">
        <button type="button" class="btn btn-primary mon-refresh">刷新</button>
        <label class="mon-check"><input type="checkbox" class="mon-auto" /> 每 5s 自动刷新</label>
        <label class="mon-check"><input type="checkbox" class="mon-show-offline" /> 显示离线执行机</label>
        <label class="mon-label">节点
          <select class="mon-filter-node">
            <option value="all">全部</option>
          </select>
        </label>
        <label class="mon-label">槽位
          <select class="mon-filter-slot">
            <option value="all">全部</option>
            <option value="occupied">仅占用</option>
            <option value="free">仅空闲</option>
          </select>
        </label>
        <span class="mon-summary mon-muted">—</span>
      </div>
      <div class="mon-status" hidden></div>
      <div class="mon-body"><div class="mon-muted">加载中…</div></div>
      <details class="mon-log-box" hidden>
        <summary class="mon-log-summary">
          <span>最近一次 stderr 导出</span>
          <button type="button" class="btn mon-btn mon-copy-log" title="复制日志全文">复制</button>
          <button type="button" class="btn mon-btn mon-clear-last-log" title="清空刚才查看的 session 日志文件">清空该会话日志</button>
        </summary>
        <pre class="ep-pre mon-log-pre"></pre>
      </details>
    </div>
  `;

  const body = $('.mon-body', wrap);
  const statusEl = $('.mon-status', wrap);
  const summary = $('.mon-summary', wrap);
  const nodeSel = $('.mon-filter-node', wrap);
  const slotSel = $('.mon-filter-slot', wrap);
  const showOffline = $('.mon-show-offline', wrap);
  const logBox = $('.mon-log-box', wrap);
  const logPre = $('.mon-log-pre', wrap);
  let timer = null;
  let lastModel = null;
  /** sessionId of last successful stderr export (for panel「清空该会话日志」). */
  let lastLogSessionId = '';

  function setStatus(msg, isErr = false) {
    if (!msg) {
      statusEl.hidden = true;
      statusEl.textContent = '';
      return;
    }
    statusEl.hidden = false;
    statusEl.className = `mon-status ${isErr ? 'mon-status-err' : 'mon-status-ok'}`;
    statusEl.textContent = msg;
  }

  function isNodeOnline(node) {
    if (node.connected === true) return true;
    if (node.connected === false) return false;
    const st = String(node.status || '').toLowerCase();
    return st === 'online' || st === 'draining';
  }

  function visibleNodes() {
    if (!lastModel) return [];
    let nodes = lastModel.nodes;
    if (!showOffline?.checked) {
      nodes = nodes.filter((n) => isNodeOnline(n));
    }
    return nodes;
  }

  function fillNodeFilter(nodes) {
    const cur = nodeSel.value || 'all';
    nodeSel.innerHTML = '<option value="all">全部</option>'
      + nodes.map((n) => `<option value="${escapeHtml(n.nodeUuid)}">${escapeHtml(n.name || n.nodeUuid)}</option>`).join('');
    if ([...nodeSel.options].some((o) => o.value === cur)) nodeSel.value = cur;
    else nodeSel.value = 'all';
  }

  function paint() {
    if (!lastModel) return;
    const onlineOrAll = visibleNodes();
    fillNodeFilter(onlineOrAll);
    const nodeFilter = nodeSel.value || 'all';
    const slotFilter = slotSel.value || 'all';
    const paintNodes = nodeFilter === 'all'
      ? onlineOrAll
      : onlineOrAll.filter((n) => n.nodeUuid === nodeFilter);
    const occ = paintNodes.reduce((n, node) => n + (node.occupiedSlots || 0), 0);
    const free = paintNodes.reduce((n, node) => n + (node.freeSlots || 0), 0);
    const hiddenOffline = lastModel.nodes.length - onlineOrAll.length;
    summary.textContent = `占用 ${occ} · 空闲 ${free} · 节点 ${paintNodes.length}`
      + (hiddenOffline > 0 ? ` · 已隐藏离线 ${hiddenOffline}` : '');
    body.innerHTML = paintNodes.map((n) => renderNodeCard(n, slotFilter)).filter(Boolean).join('')
      || '<div class="mon-muted">没有可显示的槽位（换筛选条件、勾选「显示离线执行机」或刷新）</div>';
  }

  async function refresh() {
    setStatus('');
    try {
      const [executors, active] = await Promise.all([
        apiJson('/api/v2/executors'),
        apiJson('/api/v2/recording/agent-stderr/active'),
      ]);
      lastModel = buildViewModel(executors, active);
      paint();
    } catch (err) {
      setStatus(`刷新失败：${err.message}`, true);
      body.innerHTML = `<div class="mon-muted">无法加载（控面是否已启动？）</div>`;
    }
  }

  async function callDetach(trajectoryId, hard) {
    const path = hard
      ? `/api/v2/trajectories/${trajectoryId}/detach`
      : `/api/v2/trajectories/${trajectoryId}/stream/detach`;
    const label = hard ? '释放浏览器（关 Chrome + 槽位）' : '断开画面（保留浏览器）';
    if (!window.confirm(`确认对交易 #${trajectoryId}：${label}？`)) return;
    setStatus(`${label}中…`);
    try {
      await apiJson(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      setStatus(`${label}成功`);
      await refresh();
    } catch (err) {
      setStatus(`${label}失败：${err.message}`, true);
    }
  }

  async function fetchStderr(btn) {
    const sessionId = btn.dataset.session || '';
    const sid = btn.dataset.sid || '';
    const slot = btn.dataset.slot;
    const trajectoryId = Number(btn.dataset.tid);
    const bodyObj = {
      slotIndex: slot !== '' ? Number(slot) : undefined,
      sid: sid || undefined,
      sessionId: sessionId || undefined,
      trajectoryId: Number.isFinite(trajectoryId) ? trajectoryId : undefined,
      format: 'text',
    };
    setStatus('拉取 stderr…');
    try {
      const res = await fetch('/api/v2/recording/agent-stderr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyObj),
      });
      const text = await res.text();
      logBox.hidden = false;
      if (!res.ok) {
        let msg = text;
        try {
          const j = JSON.parse(text);
          msg = j.message || j.error || (j.data && JSON.stringify(j.data)) || text;
        } catch { /* plain */ }
        logPre.textContent = msg;
        setStatus(`日志失败 HTTP ${res.status}`, true);
        return;
      }
      // text/plain bypasses envelope; json would be enveloped
      let display = text;
      try {
        const j = JSON.parse(text);
        if (j && j.data && Array.isArray(j.data.lines)) {
          display = j.data.lines.join('\n');
        }
      } catch { /* keep text */ }
      logPre.textContent = display || '(空日志)';
      lastLogSessionId = sessionId || '';
      setStatus(`日志 ${display ? `${display.split('\n').filter(Boolean).length} 行` : '空'}`);
    } catch (err) {
      setStatus(`日志失败：${err.message}`, true);
    }
  }

  async function clearStderr(btnOrSession) {
    let bodyObj;
    if (typeof btnOrSession === 'string') {
      bodyObj = { sessionId: btnOrSession };
    } else {
      const btn = btnOrSession;
      const sessionId = btn.dataset.session || '';
      const sid = btn.dataset.sid || '';
      const trajectoryId = Number(btn.dataset.tid);
      bodyObj = {
        sessionId: sessionId || undefined,
        sid: sid || undefined,
        trajectoryId: Number.isFinite(trajectoryId) ? trajectoryId : undefined,
      };
    }
    const sidHint = bodyObj.sessionId || bodyObj.sid || `traj#${bodyObj.trajectoryId}`;
    if (!window.confirm(
      `确认清空该会话的控面 stderr 文件？\n范围：仅 logs/agent-stderr/{sessionId}.log\n目标：${sidHint}`,
    )) return;
    setStatus('清空日志…');
    try {
      const result = await apiJson('/api/v2/recording/agent-stderr/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyObj),
      });
      const cleared = result?.cleared;
      const sid = result?.sessionId || bodyObj.sessionId || '';
      if (sid && sid === lastLogSessionId) {
        logPre.textContent = '(已清空)';
      }
      setStatus(cleared ? `已清空 ${sid}` : `无文件可清（${sid || 'unknown'}）`);
    } catch (err) {
      setStatus(`清空失败：${err.message}`, true);
    }
  }

  wrap.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const tid = Number(btn.dataset.tid);
    if (act === 'stream-detach' && Number.isFinite(tid)) callDetach(tid, false);
    if (act === 'detach' && Number.isFinite(tid)) callDetach(tid, true);
    if (act === 'stderr') fetchStderr(btn);
    if (act === 'clear-log') clearStderr(btn);
  });

  $('.mon-refresh', wrap)?.addEventListener('click', () => refresh());
  nodeSel.addEventListener('change', () => paint());
  slotSel.addEventListener('change', () => paint());
  showOffline?.addEventListener('change', () => paint());
  $('.mon-copy-log', wrap)?.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const text = logPre?.textContent || '';
    if (!text) {
      setStatus('没有可复制的日志', true);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setStatus(`已复制 ${text.split('\n').filter(Boolean).length} 行`);
    } catch {
      // Fallback for non-secure context
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        setStatus(`已复制 ${text.split('\n').filter(Boolean).length} 行`);
      } catch (err) {
        setStatus(`复制失败：${err.message || err}`, true);
      }
    }
  });
  $('.mon-clear-last-log', wrap)?.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!lastLogSessionId) {
      setStatus('请先点「日志」拉取一次，再清空该会话文件', true);
      return;
    }
    await clearStderr(lastLogSessionId);
  });
  $('.mon-auto', wrap)?.addEventListener('change', (e) => {
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
