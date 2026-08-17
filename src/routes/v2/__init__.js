/**
 * v2 API routes — MySQL-backed (primary).
 * Legacy /api/trajectory and /api/case-data return 410 Gone.
 *
 * All JSON responses under /api/v2 use envelope: { code, message, data }.
 */
import { v2ResponseEnvelope } from '../../http/api-response.js';
import { ssoAuth } from '../../middleware/sso-auth.js';
import registerAuth from './auth.js';
import registerHierarchy from './hierarchy.js';
import registerSystemMgmt from './system-mgmt.js';
import registerSysDict from './sys-dict.js';
import registerMessages from './messages.js';
import registerSpecialElement from './special-element.js';
import registerTrajectoryBatch from './trajectory-batch.js';
import registerAgentStderr from './agent-stderr.js';
import registerTrajectory from './trajectory.js';
import registerTrajectoryRecord from './trajectory-record.js';
import registerTrajectorySteps from './trajectory-steps.js';
import registerScreenshot from './screenshot.js';
import registerCaseData from './case-data.js';
import registerSystemRefData from './system-ref-data.js';
import registerRemoteSession from './remote-session.js';
import registerApiOverride from './api-override.js';
import registerExecutor from './executor.js';
import registerExportMgmt from './export-mgmt.js';
import registerMemory from './memory.js';
import registerOperationComponent from './operation-component.js';
import registerRegions from './regions.js';

export default function (app) {
  app.use('/api/v2', v2ResponseEnvelope);
  app.use('/api/v2', ssoAuth);
  registerAuth(app);

  registerHierarchy(app);
  registerSystemMgmt(app);
  registerSysDict(app);
  registerMessages(app);
  registerSpecialElement(app);
  // batch/* before trajectories/:id
  registerTrajectoryBatch(app);
  registerAgentStderr(app);
  registerTrajectory(app);
  registerTrajectoryRecord(app);
  registerTrajectorySteps(app);
  registerScreenshot(app);
  registerCaseData(app);
  registerSystemRefData(app);
  registerOperationComponent(app);
  registerRemoteSession(app);
  registerApiOverride(app);
  registerExecutor(app);
  registerExportMgmt(app);
  registerMemory(app);
  registerRegions(app);
}
