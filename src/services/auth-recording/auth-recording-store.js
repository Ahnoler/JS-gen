/**
 * Auth recording store: job DAO for `auth_recording_jobs` plus the fixed
 * hierarchy mount point (系统 → 自动化任务 → 登录与登出) ensure helper.
 * Spec: docs/superpowers/specs/2026-09-07-auth-recording-design.md
 */
import { getDB } from '../../../config/database.js';
import { toDbRow, fromDbRow, fromDbRows } from '../../dao/helpers.js';
import * as hierarchyService from '../hierarchy-service.js';
import { NODE_TYPE } from '../../models/hierarchy-constants.js';

const TABLE = 'auth_recording_jobs';

/** Mount module node name under a system (type=2). */
const MOUNT_MODULE_NAME = '自动化任务';

/** Mount function node name under the mount module (type=3). */
const MOUNT_FUNCTION_NAME = '登录与登出';

/**
 * Create a pending auth recording job.
 * @param {{ systemId: number|string, accountId?: number|string|null }} params job scope
 * @returns {Promise<{ id: number }>} created job id
 */
export async function createJob({ systemId, accountId = null }) {
  const [id] = await getDB()(TABLE).insert(toDbRow({
    systemId: Number(systemId),
    accountId: accountId == null ? null : Number(accountId),
    status: 'pending',
  }));
  return { id };
}

/**
 * Fetch a single auth recording job by id.
 * @param {number} id job primary key
 * @returns {Promise<object|null>} job entity (camelCase) or null when not found
 */
export async function getJobById(id) {
  const row = await getDB()(TABLE).where({ id }).first();
  return fromDbRow(row);
}

/**
 * Latest auth recording job for a system (by id desc; newer jobs win).
 * @param {number} systemId system tree node id (type=1)
 * @returns {Promise<object|null>} newest job entity or null when none exists
 */
export async function latestJobForSystem(systemId) {
  const row = await getDB()(TABLE)
    .where({ system_id: Number(systemId) })
    .orderBy([{ column: 'id', order: 'desc' }])
    .first();
  return fromDbRow(row);
}

/**
 * Update an auth recording job by id (partial fields; camelCase keys).
 * @param {number} id job primary key
 * @param {object} fields partial camelCase fields (status/error/loginTrajectoryId/logoutTrajectoryId...)
 * @returns {Promise<void>} resolves when the update completes
 */
export async function updateJob(id, fields) {
  await getDB()(TABLE).where({ id }).update(toDbRow(fields));
}

/**
 * Find-or-create the fixed mount point under a system:
 * 系统(type=1) → 自动化任务(type=2) → 登录与登出(type=3).
 * @param {number} systemId system tree node id (type=1)
 * @returns {Promise<{ functionNodeId: number }>} function node id for trajectory.function_id
 */
export async function ensureMountPoint(systemId) {
  const parentId = Number(systemId);
  const children = await hierarchyService.listNodes({ parentId });
  let mod = children.find((n) => Number(n.type) === NODE_TYPE.MODULE && n.name === MOUNT_MODULE_NAME);
  if (!mod) {
    mod = await hierarchyService.createNode({ parentId, type: NODE_TYPE.MODULE, name: MOUNT_MODULE_NAME });
  }
  const subs = await hierarchyService.listNodes({ parentId: Number(mod.id) });
  let fn = subs.find((n) => Number(n.type) === NODE_TYPE.FUNCTION && n.name === MOUNT_FUNCTION_NAME);
  if (!fn) {
    fn = await hierarchyService.createNode({ parentId: Number(mod.id), type: NODE_TYPE.FUNCTION, name: MOUNT_FUNCTION_NAME });
  }
  return { functionNodeId: Number(fn.id) };
}
