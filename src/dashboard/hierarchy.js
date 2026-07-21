import { escapeHtml } from './swagger-api.js';
import { asSystemForest } from './hierarchy-tree-utils.js';
import { unwrapApi, apiErrorMessage, isApiFail, readV2 } from './api-envelope.js';

const SEED_SYSTEM_ID = '00000000-0000-0000-0000-000000000001';
const SEED_PROCESS_ID = '00000000-0000-0000-0000-000000000002';
const SEED_FUNCTION_ID = '00000000-0000-0000-0000-000000000003';

/** @type {Array} nested systems (children[]) for UI */
let hierarchyTree = [];

export async function fetchHierarchyTree() {
  const res = await fetch('/api/v2/hierarchy/tree');
  const raw = await res.json();
  if (isApiFail(res, raw)) throw new Error(apiErrorMessage(raw, 'Load hierarchy failed'));
  hierarchyTree = asSystemForest(unwrapApi(raw));
  return hierarchyTree;
}

export function getHierarchyTreeCache() {
  return hierarchyTree;
}

/** Flatten functions as "System / Process / Function" options. */
export function flattenFunctionOptions(tree = hierarchyTree) {
  const opts = [];
  for (const sys of tree || []) {
    for (const proc of sys.children || []) {
      for (const fn of proc.children || []) {
        opts.push({
          id: fn.id,
          functionId: fn.functionId || fn.uid,
          name: fn.name,
          label: `${sys.name} / ${proc.name} / ${fn.name}`,
          systemId: sys.id,
          systemUuid: sys.systemId || sys.uid,
          processId: proc.id,
          processUuid: proc.processId || proc.moduleId || proc.uid,
        });
      }
    }
  }
  return opts;
}

export function findDefaultUnclassified(tree = hierarchyTree) {
  const sys = (tree || []).find(s => s.systemId === SEED_SYSTEM_ID || s.uid === SEED_SYSTEM_ID || s.name === '未分类');
  if (!sys) return null;
  const processes = sys.children || [];
  const proc = processes.find(p => p.processId === SEED_PROCESS_ID || p.uid === SEED_PROCESS_ID || p.name === '未分类')
    || processes[0];
  if (!proc) return null;
  const fn = (proc.children || []).find(f => f.functionId === SEED_FUNCTION_ID || f.uid === SEED_FUNCTION_ID || f.name === '未分类')
    || (proc.children || [])[0];
  if (!fn) return null;
  return { systemId: sys.id, processId: proc.id, functionId: fn.id };
}

function isSeedSystem(sys) {
  return sys?.systemId === SEED_SYSTEM_ID || sys?.uid === SEED_SYSTEM_ID;
}
function isSeedProcess(proc) {
  return proc?.processId === SEED_PROCESS_ID || proc?.uid === SEED_PROCESS_ID || proc?.moduleId === SEED_PROCESS_ID;
}
function isSeedFunction(fn) {
  return fn?.functionId === SEED_FUNCTION_ID || fn?.uid === SEED_FUNCTION_ID;
}

export function initHierarchy() {
  const refreshBtn = document.getElementById('hierRefreshBtn');
  const addSystemBtn = document.getElementById('hierAddSystemBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', () => loadHierarchyTree());
  if (addSystemBtn) {
    addSystemBtn.addEventListener('click', async () => {
      const name = prompt('新系统名称：');
      if (!name || !name.trim()) return;
      try {
        const res = await fetch('/api/v2/systems', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim() }),
        });
        const data = await readV2(res);
        await loadHierarchyTree();
      } catch (err) {
        alert('创建系统失败：' + err.message);
      }
    });
  }
  wireAccountDialog();
}

function wireAccountDialog() {
  const overlay = document.getElementById('hierAccountOverlay');
  const form = document.getElementById('hierAcctForm');
  if (!overlay || !form || form.dataset.wired === '1') return;
  form.dataset.wired = '1';

  const close = () => { overlay.style.display = 'none'; };
  document.getElementById('hierAcctClose')?.addEventListener('click', close);
  document.getElementById('hierAcctCancel')?.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('hierAcctId')?.value || '';
    const systemId = document.getElementById('hierAcctSystemId')?.value || '';
    const name = document.getElementById('hierAcctName')?.value?.trim() || '';
    if (!name) { alert('角色名称不能为空'); return; }
    const body = {
      name,
      loginUrl: document.getElementById('hierAcctUrl')?.value?.trim() || '',
      username: document.getElementById('hierAcctUser')?.value?.trim() || '',
      password: document.getElementById('hierAcctPass')?.value || '',
      remark: document.getElementById('hierAcctRemark')?.value?.trim() || null,
    };
    try {
      const res = await fetch(
        id ? `/api/v2/system-accounts/${id}` : `/api/v2/systems/${systemId}/accounts`,
        {
          method: id ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const data = await readV2(res);
      close();
      await loadHierarchyTree();
    } catch (err) {
      alert((id ? '更新' : '创建') + '账号失败：' + err.message);
    }
  });
}

