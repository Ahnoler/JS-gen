/**
 * Trajectory service barrel — re-exports every public export of the six
 * moved service modules so consumers can switch to a single import path.
 */
export {
  acceptTrajectoryStepsReplay,
  replayTrajectorySteps,
  stopTrajectoryStepsReplay,
} from './trajectory-session-replay.js';
export {
  buildRequestHash,
  getBatchJobView,
  importBatchFromExcel,
  startBatchScheduler,
  kickScheduler,
  cancelBatch,
  recoverBatchJobsOnStartup,
  buildTemplateBuffer,
  cancelledAnalyzeTokens,
  emitProgress,
  maybeFinalizeJob,
} from './trajectory-batch-service.js';
export {
  prepareBusinessDataInjection,
  runDefaultLogin,
  startTrajectoryRecording,
  stopTrajectoryRecording,
  stopTrajectoryRecordingSafe,
  resolveTrajectoryElement,
  toggleTrajectoryManualRecord,
} from './trajectory-record-lifecycle.js';
export {
  buildStepsFromActionFile,
  buildStepsFromFlow,
  readOperationLogText,
  persistSessionTrajectory,
  saveFullTrajectory,
  resolvePhaseIdForPersist,
  removeRecordedStepsByDbIds,
  appendRecordedStep,
  appendRecordedFormSnapshot,
} from './trajectory-persist-service.js';
export {
  bindTrajectoryManualPersist,
  prepareTrajectoryRecording,
  attachTrajectoryLive,
  detachTrajectoryStream,
  detachTrajectoryLive,
  cleanupPersistedTrajectoryResources,
} from './trajectory-attach-service.js';
export {
  stripBusinessDataBlock,
  phaseNeedsBusinessData,
  extractBusinessDataBlock,
  extractBusinessEntriesFromRequirement,
  analyzeRequirementToPhases,
  createEmptyTrajectory,
  createTransactionWithPhases,
  setTrajectoryBusinessEntries,
  confirmTrajectory,
} from './trajectory-meta-service.js';
