/**
 * Self-use record console — browse / create / review only.
 * Recording (prepare/start/manual/BiB) lives on record-studio.html.
 */
import { api, escapeHtml } from './api.js';
import { NODE_TYPE } from '../../models/hierarchy-constants.js';
import { asTree, flattenTree } from '../hierarchy-tree-utils.js';

const NODE_FUNCTION = NODE_TYPE.FUNCTION;

const state = {
  view: 'browse', // browse | create | review
  /** Nested children[] tree from API */
  tree: [],
  searchHits: [],
  selectedFn: null,
  /** @type {{ id: number, name: string }|null} */
  selectedSystem: null,
  accounts: [],
  trajectories: [],
  create: {
    name: '',
    requirement: '',
    phases: [],
    model: 'deepseek-v4-flash',
    systemAccountId: null,
  },
  traj: null,
  treeDetail: null,
  log: [],
};

const $ = (id) => document.getElementById(id);

function log(msg, tone = 'info') {
  const t = new Date().toLocaleTimeString();
  state.log.unshift({ t, msg, tone });
  if (state.log.length > 80) state.log.length = 80;
  renderLog();
}

function renderLog() {
  const el = $('rcLog');
  if (!el) return;
  el.innerHTML = state.log
    .map((x) => {
      const c = x.tone === 'err' ? 'var(--red-600)' : x.tone === 'ok' ? 'var(--emerald-600)' : 'var(--slate-600)';
      return `<div style="font-size:11px;color:${c}"><span style="color:var(--slate-400)">${escapeHtml(x.t)}</span> ${escapeHtml(x.msg)}</div>`;
    })
    .join('');
}

function setView(view) {
  state.view = view;
  ['browse', 'create', 'review'].forEach((v) => {
    const panel = $(`rcView${v.charAt(0).toUpperCase()}${v.slice(1)}`);
    if (panel) panel.style.display = v === view ? '' : 'none';
  });
  updateNav();
}

function updateNav() {
  const crumb = $('rcCrumb');
  if (!crumb) return;
  const fn = state.selectedFn ? `功能 #${state.selectedFn.id} ${state.selectedFn.name}` : '未选功能';
  const traj = state.traj ? ` · 交易 #${state.traj.id}` : '';
  crumb.textContent = `${fn}${traj} · ${state.view}`;
}

async function loadTree() {
  try {
    const data = await api('GET', '/api/v2/system-mgmt/tree?accounts=false');
    state.tree = asTree(data);
    renderTree();
    const n = flattenTree(state.tree).length;
    log(`系统树已加载 (${state.tree.length} 系统 / ${n} 节点)`, 'ok');
  } catch (e) {
    log(`加载系统树失败: ${e.message}`, 'err');
  }
}

function renderTree(filterIds = null) {
  const root = $('rcTree');
  if (!root) return;
  if (!state.tree.length) {
    root.innerHTML = '<div class="rc-muted">暂无系统树</div>';
    return;
  }
  const html = [];
  for (const sys of state.tree) {
    const mods = sys.children || [];
    html.push(`<div class="rc-tree-sys">${escapeHtml(sys.name)}</div>`);
    for (const mod of mods) {
      html.push(`<div class="rc-tree-mod">${escapeHtml(mod.name)}</div>`);
      const fns = mod.children || [];
      for (const fn of fns) {
        if (filterIds && !filterIds.has(fn.id)) continue;
        const sel = state.selectedFn?.id === fn.id ? ' rc-selected' : '';
        const path = `${sys.name} / ${mod.name} / ${fn.name}`;
        html.push(
          `<button type="button" class="rc-tree-fn${sel}" data-fn-id="${fn.id}" data-fn-name="${escapeHtml(fn.name)}" data-fn-path="${escapeHtml(path)}">${escapeHtml(fn.name)} <span class="rc-muted">#${fn.id}</span></button>`,
        );
      }
    }
  }
  root.innerHTML = html.join('') || '<div class="rc-muted">无匹配功能</div>';
  root.querySelectorAll('.rc-tree-fn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const fnId = Number(btn.dataset.fnId);
      state.selectedFn = {
        id: fnId,
        name: btn.dataset.fnName,
        path: btn.dataset.fnPath,
      };
      state.selectedSystem = findSystemForFunction(fnId);
      renderTree(filterIds);
      loadAccounts().then(() => loadTrajectories());
      setView('browse');
    });
  });
}

