/**
 * @deprecated Prefer system-dao with NODE_TYPE.FUNCTION.
 * Thin adapter over unified `system` table (type=2).
 */
export {
  SEED_FUNCTION_ID,
  listFunctions as listByProcess,
  getById,
  create,
  update,
  remove,
  getDefaultFunctionId,
} from './system-dao.js';
