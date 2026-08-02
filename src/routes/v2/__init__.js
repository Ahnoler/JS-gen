/**
 * v2 API routes — MySQL-backed (primary).
 * Legacy /api/trajectory and /api/case-data return 410 Gone.
 *
 * All JSON responses under /api/v2 use envelope: { code, message, data }.
 */
import { v2ResponseEnvelope } from '../../http/api-response.js';
import registerHierarchy from './hierarchy.js';
import registerSystemMgmt from './system-mgmt.js';
import registerTrajectoryBatch from './trajectory-batch.js';
import registerTrajectory from './trajectory.js';
import registerScreenshot from './screenshot.js';
import registerCaseData from './case-data.js';
import registerRemoteSession from './remote-session.js';
import registerApiOverride from './api-override.js';
import registerExecutor from './executor.js';
import registerReplay from './replay.js';
import registerExportMgmt from './export-mgmt.js';

export default function (app) {
  app.use('/api/v2', v2ResponseEnvelope);

  registerHierarchy(app);
  registerSystemMgmt(app);
  // batch/* before trajectories/:id
  registerTrajectoryBatch(app);
  registerTrajectory(app);
  registerScreenshot(app);
  registerCaseData(app);
  registerRemoteSession(app);
  registerApiOverride(app);
  registerExecutor(app);
  registerReplay(app);
  registerExportMgmt(app);
}
