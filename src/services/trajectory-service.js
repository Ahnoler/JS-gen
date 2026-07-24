import { randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import * as trajectoryDao from '../dao/trajectory-dao.js';
import * as trajectoryPhaseDao from '../dao/trajectory-phase-dao.js';
import * as trajectoryStepDao from '../dao/trajectory-step-dao.js';
import * as functionDefDao from '../dao/function-def-dao.js';
import * as systemDao from '../dao/system-dao.js';
import * as systemAccountDao from '../dao/system-account-dao.js';
import { NODE_TYPE, isRootParentId } from '../models/hierarchy-constants.js';
import { getDB } from '../../config/database.js';
import { stepFromActionLog } from '../models/helpers.js';
import { callLLM } from '../llm-utils.js';

/** Build agent login instruction (aligned with Dashboard session-mode login).
 * Prefer system.url；兼容旧数据回退 account.loginUrl。
 */
export function buildLoginInstruction(account = {}, system = {}) {
  const url = String(system.url || account.loginUrl || '').trim();
  const user = String(account.username || '').trim();
  const pass = String(account.password || '').trim();
  if (!url) {
    const err = new Error('System url is empty — set system.url (or legacy account.loginUrl)');
    err.statusCode = 400;
    throw err;
  }
  let task = `Navigate to ${url}`;
  if (user) task += `\nEnter username: ${user}`;
  if (pass) task += `\nEnter password: ${pass}`;
  task += '\nClick the login/submit button\nWait for the page to fully load after login';
  return task;
}

/**
 * Resolve owning system + accounts for a trajectory (via function_id ancestry).
 * @returns {Promise<{ trajectoryId, functionId, system: object|null, accounts: object[] }>}
 */
export async function getTrajectoryLoginContext(trajectoryId) {
  const tid = Number(trajectoryId);
  const traj = await trajectoryDao.getById(tid);
  if (!traj) {
    const err = new Error('Trajectory not found');
    err.statusCode = 404;
    throw err;
  }
  const functionId = traj.functionId != null ? Number(traj.functionId) : null;
  if (!Number.isFinite(functionId)) {
    return {
      trajectoryId: tid,
      functionId: null,
      systemAccountId: traj.systemAccountId != null ? Number(traj.systemAccountId) : null,
      system: null,
      accounts: [],
      error: 'Trajectory has no functionId — bind to a function node under a system first',
    };
  }

  let cur = await systemDao.getById(functionId);
  const guard = new Set();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    if (Number(cur.type) === NODE_TYPE.SYSTEM) break;
    if (isRootParentId(cur.parentId)) {
      cur = null;
      break;
    }
    cur = await systemDao.getById(cur.parentId);
  }

  if (!cur || Number(cur.type) !== NODE_TYPE.SYSTEM) {
    return {
      trajectoryId: tid,
      functionId,
      systemAccountId: traj.systemAccountId != null ? Number(traj.systemAccountId) : null,
      system: null,
      accounts: [],
      error: 'Could not resolve system for function',
    };
  }

  const accounts = (await systemAccountDao.listBySystem(cur.id)).map((a) => ({
    id: a.id,
    name: a.name,
    // Prefer system.url；账号上旧 loginUrl 仅作兼容回退
    loginUrl: a.loginUrl || cur.url || '',
    username: a.username || '',
    // password returned for self-use recording console (same as hierarchy tree)
    password: a.password || '',
    remark: a.remark || null,
    sortOrder: a.sortOrder ?? 0,
  }));

  return {
    trajectoryId: tid,
    functionId,
    systemAccountId: traj.systemAccountId != null ? Number(traj.systemAccountId) : null,
    system: {
      id: cur.id,
      name: cur.name,
      uid: cur.uid || cur.systemId,
      description: cur.description || null,
      url: cur.url || '',
    },
    accounts,
  };
}

/**
 * Resolve + validate system account for a trajectory.
 * Prefers explicit accountId, else trajectory.systemAccountId.
 */