function openAccountDialog({ mode = 'create', systemId, account = null, systemName = '' } = {}) {
  const overlay = document.getElementById('hierAccountOverlay');
  if (!overlay) return;
  const title = document.getElementById('hierAcctTitle');
  if (title) {
    title.textContent = mode === 'create'
      ? `新增账号 — ${systemName || '系统'}`
      : `编辑账号 — ${account?.name || ''}`;
  }
  document.getElementById('hierAcctId').value = mode === 'edit' && account?.id != null ? String(account.id) : '';
  document.getElementById('hierAcctSystemId').value = String(systemId || account?.systemId || '');
  document.getElementById('hierAcctName').value = account?.name || '';
  document.getElementById('hierAcctUrl').value = account?.loginUrl || '';
  document.getElementById('hierAcctUser').value = account?.username || '';
  document.getElementById('hierAcctPass').value = account?.password || '';
  document.getElementById('hierAcctRemark').value = account?.remark || '';
  overlay.style.display = 'flex';
  document.getElementById('hierAcctName')?.focus();
}

function renderAccountsBlock(sys) {
  const accounts = sys.accounts || [];
  if (!accounts.length) {
    return `<div style="padding:6px 12px;font-size:11px;color:var(--slate-400);border-bottom:1px solid var(--slate-100)">暂无测试账号 — 点击「+ 账号」添加管理员/测试人员等角色</div>`;
  }
  return `
    <div style="padding:6px 12px 8px;border-bottom:1px solid var(--slate-100);background:#fff">
      <div style="font-size:10px;color:var(--slate-400);margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em">测试账号</div>
      ${accounts.map((a) => {
        const bits = [escapeHtml(a.name)];
        if (a.username) bits.push(`<span style="color:var(--slate-500)">${escapeHtml(a.username)}</span>`);
        if (a.loginUrl) bits.push(`<span style="color:var(--slate-400);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;vertical-align:bottom">${escapeHtml(a.loginUrl)}</span>`);
        const remark = (a.remark || '').trim();
        return `<div class="hier-acct" data-id="${a.id}" style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px;border-bottom:1px dashed var(--slate-100)">
          <div style="flex:1;min-width:0;display:flex;gap:8px;align-items:center;flex-wrap:wrap">${bits.join('')}</div>
          ${remark ? `<span title="${escapeHtml(remark)}" style="font-size:10px;color:var(--slate-400);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(remark)}</span>` : ''}
          <button class="btn btn-outline btn-sm hier-edit-acct" data-id="${a.id}" data-system-id="${sys.id}" style="font-size:10px">编辑</button>
          <button class="btn btn-outline btn-sm hier-del-acct" data-id="${a.id}" style="font-size:10px;color:var(--red-500);border-color:var(--red-200)">删</button>
        </div>`;
      }).join('')}
    </div>`;
}

function renderSystemNode(sys) {
  const seed = isSeedSystem(sys);
  const processes = sys.children || [];
  const acctCount = (sys.accounts || []).length;
  return `
    <div class="hier-system" data-id="${sys.id}" style="border:1px solid var(--slate-200);border-radius:6px;margin-bottom:10px;overflow:hidden">
      <div style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--slate-50);border-bottom:1px solid var(--slate-100);flex-wrap:wrap">
        <strong style="color:var(--slate-800)">${escapeHtml(sys.name)}</strong>
        ${seed ? '<span style="font-size:10px;color:var(--slate-400);border:1px solid var(--slate-200);border-radius:3px;padding:0 4px">种子</span>' : ''}
        <span style="flex:1;font-size:11px;color:var(--slate-400)">${acctCount ? acctCount + ' 个账号' : '未配置账号'}</span>
        <button class="btn btn-outline btn-sm hier-add-acct" data-system-id="${sys.id}" data-system-name="${escapeHtml(sys.name)}" style="font-size:11px">+ 账号</button>
        <button class="btn btn-outline btn-sm hier-add-proc" data-system-id="${sys.id}" style="font-size:11px">+ 流程</button>
        <button class="btn btn-outline btn-sm hier-rename-sys" data-id="${sys.id}" data-name="${escapeHtml(sys.name)}" style="font-size:11px">重命名</button>
        ${seed ? '' : `<button class="btn btn-outline btn-sm hier-del-sys" data-id="${sys.id}" style="font-size:11px;color:var(--red-500);border-color:var(--red-200)">删除</button>`}
      </div>
      ${renderAccountsBlock(sys)}
      <div style="padding:4px 8px 8px 20px">
        ${processes.length
          ? processes.map(p => renderProcessNode(p, sys.id)).join('')
          : '<div style="padding:8px;font-size:12px;color:var(--slate-400)">暂无流程</div>'}
      </div>
    </div>`;
}

