/**
 * One-shot prepare for recording studio, serialized per trajectory (unlocked
 * body of prepareTrajectoryRecording). Extracted from
 * trajectory-attach-service.js — move-only, no logic changes.
 */
import * as trajectoryDao from '../../dao/trajectory-dao.js';
import * as trajectoryPhaseDao from '../../dao/trajectory-phase-dao.js';
import * as execSession from '../../executor-session-client.js';
import * as remoteSessionService from '../remote-session-service.js';
import { state } from '../../state.js';
import { broadcast } from '../../ws-server.js';
import {
  resolveTrajectoryAccount,
} from './trajectory-account-service.js';
import { getTrajectoryTree } from './trajectory-query-service.js';
import {
  clearStaleTrajectoryRuntime,
  getTrajectoryRuntime,
} from './trajectory-runtime.js';
import { runDefaultLogin } from './trajectory-record-lifecycle.js';
import { runPrepareLoginWithColdStartRetry } from './prepare-login-retry.js';
import { bindRecordingPageId } from './recording-page-bind.js';
import { runReplayActions } from '../replay-actions.js';
import { USE_EXECUTOR } from '#config/config.js';
import { attachTrajectoryLive } from './trajectory-attach-service.js';
import { getFlowCard } from '../kb-flow-cards.js';
import {
  buildFlowTemplateHint,
  applyFlowTemplateHintToDescription,
} from '../req-draft-traj/flow-card-recall.js';

/**
 * Prefix the first phase description with a flow-card template hint when the
 * trajectory carries kbFlowRef (idempotent via applyFlowTemplateHintToDescription).
 * @param {object} traj trajectory row from resolveTrajectoryAccount
 */
async function injectFlowTemplateHintIfNeeded(traj) {
  const flowRef = traj?.kbFlowRef;
  if (!flowRef) return;
  const card = await getFlowCard({ stem: flowRef });
  if (!card) return;
  const hint = buildFlowTemplateHint({
    card,
    nodeId: traj.kbFlowNodeId || null,
    atomTask: String(traj.task || '').trim(),
  });
  if (!hint) return;
  const phases = await trajectoryPhaseDao.listByTrajectory(traj.id);
  const first = phases.slice().sort((a, b) => Number(a.phaseNumber) - Number(b.phaseNumber))[0];
  if (!first?.id) return;
  const next = applyFlowTemplateHintToDescription(first.description || '', hint);
  if (next === (first.description || '')) return;
  await trajectoryPhaseDao.update(first.id, { description: next });
}

/**
 * Prepare a trajectory for recording after the session lock is acquired.
 * Resolves account, resets stale running phases, runs default login, attaches live.
 * @param {number} tid trajectory DB id
 * @param {object} [opts] prepare options
 * @param {boolean} [opts.skipDefaultLogin] when true, skip the prepare-time
 *   default login (same effect as runtime.skipDefaultLogin, but known before
 *   the runtime object exists — auth dry-run login segment)
 * @param {boolean} [opts.preserveRecordStatus] when false, enter the transient
 *   'recording' state (used by record/start and manual-record). Default true:
 *   prepare only attaches browser/stream without changing record_status.
 * @returns {Promise<object>} prepare result with trajectory, account, and session info
 */
