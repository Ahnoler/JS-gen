/**
 * AI / manual recording lifecycle: start, stop, toggle, resolve, default login.
 */
import { randomUUID } from 'crypto';
import * as trajectoryDao from '../../dao/trajectory-dao.js';
import * as trajectoryPhaseDao from '../../dao/trajectory-phase-dao.js';
import * as systemDao from '../../dao/system-dao.js';
import * as execSession from '../../executor-session-client.js';
import { runReplayActions } from '../replay-actions.js';
import { state } from '../../state.js';
import { USE_EXECUTOR } from '#config/config.js';
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
 * - 业务数据 (business data) — values the user puts in the requirement /
 *   task text (often under「关键数据」「业务数据」section headers in NL).
 *   This is what they want the recording to use (e.g. introduce person 朱桂武).
 *   Soft / relatively-structured prose; not a DB schema. Stays in task / 【业务数据】.
 *
 * - 系统参考值 (system_ref_*) — values captured from the target system
 *   and optionally verified for reuse (`system_ref_data` / `system_ref_entry`).
 *   Future fill-form reference; not injected into the agent in this iteration.
 *   Never write extractBusinessEntriesFromRequirement / user 业务数据 into system_ref_*.
 *
 * - 业务数据 legacy (business_data / business_data_entry) — historical tables; retain
 *   but do not treat as the product home for system-captured verified values.
 *
 * User 业务数据 ≠ system_ref ≠ legacy business_data. Feeding the agent for
 * fill/introduce must prefer 业务数据 as readable context.
 * Inject 业务数据 only for fill / modify / introduce phases — never for
 * pure navigate / login / list-query (avoids「填写」polluting task_mode).
 *
 * Historical note: symbols like `business_data_block` / `businessEntries` often carry
 * 业务数据 extracted from the requirement — names predate this split.
 *
 * Design for 业务数据:
 *   Users rarely supply a clean fieldKey→value map. Demand text is only
 *   relatively structured, e.g. under「对公客户基本信息」they may write
 *   「法定责任人引入 朱桂武」or「引入时客户名称用朱桂武」. Labels drift; we
 *   MUST tolerate soft deviations — ship the raw block to the AI, do NOT
 *   drive autofill by hard label↔key matching.
 *
 * Returns:
 *   businessDataBlock — raw 业务数据 text from trajectory.task (preferred AI context)
 *   businessData      — optional flat KV derived from that text (secondary; may also
 *                       land in legacy business_data_entry for memory — NOT system_ref)
 * @param {number} trajectoryId trajectory DB id
 * @returns {{ businessDataFile: null, businessData: object|null, businessDataBlock: string }} business data context for AI injection
 */
export async function prepareBusinessDataInjection(trajectoryId) {
  const tid = Number(trajectoryId);
  if (!Number.isFinite(tid) || tid <= 0) {
    return { businessDataFile: null, businessData: null, businessDataBlock: '' };
  }
  try {
    const { loadFlatDictByTrajectory, replaceEntriesForTrajectory } =
      await import('../../dao/business-data-dao.js');
    const {
      extractBusinessEntriesFromRequirement,
      extractBusinessDataBlock,
    } = await import('./trajectory-meta-service.js');

    const trajDao = await import('../../dao/trajectory-dao.js');
    const traj = await trajDao.getById(tid);
    const taskText = traj?.task || '';
    const businessDataBlock = extractBusinessDataBlock(taskText) || '';

    // 扁平 KV：有则用；空则从 task 兜底解析并落库（记忆摄取仍可用）
    let flat = await loadFlatDictByTrajectory(tid);
    if (!(flat && Object.keys(flat).length)) {
      const entries = extractBusinessEntriesFromRequirement(taskText);
      if (entries.length) {
        await replaceEntriesForTrajectory(tid, entries).catch((err) => {
          console.warn('[record] business-data fallback persist skipped:', err?.message || err);
        });
        try {
          const { ingestBusinessEntriesAsFacts } = await import('../../memory/memory-service.js');
          await ingestBusinessEntriesAsFacts(tid, entries);
        } catch (err) {
          console.warn('[record] business-data fallback fact ingest skipped:', err?.message || err);
        }
        flat = {};
        for (const e of entries) flat[e.fieldKey] = e.fieldValue ?? '';
        console.log(`[record] business-data fallback from task: ${entries.length} keys`);
      }
    }

    if (businessDataBlock) {
      console.log(`[record] business-data block ready (${businessDataBlock.length} chars) for AI context`);
    }
    return {
      businessDataFile: null,
      businessData: flat && Object.keys(flat).length ? flat : null,
      businessDataBlock,
    };
  } catch (err) {
    console.warn('[record] business-data injection skipped:', err?.message || err);
  }
  return { businessDataFile: null, businessData: null, businessDataBlock: '' };
}


