import { randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import * as trajectoryDao from '../dao/trajectory-dao.js';
import * as trajectoryPhaseDao from '../dao/trajectory-phase-dao.js';
import * as trajectoryStepDao from '../dao/trajectory-step-dao.js';
import * as functionDefDao from '../dao/function-def-dao.js';
import { getDB } from '../../config/database.js';
import { stepFromActionLog } from '../models/helpers.js';

/**
 * Build trajectory_step rows from action_{ts}.json commands.
 */
export function buildStepsFromActionFile(actionFilePath, { source = 'agent' } = {}) {
  if (!actionFilePath || !existsSync(actionFilePath)) return [];
  try {
    const raw = JSON.parse(readFileSync(actionFilePath, 'utf-8'));
    const commands = raw?.tests?.[0]?.commands || raw?.commands || [];
    return commands.map((cmd, i) => {
      const step = stepFromActionLog(cmd, {
        stepNumber: i + 1,
        phaseNumber: cmd.phase ?? cmd.phaseNumber ?? 0,
        source: cmd.source || source,
      });
      if (cmd.id) step.id = cmd.id;
      return step;
    });
  } catch (err) {
    console.warn('[trajectory-service] Failed to parse action file:', err.message);
    return [];
  }
}

export function buildStepsFromFlow(flow, { source = 'agent' } = {}) {
  if (!Array.isArray(flow)) return [];
  return flow
    .filter((s) => s.type && s.type !== 'done')
    .map((s, i) => ({
      stepNumber: s.stepNumber || i + 1,
      phaseNumber: s.phaseNumber ?? 0,
      actionIndex: s.actionIndex ?? 0,
      actionType: s.type,
      description: s.description || '',
      params: s.params || null,
      element: s.element || null,
      success: s.success ?? null,
      error: s.error || null,
      extractedContent: s.extractedContent || '',
      source,
    }));
}

/**
 * Extract next_goal list from native AgentHistory JSON (traj_*.json).
 * @deprecated Prefer readOperationLogText — kept for transitional callers
 * @returns {{ step: number, goal: string }[]}
 */
export function extractTrajectoryLog(nativePathOrObj, limit = 200) {
  let trajectory = nativePathOrObj;
  if (typeof nativePathOrObj === 'string') {
    if (!existsSync(nativePathOrObj)) return [];
    try {
      trajectory = JSON.parse(readFileSync(nativePathOrObj, 'utf-8'));
    } catch {
      return [];
    }
  }
  const history = trajectory?.history || [];
  const goals = [];
  for (let i = 0; i < history.length && goals.length < limit; i++) {
    const goal = history[i]?.model_output?.current_state?.next_goal;
    if (goal) goals.push({ step: i + 1, goal: String(goal) });
  }
  return goals;
}

/**
 * Read operation log text (same format as log_{ts}.txt).
 * @returns {{ text: string, url: string }}
 */
export function readOperationLogText(logFilePath) {
  if (!logFilePath || !existsSync(logFilePath)) return { text: '', url: '' };
  try {
    const text = readFileSync(logFilePath, 'utf-8');
    const urlMatch = text.match(/^URL:\s*(.+)$/m);
    return { text, url: (urlMatch?.[1] || '').trim() };
  } catch (err) {
    console.warn('[trajectory-service] Failed to read log file:', err.message);
    return { text: '', url: '' };
  }
}

/**
 * Append a new log batch onto existing trajectory_log text.
 * @param {string|null} existing
 * @param {string} incoming
 */
function mergeOperationLogText(existing, incoming) {
  const prev = typeof existing === 'string' ? existing.trim() : '';
  const add = typeof incoming === 'string' ? incoming.trim() : '';
  if (!add) return prev || null;
  if (!prev) return add;
  return `${prev}\n\n----------\n\n${add}`;
}

/**
 * Parse URL from log header or fallback string.
 */
function resolveUrl(...candidates) {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() && c.trim() !== 'http://unknown') return c.trim();
  }
  return '';
}

