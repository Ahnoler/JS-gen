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
import { getTrajectoryTree } from './trajectory-query-service.js';
import {
  getTrajectoryRuntime,
  markConsumedActionLog,
} from './trajectory-runtime.js';
import { classifyRegions } from '../region-classify.js';
import { displayGroupOf, isTaxonomyRegionToken, uniquifyDisplayGroups } from '../../cdp/display-group.js';

async function resolveSystemIdForTrajectory(tid) {
  try {
    const traj = await trajectoryDao.getById(tid);
    if (!traj?.functionId) return '';
    const { resolveAncestorSystemId } = await import('../hierarchy-service.js');
    const systemId = await resolveAncestorSystemId(traj.functionId);
    return systemId != null ? String(systemId) : '';
  } catch (err) {
    console.warn('[record] resolve systemId skipped:', err?.message || err);
    return '';
  }
}

function regionIdFromClassified(classified, existing = {}) {
  const role = String(classified.role || 'other');
  const prevId = String(existing.region_id || '');
  if (role === 'overlay') {
    const t = String(classified.title || classified.label || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (t) return `overlay:${t}`;
    if (prevId.startsWith('overlay:')) return prevId;
    return 'overlay';
  }
  if (role === 'section') {
    const t = String(classified.title || classified.label || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (t) return `section:${t}`;
    if (prevId.startsWith('section:')) return prevId;
    return 'section';
  }
  return role;
}

function patchRegionFields(target, classified) {
  if (!target || !classified) return;
  const prevRole = String(target.region_role || '');
  const role = String(classified.role || prevRole || 'other');
  const prevLabel = String(target.region_label || '').trim();
  const prevId = String(target.region_id || '').trim();
  let nextLabel = String(classified.label || '').trim();
  // Coarse→refine contract: assignRegion / collision-refine labels win.
  // L1c feature-card title often echoes outer collapse and would undo titlebox refine
  // (e.g.「关联人信息」→「股东及关联人信息」). Only fill empty/taxonomy labels.
  const keepPrevLabel = !!(prevLabel && !isTaxonomyRegionToken(prevLabel));
  if (keepPrevLabel && (prevRole === 'tab' || prevRole === 'wizard' || prevRole === 'section' || prevRole === 'todo')) {
    target.region_role = prevRole;
  } else {
    target.region_role = role;
  }
  if (keepPrevLabel) {
    nextLabel = prevLabel;
  } else if (!nextLabel || isTaxonomyRegionToken(nextLabel)) {
    nextLabel = prevLabel;
  }
  if (!nextLabel && !isTaxonomyRegionToken(role)) nextLabel = role;
  target.region_label = nextLabel || prevLabel;
  if (keepPrevLabel && prevId) {
    // Preserve collision-refined region_id (section:<titlebox title>).
    target.region_id = prevId;
  } else {
    target.region_id = regionIdFromClassified(classified, target);
  }
  if (classified.confidence != null) target.region_confidence = classified.confidence;
  // Keep AG picker group key in sync when L1c rewrites region_* (show A == save A).
  const group = displayGroupOf(target);
  if (group) target.display_group = group;
  else delete target.display_group;
}

function stripFeatureCard(target) {
  if (target && typeof target === 'object' && 'feature_card' in target) {
    delete target.feature_card;
  }
}

async function applyL1cRegionClassify(payload, { systemId = '' } = {}) {
  if (!payload || typeof payload !== 'object') return payload;
  try {
    const refs = [];
    const cards = [];
    if (payload.ambiguous && Array.isArray(payload.matches)) {
      for (const match of payload.matches) {
        const fc = match?.element?.feature_card || match?.preview?.feature_card;
        if (fc && typeof fc === 'object') {
          cards.push({ ...fc });
          refs.push(match);
        }
      }
    } else if (payload.element) {
      const fc = payload.element.feature_card;
      if (fc && typeof fc === 'object') {
        cards.push({ ...fc });
        refs.push({ element: payload.element, preview: null });
      }
    }
    if (!cards.length) return payload;

    const classified = await classifyRegions(cards, { systemId });
    for (let i = 0; i < refs.length; i++) {
      const c = classified[i];
      if (!c) continue;
      const ref = refs[i];
      if (ref.element) patchRegionFields(ref.element, c);
      if (ref.preview) patchRegionFields(ref.preview, c);
      if (ref.element) stripFeatureCard(ref.element);
      if (ref.preview) stripFeatureCard(ref.preview);
    }
    if (payload.ambiguous && Array.isArray(payload.matches)) {
      uniquifyDisplayGroups(payload.matches);
    }
    return payload;
  } catch (err) {
    console.warn('[record] L1c region classify skipped:', err?.message || err);
    return payload;
  }
}

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
 * Hardcoded go_to_url + login via replay_actions (no browser-use Agent).
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
    const url = String(sys?.url || account?.loginUrl || '').trim();
    const username = String(account?.username || '').trim();
    const password = String(account?.password || '').trim();
    if (!url) {
      const err = new Error('System url is empty — set system.url (or legacy account.loginUrl)');
      err.statusCode = 400;
      throw err;
    }
    const doneP = execSession.waitForSessionEvent(runtime.sessionId, 'replay_done', 180000);
    execSession.forwardStdin({
      nodeUuid: runtime.executorNodeUuid,
      sessionId: runtime.sessionId,
      event: 'replay_actions',
      data: {
        actions: [
          { action: 'go_to_url', params: { url } },
          { action: 'login', params: { username, password } },
        ],
        is_replay: true,
        stop_on_fail: true,
      },
    });
    const result = await doneP;
    const failed = Number(result?.failed || 0);
    const okCount = Number(result?.ok || 0);
    if (result?.error || failed > 0 || okCount < 2) {
      throw new Error(result?.error || `login replay failed (ok=${okCount} failed=${failed})`);
    }
    await markConsumedActionLog(runtime);
    runtime.loginDone = true;
    runtime.loginAccountId = Number(account.id);
  } finally {
    runtime.suppressStepPersist = false;
    runtime.isReplay = false;
    if (session) {
      // Product AI record holds the lock across all phases; login is only a
      // nested op and must not unlock the canvas / demote 到未录制.
      if (runtime.aiRecording) {
        session.busy = true;
      } else {
        session.busy = false;
        session.activePhaseId = null;
      }
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
    runtime.aiRecording = false;
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
      session.aiRecording = false;
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

  const recordStatus = success ? 'recorded' : 'failed';
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
 * Batch-safe stop: never downgrade recorded/completed; failed only retries via record/start.
 * Sends cancel_step when a runtime exists; CAS-updates only recording/failed（success 含 draft）.
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
    runtime.aiRecording = false;
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
      session.aiRecording = false;
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
    }, { recordStatusIn: ['draft', 'recording', 'failed'] });
    recordStatus = n ? 'recorded' : (await trajectoryDao.getById(tid))?.recordStatus;
  } else {
    const n = await trajectoryDao.updateMetaIf(tid, {
      recordStatus: 'failed',
      isDone: false,
      isSuccessful: false,
    }, { recordStatusIn: ['recording', 'failed'] });
    const fresh = await trajectoryDao.getById(tid);
    recordStatus = n ? 'failed' : (fresh?.recordStatus || traj.recordStatus);
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
  pageLabel,
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
  const systemId = await resolveSystemIdForTrajectory(tid);

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
      pageLabel: pageLabel || p.pageLabel || p.page_label || '',
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
      return applyL1cRegionClassify({
        trajectoryId: tid,
        ambiguous: true,
        matches: payload.matches,
        ...(payload.truncated ? { truncated: true } : {}),
      }, { systemId });
    }
    if (!payload?.element) {
      const err = new Error(`No form field found for label: ${label || act}`);
      err.statusCode = 404;
      throw err;
    }
    return applyL1cRegionClassify({
      trajectoryId: tid,
      matchedLabel: payload.matchedLabel || label,
      element: payload.element,
    }, { systemId });
  }

  const resolved = await remoteBridge.resolveElementByLabelText(label, {
    actionType: act,
    params: p,
    mode: resolveMode,
    pageLabel: pageLabel || p.pageLabel || p.page_label || '',
  });
  if (resolved?.ambiguous) {
    return applyL1cRegionClassify({
      trajectoryId: tid,
      ambiguous: true,
      matches: resolved.matches,
      ...(resolved.truncated ? { truncated: true } : {}),
    }, { systemId });
  }
  return applyL1cRegionClassify({
    trajectoryId: tid,
    matchedLabel: resolved.matchedLabel,
    element: resolved.element,
  }, { systemId });
}

