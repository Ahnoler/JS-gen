/**
 * Trajectory service barrel — re-exports every public export of the six
 * moved service modules so consumers can switch to a single import path.
 * 此桶文件仅包含重新导出，使调用方可使用一个稳定的 import 路径，同时实现职责
 * 仍拆分在各模块中。
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
