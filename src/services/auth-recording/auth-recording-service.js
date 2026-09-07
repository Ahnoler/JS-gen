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
 * Poll interval while waiting for a trajectory's recorded steps to hit the DB.
 */
const STEP_POLL_INTERVAL_MS = 5000;

/** Max wait for trajectory_step rows to appear after recording ends. */
const STEP_POLL_TIMEOUT_MS = 60 * 1000;

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
 * current page URL must have moved away from the login page URL. Only the live
 * page URL captured at recording end is authoritative — when it is unavailable
 * the segment is NOT judged as passed (no trajectory `url` fallback: traj.url
 * keeps the segment's start URL and would always differ from loginUrl).
 * @param {object|null} traj trajectory entity (unused; kept for signature compat)
 * @param {string} loginUrl system login page URL
 * @param {string|null} [liveUrl] live browser page URL read at recording end
 * @returns {boolean} true when the login criteria is satisfied
 */
export function checkLoginCriteria(traj, loginUrl, liveUrl = null) {
  const finalUrl = String(liveUrl ?? '').trim();
  if (!finalUrl) return false;
  const base = normalizeUrl(loginUrl);
  if (!base) return false;
  return normalizeUrl(finalUrl) !== base;
}

/**
 * Pure criteria check for the logout segment: after a successful logout the
 * current page URL must be back at the login page URL. Only the live page URL
 * captured at recording end is authoritative — when it is unavailable the
 * segment is NOT judged as passed (no trajectory `url` fallback: traj.url is
 * the loginUrl itself, so the fallback would always falsely pass).
 * @param {object|null} traj trajectory entity (unused; kept for signature compat)
 * @param {string} loginUrl system login page URL
 * @param {string|null} [liveUrl] live browser page URL read at recording end
 * @returns {boolean} true when the logout criteria is satisfied
 */
export function checkLogoutCriteria(traj, loginUrl, liveUrl = null) {
  const finalUrl = String(liveUrl ?? '').trim();
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
 * Inject job credentials into a phase task prompt: the prompt templates carry
 * `__AUTH_USERNAME__` / `__AUTH_PASSWORD__` placeholders (never literal
 * credentials); replace them with the resolved system account values.
 * @param {string} promptText prompt template text
 * @param {string} account account username
 * @param {string} password account password
 * @returns {string} prompt text with placeholders substituted
 */
function injectAuthCredentials(promptText, account, password) {
  const replaced = String(promptText ?? '')
    .replaceAll('__AUTH_USERNAME__', String(account ?? ''))
    .replaceAll('__AUTH_PASSWORD__', String(password ?? ''));
  if (replaced.includes('__AUTH_USERNAME__') || replaced.includes('__AUTH_PASSWORD__')) {
    throw svcError('auth prompt still contains credential placeholders after injection', 500);
  }
  return replaced;
}

/**
 * Build the canonical auth segment texts following the analyze-pipeline
 * conventions (trajectory-text-extract.js parse contract + analyze prompt
 * format in trajectory-meta-service.js): trajectory.task = requirement full
 * text (numbered steps + 业务数据 KV block + 【硬性成功门闩】constraints);
 * phase description = single line「{操作}。预期结果：{可见结果}」.
 * Login segment additionally keeps the credential values inline in the
 * description — the executor skips business-data hints for login phases
 * (scripts/agent/service.py "Skip business-data hint (phase is not
 * fill/introduce)"), so the inline value is the only guaranteed channel.
 * @param {object} args segment descriptors
 * @param {'login'|'logout'} args.authKind segment kind
 * @param {string} args.task prompt-template text with placeholders already
 *   injected (used only for provenance length checks; canonical texts are
 *   composed here)
 * @param {string} args.account account username (injected value)
 * @param {string} args.password account password (injected value)
 * @returns {{ task: string, description: string }} canonical task + phase description
 */
function buildCanonicalAuthTexts({ authKind, task, account, password }) {
  void task;
  void account;
  void password;
  if (authKind === 'login') {
    const description = '三步登录：用 fill_form_field 填写账号与密码（值使用业务数据注入值，验证码留空），再点击登录按钮完成登录。预期结果：离开登录页进入系统首页。';
    const text = [
      '1、在登录页依次完成：输入账号 → 输入密码 → 点击登录。',
      '账号/密码经业务数据通道注入（键=账号、密码，用 read_business_data 读取），禁止编造或尝试其他任何账号。',
      '',
      '【硬性成功门闩——任一门闩未满足不得结束本阶段】',
      '- 凭据只使用业务数据注入值（read_business_data 键=账号/密码），禁止编造或尝试其他任何账号（如 admin 类）。',
      '- 验证码/短信验证码字段留空不填；出现验证码拦截：不要猜测或绕过，立即如实报告「出现验证码，无法自动登录」并退出。',
      '- 登录失败（错误提示、仍在登录页）时如实报告失败原因，不得伪造成功、不得重试超过 2 次。',
    ].join('\n');
    return { task: text, description };
  }
  const description = '找到登出入口并真实点击登出（常见右上角头像/用户名下拉的退出项，确认弹窗点确定）。预期结果：回到登录页。';
  const text = [
    '1、找到登出入口并真实点击登出（常见右上角头像/用户名下拉的退出项，确认弹窗点确定）。',
    '',
    '【硬性成功门闩——任一门闩未满足不得结束本阶段】',
    '- 未回到登录页不得 done：验证已出现账号/密码输入框才算成功。',
    '- 找不到登出入口时如实报告「未找到登出入口」，不得伪造成功。',
  ].join('\n');
  return { task: text, description };
}

/**
 * Create one auth trajectory (with its single phase) for a segment.
 * @param {object} args segment descriptors
 * @param {number} args.functionNodeId mount function node id
 * @param {string} args.authKind 'login' or 'logout'
 * @param {string} args.name trajectory name
 * @param {string} args.task phase task prompt text (credential-injected template);
 *   the canonical task/description pair is composed in buildCanonicalAuthTexts —
 *   the agent's task channel is phase.description (trajectory-recording-runner
 *   passes `instruction: phase.description`)
 * @param {string} args.account account username (injected value)
 * @param {string} args.password account password (injected value)
 * @param {string} args.url system login URL (trajectory.url initial value)
 * @param {number|null} args.systemAccountId bound system account id
 * @returns {Promise<number>} created trajectory id
 */
async function createAuthTrajectory({ functionNodeId, authKind, name, task, account, password, url, systemAccountId }) {
  const canonical = buildCanonicalAuthTexts({ authKind, task, account, password });
  const tid = await trajectoryDao.save({
    name,
    task: canonical.task,
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
    description: canonical.description,
  });
  // Credentials are injected through the business-data channel, NOT the task
  // text (trajectory.task is free text served by trajectory search/detail APIs
  // — persisting the password there would leak it). Seeded here so
  // prepareBusinessDataInjection picks the flat entries up at record time.
  if (authKind === 'login') {
    const { replaceEntriesForTrajectory } = await import('../../dao/business-data-dao.js');
    await replaceEntriesForTrajectory(Number(tid), [
      { fieldKey: '账号', fieldValue: String(account ?? '') },
      { fieldKey: '密码', fieldValue: String(password ?? '') },
    ]);
  }
  return Number(tid);
}

/**
 * Mask the account password inside a trajectory's persisted step params
 * (auth-recording login steps contain the real password in `login` action
 * params; the component snapshot is masked separately at registration).
 * Replaces exact password occurrences with the __AUTH_PASSWORD__ placeholder
 * so a re-registration from the masked trajectory still resolves.
 * @param {number} tid trajectory id
 * @param {string} password real account password to scrub
 * @returns {Promise<void>}
 */
/**
 * Mask the account password inside a trajectory's persisted step params
 * (auth-recording login steps contain the real password in `login` action
 * params; the component snapshot is masked separately at registration).
 * Walks each step's parsed params object and replaces string values exactly
 * equal to the password with the __AUTH_PASSWORD__ placeholder — exact-value
 * matching keeps short passwords (e.g. "1") from corrupting other content,
 * and a re-registration from the masked trajectory still resolves.
 * @param {number} tid trajectory id
 * @param {string} password real account password to scrub
 * @returns {Promise<void>}
 */
async function maskTrajectoryStepSecrets(tid, password) {
  const pwd = String(password ?? '');
  if (!pwd) return;
  const db = getDB();
  const rows = await db('trajectory_step')
    .where('trajectory_id', Number(tid))
    .select('id', 'params_json');
  for (const row of rows) {
    const raw = row.params_json;
    let obj = raw;
    if (typeof obj === 'string') {
      try { obj = JSON.parse(obj); } catch { continue; }
    }
    if (!obj || typeof obj !== 'object') continue;
    let changed = false;
    const walk = (node) => {
      if (Array.isArray(node)) {
        node.forEach((v, i) => {
          if (typeof v === 'string' && v === pwd) { node[i] = '__AUTH_PASSWORD__'; changed = true; }
          else if (v && typeof v === 'object') walk(v);
        });
      } else if (node && typeof node === 'object') {
        for (const k of Object.keys(node)) {
          const v = node[k];
          if (typeof v === 'string' && v === pwd) { node[k] = '__AUTH_PASSWORD__'; changed = true; }
          else if (v && typeof v === 'object') walk(v);
        }
      }
    };
    walk(obj);
    if (!changed) continue;
    await db('trajectory_step').where('id', row.id).update({
      params_json: JSON.stringify(obj),
    });
  }
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
 * Read the live page URL of the recording session via the executor's existing
 * `list_tabs` event channel (tabs_result carries each tab's url; the active
 * tab matches the browser's current page). Read-only — no CDP pipeline here.
 * @param {object|null} runtime trajectory runtime (sessionId / executorNodeUuid)
 * @param {number} [timeoutMs] wait timeout for tabs_result
 * @returns {Promise<string|null>} current page URL, or null when unavailable
 */
async function readLivePageUrl(runtime, timeoutMs = 15000) {
  if (!runtime?.sessionId || !runtime?.executorNodeUuid) return null;
  try {
    const resultP = execSession.waitForSessionEvent(runtime.sessionId, 'tabs_result', timeoutMs);
    execSession.forwardStdin({
      nodeUuid: runtime.executorNodeUuid,
      sessionId: runtime.sessionId,
      event: 'list_tabs',
      data: {},
    });
    const result = await resultP;
    const tabs = Array.isArray(result?.tabs) ? result.tabs : [];
    if (!tabs.length) return null;
    const activeId = result?.activePageId;
    const active = tabs.find((t) => String(t.pageId) === String(activeId)) || tabs[0];
    return String(active?.url || '').trim() || null;
  } catch (err) {
    console.warn(`[auth-recording] readLivePageUrl failed: ${err?.message || err}`);
    return null;
  }
}

/**
 * Read the live page URL with one retry: the executor's tabs_result can be
 * slow to arrive (observed timeouts on real SUT), so a first null/timeout
 * result is retried once before giving up.
 * @param {object|null} runtime trajectory runtime (sessionId / executorNodeUuid)
 * @returns {Promise<string|null>} current page URL, or null after both attempts
 */
async function readLivePageUrlWithRetry(runtime) {
  const first = await readLivePageUrl(runtime);
  if (first != null) return first;
  console.warn('[auth-recording] readLivePageUrl first attempt failed — retrying once');
  return readLivePageUrl(runtime);
}

/**
 * Poll trajectory_step row count until > 0 (or timeout). The recording gate's
 * async finalize can land steps in the DB slightly after record_status leaves
 * 'recording'; registerAuthComponent would otherwise race and reject a valid
 * segment with "no steps". Also catches a genuinely empty (0-step) segment.
 * @param {number} tid trajectory id
 * @param {number} [timeoutMs] max wait time (default 60s)
 * @returns {Promise<number>} final step count (> 0 on success)
 */
async function waitForTrajectorySteps(tid, timeoutMs = STEP_POLL_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let count = 0;
    try {
      const row = await getDB()('trajectory_step')
        .where({ trajectory_id: Number(tid) })
        .count('* as c')
        .first();
      count = Number(row?.c ?? row?.count ?? 0) || 0;
    } catch (err) {
      console.warn(`[auth-recording] step count poll failed for #${tid}: ${err?.message || err}`);
      count = 0;
    }
    if (count > 0) return count;
    if (Date.now() > deadline) return 0;
    await sleep(STEP_POLL_INTERVAL_MS);
  }
}

/**
 * Run one recording segment: prepare → (login segment only: navigate to the
 * login page via suppressed replay and arm skipDefaultLogin) → start → wait
 * finish → read live page URL → criteria check. Always detaches live
 * resources afterwards.
 * @param {number} tid trajectory id
 * @param {object} opts segment options
 * @param {number|null} [opts.accountId] login account id override
 * @param {string} opts.loginUrl system login URL (criteria base)
 * @param {function(object, string): boolean} opts.criteria pure criteria function
 * @param {string} opts.segmentLabel label for error messages
 * @param {string|null} [opts.navigateUrl] when set (login segment), navigate the
 *   browser to this URL before starting the agent rehearsal and skip the
 *   prepare-time default login (both via prepare opts and one-shot
 *   runtime.skipDefaultLogin as double insurance)
 * @returns {Promise<{ traj: object }>} recorded trajectory entity
 */
async function runSegment(tid, { accountId, loginUrl, criteria, segmentLabel, navigateUrl = null }) {
  // The runtime object only exists after prepare creates it, so the
  // skipDefaultLogin flag must be threaded through prepare itself — setting
  // runtime.skipDefaultLogin here would race the prepare-time default login.
  await prepareTrajectoryRecording(tid, navigateUrl ? { skipDefaultLogin: true } : undefined);
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
  // The agent closes its browser right after done(), so a post-finish
  // list_tabs read races the session teardown and intermittently times out
  // (observed on jobs #14/#23/#25). Poll the live URL during the recording
  // and keep the last successful read as fallback evidence — the agent's
  // done() only fires after it verified the final page, so the last polled
  // URL is the final state.
  let lastLiveUrl = null;
  let pollBusy = false;
  const liveUrlPoller = setInterval(() => {
    if (pollBusy) return;
    pollBusy = true;
    const runtime = getTrajectoryRuntime(tid);
    readLivePageUrl(runtime, 4000)
      .then((u) => { if (u) lastLiveUrl = u; })
      .catch(() => {})
      .finally(() => { pollBusy = false; });
  }, 5000);
  const wait = await waitForRecordingFinish(tid);
  clearInterval(liveUrlPoller);
  // Capture the live page URL while the browser is still attached (trajectory
  // `url` keeps the segment's start URL and never tracks navigation).
  let liveUrl = null;
  if (wait.ok) {
    liveUrl = await readLivePageUrlWithRetry(getTrajectoryRuntime(tid));
    if (liveUrl == null) liveUrl = lastLiveUrl;
  }
  await detachTrajectoryLive(tid, { reason: 'auth_record_segment' }).catch(() => {});
  if (!wait.ok) {
    throw new Error(`${segmentLabel} recording timed out after ${Math.round(RECORD_TIMEOUT_MS / 1000)}s`);
  }
  // Async gate finalize may persist steps slightly after recording ends; wait
  // for them before component registration. Also rejects genuinely 0-step runs.
  const stepCount = await waitForTrajectorySteps(tid);
  if (stepCount <= 0) {
    throw new Error(`${segmentLabel} recording produced no steps within ${Math.round(STEP_POLL_TIMEOUT_MS / 1000)}s after recording finished`);
  }
  const traj = await trajectoryDao.getById(tid);
  if (!traj) throw new Error(`${segmentLabel} trajectory disappeared after recording`);
  if (liveUrl == null) {
    // liveUrl unavailable is NOT judged via traj.url fallback (it equals
    // loginUrl for the logout segment and start URL for login) — fail the
    // segment explicitly as undeterminable.
    throw new Error(`${segmentLabel} criteria undeterminable — live page URL unavailable (live-url unavailable), traj.url="${String(traj.url ?? '').trim()}" not used as evidence`);
  }
  if (!criteria(traj, loginUrl, liveUrl)) {
    throw new Error(
      `${segmentLabel} criteria not met — final url="${String(liveUrl ?? traj.url ?? '').trim()}"`,
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
    // Component registration reads the real password; scrub the source
    // trajectory's persisted step params afterwards (never re-read for replay).
    await maskTrajectoryStepSecrets(loginTid, password);
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
      // credential-injected prompt template kept as provenance; canonical
      // task/description pair is composed in buildCanonicalAuthTexts
      task: injectAuthCredentials(loadPrompt('auth-login-prompt.md'), account.account, account.password),
      account: account.account,
      password: account.password,
      url: loginUrl,
      systemAccountId: account.id,
    });
    logoutTid = await createAuthTrajectory({
      functionNodeId,
      authKind: 'logout',
      name: '登出演练',
      task: injectAuthCredentials(loadPrompt('auth-logout-prompt.md'), account.account, account.password),
      account: account.account,
      password: account.password,
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
