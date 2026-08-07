/**
 * Batch Excel import → analyze → draft → prepare → record → detach.
 * Persistent MySQL job/items; global FIFO recording; restart-safe recovery.
 */
import { createHash, randomUUID } from 'crypto';
import {
  USE_EXECUTOR,
  BATCH_ANALYZE_CONCURRENCY,
  BATCH_SCHEDULER_INTERVAL_MS,
  BATCH_ANALYZE_MAX_ATTEMPTS,
  BATCH_ITEM_LEASE_MS,
  BATCH_IMPORT_MAX_ROWS,
} from '../../config/config.js';
import { getDB } from '../../config/database.js';
import * as batchDao from '../dao/batch-recording-dao.js';
import * as trajectoryDao from '../dao/trajectory-dao.js';
import { broadcast } from '../ws-server.js';
import { analyzeRequirementToPhases, createTransactionWithPhases } from './trajectory-meta-service.js';
import { validateFunctionAndAccount } from './trajectory-account-service.js';
import { parseBatchExcelBuffer, buildTemplateBuffer } from './trajectory-batch-excel.js';
import {
  prepareTrajectoryRecording,
  startTrajectoryRecording,
  stopTrajectoryRecordingSafe,
  detachTrajectoryLive,
  cleanupPersistedTrajectoryResources,
} from './trajectory-recording-service.js';
import * as registry from '../executor-registry.js';
import * as executorNodeDao from '../dao/executor-node-dao.js';
import * as slotLease from '../executor-slot-lease.js';
import { BATCH_JOB_MODES, BATCH_JOB_TERMINAL } from '../models/constants.js';

/** @type {Set<string>} in-flight cancel tokens for analyzing items */
const cancelledAnalyzeTokens = new Set();

let analyzeWorkers = 0;
let recordWorkers = 0;
let schedulerTimer = null;
let kicking = false;
let started = false;

export function buildRequestHash({
  fileBuffer,
  functionId,
  systemAccountId,
  model = '',
  mode = 'record',
}) {
  const h = createHash('sha256');
  h.update(Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer || ''));
  h.update('|');
  h.update(String(functionId));
  h.update('|');
  h.update(String(systemAccountId));
  h.update('|');
  h.update(String(model || ''));
  h.update('|');
  h.update(mode === 'draft' ? 'draft' : 'record');
  return h.digest('hex');
}

function normalizeBatchMode(raw) {
  if (raw == null || raw === '') return 'record';
  const m = String(raw).trim().toLowerCase();
  if (!BATCH_JOB_MODES.includes(m)) {
    const err = new Error('mode must be record or draft');
    err.statusCode = 400;
    throw err;
  }
  return m;
}

async function emitProgress(batchId, item = null, extra = {}) {
  const job = await batchDao.getJobById(batchId);
  const summary = await batchDao.summarizeJob(batchId);
  const payload = {
    batchId,
    mode: job?.mode || 'record',
    jobStatus: job?.status || null,
    summary,
    itemId: item?.id ?? null,
    row: item?.rowNumber ?? null,
    trajectoryId: item?.trajectoryId ?? null,
    itemStatus: item?.status ?? null,
    version: item?.version ?? null,
    error: item?.errorMessage || null,
    ...extra,
  };
  try {
    broadcast('batch:progress', payload);
  } catch {}
  return payload;
}

async function maybeFinalizeJob(batchId, { cancelled = false } = {}) {
  const job = await batchDao.getJobById(batchId);
  if (!job || BATCH_JOB_TERMINAL.includes(job.status)) return job;

  if (job.status === 'cancelling' || cancelled) {
    const inflight = await batchDao.listInFlightItemsByBatch(batchId);
    // analyzing counts as in-flight for cancel wait; preparing/recording too
    if (inflight.some((i) => ['preparing', 'recording'].includes(i.status))) {
      return job;
    }
    // analyzing may still be running LLM — wait until no analyzing either
    if (inflight.some((i) => i.status === 'analyzing')) {
      return job;
    }
    await batchDao.forceUpdateJob(batchId, { status: 'cancelled' });
    const summary = await batchDao.summarizeJob(batchId);
    try {
      broadcast('batch:done', {
        batchId,
        mode: job.mode || 'record',
        jobStatus: 'cancelled',
        summary,
      });
    } catch {}
    return batchDao.getJobById(batchId);
  }

  const summary = await batchDao.summarizeJob(batchId);
  const terminal = batchDao.deriveJobTerminalStatus(summary, { cancelled: false });
  if (!terminal) {
    // still running — promote waiting if needed
    if ((summary.waitingExecutor || 0) > 0
      && (summary.preparing || 0) === 0
      && (summary.recording || 0) === 0
      && (summary.queued || 0) === 0
      && (summary.analyzing || 0) === 0
      && (summary.analyzed || 0) === 0
      && (summary.pending || 0) === 0) {
      await batchDao.updateJobStatus(batchId, ['accepted', 'running'], 'waiting_executor');
    } else {
      await batchDao.updateJobStatus(batchId, ['accepted', 'waiting_executor'], 'running');
    }
    return batchDao.getJobById(batchId);
  }

  await batchDao.forceUpdateJob(batchId, { status: terminal });
  try {
    broadcast('batch:done', {
      batchId,
      mode: job.mode || 'record',
      jobStatus: terminal,
      summary,
    });
  } catch {}
  return batchDao.getJobById(batchId);
}

