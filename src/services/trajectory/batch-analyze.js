/**
 * Batch analyze pipeline: claim pending/analyzing items → LLM phase analysis →
 * create draft trajectory (mode=draft → drafted, mode=record → queued).
 * Extracted from trajectory-batch-service.js — move-only, no logic changes.
 */
import { randomUUID } from 'crypto';
import {
  BATCH_ANALYZE_CONCURRENCY,
  BATCH_ITEM_LEASE_MS,
  BATCH_ANALYZE_MAX_ATTEMPTS,
} from '#config/config.js';
import { getDB } from '#config/database.js';
import * as batchDao from '../../dao/batch-recording-dao.js';
import { analyzeRequirementToPhases, createTransactionWithPhases } from './trajectory-meta-service.js';
import {
  cancelledAnalyzeTokens,
  emitProgress,
  maybeFinalizeJob,
  kickScheduler,
} from './trajectory-batch-service.js';

let analyzeWorkers = 0;
let draftWorkers = 0;

export async function pumpAnalyze() {
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
      businessEntries: Array.isArray(result.businessEntries) ? result.businessEntries : [],
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
 * Create trajectory+phases+case from analyzed item; draft → drafted, record → queued.
 * @param {object} item analyzed batch item with batchId, name, requirement, mode
 * @returns {Promise<void>} resolves when draft/trajectory is created and item status updated
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
        businessEntries: analysis.businessEntries || [],
        model: job.model || '',
        systemAccountId: Number(job.systemAccountId),
        batchJobId: job.id,
        // 任务归属用户透传给其生成的交易（否则交易 paas_user_id=NULL 变无主全可见）
        paasUserId: job.paasUserId || null,
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

/**
 * Claim analyzed items lacking trajectoryId (draft + record) and bind trajectory.
 * No executor slots; survives restart via kickScheduler / recovery lease clear.
 */
export async function pumpDraft() {
  while (draftWorkers < BATCH_ANALYZE_CONCURRENCY) {
    const token = randomUUID();
    const item = await batchDao.claimNextItem({
      statuses: ['analyzed'],
      workerToken: token,
      leaseMs: BATCH_ITEM_LEASE_MS,
      jobStatuses: ['accepted', 'running', 'waiting_executor'],
    });
    if (!item) break;

    if (item.trajectoryId) {
      await batchDao.transitionItem(item.id, ['analyzed'], 'analyzed', {
        version: item.version,
        clearLease: true,
      });
      continue;
    }

    draftWorkers += 1;
    createDraftFromAnalyzed(item).finally(() => {
      draftWorkers -= 1;
      kickScheduler();
    });
  }
}
