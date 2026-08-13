/**
 * Trajectory read/query helpers: tree, lists, action-flow merge.
 */
import * as trajectoryDao from '../dao/trajectory-dao.js';
import * as trajectoryPhaseDao from '../dao/trajectory-phase-dao.js';
import * as trajectoryStepDao from '../dao/trajectory-step-dao.js';
import * as caseDataDao from '../dao/case-data-dao.js';
import { filterMetaSteps, isMetaStep } from '../models/meta-step-actions.js';

function safeJson(str) {
  try { return JSON.parse(str); } catch { return {}; }
}

function annotateStep(step) {
  if (!step || typeof step !== 'object') return step;
  return { ...step, isMeta: isMetaStep(step) };
}

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

export async function getTrajectoryTree(trajectoryDbId, { includeMeta = false } = {}) {
  const tid = Number(trajectoryDbId);
  if (!Number.isFinite(tid) || tid <= 0) return null;

  const traj = await trajectoryDao.getById(tid);
  if (!traj) return null;

  const phases = await trajectoryPhaseDao.listByTrajectory(tid);
  const allStepsRaw = await trajectoryStepDao.listByTrajectory(tid);
  const allSteps = filterMetaSteps(allStepsRaw, { includeMeta }).map(annotateStep);

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
    };
  });

  const orphanSteps = allSteps.filter((s) => !assigned.has(s.id));
  const caseEntries = await caseDataDao.listEntriesByTrajectory(tid);
  return {
    trajectoryId: traj.id,
    ...traj,
    phases: phasesWithSteps,
    orphanSteps,
    caseEntries,
  };
}

/**
 * Merged action flow by trajectory numeric id: DB steps + live pending.
 * @param {number|null} trajectoryDbId
 * @param {Array} pendingEntries
 * @param {{ excludeActionIds?: Iterable<string> }} [opts]
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

export async function getTrajectoryWithPhases(id) {
  const traj = await trajectoryDao.getById(+id);
  if (!traj) return null;
  traj.phases = await trajectoryPhaseDao.listByTrajectory(traj.id);
  traj.caseEntries = await caseDataDao.listEntriesByTrajectory(traj.id);
  return traj;
}

export async function listPhasesByTrajectory(trajectoryDbId) {
  return trajectoryPhaseDao.listByTrajectory(+trajectoryDbId);
}

export async function listStepsByPhase(phaseDbId, { includeMeta = false } = {}) {
  const steps = await trajectoryStepDao.listByPhase(+phaseDbId);
  return filterMetaSteps(steps, { includeMeta }).map(annotateStep);
}

export async function listByFunction(functionId, pagination) {
  return trajectoryDao.listByFunction(functionId, pagination);
}
