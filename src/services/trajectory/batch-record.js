/**
 * Batch record pipeline: free cluster-slot computation → claim queued items →
 * prepare → record → detach, with cancel / no-slot / recovery semantics.
 * Extracted from trajectory-batch-service.js — move-only, no logic changes.
 */
import { randomUUID } from 'crypto';
import { BATCH_ITEM_LEASE_MS } from '../../../config/config.js';
import * as batchDao from '../../dao/batch-recording-dao.js';
import * as trajectoryDao from '../../dao/trajectory-dao.js';
import * as executorNodeDao from '../../dao/executor-node-dao.js';
import * as registry from '../../executor-registry.js';
import * as slotLease from '../../executor-slot-lease.js';
import {
  prepareTrajectoryRecording,
  startTrajectoryRecording,
  detachTrajectoryLive,
} from './trajectory-recording-service.js';
import {
  emitProgress,
  maybeFinalizeJob,
  kickScheduler,
} from './trajectory-batch-service.js';

let recordWorkers = 0;

async function computeClusterFreeSlots() {
  const dbNodes = await executorNodeDao.list().catch(() => []);
  const byUuid = new Map(dbNodes.map((n) => [n.nodeUuid, n]));
  const live = registry.list().filter((n) => n.connected);
  let free = 0;
  for (const n of live) {
    const row = byUuid.get(n.nodeUuid);
    if (row?.status === 'draining' || row?.status === 'offline') continue;
    const capacity = Math.max(1, Number(row?.capacity) || 1);
    const inUse = slotLease.countInUse(n.nodeUuid);
    free += Math.max(0, capacity - inUse);
  }
  return free;
}

export async function pumpRecord() {
  // Dynamic: start as many workers as free slots (at least try one if waiting)
  const free = await computeClusterFreeSlots();
  const want = Math.max(free, recordWorkers > 0 ? 0 : (free > 0 ? free : 1));
  while (recordWorkers < want) {
    const token = randomUUID();
    const item = await batchDao.claimNextItem({
      statuses: ['queued', 'waiting_executor'],
      workerToken: token,
      leaseMs: BATCH_ITEM_LEASE_MS,
      jobStatuses: ['accepted', 'running', 'waiting_executor'],
      jobModes: ['record'],
    });
    if (!item) break;

    if (!item.trajectoryId) {
      await batchDao.markItemFailed(item.id, [item.status], {
        errorCode: 'NO_TRAJECTORY',
        errorMessage: 'Missing trajectoryId',
      });
      continue;
    }

    const moved = await batchDao.transitionItem(
      item.id,
      ['queued', 'waiting_executor'],
      'preparing',
      {
        version: item.version,
        expectedWorkerToken: token,
        workerToken: token,
        extra: { leaseExpiresAt: new Date(Date.now() + BATCH_ITEM_LEASE_MS) },
      },
    );
    if (!moved) continue;

    recordWorkers += 1;
    runRecord(moved, token).finally(() => {
      recordWorkers -= 1;
      kickScheduler();
    });
  }
}

async function runRecord(item, token) {
  const batchId = item.batchId;
  const tid = Number(item.trajectoryId);
  let prepared = false;

  const job = await batchDao.getJobById(batchId);
  if (!job || job.status === 'cancelling' || job.status === 'cancelled') {
    try {
      await detachTrajectoryLive(tid, { reason: 'batch_cancel' });
    } catch {}
    await batchDao.markItemCancelled(item.id, ['preparing', 'recording'], {
      errorMessage: 'Cancelled before/during record',
    });
    await emitProgress(batchId);
    await maybeFinalizeJob(batchId, { cancelled: true });
    return;
  }

  await emitProgress(batchId, { ...item, status: 'preparing' });

  try {
    await prepareTrajectoryRecording(tid);
    prepared = true;

    // Cancel may have arrived during prepare
    const job2 = await batchDao.getJobById(batchId);
    if (!job2 || job2.status === 'cancelling' || job2.status === 'cancelled') {
      try {
        await detachTrajectoryLive(tid, { reason: 'batch_cancel' });
      } catch {}
      await batchDao.markItemCancelled(item.id, ['preparing'], {
        errorMessage: 'Cancelled after prepare',
      });
      await emitProgress(batchId);
      await maybeFinalizeJob(batchId, { cancelled: true });
      return;
    }

    const fresh = await batchDao.getItemById(item.id);
    const recording = await batchDao.transitionItem(item.id, ['preparing'], 'recording', {
      version: fresh?.version,
      expectedWorkerToken: token,
      workerToken: token,
      extra: { leaseExpiresAt: new Date(Date.now() + BATCH_ITEM_LEASE_MS) },
    });
    if (!recording) {
      try {
        await detachTrajectoryLive(tid, { reason: 'batch_cas_lost' });
      } catch {}
      return;
    }
    await emitProgress(batchId, recording);

    await startTrajectoryRecording(tid);

    const after = await batchDao.getItemById(item.id);
    const marked = await batchDao.markItemRecorded(item.id, {
      version: after?.version,
      expectedWorkerToken: token,
    });
    if (marked) await emitProgress(batchId, marked);

    try {
      await detachTrajectoryLive(tid, { reason: 'batch_complete' });
    } catch (err) {
      console.warn('[batch] detach after success failed:', err.message);
      // do not fail the item — business already recorded
    }

    await maybeFinalizeJob(batchId);
  } catch (err) {
    const msg = String(err.message || err);
    const isNoSlot = err.statusCode === 409
      || /no free|无可用执行资源|No executor agent online/i.test(msg);

    if (isNoSlot && !(await batchDao.getJobById(batchId))?.status?.startsWith('cancel')) {
      if (prepared) {
        try {
          await detachTrajectoryLive(tid, { reason: 'batch_wait_slot' });
        } catch {}
      }
      const fresh = await batchDao.getItemById(item.id);
      await batchDao.markItemWaiting(item.id, ['preparing', 'recording', 'queued'], {
        version: fresh?.version,
        errorMessage: msg,
      });
      await batchDao.updateJobStatus(batchId, ['accepted', 'running'], 'waiting_executor');
      await emitProgress(batchId);
      return;
    }

    try {
      await detachTrajectoryLive(tid, { reason: 'batch_failed' });
    } catch {}

    const fresh = await batchDao.getItemById(item.id);
    // If trajectory already recorded, reconcile success
    const traj = await trajectoryDao.getById(tid).catch(() => null);
    if (traj?.recordStatus === 'recorded' || traj?.recordStatus === 'completed') {
      await batchDao.markItemRecorded(item.id, {
        version: fresh?.version,
        expectedWorkerToken: token,
      }).catch(async () => {
        await batchDao.transitionItem(item.id, ['preparing', 'recording', 'failed'], 'recorded', {
          clearLease: true,
        });
      });
      await emitProgress(batchId);
      await maybeFinalizeJob(batchId);
      return;
    }

    await batchDao.markItemFailed(item.id, ['preparing', 'recording'], {
      version: fresh?.version,
      expectedWorkerToken: token,
      errorCode: err.statusCode === 400 ? 'RECORD_BAD_REQUEST' : 'RECORD_FAILED',
      errorMessage: msg.slice(0, 4000),
    });
    await emitProgress(batchId);
    await maybeFinalizeJob(batchId);
  }
}
