/**
 * Executor node service: registration, heartbeat, drain, disconnect grace,
 * and stale-node sweep — coordinates DAO, registry, slot lease, and bindings.
 */
import * as executorNodeDao from '../dao/executor-node-dao.js';
import * as registry from '../executor-registry.js';
import * as slotLease from '../executor-slot-lease.js';
import * as remoteSessionDao from '../dao/remote-session-dao.js';
import { listExecutorSessions, sendToExecutor } from '../executor-session-client.js';
import { restoreLiveBindingFromRow } from './remote-session-state.js';
import { clearTrajectoryRuntimesForNode, getAllTrajectoryRuntimes } from './trajectory-service.js';
import { markRecordingInterrupted } from './trajectory/trajectory-attach-service.js';
import { state } from '../state.js';
import {
  EXECUTOR_DISCONNECT_GRACE_MS,
} from '../../config/config.js';

/**
 * 释放节点的所有内存租约、运行时和会话绑定。
 * @param {string} nodeUuid 执行器节点 UUID
 * @returns {void}
 */
function purgeNodeBindings(nodeUuid) {
  slotLease.releaseByNode(nodeUuid);
  clearTrajectoryRuntimesForNode(nodeUuid);
  for (const [sessionId, session] of [...state.sessions.entries()]) {
    if (session?.executorNodeUuid === nodeUuid) {
      if (session._persistUnsub) {
        try { session._persistUnsub(); } catch {}
      }
      if (session._trajPersistUnsub) {
        try { session._trajPersistUnsub(); } catch {}
      }
      if (session._aiRecordUnsub) {
        try { session._aiRecordUnsub(); } catch {}
      }
      state.sessions.delete(sessionId);
    }
  }
  // Clear stale BiB live pointer so UI does not think attach is still valid.
  import('./remote-session-service.js')
    .then((m) => m.clearExecutorLiveForNode?.(nodeUuid))
    .catch(() => {});
}

/**
 * Mark all recording trajectories bound to a node as interrupted before its
 * sessions are crashed. 执行机离线/重启属于非用户显式 stop 的资源释放：
 * 该节点上仍处于 recording 的交易必须标为 failed(interrupted)，否则会永久卡在录制中。
 * @param {string} nodeUuid executor node uuid (in-memory runtime source)
 * @param {number} nodeId executor node numeric id (DB binding source)
 * @returns {Promise<number>} number of trajectory ids that were considered
 */
async function markNodeRecordingsInterrupted(nodeUuid, nodeId) {
  const tids = new Set();

  // DB bindings: active/idle remote sessions on this node.
  if (nodeId != null) {
    try {
      const rows = await remoteSessionDao.listByNode(nodeId, ['active', 'idle']);
      for (const r of rows) {
        const tid = r?.trajectoryId != null ? Number(r.trajectoryId) : 0;
        if (Number.isFinite(tid) && tid > 0) tids.add(tid);
      }
    } catch (err) {
      console.warn('[executor] list node sessions for interruption failed:', err?.message || err);
    }
  }

  // In-memory runtimes still bound to this node — covers stream-detached sessions
  // whose remote_session.trajectory_id was already cleared.
  if (nodeUuid) {
    for (const [tid, runtime] of getAllTrajectoryRuntimes()) {
      if (runtime?.executorNodeUuid === nodeUuid) tids.add(Number(tid));
    }
  }

  for (const tid of tids) {
    try {
      await markRecordingInterrupted(tid);
    } catch (err) {
      console.warn(`[executor] mark interrupted failed for traj #${tid}:`, err?.message || err);
    }
  }
  return tids.size;
}

/**
 * Register (upsert) an executor node.
 * @param {object} data node fields
 * @param {string} data.nodeUuid unique node uuid
 * @param {string} data.name human-readable name
 * @param {string} [data.host] host address
 * @param {number} [data.capacity] slot capacity
 * @param {object} [data.labels] label map
 * @param {string} [data.agentVersion] agent version string
 * @returns {Promise<object>} upserted node row
 */
export async function register(data) {
  if (!data?.nodeUuid || !data?.name) {
    throw new Error('nodeUuid and name are required');
  }
  return executorNodeDao.upsertByUuid(data);
}

/**
 * Refresh heartbeat timestamp for a node and touch the live registry.
 * @param {string} nodeUuid node uuid
 * @returns {Promise<boolean>} true if heartbeat updated
 */
export async function heartbeat(nodeUuid) {
  const ok = await executorNodeDao.touchHeartbeat(nodeUuid);
  if (ok) registry.touch(nodeUuid);
  return ok;
}