export async function getBatchJobView(batchId, {
  page = 1,
  pageSize = 50,
} = {}) {
  const job = await batchDao.getJobById(batchId);
  if (!job) {
    const err = new Error('Batch not found');
    err.statusCode = 404;
    throw err;
  }
  const items = await batchDao.listItemsByBatch(batchId, { page, pageSize });
  const summary = await batchDao.summarizeJob(batchId);
  return {
    batchId: job.id,
    status: job.status,
    mode: job.mode || 'record',
    functionId: job.functionId,
    systemAccountId: job.systemAccountId,
    model: job.model,
    originalFilename: job.originalFilename,
    idempotencyKey: job.idempotencyKey,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    cancelRequestedAt: job.cancelRequestedAt,
    summary,
    items: items.rows,
    page: items.page,
    pageSize: items.pageSize,
    total: items.total,
  };
}

export async function importBatchFromExcel({
  fileBuffer,
  originalFilename = '',
  functionId,
  systemAccountId,
  model = '',
  idempotencyKey,
  mode: rawMode,
} = {}) {
  const mode = normalizeBatchMode(rawMode);

  if (mode === 'record' && !USE_EXECUTOR) {
    const err = new Error('Batch import requires USE_EXECUTOR=true');
    err.statusCode = 503;
    throw err;
  }
  const key = String(idempotencyKey || '').trim();
  if (!key) {
    const err = new Error('Idempotency-Key header is required');
    err.statusCode = 400;
    throw err;
  }
  if (!fileBuffer?.length) {
    const err = new Error('file is required');
    err.statusCode = 400;
    throw err;
  }

  const validated = await validateFunctionAndAccount(functionId, systemAccountId);
  const modelId = String(model || '').trim();
  const requestHash = buildRequestHash({
    fileBuffer,
    functionId: validated.functionId,
    systemAccountId: validated.systemAccountId,
    model: modelId,
    mode,
  });

  const existing = await batchDao.getJobByIdempotencyKey(key);
  if (existing) {
    if (existing.requestHash !== requestHash) {
      const err = new Error(
        'Idempotency-Key reused with different request content — generate a new key',
      );
      err.statusCode = 409;
      throw err;
    }
    const view = await getBatchJobView(existing.id);
    view._idempotentReplay = true;
    view._httpStatus = BATCH_JOB_TERMINAL.includes(existing.status) ? 200 : 202;
    return view;
  }

  const parsed = await parseBatchExcelBuffer(fileBuffer, {
    maxRows: BATCH_IMPORT_MAX_ROWS,
  });
  if (!parsed.valid.length) {
    const err = new Error(
      parsed.rejected.length
        ? 'No valid rows in Excel'
        : 'Excel has no data rows',
    );
    err.statusCode = 400;
    err.rejected = parsed.rejected;
    throw err;
  }

  const batchId = randomUUID();
  const items = [
    ...parsed.valid.map((r) => ({
      rowNumber: r.rowNumber,
      name: r.name,
      requirement: r.requirement,
      status: 'pending',
    })),
    ...parsed.rejected.map((r) => ({
      rowNumber: r.rowNumber,
      name: r.name || '',
      requirement: r.requirement || '',
      status: 'rejected',
      errorCode: 'VALIDATION',
      errorMessage: r.error,
    })),
  ];

  try {
    await batchDao.createJob({
      id: batchId,
      idempotencyKey: key,
      requestHash,
      functionId: validated.functionId,
      systemAccountId: validated.systemAccountId,
      model: modelId,
      mode,
      originalFilename: String(originalFilename || ''),
      status: 'accepted',
    }, items);
  } catch (err) {
    // Unique idempotency race — return existing
    if (/uk_batch_job_idempotency|ER_DUP_ENTRY/i.test(err.message || '')) {
      const again = await batchDao.getJobByIdempotencyKey(key);
      if (again) {
        const view = await getBatchJobView(again.id);
        view._idempotentReplay = true;
        view._httpStatus = BATCH_JOB_TERMINAL.includes(again.status) ? 200 : 202;
        return view;
      }
    }
    throw err;
  }

  await batchDao.updateJobStatus(batchId, ['accepted'], 'running');
  kickScheduler();

  const view = await getBatchJobView(batchId);
  view._httpStatus = 202;
  return view;
}

