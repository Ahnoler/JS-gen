/**
 * Orphan executor-session reconcile — closes live executor sessions that have
 * no owning remote_session row and no in-memory control-plane session.
 *
 * After a control-plane restart the boot sweep may have crashed remote_session
 * rows (stale-heartbeat markStaleOffline) while the executor-side Python/Chrome
 * processes are still alive. Such sessions are invisible to the control plane
 * (no row binding, no lease, no state.sessions entry) and occupy an executor
 * slot forever. Closing the Python agent with keepBrowser=true frees the slot
 * and turns the Chrome into a reusable orphan CDP browser (preferIdleChrome).
 */
import * as remoteSessionDao from '../dao/remote-session-dao.js';
import { listExecutorSessions, closeSession } from '../executor-session-client.js';
import { state } from '../state.js';

/**
 * Pick live executor sessions that have no known owner.
 * @param {object[]} liveSessions sessions from executor session.list
 * @param {Set<string>|string[]} knownAgentSessionIds protected agent session ids
 * @returns {object[]} orphan session objects (each has sessionId)
 */
export function selectOrphanSessions(liveSessions, knownAgentSessionIds) {
  const known = new Set(Array.from(knownAgentSessionIds || [], String));
  return (Array.isArray(liveSessions) ? liveSessions : []).filter(
    // ready !== true covers in-flight session.open (slot.sessionId is set before
    // ready, and the control-plane session is not yet in state.sessions) — never close those.
    (s) => s?.sessionId && s.ready === true && !known.has(String(s.sessionId)),
  );
}

/**
 * Reconcile one executor node's live sessions against control-plane ownership.
 * @param {{ nodeUuid: string, id: number }} node executor node record
 * @returns {Promise<{ closed: number, kept: number, skipped?: string }>} reconcile counts
 */
export async function reconcileOrphanSessions(node) {
  if (!node?.nodeUuid) return { closed: 0, kept: 0 };
  let live = [];
  try {
    live = await listExecutorSessions(node.nodeUuid, 8000);
  } catch (err) {
    console.warn(`[orphan-reconcile] session.list failed for ${node.nodeUuid}:`, err.message);
    return { closed: 0, kept: 0, skipped: err.message };
  }
  const rows = await remoteSessionDao
    .listByNode(node.id, ['active', 'idle'])
    .catch(() => []);
  /** @type {Set<string>} protected agent session ids */
  const known = new Set(
    rows.map((r) => r.agentSessionId).filter(Boolean).map(String),
  );
  for (const [sid, session] of state.sessions.entries()) {
    if (session?.executorNodeUuid === node.nodeUuid) known.add(String(sid));
  }
  const orphans = selectOrphanSessions(live, known);
  let closed = 0;
  for (const s of orphans) {
    const sid = String(s.sessionId);
    try {
      await closeSession({
        nodeUuid: node.nodeUuid,
        sessionId: sid,
        keepBrowser: true,
        timeoutMs: 10000,
      });
      closed += 1;
    } catch (err) {
      console.warn(`[orphan-reconcile] close failed ${sid}:`, err.message);
    }
  }
  return { closed, kept: live.length - orphans.length };
}
