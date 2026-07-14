import { escapeHtml } from './swagger-api.js';

const SEED_SYSTEM_ID = '00000000-0000-0000-0000-000000000001';
const SEED_PROCESS_ID = '00000000-0000-0000-0000-000000000002';
const SEED_FUNCTION_ID = '00000000-0000-0000-0000-000000000003';

/** @type {Array} */
let hierarchyTree = [];

export async function fetchHierarchyTree() {
  const res = await fetch('/api/v2/hierarchy/tree');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Load hierarchy failed');
  hierarchyTree = Array.isArray(data) ? data : [];
  return hierarchyTree;
}

export function getHierarchyTreeCache() {
  return hierarchyTree;
}

/** Flatten functions as "System / Process / Function" options. */
export function flattenFunctionOptions(tree = hierarchyTree) {
  const opts = [];
  for (const sys of tree || []) {
    for (const proc of sys.processes || []) {
      for (const fn of proc.functions || []) {
        opts.push({
          id: fn.id,
          functionId: fn.functionId,
          name: fn.name,
          label: `${sys.name} / ${proc.name} / ${fn.name}`,
          systemId: sys.id,
          systemUuid: sys.systemId,
          processId: proc.id,
          processUuid: proc.processId,
        });
      }
    }
  }
  return opts;
}

export function findDefaultUnclassified(tree = hierarchyTree) {
  const sys = (tree || []).find(s => s.systemId === SEED_SYSTEM_ID || s.name === '未分类');
  if (!sys) return null;
  const proc = (sys.processes || []).find(p => p.processId === SEED_PROCESS_ID || p.name === '未分类')
    || (sys.processes || [])[0];
  if (!proc) return null;
  const fn = (proc.functions || []).find(f => f.functionId === SEED_FUNCTION_ID || f.name === '未分类')
    || (proc.functions || [])[0];
  if (!fn) return null;
  return { systemId: sys.id, processId: proc.id, functionId: fn.id };
}

function isSeedSystem(sys) {
  return sys?.systemId === SEED_SYSTEM_ID;
}
function isSeedProcess(proc) {
  return proc?.processId === SEED_PROCESS_ID;
}
function isSeedFunction(fn) {
  return fn?.functionId === SEED_FUNCTION_ID;
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
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Create failed');
        await loadHierarchyTree();
      } catch (err) {
        alert('创建系统失败：' + err.message);
      }
    });
  }
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

function renderSystemNode(sys) {
  const seed = isSeedSystem(sys);
  const processes = sys.processes || [];
  return `
    <div class="hier-system" data-id="${sys.id}" style="border:1px solid var(--slate-200);border-radius:6px;margin-bottom:10px;overflow:hidden">
      <div style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--slate-50);border-bottom:1px solid var(--slate-100)">
        <strong style="flex:1;color:var(--slate-800)">${escapeHtml(sys.name)}</strong>
        ${seed ? '<span style="font-size:10px;color:var(--slate-400);border:1px solid var(--slate-200);border-radius:3px;padding:0 4px">种子</span>' : ''}
        <button class="btn btn-outline btn-sm hier-add-proc" data-system-id="${sys.id}" style="font-size:11px">+ 流程</button>
        <button class="btn btn-outline btn-sm hier-rename-sys" data-id="${sys.id}" data-name="${escapeHtml(sys.name)}" style="font-size:11px">重命名</button>
        ${seed ? '' : `<button class="btn btn-outline btn-sm hier-del-sys" data-id="${sys.id}" style="font-size:11px;color:var(--red-500);border-color:var(--red-200)">删除</button>`}
      </div>
      <div style="padding:4px 8px 8px 20px">
        ${processes.length
          ? processes.map(p => renderProcessNode(p, sys.id)).join('')
          : '<div style="padding:8px;font-size:12px;color:var(--slate-400)">暂无流程</div>'}
      </div>
    </div>`;
}

function renderProcessNode(proc, systemId) {
  const seed = isSeedProcess(proc);
  const functions = proc.functions || [];
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
  root.querySelectorAll('.hier-add-proc').forEach(b => b.addEventListener('click', async () => {
    const name = prompt('新流程名称：');
    if (!name || !name.trim()) return;
    try {
      const res = await fetch(`/api/v2/systems/${b.dataset.systemId}/processes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), sortOrder: 0 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Create failed');
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Create failed');
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Load failed');
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
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Rename failed');
    await loadHierarchyTree();
  } catch (err) {
    alert('重命名失败：' + err.message);
  }
}

async function deleteEntity(kind, id, label) {
  if (!confirm(`删除该${label}？`)) return;
  try {
    const res = await fetch(`/api/v2/${kind}/${id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Delete failed');
    await loadHierarchyTree();
  } catch (err) {
    alert('删除失败：' + err.message);
  }
}
