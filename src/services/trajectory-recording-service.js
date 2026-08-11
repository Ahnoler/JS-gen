/**
 * Trajectory recording facade — re-exports focused modules.
 * Prefer importing from the specific module when adding new call sites.
 */
export {
  getTrajectoryRuntime,
  getAllTrajectoryRuntimes,
  touchTrajectoryRuntimeActivity,
  clearTrajectoryRuntimesForNode,
} from './trajectory-runtime.js';

export {
  prepareTrajectoryRecording,
  attachTrajectoryLive,
  detachTrajectoryLive,
  detachTrajectoryStream,
  bindTrajectoryManualPersist,
  cleanupPersistedTrajectoryResources,
} from './trajectory/trajectory-attach-service.js';

export {
  startTrajectoryRecording,
  stopTrajectoryRecording,
  stopTrajectoryRecordingSafe,
  resolveTrajectoryElement,
  toggleTrajectoryManualRecord,
  runDefaultLogin,
} from './trajectory/trajectory-record-lifecycle.js';

export {
  replayTrajectorySteps,
  acceptTrajectoryStepsReplay,
  stopTrajectoryStepsReplay,
} from './trajectory/trajectory-session-replay.js';
