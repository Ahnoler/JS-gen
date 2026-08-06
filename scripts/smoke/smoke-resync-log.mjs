/**
 * Resync smoke: executor reconnect after WS drop → pull full _ACTION_LOG snapshot →
 * control-plane idempotent persist fills only the missing steps.
 *
 * Simulates the full chain without a browser:
 *   - local ws server = control plane (registers, echoes ack, records inbound events)
 *   - real ExecutorWsClient (executor side)
 *   - real relayAgentEvent (Python stdout → WS relay; get_action_log_result also
 *     emits action_log_sync for the recording persist channel)
 *   - fake sessionManager: on get_action_log, Python "replies" with the full
 *     _ACTION_LOG snapshot (entries a1..a4 — a4 was born during the disconnect window)
 *   - fake control-plane persist consumer: keeps persistedActionIds, only appends
 *     unseen ids (mirrors trajectory-record-lifecycle.js semantics)
 *
 * Usage: node scripts/smoke/smoke-resync-log.mjs
 */
import { WebSocketServer } from 'ws';
import { ExecutorWsClient } from '../../executor/ws-client.js';
import { relayAgentEvent } from '../../executor/session-handler.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(desc, fn, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return;
    await sleep(20);
  }
  throw new Error(`timeout waiting for ${desc}`);
}

