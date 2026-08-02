/**
 * E1 smoke test: executor WS register / heartbeat / unregister.
 * Usage: node scripts/smoke/smoke-executor-ws.mjs
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';
import { randomUUID } from 'crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const TOKEN = 'e1-smoke-token';
const PORT = 4098;
const BASE = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/ws/executor?token=${TOKEN}`;
const NODE_UUID = randomUUID();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function wsConnect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function wsOnce(ws, type) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), 5000);
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === type) {
        clearTimeout(timer);
        resolve(msg);
      }
    });
  });
}

function wsSend(ws, type, payload = {}) {
  ws.send(JSON.stringify({ type, payload }));
}

async function main() {
  const server = spawn('node', ['server.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      EXECUTOR_TOKEN: TOKEN,
      EXECUTOR_HEARTBEAT_TIMEOUT_MS: '60000',
      EXECUTOR_DISCONNECT_GRACE_MS: '3000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let booted = false;
  server.stdout.on('data', (d) => {
    const s = d.toString();
    if (s.includes('Agent API listening')) booted = true;
  });
  server.stderr.on('data', (d) => process.stderr.write(d));

  for (let i = 0; i < 50 && !booted; i++) await sleep(200);
  if (!booted) throw new Error('server failed to start');

  // 1. No token -> reject
  let rejected = false;
  try {
    await wsConnect(`ws://127.0.0.1:${PORT}/ws/executor`);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error('expected no-token connection to fail');
  console.log('OK no-token rejected');

  // 2. Register
  const ws = await wsConnect(WS_URL);
  const registeredP = wsOnce(ws, 'executor.registered');
  wsSend(ws, 'executor.register', {
    nodeUuid: NODE_UUID,
    name: 'smoke-worker',
    capacity: 2,
    labels: { os: 'win', headed: true },
    agentVersion: '0.0.1',
  });
  const reg = await registeredP;
  console.log('OK register', reg.payload);

  // 3. GET list with inUse
  const listRes = await fetch(`${BASE}/api/v2/executors`);
  const list = await listRes.json();
  const node = list.nodes.find((n) => n.nodeUuid === NODE_UUID);
  if (!node || node.status !== 'online') throw new Error('node not online in list');
  if (typeof node.inUse !== 'number') throw new Error('inUse missing');
  console.log('OK list inUse=', node.inUse);

  // 4. Heartbeat
  const hbP = wsOnce(ws, 'executor.heartbeat.ack');
  wsSend(ws, 'executor.heartbeat', {});
  await hbP;
  console.log('OK heartbeat');

  // 5. Disconnect + reconnect within grace
  ws.terminate();
  await sleep(500);
  const ws2 = await wsConnect(WS_URL);
  const reg2P = wsOnce(ws2, 'executor.registered');
  wsSend(ws2, 'executor.register', { nodeUuid: NODE_UUID, name: 'smoke-worker', capacity: 2 });
  const reg2 = await reg2P;
  if (reg2.payload.nodeId !== reg.payload.nodeId) throw new Error('reconnect should upsert same node');
  console.log('OK reconnect same nodeId');

  // 6. Unregister
  const unregP = wsOnce(ws2, 'executor.unregistered');
  wsSend(ws2, 'executor.unregister', {});
  await unregP;
  await sleep(300);
  const one = await fetch(`${BASE}/api/v2/executors/${NODE_UUID}`);
  const oneNode = await one.json();
  if (oneNode.status !== 'offline') throw new Error('expected offline after unregister');
  console.log('OK unregister offline');

  ws2.close();
  server.kill('SIGTERM');
  console.log('ALL PASSED');
}

main().catch((err) => {
  console.error('FAILED', err);
  process.exit(1);
});
