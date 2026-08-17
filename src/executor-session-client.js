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
 * When preferIdleChrome=true, prefer nodes that already have reusable CDP Chromes.
 * @param {{ nodeUuid?: string, preferIdleChrome?: boolean }} [opts]
 * @returns {Promise<{ nodeUuid: string, cdpUrl?: string|null, cdpPort?: number|null, reusedChrome?: boolean }>}
 */
export async function pickExecutorNode(opts = {}) {
  const preferred = opts.nodeUuid || null;
  const preferIdleChrome = opts.preferIdleChrome !== false;
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
    if (preferIdleChrome) {
      try {
        const { browsers } = await listExecutorCdp(preferred, 8000);
        const pick = browsers?.[0];
        if (pick?.cdpWsUrl) {
          return {
            nodeUuid: preferred,
            cdpUrl: pick.cdpWsUrl,
            cdpPort: pick.port != null ? Number(pick.port) : null,
            reusedChrome: true,
          };
        }
      } catch (err) {
        console.warn('[executor] list_cdp on preferred failed:', err.message);
      }
    }
    return { nodeUuid: preferred, cdpUrl: null, cdpPort: null, reusedChrome: false };
  }

  const live = registry.list().filter((n) => n.connected);
  if (!live.length) throw lease.noExecutorOnlineError();

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

  // Prefer an idle CDP Chrome on any free-capacity node; else least-loaded node.
  if (preferIdleChrome) {
    const probed = await Promise.all(
      candidates.map(async (c) => {
        try {
          const { browsers } = await listExecutorCdp(c.nodeUuid, 8000);
          const pick = browsers?.[0] || null;
          return { ...c, browser: pick };
        } catch {
          return { ...c, browser: null };
        }
      }),
    );
    probed.sort((a, b) => {
      const aIdle = a.browser?.cdpWsUrl ? 0 : 1;
      const bIdle = b.browser?.cdpWsUrl ? 0 : 1;
      return aIdle - bIdle || a.inUse - b.inUse || a.nodeUuid.localeCompare(b.nodeUuid);
    });
    const best = probed[0];
    if (best?.browser?.cdpWsUrl) {
      console.log(
        `[executor] prefer idle Chrome port=${best.browser.port} on node=${best.nodeUuid}`,
      );
      return {
        nodeUuid: best.nodeUuid,
        cdpUrl: best.browser.cdpWsUrl,
        cdpPort: best.browser.port != null ? Number(best.browser.port) : null,
        reusedChrome: true,
      };
    }
    return {
      nodeUuid: best.nodeUuid,
      cdpUrl: null,
      cdpPort: null,
      reusedChrome: false,
    };
  }

  return {
    nodeUuid: candidates[0].nodeUuid,
    cdpUrl: null,
    cdpPort: null,
    reusedChrome: false,
  };
}

export function sendToExecutor(nodeUuid, type, payload) {
  if (!registry.send(nodeUuid, type, payload)) {
    throw new Error(`Executor ${nodeUuid} is not connected`);
  }
}

const STDIN_TO_WS = {
  step: 'session.step',
  cancel_step: 'session.cancel_step',
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
 *   preferIdleChrome?: boolean,
 * }} opts
 */
export async function openSession({
  sessionId,
  model,
  nodeUuid,
  trajectoryId = null,
  cdpUrl = null,
  cdpPort = null,
  preferIdleChrome = true,
} = {}) {
  let uuid = null;
  let reuseCdpUrl = cdpUrl || null;
  let reuseCdpPort = cdpPort != null && Number.isFinite(Number(cdpPort)) ? Number(cdpPort) : null;
  let reusedChrome = !!(reuseCdpUrl);

  await lease.withLeaseMutex(async () => {
    // Skip CDP probe inside mutex when caller already chose cdpUrl / explicit node without prefer.
    const picked = await pickExecutorNode({
      nodeUuid,
      preferIdleChrome: preferIdleChrome && !reuseCdpUrl,
    });
    uuid = typeof picked === 'string' ? picked : picked.nodeUuid;
    if (!reuseCdpUrl && picked?.cdpUrl) {
      reuseCdpUrl = picked.cdpUrl;
      reuseCdpPort = picked.cdpPort != null ? Number(picked.cdpPort) : null;
      reusedChrome = !!picked.reusedChrome;
    }
    lease.reservePending(uuid);
  });

  try {
    const readyP = waitForSessionEvent(sessionId, 'session.ready', 120000);
    const openPayload = { sessionId, model };
    if (reuseCdpUrl) openPayload.cdpUrl = reuseCdpUrl;
    if (reuseCdpPort != null && Number.isFinite(Number(reuseCdpPort))) {
      openPayload.cdpPort = Number(reuseCdpPort);
    }
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
    return {
      ...payload,
      nodeUuid: uuid,
      slotIndex,
      reusedChrome: reusedChrome || !!payload?.reusedChrome,
      cdpUrl: reuseCdpUrl || null,
      cdpPort: payload?.cdpPort ?? reuseCdpPort,
    };
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

export async function closeSession({
  nodeUuid,
  sessionId,
  keepBrowser = false,
  timeoutMs = 15000,
} = {}) {
  try {
    sendToExecutor(nodeUuid, 'session.close', {
      sessionId,
      // false = kill Chrome（释放资源）；true = leave idle CDP（一般不走这条）
      keepBrowser: keepBrowser === true,
    });
    await waitForSessionEvent(sessionId, 'session.closed', timeoutMs).catch(() => {});
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
      caseData: data.case_data,
      // Must forward — otherwise Python loads 0 special-element candidates
      specialElementCandidates:
        data.special_element_candidates ?? data.specialElementCandidates,
      priorPhases: data.prior_phases ?? data.priorPhases,
      allPhases: data.all_phases ?? data.allPhases,
      priorOutcome: data.prior_outcome ?? data.priorOutcome,
      // P1：记忆事件归属 —— Python writer 需要 trajectory_id + fact_pack
      trajectoryId: data.trajectory_id,
      factPack: data.fact_pack,
      caseDataBlock: data.case_data_block ?? data.caseDataBlock,
      healContract: data.heal_contract ?? data.healContract ?? null,
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
