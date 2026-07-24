/**
 * Trajectory ↔ system account helpers (login context / bind account).
 * Kept separate from recording lifecycle to avoid circular imports with
 * trajectory-recording-service ↔ trajectory-service.
 */
import * as trajectoryDao from '../dao/trajectory-dao.js';
import * as systemDao from '../dao/system-dao.js';
import * as systemAccountDao from '../dao/system-account-dao.js';
import { NODE_TYPE, isRootParentId } from '../models/hierarchy-constants.js';

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
  return {
    trajectory: traj,
    account: { id: account.id, name: account.name, loginUrl: account.loginUrl || '' },
  };
}
