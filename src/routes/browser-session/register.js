import { existsSync, readFileSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PROJECT_DIR, USE_EXECUTOR } from '../../../config/config.js';
import { state } from '../../state.js';
import { saveCaseDataRecord } from '../../case-data-store.js';
import { getTrajectoryActionFlow } from '../../services/trajectory-service.js';
import { persistSessionCaseData } from '../../services/case-data-service.js';
import {
  getRemoteStatus, initRemoteBridgeWs, notifyManualRecordingChanged,
} from '../../cdp/remote-bridge.js';
import * as remoteSessionService from '../../services/remote-session-service.js';
import * as execSession from '../../executor-session-client.js';
import * as slotLease from '../../executor-slot-lease.js';
import {
  PYTHON_EXE, AGENT_SCRIPT, killTree, killOrphans,
} from '../../runtime/agent-process.js';
import { setupSSE, createPushChannel } from '../../runtime/sse-channel.js';
import { resolveModelId } from '../../runtime/resolve-model.js';
import { broadcastSessions, broadcastWatcherStatus } from './broadcasts.js';
import { bindExecutorSessionEvents } from './executor-events.js';
import { ensureGlobalBrowser, teardownRemoteBridge } from './global-browser.js';
import { writeAgentEvent, sessionRuntimeReady, waitForAgentEvent } from './agent-io.js';
import { executeAgentStep } from './step-execution.js';
import { buildRerunResumeInstruction } from './heal-instruction.js';
import { persistTrajectory } from './trajectory-persist.js';
import { handleWatcherAction, registerWatcherWsHandler } from './watcher-actions.js';

