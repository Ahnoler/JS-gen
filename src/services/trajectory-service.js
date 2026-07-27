/**
 * Trajectory service facade — re-exports focused modules.
 * Prefer importing from the specific *-service.js when adding new call sites.
 */
export {
  buildLoginInstruction,
  getTrajectoryLoginContext,
  resolveTrajectoryAccount,
  setTrajectoryAccount,
} from './trajectory-account-service.js';

export {
  stepsToActionEntries,
  getTrajectoryTree,
  getTrajectoryActionFlow,
  getSessionActionFlow,
  getTrajectoryWithPhases,
  listPhasesByTrajectory,
  listStepsByPhase,
  listByFunction,
} from './trajectory-query-service.js';

export {
  refreshTrajectoryCounts,
  confirmTrajectoryStep,
  createTrajectoryStep,
  updateTrajectoryStep,
  removeTrajectoryStep,
} from './trajectory-step-service.js';

export {
  buildStepsFromActionFile,
  buildStepsFromFlow,
  extractTrajectoryLog,
  readOperationLogText,
  persistSessionTrajectory,
  saveFullTrajectory,
  resolvePhaseIdForPersist,
  appendRecordedStep,
} from './trajectory-persist-service.js';

export {
  upsertPhaseDescription,
  markPhaseStatus,
  clearTrajectory,
  addPhaseToTrajectory,
  syncTrajectoryPhaseDescriptions,
} from './trajectory-phase-service.js';

export {
  createEmptyTrajectory,
  createTransactionWithPhases,
  setTrajectoryCaseEntries,
  analyzeRequirementToPhases,
  confirmTrajectory,
} from './trajectory-meta-service.js';

export {
  getTrajectoryRuntime,
  getAllTrajectoryRuntimes,
  touchTrajectoryRuntimeActivity,
  clearTrajectoryRuntimesForNode,
  prepareTrajectoryRecording,
  attachTrajectoryLive,
  detachTrajectoryLive,
  startTrajectoryRecording,
  stopTrajectoryRecording,
  replayTrajectorySteps,
  resolveTrajectoryElement,
  toggleTrajectoryManualRecord,
} from './trajectory-recording-service.js';
