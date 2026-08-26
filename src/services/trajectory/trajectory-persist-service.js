/**
 * Trajectory persist helpers: action/flow → steps, bulk save/append, live step append.
 */
import { randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import * as trajectoryDao from '../../dao/trajectory-dao.js';
import * as trajectoryPhaseDao from '../../dao/trajectory-phase-dao.js';
import * as trajectoryStepDao from '../../dao/trajectory-step-dao.js';
import * as systemDao from '../../dao/system-dao.js';
import { getDB } from '#config/database.js';
import { stepFromActionLog } from '../../models/helpers.js';
import { touchTrajectoryRuntimeActivity } from './trajectory-runtime.js';
import { refreshTrajectoryCounts } from './trajectory-step-service.js';

export {
  appendRecordedStep,
  appendRecordedFormSnapshot,
} from './form-snapshot-append.js';

/**
 * 从 action_{ts}.json 文件构建 trajectory_step 行。
 * @param {string} actionFilePath action 文件路径
 * @param {object} [opts] 配置选项
 * @param {string} [opts.source] 步骤来源，默认 'agent'
 * @returns {Array} 构建的步骤数组
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
    console.warn('[trajectory-persist] Failed to parse action file:', err.message);
    return [];
  }
}

/**
 * 从 flow 数组构建 trajectory_step 行。
 * @param {Array} flow flow 数组
 * @param {object} [opts] 配置选项
 * @param {string} [opts.source] 步骤来源，默认 'agent'
 * @returns {Array} 构建的步骤数组
 */
export function buildStepsFromFlow(flow, { source = 'agent' } = {}) {
  if (!Array.isArray(flow)) return [];
  return flow
    .filter((s) => s.type && s.type !== 'done')
    .map((s, i) => stepFromActionLog(
      {
        action: s.type,
        params: s.params || null,
        element: s.element || null,
        success: s.success ?? null,
        error: s.error || null,
        result: s.extractedContent || '',
        source: s.source || source,
      },
      {
        stepNumber: s.stepNumber || i + 1,
        phaseNumber: s.phaseNumber ?? 0,
        source: s.source || source,
      },
    ));
}

/**
 * 读取操作日志文本（与 log_{ts}.txt 格式相同）。
 * @param {string} logFilePath 日志文件路径
 * @returns {{ text: string, url: string }} text - 日志文本内容；url - 从日志中提取的 URL
 */
export function readOperationLogText(logFilePath) {
  if (!logFilePath || !existsSync(logFilePath)) return { text: '', url: '' };
  try {
    const text = readFileSync(logFilePath, 'utf-8');
    const urlMatch = text.match(/^URL:\s*(.+)$/m);
    return { text, url: (urlMatch?.[1] || '').trim() };
  } catch (err) {
    console.warn('[trajectory-persist] Failed to read log file:', err.message);
    return { text: '', url: '' };
  }
}

/**
 * 将新的日志批次追加到现有的 trajectory_log 文本中。
 * @param {string|null} existing 现有日志文本
 * @param {string} incoming 新的日志文本
 * @returns {string|null} 合并后的日志文本
 */
function mergeOperationLogText(existing, incoming) {
  const prev = typeof existing === 'string' ? existing.trim() : '';
  const add = typeof incoming === 'string' ? incoming.trim() : '';
  if (!add) return prev || null;
  if (!prev) return add;
  return `${prev}\n\n----------\n\n${add}`;
}

/**
 * 从日志头部或回退字符串解析 URL。
 * @param {...string} candidates URL 候选列表
 * @returns {string} 解析到的 URL，如果没有则返回空字符串
 */
function resolveUrl(...candidates) {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() && c.trim() !== 'http://unknown') return c.trim();
  }
  return '';
}

/**
 * 从步骤构建阶段信息。
 * @param {Array} steps 步骤数组
 * @param {Record<string|number, string>} [phaseDescriptions] phaseNumber 到任务文本的映射
 * @returns {Array} 构建的阶段数组
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

/**
 * 持久化/追加轨迹。身份是数字 DB id（不是 session UUID）。
 * @param {object} opts 配置选项
 * @param {number} [opts.id] 现有轨迹的 id，用于追加
 * @param {number} [opts.functionId] 函数 ID
 * @param {Record<string|number,string>} [opts.phaseDescriptions] phaseNumber 到描述的映射
 * @param {string} [opts.logFile] log_{ts}.txt 文件路径，存储到 trajectory_log
 * @param {string} [opts.trajectoryLog] 原始日志文本（logFile 的替代）
 * @param {string} [opts.nativeTrajectoryFile] 原生轨迹文件路径
 * @param {Set<string>|null} [opts.excludeActionIds] 已实时持久化的 ActionEntry.id 值，批量追加时跳过
 * @param {string} [opts.task] 任务描述
 * @param {string} [opts.model] 模型名称
 * @param {string} [opts.url] URL
 * @param {boolean} [opts.isDone] 是否完成
 * @param {boolean} [opts.isSuccessful] 是否成功
 * @param {string} [opts.actionFile] action 文件路径
 * @param {Array} [opts.flow] flow 数组
 * @param {string} [opts.remoteSessionId] 远程会话 ID
 * @returns {Promise<number>} 轨迹 ID
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
      `[trajectory-persist] persist filter: ${beforeFilter} → ${steps.length} steps `
      + `(excluded ${beforeFilter - steps.length} already live-persisted)`,
    );
  }
  if (!steps.length && beforeFilter > 0) {
    console.warn(
      '[trajectory-persist] all action-file steps were already live-persisted; '
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

/**
 * 追加轨迹到现有轨迹。
 * @param {object} existing 现有轨迹对象
 * @param {object} opts 配置选项
 * @param {Array} opts.steps 要追加的步骤
 * @param {string} [opts.task] 任务描述
 * @param {string} [opts.model] 模型名称
 * @param {string} [opts.url] URL
 * @param {boolean} [opts.isDone] 是否完成
 * @param {boolean} [opts.isSuccessful] 是否成功
 * @param {number} [opts.functionId] 函数 ID
 * @param {Record<string|number,string>} [opts.phaseDescriptions] phaseNumber 到描述的映射
 * @param {string} [opts.logText] 日志文本
 * @returns {Promise<number>} 轨迹 ID
 */
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
 * @param {number} trajectoryDbId trajectory DB primary key
 * @param {Record<string|number,string>} [phaseDescriptions] phaseNumber 到描述的映射
 * @param {Set<number>|null} [batchPhaseNums] 本批次涉及的 phase numbers；空则不限制
 * @param {Set<number>|null} [existingPhaseNums] 已存在的 phase numbers；省略时从 DB 查询
 * @returns {Promise<void>}
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
 * @param {number} trajectoryDbId trajectory DB primary key
 * @param {Record<string|number,string>} [phaseDescriptions] phaseNumber 到描述的映射
 * @param {Set<number>|null} [onlyPhaseNumbers] when set, only those phase_numbers are updated
 * @returns {Promise<void>}
 */
