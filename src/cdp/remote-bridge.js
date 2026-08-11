/**
 * Re-export shim — split into src/cdp/remote-bridge/ package.
 * Consumers keep importing from '../cdp/remote-bridge.js' unchanged.
 */
export {
  notifyManualRecordingChanged, getRemoteStatus, refreshCdpEndpoints, clearCdpEndpoints,
  attachLive, detachLive, parseRemoteFrame, resolveBibTarget, initRemoteBridgeWs,
  resolveElementByLabelText,
} from './remote-bridge/index.js';
