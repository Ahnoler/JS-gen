/**
 * Dual push channel: WebSocket and/or SSE for session / execution streams.
 */

export function setupSSE(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (res.socket) {
    res.socket.setNoDelay(true);
    res.socket.setKeepAlive(true, 30000);
  }
  return (event, data) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
}

/**
 * Create a dual push channel that sends to WebSocket AND/OR SSE.
 * When WS is available, events go via WS; SSE is used as fallback.
 * @param {object|null} ws - WebSocket client (or null)
 * @param {object|null} res - Express response (or null)
 * @param {string} [ns='session'] - WS event namespace prefix
 * @returns {{ send: Function, end: Function, onAbort: Function, ended: boolean }}
 */
export function createPushChannel(ws, res, ns = 'session') {
  const channel = { ended: false };
  channel.send = (event, data) => {
    if (channel.ended) return;
    // WS path (preferred)
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: `${ns}:${event}`, payload: data }));
    }
    // SSE fallback
    if (res && !res.writableEnded) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };
  channel.end = () => {
    channel.ended = true;
    if (res && !res.writableEnded) res.end();
  };
  channel.onAbort = (handler) => {
    if (res) res.on('close', handler);
    if (ws) ws.on('close', handler);
  };
  return channel;
}
