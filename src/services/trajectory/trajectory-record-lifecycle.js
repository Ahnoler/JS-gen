/**
 * AI / manual recording lifecycle: start, stop, toggle, resolve, default login.
 */
import { randomUUID } from 'crypto';
import * as trajectoryDao from '../../dao/trajectory-dao.js';
import * as systemDao from '../../dao/system-dao.js';
import * as execSession from '../../executor-session-client.js';
import { state } from '../../state.js';
import { USE_EXECUTOR } from '../../../config/config.js';
import * as remoteBridge from '../../cdp/remote-bridge.js';
import {
  buildLoginInstruction,
  resolveTrajectoryAccount,
} from '../trajectory-account-service.js';
import { getTrajectoryTree } from '../trajectory-query-service.js';
import {
  getTrajectoryRuntime,
  markConsumedActionLog,
} from '../trajectory-runtime.js';

export { startTrajectoryRecording } from './trajectory-recording-runner.js';
export { toggleTrajectoryManualRecord } from './trajectory-manual-record.js';

/**
 * Terminology (do not conflate):
 *
 * - **业务数据 (business data)** — values the *user* puts in the requirement /
 *   task text (often under「关键数据」「案例数据」section headers in NL).
 *   This is what they *want* the recording to use (e.g. introduce person 朱桂武).
 *   Soft / relatively-structured prose; not a DB schema. Stays in task / 【业务数据】.
 *
 * - **系统参考值 (system_ref_*)** — values captured from the *target system*
 *   and optionally verified for reuse (`system_ref_data` / `system_ref_entry`).
 *   Future fill-form reference; **not** injected into the agent in this iteration.
 *   Never write extractCaseEntriesFromRequirement / user 业务数据 into system_ref_*.
 *
 * - **案例数据 legacy (case_data / case_data_entry)** — historical tables; retain
 *   but do not treat as the product home for system-captured verified values.
 *
 * User 业务数据 ≠ system_ref ≠ legacy case_data. Feeding the agent for
 * fill/introduce must prefer 业务数据 as readable context.
 * Inject 业务数据 only for fill / modify / introduce phases — never for
 * pure navigate / login / list-query (avoids「填写」polluting task_mode).
 *
 * Historical note: symbols like `case_data_block` / `caseEntries` often carry
 * **业务数据** extracted from the requirement — names predate this split.
 *
 * Design for 业务数据:
 *   Users rarely supply a clean fieldKey→value map. Demand text is only
 *   *relatively* structured, e.g. under「对公客户基本信息」they may write
 *   「法定责任人引入 朱桂武」or「引入时客户名称用朱桂武」. Labels drift; we
 *   MUST tolerate soft deviations — ship the raw block to the AI, do NOT
 *   drive autofill by hard label↔key matching.
 *
 * Returns:
 *   caseDataBlock — raw 业务数据 text from trajectory.task (preferred AI context)
 *   caseData      — optional flat KV derived from that text (secondary; may also
 *                   land in legacy case_data_entry for memory — NOT system_ref)
 */