export async function loadHierarchyTree() {
  const loading = document.getElementById('hierLoading');
  const empty = document.getElementById('hierEmpty');
  const body = document.getElementById('hierTreeBody');
  if (!body) return;

  if (loading) loading.style.display = 'block';
  if (empty) empty.style.display = 'none';
  body.innerHTML = '';

  try {
    const tree = await fetchHierarchyTree();
    if (loading) loading.style.display = 'none';

    if (!tree.length) {
      if (empty) empty.style.display = 'block';
      return;
    }

    body.innerHTML = tree.map(renderSystemNode).join('');
    wireHierarchyActions(body);
  } catch (err) {
    if (loading) loading.style.display = 'none';
    body.innerHTML = `<p style="font-size:13px;color:var(--red-400);padding:12px">加载失败：${escapeHtml(err.message)}</p>`;
  }
}

function renderProcessNode(proc, systemId) {
  const seed = isSeedProcess(proc);
  const functions = proc.children || [];
  return `
    <div class="hier-process" data-id="${proc.id}" style="margin:6px 0;border-left:2px solid var(--indigo-200);padding-left:10px">
      <div style="display:flex;align-items:center;gap:6px;padding:4px 0">
        <span style="flex:1;font-size:13px;color:var(--slate-700)">${escapeHtml(proc.name)}</span>
        ${seed ? '<span style="font-size:9px;color:var(--slate-400)">种子</span>' : ''}
        <button class="btn btn-outline btn-sm hier-add-fn" data-process-id="${proc.id}" style="font-size:10px">+ 功能点</button>
        <button class="btn btn-outline btn-sm hier-rename-proc" data-id="${proc.id}" data-name="${escapeHtml(proc.name)}" style="font-size:10px">重命名</button>
        ${seed ? '' : `<button class="btn btn-outline btn-sm hier-del-proc" data-id="${proc.id}" style="font-size:10px;color:var(--red-500);border-color:var(--red-200)">删除</button>`}
      </div>
      <div style="padding-left:12px">
        ${functions.length
          ? functions.map(f => renderFunctionNode(f)).join('')
          : '<div style="padding:4px 0;font-size:11px;color:var(--slate-400)">暂无功能点</div>'}
      </div>
    </div>`;
}

function renderFunctionNode(fn) {
  const seed = isSeedFunction(fn);
  return `
    <div class="hier-fn" data-id="${fn.id}" style="margin:2px 0;padding:4px 0;border-bottom:1px dashed var(--slate-100)">
      <div style="display:flex;align-items:center;gap:6px;font-size:12px">
        <span style="flex:1;color:var(--slate-600)">▸ ${escapeHtml(fn.name)}</span>
        <span style="font-family:var(--font-mono);font-size:10px;color:var(--slate-400)">id=${fn.id}</span>
        ${seed ? '<span style="font-size:9px;color:var(--slate-400)">种子</span>' : ''}
        <button class="btn btn-outline btn-sm hier-load-traj" data-id="${fn.id}" style="font-size:10px">轨迹</button>
        <button class="btn btn-outline btn-sm hier-rename-fn" data-id="${fn.id}" data-name="${escapeHtml(fn.name)}" style="font-size:10px">重命名</button>
        ${seed ? '' : `<button class="btn btn-outline btn-sm hier-del-fn" data-id="${fn.id}" style="font-size:10px;color:var(--red-500);border-color:var(--red-200)">删除</button>`}
      </div>
      <div class="hier-fn-trajs" data-fn-id="${fn.id}" style="display:none;padding:4px 0 4px 16px;font-size:11px;color:var(--slate-500)"></div>
    </div>`;
}

