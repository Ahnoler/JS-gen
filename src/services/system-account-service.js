import * as systemDao from '../dao/system-dao.js';
import * as systemAccountDao from '../dao/system-account-dao.js';
import { NODE_TYPE } from '../models/hierarchy-constants.js';

function normalizeAccountPatch(input = {}) {
  const data = {};
  const allowed = ['name', 'loginUrl', 'account', 'password', 'remark', 'sortOrder', 'systemId'];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined) {
      data[key] = input[key];
    }
  }
  return data;
}

/**
 * List all login accounts for a system.
 * @param {number} systemId system DB id
 * @returns {Promise<Array<object>>} account rows
 */
export async function listBySystem(systemId) {
  return systemAccountDao.listBySystem(systemId);
}

/**
 * Get a single login account by id.
 * @param {number} id account DB id
 * @returns {Promise<object|null>} account row, or null if not found
 */
export async function getAccount(id) {
  return systemAccountDao.getById(id);
}

/**
 * Create a new login account under a system.
 * @param {number} systemId system DB id
 * @param {object} input account fields (name, loginUrl, account, password, remark, sortOrder)
 * @returns {Promise<object>} created account row
 */
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
    account: input?.account || '',
    password: input?.password || '',
    remark: input?.remark ?? null,
    sortOrder: input?.sortOrder ?? 0,
  });
}

/**
 * Update an existing login account with a partial patch.
 * @param {number} id account DB id
 * @param {object} input partial account fields to update
 * @returns {Promise<object|null>} updated account row, or null if not found
 */
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

/**
 * Remove a login account by id.
 * @param {number} id account DB id
 * @returns {Promise<number>} number of deleted rows
 */
export async function removeAccount(id) {
  return systemAccountDao.remove(id);
}