export async function prepareCaseDataInjection(trajectoryId) {
  const tid = Number(trajectoryId);
  if (!Number.isFinite(tid) || tid <= 0) {
    return { caseDataFile: null, caseData: null, caseDataBlock: '' };
  }
  try {
    const { loadFlatDictByTrajectory, replaceEntriesForTrajectory } =
      await import('../../dao/case-data-dao.js');
    const {
      extractCaseEntriesFromRequirement,
      extractCaseDataBlock,
    } = await import('./trajectory-meta-service.js');

    const trajDao = await import('../../dao/trajectory-dao.js');
    const traj = await trajDao.getById(tid);
    const taskText = traj?.task || '';
    const caseDataBlock = extractCaseDataBlock(taskText) || '';

    // 扁平 KV：有则用；空则从 task 兜底解析并落库（记忆摄取仍可用）
    let flat = await loadFlatDictByTrajectory(tid);
    if (!(flat && Object.keys(flat).length)) {
      const entries = extractCaseEntriesFromRequirement(taskText);
      if (entries.length) {
        await replaceEntriesForTrajectory(tid, entries).catch((err) => {
          console.warn('[record] case-data fallback persist skipped:', err?.message || err);
        });
        try {
          const { ingestCaseEntriesAsFacts } = await import('../../memory/memory-service.js');
          await ingestCaseEntriesAsFacts(tid, entries);
        } catch (err) {
          console.warn('[record] case-data fallback fact ingest skipped:', err?.message || err);
        }
        flat = {};
        for (const e of entries) flat[e.fieldKey] = e.fieldValue ?? '';
        console.log(`[record] case-data fallback from task: ${entries.length} keys`);
      }
    }

    if (caseDataBlock) {
      console.log(`[record] case-data block ready (${caseDataBlock.length} chars) for AI context`);
    }
    return {
      caseDataFile: null,
      caseData: flat && Object.keys(flat).length ? flat : null,
      caseDataBlock,
    };
  } catch (err) {
    console.warn('[record] case-data injection skipped:', err?.message || err);
  }
  return { caseDataFile: null, caseData: null, caseDataBlock: '' };
}


/**
 * Default login/navigate — NOT written to trajectory_step (is_replay / suppress persist).
 */
export async function runDefaultLogin(runtime, account, system = null) {
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
        max_steps: 10,
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
    try {
      const { broadcastWatcherStatus } = await import('../../routes/browser-session/broadcasts.js');
      broadcastWatcherStatus();
    } catch {}
  }
}


