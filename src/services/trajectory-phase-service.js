/**
 * Trajectory phase lifecycle: upsert/status, clear, add, sync descriptions.
 */
import { randomUUID } from 'crypto';
import * as trajectoryDao from '../dao/trajectory-dao.js';
import * as trajectoryPhaseDao from '../dao/trajectory-phase-dao.js';
import { getDB } from '../../config/database.js';
import { getTrajectoryTree, getTrajectoryWithPhases } from './trajectory-query-service.js';
import { refreshTrajectoryCounts } from './trajectory-step-service.js';

/**
 * Upsert a trajectory_phase row with the full phase task description.
 * Called when the user clicks「执行阶段」so description is stored immediately.
 * Also marks the phase as running for the live action-flow status.
 */
export async function upsertPhaseDescription(trajectoryDbId, phaseNumber, description) {
  const tid = Number(trajectoryDbId);
  const n = Number(phaseNumber);
  const desc = typeof description === 'string' ? description.trim() : '';
  if (!Number.isFinite(tid) || tid <= 0 || !Number.isFinite(n) || n <= 0 || !desc) {
    return null;
  }

  const db = getDB();
  const existing = await db('trajectory_phase')
    .where({ trajectory_id: tid, phase_number: n })
    .first();

  if (existing) {
    await db('trajectory_phase')
      .where({ id: existing.id })
      .update({
        description: desc,
        status: 'running',
        completed_at: null,
      });
    return existing.id;
  }

  const row = await trajectoryPhaseDao.create({
    phaseId: randomUUID(),
    phaseNumber: n,
    trajectoryId: tid,
    status: 'running',
    description: desc,
  });
  // Keep phase_count in sync when phase is created at execute time
  const counts = await refreshTrajectoryCounts(tid);
  await trajectoryDao.updateMeta(tid, { phaseCount: counts.phaseCount });
  return row?.id ?? null;
}

/** Mark a trajectory_phase terminal/non-terminal status (completed | failed | running | pending). */
export async function markPhaseStatus(phaseDbId, status) {
  const id = Number(phaseDbId);
  if (!Number.isFinite(id) || id <= 0) return null;
  if (!['pending', 'running', 'completed', 'failed'].includes(status)) return null;
  return trajectoryPhaseDao.updateStatus(id, status);
}

/**
 * Clear recorded steps.
 * - No phaseIds / empty: clear all steps; reset all phases to pending.
 * - With phaseIds: delete steps bound to those phases (by phase FK or phase_number);
 *   reset only those phases.
 */
export async function clearTrajectory(trajectoryDbId, { phaseIds = null } = {}) {
  const tid = Number(trajectoryDbId);
  if (!Number.isFinite(tid) || tid <= 0) return null;

  const db = getDB();
  const idSet = Array.isArray(phaseIds)
    ? [...new Set(phaseIds.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))]
    : [];

  if (idSet.length > 0) {
    const owned = await db('trajectory_phase')
      .where({ trajectory_id: tid })
      .whereIn('id', idSet)
      .select('id', 'phase_number');
    const ownedIds = owned.map((r) => Number(r.id)).filter((n) => n > 0);
    const phaseNumbers = owned
      .map((r) => Number(r.phase_number))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (!ownedIds.length) {
      const err = new Error('No matching phases for phaseIds');
      err.status = 400;
      throw err;
    }

    // Match getTrajectoryTree assignment: FK first, else unbound steps by phase_number
    await db('trajectory_step')
      .where({ trajectory_id: tid })
      .andWhere(function () {
        this.whereIn('trajectory_phase_id', ownedIds);
        if (phaseNumbers.length) {
          this.orWhere(function () {
            this.where(function () {
              this.whereNull('trajectory_phase_id').orWhere('trajectory_phase_id', 0);
            }).whereIn('phase_number', phaseNumbers);
          });
        }
      })
      .del();
    await db('trajectory_phase')
      .where({ trajectory_id: tid })
      .whereIn('id', ownedIds)
      .update({ status: 'pending', completed_at: null });
  } else {
    // Delete all steps; keep phase descriptions but reset statuses.
    await db('trajectory_step').where({ trajectory_id: tid }).del();
    await db('trajectory_phase')
      .where({ trajectory_id: tid })
      .update({ status: 'pending', completed_at: null });
  }

  const [{ phases }] = await db('trajectory_phase')
    .where({ trajectory_id: tid })
    .count('* as phases');
  const [{ steps }] = await db('trajectory_step')
    .where({ trajectory_id: tid })
    .count('* as steps');

  const phaseCount = Number(phases) || 0;
  const stepCount = Number(steps) || 0;

  const meta = {
    recordStatus: 'draft',
    stepCount,
    phaseCount,
  };
  if (stepCount === 0) {
    meta.isDone = null;
    meta.isSuccessful = null;
  }
  await trajectoryDao.updateMeta(tid, meta);

  return getTrajectoryTree(tid);
}

