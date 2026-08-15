/**
 * Auto-release trajectory executor resources after prolonged inactivity,
 * and close orphan idle remote_session rows (stream detached, no live agent).
 *
 * Idle traj = no new trajectory_step for IDLE_MS, and session not busy / not manual-recording.
 * Leaving the recording studio does NOT detach — this reaper is the reclaim path.
 */
import { getDB } from '../../../config/database.js';
import {
  getAllTrajectoryRuntimes,
  detachTrajectoryLive,
} from '../trajectory-service.js';
import { state } from '../../state.js';
import * as remoteSessionDao from '../../dao/remote-session-dao.js';
import * as executorNodeDao from '../../dao/executor-node-dao.js';
import { clearLiveBinding, unmountTrajectoriesFromRemoteSession } from '../remote-session-service.js';
import { expireAllDueGrace } from '../session-lifecycle.js';
import * as execSession from '../../executor-session-client.js';
import * as slotLease from '../../executor-slot-lease.js';

const IDLE_MS = 2 * 60 * 60 * 1000;
const TICK_MS = 45 * 1000;

let timer = null;
let running = false;

async function latestStepCreatedAt(trajectoryId) {
  const db = getDB();
  const row = await db('trajectory_step')
    .where({ trajectory_id: Number(trajectoryId) })
    .orderBy('created_at', 'desc')
    .first('created_at');
  return row?.created_at ? new Date(row.created_at).getTime() : null;
}

function parseTs(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

function agentSessionStillLive(agentSessionId) {
  if (!agentSessionId) return false;
  if (state.sessions.has(agentSessionId)) return true;
  for (const runtime of getAllTrajectoryRuntimes().values()) {
    if (runtime?.sessionId === agentSessionId) return true;
  }
  return false;
}

/**
 * Close idle remote_session rows with no trajectory mount and no live agent session.
 * @returns {Promise<number[]>} closed remote_session ids
 */
export async function reapOrphanIdleRemoteSessions() {
  const rows = await remoteSessionDao.listOrphanIdle({ olderThanMs: 0 });
  const closed = [];

  for (const row of rows) {
    // Keep idle browsers that still have a live agent session (stream-detached but reusable).
    if (agentSessionStillLive(row.agentSessionId)) continue;

    try {
      if (row.agentSessionId) {
        let nodeUuid = null;
        if (row.executorNodeId) {
          const node = await executorNodeDao.getById(row.executorNodeId).catch(() => null);
          nodeUuid = node?.nodeUuid || null;
        }
        try {
          await execSession.closeSession({
            nodeUuid,
            sessionId: row.agentSessionId,
            keepBrowser: false,
          });
        } catch {
          slotLease.releaseBySession(row.agentSessionId);
        }
      }
      await remoteSessionDao.close(row.id, { crashed: false });
      clearLiveBinding(row.id);
      await unmountTrajectoriesFromRemoteSession(row.id).catch(() => {});
      closed.push(Number(row.id));
      console.log(`[idle-reaper] closed orphan idle remote_session #${row.id}`);
    } catch (err) {
      console.warn(`[idle-reaper] orphan idle close failed #${row.id}:`, err.message);
    }
  }

  return closed;
}

/**
 * @returns {Promise<{ checked: number, graceExpired: number[], detached: number[], orphanClosed: number[] }>}
 */
export async function reapIdleTrajectoryRuntimes() {
  let graceExpired = [];
  try {
    graceExpired = await expireAllDueGrace();
  } catch (err) {
    console.warn('[idle-reaper] grace expire failed:', err.message);
  }

  const map = getAllTrajectoryRuntimes();
  const now = Date.now();
  const detached = [];

  for (const [tid, runtime] of [...map.entries()]) {
    if (!runtime?.sessionId) continue;

    const session = state.sessions.get(runtime.sessionId);
    if (session?.busy) continue;
    if (runtime.manualRecording) continue;

    let lastStepMs = parseTs(runtime.lastStepAt);
    if (lastStepMs == null) {
      try {
        lastStepMs = await latestStepCreatedAt(tid);
        if (lastStepMs != null) {
          runtime.lastStepAt = new Date(lastStepMs).toISOString();
        }
      } catch (err) {
        console.warn(`[idle-reaper] step lookup failed for traj #${tid}:`, err.message);
        continue;
      }
    }

    const attachedMs = parseTs(runtime.attachedAt) || parseTs(runtime.recordStartAt) || now;
    const anchor = Math.max(lastStepMs || 0, attachedMs);
    if (now - anchor < IDLE_MS) continue;

    try {
      console.log(
        `[idle-reaper] detaching traj #${tid} (idle ${Math.round((now - anchor) / 1000)}s, no steps)`,
      );
      await detachTrajectoryLive(tid, { reason: 'idle' });
      detached.push(Number(tid));
    } catch (err) {
      console.warn(`[idle-reaper] detach failed for traj #${tid}:`, err.message);
    }
  }

  let orphanClosed = [];
  try {
    orphanClosed = await reapOrphanIdleRemoteSessions();
  } catch (err) {
    console.warn('[idle-reaper] orphan idle pass failed:', err.message);
  }

  return { checked: map.size, graceExpired, detached, orphanClosed };
}

export function startTrajectoryIdleReaper() {
  if (timer) return;
  timer = setInterval(() => {
    if (running) return;
    running = true;
    reapIdleTrajectoryRuntimes()
      .catch((err) => console.error('[idle-reaper] tick failed:', err))
      .finally(() => { running = false; });
  }, TICK_MS);
  timer.unref?.();
  console.log(`[idle-reaper] started (idle=${IDLE_MS / 1000}s, tick=${TICK_MS / 1000}s)`);
}

export function stopTrajectoryIdleReaper() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