function wireHierarchyActions(root) {
  root.querySelectorAll('.hier-add-acct').forEach(b => b.addEventListener('click', () => {
    openAccountDialog({
      mode: 'create',
      systemId: b.dataset.systemId,
      systemName: b.dataset.systemName || '',
    });
  }));

  root.querySelectorAll('.hier-edit-acct').forEach(b => b.addEventListener('click', () => {
    const sys = hierarchyTree.find(s => String(s.id) === String(b.dataset.systemId));
    const account = (sys?.accounts || []).find(a => String(a.id) === String(b.dataset.id));
    if (!account) { alert('未找到该账号'); return; }
    openAccountDialog({
      mode: 'edit',
      systemId: sys.id,
      systemName: sys.name,
      account: { ...account, systemId: sys.id },
    });
  }));

  root.querySelectorAll('.hier-del-acct').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('删除该测试账号？')) return;
    try {
      const res = await fetch(`/api/v2/system-accounts/${b.dataset.id}`, { method: 'DELETE' });
      const data = await readV2(res);
      await loadHierarchyTree();
    } catch (err) {
      alert('删除账号失败：' + err.message);
    }
  }));

  root.querySelectorAll('.hier-add-proc').forEach(b => b.addEventListener('click', async () => {
    const name = prompt('新流程名称：');
    if (!name || !name.trim()) return;
    try {
      const res = await fetch(`/api/v2/systems/${b.dataset.systemId}/processes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), sortOrder: 0 }),
      });
      const data = await readV2(res);
      await loadHierarchyTree();
    } catch (err) {
      alert('创建流程失败：' + err.message);
    }
  }));

  root.querySelectorAll('.hier-add-fn').forEach(b => b.addEventListener('click', async () => {
    const name = prompt('新功能点名称：');
    if (!name || !name.trim()) return;
    try {
      const res = await fetch(`/api/v2/processes/${b.dataset.processId}/functions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), sortOrder: 0 }),
      });
      const data = await readV2(res);
      await loadHierarchyTree();
    } catch (err) {
      alert('创建功能点失败：' + err.message);
    }
  }));

  root.querySelectorAll('.hier-rename-sys').forEach(b => b.addEventListener('click', async () => {
    const name = prompt('系统新名称：', b.dataset.name);
    if (!name || !name.trim()) return;
    await renameEntity('systems', b.dataset.id, name.trim());
  }));
  root.querySelectorAll('.hier-rename-proc').forEach(b => b.addEventListener('click', async () => {
    const name = prompt('流程新名称：', b.dataset.name);
    if (!name || !name.trim()) return;
    await renameEntity('processes', b.dataset.id, name.trim());
  }));
  root.querySelectorAll('.hier-rename-fn').forEach(b => b.addEventListener('click', async () => {
    const name = prompt('功能点新名称：', b.dataset.name);
    if (!name || !name.trim()) return;
    await renameEntity('functions', b.dataset.id, name.trim());
  }));

  root.querySelectorAll('.hier-del-sys').forEach(b => b.addEventListener('click', () =>
    deleteEntity('systems', b.dataset.id, '系统')));
  root.querySelectorAll('.hier-del-proc').forEach(b => b.addEventListener('click', () =>
    deleteEntity('processes', b.dataset.id, '流程')));
  root.querySelectorAll('.hier-del-fn').forEach(b => b.addEventListener('click', () =>
    deleteEntity('functions', b.dataset.id, '功能点')));

  root.querySelectorAll('.hier-load-traj').forEach(b => b.addEventListener('click', async () => {
    const fnId = b.dataset.id;
    const box = root.querySelector('.hier-fn-trajs[data-fn-id="' + fnId + '"]');
    if (!box) return;
    if (box.style.display !== 'none' && box.dataset.loaded === '1') {
      box.style.display = 'none';
      return;
    }
    box.style.display = 'block';
    box.textContent = '加载中…';
    try {
      const res = await fetch('/api/v2/trajectories?functionId=' + encodeURIComponent(fnId) + '&page=1&pageSize=50');
      const data = await readV2(res);
      const rows = data.rows || [];
      if (!rows.length) {
        box.innerHTML = '<div style="color:var(--slate-400)">暂无轨迹</div>';
      } else {
        box.innerHTML = rows.map((t) => {
          const task = escapeHtml((t.task || '').slice(0, 40));
          return `<div style="padding:2px 0;display:flex;gap:8px;align-items:center">
            <span style="font-family:var(--font-mono);color:var(--indigo-600)">#${t.id}</span>
            <span>${t.phaseCount ?? 0} 阶段 / ${t.stepCount ?? 0} 步</span>
            <span style="color:var(--slate-400);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px">${task}</span>
          </div>`;
        }).join('');
      }
      box.dataset.loaded = '1';
    } catch (err) {
      box.innerHTML = '<div style="color:var(--red-400)">失败：' + escapeHtml(err.message) + '</div>';
    }
  }));
}

async function renameEntity(kind, id, name) {
  try {
    const res = await fetch(`/api/v2/${kind}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await readV2(res);
    await loadHierarchyTree();
  } catch (err) {
    alert('重命名失败：' + err.message);
  }
}

async function deleteEntity(kind, id, label) {
  if (!confirm(`删除该${label}？`)) return;
  try {
    const res = await fetch(`/api/v2/${kind}/${id}`, { method: 'DELETE' });
    const data = await readV2(res);
    await loadHierarchyTree();
  } catch (err) {
    alert('删除失败：' + err.message);
  }
}
