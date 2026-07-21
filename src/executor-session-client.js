/**
 * forwardStdin mapping — expanded for all session stdin events.
 * Slot leases: capacity-aware pick + confirm/release via executor-slot-lease.
 */
import { randomUUID } from 'crypto';
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
 * @param {{
 *   sessionId: string,
 *   model?: string,
 *   nodeUuid?: string,
 *   trajectoryId?: number|null,
 *   cdpUrl?: string|null,
 *   cdpPort?: number|null,
 * }} opts
 */
export async function openSession({
  sessionId,
  model,
  nodeUuid,
  trajectoryId = null,
  cdpUrl = null,
  cdpPort = null,
} = {}) {
  let uuid = null;
  await lease.withLeaseMutex(async () => {
    uuid = await pickExecutorNode({ nodeUuid });
    lease.reservePending(uuid);
  });

  try {
    const readyP = waitForSessionEvent(sessionId, 'session.ready', 120000);
    const openPayload = { sessionId, model };
    if (cdpUrl) openPayload.cdpUrl = cdpUrl;
    if (cdpPort != null && Number.isFinite(Number(cdpPort))) openPayload.cdpPort = Number(cdpPort);
    sendToExecutor(uuid, 'session.open', openPayload);
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
    if (
      err?.message?.includes('No free executor slots')
      || /no free/i.test(err?.message || '')
      || /无可用执行资源/.test(err?.message || '')
    ) {
      const e = lease.noFreeSlotsError();
      e.message = err.message || e.message;
      throw e;
    }
    throw err;
  }
}

/**
 * Ask executor for live sessions (request/response via session hub).
 * @param {string} nodeUuid
 * @param {number} [timeoutMs]
 */
export async function listExecutorSessions(nodeUuid, timeoutMs = 10000) {
  const requestId = randomUUID();
  const resultP = waitForSessionEvent(requestId, 'session.list_result', timeoutMs);
  sendToExecutor(nodeUuid, 'session.list', { sessionId: requestId, requestId });
  const payload = await resultP;
  return Array.isArray(payload?.sessions) ? payload.sessions : [];
}

/**
 * Ask executor for reusable CDP Chromes (not bound to a live slot).
 * @param {string} nodeUuid
 * @param {number} [timeoutMs]
 */
export async function listExecutorCdp(nodeUuid, timeoutMs = 15000) {
  const requestId = randomUUID();
  const resultP = waitForSessionEvent(requestId, 'session.list_cdp_result', timeoutMs);
  sendToExecutor(nodeUuid, 'session.list_cdp', { sessionId: requestId, requestId });
  const payload = await resultP;
  return {
    browsers: Array.isArray(payload?.browsers) ? payload.browsers : [],
    occupiedPorts: Array.isArray(payload?.occupiedPorts) ? payload.occupiedPorts : [],
  };
}

/**
 * Drop control-plane leases whose session no longer exists on the executor.
 * @param {string} nodeUuid
 */
export async function reconcileLeasesWithExecutor(nodeUuid) {
  if (!nodeUuid || !registry.isConnected(nodeUuid)) return { released: 0 };
  let sessions;
  try {
    sessions = await listExecutorSessions(nodeUuid, 8000);
  } catch (err) {
    console.warn('[executor] reconcile list failed:', err.message);
    return { released: 0, error: err.message };
  }
  const liveIds = new Set(sessions.map((s) => s.sessionId).filter(Boolean));
  let released = 0;
  for (const holder of lease.listByNode(nodeUuid)) {
    if (holder.sessionId && !liveIds.has(holder.sessionId)) {
      lease.releaseBySession(holder.sessionId);
      released += 1;
    }
  }
  return { released, liveSessionIds: [...liveIds] };
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