export { buildTemplateBuffer };

// ── Scheduler / workers ───────────────────────────────────────────────

export function startBatchScheduler() {
  if (started) return;
  started = true;
  schedulerTimer = setInterval(() => {
    kickScheduler();
  }, BATCH_SCHEDULER_INTERVAL_MS);
  schedulerTimer.unref?.();
  kickScheduler();
}

export function kickScheduler() {
  if (kicking) return;
  kicking = true;
  setImmediate(() => {
    kicking = false;
    pumpAnalyze().catch((err) => console.error('[batch] analyze pump:', err));
    pumpRecord().catch((err) => console.error('[batch] record pump:', err));
  });
}

async function pumpAnalyze() {
  while (analyzeWorkers < BATCH_ANALYZE_CONCURRENCY) {
    const token = randomUUID();
    const item = await batchDao.claimNextItem({
      statuses: ['pending', 'analyzing'],
      workerToken: token,
      leaseMs: BATCH_ITEM_LEASE_MS,
      jobStatuses: ['accepted', 'running', 'waiting_executor'],
    });
    if (!item) break;
    // If claimed while already analyzing (restart), reset to analyzing
    if (item.status === 'pending') {
      const moved = await batchDao.transitionItem(item.id, ['pending'], 'analyzing', {
        version: item.version,
        expectedWorkerToken: token,
        workerToken: token,
        extra: { leaseExpiresAt: new Date(Date.now() + BATCH_ITEM_LEASE_MS) },
      });
      if (!moved) continue;
      analyzeWorkers += 1;
      runAnalyze(moved, token).finally(() => {
        analyzeWorkers -= 1;
        kickScheduler();
      });
    } else {
      analyzeWorkers += 1;
      runAnalyze(item, token).finally(() => {
        analyzeWorkers -= 1;
        kickScheduler();
      });
    }
  }
}

async function runAnalyze(item, token) {
  const batchId = item.batchId;
  const job = await batchDao.getJobById(batchId);
  if (!job || job.status === 'cancelling' || job.status === 'cancelled') {
    cancelledAnalyzeTokens.add(token);
    await batchDao.markItemCancelled(item.id, ['analyzing', 'pending'], {
      version: item.version,
      errorMessage: 'Cancelled during analyze',
    });
    await emitProgress(batchId);
    await maybeFinalizeJob(batchId, { cancelled: true });
    return;
  }

  await emitProgress(batchId, { ...item, status: 'analyzing' });

  try {
    const result = await analyzeRequirementToPhases({
      description: item.requirement,
      model: job.model || undefined,
    });

    if (cancelledAnalyzeTokens.has(token)
      || (await batchDao.getJobById(batchId))?.status === 'cancelling') {
      cancelledAnalyzeTokens.delete(token);
      await batchDao.markItemCancelled(item.id, ['analyzing'], {
        errorMessage: 'Cancelled — analyze result discarded',
      });
      await emitProgress(batchId);
      await maybeFinalizeJob(batchId, { cancelled: true });
      return;
    }

    const phases = Array.isArray(result?.phases) ? result.phases.filter(Boolean) : [];
    if (!phases.length) {
      const fresh = await batchDao.getItemById(item.id);
      await batchDao.markItemFailed(item.id, ['analyzing'], {
        version: fresh?.version,
        expectedWorkerToken: token,
        errorCode: 'EMPTY_PHASES',
        errorMessage: `Row ${item.rowNumber}: analyze returned no phases`,
      });
      await emitProgress(batchId);
      await maybeFinalizeJob(batchId);
      return;
    }

    const analysis = {
      phases,
      caseEntries: Array.isArray(result.caseEntries) ? result.caseEntries : [],
    };
    const fresh = await batchDao.getItemById(item.id);
    const saved = await batchDao.transitionItem(item.id, ['analyzing'], 'analyzed', {
      version: fresh?.version,
      expectedWorkerToken: token,
      clearLease: true,
      extra: { analysisJson: JSON.stringify(analysis), errorCode: null, errorMessage: null },
    });
    if (!saved) return;
    await emitProgress(batchId, saved);
    await createDraftFromAnalyzed(saved);
  } catch (err) {
    const fresh = await batchDao.getItemById(item.id);
    const attempts = Number(fresh?.attemptCount || item.attemptCount || 1);
    if (attempts < BATCH_ANALYZE_MAX_ATTEMPTS
      && !(await batchDao.getJobById(batchId))?.status?.startsWith('cancel')) {
      await batchDao.transitionItem(item.id, ['analyzing'], 'pending', {
        version: fresh?.version,
        expectedWorkerToken: token,
        clearLease: true,
        extra: {
          errorCode: 'ANALYZE_RETRY',
          errorMessage: String(err.message || err).slice(0, 2000),
          nextAttemptAt: new Date(Date.now() + Math.min(60000, 2000 * attempts)),
        },
      });
    } else {
      await batchDao.markItemFailed(item.id, ['analyzing', 'pending'], {
        version: fresh?.version,
        expectedWorkerToken: token,
        errorCode: 'ANALYZE_FAILED',
        errorMessage: String(err.message || err).slice(0, 4000),
      });
      await emitProgress(batchId);
      await maybeFinalizeJob(batchId);
    }
  }
}

