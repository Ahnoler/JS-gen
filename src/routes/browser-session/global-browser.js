import { clearCdpEndpoints, detachLive } from '../../cdp/remote-bridge.js';

/**
 * Remote-bridge teardown for shutdown — no local agent spawn (executor-only BiB).
 */

/** Detach the live remote bridge and clear CDP endpoints (crash-safe). */
export async function teardownRemoteBridge() {
  try { await detachLive({ crashed: true }); } catch {}
  clearCdpEndpoints();
}