/**
 * Default login/navigate — NOT written to trajectory_step (is_replay / suppress persist).
 * Hardcoded go_to_url + login via runReplayActions (replay_actions; no browser-use Agent).
 * @param {object} runtime trajectory runtime object (sessionId, executorNodeUuid, …)
 * @param {object} account login account ({ account, password, systemId, loginUrl, id })
 * @param {object|null} [system] system row with url; resolved from account.systemId when omitted
 * @returns {Promise<void>} resolves when login replay succeeds; throws on failure
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
    const username = String(account?.account || '').trim();
    const password = String(account?.password || '').trim();
    if (!url) {
      const err = new Error('System url is empty — set system.url (or legacy account.loginUrl)');
      err.statusCode = 400;
      throw err;
    }
    const { result } = await runReplayActions({
      execSession,
      sessionId: runtime.sessionId,
      nodeUuid: runtime.executorNodeUuid,
      actions: [
        { action: 'go_to_url', params: { url } },
        // 登录前等待页面 loading mask 消退（与登录控件探针构成双重防线）
        { action: 'wait_for_loading' },
        { action: 'login', params: { username, password } },
      ],
      timeoutMs: 180000,
      stopOnFail: true,
      isReplay: true,
    });
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


/**
 * Stop trajectory recording and finalize status.
 * @param {number} trajectoryId trajectory DB id
 * @param {object} [root0] options
 * @param {boolean} [root0.success] whether recording ended successfully (default true)
 * @returns {Promise<{ trajectoryId: number, recordStatus: string, detached: boolean, tree: object }>} stop result with updated tree
 */
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
    runtime.userStop = { success: !!success };
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

  // 显式结束录制：按持久状态基线解析结果（V3：success→待确认、failure→录制异常）。
  const recordStatus = await trajectoryDao.finishTransientRecording(
    tid,
    success ? 'success' : 'failure',
  );
  await trajectoryDao.updateMeta(tid, {
    isDone: !!success,
    isSuccessful: !!success,
  });
  // 清理 running 阶段：避免前端 aiActive（running 信号）在刷新后仍显示“录制中”导致二次结束。
  await trajectoryPhaseDao.updateRunningStatus(tid, success ? 'completed' : 'failed').catch((err) => {
    console.warn(`[record] updateRunningStatus failed for #${tid}:`, err?.message || err);
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
 * @param {number} trajectoryId trajectory DB id
 * @param {object} [root0] options
 * @param {boolean} [root0.success] whether recording ended successfully (default false)
 * @returns {Promise<{ trajectoryId: number, recordStatus: string, detached: boolean, tree: object }>} stop result with updated tree
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
    runtime.userStop = { success: !!success };
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

  // 结束录制（批量安全版）：临时状态 recording 按结果解析（V3：success→待确认、failure→录制异常）；
  // 已是持久状态(recorded/completed/failed/draft)则保持不降级。
  let recordStatus = traj.recordStatus;
  if (traj.recordStatus === 'recording') {
    recordStatus = await trajectoryDao.finishTransientRecording(
      tid,
      success ? 'success' : 'failure',
    );
    await trajectoryDao.updateMeta(tid, {
      isDone: !!success,
      isSuccessful: !!success,
    });
    await trajectoryPhaseDao.updateRunningStatus(tid, success ? 'completed' : 'failed').catch((err) => {
      console.warn(`[record] updateRunningStatus failed for #${tid}:`, err?.message || err);
    });
  } else {
    recordStatus = traj.recordStatus;
  }

  const tree = await getTrajectoryTree(tid);
  return {
    trajectoryId: tid,
    recordStatus,
    detached: false,
    tree,
  };
}

/**
 * Resolve a form field/element by label text for an attached trajectory.
 * Routes to executor BiB resolve or remote bridge; applies L1c region classify on result.
 * @param {number} trajectoryId trajectory DB id
 * @param {object} [root0] options
 * @param {string} [root0.labelText] visible label text to search for
 * @param {string} [root0.actionType] action type (e.g. fillFormField)
 * @param {string} [root0.action] alias for actionType
 * @param {object} [root0.params] action params (may carry menu_text, pageLabel, …)
 * @param {string} [root0.mode] resolve mode (default 'inventory')
 * @param {string} [root0.pageLabel] current page label hint
 * @returns {Promise<object>} resolved element payload (with region fields classified); throws 400/404 on failure
 */
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

