import { state } from '../../state.js';
import * as execSession from '../../executor-session-client.js';

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

export function sessionRuntimeReady(session) {
  if (session?.useExecutor) return !!session.executorNodeUuid;
  const gb = state.globalBrowser;
  return !!(gb.ready && gb.stdin);
}

export function waitForAgentEvent(eventName, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
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
}
