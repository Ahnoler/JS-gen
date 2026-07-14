/**
 * Entity models — JSDoc types aligned with MySQL tables.
 *
 * @example
 * import { stepFromActionLog } from './models/index.js';
 * /** @type {import('./models/index.js').Trajectory} *\/
 * const traj = await trajectoryDao.getByTrajectoryId(id);
 */

export * from './constants.js';
export * from './helpers.js';

// Side-effect import: registers @typedef exports for IDE / JSDoc consumers
import './entities.js';
