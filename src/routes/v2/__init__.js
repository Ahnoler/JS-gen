/**
 * v2 API routes — all use database-backed services.
 * Old /api/* routes remain untouched for backward compatibility.
 */
import registerHierarchy from './hierarchy.js';
import registerTrajectory from './trajectory.js';
import registerScreenshot from './screenshot.js';
import registerCaseData from './case-data.js';
import registerRemoteSession from './remote-session.js';
import registerApiOverride from './api-override.js';

export default function (app) {
  registerHierarchy(app);
  registerTrajectory(app);
  registerScreenshot(app);
  registerCaseData(app);
  registerRemoteSession(app);
  registerApiOverride(app);
}
