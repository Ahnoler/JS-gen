/**
 * Batch Excel import → analyze → draft → prepare → record → detach.
 * Persistent MySQL job/items; global FIFO recording; restart-safe recovery.
 */
import { createHash, randomUUID } from 'crypto';
import {
  USE_EXECUTOR,
  BATCH_SCHEDULER_INTERVAL_MS,
  BATCH_IMPORT_MAX_ROWS,
} from '../../../config/config.js';
import * as batchDao from '../../dao/batch-recording-dao.js';
import * as trajectoryDao from '../../dao/trajectory-dao.js';
import * as trajectoryPhaseDao from '../../dao/trajectory-phase-dao.js';
import { broadcast } from '../../ws-server.js';
import { validateFunctionAndAccount } from '../trajectory-account-service.js';
import { parseBatchExcelBuffer, buildTemplateBuffer } from '../trajectory-batch-excel.js';
import {
  stopTrajectoryRecordingSafe,
  detachTrajectoryLive,
  cleanupPersistedTrajectoryResources,
} from '../trajectory-recording-service.js';
import { BATCH_JOB_MODES, BATCH_JOB_TERMINAL } from '../../models/constants.js';
import { pumpAnalyze, pumpDraft } from './batch-analyze.js';
import { pumpRecord } from './batch-record.js';
import { computeBatchItemProgress, PHASE_LOOKUP_STATUSES } from './batch-item-progress.js';

/** @type {Set<string>} in-flight cancel tokens for analyzing items */
export const cancelledAnalyzeTokens = new Set();

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

export async function enrichBatchItems(items, mode = 'record') {
  const list = Array.isArray(items) ? items : [];
  const ids = [...new Set(list
    .filter((it) => Number(it?.trajectoryId) > 0 && PHASE_LOOKUP_STATUSES.has(String(it.status)))
    .map((it) => Number(it.trajectoryId)))];
  const phases = await trajectoryPhaseDao.listByTrajectoryIds(ids);
  const byTid = new Map();
  for (const p of phases) {
    const tid = Number(p.trajectoryId);
    if (!byTid.has(tid)) byTid.set(tid, []);
    byTid.get(tid).push(p);
  }
  return list.map((it) => {
    const extra = computeBatchItemProgress({
      status: it.status,
      mode,
      trajectoryId: it.trajectoryId,
      phases: byTid.get(Number(it.trajectoryId)) || [],
    });
    return { ...it, ...extra };
  });
}

export async function emitProgress(batchId, item = null, extra = {}) {
  const job = await batchDao.getJobById(batchId);
  const summary = await batchDao.summarizeJob(batchId);
  let progress = {};
  if (item) {
    const [enriched] = await enrichBatchItems([item], job?.mode || 'record');
    progress = {
      progressPercent: enriched.progressPercent,
      phaseCompleted: enriched.phaseCompleted,
      phaseTotal: enriched.phaseTotal,
      phaseName: enriched.phaseName,
      lastDoneText: enriched.lastDoneText,
      itemStatus: enriched.status ?? item.status,
    };
  }
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
    ...progress,
  };
  try {
    broadcast('batch:progress', payload);
  } catch {}
  return payload;
}

export async function maybeFinalizeJob(batchId, { cancelled = false } = {}) {
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
  const enriched = await enrichBatchItems(items.rows, job.mode || 'record');
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
    items: enriched,
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
    const err = new Error('请上传 Excel 文件');
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
        ? 'Excel 中没有有效数据行'
        : '导入文件为空，请至少填写一行交易',
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
    pumpDraft().catch((err) => console.error('[batch] draft pump:', err));
    pumpRecord().catch((err) => console.error('[batch] record pump:', err));
  });
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