/**
 * Append a pending phase to an existing trajectory (for Dashboard「+ 阶段」).
 */
export async function addPhaseToTrajectory(trajectoryDbId, { description = '', phaseNumber = null } = {}) {
  const tid = Number(trajectoryDbId);
  if (!Number.isFinite(tid) || tid <= 0) {
    const err = new Error('Invalid trajectory id');
    err.statusCode = 400;
    throw err;
  }
  const traj = await trajectoryDao.getById(tid);
  if (!traj) {
    const err = new Error('Trajectory not found');
    err.statusCode = 404;
    throw err;
  }

  const existing = await trajectoryPhaseDao.listByTrajectory(tid);
  const maxNum = existing.reduce((m, p) => Math.max(m, Number(p.phaseNumber) || 0), 0);
  let nextNum = phaseNumber != null ? Number(phaseNumber) : maxNum + 1;
  if (!Number.isFinite(nextNum) || nextNum <= 0) nextNum = maxNum + 1;
  if (existing.some((p) => Number(p.phaseNumber) === nextNum)) {
    nextNum = maxNum + 1;
  }

  const desc = String(description || '').trim() || `阶段 ${nextNum}`;
  let candidates = null;
  try {
    const { resolveAncestorSystemId } = await import('./hierarchy-service.js');
    const { fetchDisplayCandidatesForDescription } = await import('./special-element-service.js');
    const systemId = traj.functionId
      ? await resolveAncestorSystemId(traj.functionId)
      : null;
    if (systemId) {
      candidates = await fetchDisplayCandidatesForDescription(systemId, desc, 3);
    }
  } catch {
    candidates = null;
  }

  const row = await trajectoryPhaseDao.create({
    phaseId: randomUUID(),
    phaseNumber: nextNum,
    trajectoryId: tid,
    status: 'pending',
    description: desc,
    specialElementCandidatesJson: candidates?.length ? JSON.stringify(candidates) : null,
  });

  const counts = await refreshTrajectoryCounts(tid);
  await trajectoryDao.updateMeta(tid, { phaseCount: counts.phaseCount });
  return row;
}

/**
 * Sync phases by identity (edit dialog).
 * Body items: { id?, description } in desired order.
 * - Keep/update phases whose id is still present (and belongs to this trajectory)
 * - Delete missing phases and their bound steps (also unbound steps with that phase_number)
 * - Create items without id
 * - Renumber phase_number 1..n on phases and their steps
 */
