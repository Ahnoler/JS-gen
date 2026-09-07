/**
 * Auth recording orchestration: two-segment dry-run recording (login + logout)
 * driven as a fire-and-forget job, with pure-function URL criteria checks and
 * auth component registration on success.
 * Spec: docs/superpowers/specs/2026-09-07-auth-recording-design.md
 */
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDB } from '../../../config/database.js';
import { fromDbRow } from '../../dao/helpers.js';
import * as execSession from '../../executor-session-client.js';
import * as store from './auth-recording-store.js';
import * as trajectoryDao from '../../dao/trajectory-dao.js';
import * as trajectoryPhaseDao from '../../dao/trajectory-phase-dao.js';
import * as systemAccountDao from '../../dao/system-account-dao.js';
import { registerAuthComponent } from '../operation-component-service.js';
import { runReplayActions } from '../replay-actions.js';
import { getTrajectoryRuntime } from '../trajectory/trajectory-runtime.js';
import {
  prepareTrajectoryRecording,
  detachTrajectoryLive,
} from '../trajectory/trajectory-attach-service.js';
import { startTrajectoryRecording } from '../trajectory/trajectory-record-lifecycle.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGIN_PROMPT_PATH = path.resolve(__dirname, '../../../scripts/prompts/auth-login-prompt.md');
const LOGOUT_PROMPT_PATH = path.resolve(__dirname, '../../../scripts/prompts/auth-logout-prompt.md');

/** Poll interval while waiting for a segment's recording to finish. */
const RECORD_POLL_INTERVAL_MS = 3000;

/** Hard timeout for one recording segment (10 minutes). */
const RECORD_TIMEOUT_MS = 10 * 60 * 1000;

/** A pending/running job untouched for this long is considered stale (crashed executor) and superseded. */
const STALE_JOB_MS = 30 * 60 * 1000;

function svcError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A pending/running job whose updated_at is older than STALE_JOB_MS is treated
 * as a crash leftover (no executor heartbeat / status transition for 30 min).
 * @param {object} job auth recording job row (camelCase, updatedAt as Date|string|null)
 * @returns {boolean} true when the job is considered stale
 */
function isStaleJob(job) {
  if (!job) return false;
  const ts = job.updatedAt ?? job.updated_at;
  if (ts == null) return false;
  const time = ts instanceof Date ? ts.getTime() : Date.parse(String(ts));
  if (!Number.isFinite(time)) return false;
  return Date.now() - time > STALE_JOB_MS;
}

/**
 * Read a phase task prompt file by name.
 * @param {string} fileName prompt file under scripts/prompts/
 * @returns {string} prompt text (empty string when unreadable)
 */
function loadPrompt(fileName) {
  try {
    return readFileSync(path.resolve(__dirname, '../../../scripts/prompts', fileName), 'utf-8');
  } catch (err) {
    console.warn(`[auth-recording] prompt ${fileName} unreadable, phase task falls back to empty: ${err?.message || err}`);
    return '';
  }
}

/**
 * Normalize a URL for comparison: trim, lowercase (host is case-insensitive)
 * and strip trailing slashes.
 * @param {string|null} url raw URL
 * @returns {string} normalized URL (lowercased, trailing-slash-free)
 */
export function normalizeUrl(url) {
  return String(url ?? '').trim().toLowerCase().replace(/\/+$/, '');
}

/**
 * Pure criteria check for the login segment: after a successful login the
 * current page URL must have moved away from the login page URL.
 * @param {object|null} traj trajectory entity (uses `url` field)
 * @param {string} loginUrl system login page URL
 * @returns {boolean} true when the login criteria is satisfied
 */
export function checkLoginCriteria(traj, loginUrl) {
  const finalUrl = String(traj?.url ?? '').trim();
  if (!finalUrl) return false;
  const base = normalizeUrl(loginUrl);
  if (!base) return false;
  return normalizeUrl(finalUrl) !== base;
}

/**
 * Pure criteria check for the logout segment: after a successful logout the
 * current page URL must be back at the login page URL.
 * @param {object|null} traj trajectory entity (uses `url` field)
 * @param {string} loginUrl system login page URL
 * @returns {boolean} true when the logout criteria is satisfied
 */
export function checkLogoutCriteria(traj, loginUrl) {
  const finalUrl = String(traj?.url ?? '').trim();
  if (!finalUrl) return false;
  const base = normalizeUrl(loginUrl);
  if (!base) return false;
  return normalizeUrl(finalUrl) === base;
}

