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
  EXECUTOR_HEARTBEAT_ACK_TIMEOUT_MS,
  EXECUTOR_RECONNECT_MIN_MS,
  EXECUTOR_RECONNECT_MAX_MS,
  EXECUTOR_DISCONNECT_TIMEOUT_MS,
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
/** 最近一次 WS 断开标志：重连注册成功后触发 _ACTION_LOG 全量补拉（恢复断线窗口丢失的步骤）。 */
let hadDisconnect = false;

const client = new ExecutorWsClient({
  url: wsUrlWithToken(),
  heartbeatIntervalMs: EXECUTOR_HEARTBEAT_INTERVAL_MS,
  heartbeatAckTimeoutMs: EXECUTOR_HEARTBEAT_ACK_TIMEOUT_MS,
  reconnectMinMs: EXECUTOR_RECONNECT_MIN_MS,
  reconnectMaxMs: EXECUTOR_RECONNECT_MAX_MS,
  disconnectTimeoutMs: EXECUTOR_DISCONNECT_TIMEOUT_MS,
  // 断线超时：杀掉全部 Python 会话 —— 宁可明确失败，也不让 agent 继续执行
  // 而事件在断线处静默丢弃（录制"只录到一半"的根因）。
  onDisconnectTimeout: () => {
    if (!sessionManager) return;
    const sessions = sessionManager.list();
    console.error(`[executor] killing ${sessions.length} session(s) after disconnect timeout`);
    for (const { sessionId } of sessions) {
      sessionManager.close(sessionId).catch((err) => {
        console.error(`[executor] session close failed after disconnect: ${err?.message || err}`);
      });
    }
  },
  onDisconnected: () => {
    hadDisconnect = true;
  },
  // 重连注册成功：若期间断过线，对所有活跃 session 补拉 _ACTION_LOG 全量快照。
  // Python 回 get_action_log_result → relayAgentEvent 同步发 action_log_sync →
  // 控制面录制持久化（persistedActionIds 幂等）自动补写断线窗口丢失的步骤。
  onRegistered: () => {
    if (!hadDisconnect) return;
    hadDisconnect = false;
    if (!sessionManager) return;
    const sessions = sessionManager.list();
    console.log(
      `[executor] ws reconnected after disconnect — resyncing ${sessions.length} session(s) via action_log_sync`,
    );
    for (const { sessionId } of sessions) {
      handleSession?.('session.get_action_log', { sessionId }).catch((err) => {
        console.warn(`[executor] resync get_action_log failed for ${sessionId}: ${err?.message || err}`);
      });
    }
    if (sessions.length) {
      // 审计打点：控制面写 memory_event(connection_resync)
      client.send('action_resync', {
        sessionId: sessions[0].sessionId,
        nodeUuid: EXECUTOR_NODE_UUID,
        sessionIds: sessions.map((s) => s.sessionId),
        at: new Date().toISOString(),
      });
    }
  },
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
      const result = await handleSession(msg.type, msg.payload || {});
      // Query-style commands need an explicit reply (return value was previously discarded).
      if (msg.type === 'session.list' && result) {
        client.send('session.list_result', {
          sessionId: msg.payload?.sessionId || msg.payload?.requestId,
          requestId: result.requestId || msg.payload?.requestId,
          sessions: result.sessions || [],
        });
      } else if (msg.type === 'session.list_cdp' && result) {
        client.send('session.list_cdp_result', {
          sessionId: msg.payload?.sessionId || msg.payload?.requestId,
          requestId: result.requestId || msg.payload?.requestId,
          browsers: result.browsers || [],
          occupiedPorts: result.occupiedPorts || [],
        });
      } else if (msg.type === 'session.bib_tabs' && result) {
        client.send('session.bib_tabs', {
          sessionId: msg.payload?.sessionId,
          tabs: result.tabs || [],
          activeTargetId: result.activeTargetId || null,
        });
      } else if (msg.type === 'session.bib_switch_tab' && result) {
        client.send('session.bib_tabs', {
          sessionId: msg.payload?.sessionId,
          tabs: result.tabs || [],
          activeTargetId: result.activeTargetId || null,
          switched: true,
        });
      } else if (msg.type === 'session.bib_resolve_element' && result) {
        client.send('session.bib_resolve_element_result', {
          sessionId: msg.payload?.sessionId,
          requestId: result.requestId || msg.payload?.requestId,
          element: result.element || null,
          matchedLabel: result.matchedLabel || null,
          ambiguous: result.ambiguous || false,
          matches: result.matches || null,
          error: result.error || null,
        });
      } else if (msg.type === 'session.bib_phase_highlight_capture' && result) {
        client.send('session.bib_phase_highlight_capture_result', {
          sessionId: msg.payload?.sessionId,
          requestId: result.requestId || msg.payload?.requestId,
          pngBase64: result.pngBase64 || null,
          meta: result.meta || null,
          error: result.error || null,
        });
      } else if (msg.type === 'session.bib_input' && result?.clipboard) {
        client.send('session.bib_clipboard', {
          sessionId: msg.payload?.sessionId,
          requestId: result.requestId || msg.payload?.requestId || null,
          ok: !!result.ok,
          text: result.text == null ? '' : String(result.text),
          reason: result.reason || null,
        });
      }
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