/**
 * Atomic: create trajectory+phases+case + bind item → queued.
 */
async function createDraftFromAnalyzed(item) {
  const job = await batchDao.getJobById(item.batchId);
  if (!job || job.status === 'cancelling' || job.status === 'cancelled') {
    await batchDao.markItemCancelled(item.id, ['analyzed'], {
      version: item.version,
      errorMessage: 'Cancelled before draft create',
    });
    await maybeFinalizeJob(item.batchId, { cancelled: true });
    return;
  }

  const analysis = item.analysisJson || {};
  const phases = analysis.phases || [];
  if (!phases.length) {
    await batchDao.markItemFailed(item.id, ['analyzed'], {
      version: item.version,
      errorCode: 'EMPTY_PHASES',
      errorMessage: `Row ${item.rowNumber}: empty phases`,
    });
    await maybeFinalizeJob(item.batchId);
    return;
  }

  try {
    await getDB().transaction(async (trx) => {
      const trajId = await createTransactionWithPhases({
        functionId: Number(job.functionId),
        name: item.name,
        requirement: item.requirement,
        phases,
        caseEntries: analysis.caseEntries || [],
        model: job.model || '',
        systemAccountId: Number(job.systemAccountId),
        requireFunctionId: true,
        trx,
      });
      if (job.mode === 'draft') {
        const bound = await batchDao.bindTrajectoryAsDrafted(item.id, trajId, {
          version: item.version,
          trx,
        });
        if (!bound) {
          throw Object.assign(new Error('Lost CAS while binding trajectory'), { code: 'CAS' });
        }
      } else {
        const bound = await batchDao.bindTrajectoryAndQueue(item.id, trajId, {
          version: item.version,
          trx,
        });
        if (!bound) {
          throw Object.assign(new Error('Lost CAS while binding trajectory'), { code: 'CAS' });
        }
      }
    });
    const fresh = await batchDao.getItemById(item.id);
    await emitProgress(item.batchId, fresh);
    if (job.mode === 'draft') {
      await maybeFinalizeJob(item.batchId);
    } else {
      kickScheduler();
    }
  } catch (err) {
    if (err.code === 'CAS') return;
    const fresh = await batchDao.getItemById(item.id);
    await batchDao.markItemFailed(item.id, ['analyzed'], {
      version: fresh?.version,
      errorCode: 'DRAFT_FAILED',
      errorMessage: String(err.message || err).slice(0, 4000),
    });
    await emitProgress(item.batchId);
    await maybeFinalizeJob(item.batchId);
  }
}

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