/**
 * Resolve the default system account for a system: first system_account row
 * by the account DAO's ordering. Requires non-empty account + password.
 * @param {number} systemId system node id
 * @returns {Promise<object>} account row ({ id, account, password })
 */
async function resolveDefaultAccount(systemId) {
  const rows = await systemAccountDao.listBySystem(systemId);
  const account = rows?.[0] || null;
  if (!account || !String(account.account || '').trim() || !String(account.password || '').trim()) {
    throw svcError('System has no default account with username+password — add a system account first', 400);
  }
  return account;
}

/**
 * Create one auth trajectory (with its single phase) for a segment.
 * @param {object} args segment descriptors
 * @param {number} args.functionNodeId mount function node id
 * @param {string} args.authKind 'login' or 'logout'
 * @param {string} args.name trajectory name
 * @param {string} args.phaseName phase description (「登录」/「登出」)
 * @param {string} args.task phase task prompt text
 * @param {string} args.url system login URL (trajectory.url initial value)
 * @param {number|null} args.systemAccountId bound system account id
 * @returns {Promise<number>} created trajectory id
 */
async function createAuthTrajectory({ functionNodeId, authKind, name, phaseName, task, url, systemAccountId }) {
  const tid = await trajectoryDao.save({
    name,
    task,
    url,
    functionId: functionNodeId,
    authKind,
    systemAccountId: systemAccountId ?? null,
    recordStatus: 'draft',
    isDone: 0,
    isSuccessful: null,
    stepCount: 0,
    phaseCount: 1,
  });
  await trajectoryPhaseDao.create({
    phaseId: randomUUID(),
    phaseNumber: 1,
    trajectoryId: Number(tid),
    status: 'pending',
    description: phaseName,
  });
  return Number(tid);
}

/**
 * Poll trajectory.record_status until it leaves 'recording' (or timeout).
 * Transient DB read failures / missing rows are NOT treated as "recording
 * finished" — polling continues until a confirmed status read or timeout.
 * @param {number} tid trajectory id
 * @param {number} [timeoutMs] max wait time
 * @returns {Promise<{ ok: boolean, recordStatus: string|null }>} ok=false on timeout
 */
async function waitForRecordingFinish(tid, timeoutMs = RECORD_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let recordStatus = null;
    try {
      const row = await trajectoryDao.getRecordStatusRow(tid);
      recordStatus = row?.recordStatus ?? null;
    } catch {
      recordStatus = null;
    }
    // Only a confirmed read of a non-recording status ends the wait.
    if (recordStatus != null && recordStatus !== 'recording') {
      return { ok: true, recordStatus };
    }
    if (Date.now() > deadline) {
      return { ok: false, recordStatus };
    }
    await sleep(RECORD_POLL_INTERVAL_MS);
  }
}

/**
 * Run one recording segment: prepare → (login segment only: navigate to the
 * login page via suppressed replay and arm skipDefaultLogin) → start → wait
 * finish → criteria check. Always detaches live resources afterwards.
 * @param {number} tid trajectory id
 * @param {object} opts segment options
 * @param {number|null} [opts.accountId] login account id override
 * @param {string} opts.loginUrl system login URL (criteria base)
 * @param {function(object, string): boolean} opts.criteria pure criteria function
 * @param {string} opts.segmentLabel label for error messages
 * @param {string|null} [opts.navigateUrl] when set (login segment), navigate the
 *   browser to this URL before starting the agent rehearsal and skip the
 *   prepare-time default login (one-shot runtime.skipDefaultLogin)
 * @returns {Promise<{ traj: object }>} recorded trajectory entity
 */
