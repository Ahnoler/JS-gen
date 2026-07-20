/**
 * Dedicated recording studio: left BiB canvas, right phases/steps/controls.
 * Open: /api/test/record-studio?id=<trajectoryId>
 *
 * One prepare call: session → browser → stream → login.
 * Client arms WS subscribe early so login is visible on canvas.
 */
import { api, escapeHtml } from './api.js';
import { connect, on } from '../ws-client.js';
import {
  initRemoteBrowser,
  ensureRemoteStream,
  armRemoteStream,
  setRemotePreferredSessionId,
  setRemoteLog,
} from '../remote-browser.js';

const params = new URLSearchParams(location.search);
const trajId = Number(params.get('id') || params.get('trajectoryId') || 0);

const STAGE_LABELS = {
  session: '1 会话创建',
  browser: '2 分配浏览器',
  stream: '3 画面推流',
  login: '4 导航登录',
};

const state = {
  traj: null,
  prepare: null,
  prepareError: null,
  preparing: false,
  prepareStages: null,
  phases: [],
  selectedPhaseIds: new Set(),
  manualPhaseId: null,
  manualOn: false,
  aiBusy: false,
  tree: null,
  executors: [],
  poll: null,
  loginContext: null,
  selectedAccountId: null,
  selectedStepIds: new Set(),
};

const $ = (id) => document.getElementById(id);

function log(msg, tone = 'info') {
  const el = $('rsLog');
  if (!el) return;
  const color = tone === 'err' ? '#f87171' : tone === 'ok' ? '#34d399' : '#94a3b8';
  const line = document.createElement('div');
  line.style.color = color;
  line.textContent = `${new Date().toLocaleTimeString()} ${msg}`;
  el.prepend(line);
}

function phaseId(ph) {
  return Number(ph?.id);
}

function syncSelectedFromPhases() {
  const ids = (state.phases || []).map(phaseId).filter((id) => Number.isFinite(id) && id > 0);
  if (!ids.length) {
    state.selectedPhaseIds = new Set();
    return;
  }
  // Keep previous selection if still valid; otherwise select all
  const next = new Set([...state.selectedPhaseIds].filter((id) => ids.includes(id)));
  if (!next.size) ids.forEach((id) => next.add(id));
  state.selectedPhaseIds = next;
}

