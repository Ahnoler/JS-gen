/**
 * WebSocket endpoint for executor agents: WS /ws/executor
 * Executors connect out; server never dials executors.
 */
import { WebSocketServer } from 'ws';
import { EXECUTOR_TOKEN } from '../config/config.js';
import * as registry from './executor-registry.js';
import * as executorService from './services/executor-node-service.js';
import { routeExecutorInbound } from './executor-event-hub.js';
import { getLiveBindingByAgentSession } from './services/remote-session-state.js';
import { broadcast, broadcastBinary, broadcastToUuid, countBinarySubscribers } from './ws-server.js';
import { detectAgentLlmError, createAgentLlmErrorDeduper } from './services/agent-llm-error.js';
import { shortSid } from './utils/stderr-prefix.js';

let wss = null;

/** 同一 session 同一 LLM 错误只广播/记一次（模型每步重试会重复刷屏）。 */
const shouldNotifyAgentLlmError = createAgentLlmErrorDeduper();

/**
 * 记录并广播一条 LLM 网关失败：控制面 ERROR 日志 + 该 session stderr 日志
 * 追加中文标记 + WS `recording:llm_error`（前端据此把「AI 录制结束」改为失败提示）。
 * @param {string} sessionId agent session id
 * @param {{ kind: string, message: string, upstream: string }} llmError classified error
 * @returns {Promise<void>} resolves after marker append attempt
 */
async function announceAgentLlmError(sessionId, llmError) {
  const binding = getLiveBindingByAgentSession(sessionId) || null;
  const trajectoryId = binding?.trajectoryId ?? null;
  const sid = shortSid(sessionId);
  console.error(
    `[agent-llm-error] trajectory=${trajectoryId ?? '-'} session=${sessionId} sid=${sid} `
    + `kind=${llmError.kind} upstream=${llmError.upstream || ''}`,
  );
  try {
    const { appendLines } = await import('./services/agent-stderr-log-service.js');
    appendLines(sessionId, [
      `[系统] AI 录制中断：${llmError.message}`
      + (llmError.upstream ? `（上游：${llmError.upstream}）` : ''),
    ]);
  } catch (err) {
    console.warn('[agent-llm-error] marker append failed:', err?.message || err);
  }
  broadcast('recording:llm_error', {
    trajectoryId,
    sessionId,
    sid,
    kind: llmError.kind,
    message: llmError.message,
    upstream: llmError.upstream || '',
    at: new Date().toISOString(),
  });
}

/**
 * @param {import('http').IncomingMessage} req req
 * @returns {string} result
 */
export function getExecutorTokenFromRequest(req) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const queryToken = url.searchParams.get('token');
  const headerToken = req.headers['x-executor-token'];
  return String(queryToken || headerToken || '');
}

/**
 * @param {import('http').IncomingMessage} req req
 * @returns {boolean} result
 */
export function validateExecutorToken(req) {
  if (!EXECUTOR_TOKEN) return false;
  return getExecutorTokenFromRequest(req) === EXECUTOR_TOKEN;
}

/**
 * @param {import('net').Socket} socket socket
 * @param {number} code code
 * @param {string} message message
 * @returns {void} result
 */