async function main() {
  /** 控制面（本地 ws 服务端）：记录收到的所有事件。 */
  const received = [];
  let connectionCount = 0;
  let lastWs = null;
  const wss = new WebSocketServer({ port: 0 });
  wss.on('connection', (ws) => {
    connectionCount += 1;
    lastWs = ws;
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      received.push(msg);
      if (msg.type === 'executor.register') {
        ws.send(JSON.stringify({ type: 'executor.registered', payload: { nodeId: 'resync-node' } }));
      } else if (msg.type === 'executor.heartbeat') {
        ws.send(JSON.stringify({ type: 'executor.heartbeat.ack', payload: { ok: true } }));
      } else if (msg.type === 'executor.unregister') {
        ws.send(JSON.stringify({ type: 'executor.unregistered', payload: { ok: true } }));
      }
    });
  });
  await new Promise((r) => wss.once('listening', r));
  const port = wss.address().port;

  // ── 模拟 Python 侧 _ACTION_LOG（随录制增长；a4 在断线窗口产生） ──
  const actionLog = [
    { id: 'a1', action: 'fill_input', params: { label: '客户名称', value: '朱桂武' } },
    { id: 'a2', action: 'select_option', params: { label: '客户类型', option: '对公' } },
    { id: 'a3', action: 'click_save', params: {} },
  ];
  const emitPythonEvent = (msg) => relayAgentEvent((type, payload) => client.send(type, payload), msg);
  const emitActionLogSync = () => emitPythonEvent({ event: 'action_log_sync', data: { entries: actionLog, count: actionLog.length } });

  // ── 模拟控制面录制持久化消费（persistedActionIds 幂等，同 trajectory-record-lifecycle） ──
  const persistedIds = new Set();
  const appended = [];
  const consumeActionLogSync = (payload) => {
    for (const entry of payload?.entries || []) {
      const id = String(entry?.id || '');
      if (!id || persistedIds.has(id)) continue;
      persistedIds.add(id);
      appended.push(id);
    }
  };

  // ── 模拟 executor agent.mjs 的断线补拉逻辑 ──
  let hadDisconnect = false;
  let getActionLogCalls = 0;
  const fakeSessionManager = {
    list: () => [{ sessionId: 's1' }],
    forward: async (sessionId, event) => {
      if (event === 'get_action_log') {
        getActionLogCalls += 1;
        // Python 回全量快照（断线窗口新增了 a4）
        actionLog.push({ id: 'a4', action: 'fill_input', params: { label: '证件号码', value: '110101199001011234' } });
        emitPythonEvent({ event: 'get_action_log_result', data: { entries: actionLog, count: actionLog.length } });
      }
    },
  };

  const client = new ExecutorWsClient({
    url: `ws://127.0.0.1:${port}/ws/executor?token=test`,
    heartbeatIntervalMs: 50,
    heartbeatAckTimeoutMs: 300,
    reconnectMinMs: 50,
    reconnectMaxMs: 100,
    disconnectTimeoutMs: 10000,
    getRegisterPayload: () => ({ nodeUuid: 'resync-node', name: 'resync-smoke', capacity: 1 }),
    onDisconnected: () => {
      hadDisconnect = true;
    },
    // 对应 executor/agent.mjs onRegistered：断线重连后补拉全部 session
    onRegistered: () => {
      if (!hadDisconnect) return;
      hadDisconnect = false;
      for (const { sessionId } of fakeSessionManager.list()) {
        fakeSessionManager.forward(sessionId, 'get_action_log');
      }
      client.send('action_resync', {
        sessionId: 's1',
        nodeUuid: 'resync-node',
        sessionIds: ['s1'],
        at: new Date().toISOString(),
      });
    },
  });

  try {
    // 1. 注册 + 正常录制流（3 条全量快照）
    client.connect();
    await waitFor('first register', () => client.registered === true);
    emitActionLogSync();
    await waitFor('first action_log_sync received', () => received.some((m) => m.type === 'action_log_sync'));
    consumeActionLogSync(received.find((m) => m.type === 'action_log_sync').payload);
    if (appended.length !== 3) throw new Error(`expected 3 persisted steps, got ${appended.length}`);

    // 2. 断线（控制面 terminate = 中间设备掐断；客户端侧模拟半开后正常 close 路径）
    lastWs.terminate();
    await waitFor('disconnect observed', () => hadDisconnect === true);

    // 3. 断线窗口：Python 继续执行并产生 a4 —— executor 事件进断线缓冲
    emitPythonEvent({ event: 'action_log_sync', data: { entries: actionLog, count: actionLog.length } });
    await waitFor('buffered during disconnect', () => client.pendingQueue.length >= 1);

    // 4. 重连 → registered → onRegistered 补拉 get_action_log → 全量快照（a1..a4）双发
    await waitFor('re-register after reconnect', () => client.registered === true);
    await waitFor('get_action_log triggered', () => getActionLogCalls === 1);

    // 5. 控制面幂等消费：无论补拉/重放先后，最终只补写断线窗口丢失的 a4，且无重复
    //    （onRegistered 先于 flushPending：补拉 4 条快照先到、缓冲 3 条旧快照后到）
    const syncsAfterReconnect = received.filter((m) => m.type === 'action_log_sync');
    for (const syncMsg of syncsAfterReconnect) consumeActionLogSync(syncMsg.payload);
    if (appended.length !== 4) {
      throw new Error(`expected exactly 4 persisted steps total, got ${JSON.stringify(appended)}`);
    }
    if (appended[3] !== 'a4' || new Set(appended).size !== 4) {
      throw new Error(`expected unique [a1,a2,a3,a4], got ${JSON.stringify(appended)}`);
    }
    console.log('OK idempotent resync: exactly a4 appended once (a1..a3 skipped, no duplicates)');

    // 6. get_action_log_result 双发：原事件 + action_log_sync 都到达控制面
    const gotResult = received.some((m) => m.type === 'get_action_log_result');
    if (!gotResult) throw new Error('get_action_log_result not relayed');
    console.log('OK get_action_log_result relayed (and mirrored as action_log_sync)');

    // 7. action_resync 审计事件到达控制面
    if (!received.some((m) => m.type === 'action_resync')) {
      throw new Error('action_resync audit event missing');
    }
    console.log('OK action_resync audit event received');

    // 8. 断线缓冲在重连后已重放
    await waitFor('pending flushed', () => client.pendingQueue.length === 0);

    await client.stop();
    console.log('ALL PASSED');
  } finally {
    wss.close();
  }
}

main().catch((err) => {
  console.error('FAILED', err);
  process.exit(1);
});
