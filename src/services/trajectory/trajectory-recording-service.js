/**
 * Public trajectory recording facade.
 *
 * Re-exports runtime, attachment, lifecycle, manual-recording, and replay
 * operations from their focused modules. New implementation code should use
 * the owning module directly; this surface preserves the service API used by
 * routes and other established callers.
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
} from './trajectory-attach-service.js';

export {
  startTrajectoryRecording,
  stopTrajectoryRecording,
  stopTrajectoryRecordingSafe,
  resolveTrajectoryElement,
  toggleTrajectoryManualRecord,
  runDefaultLogin,
} from './trajectory-record-lifecycle.js';

export {
  replayTrajectorySteps,
  acceptTrajectoryStepsReplay,
  stopTrajectoryStepsReplay,
} from './trajectory-session-replay.js';
