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
  getTrajectoryWithPhases,
  listPhasesByTrajectory,
  listStepsByPhase,
  listByFunction,
} from './trajectory-query-service.js';

export {
  refreshTrajectoryCounts,
  confirmTrajectoryStep,
  markStepReplayFailed,
  markStepReplayOk,
  createTrajectoryStep,
  updateTrajectoryStep,
  removeTrajectoryStep,
  moveTrajectoryStep,
  insertStepsAfter,
} from './trajectory-step-service.js';

export {
  buildStepsFromActionFile,
  buildStepsFromFlow,
  readOperationLogText,
  persistSessionTrajectory,
  saveFullTrajectory,
  resolvePhaseIdForPersist,
  appendRecordedStep,
  appendRecordedFormSnapshot,
} from './trajectory/trajectory-persist-service.js';

export {
  upsertPhaseDescription,
  markPhaseStatus,
  appendPhaseDoneLog,
  clearTrajectory,
  addPhaseToTrajectory,
  syncTrajectoryPhaseDescriptions,
} from './trajectory-phase-service.js';

export {
  createEmptyTrajectory,
  createTransactionWithPhases,
  setTrajectoryCaseEntries,
  analyzeRequirementToPhases,
  extractCaseDataBlock,
  extractCaseEntriesFromRequirement,
  confirmTrajectory,
} from './trajectory/trajectory-meta-service.js';

export {
  getTrajectoryRuntime,
  getAllTrajectoryRuntimes,
  touchTrajectoryRuntimeActivity,
  clearTrajectoryRuntimesForNode,
  prepareTrajectoryRecording,
  attachTrajectoryLive,
  detachTrajectoryLive,
  detachTrajectoryStream,
  startTrajectoryRecording,
  stopTrajectoryRecording,
  stopTrajectoryRecordingSafe,
  cleanupPersistedTrajectoryResources,
  replayTrajectorySteps,
  acceptTrajectoryStepsReplay,
  stopTrajectoryStepsReplay,
  resolveTrajectoryElement,
  toggleTrajectoryManualRecord,
} from './trajectory-recording-service.js';