export async function stopTrajectoryRecording(trajectoryId, { success = true } = {}) {
  const tid = Number(trajectoryId);
  const runtime = getTrajectoryRuntime(tid);
  const traj = await trajectoryDao.getById(tid);
  if (!traj) {
    const err = new Error('Trajectory not found');
    err.statusCode = 404;
    throw err;
  }

  if (runtime) {
    runtime.abortRecording = true;
    const session = state.sessions.get(runtime.sessionId);
    // Always ask agent to stop — do not wait for busy flag (may be stale).
    try {
      execSession.forwardStdin({
        nodeUuid: runtime.executorNodeUuid,
        sessionId: runtime.sessionId,
        event: 'cancel_step',
        data: {},
      });
    } catch {}
    if (session) {
      session.busy = false;
      session.selectedPhaseId = null;
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
    try {
      execSession.forwardStdin({
        nodeUuid: runtime.executorNodeUuid,
        sessionId: runtime.sessionId,
        event: 'capture_screenshots',
        data: { enabled: false },
      });
    } catch {}
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

/**
 * Batch-safe stop: never downgrade recorded/completed back to draft.
 * Sends cancel_step when a runtime exists; CAS-updates only live/recording.
 */
export async function stopTrajectoryRecordingSafe(trajectoryId, {
  success = false,
} = {}) {
  const tid = Number(trajectoryId);
  const runtime = getTrajectoryRuntime(tid);
  const traj = await trajectoryDao.getById(tid);
  if (!traj) {
    const err = new Error('Trajectory not found');
    err.statusCode = 404;
    throw err;
  }

  if (runtime) {
    runtime.abortRecording = true;
    const session = state.sessions.get(runtime.sessionId);
    try {
      execSession.forwardStdin({
        nodeUuid: runtime.executorNodeUuid,
        sessionId: runtime.sessionId,
        event: 'cancel_step',
        data: {},
      });
    } catch {}
    if (session) {
      session.busy = false;
      session.selectedPhaseId = null;
    }
    try {
      execSession.forwardStdin({
        nodeUuid: runtime.executorNodeUuid,
        sessionId: runtime.sessionId,
        event: 'manual_record_stop',
        data: {},
      });
    } catch {}
    runtime.selectedPhaseId = null;
  }

  let recordStatus = traj.recordStatus;
  if (traj.recordStatus === 'recorded' || traj.recordStatus === 'completed') {
    // Do not downgrade terminal success
    recordStatus = traj.recordStatus;
  } else if (success) {
    const n = await trajectoryDao.updateMetaIf(tid, {
      recordStatus: 'recorded',
      isDone: true,
      isSuccessful: true,
    }, { recordStatusIn: ['live', 'recording', 'draft'] });
    recordStatus = n ? 'recorded' : (await trajectoryDao.getById(tid))?.recordStatus;
  } else {
    const n = await trajectoryDao.updateMetaIf(tid, {
      recordStatus: 'draft',
      isDone: false,
      isSuccessful: false,
    }, { recordStatusIn: ['live', 'recording'] });
    const fresh = await trajectoryDao.getById(tid);
    recordStatus = n ? 'draft' : (fresh?.recordStatus || traj.recordStatus);
  }

  const tree = await getTrajectoryTree(tid);
  return {
    trajectoryId: tid,
    recordStatus,
    detached: false,
    tree,
  };
}

export async function resolveTrajectoryElement(trajectoryId, {
  labelText,
  actionType,
  action,
  params,
  mode,
} = {}) {
  const tid = Number(trajectoryId);
  const label = String(labelText || '').trim();
  const act = String(actionType || action || '').trim();
  const p = { ...(params && typeof params === 'object' ? params : {}) };
  const resolveMode = String(mode || 'inventory').trim() || 'inventory';
  // click_element_by_index often targets sidebar .menu-item; older resolve only
  // searched menus when action=click_menu_item or params.menu_text — mirror text.
  if (act === 'click_element_by_index') {
    const t = String(p.text || label || '').trim();
    if (t && !String(p.menu_text || '').trim()) p.menu_text = t;
  }
  if (resolveMode !== 'inventory' && !label && !act && !Object.keys(p).length) {
    const err = new Error('labelText or actionType/params is required');
    err.statusCode = 400;
    throw err;
  }
  const runtime = getTrajectoryRuntime(tid);
  if (!runtime?.sessionId) {
    const err = new Error('Trajectory is not attached — call record/prepare first');
    err.statusCode = 400;
    throw err;
  }

  if (USE_EXECUTOR) {
    if (!runtime.executorNodeUuid) {
      const err = new Error('Executor node missing on trajectory runtime');
      err.statusCode = 400;
      throw err;
    }
    const requestId = randomUUID();
    const resultP = execSession.waitForSessionEvent(
      runtime.sessionId,
      'session.bib_resolve_element_result',
      20000,
    );
    execSession.sendToExecutor(runtime.executorNodeUuid, 'session.bib_resolve_element', {
      sessionId: runtime.sessionId,
      labelText: label,
      actionType: act,
      params: p,
      mode: resolveMode,
      requestId,
    });
    const payload = await resultP;
    if (payload?.error) {
      const msg = String(payload.error);
      const err = new Error(msg);
      err.statusCode = /not attached|not available|required/i.test(msg) ? 400 : 404;
      throw err;
    }
    if (payload?.ambiguous && Array.isArray(payload.matches)) {
      return {
        trajectoryId: tid,
        ambiguous: true,
        matches: payload.matches,
        ...(payload.truncated ? { truncated: true } : {}),
      };
    }
    if (!payload?.element) {
      const err = new Error(`No form field found for label: ${label || act}`);
      err.statusCode = 404;
      throw err;
    }
    return {
      trajectoryId: tid,
      matchedLabel: payload.matchedLabel || label,
      element: payload.element,
    };
  }

  const resolved = await remoteBridge.resolveElementByLabelText(label, {
    actionType: act,
    params: p,
    mode: resolveMode,
  });
  if (resolved?.ambiguous) {
    return {
      trajectoryId: tid,
      ambiguous: true,
      matches: resolved.matches,
      ...(resolved.truncated ? { truncated: true } : {}),
    };
  }
  return {
    trajectoryId: tid,
    matchedLabel: resolved.matchedLabel,
    element: resolved.element,
  };
}

