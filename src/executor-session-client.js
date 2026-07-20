/**
 * forwardStdin mapping — expanded for all session stdin events.
 * Slot leases: capacity-aware pick + confirm/release via executor-slot-lease.
 */
import * as registry from './executor-registry.js';
import * as executorNodeDao from './dao/executor-node-dao.js';
import * as lease from './executor-slot-lease.js';
import {
  waitForSessionEvent,
  onSessionEvent,
  removeSessionHub,
} from './executor-event-hub.js';

/**
 * Pick a connected executor with a free slot (lease count < capacity).
 * @param {{ nodeUuid?: string }} [opts]
 * @returns {Promise<string>} nodeUuid
 */
export async function pickExecutorNode(opts = {}) {
  const preferred = opts.nodeUuid || null;
  const dbNodes = await executorNodeDao.list().catch(() => []);
  const byUuid = new Map(dbNodes.map((n) => [n.nodeUuid, n]));

  function capacityOf(nodeUuid) {
    const row = byUuid.get(nodeUuid);
    return Math.max(1, Number(row?.capacity) || 1);
  }

  function isDraining(nodeUuid) {
    const row = byUuid.get(nodeUuid);
    return row?.status === 'draining' || row?.status === 'offline';
  }

  if (preferred) {
    if (!registry.isConnected(preferred)) {
      throw new Error(`Executor ${preferred} is not connected`);
    }
    if (isDraining(preferred)) {
      const err = new Error(`Executor ${preferred} is draining or offline`);
      err.statusCode = 409;
      err.holders = lease.listHolders();
      throw err;
    }
    if (lease.countInUse(preferred) >= capacityOf(preferred)) {
      throw lease.noFreeSlotsError();
    }
    return preferred;
  }

  const live = registry.list().filter((n) => n.connected);
  if (!live.length) throw new Error('No executor agent online');

  const candidates = live
    .filter((n) => !isDraining(n.nodeUuid))
    .map((n) => ({
      nodeUuid: n.nodeUuid,
      capacity: capacityOf(n.nodeUuid),
      inUse: lease.countInUse(n.nodeUuid),
    }))
    .filter((n) => n.inUse < n.capacity)
    .sort((a, b) => a.inUse - b.inUse || a.nodeUuid.localeCompare(b.nodeUuid));

  if (!candidates.length) throw lease.noFreeSlotsError();
  return candidates[0].nodeUuid;
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

/**
 * Open a session on an executor and confirm a slot lease.
 * @param {{ sessionId: string, model?: string, nodeUuid?: string, trajectoryId?: number|null }} opts
 */
export async function openSession({ sessionId, model, nodeUuid, trajectoryId = null }) {
  let uuid = null;
  await lease.withLeaseMutex(async () => {
    uuid = await pickExecutorNode({ nodeUuid });
    lease.reservePending(uuid);
  });

  try {
    const readyP = waitForSessionEvent(sessionId, 'session.ready', 120000);
    sendToExecutor(uuid, 'session.open', { sessionId, model });
    const payload = await readyP;
    const slotIndex = Number(payload?.slotIndex ?? 0);
    lease.confirmLease({
      sessionId,
      nodeUuid: uuid,
      slotIndex,
      trajectoryId: trajectoryId == null ? null : Number(trajectoryId),
    });
    lease.releasePending(uuid);
    return { ...payload, nodeUuid: uuid, slotIndex };
  } catch (err) {
    if (uuid) lease.releasePending(uuid);
    if (err?.message?.includes('No free executor slots') || /no free/i.test(err?.message || '')) {
      const e = lease.noFreeSlotsError();
      e.message = err.message || e.message;
      throw e;
    }
    throw err;
  }
}

export async function closeSession({ nodeUuid, sessionId }) {
  try {
    sendToExecutor(nodeUuid, 'session.close', { sessionId });
    await waitForSessionEvent(sessionId, 'session.closed', 15000).catch(() => {});
  } finally {
    lease.releaseBySession(sessionId);
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