function renderResource() {
  const p = state.prepare || {};
  const live = (state.executors || []).filter((e) => e.connected === true);
  const staleOnline = (state.executors || []).filter(
    (e) => e.status === 'online' && e.connected !== true,
  );
  const execLines = live.length
    ? live
        .map(
          (e) =>
            `🟢 ${escapeHtml(e.name || e.nodeUuid || '')} WS已连接 inUse=${e.inUse ?? '?'}/${e.capacity ?? '?'}`,
        )
        .join('<br/>')
    : staleOnline.length
      ? `<span style="color:#fbbf24">库状态 online 但 WS 未连接（${staleOnline.map((e) => escapeHtml(e.name || e.nodeUuid)).join(', ')}）— 请重启 npm run executor</span>`
      : '<span style="color:#f87171">无 WS 已连接执行机 — 请另开终端：npm run executor</span>';

  let body;
  if (state.preparing) {
    const stages = state.prepareStages || {};
    const stageLines = ['session', 'browser', 'stream', 'login']
      .map((k) => {
        const s = stages[k]?.status || 'pending';
        const tone =
          s === 'done' || s === 'skipped'
            ? '#34d399'
            : s === 'running'
              ? '#fbbf24'
              : s === 'error'
                ? '#f87171'
                : s === 'degraded'
                  ? '#fb923c'
                  : '#64748b';
        return `<div style="color:${tone}">${STAGE_LABELS[k]} · ${escapeHtml(s)}</div>`;
      })
      .join('');
    body = `<div style="color:#fbbf24">prepare 进行中（一次完成会话/浏览器/推流/登录）…请勿重复点击。</div>
      <div style="margin-top:6px;font-size:12px">${stageLines}</div>`;
  } else if (state.prepareError) {
    body = `<div style="color:#f87171">${escapeHtml(state.prepareError)}</div>
      <div class="rs-muted" style="margin-top:6px">点下方「一键准备」会在<strong>已连接</strong>的执行机上：开槽 → 推流 → 登录。
      AI/人工按钮在 prepare 成功前不可用。</div>`;
  } else {
    const streamHint = p.stream?.ok === false || p.bibError
      ? `<div style="color:#fb923c">推流降级：${escapeHtml(p.bibError || 'BiB 未附着')}（可继续录制，左侧可「附着/推流」重试）</div>`
      : `<div>remoteSessionId ${p.remoteSessionId ?? '—'} · stream ${p.stream?.ok ? 'ok' : (p.attached ? 'ok' : '—')}</div>`;
    body = [
      `<div>trajectory <b>#${trajId}</b> ${escapeHtml(state.traj?.name || '')}</div>`,
      `<div>session <code>${escapeHtml(p.sessionId || '—')}</code></div>`,
      `<div>executor <code>${escapeHtml(p.executorNodeUuid || '—')}</code></div>`,
      streamHint,
      `<div>ready ${p.ready ?? !!p.sessionId} · login ${p.login?.skipped ? 'skipped' : (p.login?.done ? 'done' : '—')}</div>`,
    ].join('');
  }

  const el = $('rsResource');
  if (el) {
    el.innerHTML = `${body}
    <div style="margin-top:8px;border-top:1px solid #334155;padding-top:6px">
      <div class="rs-muted">执行机状态</div>${execLines}
    </div>`;
  }

  if ($('rsTitle')) $('rsTitle').textContent = state.traj?.name || `交易 #${trajId}`;
  if ($('rsMeta')) {
    $('rsMeta').textContent = `recordStatus=${state.traj?.recordStatus || p.trajectory?.recordStatus || '—'}`;
  }
  if ($('rsReviewLink')) $('rsReviewLink').href = `/api/test/record-console#review=${trajId}`;

  const ready = !!p.sessionId && !state.prepareError && !state.preparing;
  // Keep buttons clickable so users get an alert instead of "no response"
  if ($('rsAiStartBtn')) {
    $('rsAiStartBtn').disabled = false;
    $('rsAiStartBtn').title = ready ? '开始 AI 录制' : '需先 prepare 成功';
    $('rsAiStartBtn').classList.toggle('rs-btn-blocked', !ready);
  }
  if ($('rsManualBtn')) {
    $('rsManualBtn').disabled = false;
    $('rsManualBtn').title = ready ? '人工录制' : '需先 prepare 成功';
    $('rsManualBtn').classList.toggle('rs-btn-blocked', !ready);
  }
  if ($('rsPrepareBtn')) {
    $('rsPrepareBtn').disabled = !!state.preparing;
    $('rsPrepareBtn').textContent = state.preparing
      ? '准备中…'
      : '一键准备 (prepare)';
  }
}

function renderPhases() {
  const box = $('rsPhases');
  const list = state.phases || [];
  if (!list.length) {
    box.innerHTML = '<div class="rs-muted">暂无阶段（创建交易时应带 phases；或点下方刷新）</div>';
  } else {
    box.innerHTML = list
      .map((ph) => {
        const id = phaseId(ph);
        const checked = state.selectedPhaseIds.has(id) ? 'checked' : '';
        return `<label class="rs-phase-pick">
          <input type="checkbox" data-phase="${id}" ${checked} ${state.aiBusy ? 'disabled' : ''} />
          <span class="rs-phase-pick-text">
            <strong>#${ph.phaseNumber ?? '?'}</strong> ${escapeHtml(ph.description || '')}
            <span class="rs-muted">${escapeHtml(ph.status || '')} · id=${id}</span>
          </span>
        </label>`;
      })
      .join('');
  }

  box.querySelectorAll('input[data-phase]').forEach((inp) => {
    inp.addEventListener('change', () => {
      const id = Number(inp.dataset.phase);
      if (inp.checked) state.selectedPhaseIds.add(id);
      else state.selectedPhaseIds.delete(id);
    });
  });

  const sel = $('rsManualPhase');
  if (sel) {
    sel.innerHTML =
      `<option value="">（空=最后阶段）</option>` +
      list
        .map(
          (ph) =>
            `<option value="${phaseId(ph)}" ${Number(state.manualPhaseId) === phaseId(ph) ? 'selected' : ''}>#${ph.phaseNumber} ${escapeHtml(ph.description || '')}</option>`,
        )
        .join('');
  }

  $('rsAiBusy').style.display = state.aiBusy ? '' : 'none';
  $('rsManualBtn').textContent = state.manualOn ? '停止人工录制' : '开始人工录制';
  renderResource();
}

