// CDP quick actions, manual record, auto-persist, watcher status

import { on } from '../ws-client.js';
import { reloadActionFlow } from '../recording-flow.js';
import { getSelectedTrajectoryDbId, getSelectedPhaseId } from './state.js';

const QUICK_ACTIONS = [
  { name: 'fill_form_field', label: '填写字段', params: ['label', 'value'], desc: '通过标签文本填写表单字段' },
  { name: 'select_option', label: '选择下拉', params: ['label', 'option'], desc: '选择 el-select 下拉选项' },
  { name: 'select_tree_option', label: '树选择器', params: ['label', 'option'], desc: '树形选择器（如行业代码）：P0 精确 / P1 搜索 / P2 兜底叶节点' },
  { name: 'click_table_row_radio', label: '选中表格行', params: ['row'], desc: '选中 el-table 中的单选按钮' },
  { name: 'click_table_row_button', label: '点击表格按钮', params: ['row', 'button'], desc: '点击 el-table 行中的操作按钮' },
  { name: 'click_adjacent_button', label: '点击相邻按钮', params: ['label'], desc: '点击字段旁的引入/选择按钮' },
  { name: 'click_radio', label: '点击单选', params: ['label', 'option'], desc: '点击 el-radio 组中的选项' },
  { name: 'click_menu_item', label: '点击菜单', params: ['text'], desc: '点击 el-menu 菜单项（自动展开子菜单）' },
  { name: 'close_dialog', label: '关闭弹窗', params: [], desc: '关闭最上层对话框/抽屉' },
  { name: 'close_notification', label: '关闭通知', params: [], desc: '关闭并读取 el-notification' },
  { name: 'get_page_state', label: '页面状态', params: [], desc: '获取当前页面状态 JSON' },
  { name: 'wait_for_loading', label: '等待加载', params: [], desc: '等待 Element UI 加载遮罩消失' },
];