export async function syncTrajectoryPhaseDescriptions(trajectoryDbId, descriptions = []) {
  const tid = Number(trajectoryDbId);
  if (!Number.isFinite(tid) || tid <= 0) {
    const err = new Error('Invalid trajectory id');
    err.statusCode = 400;
    throw err;
  }
  const traj = await trajectoryDao.getById(tid);
  if (!traj) {
    const err = new Error('Trajectory not found');
    err.statusCode = 404;
    throw err;
  }

  // Normalize: string[] or { id?, description }[]
  const raw = Array.isArray(descriptions) ? descriptions : [];
  const items = raw
    .map((item) => {
      if (typeof item === 'string') {
        return { id: null, description: item.trim() };
      }
      if (item && typeof item === 'object') {
        const idNum = item.id != null ? Number(item.id) : null;
        return {
          id: Number.isFinite(idNum) && idNum > 0 ? idNum : null,
          description: String(item.description ?? item.content ?? '').trim(),
        };
      }
      return null;
    })
    .filter((x) => x && x.description);

  if (!items.length) {
    const err = new Error('phases is required');
    err.statusCode = 400;
    throw err;
  }

  const db = getDB();
  const existing = await trajectoryPhaseDao.listByTrajectory(tid);
  const existingById = new Map(existing.map((p) => [Number(p.id), p]));

  const keepIds = new Set(
    items.map((it) => it.id).filter((id) => id != null && existingById.has(id)),
  );

  // Delete phases removed from the list (+ their steps)
  for (const p of existing) {
    const pid = Number(p.id);
    if (keepIds.has(pid)) continue;
    const oldPn = Number(p.phaseNumber) || 0;
    await db('trajectory_step').where({ trajectory_phase_id: pid }).del();
    if (oldPn > 0) {
      await db('trajectory_step')
        .where({ trajectory_id: tid, phase_number: oldPn })
        .where(function () {
          this.whereNull('trajectory_phase_id').orWhere('trajectory_phase_id', 0);
        })
        .del();
    }
    await db('trajectory_phase').where({ id: pid }).del();
  }

  // Upsert in order and renumber
  let systemId = null;
  try {
    const { resolveAncestorSystemId } = await import('./hierarchy-service.js');
    systemId = traj.functionId ? await resolveAncestorSystemId(traj.functionId) : null;
  } catch {
    systemId = null;
  }
  const { fetchDisplayCandidatesForDescription } = await import('./special-element-service.js');

  for (let i = 0; i < items.length; i++) {
    const phaseNumber = i + 1;
    const { id, description } = items[i];
    let phaseRow = id != null ? existingById.get(id) : null;

    let candidates = [];
    if (systemId) {
      try {
        candidates = await fetchDisplayCandidatesForDescription(systemId, description, 3);
      } catch {
        candidates = [];
      }
    }
    const candidatesJson = candidates.length ? JSON.stringify(candidates) : null;

    if (phaseRow) {
      const oldPn = Number(phaseRow.phaseNumber) || 0;
      await db('trajectory_phase')
        .where({ id: phaseRow.id })
        .update({
          description,
          phase_number: phaseNumber,
          special_element_candidates_json: candidatesJson,
        });
      await db('trajectory_step')
        .where({ trajectory_phase_id: phaseRow.id })
        .update({ phase_number: phaseNumber });
      if (oldPn > 0 && oldPn !== phaseNumber) {
        await db('trajectory_step')
          .where({ trajectory_id: tid, phase_number: oldPn })
          .where(function () {
            this.whereNull('trajectory_phase_id').orWhere('trajectory_phase_id', 0);
          })
          .update({ phase_number: phaseNumber });
      }
      phaseRow.phaseNumber = phaseNumber;
    } else {
      phaseRow = await trajectoryPhaseDao.create({
        phaseId: randomUUID(),
        phaseNumber,
        trajectoryId: tid,
        status: 'pending',
        description,
        specialElementCandidatesJson: candidatesJson,
      });
      existingById.set(Number(phaseRow.id), phaseRow);
    }
  }

  const counts = await refreshTrajectoryCounts(tid);
  await trajectoryDao.updateMeta(tid, {
    phaseCount: counts.phaseCount,
    stepCount: counts.stepCount,
  });

  return getTrajectoryWithPhases(tid);
}
