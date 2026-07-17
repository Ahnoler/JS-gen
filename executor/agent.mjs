#!/usr/bin/env node
/**
 * Executor Agent — connects out to control plane WS /ws/executor.
 */
import {
  validateConfig,
  wsUrlWithToken,
  EXECUTOR_NODE_UUID,
  EXECUTOR_NAME,
  EXECUTOR_HOST,
  EXECUTOR_CAPACITY,
  EXECUTOR_AGENT_VERSION,
  EXECUTOR_HEARTBEAT_INTERVAL_MS,
  EXECUTOR_RECONNECT_MIN_MS,
  EXECUTOR_RECONNECT_MAX_MS,
  EXECUTOR_WS_URL,
  buildLabels,
} from './config.js';
import { ExecutorWsClient } from './ws-client.js';
import { createSessionManager } from './session-manager.js';
import { createSessionHandler, relayAgentEvent } from './session-handler.js';

const errors = validateConfig();
if (errors.length) {
  console.error('[executor] config errors:');
  for (const e of errors) console.error('  -', e);
  process.exit(1);
}

console.log('[executor] starting');
console.log('[executor] ws url:', EXECUTOR_WS_URL);
console.log('[executor] node uuid:', EXECUTOR_NODE_UUID);
console.log('[executor] name:', EXECUTOR_NAME);
console.log('[executor] capacity:', EXECUTOR_CAPACITY);

/** @type {import('./session-manager.js').SessionManager|null} */
let sessionManager = null;
/** @type {ReturnType<typeof createSessionHandler>|null} */
let handleSession = null;

const client = new ExecutorWsClient({
  url: wsUrlWithToken(),
  heartbeatIntervalMs: EXECUTOR_HEARTBEAT_INTERVAL_MS,
  reconnectMinMs: EXECUTOR_RECONNECT_MIN_MS,
  reconnectMaxMs: EXECUTOR_RECONNECT_MAX_MS,
  getRegisterPayload: () => ({
    nodeUuid: EXECUTOR_NODE_UUID,
    name: EXECUTOR_NAME,
    host: EXECUTOR_HOST,
    capacity: EXECUTOR_CAPACITY,
    labels: buildLabels(),
    agentVersion: EXECUTOR_AGENT_VERSION,
  }),
  onMessage: async (msg) => {
    if (!msg.type?.startsWith('session.')) return;
    if (client.draining && msg.type === 'session.open') {
      client.send('session.error', {
        sessionId: msg.payload?.sessionId,
        error: 'executor is draining',
      });
      return;
    }
    if (!handleSession) return;
    try {
      await handleSession(msg.type, msg.payload || {});
    } catch (err) {
      console.error('[executor] session error:', err.message);
      client.send('session.error', {
        sessionId: msg.payload?.sessionId,
        error: err.message,
      });
    }
  },
});

sessionManager = createSessionManager((msg) => {
  relayAgentEvent((type, payload) => client.send(type, payload), msg);
}, (packet) => client.sendBinary(packet));
handleSession = createSessionHandler(sessionManager);

client.connect();

async function shutdown(signal) {
  console.log(`\n[executor] ${signal} — closing sessions and unregistering…`);
  if (sessionManager) {
    for (const { sessionId } of sessionManager.list()) {
      await sessionManager.close(sessionId).catch(() => {});
    }
  }
  await client.stop();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
