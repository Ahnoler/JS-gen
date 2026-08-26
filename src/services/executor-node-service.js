/**
 * Executor node service: registration, heartbeat, drain, disconnect grace,
 * and stale-node sweep — coordinates DAO, registry, slot lease, and bindings.
 */
import * as executorNodeDao from '../dao/executor-node-dao.js';
import * as registry from '../executor-registry.js';
import * as slotLease from '../executor-slot-lease.js';
import { clearTrajectoryRuntimesForNode } from './trajectory-service.js';
import { state } from '../state.js';
import {
  EXECUTOR_DISCONNECT_GRACE_MS,
} from '../../config/config.js';

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
    await executorNodeDao.crashActiveSessions(nodeId);
    purgeNodeBindings(nodeUuid);
    registry.detach(nodeUuid, { immediate: true });
  }
  return stale;
}
