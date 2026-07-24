// Session step event handling (WS event names + HTTP SSE fallback)

import { reloadActionFlow } from '../recording-flow.js';
import { getSelectedTrajectoryDbId, getSelectedPhaseId } from './state.js';

export function createSSEEventHandler(ctx, stepNum, label, phaseIdx) {
  return (evt, d) => {
    switch (evt) {
      case 'step': ctx.sessLog('info', '步骤 ' + d.step + ': ' + (d.next_goal || (d.actions || []).join(', '))); break;
      case 'phase_start': ctx.sessLog('system', '已开始：' + d.name); break;
      case 'phase_done':
        ctx.sessLog('success', '已完成：' + label);
        ctx.sessTimelineStep('step-' + stepNum, 'success', label, '完成');
        if (phaseIdx !== undefined) ctx.sessPhaseUpdateStatus(phaseIdx, 'success');
        if (ctx.sessTrajPath && d.cumulative_file) {
          ctx.sessTrajPath.style.display = 'block';
          ctx.sessTrajPath.textContent = '轨迹：' + d.cumulative_file;
        }
        reloadActionFlow(ctx.sessActive?.value);
        const tid = getSelectedTrajectoryDbId(ctx);
        if (tid != null && ctx.refreshPhaseSelect) ctx.refreshPhaseSelect(tid, getSelectedPhaseId(ctx));
        setTimeout(() => window.loadActiveSessions?.(), 300);
        break;
      case 'phase_error': case 'error':
        ctx.sessLog('error', d.message || '执行错误');
        ctx.sessTimelineStep('step-' + stepNum, 'failed', label, d.message || '');
        if (phaseIdx !== undefined) ctx.sessPhaseUpdateStatus(phaseIdx, 'failed');
        break;
      case 'nav_step': ctx.sessLog('info', 'Nav: ' + d.label); break;
      case 'done': ctx.sessLog('system', '已完成'); break;
      case 'intervention_needed':
        ctx.showInterventionAlerts(d);
        ctx.sessLog('system', '🔔 Intervention needed: ' + (d.fields || []).map(f => f.label).join(', '));
        break;
      case 'intervention_resolved':
        ctx.interventionFields = ctx.interventionFields.filter(f => f.label !== d.label);
        ctx.showInterventionAlerts({ fields: ctx.interventionFields, source: 'updated' });
        ctx.sessLog('success', '✅ Intervention resolved: ' + d.label + (d.remaining && d.remaining.length ? ' — ' + d.remaining.length + ' remaining' : ' — all clear'));
        break;
    }
  };
}

export function parseSSEStream(text, handler) {
  const lines = text.split('\n');
  let evt = '';
  for (const line of lines) {
    if (line.startsWith('event: ')) evt = line.slice(7).trim();
    else if (line.startsWith('data: ') && evt) {
      try { handler(evt, JSON.parse(line.slice(6))); } catch (e) {}
      evt = '';
    }
  }
}

export async function readSSEStream(ctx, reader, handler) {
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!ctx.sessRunning) { reader.cancel(); break; }
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop();
    for (const part of parts) { if (part.trim()) parseSSEStream(part + '\n', handler); }
  }
}
