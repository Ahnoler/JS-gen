import * as executorNodeDao from '../dao/executor-node-dao.js';
import * as registry from '../executor-registry.js';
import {
  EXECUTOR_DISCONNECT_GRACE_MS,
} from '../../config/config.js';

/**
 * @param {Object} data
 * @param {string} data.nodeUuid
 * @param {string} data.name
 * @param {string} [data.host]
 * @param {number} [data.capacity]
 * @param {Object} [data.labels]
 * @param {string} [data.agentVersion]
 */
export async function register(data) {
  if (!data?.nodeUuid || !data?.name) {
    throw new Error('nodeUuid and name are required');
  }
  return executorNodeDao.upsertByUuid(data);
}

export async function heartbeat(nodeUuid) {
  const ok = await executorNodeDao.touchHeartbeat(nodeUuid);
  if (ok) registry.touch(nodeUuid);
  return ok;
}

/** Graceful unregister: offline + crash active sessions + detach. */
export async function unregister(nodeUuid) {
  const node = await executorNodeDao.getByUuid(nodeUuid);
  if (!node) return null;

  await executorNodeDao.setStatus(nodeUuid, 'offline');
  await executorNodeDao.crashActiveSessions(node.id);
  registry.detach(nodeUuid, { immediate: true });
  return node;
}

/** Mark node offline and crash its active sessions (disconnect / sweep). */
export async function markOfflineAndCrash(nodeUuid, nodeId) {
  await executorNodeDao.setStatus(nodeUuid, 'offline');
  await executorNodeDao.crashActiveSessions(nodeId);
}

export async function drain(nodeUuid) {
  const node = await executorNodeDao.getByUuid(nodeUuid);
  if (!node) return null;

  await executorNodeDao.setStatus(nodeUuid, 'draining');
  registry.send(nodeUuid, 'executor.drain', { nodeUuid });
  return executorNodeDao.getByUuid(nodeUuid);
}

/**
 * Handle non-graceful WS disconnect — start grace timer for auto-reconnect.
 * @param {string} nodeUuid
 * @param {number} nodeId
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

export async function list() {
  return executorNodeDao.list();
}

export async function getByUuid(nodeUuid) {
  const node = await executorNodeDao.getByUuid(nodeUuid);
  if (!node) return null;
  const all = await executorNodeDao.list();
  return all.find((n) => n.nodeUuid === nodeUuid) || { ...node, inUse: 0 };
}

/**
 * Periodic sweep: stale heartbeat → offline + crash sessions.
 * @param {number} timeoutMs
 */
export async function sweepStale(timeoutMs) {
  const stale = await executorNodeDao.markStaleOffline(timeoutMs);
  for (const { nodeId, nodeUuid } of stale) {
    await executorNodeDao.crashActiveSessions(nodeId);
    registry.detach(nodeUuid, { immediate: true });
  }
  return stale;
}