function renderStepTree() {
  const el = $('rsStepTree');
  const phases = state.tree?.phases || [];
  if (!phases.length) {
    el.innerHTML = '<div class="rs-muted">尚无步骤（录制后出现）</div>';
    return;
  }
  const parts = [];
  for (const ph of phases) {
    parts.push(`<div class="rs-phase-head">阶段 #${ph.phaseNumber} ${escapeHtml(ph.description || '')}</div>`);
    for (const st of ph.steps || []) {
      const conf = st.confirmed === true || st.confirmed === 1 ? '✓' : '○';
      const checked = state.selectedStepIds.has(Number(st.id)) ? 'checked' : '';
      parts.push(
        `<label class="rs-step"><input type="checkbox" data-step="${st.id}" ${checked} ${state.aiBusy ? 'disabled' : ''} />`
          + `<span>${conf}</span>`
          + `<span><code>#${st.id}</code> [${escapeHtml(st.source || '')}] ${escapeHtml(st.actionType || '')} — ${escapeHtml(st.description || '')}</span></label>`,
      );
    }
    if (!(ph.steps || []).length) parts.push('<div class="rs-muted">（无步骤）</div>');
  }
  el.innerHTML = parts.join('');
  el.querySelectorAll('input[data-step]').forEach((inp) => {
    inp.addEventListener('change', () => {
      const id = Number(inp.dataset.step);
      if (inp.checked) state.selectedStepIds.add(id);
      else state.selectedStepIds.delete(id);
    });
  });
}

async function refreshExecutors() {
  try {
    const data = await api('GET', '/api/v2/executors');
    state.executors = Array.isArray(data) ? data : data.nodes || data.rows || data.executors || [];
  } catch {
    state.executors = [];
  }
  renderResource();
}

async function refreshTree() {
  try {
    state.tree = await api('GET', `/api/v2/trajectories/${trajId}/tree`);
    if (Array.isArray(state.tree?.phases) && state.tree.phases.length) {
      state.phases = state.tree.phases;
      syncSelectedFromPhases();
      renderPhases();
    }
    renderStepTree();
  } catch (e) {
    log(`tree: ${e.message}`, 'err');
  }
}

async function loadTrajMeta() {
  try {
    state.traj = await api('GET', `/api/v2/trajectories/${trajId}`);
    if (Array.isArray(state.traj?.phases) && state.traj.phases.length && !state.phases.length) {
      state.phases = state.traj.phases;
      syncSelectedFromPhases();
      renderPhases();
    }
  } catch (e) {
    log(`加载交易: ${e.message}`, 'err');
  }
}

async function prepare() {
  if (state.preparing) {
    alert('prepare 仍在进行中，请稍候。');
    return;
  }
  state.prepareError = null;
  state.preparing = true;
  state.prepareStages = {
    session: { status: 'pending' },
    browser: { status: 'pending' },
    stream: { status: 'pending' },
    login: { status: 'pending' },
  };
  renderResource();
  log(`record/prepare #${trajId}…（会话 → 浏览器 → 推流 → 登录）`);
  try {
    await refreshExecutors();
    const live = (state.executors || []).filter((e) => e.connected === true);
    if (!live.length) {
      state.prepareError =
        '执行机 WS 未连接。请先 npm run executor（EXECUTOR_TOKEN 与控制面一致），确认本页显示「WS已连接」后再 prepare。';
      throw new Error(state.prepareError);
    }
    if (!state.traj?.systemAccountId && !state.loginContext?.systemAccountId) {
      state.prepareError = '交易未绑定系统账号。请返回交易列表选择账号后再进入工作室。';
      throw new Error(state.prepareError);
    }

    // Arm canvas subscribe before HTTP prepare so login frames can appear mid-call.
    await armRemoteStream().catch(() => false);

    const data = await api('POST', `/api/v2/trajectories/${trajId}/record/prepare`, {});
    state.prepare = data;
    state.prepareStages = data.stages || state.prepareStages;
    state.prepareError = null;
    state.traj = data.trajectory || state.traj || (await api('GET', `/api/v2/trajectories/${trajId}`));
    if (Array.isArray(data.phases) && data.phases.length) {
      state.phases = data.phases;
    }
    syncSelectedFromPhases();
    state.manualPhaseId = state.phases[0] ? phaseId(state.phases[0]) : null;
    state.manualOn = false;
    renderPhases();
    const loginInfo = data.login
      ? `login=${data.login.skipped ? 'skipped' : 'done'} account=#${data.login.accountId || data.systemAccountId}`
      : '';
    log(`prepare OK session=${data.sessionId || '—'} ${loginInfo} ready=${data.ready}`, 'ok');
    if (data.sessionId) setRemotePreferredSessionId(data.sessionId);

    const streamOk = data.stream?.ok !== false && !data.bibError && data.remoteSessionId;
    if (streamOk) {
      // Server already attached + bib_start; just ensure client subscribe/startStream.
      try {
        await ensureRemoteStream({ sessionId: data.sessionId || undefined });
        log(`画面已就绪 remoteSession #${data.remoteSessionId}`, 'ok');
      } catch (e) {
        log(`画布订阅失败: ${e.message}（可点左侧「附着/推流」重试）`, 'err');
      }
    } else if (data.bibError) {
      log(`推流降级（Session/登录已完成，可继续录制）: ${data.bibError}`, 'err');
    }
  } finally {
    state.preparing = false;
    renderResource();
  }
}

