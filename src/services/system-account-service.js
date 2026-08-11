import * as systemDao from '../dao/system-dao.js';
import * as systemAccountDao from '../dao/system-account-dao.js';
import { NODE_TYPE } from '../models/hierarchy-constants.js';

function normalizeAccountPatch(input = {}) {
  const data = {};
  const allowed = ['name', 'loginUrl', 'username', 'password', 'remark', 'sortOrder', 'systemId'];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined) {
      data[key] = input[key];
    }
  }
  return data;
}

export async function listBySystem(systemId) {
  return systemAccountDao.listBySystem(systemId);
}

export async function getAccount(id) {
  return systemAccountDao.getById(id);
}

export async function createAccount(systemId, input) {
  const sys = await systemDao.getById(systemId);
  if (!sys || sys.type !== NODE_TYPE.SYSTEM) {
    throw Object.assign(new Error('System not found'), { code: 'NOT_FOUND' });
  }

  const name = (input?.name || '').trim();
  if (!name) throw Object.assign(new Error('name is required'), { code: 'VALIDATION' });

  return systemAccountDao.create({
    systemId: +systemId,
    name,
    loginUrl: input?.loginUrl || '',
    username: input?.username || '',
    password: input?.password || '',
    remark: input?.remark ?? null,
    sortOrder: input?.sortOrder ?? 0,
  });
}

export async function updateAccount(id, input) {
  const existing = await systemAccountDao.getById(id);
  if (!existing) return null;

  const patch = normalizeAccountPatch(input);
  if (patch.name != null) {
    patch.name = String(patch.name).trim();
    if (!patch.name) throw Object.assign(new Error('name is required'), { code: 'VALIDATION' });
  }
  if (!Object.keys(patch).length) return existing;
  return systemAccountDao.update(id, patch);
}

export async function removeAccount(id) {
  return systemAccountDao.remove(id);
}
