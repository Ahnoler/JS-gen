import { state } from '../../state.js';
import * as execSession from '../../executor-session-client.js';

/**
 * Agent stdin I/O helpers — write events to the local Python agent (shared
 * browser) or forward to a remote executor session, plus wait for agent stdout
 * events.
 */

/**
 * Write an `{ event, data }` message to the session's agent stdin (executor or local).
 * @param {object} session 会话对象
 * @param {string} event 事件名称
 * @param {object} data 事件数据
 * @returns {boolean} 是否成功写入
 */
export function writeAgentEvent(session, event, data) {
  if (session?.useExecutor && session.executorNodeUuid) {
    execSession.forwardStdin({
      nodeUuid: session.executorNodeUuid,
      sessionId: session.sessionId,
      event,
      data,
    });
    return true;
  }
  const gb = state.globalBrowser;
  if (gb.stdin) {
    gb.stdin.write(JSON.stringify({ event, data }) + '\n');
    return true;
  }
  return false;
}

/**
 * True when the session's agent runtime is ready to receive stdin events.
 * @param {object} session 会话对象
 * @returns {boolean} 运行时是否就绪
 */
export function sessionRuntimeReady(session) {
  if (session?.useExecutor) return !!session.executorNodeUuid;
  const gb = state.globalBrowser;
  return !!(gb.ready && gb.stdin);
}

/**
 * Wait for a named agent stdout event, resolving with its `data`.
 * @param {string} eventName agent stdout event name to wait for
 * @param {number} [timeoutMs] wait timeout in milliseconds
 * @returns {Promise<object>} 包含事件数据的 Promise
 */
export function waitForAgentEvent(eventName, timeoutMs = 60000) {
  const promise = new Promise((resolve, reject) => {
    const gb = state.globalBrowser;
    if (!gb.process || !gb.process.stdout) return reject(new Error('Agent process not available'));
    const timeout = setTimeout(() => { cleanup(); reject(new Error(`Timeout waiting for ${eventName}`)); }, timeoutMs);
    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.event === eventName) { cleanup(); resolve(msg.data || {}); }
        } catch {}
      }
    };
    const onExit = () => { cleanup(); reject(new Error('Agent process exited')); };
    const cleanup = () => {
      clearTimeout(timeout);
      try { gb.process.stdout.removeListener('data', onData); } catch {}
      try { gb.process.removeListener('exit', onExit); } catch {}
    };
    try { gb.process.stdout.on('data', onData); } catch (e) { cleanup(); reject(e); }
    try { gb.process.on('exit', onExit); } catch (e) { cleanup(); reject(e); }
  });
  // 预挂 no-op：调用方在 writeAgentEvent/forwardStdin 同步抛错时可能永远不 await 本 promise，
  // 超时 rejection 不能成为 unhandledRejection 打崩进程（2026-08-29 事故根因）。
  // 不影响后续正常 await（多消费者各自独立处理）。
  promise.catch(() => {});
  return promise;
}
