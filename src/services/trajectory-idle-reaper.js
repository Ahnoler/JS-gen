/**
 * Auto-detach trajectory executor resources after prolonged inactivity.
 * Idle = no new trajectory_step persisted for IDLE_MS, and session not busy / not manual-recording.
 * Leaving the recording studio does NOT detach — this reaper is the reclaim path.
 */
import { getDB } from '../../config/database.js';
import {
  getAllTrajectoryRuntimes,
  detachTrajectoryLive,
} from './trajectory-service.js';
import { state } from '../state.js';

const IDLE_MS = 10 * 60 * 1000;
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

/**
 * @returns {Promise<{ checked: number, detached: number[] }>}
 */
export async function reapIdleTrajectoryRuntimes() {
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
      await detachTrajectoryLive(tid);
      detached.push(Number(tid));
    } catch (err) {
      console.warn(`[idle-reaper] detach failed for traj #${tid}:`, err.message);
    }
  }

  return { checked: map.size, detached };
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