export function rejectUpgrade(socket, code, message) {
  socket.write(`HTTP/1.1 ${code} ${message}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function sendJson(ws, type, payload = {}) {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type, payload }));
}

async function handleRegister(ws, payload) {
  const { nodeUuid, name, host, capacity, labels, agentVersion, pid } = payload || {};
  if (!nodeUuid || !name) {
    sendJson(ws, 'executor.error', { error: 'nodeUuid and name are required' });
    return;
  }

  const node = await executorService.register({
    nodeUuid,
    name,
    host,
    capacity,
    labels,
    agentVersion,
  });
  const attached = registry.attach(nodeUuid, ws, node.id, pid);
  if (!attached) {
    // 同 uuid 异 pid 双活被 registry 拒绝（已向新连接回发 executor.error 并 close 4001）
    console.warn(
      `[executor-ws] register rejected for ${nodeUuid}: duplicate executor process`
      + ` (incoming pid ${pid ?? 'unknown'}, active pid ${registry.get(nodeUuid)?.pid ?? 'unknown'})`,
    );
    return;
  }
  sendJson(ws, 'executor.registered', {
    nodeId: node.id,
    nodeUuid: node.nodeUuid,
    status: node.status,
  });

  // Reconcile DB rows against executor truth before rebuilding bindings. The executor
  // can keep Python/Chrome alive while the control plane is restarting.
  try {
    const result = await executorService.reconcileRemoteSessions(node);
    if (result.kept || result.crashed || result.bibReattached) {
      console.log(`[executor-ws] reconciled ${nodeUuid}:`, result);
    }
  } catch (err) {
    console.warn('[executor-ws] remote session reconcile skipped:', err.message);
  }

  // Orphan reconcile: after a control-plane restart, live executor sessions
  // whose remote_session rows were crashed (boot sweep) would otherwise occupy
  // slots forever. Close the Python with keepBrowser=true → Chrome becomes a
  // reusable orphan CDP browser.
  try {
    const { reconcileOrphanSessions } = await import('./services/executor-orphan-session-service.js');
    const orphanResult = await reconcileOrphanSessions(node);
    if (orphanResult.closed) {
      console.log(`[executor-ws] closed ${orphanResult.closed} orphan executor session(s) for ${nodeUuid}`);
    }
  } catch (err) {
    console.warn('[executor-ws] orphan session reconcile skipped:', err.message);
  }
}

async function handleMessage(ws, msg) {
  const { type, payload } = msg;

  if (type?.startsWith('executor.')) {
    switch (type) {
      case 'executor.register':
        await handleRegister(ws, payload);
        return;
      case 'executor.heartbeat':
        if (ws._nodeUuid) {
          await executorService.heartbeat(ws._nodeUuid);
          sendJson(ws, 'executor.heartbeat.ack', { ok: true });
        } else {
          sendJson(ws, 'executor.error', { error: 'not registered' });
        }
        return;
      case 'executor.unregister':
        if (ws._nodeUuid) {
          const nodeUuid = ws._nodeUuid;
          ws._nodeUuid = null;
          ws._nodeId = null;
          await executorService.unregister(nodeUuid);
          sendJson(ws, 'executor.unregistered', { nodeUuid });
          ws.close(1000, 'unregistered');
        } else {
          sendJson(ws, 'executor.error', { error: 'not registered' });
        }
        return;
      default:
        break;
    }
    return;
  }

  // Agent → control plane (session events, stdout relay)
  routeExecutorInbound(msg);
  if (type === 'session.agent_stderr' && Array.isArray(payload?.lines) && payload.sessionId) {
    import('./services/agent-stderr-log-service.js')
      .then(({ appendLines }) => appendLines(payload.sessionId, payload.lines))
      .catch((err) => console.warn('[executor-ws] agent_stderr append failed:', err?.message || err));
    // LLM 网关失败（余额不足/鉴权/限流/5xx）：记控制面日志 + stderr 标记 + 广播前端。
    const llmError = detectAgentLlmError(payload.lines);
    if (llmError && shouldNotifyAgentLlmError(payload.sessionId, llmError.kind)) {
      announceAgentLlmError(payload.sessionId, llmError).catch((err) => {
        console.warn('[executor-ws] agent-llm-error announce failed:', err?.message || err);
      });
    }
    return;
  }
  if (payload?.sessionId) {
    if (type === 'action_resync') {
      // 断线重连补拉审计：executor 已对 session 重新下发 get_action_log（全量快照幂等补写），
      // 旁路记 memory_event(connection_resync)，失败不影响主链路。
      import('./memory/memory-service.js')
        .then(({ ingestEvents }) =>
          ingestEvents({
            events: [
              {
                eventType: 'connection_resync',
                source: 'executor',
                sessionId: payload.sessionId,
                payload: {
                  sessionIds: payload.sessionIds || [],
                  nodeUuid: payload.nodeUuid || null,
                  at: payload.at || null,
                },
              },
            ],
          }),
        )
        .catch((err) =>
          console.warn('[executor-ws] memory connection_resync event failed:', err?.message || err),
        );
      return;
    }
    if (type === 'action_log_sync' || type === 'manual_action_recorded') {
      broadcast(type, { ...payload, sessionId: payload.sessionId });
    }
    if (type === 'manual_record_status') {
      broadcast('manual_record_status', { ...payload, sessionId: payload.sessionId });
    }
    if (type === 'session.bib_tabs' || type === 'session.bib_ready') {
      // 定向投递：只发给订阅了该浏览器的 dashboard 客户端（remote:subscribe 时
      // 登记的 remoteSessionUuid）。全局 broadcast 会让所有打开的详情页地址栏
      // 轮播出别的浏览器 URL（多会话各 2.5s 轮询相互污染）。
      const binding = getLiveBindingByAgentSession(payload.sessionId) || null;
      const uuid = binding?.remoteSessionUuid || payload.remoteSessionUuid || null;
      const tabsPayload = {
        sessionId: payload.sessionId,
        remoteSessionUuid: uuid || null,
        trajectoryId: binding?.trajectoryId ?? null,
        tabs: payload.tabs || [],
        activeTargetId: payload.activeTargetId || null,
        switched: !!payload.switched,
      };
      const delivered = broadcastToUuid(uuid, 'remote:tabs', tabsPayload);
      // uuid 解析不出（控制面重启后 binding 尚未恢复等罕见边界）才回退全量，
      // 前端另有 uuid 归属守卫兜底。
      if (!delivered) broadcast('remote:tabs', tabsPayload);
    }
    if (type === 'session.bib_ready' && payload.remoteSessionUuid) {
      // 执行机重建了 BiB screencast → 旧缓存帧来自已终止的推流会话，其序号基线
      // 对新推流不再成立（序号可能更小，会让客户端把新帧误判为陈旧重绘而反复重连）。
      clearLastRscfPacket(payload.remoteSessionUuid);
      // attach 完成后立即对齐观众数（观众先于 attach 订阅的场景；0 观众 → 执行机暂停推流）
      sendJson(ws, 'session.bib_stream_viewers', {
        sessionId: payload.sessionId,
        remoteSessionUuid: payload.remoteSessionUuid,
        viewers: countBinarySubscribers(payload.remoteSessionUuid),
      });
    }
    if (type === 'session.bib_clipboard') {
      broadcast('remote:clipboard', {
        sessionId: payload.sessionId,
        requestId: payload.requestId || null,
        ok: !!payload.ok,
        text: payload.text == null ? '' : String(payload.text),
        reason: payload.reason || null,
      });
    }
  }
}

/** Last RSCF packet per remote session uuid — instant paint for late-joining viewers. */
const lastRscfByUuid = new Map();
const LAST_RSCF_MAX = 16;

/**
 * Return the last cached RSCF packet for a session uuid (or null).
 * @param {string} remoteSessionUuid remote session UUID
 * @returns {Buffer|null} cached packet
 */
export function getLastRscfPacket(remoteSessionUuid) {
  if (!remoteSessionUuid) return null;
  return lastRscfByUuid.get(String(remoteSessionUuid)) || null;
}

/**
 * Return the frame id from the cached RSCF packet for a session uuid.
 * @param {string} remoteSessionUuid remote session UUID
 * @returns {number|null} cached frame id
 */
export function getLastRscfFrameId(remoteSessionUuid) {
  const packet = getLastRscfPacket(remoteSessionUuid);
  if (!packet || packet.length < 8) return null;
  return packet.readUInt32BE(4);
}

/**
 * Drop the cached RSCF packet for a session uuid (fresh BiB attach / screencast restart).
 * Prevents a stale cached baseline from making a new stream look like a stale repaint.
 * @param {string} remoteSessionUuid remote session UUID
 * @returns {void}
 */
export function clearLastRscfPacket(remoteSessionUuid) {
  if (!remoteSessionUuid) return;
  lastRscfByUuid.delete(String(remoteSessionUuid));
}

function bindConnectionHandlers(ws) {
  ws._alive = true;

  ws.on('message', (raw) => {
    if (Buffer.isBuffer(raw)) {
      // RSCF binary frames from executor -> broadcast to dashboard clients.
      // Note: ws text frames also arrive as Buffer by default, so only short-circuit
      // true binary packets that carry the RSCF magic header.
      try {
        if (raw.length >= 4 && raw.subarray(0, 4).toString('utf8') === 'RSCF') {
          const uuidLen = raw.readUInt16BE(8);
          if (uuidLen > 0 && raw.length > 10 + uuidLen) {
            const uuid = raw.subarray(10, 10 + uuidLen).toString('utf8');
            if (uuid) {
              lastRscfByUuid.delete(uuid);
              lastRscfByUuid.set(uuid, Buffer.from(raw));
              if (lastRscfByUuid.size > LAST_RSCF_MAX) {
                lastRscfByUuid.delete(lastRscfByUuid.keys().next().value);
              }
            }
          }
          broadcastBinary(raw);
          return;
        }
      } catch {}
    }
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (ws._nodeUuid) registry.touch(ws._nodeUuid);
    Promise.resolve(handleMessage(ws, msg)).catch((err) => {
      console.error('[executor-ws] message error:', err);
      sendJson(ws, 'executor.error', { error: err.message || 'internal error' });
    });
  });

  ws.on('pong', () => {
    ws._alive = true;
    if (ws._nodeUuid) {
      registry.touch(ws._nodeUuid);
      executorService.heartbeat(ws._nodeUuid).catch(() => {});
    }
  });

  ws.on('close', () => {
    ws._alive = false;
    const nodeUuid = ws._nodeUuid;
    const nodeId = ws._nodeId;
    if (nodeUuid && nodeId) {
      // 身份校验：被新连接顶替后的旧连接关闭，不得触发现役 entry 的 detach
      //（否则会把新连接的 ws 置 null → 指令路由黑洞，45s grace 到期还会误清活会话租约）。
      const entry = registry.get(nodeUuid);
      if (entry && entry.ws && entry.ws !== ws) {
        console.warn('[executor-ws] stale connection closed for', nodeUuid, '- ignoring');
        return;
      }
      executorService.onDisconnect(nodeUuid, nodeId);
    }
  });

  ws.on('error', () => {
    ws._alive = false;
  });
}

/**
 * Initialize the executor WebSocket server in noServer mode.
 * Sets up connection handlers, heartbeat pings, and returns the wss instance.
 * @returns {import('ws').WebSocketServer} result
 */
export function initExecutorWs() {
  wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws) => {
    bindConnectionHandlers(ws);
  });

  // 心跳周期 10s：NAT/LB 空闲回收窗口内尽快发现半开连接（配合 executor 侧
  // heartbeat ack 超时检测，感知窗口从 30–60s 缩到 ~10–20s）。
  const heartbeat = setInterval(() => {
    if (!wss) {
      clearInterval(heartbeat);
      return;
    }
    wss.clients.forEach((ws) => {
      if (!ws._alive) {
        console.warn(
          '[executor-ws] half-open detected (pong missing), terminated',
          ws._nodeUuid || 'unknown',
        );
        ws.terminate();
        return;
      }
      ws._alive = false;
      ws.ping();
    });
  }, 10000);

  wss.on('close', () => clearInterval(heartbeat));

  console.log('[executor-ws] Executor WebSocket ready at /ws/executor (noServer mode)');
  return wss;
}