export function wireQuickActions(ctx) {
  function setAutoPersistUI(enabled) {
    ctx.autoPersist = !!enabled;
    if (ctx.autoPersistInput) ctx.autoPersistInput.checked = ctx.autoPersist;
    if (ctx.autoPersistTrack) {
      ctx.autoPersistTrack.style.background = ctx.autoPersist ? 'var(--emerald-500, #10b981)' : 'var(--slate-200)';
    }
    if (ctx.autoPersistThumb) {
      ctx.autoPersistThumb.style.transform = ctx.autoPersist ? 'translateX(16px)' : 'translateX(0)';
    }
  }

  async function syncAutoPersist(enabled) {
    const sessionId = ctx.sessActive?.value;
    setAutoPersistUI(enabled);
    if (!sessionId) return;
    try {
      await fetch('/api/browser/session/' + encodeURIComponent(sessionId) + '/auto-persist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !!enabled }),
      });
    } catch (err) {
      console.warn('[auto-persist] sync failed:', err.message);
    }
  }

  if (ctx.autoPersistInput) {
    setAutoPersistUI(false);
    ctx.autoPersistInput.addEventListener('change', () => {
      syncAutoPersist(!!ctx.autoPersistInput.checked);
      ctx.sessLog('system', ctx.autoPersistInput.checked
        ? '自动入库已开启：CDP/人工操作将立即写入轨迹'
        : '自动入库已关闭：操作仅进 ACTION_LOG，需「保存轨迹」');
    });
  }

  function setManualRecUI(enabled) {
    ctx.manualRecording = !!enabled;
    if (ctx.manualRecBtn) {
      ctx.manualRecBtn.textContent = ctx.manualRecording ? '■ 停止人工录制' : '● 开始人工录制';
      ctx.manualRecBtn.style.color = ctx.manualRecording ? 'var(--red-500)' : '';
      ctx.manualRecBtn.style.borderColor = ctx.manualRecording ? 'var(--red-200)' : '';
    }
    if (ctx.manualRecStatus) {
      ctx.manualRecStatus.textContent = ctx.manualRecording ? '录制中' : '录制关';
      ctx.manualRecStatus.style.background = ctx.manualRecording ? '#fee2e2' : 'var(--slate-100)';
      ctx.manualRecStatus.style.color = ctx.manualRecording ? '#991b1b' : 'var(--slate-400)';
    }
  }

  if (ctx.manualRecBtn) {
    ctx.manualRecBtn.addEventListener('click', async () => {
      const sessionId = ctx.sessActive?.value;
      if (!sessionId) { alert('请先创建/选择会话'); return; }
      const trajectoryDbId = getSelectedTrajectoryDbId(ctx);
      if (!ctx.manualRecording && trajectoryDbId == null) {
        if (!confirm('尚未选择长期轨迹，操作只会写入 ACTION_LOG。继续开启？')) return;
      }
      await syncAutoPersist(ctx.autoPersist);
      ctx.manualRecBtn.disabled = true;
      try {
        const res = await fetch('/api/browser/session/' + encodeURIComponent(sessionId) + '/manual-record', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enabled: !ctx.manualRecording,
            ...(trajectoryDbId != null ? { trajectoryDbId } : {}),
            ...(getSelectedPhaseId(ctx) != null ? { phaseId: getSelectedPhaseId(ctx) } : {}),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'failed');
        setManualRecUI(!!data.enabled);
        const phaseHint = data.phaseId != null
          ? ' phase#' + data.phaseId
          : (trajectoryDbId != null ? '（末尾阶段）' : '');
        const persistHint = ctx.autoPersist && trajectoryDbId != null
          ? '（自动入库 traj#' + trajectoryDbId + phaseHint + '）'
          : '（仅 ACTION_LOG' + (ctx.autoPersist ? '' : '，可开「自动入库」') + '）';
        ctx.sessLog(data.enabled ? 'success' : 'system',
          data.enabled
            ? ('人工录制已开启' + persistHint)
            : '人工录制已停止');
      } catch (err) {
        alert('人工录制切换失败：' + err.message);
      }
      ctx.manualRecBtn.disabled = false;
    });
  }

  on('manual_record_status', (d) => setManualRecUI(!!d.enabled));
  on('manual_action_persisted', (d) => {
    ctx.sessLog('success', '人工操作已入库 step#' + (d.stepNumber || '?')
      + ' · ' + (d.entry?.action || ''));
    if (ctx.sessActive?.value) reloadActionFlow(ctx.sessActive.value);
  });
  on('cdp_action_persisted', (d) => {
    ctx.sessLog('success', '快速操作已入库 step#' + (d.stepNumber || '?')
      + ' · ' + (d.entry?.action || ''));
    if (ctx.sessActive?.value) reloadActionFlow(ctx.sessActive.value);
  });
  on('manual_action_recorded', () => {
    if (ctx.sessActive?.value) reloadActionFlow(ctx.sessActive.value);
  });

  if (ctx.quickActionSelect) {
    QUICK_ACTIONS.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.name;
      const sig = a.params.length ? '(' + a.params.join(', ') + ')' : '';
      opt.textContent = a.label + ' - ' + a.name + ' ' + sig;
      ctx.quickActionSelect.appendChild(opt);
    });
    ctx.quickActionSelect.addEventListener('change', () => {
      const sel = QUICK_ACTIONS.find(a => a.name === ctx.quickActionSelect.value);
      const p1 = ctx.quickParam1?.parentElement;
      const p2 = ctx.quickParam2?.parentElement;
      if (sel && sel.params.length === 0) { if (p1) p1.style.display = 'none'; if (p2) p2.style.display = 'none'; }
      else if (sel && sel.params.length === 1) { if (p1) { p1.style.display = ''; p1.querySelector('label').textContent = sel.params[0]; } if (p2) p2.style.display = 'none'; }
      else { if (p1) { p1.style.display = ''; p1.querySelector('label').textContent = sel?.params[0] || 'param1'; } if (p2) { p2.style.display = ''; p2.querySelector('label').textContent = sel?.params[1] || 'param2'; } }
    });
    ctx.quickActionSelect.dispatchEvent(new Event('change'));
  }

  if (ctx.quickExecBtn) {
    ctx.quickExecBtn.addEventListener('click', async () => {
      const action = ctx.quickActionSelect?.value;
      if (!action) return;
      const params = [];
      if (ctx.quickParam1?.value?.trim()) params.push(ctx.quickParam1.value.trim());
      if (ctx.quickParam2?.value?.trim()) params.push(ctx.quickParam2.value.trim());

      ctx.quickExecBtn.disabled = true;
      ctx.quickResult.style.display = 'none';
      try {
        const trajectoryDbId = getSelectedTrajectoryDbId(ctx);
        const sessionId = ctx.sessActive?.value || undefined;
        if (!sessionId) {
          throw new Error('请先在上方选择/创建会话（执行机模式下快速操作依赖当前会话）');
        }
        const resp = await fetch('/api/browser/watcher/action', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            params,
            source: 'cdp',
            autoPersist: ctx.autoPersist,
            sessionId,
            ...(trajectoryDbId != null ? { trajectoryDbId } : {}),
          }),
        });
        const data = await resp.json();
        if (!resp.ok || data.error) {
          ctx.quickResult.style.display = 'block';
          ctx.quickResult.style.background = '#fef2f2'; ctx.quickResult.style.border = '1px solid #fecaca'; ctx.quickResult.style.color = '#991b1b';
          ctx.quickResult.textContent = '✗ ' + (data.error || `HTTP ${resp.status}`);
        } else {
          ctx.quickResult.style.display = 'block';
          ctx.quickResult.style.background = '#f0fdf4'; ctx.quickResult.style.border = '1px solid #bbf7d0'; ctx.quickResult.style.color = '#166534';
          const persistHint = data.persisted
            ? ' → 已入库 step#' + data.persisted.stepNumber
            : (trajectoryDbId == null
              ? '（未选轨迹，仅记入 ACTION_LOG）'
              : (data.autoPersist ? '' : '（自动入库关，仅 ACTION_LOG）'));
          ctx.quickResult.textContent = '✓ ' + (data.result || 'ok') + persistHint;
          if (sessionId) reloadActionFlow(sessionId);
        }
      } catch (err) {
        ctx.quickResult.style.display = 'block';
        ctx.quickResult.style.background = '#fef2f2'; ctx.quickResult.style.border = '1px solid #fecaca'; ctx.quickResult.style.color = '#991b1b';
        ctx.quickResult.textContent = '✗ ' + err.message;
      }
      ctx.quickExecBtn.disabled = false;
    });
  }

  async function checkWatcher() {
    if (!ctx.watcherStatus) return;
    try {
      const r = await fetch('/api/browser/watcher/status');
      const data = await r.json();
      const online = data.connected;
      ctx.watcherStatus.textContent = online ? '已连接' : '离线';
      ctx.watcherStatus.style.background = online ? '#dcfce7' : 'var(--slate-100)';
      ctx.watcherStatus.style.color = online ? '#166534' : 'var(--slate-400)';
      if (ctx.quickExecBtn) ctx.quickExecBtn.disabled = !online;
      if (typeof data.autoPersist === 'boolean') setAutoPersistUI(data.autoPersist);
      if (typeof data.manualRecording === 'boolean') setManualRecUI(data.manualRecording);
    } catch { ctx.watcherStatus.textContent = '离线'; if (ctx.quickExecBtn) ctx.quickExecBtn.disabled = true; }
  }
  checkWatcher();

  on('server:init', (data) => {
    if (data.watcher && ctx.watcherStatus) {
      const online = data.watcher.connected;
      const busy = data.watcher.agentBusy;
      const ready = online && !busy;
      ctx.watcherStatus.textContent = busy ? '忙碌中' : (online ? '已连接' : '离线');
      ctx.watcherStatus.style.background = ready ? '#dcfce7' : (busy ? '#fef3c7' : 'var(--slate-100)');
      ctx.watcherStatus.style.color = ready ? '#166534' : (busy ? '#92400e' : 'var(--slate-400)');
      if (ctx.quickExecBtn) ctx.quickExecBtn.disabled = !ready;
    }
  });

  on('watcher:status', (data) => {
    if (!ctx.watcherStatus) return;
    const online = data.connected;
    const busy = data.agentBusy;
    const ready = online && !busy;
    ctx.watcherStatus.textContent = busy ? '忙碌中' : (online ? '已连接' : '离线');
    ctx.watcherStatus.style.background = ready ? '#dcfce7' : (busy ? '#fef3c7' : 'var(--slate-100)');
    ctx.watcherStatus.style.color = ready ? '#166534' : (busy ? '#92400e' : 'var(--slate-400)');
    if (ctx.quickExecBtn) ctx.quickExecBtn.disabled = !ready;
  });

  on('ws:disconnected', () => {
    if (!ctx.watcherStatus) return;
    ctx.watcherStatus.textContent = '离线';
    ctx.watcherStatus.style.background = 'var(--slate-100)';
    ctx.watcherStatus.style.color = 'var(--slate-400)';
    if (ctx.quickExecBtn) ctx.quickExecBtn.disabled = true;
  });

  const exploreClearLogBtn = document.getElementById('exploreClearLogBtn');
  if (exploreClearLogBtn) {
    exploreClearLogBtn.addEventListener('click', () => {
      if (ctx.exploreLogTerminal) ctx.exploreLogTerminal.innerHTML = '<div class="log-line system"><span class="ts">⚡</span>就绪</div>';
    });
  }
}