async function runSegment(tid, { accountId, loginUrl, criteria, segmentLabel, navigateUrl = null }) {
  await prepareTrajectoryRecording(tid);
  if (navigateUrl) {
    const runtime = getTrajectoryRuntime(tid);
    if (!runtime) {
      throw new Error(`${segmentLabel} runtime not attached after prepare`);
    }
    runtime.skipDefaultLogin = true;
    runtime.suppressStepPersist = true;
    runtime.isReplay = true;
    try {
      const { result } = await runReplayActions({
        execSession,
        sessionId: runtime.sessionId,
        nodeUuid: runtime.executorNodeUuid,
        actions: [
          { action: 'go_to_url', params: { url: navigateUrl } },
          // 演练开始前确认页面处于登录页（等待跳转/加载完成）
          { action: 'wait_for_loading' },
        ],
        timeoutMs: 120000,
        stopOnFail: true,
        isReplay: true,
      });
      const failed = Number(result?.failed || 0);
      if (result?.error || failed > 0) {
        throw new Error(result?.error || `${segmentLabel} navigate to login page failed (failed=${failed})`);
      }
    } finally {
      runtime.suppressStepPersist = false;
      runtime.isReplay = false;
    }
  }
  await startTrajectoryRecording(tid, { accountId: accountId ?? null });
  const wait = await waitForRecordingFinish(tid);
  await detachTrajectoryLive(tid, { reason: 'auth_record_segment' }).catch(() => {});
  if (!wait.ok) {
    throw new Error(`${segmentLabel} recording timed out after ${Math.round(RECORD_TIMEOUT_MS / 1000)}s`);
  }
  const traj = await trajectoryDao.getById(tid);
  if (!traj) throw new Error(`${segmentLabel} trajectory disappeared after recording`);
  if (!criteria(traj, loginUrl)) {
    throw new Error(
      `${segmentLabel} criteria not met — final url="${String(traj.url ?? '').trim()}"`,
    );
  }
  return { traj };
}

/**
 * Fire-and-forget executor: login segment → logout segment → component
 * registration ×2 → job success. Any failure marks the job failed and never
 * propagates (the caller does not await this).
 * @param {object} ctx execution context captured at start time
 * @param {number} ctx.jobId auth recording job id
 * @param {number} ctx.systemId system node id
 * @param {number|null} ctx.accountId system account id used for login
 * @param {string} ctx.account account username (component registration)
 * @param {string} ctx.password account password (component registration)
 * @param {string} ctx.loginUrl system login URL
 * @param {number} ctx.loginTid login trajectory id
 * @param {number|null} ctx.logoutTid logout trajectory id (null when creation failed)
 * @returns {Promise<void>}
 */
async function runAuthRecordingJob(ctx) {
  const { jobId, systemId, accountId, account, password, loginUrl, loginTid, logoutTid } = ctx;
  try {
    await store.updateJob(jobId, { status: 'running', updatedAt: new Date() });

    // --- Login segment ---
    try {
      await runSegment(loginTid, {
        accountId,
        loginUrl,
        criteria: checkLoginCriteria,
        segmentLabel: '登录段',
        navigateUrl: loginUrl,
      });
    } catch (err) {
      await detachTrajectoryLive(loginTid, { reason: 'auth_record_failed' }).catch(() => {});
      throw new Error(`登录段失败: ${String(err.message || err).slice(0, 2000)}`);
    }

    // --- Logout segment (skipped when login failed) ---
    if (logoutTid) {
      try {
        await runSegment(logoutTid, {
          accountId: null,
          loginUrl,
          criteria: checkLogoutCriteria,
          segmentLabel: '登出段',
        });
      } catch (err) {
        await detachTrajectoryLive(logoutTid, { reason: 'auth_record_failed' }).catch(() => {});
        throw new Error(`登出段失败: ${String(err.message || err).slice(0, 2000)}`);
      }
    }

    // --- Register auth components ---
    await registerAuthComponent({
      systemId,
      componentType: 'login',
      trajectoryId: loginTid,
      accountId,
      account,
      password,
    });
    if (logoutTid) {
      await registerAuthComponent({
        systemId,
        componentType: 'logout',
        trajectoryId: logoutTid,
        accountId,
        account,
        password,
      });
    }
    await store.updateJob(jobId, { status: 'success', error: null, updatedAt: new Date() });
  } catch (err) {
    const message = String(err?.message || err).slice(0, 4000);
    console.error(`[auth-recording] job #${jobId} failed: ${message}`);
    try {
      await store.updateJob(jobId, { status: 'failed', error: message, updatedAt: new Date() });
    } catch (updateErr) {
      console.error(`[auth-recording] job #${jobId} failure persist failed: ${updateErr?.message || updateErr}`);
    }
  }
}

/**
 * Start an auth recording job for a system: validate prerequisites, create the
 * job + mount point + two trajectories (login/logout), then kick the
 * fire-and-forget executor. Returns immediately with the job id.
 * @param {number|string} systemId system node id (type=1)
 * @param {object} [options] start options
 * @param {number|string|null} [options.accountId] explicit system account id (default: first account of the system)
 * @returns {Promise<{ jobId: number }>} created job id
 */