function findSystemForFunction(fnId) {
  for (const sys of state.tree) {
    for (const mod of sys.children || []) {
      for (const fn of mod.children || []) {
        if (Number(fn.id) === Number(fnId)) {
          return { id: Number(sys.id), name: sys.name || '' };
        }
      }
    }
  }
  return null;
}

async function loadAccounts() {
  state.accounts = [];
  if (!state.selectedSystem?.id) return;
  try {
    const data = await api('GET', `/api/v2/systems/${state.selectedSystem.id}/accounts`);
    state.accounts = Array.isArray(data) ? data : (data.accounts || data.rows || []);
    log(`账号 ${state.accounts.length} 个 (system #${state.selectedSystem.id})`, 'ok');
  } catch (e) {
    log(`加载账号失败: ${e.message}`, 'err');
  }
}

function accountOptionsHtml(selectedId) {
  const opts = ['<option value=\"\">— 选择系统账号 —</option>'];
  for (const a of state.accounts) {
    const sel = Number(selectedId) === Number(a.id) ? ' selected' : '';
    opts.push(
      `<option value=\"${a.id}\"${sel}>${escapeHtml(a.name || a.username || `#${a.id}`)}</option>`,
    );
  }
  return opts.join('');
}

async function onSearch() {
  const q = ($('rcSearch')?.value || '').trim();
  if (!q) {
    state.searchHits = [];
    renderTree();
    $('rcSearchHits').innerHTML = '';
    return;
  }
  try {
    const data = await api(
      'GET',
      `/api/v2/system-mgmt/tree?accounts=false&name=${encodeURIComponent(q)}&limit=30`,
    );
    const tree = asTree(data);
    // Hits: nodes that matched keyword (have path) — fallback to all flattened
    const flat = flattenTree(tree);
    state.searchHits = flat.filter((n) => n.path) ;
    if (!state.searchHits.length) state.searchHits = flat;
    const hits = $('rcSearchHits');
    hits.innerHTML = state.searchHits
      .map(
        (r) =>
          `<button type="button" class="rc-hit" data-id="${r.id}" data-type="${r.type}" data-name="${escapeHtml(r.name)}" data-path="${escapeHtml(r.path || '')}">${escapeHtml(r.path || r.name)} <span class="rc-muted">${escapeHtml(r.typeLabel || '')}</span></button>`,
      )
      .join('') || '<div class="rc-muted">无结果</div>';
    hits.querySelectorAll('.rc-hit').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.id);
        const type = Number(btn.dataset.type);
        if (type === NODE_FUNCTION) {
          state.selectedFn = { id, name: btn.dataset.name, path: btn.dataset.path };
          state.selectedSystem = findSystemForFunction(id);
          renderTree(new Set([id]));
          loadAccounts().then(() => loadTrajectories());
        } else {
          const fnIds = collectFunctionIdsUnder(id);
          renderTree(fnIds.size ? fnIds : null);
        }
      });
    });
    const fnIds = new Set(state.searchHits.filter((r) => Number(r.type) === NODE_FUNCTION).map((r) => r.id));
    if (fnIds.size) renderTree(fnIds);
  } catch (e) {
    log(`搜索失败: ${e.message}`, 'err');
  }
}