async function refreshTrajectoryCounts(trajectoryDbId) {
  const db = getDB();
  const [{ steps }] = await db('trajectory_step')
    .where({ trajectory_id: trajectoryDbId })
    .count('* as steps');
  const [{ phases }] = await db('trajectory_phase')
    .where({ trajectory_id: trajectoryDbId })
    .count('* as phases');
  return {
    stepCount: Number(steps) || 0,
    phaseCount: Number(phases) || 0,
  };
}

/**
 * @param {Array} steps
 * @param {Record<string|number, string>} [phaseDescriptions] phaseNumber → task text
 */
function buildPhasesFromSteps(steps, phaseDescriptions = {}) {
  const phaseMap = new Map();
  for (const s of steps) {
    const n = s.phaseNumber || 0;
    if (!phaseMap.has(n)) {
      const desc = phaseDescriptions[n] ?? phaseDescriptions[String(n)] ?? '';
      phaseMap.set(n, {
        phaseId: randomUUID(),
        phaseNumber: n || 1,
        description: desc || '',
        status: 'completed',
      });
    }
  }
  return [...phaseMap.values()].sort((a, b) => a.phaseNumber - b.phaseNumber);
}

export function stepsToActionEntries(steps) {
  if (!Array.isArray(steps)) return [];
  return steps.map((s) => {
    const params = s.params ?? s.paramsJson ?? null;
    let element = s.element ?? s.elementJson ?? null;
    if (typeof element === 'string') element = safeJson(element);
    return {
      action: s.actionType || s.action || '',
      params: typeof params === 'string' ? safeJson(params) : (params || {}),
      result: s.extractedContent || s.result || '',
      phase: s.phaseNumber ?? s.phase ?? 0,
      target: element?.xpath || element?.target || '',
      cssSelector: element?.cssSelector || element?.css_selector || '',
      tagName: element?.tag || element?.tagName || '',
      attributes: element?.attributes || {},
      timestamp: s.createdAt || null,
      persisted: true,
      source: s.source || 'agent',
      stepNumber: s.stepNumber,
    };
  });
}

function safeJson(str) {
  try { return JSON.parse(str); } catch { return {}; }
}

/**
 * Persist / append trajectory. Identity is numeric DB id (not session UUID).
 *
 * @param {object} opts
 * @param {number} [opts.id] existing trajectory.id to append
 * @param {number} [opts.functionId]
 * @param {Record<string|number,string>} [opts.phaseDescriptions]
 * @param {string} [opts.logFile] path to log_{ts}.txt — stored into trajectory_log
 * @param {string} [opts.trajectoryLog] raw log text (alternative to logFile)
 */
