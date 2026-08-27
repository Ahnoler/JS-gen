/**
 * Trajectory read/query helpers: tree, lists, action-flow merge.
 */
import * as trajectoryDao from '../../dao/trajectory-dao.js';
import * as trajectoryPhaseDao from '../../dao/trajectory-phase-dao.js';
import * as trajectoryStepDao from '../../dao/trajectory-step-dao.js';
import * as businessDataDao from '../../dao/business-data-dao.js';
import * as screenshotDao from '../../dao/screenshot-dao.js';
import { filterMetaSteps, isMetaStep } from '../../models/meta-step-actions.js';

function safeJson(str) {
  try { return JSON.parse(str); } catch { return {}; }
}

function annotateStep(step) {
  if (!step || typeof step !== 'object') return step;
  // groupShotId: 动作前所属状态组截图（kind=phase_group）；无则 null。
  return { ...step, isMeta: isMetaStep(step), groupShotId: step.groupShotId ?? null };
}

/**
 * Convert persisted DB step rows into action-entry objects for the action flow.
 * @param {Array<object>} steps persisted step rows (with paramsJson / elementJson)
 * @returns {Array<object>} action entries with parsed params, element, target, isMeta
 */
export function stepsToActionEntries(steps) {
  if (!Array.isArray(steps)) return [];
  return steps.map((s) => {
    const params = s.params ?? s.paramsJson ?? null;
    let element = s.element ?? s.elementJson ?? null;
    if (typeof element === 'string') element = safeJson(element);
    const parsedParams = typeof params === 'string' ? safeJson(params) : (params || {});
    const text = element?.text || parsedParams?.text || '';
    const xpathSmart = element?.xpath_smart
      || (Array.isArray(element?.candidates)
        ? element.candidates.find((c) => c?.type === 'xpath_smart')?.value
        : '')
      || '';
    const primaryXpath = xpathSmart || element?.xpath || element?.target || '';
    return {
      action: s.actionType || s.action || '',
      params: text && !parsedParams.text ? { ...parsedParams, text } : parsedParams,
      result: s.extractedContent || s.result || '',
      phase: s.phaseNumber ?? s.phase ?? 0,
      target: primaryXpath,
      cssSelector: element?.cssSelector || element?.css_selector || '',
      tagName: element?.tag || element?.tagName || '',
      attributes: element?.attributes || {},
      element: element
        ? {
            ...element,
            xpath: primaryXpath,
            xpath_smart: xpathSmart || element.xpath_smart || '',
            text: text || element.text || '',
          }
        : undefined,
      timestamp: s.createdAt || null,
      persisted: true,
      source: s.source || 'agent',
      stepNumber: s.stepNumber,
      isMeta: isMetaStep(s),
    };
  });
}

/**
 * Build the full trajectory tree: phases with assigned steps, orphan steps, business entries.
 * @param {number} trajectoryDbId trajectory DB id
 * @param {object} [root1] options
 * @param {boolean} [root1.includeMeta] whether to include meta steps (default false)
 * @returns {Promise<object|null>} trajectory tree object, or null if not found / invalid id
 */
export async function getTrajectoryTree(trajectoryDbId, { includeMeta = false } = {}) {
  const tid = Number(trajectoryDbId);
  if (!Number.isFinite(tid) || tid <= 0) return null;

  const traj = await trajectoryDao.getById(tid);
  if (!traj) return null;

  const phases = await trajectoryPhaseDao.listByTrajectory(tid);
  const allStepsRaw = await trajectoryStepDao.listByTrajectory(tid);
  const allSteps = filterMetaSteps(allStepsRaw, { includeMeta }).map(annotateStep);
  const groupShots = await screenshotDao.listPhaseGroupsByTrajectory(tid);

  const assigned = new Set();
  const phasesWithSteps = phases.map((p) => {
    const steps = allSteps.filter((s) => {
      if (s.trajectoryPhaseId != null && Number(s.trajectoryPhaseId) === Number(p.id)) {
        assigned.add(s.id);
        return true;
      }
      // Fallback: match by phase_number when phase_id not yet bound
      if (
        (s.trajectoryPhaseId == null || s.trajectoryPhaseId === 0)
        && Number(s.phaseNumber) === Number(p.phaseNumber)
      ) {
        assigned.add(s.id);
        return true;
      }
      return false;
    });
    return {
      ...p,
      steps,
      stitchScreenshotId: p.stitchScreenshotId || null,
      stitchScreenshotUrl: p.stitchScreenshotId
        ? `/api/v2/screenshots/${p.stitchScreenshotId}/image`
        : null,
      groupShots: groupShots
        .filter((s) => Number(s.trajectoryPhaseId) === Number(p.id))
        .map((s) => ({
          id: s.id,
          stateGroup: s.stateGroup,
          imageUrl: s.imageUrl || `/api/v2/screenshots/${s.id}/image`,
        })),
    };
  });

  const orphanSteps = allSteps.filter((s) => !assigned.has(s.id));
  const businessEntries = await businessDataDao.listEntriesByTrajectory(tid);
  return {
    trajectoryId: traj.id,
    ...traj,
    phases: phasesWithSteps,
    orphanSteps,
    businessEntries,
  };
}