export async function prepareTrajectoryRecordingUnlocked(tid, {
  skipDefaultLogin = false,
  preserveRecordStatus = true,
} = {}) {
  const { traj, account, accountId } = await resolveTrajectoryAccount(tid);

  // 录制进行中：prepare 只做「连资源/推流」，绝不重新登录、绝不导航页面绑定，
  // 否则会打断 agent 正在进行的录制（进入录制页会自动 prepare）。
  const recordingInFlight = traj?.recordStatus === 'recording';

  await injectFlowTemplateHintIfNeeded(traj);

  // A fresh prepare must not inherit a stale "recording" signal: reset any phase
  // left as running by a previous interrupted recording. Skip when currently
  // recording so an active run is not torn down by an idempotent prepare.
  if (traj.recordStatus !== 'recording') {
    const stalePhases = await trajectoryPhaseDao.listByTrajectory(tid);
    for (const phase of stalePhases) {
      if (phase.status === 'running') {
        await trajectoryPhaseDao.updateStatus(phase.id, 'pending');
      }
    }
  }

  if (!USE_EXECUTOR) {
    const err = new Error(
      'USE_EXECUTOR=false is no longer supported — start npm run executor and set USE_EXECUTOR=true',
    );
    err.statusCode = 503;
    throw err;
  }

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

  emitStage('session', 'running');
  emitStage('browser', 'running');

  let attachResult = null;
  let runtime = await clearStaleTrajectoryRuntime(tid);
  if (!runtime) {
    attachResult = await attachTrajectoryLive(tid);
    runtime = getTrajectoryRuntime(tid);
  } else {
    attachResult = {
      sessionId: runtime.sessionId,
      executorNodeUuid: runtime.executorNodeUuid,
      remoteSessionId: runtime.remoteSessionId,
      bibError: runtime.bibError || null,
      reused: true,
      status: await remoteSessionService.getLiveStatus({ trajectoryId: tid }).catch(() => null),
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
    reusedChrome: !!attachResult?.reusedChrome,
  });
  emitStage('browser', 'done', {
    cdpPort: state.sessions.get(runtime.sessionId)?.cdpPort ?? null,
    cdpReady: state.sessions.get(runtime.sessionId)?.cdpReady !== false,
  });

  // ── stream: attach BiB for THIS trajectory only ──
  emitStage('stream', 'running');
  let bibError = runtime.bibError || attachResult?.bibError || null;
  let remoteSessionId = null;

  const liveNow = await remoteSessionService.getLiveStatus({
    trajectoryId: tid,
    preferAgentSessionId: runtime.sessionId,
  }).catch(() => null);
  const liveMatchesRuntime = liveNow?.attached
    && liveNow?.remoteSessionId
    && liveNow.sessionId === runtime.sessionId;

  if (liveMatchesRuntime) {
    remoteSessionId = liveNow.remoteSessionId;
    runtime.remoteSessionId = remoteSessionId;
    await remoteSessionService.mountTrajectoryRemoteSession(tid, remoteSessionId).catch(() => {});
  } else {
    // Drop dirty bindings for other agent sessions; keep current agent's row if any.
    await remoteSessionService.supersedeStaleForTrajectory(tid, {
      keepAgentSessionId: runtime.sessionId,
    }).catch(() => {});

    const liveAfter = await remoteSessionService.getLiveStatus({
      trajectoryId: tid,
      preferAgentSessionId: runtime.sessionId,
    }).catch(() => null);
    if (liveAfter?.attached && liveAfter.sessionId === runtime.sessionId && liveAfter.remoteSessionId) {
      remoteSessionId = liveAfter.remoteSessionId;
      runtime.remoteSessionId = remoteSessionId;
      await remoteSessionService.mountTrajectoryRemoteSession(tid, remoteSessionId).catch(() => {});
    } else {
      // Do not reuse a superseded/closed runtime.remoteSessionId — force re-attach.
      remoteSessionId = null;
      runtime.remoteSessionId = null;
    }
  }

  if (!remoteSessionId) {
    try {
      // A prior BiB failure is retryable while the executor session remains alive.
      runtime.bibError = null;
      bibError = null;
      const attached = await remoteSessionService.attachLive({
        sessionId: runtime.sessionId,
        trajectoryId: tid,
        // quality unset → remote-bridge falls back to env BIB_STREAM_QUALITY
        viewportW: 1600,
        viewportH: 900,
      });
      remoteSessionId = attached?.remoteSession?.id ?? attached?.status?.remoteSessionId ?? null;
      runtime.remoteSessionId = remoteSessionId;
      // attachLive already mounts exclusively; keep runtime in sync
      runtime.bibError = null;
      bibError = null;
    } catch (err) {
      if (err?.statusCode === 409 || err?.code === 'grace_owned') throw err;
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
    if (preserveRecordStatus) {
      // 默认：仅连接浏览器/推流，不进入 recording 临时态；保持当前持久态。
      // recording 只由 record/start 或人工录制开启时进入。
      console.log(`[prepare] preserveRecordStatus=true for traj #${tid}; staying in ${traj?.recordStatus || 'unknown'}`);
    } else {
      // 显式 preserveRecordStatus=false：record/start 等路径需要进入 recording。
      // 进入时记录持久状态基线，非显式 stop 的释放会标为 failed(interrupted)。
      await trajectoryDao.enterTransientRecording(tid).catch((err) => {
        console.warn(`[prepare] enterTransientRecording failed for #${tid}:`, err?.message || err);
      });
    }
  }

  emitStage('login', 'running', { accountId });
  let login = { skipped: false, done: false, accountId };
  // Auth dry-run login segment: the agent performs the login itself as the
  // recorded phase — skip the prepare-time default login (incl. cold-start retry).
  // Flag is read-only here; it lives until the runtime is torn down at detach.
  // recordingInFlight: the agent owns the page during an active recording — never
  // re-login (would navigate the page and abort the in-flight recording).
  if (runtime.skipDefaultLogin || skipDefaultLogin || recordingInFlight) {
    login = { skipped: true, done: true, accountId };
    emitStage('login', 'skipped', {
      accountId,
      ...(recordingInFlight ? { reason: 'recording_in_flight' } : {}),
    });
  } else
  try {
    if (runtime.loginDone && Number(runtime.loginAccountId) === Number(accountId)) {
      login = { skipped: true, done: true, accountId };
      emitStage('login', 'skipped', { accountId });
    } else {
      // 冷启动：首屏未挂载时 login 易 label-not-found。失败后先 wait_for_loading 沉降，
      // 再指数退避重试（login-retry-heuristic），替代固定睡 8s。
      await runPrepareLoginWithColdStartRetry({
        runLogin: () => runDefaultLogin(runtime, account),
        settle: async () => {
          if (!runtime?.sessionId || !runtime?.executorNodeUuid) return;
          await runReplayActions({
            execSession,
            sessionId: runtime.sessionId,
            nodeUuid: runtime.executorNodeUuid,
            actions: [{ action: 'wait_for_loading' }],
            timeoutMs: 30000,
            stopOnFail: false,
            isReplay: true,
            abortOnSessionTerminal: true,
          });
        },
      });
      login = { skipped: false, done: true, accountId };
      emitStage('login', 'done', { accountId });
    }
  } catch (err) {
    emitStage('login', 'error', { accountId, error: err.message });
    throw err;
  }

  // ── 起点页面 ID 绑定：导航到功能菜单 → 读组件编号（读不到 AILZ 兜底）；绝不阻断 prepare ──
  // 录制进行中禁止导航/读页：bindRecordingPageId 会点菜单并可能开弹窗，直接打断在录 agent。
  try {
    if (traj?.functionId && !recordingInFlight) {
      await bindRecordingPageId({ runtime, tid, functionId: Number(traj.functionId), execSession });
    } else if (recordingInFlight) {
      console.log(`[prepare] page-bind skipped for traj #${tid} (recording in flight)`);
    }
  } catch (bindErr) {
    console.warn('[prepare] page-bind failed:', bindErr?.message || bindErr);
  }

  const fresh = await trajectoryDao.getById(tid);
  const tree = await getTrajectoryTree(tid);
  const liveStatus = await remoteSessionService.getLiveStatus({ trajectoryId: tid }).catch(() => null);

  const streamOk = !!remoteSessionId && !bibError;
  return {
    trajectoryId: tid,
    trajectory: fresh || traj,
    recordStatus: fresh?.recordStatus || traj?.recordStatus || null,
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
    reused: !!attachResult?.reused,
    reusedChrome: !!attachResult?.reusedChrome,
    ready: true,
  };
}