function collectFunctionIdsUnder(nodeId) {
  const ids = new Set();
  for (const sys of state.tree) {
    if (sys.id === nodeId) {
      for (const mod of sys.children || []) {
        for (const fn of mod.children || []) ids.add(fn.id);
      }
      return ids;
    }
    for (const mod of sys.children || []) {
      if (mod.id === nodeId) {
        for (const fn of mod.children || []) ids.add(fn.id);
        return ids;
      }
      for (const fn of mod.children || []) {
        if (fn.id === nodeId) ids.add(fn.id);
      }
    }
  }
  return ids;
}

async function loadTrajectories() {
  const box = $('rcTrajList');
  if (!state.selectedFn) {
    box.innerHTML = '<div class="rc-muted">请选择左侧功能节点</div>';
    updateNav();
    return;
  }
  updateNav();
  box.innerHTML = '<div class="rc-muted">加载中…</div>';
  try {
    const data = await api(
      'GET',
      `/api/v2/trajectories?functionId=${state.selectedFn.id}&page=1&pageSize=50&sortBy=created_at&order=desc`,
    );
    state.trajectories = data.rows || [];
    if (!state.trajectories.length) {
      box.innerHTML = '<div class="rc-muted">该功能下暂无交易</div>';
      return;
    }
    box.innerHTML = state.trajectories
      .map(
        (t) => `<div class="rc-traj-row">
          <div>
            <strong>#${t.id}</strong> ${escapeHtml(t.name || t.task || '未命名')}
            <div class="rc-muted">${escapeHtml(t.recordStatus || '')} · ${t.phaseCount ?? 0} 阶段 · ${t.stepCount ?? 0} 步</div>
            <label class="rc-field" style="margin-top:6px;font-size:12px">系统账号
              <select data-acct-traj="${t.id}" style="display:block;margin-top:4px;min-width:180px">
                ${accountOptionsHtml(t.systemAccountId)}
              </select>
            </label>
          </div>
          <div class="rc-row-actions">
            <button type="button" class="btn btn-sm btn-primary" data-studio="${t.id}">进入录制工作室</button>
            <button type="button" class="btn btn-sm btn-outline" data-review="${t.id}">确认步骤</button>
          </div>
        </div>`,
      )
      .join('');
    box.querySelectorAll('[data-acct-traj]').forEach((sel) => {
      sel.addEventListener('change', async () => {
        const tid = Number(sel.dataset.acctTraj);
        const systemAccountId = sel.value ? Number(sel.value) : null;
        try {
          if (!systemAccountId) {
            alert('请选择系统账号');
            return;
          }
          await api('PATCH', `/api/v2/trajectories/${tid}`, { systemAccountId });
          const row = state.trajectories.find((x) => Number(x.id) === tid);
          if (row) row.systemAccountId = systemAccountId;
          log(`交易 #${tid} 已绑定账号 #${systemAccountId}`, 'ok');
        } catch (e) {
          log(`绑定账号失败: ${e.message}`, 'err');
          alert(e.message);
        }
      });
    });
    box.querySelectorAll('[data-studio]').forEach((b) =>
      b.addEventListener('click', () => enterStudio(Number(b.dataset.studio))),
    );
    box.querySelectorAll('[data-review]').forEach((b) =>
      b.addEventListener('click', () => openReview(Number(b.dataset.review))),
    );
  } catch (e) {
    box.innerHTML = `<div class="rc-err">${escapeHtml(e.message)}</div>`;
  }
}

function enterStudio(trajId) {
  const row = state.trajectories.find((x) => Number(x.id) === Number(trajId));
  const acct = row?.systemAccountId != null ? Number(row.systemAccountId) : null;
  if (!Number.isFinite(acct) || acct <= 0) {
    alert('请先在列表中为该交易选择系统账号，再进入录制工作室。');
    return;
  }
  location.href = `/api/test/record-studio?id=${trajId}`;
}