function renderBoundAccount() {
  const preview = $('rsAccountPreview');
  const box = $('rsLoginContext');
  const ctx = state.loginContext;
  const boundId = state.traj?.systemAccountId ?? ctx?.systemAccountId ?? state.selectedAccountId;
  state.selectedAccountId = boundId != null ? Number(boundId) : null;

  if (!ctx) {
    if (box) box.textContent = '尚未加载登录上下文';
    if (preview) preview.textContent = '—';
    return;
  }
  if (box) {
    if (ctx.error && !ctx.system) {
      box.innerHTML = `<span style="color:#f87171">${escapeHtml(ctx.error)}</span>`;
    } else if (ctx.system) {
      box.innerHTML = `系统 <b>#${ctx.system.id}</b> ${escapeHtml(ctx.system.name)} · 绑定账号 #${boundId || '（未绑定）'}`;
    } else {
      box.innerHTML = '<span style="color:#fbbf24">未解析到所属系统</span>';
    }
  }
  const acct = (ctx.accounts || []).find((a) => Number(a.id) === Number(boundId));
  if (!preview) return;
  if (!acct) {
    preview.innerHTML = boundId
      ? `<span style="color:#f87171">账号 #${boundId} 不在系统账号列表中</span>`
      : '<span style="color:#f87171">未绑定 — 请回交易列表选择系统账号</span>';
    return;
  }
  preview.textContent = [
    `${acct.name || ''}（${acct.username || '—'}）`,
    `URL: ${acct.loginUrl || '（空）'}`,
    acct.password ? '密码: ***' : '密码: （空）',
  ].join(' · ');
}

async function loadLoginContext() {
  try {
    state.loginContext = await api('GET', `/api/v2/trajectories/${trajId}/login-context`);
    if (state.loginContext.systemAccountId != null) {
      state.selectedAccountId = Number(state.loginContext.systemAccountId);
    } else if (state.traj?.systemAccountId != null) {
      state.selectedAccountId = Number(state.traj.systemAccountId);
    }
    renderBoundAccount();
    log(
      `登录上下文: system=${state.loginContext.system?.name || '—'} bound=#${state.selectedAccountId || '—'}`,
      state.loginContext.system && state.selectedAccountId ? 'ok' : 'err',
    );
  } catch (e) {
    state.loginContext = null;
    renderBoundAccount();
    log(`login-context: ${e.message}`, 'err');
  }
}

function selectedPhaseIdsOrAll() {
  let ids = [...state.selectedPhaseIds].filter((id) => Number.isFinite(id) && id > 0);
  if (!ids.length && state.phases?.length) {
    ids = state.phases.map(phaseId).filter((id) => Number.isFinite(id) && id > 0);
    ids.forEach((id) => state.selectedPhaseIds.add(id));
    renderPhases();
  }
  return ids;
}

