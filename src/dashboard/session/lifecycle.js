// Session lifecycle: create/load/step/cancel/save/reset/close + session list WS

import { on, send, isConnected } from '../ws-client.js';
import { setActionFlowSession, reloadActionFlow, setActionFlowTrajectory } from '../recording-flow.js';
import {
  TRAJ_STORAGE_KEY,
  persistPhaseDescriptions,
  getSelectedFunctionId,
  getSelectedTrajectoryDbId,
} from './state.js';
import { createSSEEventHandler, readSSEStream } from './sse.js';

export function wireLifecycle(ctx) {
  async function executeSessionStep(sessionId, task, maxSteps, label, phaseIdx, phaseNumber) {
    ctx.setUILocked(true);
    ctx.sessStatus.textContent = '执行中…';
    const stepNum = (parseInt(ctx.sessStepCount.textContent) || 0) + 1;
    ctx.sessStepCount.textContent = stepNum + ' steps';
    ctx.sessTimelineStep('step-' + stepNum, 'running', label, task.slice(0, 80));
    ctx.sessLog('system', '步骤 ' + stepNum + ': ' + label);
    if (phaseIdx !== undefined) ctx.sessPhaseUpdateStatus(phaseIdx, 'running');

    if (phaseNumber != null && task) {
      if (!window.__phaseDescriptions__) window.__phaseDescriptions__ = {};
      window.__phaseDescriptions__[String(phaseNumber)] = task;
      persistPhaseDescriptions();
    }

    const caseDataFile = document.getElementById('sessCaseDataFile')?.value?.trim() || undefined;
    const pn = phaseNumber != null ? Number(phaseNumber) : undefined;
    const trajectoryDbId = getSelectedTrajectoryDbId(ctx);

    ctx.sessAbortController = new AbortController();
    try {
      if (isConnected()) {
        await new Promise((resolve) => {
          const handler = createSSEEventHandler(ctx, stepNum, label, phaseIdx);
          const subs = [
            on('session:step', (d) => handler('step', d)),
            on('session:phase_start', (d) => handler('phase_start', d)),
            on('session:phase_done', (d) => { unsubAll(); handler('phase_done', d); resolve(); }),
            on('session:phase_error', (d) => { unsubAll(); handler('phase_error', d); resolve(); }),
            on('session:error', (d) => { unsubAll(); handler('error', d); resolve(); }),
            on('session:nav_step', (d) => handler('nav_step', d)),
            on('session:intervention_needed', (d) => handler('intervention_needed', d)),
            on('session:intervention_resolved', (d) => handler('intervention_resolved', d)),
            on('session:done', () => { unsubAll(); resolve(); }),
          ];
          const unsubAll = () => subs.forEach(fn => fn());
          ctx.sessAbortController.signal.addEventListener('abort', () => {
            resolve();
          });
          send('session:step', {
            sessionId, task, maxSteps, caseDataFile, phaseNumber: pn,
            ...(trajectoryDbId != null ? { trajectoryDbId } : {}),
          });
        });
      } else {
        const resp = await fetch('/api/browser/session/' + sessionId + '/step', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            task, maxSteps, caseDataFile, phaseNumber: pn,
            ...(trajectoryDbId != null ? { trajectoryDbId } : {}),
          }),
          signal: ctx.sessAbortController.signal,
        });
        if (!resp.ok) { const err = await resp.json().catch(() => ({ error: 'HTTP ' + resp.status })); throw new Error(err.error || 'Request failed'); }

        const handler = createSSEEventHandler(ctx, stepNum, label, phaseIdx);
        await readSSEStream(ctx, resp.body.getReader(), handler);
      }
    } catch (err) {
      const isAbort = err.name === 'AbortError';
      ctx.sessLog(isAbort ? 'system' : 'error', isAbort ? '已取消' : err.message);
      ctx.sessTimelineStep('step-' + stepNum, 'failed', label, isAbort ? '已取消' : err.message.slice(0, 100));
      if (phaseIdx !== undefined) ctx.sessPhaseUpdateStatus(phaseIdx, 'failed');
    }
    ctx.sessAbortController = null;
    ctx.setUILocked(false);
  }
  ctx.executeSessionStep = executeSessionStep;

  function onSessionChange() {
    const active = ctx.sessActive.value;
    setActionFlowSession(active || null);
    if (!active) {
      ctx.sessStatus.textContent = '无活跃会话';
      ctx.sessTrajectoryId.textContent = '';
      if (ctx.sessTrajPath) { ctx.sessTrajPath.style.display = 'none'; ctx.sessTrajPath.textContent = ''; }
      ctx.sessStepCount.textContent = '0 步';
      ctx.sessTimeline.innerHTML = '<div class="empty-state" style="padding:20px"><p>发送步骤指令以开始</p></div>';
      document.getElementById('sessPhasePlan').style.display = 'none';
      ctx.interventionFields = [];
      const alerts = document.getElementById('sessInterventionAlerts');
      const badge = document.getElementById('sessInterventionBadge');
      if (alerts) alerts.innerHTML = '';
      if (badge) badge.style.display = 'none';
      ctx.setInterventionCardMode('normal');
      ctx.sessionPhases = [];
      ctx.updateButtons();
      return;
    }
    fetch('/api/browser/session/' + active + '/trajectories').then(r => r.json()).then(data => {
      ctx.sessStatus.textContent = '活跃 ' + active.slice(0, 8) + '... | ' + data.stepIndex + ' 步' + (data.busy ? ' (忙碌)' : '');
      ctx.sessStepCount.textContent = data.stepIndex + ' steps';
      if (ctx.sessTimeline && data.steps && data.steps.length > 0) {
        ctx.sessTimeline.innerHTML = '';
        data.steps.forEach(s => {
          const time = s.time ? new Date(s.time).toLocaleString() : '';
          ctx.sessTimelineStep('step-' + s.step, 'success', '步骤 ' + s.step, time);
        });
      }
      ctx.updateButtons();
      if (data.busy) {
        ctx.sessStepBtn.disabled = true;
        ctx.sessCancelBtn.disabled = false;
      }
    }).catch(() => {
      ctx.sessStatus.textContent = '会话已退出';
      ctx.sessActive.value = '';
      ctx.updateButtons();
    });
  }
  ctx.onSessionChange = onSessionChange;

  window.loadActiveSessions = async function () {
    if (!ctx.sessActive) return;
    try {
      const res = await fetch('/api/browser/sessions');
      const list = await res.json();
      const currentVal = ctx.sessActive.value;
      ctx.sessActive.innerHTML = '<option value="">(none)</option>';
      list.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.sessionId;
        const short = s.sessionId.slice(0, 8);
        const busy = s.busy ? ' [busy]' : '';
        opt.textContent = short + '... [' + s.stepIndex + ']' + busy + ' ' + (s.model || '').slice(0, 20);
        ctx.sessActive.appendChild(opt);
      });
      if (currentVal && Array.from(ctx.sessActive.options).some(o => o.value === currentVal)) {
        ctx.sessActive.value = currentVal;
      }
      if (ctx.sessCloseBrowserBtn) ctx.sessCloseBrowserBtn.style.display = list.length > 0 ? '' : 'none';
      onSessionChange();
      return list;
    } catch (e) {
      console.error('Failed to load sessions:', e);
    }
  };

  function renderSessionList(sessions) {
    const list = sessions || [];
    if (!ctx.sessListBody) return;

    if (ctx.sessListCard) ctx.sessListCard.style.display = list.length > 0 ? '' : 'none';
    if (ctx.sessListCount) ctx.sessListCount.textContent = list.length + ' 个会话';

    if (list.length === 0) {
      ctx.sessListBody.innerHTML = '';
      if (ctx.sessListEmpty) ctx.sessListEmpty.style.display = '';
      return;
    }
    if (ctx.sessListEmpty) ctx.sessListEmpty.style.display = 'none';

    const isSelected = (id) => id === ctx.sessActive.value;

    ctx.sessListBody.innerHTML = list.map(s => {
      const shortId = s.sessionId.slice(0, 8) + '…';
      const selected = isSelected(s.sessionId);
      const busy = s.busy ? '忙碌' : '空闲';
      const busyColor = s.busy ? 'var(--amber-500)' : 'var(--emerald-500)';
      const created = s.createdAt ? new Date(s.createdAt).toLocaleTimeString('zh-CN', { hour12: false }) : '-';
      const model = (s.model || '').split('/').pop() || '-';

      return `<tr style="${selected ? 'background:var(--indigo-50)' : ''};border-bottom:1px solid var(--slate-100);transition:background .15s">
        <td style="padding:6px 8px;font-family:var(--font-mono);font-size:11px;color:var(--slate-700)" title="${s.sessionId}">${shortId}</td>
        <td style="padding:6px 8px;color:var(--slate-600)">${model}</td>
        <td style="padding:6px 8px;text-align:center;color:var(--slate-600)">${s.stepIndex}</td>
        <td style="padding:6px 8px;text-align:center"><span style="display:inline-block;padding:1px 8px;border-radius:8px;font-size:11px;background:${busyColor}15;color:${busyColor};font-weight:500">${busy}</span></td>
        <td style="padding:6px 8px;text-align:center;color:var(--slate-400);font-size:11px">${created}</td>
        <td style="padding:6px 8px;text-align:center">
          <button class="sess-del-btn" data-id="${s.sessionId}" style="background:none;border:1px solid var(--red-200);color:var(--red-500);border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;transition:all .15s"
            onmouseover="this.style.background='var(--red-50)'" onmouseout="this.style.background=''"
            title="关闭此会话">删除</button>
        </td>
      </tr>`;
    }).join('');

    ctx.sessListBody.querySelectorAll('.sess-del-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (!id) return;
        if (!confirm('确定关闭会话 ' + id.slice(0, 8) + '… ？')) return;
        btn.disabled = true;
        btn.textContent = '…';
        try {
          const res = await fetch('/api/browser/session/' + id, { method: 'DELETE' });
          if (!res.ok) throw new Error((await res.json()).error || '删除失败');
          ctx.sessLog('success', '会话已关闭：' + id.slice(0, 8) + '…');
          if (ctx.sessActive.value === id) {
            ctx.sessActive.value = '';
            onSessionChange();
          }
        } catch (err) {
          ctx.sessLog('error', '关闭会话失败：' + err.message);
          btn.disabled = false;
          btn.textContent = '删除';
        }
      });
    });
  }

  function applySessionsToDropdown(list) {
    const currentVal = ctx.sessActive.value;
    ctx.sessActive.innerHTML = '<option value="">(none)</option>';
    list.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.sessionId;
      const short = s.sessionId.slice(0, 8);
      const busy = s.busy ? ' [busy]' : '';
      opt.textContent = short + '... [' + s.stepIndex + ']' + busy + ' ' + (s.model || '').slice(0, 20);
      ctx.sessActive.appendChild(opt);
    });
    if (currentVal && Array.from(ctx.sessActive.options).some(o => o.value === currentVal)) {
      ctx.sessActive.value = currentVal;
    }
    if (ctx.sessCloseBrowserBtn) ctx.sessCloseBrowserBtn.style.display = list.length > 0 ? '' : 'none';
    onSessionChange();
  }

  ctx.sessActive.addEventListener('change', onSessionChange);

  ctx.sessNewBtn.addEventListener('click', async () => {
    const model = ctx.sessModel.value;
    ctx.sessNewBtn.disabled = true;
    ctx.sessStatus.textContent = '创建中…';
    ctx.sessLog('system', '正在创建新会话…');
    try {
      const res = await fetch('/api/browser/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model || undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      const data = await res.json();
      ctx.sessLog('success', '会话已创建：' + data.sessionId);
      await window.loadActiveSessions();
      ctx.sessActive.value = data.sessionId;
      onSessionChange();
    } catch (err) {
      ctx.sessLog('error', '创建会话失败：' + err.message);
      ctx.sessStatus.textContent = '创建失败';
    }
    ctx.sessNewBtn.disabled = false;
    ctx.updateButtons();
  });

  if (ctx.sessUploadBtn && ctx.sessFileInput) {
    ctx.sessUploadBtn.addEventListener('click', () => ctx.sessFileInput.click());
    ctx.sessFileInput.addEventListener('change', async () => {
      const file = ctx.sessFileInput.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        ctx.sessTask.value = text;
        if (ctx.sessFileName) ctx.sessFileName.textContent = file.name + ' (' + (text.length / 1024).toFixed(1) + ' KB)';
        ctx.sessLog('system', '已加载文件：' + file.name);
        ctx.updateButtons();
        if (ctx.sessActive.value && (/【阶段|^##\s+Phase\s+\d+/m.test(text))) {
          setTimeout(() => ctx.sessLoadBtn.click(), 300);
        }
      } catch (err) {
        ctx.sessLog('error', '文件读取失败：' + err.message);
      }
      ctx.sessFileInput.value = '';
    });
  }

  ctx.sessStepBtn.addEventListener('click', () => {
    const sessionId = ctx.sessActive.value;
    const task = ctx.sessTask.value.trim();
    const maxSteps = parseInt(ctx.sessMaxSteps.value) || 100;
    if (!sessionId || !task) return;
    executeSessionStep(sessionId, task, maxSteps, task.slice(0, 60));
  });

  ctx.sessCancelBtn.addEventListener('click', () => {
    if (ctx.sessAbortController) { ctx.sessAbortController.abort(); ctx.sessAbortController = null; }
    ctx.sessRunning = false;
    ctx.sessLog('system', '步骤已取消');
    ctx.updateButtons();
  });

  ctx.sessTrajBtn.addEventListener('click', async () => {
    const sessionId = ctx.sessActive.value;
    if (!sessionId) return;
    if (!confirm('保存动作文件 + 操作日志 + 表单快照？')) return;
    ctx.sessTrajBtn.disabled = true;
    ctx.sessLog('system', '正在保存…');
    try {
      const functionId = getSelectedFunctionId(ctx);
      const trajectoryDbId = getSelectedTrajectoryDbId(ctx);
      const phaseDescriptions = { ...(window.__phaseDescriptions__ || {}) };
      (ctx.sessionPhases || []).forEach((p) => {
        if (p.num == null) return;
        const key = String(p.num);
        if (phaseDescriptions[key]) return;
        const text = (p.task || '').trim();
        if (text) phaseDescriptions[key] = text;
      });
      const res = await fetch('/api/browser/session/' + sessionId + '/trajectory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: ctx.sessTask.value || undefined,
          phaseDescriptions,
          ...(functionId != null ? { functionId } : {}),
          ...(trajectoryDbId != null ? { trajectoryDbId } : {}),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Server error');
      const data = await res.json();
      const actionName = (data.action_file || '').split(/[\\/]/).pop() || '';
      const logName = (data.log_file || '').split(/[\\/]/).pop() || '';
      const dbId = data.trajectoryDbId ?? data.dbId;
      if (dbId != null) {
        sessionStorage.setItem(TRAJ_STORAGE_KEY, String(dbId));
        setActionFlowTrajectory(dbId);
        if (ctx.refreshTrajectorySelect) await ctx.refreshTrajectorySelect(functionId, dbId);
      }
      ctx.sessTrajectoryId.textContent = 'traj#' + (dbId || '?') + ' | ' + actionName.slice(0, 16);
      ctx.sessLog('success', data.action_count + ' 个动作已保存（trajectory.id=' + (dbId || '?') + '）' + (logName ? ' + ' + data.log_count + ' 条日志' : ''));
      await reloadActionFlow(sessionId);
    } catch (err) {
      ctx.sessLog('error', '保存失败：' + err.message);
    }
    ctx.sessTrajBtn.disabled = false;
  });

  ctx.sessCaseDataBtn.addEventListener('click', async () => {
    const sessionId = ctx.sessActive.value;
    if (!sessionId) return;
    if (!confirm('保存案例数据到 JSON 文件？这将持久化当前案例数据存储。')) return;
    ctx.sessCaseDataBtn.disabled = true;
    ctx.sessLog('system', '正在保存案例数据…');
    try {
      const res = await fetch('/api/browser/session/' + sessionId + '/save-case-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Server error');
      const data = await res.json();
      ctx.sessLog('success', '案例数据已保存：' + data.caseDataFile + ' (' + data.keys + ' 个键)');
    } catch (err) {
      ctx.sessLog('error', '保存案例数据失败：' + err.message);
    }
    ctx.sessCaseDataBtn.disabled = false;
  });

  ctx.sessResetTrajBtn.addEventListener('click', async () => {
    const sessionId = ctx.sessActive.value;
    if (!sessionId) return;
    if (!confirm('重置轨迹录制？将创建新的累积轨迹文件，旧文件保留在 /tmp/ 中。')) return;
    ctx.sessResetTrajBtn.disabled = true;
    ctx.sessLog('system', '正在重置轨迹录制…');
    try {
      let res, data;
      for (let attempt = 0; attempt < 5; attempt++) {
        res = await fetch('/api/browser/session/' + sessionId + '/reset-trajectory', { method: 'POST' });
        if (res.status === 409) {
          ctx.sessLog('system', 'Browser busy, retrying in 2s... (' + (attempt + 1) + '/5)');
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        break;
      }
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))).error) || 'Server error');
      data = await res.json();
      if (ctx.sessTrajPath) {
        ctx.sessTrajPath.style.display = 'block';
        const parts = [];
        if (data.cumulative_file) parts.push('轨迹：' + data.cumulative_file);
        if (data.case_data_file) parts.push('CaseData: ' + data.case_data_file);
        ctx.sessTrajPath.textContent = parts.join(' | ');
      }
      ctx.sessLog('success', '新轨迹文件：' + (data.cumulative_file || 'ready'));
    } catch (err) {
      ctx.sessLog('error', '重置失败：' + err.message);
    }
    ctx.sessResetTrajBtn.disabled = false;
  });

  if (ctx.sessCloseBrowserBtn) {
    ctx.sessCloseBrowserBtn.addEventListener('click', async () => {
      if (!confirm('关闭全局浏览器？所有会话将被清除。')) return;
      ctx.sessLog('system', '正在关闭全局浏览器…');
      try {
        await fetch('/api/browser/browser', { method: 'DELETE' });
        ctx.sessLog('success', '浏览器已关闭');
        ctx.sessActive.innerHTML = '<option value="">(none)</option>';
        onSessionChange();
      } catch (err) {
        ctx.sessLog('error', '关闭失败：' + err.message);
      }
    });
  }

  if (ctx.sessTask) {
    ctx.sessTask.addEventListener('input', () => {
      ctx.updateButtons();
    });
  }

  on('server:init', (data) => {
    const list = data.sessions || [];
    renderSessionList(list);
    applySessionsToDropdown(list);
  });

  on('sessions:updated', (data) => {
    if (!ctx.sessActive) return;
    const sessions = data.sessions || [];
    renderSessionList(sessions);
    applySessionsToDropdown(sessions);
  });

  setTimeout(() => window.loadActiveSessions(), 500);
}