/**
 * Merged action flow by trajectory numeric id: DB steps + live pending.
 * @param {number|null} trajectoryDbId trajectory DB id, or null for pending-only
 * @param {Array<object>} pendingEntries live pending action entries not yet persisted
 * @param {object} [opts] options
 * @param {Iterable<string>} [opts.excludeActionIds] action ids to exclude from the flow
 * @returns {Promise<{ trajectoryDbId: number|null, persistedCount: number, pendingCount: number, count: number, entries: Array<object>, trajectory: object|null }>} merged action flow
 */
export async function getTrajectoryActionFlow(trajectoryDbId, pendingEntries = [], opts = {}) {
  const traj = trajectoryDbId != null ? await trajectoryDao.getById(+trajectoryDbId) : null;
  const persisted = traj ? stepsToActionEntries(traj.steps || []) : [];
  const exclude = new Set(
    [...(opts.excludeActionIds || [])].map((id) => String(id)).filter(Boolean),
  );
  const pending = (pendingEntries || [])
    .filter((e) => !e?.id || !exclude.has(String(e.id)))
    .map((e) => ({ ...e, persisted: false }));
  const entries = [...persisted, ...pending];
  return {
    trajectoryDbId: traj?.id ?? null,
    persistedCount: persisted.length,
    pendingCount: pending.length,
    count: entries.length,
    entries,
    trajectory: traj
      ? {
          id: traj.id,
          stepCount: traj.stepCount,
          phaseCount: traj.phaseCount ?? (await trajectoryPhaseDao.listByTrajectory(traj.id)).length,
          task: traj.task,
          url: traj.url,
          model: traj.model,
          functionId: traj.functionId,
          createdAt: traj.createdAt,
        }
      : null,
  };
}

/**
 * Load a trajectory with its phases and business entries attached.
 * @param {number} id trajectory DB id
 * @returns {Promise<object|null>} trajectory with phases and businessEntries, or null if not found
 */
export async function getTrajectoryWithPhases(id) {
  const traj = await trajectoryDao.getById(+id);
  if (!traj) return null;
  traj.phases = await trajectoryPhaseDao.listByTrajectory(traj.id);
  traj.businessEntries = await businessDataDao.listEntriesByTrajectory(traj.id);
  return traj;
}

/**
 * List all phases belonging to a trajectory.
 * @param {number} trajectoryDbId trajectory DB id
 * @returns {Promise<Array<object>>} phase rows ordered by phase_number
 */
export async function listPhasesByTrajectory(trajectoryDbId) {
  return trajectoryPhaseDao.listByTrajectory(+trajectoryDbId);
}

/**
 * List steps belonging to a phase, optionally including meta steps.
 * @param {number} phaseDbId phase DB id
 * @param {object} [root1] options
 * @param {boolean} [root1.includeMeta] whether to include meta steps (default false)
 * @returns {Promise<Array<object>>} annotated step entries
 */
export async function listStepsByPhase(phaseDbId, { includeMeta = false } = {}) {
  const steps = await trajectoryStepDao.listByPhase(+phaseDbId);
  return filterMetaSteps(steps, { includeMeta }).map(annotateStep);
}

/**
 * List trajectories under a function, with pagination.
 * @param {number} functionId function DB id
 * @param {object} pagination pagination options (limit, offset, …)
 * @returns {Promise<Array<object>>} trajectory rows under the function
 */
export async function listByFunction(functionId, pagination) {
  return trajectoryDao.listByFunction(functionId, pagination);
}