async function pumpRecord() {
  // Dynamic: start as many workers as free slots (at least try one if waiting)
  const free = await computeClusterFreeSlots();
  const want = Math.max(free, recordWorkers > 0 ? 0 : (free > 0 ? free : 1));
  while (recordWorkers < want) {
    const token = randomUUID();
    const item = await batchDao.claimNextItem({
      statuses: ['queued', 'waiting_executor', 'analyzed'],
      workerToken: token,
      leaseMs: BATCH_ITEM_LEASE_MS,
      jobStatuses: ['accepted', 'running', 'waiting_executor'],
      jobModes: ['record'],
    });
    if (!item) break;

    // analyzed without trajectory should go to draft create first
    if (item.status === 'analyzed' && !item.trajectoryId) {
      recordWorkers += 1;
      createDraftFromAnalyzed(item).finally(() => {
        recordWorkers -= 1;
        kickScheduler();
      });
      continue;
    }

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

export async function cancelBatch(batchId) {
  const job = await batchDao.getJobById(batchId);
  if (!job) {
    const err = new Error('Batch not found');
    err.statusCode = 404;
    throw err;
  }
  if (BATCH_JOB_TERMINAL.includes(job.status)) {
    return getBatchJobView(batchId);
  }

  await batchDao.forceUpdateJob(batchId, {
    status: 'cancelling',
    cancelRequestedAt: new Date(),
  });
  await batchDao.cancelOpenItems(batchId);

  const inflight = await batchDao.listInFlightItemsByBatch(batchId);
  for (const item of inflight) {
    if (item.status === 'analyzing') {
      if (item.workerToken) cancelledAnalyzeTokens.add(item.workerToken);
      continue;
    }
    if (item.status === 'preparing' || item.status === 'recording') {
      const tid = Number(item.trajectoryId);
      if (tid) {
        try {
          if (item.status === 'recording') {
            await stopTrajectoryRecordingSafe(tid, { success: false });
          }
        } catch {}
        try {
          await detachTrajectoryLive(tid, { reason: 'batch_cancel' });
        } catch {}
      }
      await batchDao.markItemCancelled(item.id, ['preparing', 'recording'], {
        version: item.version,
        errorMessage: 'Cancelled',
      });
    }
  }

  await maybeFinalizeJob(batchId, { cancelled: true });
  kickScheduler();
  return getBatchJobView(batchId);
}

/**
 * Called after executor reconnect window on control-plane boot.
 */
export async function recoverBatchJobsOnStartup() {
  const items = await batchDao.listItemsNeedingRecovery();
  for (const item of items) {
    try {
      if (item.status === 'preparing' || item.status === 'recording') {
        const tid = Number(item.trajectoryId);
        if (tid) {
          const traj = await trajectoryDao.getById(tid).catch(() => null);
          if (traj?.recordStatus === 'recorded' || traj?.recordStatus === 'completed') {
            await batchDao.transitionItem(item.id, ['preparing', 'recording'], 'recorded', {
              clearLease: true,
              extra: { errorCode: null, errorMessage: null },
            });
            await cleanupPersistedTrajectoryResources(tid, {
              demoteLive: false,
              reason: 'batch_recovery',
            });
            await maybeFinalizeJob(item.batchId);
            continue;
          }
          await cleanupPersistedTrajectoryResources(tid, {
            demoteLive: true,
            reason: 'batch_recovery',
          });
        }
        await batchDao.markItemFailed(item.id, ['preparing', 'recording'], {
          version: item.version,
          errorCode: 'INTERRUPTED',
          errorMessage: 'Interrupted by control-plane restart — draft retained for manual review',
        });
        await maybeFinalizeJob(item.batchId);
        continue;
      }

      if (item.status === 'analyzing') {
        // Safe to retry analyze
        await batchDao.transitionItem(item.id, ['analyzing'], 'pending', {
          version: item.version,
          clearLease: true,
          extra: {
            errorCode: 'RESTART_RETRY',
            errorMessage: 'Retrying analyze after restart',
            nextAttemptAt: new Date(),
          },
        });
        continue;
      }

      // pending / analyzed / queued / waiting_executor — clear stale leases
      await batchDao.transitionItem(item.id, [item.status], item.status, {
        version: item.version,
        clearLease: true,
        extra: { nextAttemptAt: new Date() },
      });
    } catch (err) {
      console.warn('[batch] recovery item failed:', item.id, err.message);
    }
  }

  // Jobs stuck in cancelling → continue cancel converge
  const jobs = await batchDao.listJobsNeedingRecovery();
  for (const job of jobs) {
    if (job.status === 'cancelling') {
      try {
        await cancelBatch(job.id);
      } catch (err) {
        console.warn('[batch] cancel recover failed:', job.id, err.message);
      }
    } else {
      await maybeFinalizeJob(job.id);
    }
  }

  startBatchScheduler();
  kickScheduler();
  console.log(`[batch] recovery complete — ${items.length} item(s) inspected`);
}