/**
 * Graceful unregister: offline + crash active sessions + detach.
 * @param {string} nodeUuid node uuid
 * @returns {Promise<object|null>} the node row, or null if not found
 */
export async function unregister(nodeUuid) {
  const node = await executorNodeDao.getByUuid(nodeUuid);
  if (!node) return null;

  await executorNodeDao.setStatus(nodeUuid, 'offline');
  await markNodeRecordingsInterrupted(nodeUuid, node.id);
  await executorNodeDao.crashActiveSessions(node.id);
  purgeNodeBindings(nodeUuid);
  registry.detach(nodeUuid, { immediate: true });
  return node;
}

/**
 * Mark node offline and crash its active sessions (disconnect / sweep).
 * @param {string} nodeUuid node uuid
 * @param {number} nodeId node numeric id
 * @returns {Promise<void>}
 */
export async function markOfflineAndCrash(nodeUuid, nodeId) {
  await executorNodeDao.setStatus(nodeUuid, 'offline');
  await markNodeRecordingsInterrupted(nodeUuid, nodeId);
  await executorNodeDao.crashActiveSessions(nodeId);
  purgeNodeBindings(nodeUuid);
}

/**
 * Set a node to draining and notify the executor over WS.
 * @param {string} nodeUuid node uuid
 * @returns {Promise<object|null>} updated node row, or null if not found
 */
export async function drain(nodeUuid) {
  const node = await executorNodeDao.getByUuid(nodeUuid);
  if (!node) return null;

  await executorNodeDao.setStatus(nodeUuid, 'draining');
  registry.send(nodeUuid, 'executor.drain', { nodeUuid });
  return executorNodeDao.getByUuid(nodeUuid);
}

/**
 * Handle non-graceful WS disconnect — start grace timer for auto-reconnect.
 * @param {string} nodeUuid node uuid
 * @param {number} nodeId node numeric id
 * @returns {void}
 */
export function onDisconnect(nodeUuid, nodeId) {
  registry.detach(nodeUuid, {
    graceMs: EXECUTOR_DISCONNECT_GRACE_MS,
    onGraceExpired: (uuid, id) => {
      markOfflineAndCrash(uuid, id).catch((err) => {
        console.error('[executor] grace expiry failed:', err);
      });
    },
  });
}

/**
 * 将实时注册表和槽位租约状态添加到持久化的执行器节点行。
 * @param {object|null} node 持久化的执行器节点
 * @returns {object|null} 增强后的节点行或 null
 */
function withLeaseSlots(node) {
  if (!node) return null;
  const leases = slotLease.listByNode(node.nodeUuid);
  const leaseInUse = slotLease.countHardLeases(node.nodeUuid);
  return {
    ...node,
    /** Live WS attachment (DB status alone can be stale). */
    connected: registry.isConnected(node.nodeUuid),
    // Prefer lease table for live occupancy (falls back to DB-derived inUse)
    inUse: Math.max(Number(node.inUse) || 0, leaseInUse),
    slots: leases.map((l) => ({
      slotIndex: l.slotIndex,
      sessionId: l.sessionId,
      trajectoryId: l.trajectoryId,
      busy: true,
      acquiredAt: l.acquiredAt,
    })),
  };
}

/**
 * List all executor nodes enriched with live lease slots + WS connection state.
 * @returns {Promise<object[]>} nodes with `connected`, `inUse`, `slots` fields
 */
export async function list() {
  const nodes = await executorNodeDao.list();
  return nodes.map(withLeaseSlots);
}

/**
 * Get a single node by uuid, enriched with live lease slots + WS connection state.
 * @param {string} nodeUuid node uuid
 * @returns {Promise<object|null>} enriched node, or null if not found
 */
export async function getByUuid(nodeUuid) {
  const node = await executorNodeDao.getByUuid(nodeUuid);
  if (!node) return null;
  const all = await executorNodeDao.list();
  const withDbInUse = all.find((n) => n.nodeUuid === nodeUuid) || { ...node, inUse: 0 };
  return withLeaseSlots(withDbInUse);
}

/**
 * Periodic sweep: stale heartbeat → offline + crash sessions.
 * @param {number} timeoutMs heartbeat staleness threshold in ms
 * @returns {Promise<object[]>} swept stale nodes
 */
export async function sweepStale(timeoutMs) {
  const stale = await executorNodeDao.markStaleOffline(timeoutMs);
  for (const { nodeId, nodeUuid } of stale) {
    await markNodeRecordingsInterrupted(nodeUuid, nodeId);
    await executorNodeDao.crashActiveSessions(nodeId);
    purgeNodeBindings(nodeUuid);
    registry.detach(nodeUuid, { immediate: true });
  }
  return stale;
}