export async function resolveTrajectoryAccount(trajectoryId, accountId = null) {
  const tid = Number(trajectoryId);
  const traj = await trajectoryDao.getById(tid);
  if (!traj) {
    const err = new Error('Trajectory not found');
    err.statusCode = 404;
    throw err;
  }
  const acctId = accountId != null && accountId !== ''
    ? Number(accountId)
    : (traj.systemAccountId != null ? Number(traj.systemAccountId) : null);
  if (!Number.isFinite(acctId) || acctId <= 0) {
    const err = new Error('systemAccountId is required — bind a system account on the trajectory first');
    err.statusCode = 400;
    throw err;
  }
  const account = await systemAccountDao.getById(acctId);
  if (!account) {
    const err = new Error(`System account #${acctId} not found`);
    err.statusCode = 404;
    throw err;
  }
  const loginCtx = await getTrajectoryLoginContext(tid);
  if (loginCtx.system?.id != null && Number(account.systemId) !== Number(loginCtx.system.id)) {
    const err = new Error('Selected account does not belong to this trajectory system');
    err.statusCode = 400;
    throw err;
  }
  return { traj, account, accountId: acctId, loginCtx };
}

/** Persist bound system account on trajectory. */
export async function setTrajectoryAccount(trajectoryId, systemAccountId) {
  const { account, accountId } = await resolveTrajectoryAccount(trajectoryId, systemAccountId);
  await trajectoryDao.updateMeta(Number(trajectoryId), { systemAccountId: accountId });
  const traj = await trajectoryDao.getById(Number(trajectoryId));
  return { trajectory: traj, account: { id: account.id, name: account.name, loginUrl: account.loginUrl || '' } };
}


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
    .andWhere((qb) => {
      qb.where({ is_replay: false }).orWhereNull('is_replay');
    })
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
 * Resolve which trajectory_phase.id a live step should attach to.
 * Priority: explicit phaseId → phaseNumber match → last phase of trajectory.
 */
export async function resolvePhaseIdForPersist(trajectoryId, {
  phaseId = null,
  phaseNumber = null,
  fallbackLast = true,
} = {}) {
  const tid = Number(trajectoryId);
  if (!Number.isFinite(tid) || tid <= 0) return null;

  if (phaseId != null && Number.isFinite(Number(phaseId)) && Number(phaseId) > 0) {
    const p = await trajectoryPhaseDao.getById(+phaseId);
    if (p && Number(p.trajectoryId) === tid) return p.id;
  }

  const pn = Number(phaseNumber);
  if (Number.isFinite(pn) && pn > 0) {
    const row = await getDB()('trajectory_phase')
      .where({ trajectory_id: tid, phase_number: pn })
      .first();
    if (row?.id) return row.id;
  }

  if (fallbackLast) {
    const last = await getDB()('trajectory_phase')
      .where({ trajectory_id: tid })
      .orderBy('phase_number', 'desc')
      .first();
    return last?.id ?? null;
  }
  return null;
}

/**
 * Append a single recorded action (CDP/manual/agent) to an existing trajectory immediately.
 * Always prefers an explicit trajectory_phase.id; falls back to last phase.
 * @returns {{ stepNumber: number, actionId: string|null, trajectoryPhaseId: number|null }|null}
 */
export async function appendRecordedStep(trajectoryDbId, entry, { source, trajectoryPhaseId } = {}) {
  const tid = Number(trajectoryDbId);
  if (!Number.isFinite(tid) || tid <= 0 || !entry) return null;

  const resolvedSource = source || entry.source || 'agent';
  const phaseNumberHint = Number(entry.phase ?? entry.phaseNumber ?? 0) || 0;
  const maxStep = await trajectoryDao.getMaxStepNumber(tid);
  const stepNumber = maxStep + 1;

  const resolvedPhaseId = await resolvePhaseIdForPersist(tid, {
    phaseId: trajectoryPhaseId ?? entry.trajectoryPhaseId ?? null,
    phaseNumber: phaseNumberHint || null,
    fallbackLast: true,
  });

  let phaseNumber = phaseNumberHint;
  if (resolvedPhaseId) {
    const phase = await trajectoryPhaseDao.getById(resolvedPhaseId);
    if (phase?.phaseNumber != null) phaseNumber = Number(phase.phaseNumber);
  }

  const step = stepFromActionLog(entry, {
    trajectoryId: tid,
    stepNumber,
    phaseNumber,
    source: resolvedSource,
  });
  step.trajectoryId = tid;
  step.stepNumber = stepNumber;
  step.trajectoryPhaseId = resolvedPhaseId;

  await trajectoryStepDao.batchSave([step]);

  const counts = await refreshTrajectoryCounts(tid);
  await trajectoryDao.updateMeta(tid, {
    stepCount: counts.stepCount,
    phaseCount: counts.phaseCount,
  });

  const { touchTrajectoryRuntimeActivity } = await import('./trajectory-recording-service.js');
  touchTrajectoryRuntimeActivity(tid);

  return { stepNumber, actionId: entry.id || null, trajectoryPhaseId: resolvedPhaseId };
}

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
 * Create empty trajectory shell under a function (for long-lived recording).
 */
