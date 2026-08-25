import crypto from 'crypto';
import { state } from '../../state.js';
import { USE_EXECUTOR } from '#config/config.js';
import * as execSession from '../../executor-session-client.js';
import { persistLiveActionEntries } from './persist-live.js';
import { sessionRuntimeReady } from './agent-io.js';
import { createPushChannel } from '../../runtime/sse-channel.js';
import { executeAgentStep } from './step-execution.js';
import { onWsMessage } from '../../ws-server.js';

export async function handleWatcherAction(req, res) {
  try {
    const { action, params, trajectoryDbId, sessionId, source } = req.body || {};
    if (!action) return res.status(400).json({ error: 'action is required' });

    let session = sessionId ? state.sessions.get(sessionId) : null;
    // Executor mode: quick actions must target the live session agent (not globalBrowser).
    if (!session && USE_EXECUTOR) {
      const execSessions = [...state.sessions.values()].filter((s) => s.useExecutor && sessionRuntimeReady(s));
      if (execSessions.length === 1) session = execSessions[0];
    }

    const resolvedTrajId = trajectoryDbId != null && trajectoryDbId !== ''
      ? Number(trajectoryDbId)
      : (session?.dbTrajectoryId != null ? Number(session.dbTrajectoryId) : null);

    const reqId = crypto.randomUUID().slice(0, 8);
    let result;

    if (session?.useExecutor) {
      if (!sessionRuntimeReady(session)) {
        return res.status(503).json({ error: 'Agent not ready. Start a session first.' });
      }
      const deadline = Date.now() + 5000;
      while (session.busy && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
      }

      const resultP = new Promise((resolve) => {
        const timer = setTimeout(() => {
          unsub();
          resolve({ error: 'timeout: no response from agent within 15s' });
        }, 15000);
        const unsub = execSession.onSessionEvent(session.sessionId, 'cdp_action_result', (payload) => {
          if (payload?.id != null && String(payload.id) !== String(reqId)) return;
          clearTimeout(timer);
          unsub();
          resolve({
            result: payload?.result,
            error: payload?.error || null,
            entry: payload?.entry || null,
          });
        });
      });

      try {
        execSession.forwardStdin({
          nodeUuid: session.executorNodeUuid,
          sessionId: session.sessionId,
          event: 'cdp_action',
          data: { id: reqId, action, params: params || [] },
        });
      } catch (err) {
        return res.status(503).json({ error: err.message || 'Failed to send action to executor' });
      }
      result = await resultP;
    } else {
      const gb = state.globalBrowser;
      if (!gb.ready || !gb.stdin) {
        return res.status(503).json({ error: 'Agent not ready. Start a session first.' });
      }
      if (!gb.process || !gb.process.stdout) {
        return res.status(503).json({ error: 'Agent process not available' });
      }

      const deadline = Date.now() + 5000;
      while (gb.busy && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
      }

      result = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve({ error: 'timeout: no response from agent within 15s' }), 15000);
        let buffer = '';

        const onData = (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.event === 'cdp_action_result' && msg.id === reqId) {
                cleanup();
                resolve({ result: msg.result, error: msg.error, entry: msg.entry || null });
              }
            } catch {}
          }
        };

        const onExit = () => {
          cleanup();
          resolve({ error: 'Agent process exited before result' });
        };

        const cleanup = () => {
          clearTimeout(timeout);
          try { gb.process.stdout.removeListener('data', onData); } catch {}
          try { gb.process.removeListener('exit', onExit); } catch {}
        };

        try { gb.process.stdout.on('data', onData); } catch (e) { cleanup(); resolve({ error: String(e) }); return; }
        try { gb.process.on('exit', onExit); } catch (e) { cleanup(); resolve({ error: String(e) }); return; }

        try {
          gb.stdin.write(JSON.stringify({ event: 'cdp_action', data: { id: reqId, action, params: params || [] } }) + '\n');
        } catch (err) {
          cleanup();
          resolve({ error: String(err) });
        }
      });
    }

    if (result.error) {
      return res.status(500).json({ error: result.error, action, params });
    }

    // CDP persist: dedicated path via cdp_action_result hooks + claim-safe HTTP fallback
    // (never via action_log_sync). Same id is claimed once.
    let persisted = null;
    const gb = state.globalBrowser;
    const bodyAuto = req.body && typeof req.body.autoPersist === 'boolean'
      ? req.body.autoPersist
      : null;
    const autoPersist = !!(bodyAuto !== null
      ? bodyAuto
      : (session?.autoPersist ?? gb.autoPersist));
    if (session) session.autoPersist = autoPersist;
    gb.autoPersist = autoPersist;
    if (session && Number.isFinite(resolvedTrajId)) {
      session.dbTrajectoryId = resolvedTrajId;
    }
    const bodyPhase = req.body?.phaseId ?? req.body?.trajectoryPhaseId;
    if (session && bodyPhase != null && bodyPhase !== '') {
      session.selectedPhaseId = Number(bodyPhase);
    }
    if (autoPersist && Number.isFinite(resolvedTrajId) && result.entry && session) {
      try {
        const entry = { ...result.entry, source: 'cdp' };
        const results = await persistLiveActionEntries(session, [entry], { source: 'cdp' });
        persisted = results[0] || null;
      } catch (dbErr) {
        console.warn('[watcher-action] live DB persist failed:', dbErr.message);
      }
    }

    res.json({
      status: 'executed',
      action,
      params,
      result: result.result,
      trajectoryDbId: Number.isFinite(resolvedTrajId) ? resolvedTrajId : null,
      autoPersist: !!autoPersist,
      persisted,
      sessionId: session?.sessionId || sessionId || null,
    });
  } catch (err) {
    console.error('[watcher-action] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ── WebSocket 消息处理（通过 ws-server 的 onWsMessage 注册） ──
export function registerWatcherWsHandler() {
  onWsMessage((ws, msg) => {
    if (msg.type === 'session:step') {
      const { sessionId, task, maxSteps, businessDataFile, phaseNumber, trajectoryDbId } = msg.payload || {};
      if (!sessionId || !task) {
        ws.send(JSON.stringify({ type: 'session:error', payload: { message: 'sessionId and task are required' } }));
        return;
      }
      const session = state.sessions.get(sessionId);
      if (!session) {
        ws.send(JSON.stringify({ type: 'session:error', payload: { message: 'Session not found' } }));
        return;
      }
      const channel = createPushChannel(ws, null);
      executeAgentStep({ session, task, maxSteps: maxSteps || 40, businessDataFile, phaseNumber, trajectoryDbId, channel });
    }
  });
}