/**
 * Reconcile persisted remote sessions with the sessions actually held by an executor.
 * A control-plane restart must not infer session death from the node heartbeat alone.
 * @param {{ id: number, nodeUuid: string }} node executor node record
 * @returns {Promise<{ kept: number, crashed: number, bibReattached: number, skipped?: string }>} reconcile result
 */
export async function reconcileRemoteSessions(node) {
  if (!node?.id || !node.nodeUuid) return { kept: 0, crashed: 0, bibReattached: 0 };

  let liveSessions;
  try {
    liveSessions = await listExecutorSessions(node.nodeUuid, 8000);
  } catch (err) {
    // An unreachable executor is not proof that its sessions are gone.
    return { kept: 0, crashed: 0, bibReattached: 0, skipped: err.message };
  }

  const liveByAgent = new Map(
    liveSessions
      .filter((session) => session?.sessionId)
      .map((session) => [String(session.sessionId), session]),
  );
  const rows = await remoteSessionDao.listByNode(node.id, ['active', 'idle']);
  let kept = 0;
  let crashed = 0;
  let bibReattached = 0;

  for (const row of rows) {
    const agentId = row.agentSessionId ? String(row.agentSessionId) : '';
    const live = agentId ? liveByAgent.get(agentId) : null;
    if (!live) {
      // Only an authoritative session.list miss permits crash cleanup.
      await remoteSessionDao.close(row.id, { crashed: true });
      const { clearOwnershipOnClose } = await import('./session-lifecycle.js');
      await clearOwnershipOnClose(row.id).catch(() => {});
      if (agentId) {
        slotLease.releaseBySession(agentId);
        const session = state.sessions.get(agentId);
        if (session) {
          if (session._persistUnsub) {
            try { session._persistUnsub(); } catch {}
          }
          if (session._trajPersistUnsub) {
            try { session._trajPersistUnsub(); } catch {}
          }
          if (session._aiRecordUnsub) {
            try { session._aiRecordUnsub(); } catch {}
          }
          state.sessions.delete(agentId);
        }
        for (const [tid, runtime] of [...getAllTrajectoryRuntimes().entries()]) {
          if (runtime?.sessionId === agentId) {
            getAllTrajectoryRuntimes().delete(tid);
          }
        }
      }
      crashed += 1;
      continue;
    }

    kept += 1;
    restoreLiveBindingFromRow(row, { nodeUuid: node.nodeUuid, attached: row.status === 'active' });
    if (row.trajectoryId != null && agentId) {
      await restoreTrajectoryRuntime(row, live, node.nodeUuid);
    }
    if (row.status !== 'active' || !agentId) continue;

    try {
      sendToExecutor(node.nodeUuid, 'session.attach_bib', {
        sessionId: agentId,
        remoteSessionUuid: row.sessionUuid,
        viewportW: row.viewportW || 1600,
        viewportH: row.viewportH || 900,
        deviceScaleFactor: row.deviceScaleFactor || 1,
      });
      bibReattached += 1;
    } catch (err) {
      console.warn(`[executor] BiB reattach failed for remote_session #${row.id}:`, err.message);
    }
  }

  return { kept, crashed, bibReattached };
}

/**
 * Rebuild the minimal control-plane session/runtime identity lost during restart.
 * @param {object} row remote_session row
 * @param {object} live executor session descriptor
 * @param {string} nodeUuid executor node UUID
 * @returns {Promise<void>}
 */
async function restoreTrajectoryRuntime(row, live, nodeUuid) {
  const [{ registerTrajectorySession }, { bindTrajectoryManualPersist }] = await Promise.all([
    import('./trajectory/trajectory-runtime.js'),
    import('./trajectory/trajectory-attach-service.js'),
  ]);
  const tid = Number(row.trajectoryId);
  if (!Number.isFinite(tid) || tid <= 0) return;
  const runtime = registerTrajectorySession(tid, String(row.agentSessionId), {
    nodeUuid,
    slotIndex: row.slotIndex,
    model: live.model || null,
    cdpPort: live.cdpPort ?? null,
    cdpReady: true,
  }, { remoteSessionId: row.id });
  slotLease.confirmLease({
    sessionId: String(row.agentSessionId),
    nodeUuid,
    slotIndex: row.slotIndex ?? live.slotIndex ?? 0,
    trajectoryId: tid,
  });
  bindTrajectoryManualPersist(tid, String(row.agentSessionId), runtime);
}
