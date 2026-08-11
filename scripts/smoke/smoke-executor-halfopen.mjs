/**
 * Half-open WS connection smoke: heartbeat ack timeout → terminate → buffer → replay.
 *
 * Simulates a NAT/LB silently killing the TCP link (executor readyState stays OPEN,
 * no FIN/RST, server pong never arrives back). Verifies ExecutorWsClient:
 *   1. detects missing heartbeat acks after heartbeatAckTimeoutMs and terminates the ws;
 *   2. emits an explicit error log (no more silent loss);
 *   3. events sent after terminate go into pendingQueue (buffer takeover);
 *   4. on reconnect, registered → flushPending replays buffered events in order.
 *
 * Usage: node scripts/smoke/smoke-executor-halfopen.mjs
 */
import { WebSocketServer } from 'ws';
import { ExecutorWsClient } from '../../executor/ws-client.js';

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
  /** 模拟控制面：第一次连接不回 heartbeat ack（半开黑洞），重连后正常回 ack。 */
  const received = [];
  let connCount = 0;
  const wss = new WebSocketServer({ port: 0 });
  wss.on('connection', (ws) => {
    const n = ++connCount;
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      received.push({ conn: n, type: msg.type, payload: msg.payload });
      if (msg.type === 'executor.register') {
        ws.send(JSON.stringify({ type: 'executor.registered', payload: { nodeId: 'test-node' } }));
      } else if (msg.type === 'executor.heartbeat') {
        if (n > 1) {
          ws.send(JSON.stringify({ type: 'executor.heartbeat.ack', payload: { ok: true } }));
        }
      } else if (msg.type === 'executor.unregister') {
        ws.send(JSON.stringify({ type: 'executor.unregistered', payload: { ok: true } }));
      }
    });
  });
  await new Promise((r) => wss.once('listening', r));
  const port = wss.address().port;

  // 捕获报错日志：断言"不再静默"（half-open 检测必须输出明确错误）
  const errors = [];
  const origError = console.error;
  console.error = (...a) => errors.push(a.join(' '));

  let disconnectedCount = 0;
  const client = new ExecutorWsClient({
    url: `ws://127.0.0.1:${port}/ws/executor?token=test`,
    heartbeatIntervalMs: 50,
    heartbeatAckTimeoutMs: 120, // ≈ 2.4 个心跳 tick
    reconnectMinMs: 50,
    reconnectMaxMs: 100,
    disconnectTimeoutMs: 10000, // 测试期间不触发杀会话
    getRegisterPayload: () => ({ nodeUuid: 'halfopen-test', name: 'halfopen-smoke', capacity: 1 }),
    onDisconnected: () => {
      disconnectedCount += 1;
    },
  });

  try {
    // 1. 首次注册成功
    client.connect();
    await waitFor('first register', () => client.registered === true);

    // 2. 半开模拟：服务端不回 ack → 客户端应主动 terminate（close → onDisconnected）
    await waitFor('half-open terminate (onDisconnected)', () => disconnectedCount === 1);
    if (!errors.some((e) => e.includes('half-open connection suspected'))) {
      throw new Error('expected explicit half-open error log, got none — silent loss would go unnoticed');
    }
    console.log('OK detected half-open + explicit error log');

    // 3. terminate 后事件转入断线缓冲（不再进黑洞）
    client.send('test.event', { n: 1 });
    client.send('test.event', { n: 2 });
    await waitFor('events buffered', () => client.pendingQueue.length === 2);
    console.log('OK buffer takeover (pendingQueue=', client.pendingQueue.length, ')');

    // 4. 重连成功 → flushPending 按序重放
    await waitFor('re-register after reconnect', () => client.registered === true);
    await waitFor('pending flushed', () => client.pendingQueue.length === 0);
    const replayed = received.filter((m) => m.type === 'test.event');
    if (replayed.length !== 2) {
      throw new Error(`expected 2 replayed test.event, got ${replayed.length}`);
    }
    if (replayed[0].payload.n !== 1 || replayed[1].payload.n !== 2) {
      throw new Error('replay order broken');
    }
    console.log('OK reconnect + ordered replay of buffered events');

    // 5. 半开期间 heartbeat 照发（服务端确实收到了多次心跳但没回 ack）
    const firstConnHeartbeats = received.filter((m) => m.conn === 1 && m.type === 'executor.heartbeat').length;
    if (firstConnHeartbeats < 2) {
      throw new Error(`expected >=2 heartbeats during half-open, got ${firstConnHeartbeats}`);
    }
    console.log('OK heartbeats kept flowing during half-open (', firstConnHeartbeats, ')');

    await client.stop();
    console.log('ALL PASSED');
  } finally {
    console.error = origError;
    wss.close();
  }
}

main().catch((err) => {
  console.error('FAILED', err);
  process.exit(1);
});