function openCreate() {
  if (!state.selectedFn) {
    alert('请先选择功能节点');
    return;
  }
  if (!state.accounts.length) {
    alert('当前系统下没有账号。请先在层级管理中添加系统账号。');
    return;
  }
  state.create = {
    name: '',
    requirement: '',
    phases: [],
    model: 'deepseek-v4-flash',
    systemAccountId: state.accounts.length === 1 ? state.accounts[0].id : null,
  };
  $('rcCreateName').value = '';
  $('rcCreateReq').value = '';
  const acctSel = $('rcCreateAccount');
  if (acctSel) {
    acctSel.innerHTML = accountOptionsHtml(state.create.systemAccountId);
  }
  renderCreatePhases();
  setView('create');
}

function renderCreatePhases() {
  const el = $('rcCreatePhases');
  const phases = state.create.phases;
  if (!phases.length) {
    el.innerHTML = '<div class="rc-muted">点击「需求解析」生成阶段，或手动添加</div>';
    return;
  }
  el.innerHTML = phases
    .map(
      (p, i) => `<div class="rc-phase-edit">
      <span class="rc-muted">${i + 1}.</span>
      <input type="text" data-idx="${i}" value="${escapeHtml(p)}" />
      <button type="button" class="btn btn-sm btn-outline" data-del="${i}">删</button>
    </div>`,
    )
    .join('');
  el.querySelectorAll('input').forEach((inp) => {
    inp.addEventListener('change', () => {
      state.create.phases[Number(inp.dataset.idx)] = inp.value.trim();
    });
  });
  el.querySelectorAll('[data-del]').forEach((b) => {
    b.addEventListener('click', () => {
      state.create.phases.splice(Number(b.dataset.del), 1);
      renderCreatePhases();
    });
  });
}

async function analyzeRequirement() {
  const description = ($('rcCreateReq')?.value || '').trim();
  if (!description) {
    alert('请填写需求描述');
    return;
  }
  const stepLength = Number($('rcStepLength')?.value) || undefined;
  $('rcAnalyzeBtn').disabled = true;
  try {
    log('analyze…');
    const body = { description, model: state.create.model };
    if (stepLength) body.stepLength = stepLength;
    const phases = await api('POST', '/api/v2/trajectories/analyze', body);
    state.create.phases = Array.isArray(phases) ? phases.map(String) : [];
    renderCreatePhases();
    log(`analyze 完成 ${state.create.phases.length} 阶段`, 'ok');
  } catch (e) {
    log(`analyze 失败: ${e.message}`, 'err');
    alert(e.message);
  } finally {
    $('rcAnalyzeBtn').disabled = false;
  }
}

async function saveTrajectory() {
  const name = ($('rcCreateName')?.value || '').trim();
  const requirement = ($('rcCreateReq')?.value || '').trim();
  $('rcCreatePhases')?.querySelectorAll('input')?.forEach((inp) => {
    state.create.phases[Number(inp.dataset.idx)] = inp.value.trim();
  });
  const phases = state.create.phases.filter(Boolean);
  if (!name || !requirement) {
    alert('名称与需求必填');
    return;
  }
  if (!phases.length) {
    alert('请至少有一个阶段（先需求解析或手动添加）');
    return;
  }
  const systemAccountId = Number($('rcCreateAccount')?.value || state.create.systemAccountId || 0);
  if (!Number.isFinite(systemAccountId) || systemAccountId <= 0) {
    alert('请选择系统账号（进入工作室前必选）');
    return;
  }
  try {
    log('创建交易…');
    const data = await api('POST', '/api/v2/trajectories', {
      functionId: state.selectedFn.id,
      name,
      requirement,
      phases,
      model: state.create.model,
      systemAccountId,
    });
    log(`交易已创建 #${data.id} → 跳转录制工作室`, 'ok');
    location.href = `/api/test/record-studio?id=${data.id}`;
  } catch (e) {
    log(`创建失败: ${e.message}`, 'err');
    alert(e.message);
  }
}