export async function persistSessionTrajectory({
  id,
  task,
  model,
  url,
  isDone,
  isSuccessful,
  actionFile,
  flow,
  remoteSessionId,
  functionId,
  phaseDescriptions = {},
  trajectoryLog = null,
  logFile = null,
  nativeTrajectoryFile = null,
  /** ActionEntry.id values already live-persisted (CDP/manual) — skip on bulk append */
  excludeActionIds = null,
}) {
  let steps = buildStepsFromActionFile(actionFile, { source: 'agent' });
  if (!steps.length) {
    steps = buildStepsFromFlow(flow, { source: 'agent' });
  }

  // Skip only actions already live-persisted (by ActionEntry.id).
  // Do NOT drop all manual/cdp just because excludeActionIds is non-empty —
  // that caused「保存轨迹」to write 0 steps when autoPersist had recorded earlier ones.
  const beforeFilter = steps.length;
  if (excludeActionIds?.size) {
    steps = steps.filter((s) => {
      const aid = s.id || s.actionId;
      if (aid && excludeActionIds.has(String(aid))) return false;
      return true;
    });
  }
  if (beforeFilter !== steps.length) {
    console.log(
      `[trajectory-service] persist filter: ${beforeFilter} → ${steps.length} steps `
      + `(excluded ${beforeFilter - steps.length} already live-persisted)`,
    );
  }
  if (!steps.length && beforeFilter > 0) {
    console.warn(
      '[trajectory-service] all action-file steps were already live-persisted; '
      + 'updating trajectory meta only (no new steps)',
    );
  }

  const fromFile = readOperationLogText(logFile);
  let logText = typeof trajectoryLog === 'string' ? trajectoryLog : '';
  if (!logText && fromFile.text) logText = fromFile.text;

  const resolvedUrl = resolveUrl(url, fromFile.url);

  const existing = id != null ? await trajectoryDao.getById(+id) : null;

  if (existing) {
    return appendToTrajectory(existing, {
      steps,
      task,
      model,
      url: resolvedUrl,
      isDone,
      isSuccessful,
      functionId,
      phaseDescriptions,
      logText,
    });
  }

  const phases = buildPhasesFromSteps(steps, phaseDescriptions);
  for (const [k, desc] of Object.entries(phaseDescriptions || {})) {
    const n = Number(k);
    if (!Number.isFinite(n) || n <= 0 || !desc) continue;
    const existingPhase = phases.find((p) => p.phaseNumber === n);
    if (existingPhase) {
      existingPhase.description = desc;
    } else {
      phases.push({
        phaseId: randomUUID(),
        phaseNumber: n,
        description: desc,
        status: 'completed',
      });
    }
  }
  phases.sort((a, b) => a.phaseNumber - b.phaseNumber);

  return saveFullTrajectory({
    trajectory: {
      trajectoryLog: logText || null,
      task: task || '',
      model: model || '',
      stepCount: steps.length || (flow?.length || 0),
      phaseCount: phases.length,
      isDone: isDone ?? null,
      isSuccessful: isSuccessful ?? null,
      url: resolvedUrl || '',
      steps,
      remoteSessionId: remoteSessionId || null,
    },
    phases,
    functionId,
    remoteSessionId,
  });
}

async function appendToTrajectory(existing, {
  steps, task, model, url, isDone, isSuccessful, functionId, phaseDescriptions = {}, logText = '',
}) {
  const functionPatch = typeof functionId === 'number' ? { functionId } : {};
  const mergedLog = mergeOperationLogText(existing.trajectoryLog, logText);

  const batchPhaseNums = new Set(
    (steps || [])
      .map((s) => Number(s.phaseNumber))
      .filter((n) => Number.isFinite(n) && n > 0),
  );
  if (!batchPhaseNums.size) {
    for (const k of Object.keys(phaseDescriptions || {})) {
      const n = Number(k);
      if (Number.isFinite(n) && n > 0 && phaseDescriptions[k]) batchPhaseNums.add(n);
    }
  }

  if (steps.length) {
    const maxStep = await trajectoryDao.getMaxStepNumber(existing.id);
    const renumbered = steps.map((s, i) => ({
      ...s,
      stepNumber: maxStep + i + 1,
    }));

    await trajectoryDao.appendSteps(existing.id, renumbered, { stepNumberOffset: maxStep });

    const existingPhases = await trajectoryDao.getExistingPhaseNumbers(existing.id);
    const existingPhaseNums = new Set(existingPhases.map((p) => p.phase_number));
    const newPhases = buildPhasesFromSteps(renumbered, phaseDescriptions)
      .filter((p) => !existingPhaseNums.has(p.phaseNumber));

    for (const phase of newPhases) {
      const desc = resolvePhaseDescription(phaseDescriptions, phase.phaseNumber, phase.description);
      if (existingPhaseNums.has(phase.phaseNumber)) continue;
      const phaseRow = await trajectoryPhaseDao.create({
        ...phase,
        phaseId: phase.phaseId || randomUUID(),
        trajectoryId: existing.id,
        status: 'completed',
        description: desc,
      });
      const phaseId = phaseRow?.id;
      if (phaseId != null) {
        await getDB()('trajectory_step')
          .where({ trajectory_id: existing.id, phase_number: phase.phaseNumber })
          .whereNull('trajectory_phase_id')
          .update({ trajectory_phase_id: phaseId });
        existingPhaseNums.add(phase.phaseNumber);
      }
    }

    await ensurePhasesWithDescriptions(existing.id, phaseDescriptions, batchPhaseNums, existingPhaseNums);
    await syncPhaseDescriptions(existing.id, phaseDescriptions, batchPhaseNums);

    for (const ep of existingPhases) {
      await getDB()('trajectory_step')
        .where({ trajectory_id: existing.id, phase_number: ep.phase_number })
        .whereNull('trajectory_phase_id')
        .update({ trajectory_phase_id: ep.id });
    }
  } else {
    await ensurePhasesWithDescriptions(existing.id, phaseDescriptions, batchPhaseNums);
    await syncPhaseDescriptions(existing.id, phaseDescriptions, batchPhaseNums);
  }

  const counts = await refreshTrajectoryCounts(existing.id);
  const resolvedUrl = resolveUrl(url, existing.url);

  await trajectoryDao.updateMeta(existing.id, {
    stepCount: counts.stepCount,
    phaseCount: counts.phaseCount,
    isDone: isDone ?? existing.isDone,
    isSuccessful: isSuccessful ?? existing.isSuccessful,
    ...(model ? { model } : {}),
    ...(resolvedUrl ? { url: resolvedUrl } : {}),
    ...(task ? { task: existing.task ? `${existing.task}\n---\n${task}`.slice(0, 65000) : task } : {}),
    ...(mergedLog != null ? { trajectoryLog: mergedLog } : {}),
    ...functionPatch,
  });

  return existing.id;
}