async function syncPhaseDescriptions(trajectoryDbId, phaseDescriptions = {}, onlyPhaseNumbers = null) {
  let updated = false;
  for (const [k, desc] of Object.entries(phaseDescriptions || {})) {
    if (!desc) continue;
    const n = Number(k);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (onlyPhaseNumbers && !onlyPhaseNumbers.has(n)) continue;
    await getDB()('trajectory_phase')
      .where({ trajectory_id: trajectoryDbId, phase_number: n })
      .update({ description: String(desc) });
    updated = true;
  }
  if (updated) await trajectoryDao.markExportDirty(trajectoryDbId);
}

/**
 * Save a full trajectory (steps + phases) to DB and recompute counts.
 * @param {object} opts 配置选项
 * @param {object} opts.trajectory 轨迹行数据
 * @param {Array} [opts.phases] 阶段行数组
 * @param {number} [opts.functionId] 函数 ID；省略时取默认函数
 * @param {string} [opts.remoteSessionId] 远程会话 ID
 * @returns {Promise<number>} 新建轨迹的 DB id
 */
export async function saveFullTrajectory({ trajectory, phases, functionId, remoteSessionId }) {
  let resolvedFunctionId = null;
  if (typeof functionId === 'number') {
    resolvedFunctionId = functionId;
  } else {
    resolvedFunctionId = await systemDao.getDefaultFunctionId();
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
 * @param {number} trajectoryId trajectory DB primary key
 * @param {object} [opts] 配置选项
 * @param {number|null} [opts.phaseId] 显式指定的 phase id
 * @param {number|null} [opts.phaseNumber] 用于匹配的 phase number
 * @param {boolean} [opts.fallbackLast] 未命中时是否回退到末尾阶段，默认 true
 * @returns {Promise<{ id: number|null, phaseNumber: number|null }>} 解析到的阶段 id 与 phaseNumber
 */
export async function resolvePhaseIdForPersist(trajectoryId, {
  phaseId = null,
  phaseNumber = null,
  fallbackLast = true,
} = {}) {
  const tid = Number(trajectoryId);
  if (!Number.isFinite(tid) || tid <= 0) return { id: null, phaseNumber: null };

  if (phaseId != null && Number.isFinite(Number(phaseId)) && Number(phaseId) > 0) {
    const p = await trajectoryPhaseDao.getById(+phaseId);
    if (p && Number(p.trajectoryId) === tid) {
      return {
        id: p.id,
        phaseNumber: p.phaseNumber != null ? Number(p.phaseNumber) : null,
      };
    }
  }

  const pn = Number(phaseNumber);
  if (Number.isFinite(pn) && pn > 0) {
    const row = await getDB()('trajectory_phase')
      .where({ trajectory_id: tid, phase_number: pn })
      .first();
    if (row?.id) {
      return { id: row.id, phaseNumber: Number(row.phase_number) };
    }
  }

  if (fallbackLast) {
    const last = await getDB()('trajectory_phase')
      .where({ trajectory_id: tid })
      .orderBy('phase_number', 'desc')
      .first();
    if (last?.id) {
      return { id: last.id, phaseNumber: Number(last.phase_number) };
    }
  }
  return { id: null, phaseNumber: null };
}


/**
 * Delete live-persisted steps by DB primary keys, then renumber remaining steps.
 * Used when AI/manual coalesce drops a prior ACTION_LOG entry that was already persisted.
 * @param {number} trajectoryDbId trajectory DB primary key
 * @param {number[]} [dbIds] 要删除的 step DB id 列表
 * @returns {Promise<{ removed: number }>} 实际删除的行数
 */
export async function removeRecordedStepsByDbIds(trajectoryDbId, dbIds = []) {
  const tid = Number(trajectoryDbId);
  const ids = (Array.isArray(dbIds) ? dbIds : [])
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!Number.isFinite(tid) || tid <= 0 || !ids.length) return { removed: 0 };

  const deleted = await getDB()('trajectory_step')
    .where({ trajectory_id: tid })
    .whereIn('id', ids)
    .del();

  if (deleted > 0) {
    await trajectoryStepDao.reorderByTrajectory(tid);
    const counts = await refreshTrajectoryCounts(tid);
    await trajectoryDao.updateMeta(tid, {
      stepCount: counts.stepCount,
      phaseCount: counts.phaseCount,
    });
    touchTrajectoryRuntimeActivity(tid);
  }

  return { removed: deleted || 0 };
}
