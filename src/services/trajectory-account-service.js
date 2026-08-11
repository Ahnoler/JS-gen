/**
 * Trajectory ↔ system account helpers (login context / bind account).
 * Kept separate from recording lifecycle to avoid circular imports with
 * trajectory-recording-service ↔ trajectory-service.
 */
import * as trajectoryDao from '../dao/trajectory-dao.js';
import * as systemDao from '../dao/system-dao.js';
import * as systemAccountDao from '../dao/system-account-dao.js';
import { NODE_TYPE, isRootParentId, isRootNodeId } from '../models/hierarchy-constants.js';

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
 * Climb function → module → … until owning system (type=1), or the top-level
 * node hanging under 根 (parent_id=0). Tolerates mislabeled types from older data.
 * @param {number} startId
 * @returns {Promise<{ system: object|null, chain: object[] }>}
 */
export async function resolveOwningSystem(startId) {
  const sid = Number(startId);
  if (!Number.isFinite(sid)) return { system: null, chain: [] };

  let cur = await systemDao.getById(sid);
  const guard = new Set();
  const chain = [];

  while (cur && !guard.has(Number(cur.id))) {
    guard.add(Number(cur.id));
    chain.push(cur);

    if (isRootNodeId(cur.id) || Number(cur.type) === NODE_TYPE.ROOT) {
      // Should not treat 根 itself as a login system
      cur = null;
      break;
    }
    if (Number(cur.type) === NODE_TYPE.SYSTEM) break;
    // Top-level under 根 — product treats this as the owning system node
    // (even if type was historically mislabeled as 模块)
    if (isRootParentId(cur.parentId)) break;

    const pid = Number(cur.parentId);
    if (!Number.isFinite(pid)) {
      cur = null;
      break;
    }
    cur = await systemDao.getById(pid);
  }

  if (!cur || isRootNodeId(cur.id) || Number(cur.type) === NODE_TYPE.ROOT) {
    return { system: null, chain };
  }
  return { system: cur, chain };
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
  const systemAccountId = traj.systemAccountId != null ? Number(traj.systemAccountId) : null;

  if (!Number.isFinite(functionId)) {
    // No function binding — still try account → system so UI can list siblings
    if (Number.isFinite(systemAccountId) && systemAccountId > 0) {
      const viaAccount = await _systemFromAccount(systemAccountId);
      if (viaAccount) {
        const accounts = await _accountsForSystem(viaAccount);
        return {
          trajectoryId: tid,
          functionId: null,
          systemAccountId,
          system: _shapeSystem(viaAccount),
          accounts,
        };
      }
    }
    return {
      trajectoryId: tid,
      functionId: null,
      systemAccountId: Number.isFinite(systemAccountId) ? systemAccountId : null,
      system: null,
      accounts: [],
      error: 'Trajectory has no functionId — bind to a function node under a system first',
    };
  }

  let { system } = await resolveOwningSystem(functionId);

  // Fallback: bound account's system_id (same path prepare/login already uses)
  if (!system && Number.isFinite(systemAccountId) && systemAccountId > 0) {
    system = await _systemFromAccount(systemAccountId);
  }

  if (!system) {
    return {
      trajectoryId: tid,
      functionId,
      systemAccountId: Number.isFinite(systemAccountId) ? systemAccountId : null,
      system: null,
      accounts: [],
      error: 'Could not resolve system for function',
    };
  }

  const accounts = await _accountsForSystem(system);
  return {
    trajectoryId: tid,
    functionId,
    systemAccountId: Number.isFinite(systemAccountId) ? systemAccountId : null,
    system: _shapeSystem(system),
    accounts,
  };
}

function _shapeSystem(cur) {
  return {
    id: cur.id,
    name: cur.name,
    uid: cur.uid || cur.systemId,
    description: cur.description || null,
    url: cur.url || '',
  };
}

async function _systemFromAccount(accountId) {
  const account = await systemAccountDao.getById(accountId);
  if (!account?.systemId) return null;
  const sys = await systemDao.getById(account.systemId);
  if (!sys || isRootNodeId(sys.id) || Number(sys.type) === NODE_TYPE.ROOT) return null;
  return sys;
}

async function _accountsForSystem(cur) {
  return (await systemAccountDao.listBySystem(cur.id)).map((a) => ({
    id: a.id,
    name: a.name,
    loginUrl: a.loginUrl || cur.url || '',
    username: a.username || '',
    password: a.password || '',
    remark: a.remark || null,
    sortOrder: a.sortOrder ?? 0,
  }));
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

/**
 * Validate functionId + systemAccountId before creating any trajectory
 * (batch import). Ensures function exists and account belongs to owning system.
 */
export async function validateFunctionAndAccount(functionId, systemAccountId) {
  const fid = Number(functionId);
  const aid = Number(systemAccountId);
  if (!Number.isFinite(fid) || fid <= 0) {
    const err = new Error('functionId is required');
    err.statusCode = 400;
    throw err;
  }
  if (!Number.isFinite(aid) || aid <= 0) {
    const err = new Error('systemAccountId is required');
    err.statusCode = 400;
    throw err;
  }

  const fnNode = await systemDao.getById(fid);
  if (!fnNode) {
    const err = new Error(`Function #${fid} not found`);
    err.statusCode = 404;
    throw err;
  }
  if (Number(fnNode.type) !== NODE_TYPE.FUNCTION) {
    const err = new Error(`Node #${fid} is not a function`);
    err.statusCode = 400;
    throw err;
  }

  const account = await systemAccountDao.getById(aid);
  if (!account) {
    const err = new Error(`System account #${aid} not found`);
    err.statusCode = 404;
    throw err;
  }

  const { system } = await resolveOwningSystem(fid);
  if (!system) {
    const err = new Error('Could not resolve system for function');
    err.statusCode = 400;
    throw err;
  }
  if (Number(account.systemId) !== Number(system.id)) {
    const err = new Error('Selected account does not belong to this function system');
    err.statusCode = 400;
    throw err;
  }

  return {
    functionId: fid,
    systemAccountId: aid,
    function: fnNode,
    account,
    system: _shapeSystem(system),
  };
}