async function startAi() {
  const phaseIds = selectedPhaseIdsOrAll();
  if (!phaseIds.length) {
    alert('没有可选阶段。请确认交易创建时带了 phases，或点「刷新」加载阶段树。');
    return;
  }
  if (!state.prepare?.sessionId) {
    alert('尚未申请浏览器资源。请先点「申请/重试 prepare」。');
    return;
  }
  const accountId = Number(
    state.selectedAccountId
      || state.traj?.systemAccountId
      || state.loginContext?.systemAccountId
      || 0,
  );
  if (!Number.isFinite(accountId) || accountId <= 0) {
    alert('交易未绑定系统账号。请返回交易列表选择账号。');
    return;
  }

  state.aiBusy = true;
  if (state.manualOn) {
    try {
      await api('POST', `/api/v2/trajectories/${trajId}/manual-record`, { enabled: false });
    } catch {}
    state.manualOn = false;
  }
  renderPhases();
  log(`record/start phaseIds=${JSON.stringify(phaseIds)}…（登录已在 prepare 完成）`);
  try {
    const data = await api('POST', `/api/v2/trajectories/${trajId}/record/start`, {
      phaseIds,
      accountId,
    });
    log(`start done → ${data.recordStatus}`, 'ok');
    if (data.phases) state.phases = data.phases;
    try {
      await ensureRemoteStream({ sessionId: state.prepare?.sessionId || undefined });
      log('AI 结束后已重新请求推流', 'ok');
    } catch (e) {
      log(`重新推流失败: ${e.message}（可点「重新推流」）`, 'err');
    }
  } catch (e) {
    log(`start: ${e.message}`, 'err');
    alert(e.message);
  } finally {
    state.aiBusy = false;
    renderPhases();
    await refreshTree();
  }
}

async function clearSteps() {
  if (!confirm('清空该交易全部操作步骤，并把所有阶段重置为 pending？\n（阶段描述会保留）')) return;
  try {
    const data = await api('POST', `/api/v2/trajectories/${trajId}/clear`, {});
    state.traj = data;
    state.selectedStepIds = new Set();
    log(`已清空步骤 → recordStatus=${data.recordStatus} stepCount=${data.stepCount}`, 'ok');
    await refreshTree();
    renderResource();
  } catch (e) {
    log(`clear: ${e.message}`, 'err');
    alert(e.message);
  }
}

async function replaySelectedSteps() {
  const stepIds = [...state.selectedStepIds].filter((id) => Number.isFinite(id) && id > 0);
  if (!stepIds.length) {
    alert('请先在步骤列表中勾选要回放的操作步骤');
    return;
  }
  if (!state.prepare?.sessionId) {
    alert('尚未 prepare。请先申请浏览器资源（会自动登录）。');
    return;
  }
  if (state.aiBusy) {
    alert('AI 录制进行中，请先结束后再回放');
    return;
  }
  log(`steps/replay count=${stepIds.length} isReplay=true…`);
  try {
    const data = await api('POST', `/api/v2/trajectories/${trajId}/steps/replay`, {
      stepIds,
      isReplay: true,
    });
    log(`回放完成 count=${data.count}${data.error ? ` error=${data.error}` : ''}`, data.error ? 'err' : 'ok');
    await ensureRemoteStream({ sessionId: state.prepare?.sessionId || undefined }).catch(() => {});
  } catch (e) {
    log(`replay: ${e.message}`, 'err');
    alert(e.message);
  }
}

async function toggleManual() {
  if (state.aiBusy) {
    alert('AI 录制进行中，禁止人工录制');
    return;
  }
  if (!state.prepare?.sessionId) {
    alert('尚未申请浏览器资源。请先点「申请/重试 prepare」。');
    return;
  }
  const enabled = !state.manualOn;
  const phaseVal = $('rsManualPhase')?.value;
  const body = { enabled };
  if (phaseVal) body.phaseId = Number(phaseVal);
  try {
    const data = await api('POST', `/api/v2/trajectories/${trajId}/manual-record`, body);
    state.manualOn = !!data.enabled;
    state.manualPhaseId = data.phaseId ?? null;
    log(`manual enabled=${state.manualOn}`, 'ok');
    renderPhases();
  } catch (e) {
    log(`manual: ${e.message}`, 'err');
    if (e.status === 409) alert('AI recording in progress（409）');
    else alert(e.message);
  }
}

async function stopRecord() {
  const success = confirm('标记录制成功？\n确定=recorded，取消=draft');
  try {
    if (state.manualOn) {
      await api('POST', `/api/v2/trajectories/${trajId}/manual-record`, { enabled: false });
      state.manualOn = false;
    }
    const data = await api('POST', `/api/v2/trajectories/${trajId}/record/stop`, { success });
    log(`stop → ${data.recordStatus} detached=${data.detached}`, 'ok');
    state.tree = data.tree || state.tree;
    renderStepTree();
    location.href = `/api/test/record-console#review=${trajId}`;
  } catch (e) {
    log(`stop: ${e.message}`, 'err');
    alert(e.message);
  }
}

