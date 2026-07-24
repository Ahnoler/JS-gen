// Hierarchy cascading selects + login account pickers

import { setActionFlowTrajectory, setActionFlowHandlers, setSelectedActionFlowPhaseId, reloadActionFlow } from '../recording-flow.js';
import { fetchHierarchyTree, findDefaultUnclassified } from '../hierarchy.js';
import { unwrapApi, apiErrorMessage, isApiFail } from '../api-envelope.js';
import {
  HIER_STORAGE_KEY,
  TRAJ_STORAGE_KEY,
  PHASE_STORAGE_KEY,
  getSelectedFunctionId,
  getSelectedTrajectoryDbId,
  getSelectedPhaseId,
} from './state.js';

export function wirePickers(ctx) {
  async function refreshLoginAccountSelectors() {
    if (!ctx.sessLoginSystem) return;
    try {
      ctx.loginHierTree = await fetchHierarchyTree();
    } catch (err) {
      console.warn('[session] login hierarchy load failed:', err.message);
      ctx.loginHierTree = [];
    }
    const prevSys = ctx.sessLoginSystem.value;
    const prevAcct = ctx.sessLoginAccount?.value || '';
    ctx.sessLoginSystem.innerHTML = '<option value="">手动填写…</option>';
    ctx.loginHierTree.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = String(s.id);
      const n = (s.accounts || []).length;
      opt.textContent = n ? `${s.name}（${n} 账号）` : s.name;
      ctx.sessLoginSystem.appendChild(opt);
    });
    if (prevSys && [...ctx.sessLoginSystem.options].some((o) => o.value === prevSys)) {
      ctx.sessLoginSystem.value = prevSys;
    }
    fillLoginAccountOptions(ctx.sessLoginSystem.value, prevAcct);
  }

  function fillLoginAccountOptions(systemId, selectedAccountId = null) {
    if (!ctx.sessLoginAccount) return;
    ctx.sessLoginAccount.innerHTML = '';
    if (!systemId) {
      ctx.sessLoginAccount.disabled = true;
      ctx.sessLoginAccount.innerHTML = '<option value="">先选系统…</option>';
      if (ctx.sessLoginRemark) ctx.sessLoginRemark.style.display = 'none';
      return;
    }
    const sys = ctx.loginHierTree.find((s) => String(s.id) === String(systemId));
    const accounts = sys?.accounts || [];
    if (!accounts.length) {
      ctx.sessLoginAccount.disabled = true;
      ctx.sessLoginAccount.innerHTML = '<option value="">该系统暂无账号</option>';
      if (ctx.sessLoginRemark) {
        ctx.sessLoginRemark.style.display = 'block';
        ctx.sessLoginRemark.textContent = '请到「层级」页为该系统添加测试账号';
      }
      return;
    }
    ctx.sessLoginAccount.disabled = false;
    ctx.sessLoginAccount.innerHTML = '<option value="">选择角色账号…</option>';
    accounts.forEach((a) => {
      const opt = document.createElement('option');
      opt.value = String(a.id);
      opt.textContent = a.username ? `${a.name}（${a.username}）` : a.name;
      ctx.sessLoginAccount.appendChild(opt);
    });
    if (selectedAccountId && [...ctx.sessLoginAccount.options].some((o) => o.value === String(selectedAccountId))) {
      ctx.sessLoginAccount.value = String(selectedAccountId);
      applyLoginAccount(ctx.sessLoginAccount.value);
    } else if (accounts.length === 1) {
      ctx.sessLoginAccount.value = String(accounts[0].id);
      applyLoginAccount(ctx.sessLoginAccount.value);
    } else if (ctx.sessLoginRemark) {
      ctx.sessLoginRemark.style.display = 'none';
    }
  }

  function applyLoginAccount(accountId) {
    if (!accountId) {
      if (ctx.sessLoginRemark) ctx.sessLoginRemark.style.display = 'none';
      return;
    }
    const sys = ctx.loginHierTree.find((s) => String(s.id) === String(ctx.sessLoginSystem?.value));
    const account = (sys?.accounts || []).find((a) => String(a.id) === String(accountId));
    if (!account) return;
    if (ctx.sessLoginUrl) ctx.sessLoginUrl.value = account.loginUrl || '';
    if (ctx.sessLoginUser) ctx.sessLoginUser.value = account.username || '';
    if (ctx.sessLoginPass) ctx.sessLoginPass.value = account.password || '';
    if (ctx.sessLoginRemark) {
      const remark = (account.remark || '').trim();
      if (remark) {
        ctx.sessLoginRemark.style.display = 'block';
        ctx.sessLoginRemark.textContent = '备注：' + remark;
      } else {
        ctx.sessLoginRemark.style.display = 'none';
      }
    }
  }

  if (ctx.sessLoginSystem) {
    ctx.sessLoginSystem.addEventListener('change', () => fillLoginAccountOptions(ctx.sessLoginSystem.value, null));
  }
  if (ctx.sessLoginAccount) {
    ctx.sessLoginAccount.addEventListener('change', () => applyLoginAccount(ctx.sessLoginAccount.value));
  }

  if (ctx.sessLoginToggle && ctx.sessLoginSection) {
    ctx.sessLoginToggle.addEventListener('click', async () => {
      const hidden = ctx.sessLoginSection.style.display === 'none';
      ctx.sessLoginSection.style.display = hidden ? '' : 'none';
      ctx.sessLoginToggle.textContent = hidden ? '收起' : '展开';
      if (hidden) await refreshLoginAccountSelectors();
    });
  }

  if (ctx.sessLoginBtn) {
    ctx.sessLoginBtn.addEventListener('click', async () => {
      const url = ctx.sessLoginUrl?.value.trim();
      const user = ctx.sessLoginUser?.value.trim();
      const pass = ctx.sessLoginPass?.value.trim();
      if (!url) { ctx.sessLog('error', '目标地址不能为空'); return; }

      let sessionId = ctx.sessActive.value;
      if (!sessionId) {
        ctx.sessNewBtn.disabled = true;
        ctx.sessStatus.textContent = '创建中…';
        ctx.sessLog('system', '正在为登录创建新会话…');
        try {
          const res = await fetch('/api/browser/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: ctx.sessModel?.value || undefined }),
          });
          if (!res.ok) throw new Error((await res.json()).error || 'Failed');
          const data = await res.json();
          sessionId = data.sessionId;
          await window.loadActiveSessions();
          ctx.sessActive.value = data.sessionId;
          ctx.onSessionChange();
          ctx.sessLog('success', '会话已创建：' + data.sessionId);
        } catch (err) {
          ctx.sessLog('error', '创建会话失败：' + err.message);
          ctx.sessNewBtn.disabled = false;
          return;
        }
        ctx.sessNewBtn.disabled = false;
      }

      let loginTask = 'Navigate to ' + url;
      if (user) loginTask += '\nEnter username: ' + user;
      if (pass) loginTask += '\nEnter password: ' + pass;
      loginTask += '\nClick the login/submit button\nWait for the page to fully load after login';

      await ctx.executeSessionStep(sessionId, loginTask, 30, 'Login: ' + url);
    });
  }

  function persistFunctionSelection() {
    const id = getSelectedFunctionId(ctx);
    if (id != null) sessionStorage.setItem(HIER_STORAGE_KEY, String(id));
  }

  function persistPhaseSelection() {
    const id = getSelectedPhaseId(ctx);
    if (id != null) sessionStorage.setItem(PHASE_STORAGE_KEY, String(id));
    else sessionStorage.removeItem(PHASE_STORAGE_KEY);
    setSelectedActionFlowPhaseId(id, { silent: true });
    const trajId = getSelectedTrajectoryDbId(ctx);
    if (ctx.sessActive?.value && trajId != null) {
      let qs = '/action-flow?trajectoryId=' + encodeURIComponent(String(trajId));
      if (id != null) qs += '&phaseId=' + encodeURIComponent(String(id));
      fetch('/api/browser/session/' + encodeURIComponent(ctx.sessActive.value) + qs).catch(() => {});
    }
  }

  async function createPhaseForCurrentTrajectory(descriptionHint) {
    const trajId = getSelectedTrajectoryDbId(ctx);
    if (trajId == null) {
      alert('请先选择轨迹');
      return null;
    }
    const description = prompt('阶段描述（将作为 AI 执行指令）：', descriptionHint || '') || '';
    if (!description.trim()) return null;
    try {
      const res = await fetch('/api/v2/trajectories/' + encodeURIComponent(trajId) + '/phases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: description.trim() }),
      });
      const raw = await res.json();
      if (isApiFail(res, raw)) throw new Error(apiErrorMessage(raw, 'create phase failed'));
      const data = unwrapApi(raw);
      await refreshPhaseSelect(trajId, data.id);
      if (ctx.sessPhaseSelect) ctx.sessPhaseSelect.value = String(data.id);
      persistPhaseSelection();
      reloadActionFlow(ctx.sessActive?.value);
      ctx.sessLog('success', '已创建阶段 #' + data.id + ' · P' + data.phaseNumber);
      return data;
    } catch (err) {
      alert('创建阶段失败：' + err.message);
      return null;
    }
  }

  async function refreshPhaseSelect(trajectoryId, preferPhaseId) {
    if (!ctx.sessPhaseSelect) return;
    ctx.sessPhaseSelect.innerHTML = '<option value="">末尾阶段（默认）</option>';
    if (trajectoryId == null) return;
    try {
      const res = await fetch('/api/v2/trajectories/' + encodeURIComponent(trajectoryId) + '/tree');
      const raw = await res.json();
      if (isApiFail(res, raw)) throw new Error(apiErrorMessage(raw, 'tree failed'));
      const data = unwrapApi(raw) || {};
      const phases = data.phases || [];
      phases.forEach((p) => {
        const opt = document.createElement('option');
        opt.value = String(p.id);
        const desc = (p.description || '').slice(0, 24);
        opt.textContent = 'P' + (p.phaseNumber ?? '?') + ' #' + p.id
          + (desc ? ' · ' + desc : '')
          + ' (' + (p.steps?.length ?? 0) + '步)';
        ctx.sessPhaseSelect.appendChild(opt);
      });
      const prefer = preferPhaseId != null
        ? preferPhaseId
        : Number(sessionStorage.getItem(PHASE_STORAGE_KEY));
      if (Number.isFinite(prefer) && Array.from(ctx.sessPhaseSelect.options).some((o) => o.value === String(prefer))) {
        ctx.sessPhaseSelect.value = String(prefer);
      }
    } catch (err) {
      console.warn('[session] phase list failed:', err.message);
    }
  }
  ctx.refreshPhaseSelect = refreshPhaseSelect;

  function persistTrajectorySelection() {
    const id = getSelectedTrajectoryDbId(ctx);
    if (id != null) sessionStorage.setItem(TRAJ_STORAGE_KEY, String(id));
    else sessionStorage.removeItem(TRAJ_STORAGE_KEY);
    setActionFlowTrajectory(id);
    refreshPhaseSelect(id).then(() => persistPhaseSelection());
    reloadActionFlow(ctx.sessActive?.value);
  }

  async function refreshTrajectorySelect(functionId, selectedId) {
    if (!ctx.sessTrajectorySelect) return;
    ctx.sessTrajectorySelect.innerHTML = '<option value="">新建轨迹（保存时创建）</option>';
    if (functionId == null) return;
    try {
      const res = await fetch('/api/v2/trajectories?functionId=' + encodeURIComponent(functionId) + '&page=1&pageSize=50');
      const raw = await res.json();
      if (isApiFail(res, raw)) throw new Error(apiErrorMessage(raw, 'load failed'));
      const data = unwrapApi(raw) || {};
      (data.rows || []).forEach((t) => {
        const opt = document.createElement('option');
        opt.value = String(t.id);
        const task = (t.task || '').slice(0, 28);
        opt.textContent = '#' + t.id + ' · ' + (t.phaseCount ?? '?') + '阶段 / ' + (t.stepCount ?? 0) + '步'
          + (task ? ' · ' + task : '');
        ctx.sessTrajectorySelect.appendChild(opt);
      });
      if (selectedId != null) ctx.sessTrajectorySelect.value = String(selectedId);
    } catch (err) {
      console.warn('[session] trajectory list failed:', err.message);
    }
  }
  ctx.refreshTrajectorySelect = refreshTrajectorySelect;

  function fillProcessOptions(systemId, selectedProcessId) {
    if (!ctx.sessHierProcess) return;
    ctx.sessHierProcess.innerHTML = '<option value="">模块…</option>';
    const sys = ctx.hierTree.find(s => String(s.id) === String(systemId));
    (sys?.children || []).forEach(p => {
      const opt = document.createElement('option');
      opt.value = String(p.id);
      opt.textContent = p.name;
      ctx.sessHierProcess.appendChild(opt);
    });
    if (selectedProcessId != null) ctx.sessHierProcess.value = String(selectedProcessId);
  }

  function fillFunctionOptions(systemId, processId, selectedFunctionId) {
    if (!ctx.sessHierFunction) return;
    ctx.sessHierFunction.innerHTML = '<option value="">功能…</option>';
    const sys = ctx.hierTree.find(s => String(s.id) === String(systemId));
    const proc = (sys?.children || []).find(p => String(p.id) === String(processId));
    (proc?.children || []).forEach(f => {
      const opt = document.createElement('option');
      opt.value = String(f.id);
      opt.textContent = f.name;
      ctx.sessHierFunction.appendChild(opt);
    });
    if (selectedFunctionId != null) ctx.sessHierFunction.value = String(selectedFunctionId);
  }

  function applyHierarchySelection(sel) {
    if (!sel || !ctx.sessHierSystem) return;
    ctx.sessHierSystem.value = String(sel.systemId);
    fillProcessOptions(sel.systemId, sel.processId);
    fillFunctionOptions(sel.systemId, sel.processId, sel.functionId);
    persistFunctionSelection();
    const storedTraj = Number(sessionStorage.getItem(TRAJ_STORAGE_KEY));
    refreshTrajectorySelect(sel.functionId, Number.isFinite(storedTraj) ? storedTraj : null).then(() => {
      persistTrajectorySelection();
    });
  }

  async function initHierarchySelects() {
    if (!ctx.sessHierSystem || !ctx.sessHierProcess || !ctx.sessHierFunction) return;
    try {
      ctx.hierTree = await fetchHierarchyTree();
    } catch (err) {
      console.warn('[session] hierarchy load failed:', err.message);
      return;
    }

    ctx.sessHierSystem.innerHTML = '<option value="">系统…</option>';
    ctx.hierTree.forEach(s => {
      const opt = document.createElement('option');
      opt.value = String(s.id);
      opt.textContent = s.name;
      ctx.sessHierSystem.appendChild(opt);
    });

    const stored = Number(sessionStorage.getItem(HIER_STORAGE_KEY));
    let applied = false;
    if (Number.isFinite(stored)) {
      for (const sys of ctx.hierTree) {
        for (const proc of sys.children || []) {
          const fn = (proc.children || []).find(f => f.id === stored);
          if (fn) {
            applyHierarchySelection({ systemId: sys.id, processId: proc.id, functionId: fn.id });
            applied = true;
            break;
          }
        }
        if (applied) break;
      }
    }
    if (!applied) {
      const def = findDefaultUnclassified(ctx.hierTree);
      if (def) applyHierarchySelection(def);
    }

    ctx.sessHierSystem.addEventListener('change', () => {
      fillProcessOptions(ctx.sessHierSystem.value, null);
      fillFunctionOptions(ctx.sessHierSystem.value, ctx.sessHierProcess.value, null);
      refreshTrajectorySelect(null);
    });
    ctx.sessHierProcess.addEventListener('change', () => {
      fillFunctionOptions(ctx.sessHierSystem.value, ctx.sessHierProcess.value, null);
      refreshTrajectorySelect(null);
    });
    ctx.sessHierFunction.addEventListener('change', () => {
      persistFunctionSelection();
      refreshTrajectorySelect(getSelectedFunctionId(ctx), null);
    });
    if (ctx.sessTrajectorySelect) {
      ctx.sessTrajectorySelect.addEventListener('change', persistTrajectorySelection);
    }
    if (ctx.sessPhaseSelect) {
      ctx.sessPhaseSelect.addEventListener('change', persistPhaseSelection);
    }
    const sessNewPhaseBtn = document.getElementById('sessNewPhaseBtn');
    if (sessNewPhaseBtn) {
      sessNewPhaseBtn.addEventListener('click', () => createPhaseForCurrentTrajectory(''));
    }

    setActionFlowHandlers({
      onPhaseSelect(phaseId) {
        if (ctx.sessPhaseSelect) {
          ctx.sessPhaseSelect.value = phaseId != null ? String(phaseId) : '';
        }
        persistPhaseSelection();
        if (phaseId != null) {
          ctx.sessLog('system', '已选中 phase#' + phaseId + '（人工录制将写入该阶段）');
        } else {
          ctx.sessLog('system', '已取消选中阶段（人工录制写入末尾阶段）');
        }
      },
      onPhaseExecute(phase) {
        if (!ctx.sessActive?.value) { ctx.sessLog('error', '无活跃会话'); return; }
        const task = phase.description || '';
        if (!task.trim()) { alert('阶段描述为空，请先编辑或重新创建'); return; }
        const label = '阶段' + (phase.phaseNumber || '?') + '：' + task.slice(0, 40);
        ctx.executeSessionStep(
          ctx.sessActive.value,
          task,
          100,
          label,
          undefined,
          phase.phaseNumber,
        );
      },
      onPhaseCreate() {
        createPhaseForCurrentTrajectory('');
      },
    });

    if (ctx.sessNewTrajBtn) {
      ctx.sessNewTrajBtn.addEventListener('click', async () => {
        const functionId = getSelectedFunctionId(ctx);
        if (functionId == null) { alert('请先选择功能'); return; }
        const task = prompt('轨迹备注（可选）：', '') || '';
        try {
          const res = await fetch('/api/v2/trajectories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              functionId,
              task,
              model: ctx.sessModel?.value || '',
            }),
          });
          const raw = await res.json();
          if (isApiFail(res, raw)) throw new Error(apiErrorMessage(raw, 'Create failed'));
          const data = unwrapApi(raw);
          sessionStorage.setItem(TRAJ_STORAGE_KEY, String(data.id));
          await refreshTrajectorySelect(functionId, data.id);
          persistTrajectorySelection();
          ctx.sessLog('success', '已创建轨迹 #' + data.id);
        } catch (err) {
          alert('创建轨迹失败：' + err.message);
        }
      });
    }
  }

  initHierarchySelects();
}