function resolvePhaseDescription(phaseDescriptions, phaseNumber, fallback = '') {
  const desc = phaseDescriptions?.[phaseNumber]
    ?? phaseDescriptions?.[String(phaseNumber)]
    ?? fallback
    ?? '';
  return typeof desc === 'string' ? desc : String(desc || '');
}

/**
 * Ensure phase rows exist for the given phase numbers, using per-phase task text.
 * Does not fall back to a shared trajectory task string.
 */
async function ensurePhasesWithDescriptions(
  trajectoryDbId,
  phaseDescriptions = {},
  batchPhaseNums = null,
  existingPhaseNums = null,
) {
  const existing = existingPhaseNums
    || new Set((await trajectoryDao.getExistingPhaseNumbers(trajectoryDbId)).map((p) => p.phase_number));

  for (const [k, desc] of Object.entries(phaseDescriptions || {})) {
    if (!desc) continue;
    const n = Number(k);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (batchPhaseNums && !batchPhaseNums.has(n)) continue;
    if (existing.has(n)) continue;
    await trajectoryPhaseDao.create({
      phaseId: randomUUID(),
      phaseNumber: n,
      trajectoryId: trajectoryDbId,
      status: 'completed',
      description: String(desc),
    });
    existing.add(n);
  }
}

/**
 * Update existing phase rows with per-phase task text.
 * @param {Set<number>|null} onlyPhaseNumbers when set, only those phase_numbers are updated
 */
async function syncPhaseDescriptions(trajectoryDbId, phaseDescriptions = {}, onlyPhaseNumbers = null) {
  for (const [k, desc] of Object.entries(phaseDescriptions || {})) {
    if (!desc) continue;
    const n = Number(k);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (onlyPhaseNumbers && !onlyPhaseNumbers.has(n)) continue;
    await getDB()('trajectory_phase')
      .where({ trajectory_id: trajectoryDbId, phase_number: n })
      .update({ description: String(desc) });
  }
}

