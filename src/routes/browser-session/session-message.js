import { markPhaseStatus, appendPhaseDoneLog } from '../../services/trajectory-service.js';
import { broadcastSessions, broadcastWatcherStatus } from './broadcasts.js';

/**
 * Session agent-message dispatcher — maps agent stdout/executor events
 * (step / phase_start / phase_done / phase_error / error / nav_step / …) to
 * SSE channel sends and phase-status DB updates.
 */

/**
 * Build the per-step message handler that forwards agent events to the SSE
 * channel and updates phase status / done-log in the DB.
 * @param {{ send: (event: string, data: unknown) => void, end: () => void }} channel SSE/WS push channel
 * @param {object} session target session state
 * @param {number} stepIndex current step index
 * @param {() => void} cleanupListener cleanup callback on completion
 * @returns {(msg: object) => void} per-step message handler
 */
export function handleSessionMessage(channel, session, stepIndex, cleanupListener) {
  return (msg) => {
    const send = channel.send;
    const event = msg.event || msg.type;
    const data = msg.data || msg.payload || msg;

    const finalizePhaseStatus = (status) => {
      const phaseId = session.activePhaseId != null ? Number(session.activePhaseId) : null;
      if (!Number.isFinite(phaseId) || phaseId <= 0) return;
      markPhaseStatus(phaseId, status).catch((err) => {
        console.warn('[session] markPhaseStatus failed:', err.message);
      });
    };

    const appendFromEvent = (source, text) => {
      const phaseId = session.activePhaseId != null ? Number(session.activePhaseId) : null;
      const t = String(text || '').trim();
      if (!Number.isFinite(phaseId) || phaseId <= 0 || !t) return;
      appendPhaseDoneLog(phaseId, { text: t, source }).catch((err) => {
        console.warn('[session] appendPhaseDoneLog failed:', err.message);
      });
    };

    switch (event) {
      case 'step':
        send('step', data);
        send('status', { phase: 'exploring', label: `Step ${data.step}: ${data.next_goal || 'thinking...'}` });
        break;
      case 'phase_start':
        send('phase_start', data);
        send('status', { phase: 'session_step', label: `Step ${data.phase}: ${data.name}`, currentStep: data.phase });
        break;
      case 'phase_done': {
        const trajectoryFile = data?.trajectory_file;
        session.stepIndex = data?.step_index || stepIndex;
        session.trajectories.push({ step: session.stepIndex, path: trajectoryFile || '', time: new Date().toISOString() });
        finalizePhaseStatus('completed');
        appendFromEvent('agent', data?.text);
        send('phase_done', data);
        send('status', { phase: 'step_done', label: `Step ${session.stepIndex} completed` });
        // Product AI record holds busy across phases; one phase_done is not session idle.
        if (session.aiRecording) break;
        session.busy = false;
        broadcastSessions();
        broadcastWatcherStatus();
        send('done', { stepIndex: session.stepIndex, success: true });
        channel.end();
        cleanupListener();
        break;
      }
      case 'phase_error':
        finalizePhaseStatus('failed');
        appendFromEvent('fail', data?.message);
        send('status', { phase: 'error', label: `Step failed: ${data.message}` });
        send('phase_error', data);
        if (session.aiRecording) break;
        session.busy = false;
        broadcastWatcherStatus();
        send('done', { stepIndex, success: false, error: data.message });
        channel.end();
        cleanupListener();
        break;
      case 'error':
        finalizePhaseStatus('failed');
        appendFromEvent('fail', data?.message);
        send('error', data);
        if (session.aiRecording) break;
        session.busy = false;
        broadcastWatcherStatus();
        send('done', { stepIndex, success: false, error: data.message || 'Agent error' });
        channel.end();
        cleanupListener();
        break;
      case 'nav_step':
        send('status', { phase: 'navigating', label: data.label });
        break;
      case 'phase_intent_obs':
        send('phase_intent_obs', data);
        break;
      case 'phase_boundary_obs':
        send('phase_boundary_obs', data);
        break;
      case 'action_log_sync':
        send('action_log_sync', data);
        break;
    }
  };
}