async function detach() {
  try {
    await api('POST', `/api/v2/trajectories/${trajId}/detach`, {});
    state.prepare = null;
    log('detach OK', 'ok');
    alert('已释放执行机槽位');
    location.href = '/api/test/record-console';
  } catch (e) {
    alert(e.message);
  }
}

function selectAllPhases(on) {
  state.selectedPhaseIds = new Set();
  if (on) {
    (state.phases || []).forEach((ph) => {
      const id = phaseId(ph);
      if (id) state.selectedPhaseIds.add(id);
    });
  }
  renderPhases();
}

async function main() {
  if (!trajId) {
    document.body.innerHTML = '<p style="padding:24px;color:#f87171">缺少 trajectory id。请从联调页进入。</p>';
    return;
  }
  connect();
  on('recording:prepare', (payload) => {
    if (Number(payload?.trajectoryId) !== trajId) return;
    const stage = payload.stage;
    if (!stage) return;
    if (!state.prepareStages) state.prepareStages = {};
    state.prepareStages[stage] = {
      status: payload.status,
      error: payload.error,
      remoteSessionId: payload.remoteSessionId,
      sessionId: payload.sessionId,
    };
    if (payload.sessionId) setRemotePreferredSessionId(payload.sessionId);
    // As soon as BiB attaches, start receiving frames so login is visible mid-prepare.
    if (stage === 'stream' && (payload.status === 'done' || payload.status === 'degraded') && payload.remoteSessionId) {
      ensureRemoteStream({
        sessionId: payload.sessionId || state.prepareStages.session?.sessionId || undefined,
      }).catch(() => {});
    }
    if (state.preparing) renderResource();
    const label = STAGE_LABELS[stage] || stage;
    if (payload.status === 'done' || payload.status === 'skipped') {
      log(`${label} ✓`, 'ok');
    } else if (payload.status === 'degraded') {
      log(`${label} 降级: ${payload.error || ''}`, 'err');
    } else if (payload.status === 'error') {
      log(`${label} 失败: ${payload.error || ''}`, 'err');
    } else if (payload.status === 'running') {
      log(`${label}…`);
    }
  });
  setRemoteLog((msg, level) => log(msg, level === 'err' ? 'err' : level === 'ok' ? 'ok' : undefined));
  initRemoteBrowser();
  $('rsAiStartBtn').addEventListener('click', startAi);
  $('rsManualBtn').addEventListener('click', toggleManual);
  $('rsStopBtn').addEventListener('click', stopRecord);
  $('rsDetachBtn').addEventListener('click', detach);
  $('rsRefreshTreeBtn').addEventListener('click', async () => {
    await refreshTree();
    await refreshExecutors();
  });
  $('rsPrepareBtn')?.addEventListener('click', async () => {
    try {
      await prepare();
      await refreshTree();
    } catch (e) {
      state.prepareError = e.message;
      renderResource();
      log(`prepare 失败: ${e.message}`, 'err');
      alert(e.message);
    }
  });
  $('rsSelectAllBtn')?.addEventListener('click', () => selectAllPhases(true));
  $('rsSelectNoneBtn')?.addEventListener('click', () => selectAllPhases(false));
  $('rsClearStepsBtn')?.addEventListener('click', () => clearSteps());
  $('rsReplayStepsBtn')?.addEventListener('click', () => replaySelectedSteps());

  state.poll = setInterval(async () => {
    await refreshTree();
    await refreshExecutors();
  }, 4000);

  await loadTrajMeta();
  await loadLoginContext();
  await refreshTree();
  await refreshExecutors();
  if (!state.traj?.systemAccountId && !state.loginContext?.systemAccountId) {
    state.prepareError = '交易未绑定系统账号。请返回交易列表选择系统账号后再进入。';
    renderResource();
    renderPhases();
    log(state.prepareError, 'err');
    return;
  }
  try {
    await prepare();
  } catch (e) {
    state.prepareError = e.message;
    renderResource();
    renderPhases();
    log(`prepare 失败: ${e.message}`, 'err');
  }
}

main();
