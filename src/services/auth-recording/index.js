/**
 * Public re-exports for the auth-recording module (store + orchestration service).
 */
export {
  createJob,
  getJobById,
  latestJobForSystem,
  updateJob,
  ensureMountPoint,
} from './auth-recording-store.js';

export {
  startAuthRecording,
  getAuthRecordingStatus,
  checkLoginCriteria,
  checkLogoutCriteria,
  normalizeUrl,
} from './auth-recording-service.js';