export async function startAuthRecording(systemId, { accountId = null } = {}) {
  const sid = Number(systemId);
  if (!Number.isFinite(sid) || sid <= 0) {
    throw svcError('systemId is required', 400);
  }

  const system = await getDB()('system').where({ id: sid }).first();
  if (!system) throw svcError(`System #${sid} not found`, 404);
  const loginUrl = String(system.url || '').trim();
  if (!loginUrl) {
    throw svcError('System url is empty — set system.url before auth recording', 400);
  }

  const existing = await store.latestJobForSystem(sid);
  if (existing && (existing.status === 'pending' || existing.status === 'running')) {
    if (isStaleJob(existing)) {
      // Crash leftover: mark stale job failed and allow a new trigger.
      await store.updateJob(existing.id, {
        status: 'failed',
        error: 'stale job superseded',
        updatedAt: new Date(),
      }).catch(() => {});
    } else {
      throw svcError(`Auth recording job #${existing.id} is already ${existing.status} for this system`, 409);
    }
  }

  let account = null;
  if (accountId != null && accountId !== '') {
    account = await systemAccountDao.getById(Number(accountId));
    if (!account || Number(account.systemId) !== sid) {
      throw svcError(`Account #${accountId} not found for system #${sid}`, 400);
    }
    if (!String(account.account || '').trim() || !String(account.password || '').trim()) {
      throw svcError('Selected account has empty username or password', 400);
    }
  } else {
    account = await resolveDefaultAccount(sid);
  }

  const job = await store.createJob({ systemId: sid, accountId: account.id });

  let functionNodeId = null;
  let loginTid = null;
  let logoutTid = null;
  try {
    const mount = await store.ensureMountPoint(sid);
    functionNodeId = mount.functionNodeId;
    loginTid = await createAuthTrajectory({
      functionNodeId,
      authKind: 'login',
      name: '登录演练',
      phaseName: '登录',
      task: loadPrompt('auth-login-prompt.md'),
      url: loginUrl,
      systemAccountId: account.id,
    });
    logoutTid = await createAuthTrajectory({
      functionNodeId,
      authKind: 'logout',
      name: '登出演练',
      phaseName: '登出',
      task: loadPrompt('auth-logout-prompt.md'),
      url: loginUrl,
      systemAccountId: account.id,
    });
    await store.updateJob(job.id, {
      loginTrajectoryId: loginTid,
      logoutTrajectoryId: logoutTid,
      updatedAt: new Date(),
    });
  } catch (err) {
    await store.updateJob(job.id, {
      status: 'failed',
      error: `prepare failed: ${String(err?.message || err).slice(0, 4000)}`,
      updatedAt: new Date(),
    }).catch(() => {});
    throw err;
  }

  // Fire-and-forget: executor owns all errors (never throws into the caller).
  runAuthRecordingJob({
    jobId: job.id,
    systemId: sid,
    accountId: account.id,
    account: String(account.account || ''),
    password: String(account.password || ''),
    loginUrl,
    loginTid,
    logoutTid,
  }).catch((err) => {
    console.error(`[auth-recording] job #${job.id} executor escaped: ${err?.message || err}`);
  });

  return { jobId: job.id };
}

/**
 * Latest auth recording status for a system: latest job plus lightweight
 * summaries of the login/logout trajectories (id / recordStatus / stepCount).
 * @param {number|string} systemId system node id
 * @returns {Promise<{ job: object|null, loginTrajectory: object|null, logoutTrajectory: object|null }>} status payload
 */
export async function getAuthRecordingStatus(systemId) {
  const sid = Number(systemId);
  if (!Number.isFinite(sid) || sid <= 0) {
    throw svcError('systemId is required', 400);
  }
  const job = await store.latestJobForSystem(sid);
  const summarize = async (tid) => {
    if (tid == null) return null;
    const row = await getDB()('trajectory')
      .where({ id: Number(tid) })
      .first('id', 'record_status', 'step_count', 'auth_kind');
    return row
      ? {
        id: Number(row.id),
        recordStatus: row.record_status,
        stepCount: Number(row.step_count) || 0,
        authKind: row.auth_kind ?? null,
      }
      : null;
  };
  return {
    job,
    loginTrajectory: await summarize(job?.loginTrajectoryId ?? job?.login_trajectory_id ?? null),
    logoutTrajectory: await summarize(job?.logoutTrajectoryId ?? job?.logout_trajectory_id ?? null),
  };
}