export async function createEmptyTrajectory({
  functionId, task = '', model = '', name = '', systemAccountId = null,
} = {}) {
  let resolvedFunctionId = typeof functionId === 'number'
    ? functionId
    : await functionDefDao.getDefaultFunctionId();
  return trajectoryDao.save({
    name: String(name || '').trim(),
    trajectoryLog: null,
    task: task || '',
    model: model || '',
    stepCount: 0,
    phaseCount: 0,
    isDone: null,
    isSuccessful: null,
    url: '',
    functionId: resolvedFunctionId,
    systemAccountId: systemAccountId != null ? Number(systemAccountId) : null,
    recordStatus: 'draft',
    steps: [],
  });
}

/**
 * Create a "transaction" (trajectory) shell with pre-defined phases.
 * `phases[]` can be string[] or {description: string}[].
 */
export async function createTransactionWithPhases({
  functionId,
  name = '',
  requirement = '',
  phases = [],
  model = '',
  systemAccountId = null,
} = {}) {
  const resolvedFunctionId = typeof functionId === 'number'
    ? functionId
    : await functionDefDao.getDefaultFunctionId();

  const parsed = Array.isArray(phases)
    ? phases
      .map((p) => (typeof p === 'string' ? { description: p } : p))
      .map((p) => (p && p.description != null ? String(p.description) : ''))
      .map((d) => d.trim())
      .filter(Boolean)
    : [];

  const trajId = await trajectoryDao.save({
    name: String(name || '').trim(),
    trajectoryLog: null,
    task: String(requirement || '').trim(),
    model: model || '',
    stepCount: 0,
    phaseCount: parsed.length,
    isDone: null,
    isSuccessful: null,
    url: '',
    functionId: resolvedFunctionId,
    systemAccountId: systemAccountId != null ? Number(systemAccountId) : null,
    recordStatus: 'draft',
    steps: [],
  });

  for (let i = 0; i < parsed.length; i++) {
    await trajectoryPhaseDao.create({
      phaseId: randomUUID(),
      phaseNumber: i + 1,
      trajectoryId: trajId,
      status: 'pending',
      description: parsed[i],
    });
  }

  return trajectoryDao.getById(trajId);
}

export async function getTrajectoryTree(trajectoryDbId) {
  const tid = Number(trajectoryDbId);
  if (!Number.isFinite(tid) || tid <= 0) return null;

  const traj = await trajectoryDao.getById(tid);
  if (!traj) return null;

  const phases = await trajectoryPhaseDao.listByTrajectory(tid);
  const allSteps = await trajectoryStepDao.listByTrajectory(tid);

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
    return { ...p, steps };
  });

  const orphanSteps = allSteps.filter((s) => !assigned.has(s.id));
  return {
    trajectoryId: traj.id,
    ...traj,
    phases: phasesWithSteps,
    orphanSteps,
  };
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
 * Analyze a requirement description into an ordered phase list.
 * Returns: string[] (phase descriptions). Does not persist.
 */
