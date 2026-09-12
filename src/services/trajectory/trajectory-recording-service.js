/**
 * 公共轨迹录制门面。
 *
 * 从各职责聚焦模块重新导出运行时、附加、生命周期、手动录制和回放操作。
 * 新实现代码应直接使用所属模块；该接口面保留路由及其他既有调用方
 * 使用的服务 API。
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
