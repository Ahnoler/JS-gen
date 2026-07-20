import { randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import * as trajectoryDao from '../dao/trajectory-dao.js';
import * as trajectoryPhaseDao from '../dao/trajectory-phase-dao.js';
import * as trajectoryStepDao from '../dao/trajectory-step-dao.js';
import * as functionDefDao from '../dao/function-def-dao.js';
import * as systemDao from '../dao/system-dao.js';
import * as systemAccountDao from '../dao/system-account-dao.js';
import { NODE_TYPE } from '../models/hierarchy-constants.js';
import { getDB } from '../../config/database.js';
import { stepFromActionLog } from '../models/helpers.js';
import { callLLM } from '../llm-utils.js';
import * as execSession from '../executor-session-client.js';
import * as slotLease from '../executor-slot-lease.js';
import * as remoteSessionService from './remote-session-service.js';
import { state } from '../state.js';
import { broadcast } from '../ws-server.js';

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
    if (cur.parentId == null) {
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

/** Mark current ACTION_LOG ids as consumed so they are not later appended as steps. */
async function markConsumedActionLog(runtime) {
  if (!runtime?.sessionId || !runtime?.executorNodeUuid) return;
  try {
    const resultP = execSession.waitForSessionEvent(runtime.sessionId, 'get_action_log_result', 5000);
    execSession.forwardStdin({
      nodeUuid: runtime.executorNodeUuid,
      sessionId: runtime.sessionId,
      event: 'get_action_log',
      data: {},
    });
    const result = await resultP.catch(() => null);
    const entries = Array.isArray(result?.entries) ? result.entries : [];
    for (const entry of entries) {
      const id = entry?.id != null ? String(entry.id) : '';
      if (id) runtime.persistedActionIds.add(id);
    }
  } catch (err) {
    console.warn('[trajectory] markConsumedActionLog failed:', err.message);
  }
}

/**
 * Default login/navigate — NOT written to trajectory_step (is_replay / suppress persist).
 */
async function runDefaultLogin(runtime, account, system = null) {
  const session = state.sessions.get(runtime.sessionId);
  if (session) session.busy = true;
  runtime.suppressStepPersist = true;
  runtime.isReplay = true;
  try {
    let sys = system;
    if (!sys?.url && account?.systemId) {
      sys = await systemDao.getById(Number(account.systemId));
    }
    const instruction = buildLoginInstruction(account, sys || {});
    const doneP = execSession.waitForSessionEvent(runtime.sessionId, 'phase_done', 300000);
    const errP = execSession.waitForSessionEvent(runtime.sessionId, 'phase_error', 300000)
      .then((p) => Promise.reject(new Error(p?.message || 'login phase_error')));
    execSession.forwardStdin({
      nodeUuid: runtime.executorNodeUuid,
      sessionId: runtime.sessionId,
      event: 'step',
      data: {
        instruction,
        max_steps: 30,
        phase_number: 0,
      },
    });
    await Promise.race([doneP, errP]);
    await markConsumedActionLog(runtime);
    runtime.loginDone = true;
    runtime.loginAccountId = Number(account.id);
  } finally {
    runtime.suppressStepPersist = false;
    runtime.isReplay = false;
    if (session) {
      session.busy = false;
      session.activePhaseId = null;
    }
  }
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

export async function clearTrajectory(trajectoryDbId) {
  const tid = Number(trajectoryDbId);
  if (!Number.isFinite(tid) || tid <= 0) return null;

  const db = getDB();

  // Delete steps; keep phase descriptions but reset statuses.
  await db('trajectory_step').where({ trajectory_id: tid }).del();
  await db('trajectory_phase')
    .where({ trajectory_id: tid })
    .update({ status: 'pending', completed_at: null });

  const [{ phases }] = await db('trajectory_phase')
    .where({ trajectory_id: tid })
    .count('* as phases');

  const phaseCount = Number(phases) || 0;

  await trajectoryDao.updateMeta(tid, {
    recordStatus: 'draft',
    stepCount: 0,
    phaseCount,
    isDone: null,
    isSuccessful: null,
  });

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
    `阶段数量目标: ${n}（可在 ${Math.max(2, n - 1)} ~ ${Math.max(2, n + 1)} 范围内浮动，但尽量接近）。`,
    '每个阶段必须是简短、可执行的中文描述，避免“分析/思考/总结”等元话术。',
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

const trajectoryRuntimeMap = new Map();

export function getTrajectoryRuntime(trajectoryId) {
  return trajectoryRuntimeMap.get(Number(trajectoryId)) || null;
}

/** Clear in-memory trajectory↔executor bindings for a node (offline / crash). */
export function clearTrajectoryRuntimesForNode(nodeUuid) {
  if (!nodeUuid) return 0;
  let n = 0;
  for (const [tid, runtime] of [...trajectoryRuntimeMap.entries()]) {
    if (runtime?.executorNodeUuid !== nodeUuid) continue;
    if (runtime.sessionId) {
      const session = state.sessions.get(runtime.sessionId);
      if (session?._trajPersistUnsub) {
        try { session._trajPersistUnsub(); } catch {}
      }
      state.sessions.delete(runtime.sessionId);
    }
    trajectoryRuntimeMap.delete(tid);
    n += 1;
  }
  return n;
}

/** Drop stale trajectory runtime when the control-plane session is gone. */
function clearStaleTrajectoryRuntime(tid) {
  const existing = trajectoryRuntimeMap.get(tid);
  if (!existing) return null;
  if (existing.sessionId && state.sessions.has(existing.sessionId)) return existing;
  slotLease.releaseByTrajectory(tid);
  trajectoryRuntimeMap.delete(tid);
  return null;
}

/**
 * One-shot prepare for recording studio:
 *  1) session create (executor slot)
 *  2) browser allocate (+ CDP)
 *  3) BiB attach + screencast (stream)
 *  4) navigate/login (not persisted as steps)
 *
 * Requires trajectory.systemAccountId. Idempotent when session+login already live.
 */
export async function prepareTrajectoryRecording(trajectoryId) {
  const tid = Number(trajectoryId);
  const { traj, account, accountId } = await resolveTrajectoryAccount(tid);

  const stages = {
    session: { status: 'pending' },
    browser: { status: 'pending' },
    stream: { status: 'pending' },
    login: { status: 'pending' },
  };

  const emitStage = (stage, status, extra = {}) => {
    stages[stage] = { status, ...extra, at: new Date().toISOString() };
    try {
      broadcast('recording:prepare', { trajectoryId: tid, stage, status, ...extra });
    } catch {}
  };

  // ── 1+2: session + browser (+ best-effort BiB inside attachTrajectoryLive) ──
  emitStage('session', 'running');
  emitStage('browser', 'running');

  let attachResult = null;
  let runtime = clearStaleTrajectoryRuntime(tid);
  if (!runtime) {
    attachResult = await attachTrajectoryLive(tid);
    runtime = trajectoryRuntimeMap.get(tid);
  } else {
    attachResult = {
      sessionId: runtime.sessionId,
      executorNodeUuid: runtime.executorNodeUuid,
      remoteSessionId: runtime.remoteSessionId,
      bibError: runtime.bibError || null,
      reused: true,
      status: await remoteSessionService.getLiveStatus().catch(() => null),
    };
  }

  if (!runtime?.sessionId) {
    emitStage('session', 'error', { error: 'no session' });
    const err = new Error('Failed to open executor session for prepare');
    err.statusCode = 503;
    throw err;
  }

  emitStage('session', 'done', {
    sessionId: runtime.sessionId,
    executorNodeUuid: runtime.executorNodeUuid,
    reused: !!attachResult?.reused,
  });
  emitStage('browser', 'done', {
    cdpPort: state.sessions.get(runtime.sessionId)?.cdpPort ?? null,
    cdpReady: state.sessions.get(runtime.sessionId)?.cdpReady !== false,
  });

  // ── 3: ensure stream (BiB screencast) before login so canvas can show login ──
  emitStage('stream', 'running');
  let bibError = runtime.bibError || attachResult?.bibError || null;
  let remoteSessionId = runtime.remoteSessionId || attachResult?.remoteSessionId || null;

  if (!remoteSessionId && !bibError) {
    try {
      const attached = await remoteSessionService.attachLive({
        sessionId: runtime.sessionId,
        quality: 70,
      });
      remoteSessionId = attached?.remoteSession?.id ?? attached?.status?.remoteSessionId ?? null;
      runtime.remoteSessionId = remoteSessionId;
      if (remoteSessionId) await trajectoryDao.updateMeta(tid, { remoteSessionId });
      runtime.bibError = null;
      bibError = null;
    } catch (err) {
      bibError = err?.message || String(err);
      runtime.bibError = bibError;
    }
  }

  if (remoteSessionId && runtime.executorNodeUuid) {
    try {
      execSession.sendToExecutor(runtime.executorNodeUuid, 'session.bib_start', {
        sessionId: runtime.sessionId,
      });
    } catch (err) {
      console.warn('[prepare] bib_start failed:', err.message);
    }
  }

  if (bibError || !remoteSessionId) {
    emitStage('stream', 'degraded', {
      remoteSessionId,
      sessionId: runtime.sessionId,
      error: bibError || 'BiB not attached',
    });
  } else {
    emitStage('stream', 'done', { remoteSessionId, sessionId: runtime.sessionId });
  }

  // ── 4: login / navigate (default ops — not written to trajectory_step) ──
  emitStage('login', 'running', { accountId });
  let login = { skipped: false, done: false, accountId };
  try {
    if (runtime.loginDone && Number(runtime.loginAccountId) === Number(accountId)) {
      login = { skipped: true, done: true, accountId };
      emitStage('login', 'skipped', { accountId });
    } else {
      await runDefaultLogin(runtime, account);
      login = { skipped: false, done: true, accountId };
      emitStage('login', 'done', { accountId });
    }
  } catch (err) {
    emitStage('login', 'error', { accountId, error: err.message });
    throw err;
  }

  const fresh = await trajectoryDao.getById(tid);
  const tree = await getTrajectoryTree(tid);
  const liveStatus = await remoteSessionService.getLiveStatus().catch(() => null);

  const streamOk = !!remoteSessionId && !bibError;
  return {
    trajectoryId: tid,
    trajectory: fresh || traj,
    phases: tree?.phases || [],
    orphanSteps: tree?.orphanSteps || [],
    sessionId: runtime.sessionId,
    executorNodeUuid: runtime.executorNodeUuid,
    remoteSessionId,
    status: liveStatus || attachResult?.status || null,
    attached: !!remoteSessionId,
    login,
    systemAccountId: accountId,
    bibError,
    stream: { ok: streamOk, remoteSessionId },
    stages,
    /** Critical path ready: session + browser + login (stream may be degraded). */
    ready: true,
  };
}

export async function attachTrajectoryLive(trajectoryId) {
  const tid = Number(trajectoryId);
  const traj = await trajectoryDao.getById(tid);
  if (!traj) {
    const err = new Error('Trajectory not found');
    err.statusCode = 404;
    throw err;
  }

  // Idempotent: already attached for this trajectory with a live session
  const existing = clearStaleTrajectoryRuntime(tid);
  if (existing?.sessionId && state.sessions.has(existing.sessionId)) {
    const liveStatus = await remoteSessionService.getLiveStatus().catch(() => null);
    return {
      trajectoryId: tid,
      sessionId: existing.sessionId,
      executorNodeUuid: existing.executorNodeUuid,
      remoteSessionId: existing.remoteSessionId,
      status: liveStatus,
      reused: true,
    };
  }

  // One trajectory → one slot: drop any orphan lease before opening another
  slotLease.releaseByTrajectory(tid);

  const sessionId = randomUUID();
  const model = traj.model || 'deepseek-v4-flash';
  const opened = await execSession.openSession({ sessionId, model, trajectoryId: tid });

  const persistedActionIds = new Set();
  state.sessions.set(sessionId, {
    sessionId,
    stepIndex: 0,
    trajectories: [],
    createdAt: new Date().toISOString(),
    model,
    lastTask: null,
    lastMaxSteps: null,
    caseDataFile: null,
    useExecutor: true,
    executorNodeUuid: opened.nodeUuid,
    executorSlotIndex: opened.slotIndex,
    busy: false,
    dbTrajectoryId: tid,
    selectedPhaseId: null,
    activePhaseId: null,
    autoPersist: true,
    persistedActionIds,
    cdpPort: opened.cdpPort ?? null,
    cdpReady: opened.cdpReady !== false,
  });

  // BiB is display-only and requires CDP HTTP. Skip when session reports cdp_ready=false.
  // Never close the executor session if BiB fails — login/recording still need the browser.
  let attached = null;
  let bibError = null;
  const cdpReady = opened.cdpReady !== false;
  if (!cdpReady) {
    bibError = `CDP not ready on port ${opened.cdpPort ?? '?'} — skipped BiB attach`;
    console.warn(`[trajectory] ${bibError}`);
  } else {
    try {
      attached = await remoteSessionService.attachLive({ sessionId, quality: 70 });
    } catch (err) {
      bibError = err?.message || String(err);
      console.warn(`[trajectory] BiB attach failed (session kept): ${bibError}`);
    }
  }
  const remoteSessionId = attached?.remoteSession?.id ?? attached?.status?.remoteSessionId ?? null;
  if (remoteSessionId) await trajectoryDao.updateMeta(tid, { remoteSessionId });

  const runtime = {
    trajectoryId: tid,
    sessionId,
    executorNodeUuid: opened.nodeUuid,
    executorSlotIndex: opened.slotIndex,
    remoteSessionId,
    attachedAt: new Date().toISOString(),
    persistedActionIds,
    selectedPhaseId: null,
    abortRecording: false,
    bibError,
  };
  trajectoryRuntimeMap.set(tid, runtime);
  bindTrajectoryManualPersist(tid, sessionId, runtime);
  return {
    trajectoryId: tid,
    sessionId,
    executorNodeUuid: opened.nodeUuid,
    remoteSessionId,
    status: attached?.status || { attached: false, cdpReady: false, bibError },
    bibError,
  };
}

/** Persist manual CDP actions for trajectory-attached sessions (phase via selectedPhaseId). */
function bindTrajectoryManualPersist(trajectoryId, sessionId, runtime) {
  const session = state.sessions.get(sessionId);
  if (!session || session._trajPersistUnsub) return;
  session._trajPersistUnsub = execSession.subscribeSessionEvents(sessionId, async (type, payload) => {
    if (type !== 'manual_action_recorded') return;
    if (runtime.suppressStepPersist || runtime.isReplay) return;
    const entry = payload?.entry;
    if (!entry) return;
    const aid = entry.id != null ? String(entry.id) : '';
    if (aid && runtime.persistedActionIds.has(aid)) return;
    const phaseId = session.selectedPhaseId ?? runtime.selectedPhaseId ?? null;
    try {
      const persisted = await appendRecordedStep(trajectoryId, entry, {
        source: 'manual',
        trajectoryPhaseId: phaseId != null ? Number(phaseId) : undefined,
      });
      if (persisted && aid) runtime.persistedActionIds.add(aid);
    } catch (err) {
      console.warn('[trajectory-manual] live persist failed:', err.message);
    }
  });
}

/**
 * Re-execute selected DB steps in the live executor session.
 * isReplay=true (default): actions are NOT appended to trajectory_step lists.
 */
export async function replayTrajectorySteps(trajectoryId, { stepIds = [], isReplay = true } = {}) {
  const tid = Number(trajectoryId);
  const runtime = trajectoryRuntimeMap.get(tid);
  if (!runtime?.sessionId) {
    const err = new Error('Trajectory is not attached — call record/prepare first');
    err.statusCode = 400;
    throw err;
  }
  const ids = (Array.isArray(stepIds) ? stepIds : [])
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!ids.length) {
    const err = new Error('stepIds is required');
    err.statusCode = 400;
    throw err;
  }

  const db = getDB();
  const rows = await db('trajectory_step')
    .where({ trajectory_id: tid })
    .whereIn('id', ids)
    .orderBy(['step_number', 'action_index']);
  if (!rows.length) {
    const err = new Error('No matching steps for stepIds');
    err.statusCode = 404;
    throw err;
  }

  const { trajectoryStepToActionEntry } = await import('../models/element.js');
  const actions = rows.map((r) => {
    const step = fromDbRowCompat(r);
    const entry = trajectoryStepToActionEntry(step);
    return {
      action: entry.action,
      params: entry.params || {},
      target: entry.target || '',
      cssSelector: entry.cssSelector || '',
      tagName: entry.tagName || '',
      attributes: entry.attributes || {},
      description: entry.description || '',
      id: entry.id,
    };
  });

  const session = state.sessions.get(runtime.sessionId);
  if (session?.busy) {
    const err = new Error('Session is busy (AI recording in progress)');
    err.statusCode = 409;
    throw err;
  }

  const doSuppress = isReplay !== false;
  runtime.suppressStepPersist = doSuppress;
  runtime.isReplay = doSuppress;
  if (session) session.busy = true;

  try {
    const doneP = execSession.waitForSessionEvent(runtime.sessionId, 'replay_done', 300000);
    execSession.forwardStdin({
      nodeUuid: runtime.executorNodeUuid,
      sessionId: runtime.sessionId,
      event: 'replay_actions',
      data: { actions, is_replay: doSuppress },
    });
    const result = await doneP;
    await markConsumedActionLog(runtime);
    return {
      trajectoryId: tid,
      isReplay: doSuppress,
      stepIds: rows.map((r) => r.id),
      count: result?.count ?? actions.length,
      error: result?.error || null,
    };
  } finally {
    runtime.suppressStepPersist = false;
    runtime.isReplay = false;
    if (session) session.busy = false;
  }
}

function fromDbRowCompat(row) {
  if (!row) return null;
  const obj = {};
  for (const [key, val] of Object.entries(row)) {
    const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    obj[camel] = val;
  }
  return obj;
}

export async function detachTrajectoryLive(trajectoryId) {
  const tid = Number(trajectoryId);
  const runtime = trajectoryRuntimeMap.get(tid);
  const traj = await trajectoryDao.getById(tid);
  if (runtime?.remoteSessionId) {
    await remoteSessionService.detachLive({ crashed: false }).catch(() => {});
  }
  if (runtime?.sessionId) {
    const session = state.sessions.get(runtime.sessionId);
    if (session?._trajPersistUnsub) {
      try { session._trajPersistUnsub(); } catch {}
      session._trajPersistUnsub = null;
    }
    try {
      await execSession.closeSession({
        nodeUuid: runtime.executorNodeUuid,
        sessionId: runtime.sessionId,
      });
    } catch {
      slotLease.releaseBySession(runtime.sessionId);
    }
    state.sessions.delete(runtime.sessionId);
  }
  slotLease.releaseByTrajectory(tid);
  trajectoryRuntimeMap.delete(tid);
  if (traj) await trajectoryDao.updateMeta(tid, { remoteSessionId: null });
  return { trajectoryId: tid, detached: true };
}

export async function startTrajectoryRecording(trajectoryId, { phaseIds = null, accountId = null } = {}) {
  const tid = Number(trajectoryId);
  const runtime = trajectoryRuntimeMap.get(tid);
  if (!runtime) {
    const err = new Error('Trajectory is not attached');
    err.statusCode = 400;
    throw err;
  }
  const traj = await trajectoryDao.getById(tid);
  if (!traj) {
    const err = new Error('Trajectory not found');
    err.statusCode = 404;
    throw err;
  }
  const allPhases = await trajectoryPhaseDao.listByTrajectory(tid);
  if (!allPhases.length) throw new Error('Trajectory has no phases');

  let phases = allPhases;
  if (Array.isArray(phaseIds) && phaseIds.length > 0) {
    const idSet = new Set(phaseIds.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0));
    phases = allPhases.filter((p) => idSet.has(Number(p.id)));
    if (!phases.length) {
      const err = new Error('No matching phases for phaseIds');
      err.statusCode = 400;
      throw err;
    }
    phases.sort((a, b) => Number(a.phaseNumber) - Number(b.phaseNumber));
  }

  // Login is a prepare-time default op (not in step table). Ensure browser is logged in.
  const { account, accountId: acctId } = await resolveTrajectoryAccount(tid, accountId);
  if (!(runtime.loginDone && Number(runtime.loginAccountId) === Number(acctId))) {
    await runDefaultLogin(runtime, account);
  }

  runtime.abortRecording = false;
  await trajectoryDao.updateMeta(tid, { recordStatus: 'recording', systemAccountId: acctId });
  for (const p of phases) await trajectoryPhaseDao.updateStatus(p.id, 'pending');

  const session = state.sessions.get(runtime.sessionId);
  if (session) {
    session.dbTrajectoryId = tid;
    session.busy = true;
  }

  const events = [];
  const unsubscribe = execSession.subscribeSessionEvents(runtime.sessionId, async (type, payload) => {
    if (type !== 'action_log_sync') return;
    if (runtime.suppressStepPersist || runtime.isReplay) return;
    const entries = Array.isArray(payload?.entries) ? payload.entries : [];
    const phaseIdHint = session?.activePhaseId != null ? Number(session.activePhaseId) : null;
    for (const entry of entries) {
      const id = entry?.id ? String(entry.id) : '';
      if (!id || runtime.persistedActionIds.has(id)) continue;
      const persisted = await appendRecordedStep(tid, entry, {
        source: 'agent',
        trajectoryPhaseId: Number.isFinite(phaseIdHint) ? phaseIdHint : undefined,
      }).catch(() => null);
      if (persisted) runtime.persistedActionIds.add(id);
    }
  });

  try {
    for (const phase of phases) {
      if (runtime.abortRecording) {
        await trajectoryPhaseDao.updateStatus(phase.id, 'failed').catch(() => {});
        throw new Error('Recording aborted');
      }
      events.push({ type: 'phase_start', phaseNumber: phase.phaseNumber, description: phase.description });
      await trajectoryPhaseDao.updateStatus(phase.id, 'running');
      if (session) session.activePhaseId = phase.id;

      const doneP = execSession.waitForSessionEvent(runtime.sessionId, 'phase_done', 300000);
      const errP = execSession.waitForSessionEvent(runtime.sessionId, 'phase_error', 300000)
        .then((p) => Promise.reject(new Error(p?.message || 'phase_error')));
      execSession.forwardStdin({
        nodeUuid: runtime.executorNodeUuid,
        sessionId: runtime.sessionId,
        event: 'step',
        data: {
          instruction: phase.description,
          max_steps: 40,
          phase_number: phase.phaseNumber,
        },
      });
      await Promise.race([doneP, errP]);
      if (runtime.abortRecording) {
        await trajectoryPhaseDao.updateStatus(phase.id, 'failed').catch(() => {});
        throw new Error('Recording aborted');
      }
      await trajectoryPhaseDao.updateStatus(phase.id, 'completed');
      events.push({ type: 'phase_done', phaseNumber: phase.phaseNumber, description: phase.description });
    }

    await trajectoryDao.updateMeta(tid, {
      recordStatus: 'recorded',
      isDone: true,
      isSuccessful: true,
    });
  } catch (err) {
    const aborted = runtime.abortRecording || /aborted/i.test(err.message || '');
    await trajectoryDao.updateMeta(tid, {
      recordStatus: aborted ? 'draft' : 'draft',
      isDone: false,
      isSuccessful: false,
    });
    throw err;
  } finally {
    if (session) {
      session.busy = false;
      session.activePhaseId = null;
    }
    runtime.abortRecording = false;
    unsubscribe?.();
  }

  const tree = await getTrajectoryTree(tid);
  return {
    trajectoryId: tid,
    recordStatus: 'recorded',
    phaseIds: phases.map((p) => p.id),
    accountId: acctId,
    systemAccountId: acctId,
    events,
    steps: tree?.phases?.flatMap((p) => p.steps || []) || [],
  };
}

export async function stopTrajectoryRecording(trajectoryId, { success = true } = {}) {
  const tid = Number(trajectoryId);
  const runtime = trajectoryRuntimeMap.get(tid);
  const traj = await trajectoryDao.getById(tid);
  if (!traj) {
    const err = new Error('Trajectory not found');
    err.statusCode = 404;
    throw err;
  }

  if (runtime) {
    runtime.abortRecording = true;
    const session = state.sessions.get(runtime.sessionId);
    if (session?.busy) {
      try {
        execSession.forwardStdin({
          nodeUuid: runtime.executorNodeUuid,
          sessionId: runtime.sessionId,
          event: 'cancel_step',
          data: {},
        });
      } catch {}
      session.busy = false;
    }
    // Stop manual recording if on
    try {
      execSession.forwardStdin({
        nodeUuid: runtime.executorNodeUuid,
        sessionId: runtime.sessionId,
        event: 'manual_record_stop',
        data: {},
      });
    } catch {}
    if (session) session.selectedPhaseId = null;
    runtime.selectedPhaseId = null;
  }

  const recordStatus = success ? 'recorded' : 'draft';
  await trajectoryDao.updateMeta(tid, {
    recordStatus,
    isDone: !!success,
    isSuccessful: !!success,
  });

  const tree = await getTrajectoryTree(tid);
  return {
    trajectoryId: tid,
    recordStatus,
    detached: false,
    tree,
  };
}

export async function toggleTrajectoryManualRecord(trajectoryId, enabled, { phaseId = null } = {}) {
  const tid = Number(trajectoryId);
  const runtime = trajectoryRuntimeMap.get(tid);
  if (!runtime) {
    const err = new Error('Trajectory is not attached');
    err.statusCode = 400;
    throw err;
  }
  const traj = await trajectoryDao.getById(tid);
  if (!traj) {
    const err = new Error('Trajectory not found');
    err.statusCode = 404;
    throw err;
  }
  if (traj.recordStatus === 'recording' && enabled) {
    const err = new Error('AI recording in progress');
    err.statusCode = 409;
    throw err;
  }

  const session = state.sessions.get(runtime.sessionId);
  let resolvedPhaseId = null;
  if (enabled) {
    if (phaseId != null && phaseId !== '') {
      const pid = Number(phaseId);
      if (!Number.isFinite(pid) || pid <= 0) {
        const err = new Error('Invalid phaseId');
        err.statusCode = 400;
        throw err;
      }
      const phase = await trajectoryPhaseDao.getById(pid);
      if (!phase || Number(phase.trajectoryId) !== tid) {
        const err = new Error('phaseId does not belong to this trajectory');
        err.statusCode = 400;
        throw err;
      }
      resolvedPhaseId = phase.id;
      runtime.selectedPhaseId = phase.id;
      if (session) session.selectedPhaseId = phase.id;
    } else {
      runtime.selectedPhaseId = null;
      if (session) session.selectedPhaseId = null;
    }
  }

  execSession.forwardStdin({
    nodeUuid: runtime.executorNodeUuid,
    sessionId: runtime.sessionId,
    event: enabled ? 'manual_record_start' : 'manual_record_stop',
    data: {},
  });
  const status = await execSession.waitForSessionEvent(runtime.sessionId, 'manual_record_status', 10000)
    .catch(() => ({ enabled: !!enabled }));
  return {
    trajectoryId: tid,
    enabled: !!status.enabled,
    phaseId: enabled ? (resolvedPhaseId ?? runtime.selectedPhaseId ?? null) : null,
  };
}

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

export async function listStepsByPhase(phaseDbId) {
  return trajectoryStepDao.listByPhase(+phaseDbId);
}

export async function listByFunction(functionId, pagination) {
  return trajectoryDao.listByFunction(functionId, pagination);
}