export async function analyzeRequirementToPhases({
  description,
  stepLength,
  model,
} = {}) {
  const desc = String(description || '').trim();
  if (!desc) throw new Error('description is required');

  const targetCount = Number(stepLength);
  const n = Number.isFinite(targetCount) && targetCount > 0
    ? Math.max(2, Math.min(20, Math.floor(targetCount)))
    : 6;

  const prompt = [
    '你是资深业务流程拆解助手。',
    '请把下面“需求描述”拆分成按执行顺序的阶段步骤列表。',
    `阶段数量目标: ${n}（可在 ${Math.max(2, n - 1)} ~ ${Math.max(2, n + 1)} 范围内浮动，但尽量接近；若需求已按条编号，优先按原文条数拆分）。`,
    '每个阶段必须是简短、可执行的中文操作描述，避免“分析/思考/总结”等元话术。',
    '',
    '【预期结果规则 — 必须遵守】',
    '1. 每个阶段字符串都必须包含「预期结果：…」。',
    '2. 若原文某步已写「预期结果」，必须原样保留其含义与关键表述，不得删改或弱化。',
    '3. 若原文某步没有「预期结果」，由你根据该步操作补写合理、可验证的预期结果（页面跳转、提示文案、抵达菜单等）。',
    '4. 建议格式：「{操作描述}。预期结果：{验收标准}」。',
    '',
    '【示例】',
    '输入：',
    '1.点击客户管理，点击对公客户管理。',
    '2.新增一个信贷潜在客户，点击保存。预期结果：点击保存后，跳转到信贷潜在客户基本信息填写页面。',
    '3.点击法定代表人/负责人证件号码的引入按钮，客户名称 填写 测试，点击查询，选择一个客户，点击确认。',
    '4.填写信贷潜在客户的基本信息，点击保存。预期结果：点击保存后，提示操作成功。',
    '输出 phases 示例：',
    '["点击客户管理，点击对公客户管理。预期结果：抵达对公客户管理。",',
    '"新增一个信贷潜在客户并保存。预期结果：点击保存后，跳转到信贷潜在客户基本信息填写页面。",',
    '"点击法定代表人/负责人证件号码的引入按钮，客户名称 填写 测试，点击查询，选择一个客户，点击确认。预期结果：完成法定代表人的引入流程。",',
    '"填写信贷潜在客户的基本信息，点击保存。预期结果：点击保存后，提示操作成功。"]',
    '',
    '输出必须是严格 JSON（不要 Markdown，不要解释），格式：{"phases":[...字符串...]}.',
    '',
    '需求描述：',
    desc,
  ].join('\n');

  const modelId = model || 'deepseek-v4-flash';
  const content = await callLLM(prompt, modelId);
  const raw = String(content || '').trim();

  // 1) Try strict JSON first
  try {
    const obj = JSON.parse(raw);
    const phases = obj?.phases;
    if (Array.isArray(phases)) return phases.map((p) => String(p).trim()).filter(Boolean);
  } catch {}

  // 2) Extract JSON-ish substring if wrapped
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      const slice = raw.slice(firstBrace, lastBrace + 1);
      const obj = JSON.parse(slice);
      const phases = obj?.phases;
      if (Array.isArray(phases)) return phases.map((p) => String(p).trim()).filter(Boolean);
    } catch {}
  }

  // 3) Fallback: parse array lines / bullets
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const phases = [];
  for (const line of lines) {
    // strip leading numbering/bullets
    const cleaned = line
      .replace(/^[-*•]\s*/, '')
      .replace(/^\d+[\.\)]\s*/, '')
      .replace(/^\"|\"$/g, '')
      .trim();
    if (!cleaned) continue;
    if (/^phases?\s*[:=]\s*\[/i.test(cleaned)) continue;
    if (/^\]$/.test(cleaned)) continue;
    phases.push(cleaned.replace(/,$/, ''));
  }

  // If still empty, last attempt: regex for "phases":[...]
  if (!phases.length) {
    const m = raw.match(/\"phases\"\s*:\s*\[(.*)\]/s);
    if (m) {
      try {
        const arrJson = `[${m[1]}]`;
        const arr = JSON.parse(arrJson);
        if (Array.isArray(arr)) return arr.map((p) => String(p).trim()).filter(Boolean);
      } catch {}
    }
  }

  // Enforce at least 1 and cap
  return phases.slice(0, 20);
}


/**
 * Human confirmation of a trajectory (transaction-level).
 * confirmed=true  → recordStatus=completed
 * confirmed=false → recordStatus=draft (cancel confirmation)
 * Does NOT touch trajectory_step.confirmed (kept for future features).
 */
export async function confirmTrajectory(trajectoryId, confirmed = true) {
  const tid = Number(trajectoryId);
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
  if (traj.recordStatus === 'recording' || traj.recordStatus === 'live') {
    const err = new Error(
      traj.recordStatus === 'recording'
        ? 'Cannot confirm while AI recording'
        : 'Cannot confirm while live (prepared); detach first',
    );
    err.statusCode = 409;
    throw err;
  }

  const want = !!confirmed;
  if (want) {
    await trajectoryDao.updateMeta(tid, {
      recordStatus: 'completed',
      isDone: true,
      isSuccessful: true,
    });
  } else {
    await trajectoryDao.updateMeta(tid, {
      recordStatus: 'draft',
      isDone: null,
      isSuccessful: null,
    });
  }

  const tree = await getTrajectoryTree(tid);
  return {
    trajectoryId: tid,
    recordStatus: tree?.recordStatus || (want ? 'completed' : 'draft'),
    confirmed: want,
    tree,
  };
}

