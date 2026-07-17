/**
 * forwardStdin mapping — expanded for all session stdin events.
 */
import * as registry from './executor-registry.js';
import {
  waitForSessionEvent,
  onSessionEvent,
  removeSessionHub,
} from './executor-event-hub.js';

export function pickExecutorNode(nodeUuid) {
  if (nodeUuid && registry.isConnected(nodeUuid)) return nodeUuid;
  const live = registry.list().filter((n) => n.connected);
  if (!live.length) throw new Error('No executor agent online');
  return live[0].nodeUuid;
}

export function sendToExecutor(nodeUuid, type, payload) {
  if (!registry.send(nodeUuid, type, payload)) {
    throw new Error(`Executor ${nodeUuid} is not connected`);
  }
}

const STDIN_TO_WS = {
  step: 'session.step',
  cancel_step: 'session.cancel_step',
  intervene: 'session.intervene',
  manual_record_start: 'session.manual_record_start',
  manual_record_stop: 'session.manual_record_stop',
  manual_dom_event: 'session.manual_dom_event',
  cdp_action: 'session.cdp_action',
  save_trajectory: 'session.save_trajectory',
  save_case_data: 'session.save_case_data',
  get_action_log: 'session.get_action_log',
  reset_trajectory: 'session.reset_trajectory',
  close: 'session.close',
};

export async function openSession({ sessionId, model, nodeUuid }) {
  const uuid = pickExecutorNode(nodeUuid);
  const readyP = waitForSessionEvent(sessionId, 'session.ready', 120000);
  sendToExecutor(uuid, 'session.open', { sessionId, model });
  const payload = await readyP;
  return { ...payload, nodeUuid: uuid };
}

export async function closeSession({ nodeUuid, sessionId }) {
  try {
    sendToExecutor(nodeUuid, 'session.close', { sessionId });
    await waitForSessionEvent(sessionId, 'session.closed', 15000).catch(() => {});
  } finally {
    removeSessionHub(sessionId);
  }
}

export function forwardStdin({ nodeUuid, sessionId, event, data = {} }) {
  const wsType = STDIN_TO_WS[event] || 'session.stdin';
  if (wsType === 'session.step') {
    sendToExecutor(nodeUuid, 'session.step', {
      sessionId,
      task: data.instruction,
      maxSteps: data.max_steps,
      phaseNumber: data.phase_number,
      caseDataFile: data.case_data_file,
    });
    return;
  }
  if (wsType === 'session.stdin') {
    sendToExecutor(nodeUuid, 'session.stdin', { sessionId, event, data });
    return;
  }
  sendToExecutor(nodeUuid, wsType, { sessionId, ...data });
}

export function subscribeSessionEvents(sessionId, handler) {
  return onSessionEvent(sessionId, '*', ({ type, payload }) => handler(type, payload));
}

export { onSessionEvent, waitForSessionEvent, removeSessionHub };