export async function saveFullTrajectory({ trajectory, phases, functionId, remoteSessionId }) {
  let resolvedFunctionId = null;
  if (typeof functionId === 'number') {
    resolvedFunctionId = functionId;
  } else {
    resolvedFunctionId = await functionDefDao.getDefaultFunctionId();
  }

  const trajId = await trajectoryDao.save({
    ...trajectory,
    functionId: resolvedFunctionId,
    remoteSessionId: remoteSessionId ?? trajectory.remoteSessionId ?? null,
  });

  if (phases?.length) {
    for (const phase of phases) {
      const phaseRow = await trajectoryPhaseDao.create({
        ...phase,
        phaseId: phase.phaseId || randomUUID(),
        trajectoryId: trajId,
        status: phase.status || 'completed',
        description: phase.description || '',
      });
      const phaseId = typeof phaseRow === 'object' ? phaseRow.id : phaseRow;
      const phaseNumber = phase.phaseNumber;
      if (phaseId != null && phaseNumber != null) {
        await getDB()('trajectory_step')
          .where({ trajectory_id: trajId, phase_number: phaseNumber })
          .update({ trajectory_phase_id: phaseId });
      }
    }
  }

  // Recompute counts from DB (phases may exceed step-derived set)
  const counts = await refreshTrajectoryCounts(trajId);
  await trajectoryDao.updateMeta(trajId, {
    stepCount: counts.stepCount,
    phaseCount: counts.phaseCount,
  });

  return trajId;
}

/**
 * Append a single recorded action (CDP/manual/agent) to an existing trajectory immediately.
 * @returns {{ stepId: number, stepNumber: number }|null}
 */
export async function appendRecordedStep(trajectoryDbId, entry, { source } = {}) {
  const tid = Number(trajectoryDbId);
  if (!Number.isFinite(tid) || tid <= 0 || !entry) return null;

  const resolvedSource = source || entry.source || 'agent';
  const maxStep = await trajectoryDao.getMaxStepNumber(tid);
  const stepNumber = maxStep + 1;
  const step = stepFromActionLog(entry, {
    trajectoryId: tid,
    stepNumber,
    phaseNumber: entry.phase ?? entry.phaseNumber ?? 0,
    source: resolvedSource,
  });
  step.trajectoryId = tid;
  step.stepNumber = stepNumber;

  await trajectoryStepDao.batchSave([step]);

  const counts = await refreshTrajectoryCounts(tid);
  await trajectoryDao.updateMeta(tid, {
    stepCount: counts.stepCount,
    phaseCount: counts.phaseCount,
  });

  return { stepNumber, actionId: entry.id || null };
}

/**
 * Upsert a trajectory_phase row with the full phase task description.
 * Called when the user clicks「执行阶段」so description is stored immediately.
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
      .update({ description: desc });
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

/**
 * Create empty trajectory shell under a function (for long-lived recording).
 */
export async function createEmptyTrajectory({ functionId, task = '', model = '' } = {}) {
  let resolvedFunctionId = typeof functionId === 'number'
    ? functionId
    : await functionDefDao.getDefaultFunctionId();
  return trajectoryDao.save({
    trajectoryLog: null,
    task: task || '',
    model: model || '',
    stepCount: 0,
    phaseCount: 0,
    isDone: null,
    isSuccessful: null,
    url: '',
    functionId: resolvedFunctionId,
    steps: [],
  });
}

/**
 * Merged action flow by trajectory numeric id: DB steps + live pending.
 * @param {number|null} trajectoryDbId
 * @param {Array} pendingEntries
 * @param {{ excludeActionIds?: Iterable<string> }} [opts]
 *   ActionEntry.id already live-persisted — omit from pending to avoid
 *   「已入库」+「待保存」duplicates.
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

/** @deprecated use getTrajectoryActionFlow */
export async function getSessionActionFlow(sessionId, pendingEntries = [], trajectoryDbId = null, opts = {}) {
  const flow = await getTrajectoryActionFlow(trajectoryDbId, pendingEntries, opts);
  return { ...flow, sessionId };
}

export async function getTrajectoryWithPhases(id) {
  const traj = await trajectoryDao.getById(+id);
  if (!traj) return null;
  traj.phases = await trajectoryPhaseDao.listByTrajectory(traj.id);
  return traj;
}

export async function listPhasesByTrajectory(trajectoryDbId) {
  return trajectoryPhaseDao.listByTrajectory(+trajectoryDbId);
}

export async function listStepsByPhase(phaseDbId) {
  return trajectoryStepDao.listByPhase(+phaseDbId);
}

export async function listByFunction(functionId, pagination) {
  return trajectoryDao.listByFunction(functionId, pagination);
}