export async function runSessionStep(req, res) {
  const { id } = req.params;
  const { task, maxSteps, caseDataFile, phaseNumber, trajectoryDbId } = req.body || {};
  if (!task) return res.status(400).json({ error: 'task is required' });

  const session = state.sessions.get(id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const channel = createPushChannel(null, res);
  setupSSE(res);  // sets headers
  executeAgentStep({ session, task, maxSteps, caseDataFile, phaseNumber, trajectoryDbId, channel });
}

export default function registerBrowserSessionRoutes(app) {
  app.post('/api/browser/session', async (req, res) => {
    const { model } = req.body || {};
    const sessionId = crypto.randomUUID();
    const modelId = resolveModelId(model);

    if (USE_EXECUTOR) {
      try {
        const opened = await execSession.openSession({ sessionId, model: modelId });
        const session = {
          sessionId,
          stepIndex: 0,
          trajectories: [],
          createdAt: new Date().toISOString(),
          model: modelId,
          lastTask: null,
          lastMaxSteps: null,
          caseDataFile: null,
          useExecutor: true,
          executorNodeUuid: opened.nodeUuid,
          executorSlotIndex: opened.slotIndex,
          busy: false,
          lastActionLog: [],
          persistedActionIds: new Set(),
        };
        state.sessions.set(sessionId, session);
        bindExecutorSessionEvents(session);
        console.log(`[browser-session] Created session ${sessionId} on executor ${opened.nodeUuid}`);
        broadcastSessions();
        broadcastWatcherStatus();
        return res.json({ sessionId, model: modelId, executorNodeUuid: opened.nodeUuid });
      } catch (err) {
        const status = err.statusCode || 503;
        const body = { error: err.message };
        if (err.holders) body.holders = err.holders;
        return res.status(status).json(body);
      }
    }

    if (!existsSync(PYTHON_EXE)) return res.status(500).json({ error: `Python not found at ${PYTHON_EXE}` });
    if (!existsSync(AGENT_SCRIPT)) return res.status(500).json({ error: `Agent script not found at ${AGENT_SCRIPT}` });

    try { await ensureGlobalBrowser(modelId); } catch (err) { return res.status(500).json({ error: err.message }); }

    const gb = state.globalBrowser;
    state.sessions.set(sessionId, { sessionId, stepIndex: 0, trajectories: [], createdAt: new Date().toISOString(), model: gb.model, lastTask: null, lastMaxSteps: null, caseDataFile: null });
    console.log(`[browser-session] Created session ${sessionId} (shared browser)`);
    broadcastSessions();
    broadcastWatcherStatus();
    res.json({ sessionId, model: gb.model });
  });

  app.post('/api/browser/session/:id/step', runSessionStep);

  app.post('/api/browser/session/:id/continue', async (req, res) => {
    const { id } = req.params;
    const session = state.sessions.get(id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!session.lastTask) return res.status(400).json({ error: 'No previous task to continue' });
    req.body = { task: session.lastTask, maxSteps: session.lastMaxSteps };
    return runSessionStep(req, res);
  });

  // Self-healing: construct resume instruction, send as step to global agent.
  app.post('/api/browser/session/:id/rerun', async (req, res) => {
    const { id } = req.params;
    const { action_file, failedStep, maxSteps, log_file, form_changes } = req.body || {};

    const session = state.sessions.get(id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!action_file) return res.status(400).json({ error: 'action_file is required' });
    if (!failedStep || failedStep <= 0) return res.status(400).json({ error: 'failedStep (> 0) is required' });

    const absActionPath = path.resolve(PROJECT_DIR, action_file);
    if (!existsSync(absActionPath)) return res.status(404).json({ error: 'Action file not found' });

    let replayedCount = 0;
    let resumeInstruction;
    try {
      const actionData = JSON.parse(readFileSync(absActionPath, 'utf-8'));
      const url = actionData.url || '';
      const commands = actionData?.tests?.[0]?.commands || actionData?.actions || [];

      // ── Reproduce failure scene via scripts/controller/actions/_replay.py ──
      // Replay failedStep 之前的操作（必要时先 go_to_url），重建页面状态后再交给 Agent 修复。
      const SKIP_REPLAY = new Set([
        'scroll_down', 'scroll_up', 'get_page_state', 'scan_form_fields', 'scan_visible_fields',
        'check_field_value', 'verify_field_value', 'take_screenshot', 'save_trajectory',
        'save_case_data', 'read_case_data', 'match_form_rule', 'init_task_list',
        'get_pending_tasks', 'sync_tasks_from_errors', 'expand_all_el_tree', 'task_done',
        'task_retry', 'save_form_snapshot',
      ]);
      const preFailure = commands.filter(
        (c, i) => (i + 1) < failedStep && !SKIP_REPLAY.has(c.action),
      );
      const replayActions = preFailure.map((c) => ({ ...c }));
      const hasGoto = replayActions.some((c) => c.action === 'go_to_url');
      if (url && !String(url).includes('unknown') && !hasGoto) {
        replayActions.unshift({ action: 'go_to_url', params: { url } });
      }

      if (replayActions.length > 0) {
        if (!sessionRuntimeReady(session)) {
          console.log('[rerun] Session runtime not ready — skipping _replay reproduce');
        } else {
          try {
            const replayPayload = {
              actions: replayActions,
              seed_action_log: true,
              is_replay: true,
            };
            let replayResult;
            if (session.useExecutor && session.executorNodeUuid) {
              const doneP = execSession.waitForSessionEvent(session.sessionId, 'replay_done', 180000);
              writeAgentEvent(session, 'replay_actions', replayPayload);
              replayResult = await doneP;
            } else {
              const doneP = waitForAgentEvent('replay_done', 180000);
              writeAgentEvent(session, 'replay_actions', replayPayload);
              replayResult = await doneP;
            }
            replayedCount = replayResult.count || 0;
            console.log(
              `[rerun] _replay done: ${replayedCount} actions `
              + `(ok=${replayResult.ok ?? '?'} failed=${replayResult.failed ?? '?'})`,
            );
          } catch (e) {
            console.log(`[rerun] _replay error (continuing with heal): ${e.message}`);
          }
        }
      }

      ({ resumeInstruction } = buildRerunResumeInstruction({
        actionData,
        failedStep,
        log_file,
        form_changes,
        replayedCount,
        PROJECT_DIR,
      }));
    } catch (e) {
      resumeInstruction = 'Continue recording from step ' + failedStep + '. See action file for details.';
    }

    req.body = { task: resumeInstruction, maxSteps: maxSteps || 40 };
    return runSessionStep(req, res);
  });

  // Human intervention retired — use manual recording instead
  app.post('/api/browser/session/:id/intervene', (req, res) => {
    res.status(410).json({
      error: 'Gone',
      message: 'intervene is retired. Use manual recording for human correction.',
    });
  });

  app.delete('/api/browser/session/:id', async (req, res) => {
    const { id } = req.params;
    const session = state.sessions.get(id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    if (session.useExecutor && session.executorNodeUuid) {
      try {
        await execSession.closeSession({ nodeUuid: session.executorNodeUuid, sessionId: id });
      } catch (err) {
        console.warn('[browser-session] executor close failed:', err.message);
        slotLease.releaseBySession(id);
      }
    }
    if (session._persistUnsub) {
      try { session._persistUnsub(); } catch {}
      session._persistUnsub = null;
    }

    const record = {
      sessionId: id, model: session.model, stepIndex: session.stepIndex,
      steps: session.trajectories.map(t => ({ step: t.step, path: t.path, time: t.time })),
      createdAt: session.createdAt, archivedAt: new Date().toISOString(),
    };
    state.sessions.delete(id);
    console.log(`[browser-session] Deleted session ${id}`);
    broadcastSessions();
    res.json({ status: 'archived', sessionId: id });
  });

  app.delete('/api/browser/browser', async (req, res) => {
    const gb = state.globalBrowser;
    const proc = gb.process;
    await teardownRemoteBridge();

    if (gb.stdin) {
      try { gb.stdin.write(JSON.stringify({ event: 'close' }) + '\n'); } catch {}
    }

    if (proc && !proc.killed) {
      const forceKillTimer = setTimeout(() => {
        killTree(proc.pid);
        setTimeout(() => killOrphans(), 2000);
        gb.process = null;
        gb.stdin = null;
        gb.ready = false;
        gb.busy = false;
        gb.stepIndex = 0;
        state.sessions.clear();
        console.log('[browser-global] Browser close timeout, force killed');
        broadcastSessions();
        broadcastWatcherStatus();
        res.json({ status: 'closed (force killed)' });
      }, 30000);

      proc.on('exit', () => {
        clearTimeout(forceKillTimer);
        gb.process = null;
        gb.stdin = null;
        gb.ready = false;
        gb.busy = false;
        gb.stepIndex = 0;
        state.sessions.clear();
        console.log('[browser-global] Browser closed gracefully');
        broadcastSessions();
        broadcastWatcherStatus();
        res.json({ status: 'closed' });
      });
    } else {
      gb.process = null;
      gb.stdin = null;
      gb.ready = false;
      gb.busy = false;
      gb.stepIndex = 0;
      state.sessions.clear();
      console.log('[browser-global] No browser process, cleaned up');
      broadcastSessions();
      broadcastWatcherStatus();
      res.json({ status: 'closed' });
    }
  });

  app.get('/api/browser/session/:id/trajectories', (req, res) => {
    const { id } = req.params;
    const session = state.sessions.get(id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json({ sessionId: id, stepIndex: session.stepIndex, busy: state.globalBrowser.busy, steps: session.trajectories.map(t => ({ step: t.step, path: t.path, time: t.time })) });
  });

  app.post('/api/browser/session/:id/reset-trajectory', async (req, res) => {
    const gb = state.globalBrowser;
    if (!gb.stdin || !gb.ready) return res.status(503).json({ error: 'Browser not ready' });
    if (gb.busy) return res.status(409).json({ error: 'Browser is busy executing a step' });
    gb.stdin.write(JSON.stringify({ event: 'reset_trajectory' }) + '\n');

    const timeout = setTimeout(() => { gb.process.stdout.removeListener('data', onData); if (!res.writableEnded) res.status(504).json({ error: 'Timeout waiting for trajectory reset' }); }, 15000);
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.event === 'reset_trajectory_ready') {
            clearTimeout(timeout);
            gb.process.stdout.removeListener('data', onData);
            return res.json({ status: 'reset', cumulative_file: msg.data.cumulative_file, case_data_file: msg.data.case_data_file });
          }
        } catch {}
      }
    };
    gb.process.stdout.on('data', onData);
  });

  /**
   * Merged action flow: DB steps for trajectory.id + live _ACTION_LOG.
   * Query: ?trajectoryId=<numeric trajectory.id>&phaseId=<trajectory_phase.id>
   * Prefer GET /api/v2/trajectories/:id/tree on the Dashboard for phase-step view.
   */
  app.get('/api/browser/session/:id/action-flow', async (req, res) => {
    const { id } = req.params;
    const session = state.sessions.get(id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const trajectoryDbId = req.query.trajectoryId != null && req.query.trajectoryId !== ''
      ? Number(req.query.trajectoryId)
      : (session.dbTrajectoryId != null ? Number(session.dbTrajectoryId) : null);

    if (Number.isFinite(trajectoryDbId)) session.dbTrajectoryId = trajectoryDbId;

    const phaseQ = req.query.phaseId ?? req.query.trajectoryPhaseId;
    if (phaseQ != null && phaseQ !== '') {
      const pid = Number(phaseQ);
      if (Number.isFinite(pid) && pid > 0) session.selectedPhaseId = pid;
    }

    const gb = state.globalBrowser;
    let pending = Array.isArray(session.lastActionLog)
      ? session.lastActionLog
      : (Array.isArray(gb.lastActionLog) ? gb.lastActionLog : []);

    // Pull fresh ACTION_LOG from local or executor agent
    if (session.useExecutor && session.executorNodeUuid && !session.busy) {
      try {
        const resultP = execSession.waitForSessionEvent(id, 'get_action_log_result', 3000);
        writeAgentEvent(session, 'get_action_log', {});
        const payload = await resultP;
        pending = Array.isArray(payload?.entries) ? payload.entries : pending;
        session.lastActionLog = pending;
      } catch {
        pending = session.lastActionLog || [];
      }
    } else if (gb.ready && gb.stdin && !gb.busy) {
      try {
        pending = await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            cleanup();
            resolve(gb.lastActionLog || []);
          }, 3000);
          let buf = '';
          const onData = (chunk) => {
            buf += chunk.toString();
            const lines = buf.split('\n');
            buf = lines.pop() || '';
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const msg = JSON.parse(line);
                if (msg.event === 'get_action_log_result') {
                  clearTimeout(timeout);
                  cleanup();
                  const entries = msg.data?.entries || [];
                  gb.lastActionLog = entries;
                  resolve(entries);
                }
              } catch {}
            }
          };
          function cleanup() {
            gb.process?.stdout?.removeListener('data', onData);
          }
          gb.process.stdout.on('data', onData);
          try {
            gb.stdin.write(JSON.stringify({ event: 'get_action_log' }) + '\n');
          } catch {
            clearTimeout(timeout);
            cleanup();
            resolve(gb.lastActionLog || []);
          }
        });
      } catch {
        pending = gb.lastActionLog || [];
      }
    }

    try {
      const flow = await getTrajectoryActionFlow(
        Number.isFinite(trajectoryDbId) ? trajectoryDbId : null,
        pending,
        { excludeActionIds: session.persistedActionIds },
      );
      res.json({
        ...flow,
        sessionId: id,
        autoPersist: !!(session.autoPersist ?? gb.autoPersist),
        useExecutor: !!session.useExecutor,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/browser/session/:id/trajectory', persistTrajectory);

  app.post('/api/browser/session/:id/save-case-data', async (req, res) => {
    const { id } = req.params;
    const session = state.sessions.get(id);
    const gb = state.globalBrowser;
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!gb.ready || !gb.stdin) return res.status(503).json({ error: 'Browser not ready' });

    try {
      gb.stdin.write(JSON.stringify({ event: 'save_case_data' }) + '\n');
    } catch (writeErr) {
      return res.status(500).json({ error: `Failed to send save_case_data: ${writeErr.message}` });
    }

    const timeout = setTimeout(() => { cleanupListener(); if (!res.writableEnded) res.status(504).json({ error: 'Timeout waiting for case data' }); }, 15000);
    let pendingBuffer = '';

    const onStdout = async (chunk) => {
      pendingBuffer += chunk.toString();
      const lines = pendingBuffer.split('\n');
      pendingBuffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.event === 'save_case_data_result') {
            clearTimeout(timeout);
            cleanupListener();
            if (!msg.data.success) return res.status(500).json({ error: msg.data.message || 'Failed to save case data' });
            try {
              let data = null;
              if (msg.data.case_data_file && existsSync(msg.data.case_data_file)) {
                try {
                  data = JSON.parse(readFileSync(msg.data.case_data_file, 'utf-8'));
                } catch (e) {
                  return res.status(500).json({ error: `Failed to read case data file: ${e.message}` });
                }
              }
              if (!data || typeof data !== 'object') {
                return res.status(500).json({ error: 'Empty case data' });
              }

              // Optional legacy JSON index — never blocks DB path
              let recordId = null;
              try {
                const { record } = saveCaseDataRecord({
                  caseDataPath: msg.data.case_data_file,
                  sessionId: id,
                  model: session.model,
                  description: session.lastTask ? session.lastTask.slice(0, 100) : '',
                });
                recordId = record?.recordId || null;
              } catch (jsonErr) {
                console.warn('[save-case-data] legacy JSON store skipped:', jsonErr.message);
              }
              if (!recordId) {
                recordId = 'cdata_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
              }

              const dbId = await persistSessionCaseData({
                record: {
                  recordId,
                  sessionId: id,
                  model: session.model,
                  description: session.lastTask ? session.lastTask.slice(0, 100) : '',
                },
                data,
                trajectoryId: session.dbTrajectoryId != null ? Number(session.dbTrajectoryId) : null,
              });

              return res.json({
                caseDataFile: msg.data.case_data_file,
                recordId,
                dbId,
                keys: msg.data.keys,
                storage: 'db',
              });
            } catch (err) {
              return res.status(500).json({ error: err.message, caseDataFile: msg.data.case_data_file, keys: msg.data.keys });
            }
          }
        } catch {}
      }
    };

    function cleanupListener() { gb.process.stdout.removeListener('data', onStdout); }
    gb.process.stdout.on('data', onStdout);
  });

  app.get('/api/browser/sessions', (req, res) => {
    const gb = state.globalBrowser;
    const list = [];
    for (const [id, s] of state.sessions) {
      list.push({ sessionId: id, model: s.model, stepIndex: s.stepIndex, busy: gb.busy, createdAt: s.createdAt, stepCount: s.trajectories.length });
    }
    res.json(list);
  });

  // ---- CDP Quick Action API (uses in-process watcher via Agent stdin) ----

  // Register remote:* WS handlers (screencast / input)
  initRemoteBridgeWs();

  app.get('/api/browser/watcher/status', async (req, res) => {
    const gb = state.globalBrowser;
    const session = [...state.sessions.values()][0];
    const executorSessions = [...state.sessions.values()].filter((s) => s.useExecutor);
    const connected = USE_EXECUTOR
      ? executorSessions.length > 0
      : !!(gb.ready && gb.stdin);
    const agentBusy = USE_EXECUTOR
      ? executorSessions.some((s) => s.busy)
      : !!gb.busy;
    const remote = USE_EXECUTOR
      ? await remoteSessionService.getLiveStatus().catch(() => ({ attached: false }))
      : getRemoteStatus();
    res.json({
      connected,
      agentBusy,
      cdpReady: USE_EXECUTOR ? true : !!(gb.cdpWsUrl || gb.cdpHttp),
      cdpHttp: USE_EXECUTOR ? null : (gb.cdpHttp || null),
      manualRecording: !!gb.manualRecording,
      autoPersist: !!(session?.autoPersist ?? gb.autoPersist),
      remote,
    });
  });

  /**
   * Toggle live DB persist for CDP / manual recorded actions.
   * Body: { enabled: boolean }
   * ON  → appendRecordedStep immediately (and hide from「待保存」via exclude ids)
   * OFF → only _ACTION_LOG until「保存轨迹」
   */
  app.post('/api/browser/session/:id/auto-persist', (req, res) => {
    const { id } = req.params;
    const { enabled } = req.body || {};
    const session = state.sessions.get(id);
    const gb = state.globalBrowser;
    if (!session) return res.status(404).json({ error: 'Session not found' });
    session.autoPersist = !!enabled;
    gb.autoPersist = !!enabled;
    // Sync Python capture flag when auto-persist + trajectory binding
    if (sessionRuntimeReady(session) && Number.isFinite(Number(session.dbTrajectoryId))) {
      writeAgentEvent(session, 'capture_screenshots', { enabled: !!enabled });
    }
    res.json({ status: 'ok', autoPersist: !!enabled });
  });

  /**
   * Start / stop manual DOM recording on the live browser page.
   * Body: { enabled: boolean, trajectoryDbId?, phaseId? / trajectoryPhaseId? }
   * phaseId → append live steps to that trajectory_phase; omit → last phase of traj.
   */
  app.post('/api/browser/session/:id/manual-record', async (req, res) => {
    const { id } = req.params;
    const { enabled, trajectoryDbId, phaseId, trajectoryPhaseId } = req.body || {};
    const session = state.sessions.get(id);
    const gb = state.globalBrowser;
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!sessionRuntimeReady(session)) return res.status(503).json({ error: 'Browser not ready' });

    if (trajectoryDbId != null && trajectoryDbId !== '') {
      session.dbTrajectoryId = Number(trajectoryDbId);
    }
    const selectedPhase = phaseId ?? trajectoryPhaseId;
    if (selectedPhase != null && selectedPhase !== '') {
      session.selectedPhaseId = Number(selectedPhase);
    } else if (enabled) {
      // Manual start without phase → clear so persist falls back to last phase
      session.selectedPhaseId = null;
    }

    const event = enabled ? 'manual_record_start' : 'manual_record_stop';
    try {
      writeAgentEvent(session, event);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }

    const status = await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve({ enabled: !!enabled, timedOut: true }), 5000);
      if (session.useExecutor) {
        const off = execSession.onSessionEvent(id, 'manual_record_status', (data) => {
          clearTimeout(timeout);
          off();
          resolve(data || {});
        });
        return;
      }
      let buf = '';
      const onData = (chunk) => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.event === 'manual_record_status') {
              clearTimeout(timeout);
              try { gb.process.stdout.removeListener('data', onData); } catch {}
              resolve(msg.data || {});
            }
          } catch {}
        }
      };
      try { gb.process.stdout.on('data', onData); } catch {
        clearTimeout(timeout);
        resolve({ enabled: !!enabled, error: 'no stdout' });
      }
    });

    gb.manualRecording = !!status.enabled;
    if (gb.manualRecording) notifyManualRecordingChanged(true);
    res.json({
      status: 'ok',
      enabled: !!status.enabled,
      trajectoryDbId: session.dbTrajectoryId ?? null,
      phaseId: session.selectedPhaseId ?? null,
      error: status.error || null,
    });
  });

  app.post('/api/browser/watcher/action', handleWatcherAction);

  // ── WebSocket 消息处理（通过 ws-server 的 onWsMessage 注册） ──
  registerWatcherWsHandler();
}