/**
 * Resolve Element UI control by label_text on the attached BiB/CDP page.
 * Returns ElementJson for writing into trajectory_step.element_json.
 */

export async function confirmTrajectoryStep(stepId, confirmed) {
  return trajectoryStepDao.update(Number(stepId), {
    confirmed: !!confirmed,
    confirmedAt: confirmed ? new Date().toISOString().slice(0, 23).replace('T', ' ') : null,
  });
}

export async function createTrajectoryStep(input = {}) {
  const trajectoryId = Number(input.trajectoryId);
  if (!Number.isFinite(trajectoryId) || trajectoryId <= 0) throw new Error('trajectoryId required');
  const max = await trajectoryDao.getMaxStepNumber(trajectoryId);
  const row = await trajectoryStepDao.create({
    trajectoryId,
    stepNumber: input.stepNumber ?? (max + 1),
    phaseNumber: input.phaseNumber ?? 0,
    actionIndex: input.actionIndex ?? 0,
    actionType: input.actionType ?? input.action ?? '',
    description: input.description ?? '',
    params: input.params ?? null,
    element: input.element ?? null,
    source: input.source ?? 'manual',
    success: input.success ?? null,
    error: input.error ?? null,
    extractedContent: input.extractedContent ?? '',
    trajectoryPhaseId: input.trajectoryPhaseId ?? null,
    confirmed: !!input.confirmed,
    confirmedAt: input.confirmed ? new Date().toISOString().slice(0, 23).replace('T', ' ') : null,
  });
  await trajectoryStepDao.reorderByTrajectory(trajectoryId);
  const counts = await refreshTrajectoryCounts(trajectoryId);
  await trajectoryDao.updateMeta(trajectoryId, { stepCount: counts.stepCount, phaseCount: counts.phaseCount });
  return row;
}

export async function updateTrajectoryStep(stepId, fields = {}) {
  const existing = await trajectoryStepDao.getById(Number(stepId));
  if (!existing) return null;
  const patch = { ...fields };
  if ('confirmed' in fields) {
    patch.confirmedAt = fields.confirmed ? new Date().toISOString().slice(0, 23).replace('T', ' ') : null;
  }
  const row = await trajectoryStepDao.update(Number(stepId), patch);
  await trajectoryStepDao.reorderByTrajectory(existing.trajectoryId);
  return row;
}

export async function removeTrajectoryStep(stepId) {
  const existing = await trajectoryStepDao.getById(Number(stepId));
  if (!existing) return { removed: false };
  await trajectoryStepDao.removeById(Number(stepId));
  await trajectoryStepDao.reorderByTrajectory(existing.trajectoryId);
  const counts = await refreshTrajectoryCounts(existing.trajectoryId);
  await trajectoryDao.updateMeta(existing.trajectoryId, { stepCount: counts.stepCount, phaseCount: counts.phaseCount });
  return { removed: true, trajectoryId: existing.trajectoryId };
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
  const row = await trajectoryPhaseDao.create({
    phaseId: randomUUID(),
    phaseNumber: nextNum,
    trajectoryId: tid,
    status: 'pending',
    description: desc,
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
  for (let i = 0; i < items.length; i++) {
    const phaseNumber = i + 1;
    const { id, description } = items[i];
    let phaseRow = id != null ? existingById.get(id) : null;

    if (phaseRow) {
      const oldPn = Number(phaseRow.phaseNumber) || 0;
      await db('trajectory_phase')
        .where({ id: phaseRow.id })
        .update({ description, phase_number: phaseNumber });
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

export async function listStepsByPhase(phaseDbId) {
  return trajectoryStepDao.listByPhase(+phaseDbId);
}

export async function listByFunction(functionId, pagination) {
  return trajectoryDao.listByFunction(functionId, pagination);
}

export {
  getTrajectoryRuntime,
  getAllTrajectoryRuntimes,
  touchTrajectoryRuntimeActivity,
  clearTrajectoryRuntimesForNode,
  prepareTrajectoryRecording,
  attachTrajectoryLive,
  detachTrajectoryLive,
  startTrajectoryRecording,
  stopTrajectoryRecording,
  replayTrajectorySteps,
  resolveTrajectoryElement,
  toggleTrajectoryManualRecord,
} from './trajectory-recording-service.js';