async function openReview(trajId) {
  try {
    const tree = await api('GET', `/api/v2/trajectories/${trajId}/tree`);
    state.traj = { id: trajId };
    state.treeDetail = tree;
    renderReview();
    setView('review');
    history.replaceState(null, '', `#review=${trajId}`);
  } catch (e) {
    log(`加载 tree 失败: ${e.message}`, 'err');
    alert(e.message);
  }
}

function renderReview() {
  updateNav();
  const el = $('rcStepList');
  const phases = state.treeDetail?.phases || [];
  const orphans = state.treeDetail?.orphanSteps || [];
  if (!phases.length && !orphans.length) {
    el.innerHTML = '<div class="rc-muted">暂无步骤</div>';
    return;
  }
  const blocks = [];
  for (const ph of phases) {
    blocks.push(`<div class="rc-phase-head">阶段 #${ph.phaseNumber} ${escapeHtml(ph.description || '')}</div>`);
    for (const st of ph.steps || []) blocks.push(stepRow(st));
  }
  if (orphans.length) {
    blocks.push('<div class="rc-phase-head">未归属步骤</div>');
    orphans.forEach((st) => blocks.push(stepRow(st)));
  }
  el.innerHTML = blocks.join('');
  el.querySelectorAll('input[data-confirm]').forEach((inp) => {
    inp.addEventListener('change', async () => {
      const id = Number(inp.dataset.confirm);
      try {
        await api('PATCH', `/api/v2/trajectory-steps/${id}/confirm`, { confirmed: inp.checked });
        log(`step #${id} confirmed=${inp.checked}`, 'ok');
      } catch (e) {
        inp.checked = !inp.checked;
        alert(e.message);
      }
    });
  });
}

function stepRow(st) {
  const conf = st.confirmed === true || st.confirmed === 1;
  return `<label class="rc-step">
    <input type="checkbox" data-confirm="${st.id}" ${conf ? 'checked' : ''} />
    <span><code>#${st.id}</code> [${escapeHtml(st.source || '')}] ${escapeHtml(st.actionType || '')} — ${escapeHtml(st.description || '')}</span>
  </label>`;
}

async function detach() {
  const trajId = state.traj?.id;
  if (!trajId) return;
  try {
    await api('POST', `/api/v2/trajectories/${trajId}/detach`, {});
    log('detach OK — 槽位已释放', 'ok');
    alert('已 detach');
    setView('browse');
    history.replaceState(null, '', location.pathname);
    await loadTrajectories();
  } catch (e) {
    log(`detach: ${e.message}`, 'err');
    alert(e.message);
  }
}

function wire() {
  $('rcSearchBtn')?.addEventListener('click', onSearch);
  $('rcSearch')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onSearch();
  });
  $('rcRefreshTree')?.addEventListener('click', loadTree);
  $('rcNewTrajBtn')?.addEventListener('click', openCreate);
  $('rcAnalyzeBtn')?.addEventListener('click', analyzeRequirement);
  $('rcAddPhaseBtn')?.addEventListener('click', () => {
    state.create.phases.push('新阶段');
    renderCreatePhases();
  });
  $('rcSaveTrajBtn')?.addEventListener('click', saveTrajectory);
  $('rcCancelCreateBtn')?.addEventListener('click', () => setView('browse'));
  $('rcReviewDetachBtn')?.addEventListener('click', detach);
  $('rcBackBrowseBtn')?.addEventListener('click', () => {
    setView('browse');
    history.replaceState(null, '', location.pathname);
    loadTrajectories();
  });
}

async function initRecordConsole() {
  wire();
  setView('browse');
  await loadTree();
  log('联调页：浏览/创建/确认。录制请用 record-studio。', 'ok');
  const m = (location.hash || '').match(/review=(\d+)/);
  if (m) await openReview(Number(m[1]));
}

initRecordConsole();
