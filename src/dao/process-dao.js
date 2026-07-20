/**
 * @deprecated Prefer system-dao with NODE_TYPE.PROCESS.
 * Thin adapter over unified `system` table (type=2).
 */
export {
  SEED_PROCESS_ID,
  listProcesses as listBySystem,
  getById,
  create,
  update,
  remove,
} from './system-dao.js';
