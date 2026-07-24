import { existsSync, readFileSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PROJECT_DIR, USE_EXECUTOR } from '../../../config/config.js';
import { state } from '../../state.js';
import { saveTrajectoryRecord } from '../../trajectory-store.js';
import { saveCaseDataRecord } from '../../case-data-store.js';
import { persistSessionTrajectory, getTrajectoryActionFlow, upsertPhaseDescription } from '../../services/trajectory-service.js';
import { persistSessionCaseData, persistFormSnapshotsFromFile } from '../../services/case-data-service.js';
import { onWsMessage } from '../../ws-server.js';
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
import { persistLiveActionEntries } from './persist-live.js';
import { bindExecutorSessionEvents } from './executor-events.js';
import { ensureGlobalBrowser, teardownRemoteBridge } from './global-browser.js';
import { writeAgentEvent, sessionRuntimeReady, waitForAgentEvent } from './agent-io.js';
import { executeAgentStep } from './step-execution.js';
import { buildRerunResumeInstruction } from './heal-instruction.js';

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

      // ── Reproduce failure scene via scripts/actions/_replay.py ──
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

  // Human intervention: inject an instruction into the running session
  app.post('/api/browser/session/:id/intervene', (req, res) => {
    const { id } = req.params;
    const { instruction } = req.body || {};
    const gb = state.globalBrowser;
    const session = state.sessions.get(id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!gb.ready || !gb.stdin) return res.status(503).json({ error: 'Browser not ready' });
    if (!instruction) return res.status(400).json({ error: 'instruction is required' });
    try {
      gb.stdin.write(JSON.stringify({ event: 'intervene', data: { instruction } }) + '\n');
      res.json({ status: 'queued', instruction: instruction.slice(0, 200) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
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
        console.log('[browser-global] Browser closed gracefully, trace saved');
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

  app.post('/api/browser/session/:id/trajectory', async (req, res) => {
    const { id } = req.params;
    const { task, functionId, trajectoryDbId, phaseDescriptions } = req.body || {};
    const resolvedFunctionId = functionId != null && functionId !== ''
      ? Number(functionId)
      : undefined;
    const resolvedTrajId = trajectoryDbId != null && trajectoryDbId !== ''
      ? Number(trajectoryDbId)
      : (state.sessions.get(id)?.dbTrajectoryId != null
        ? Number(state.sessions.get(id).dbTrajectoryId)
        : undefined);
    const gb = state.globalBrowser;
    const session = state.sessions.get(id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    // Merge: session-side (from each「执行阶段」) + client payload (client wins on conflict)
    const mergedPhaseDescriptions = {
      ...(session.phaseDescriptions || {}),
      ...(phaseDescriptions && typeof phaseDescriptions === 'object' ? phaseDescriptions : {}),
    };
    console.log('[save-trajectory] phaseDescriptions keys:', Object.keys(mergedPhaseDescriptions),
      'sample:', Object.fromEntries(Object.entries(mergedPhaseDescriptions).map(([k, v]) => [k, String(v).slice(0, 40)])));

    const busy = session.useExecutor ? !!session.busy : !!gb.busy;
    if (busy) return res.status(409).json({ error: 'Browser is busy executing a step' });
    if (!sessionRuntimeReady(session)) {
      return res.status(503).json({ error: 'Browser not ready' });
    }
    if (Number.isFinite(resolvedTrajId)) session.dbTrajectoryId = resolvedTrajId;

    async function finalizeSave(data) {
      console.log('[save-trajectory] Python response:', JSON.stringify(data, null, 2));
      if (!data?.success) {
        return res.status(500).json({ error: data?.message || 'Failed to save trajectory' });
      }
      const trajectoryFile = data.trajectory_file;
      const actionFile = data.action_file;
      console.log('[save-trajectory] actionFile:', actionFile, 'trajectoryFile:', trajectoryFile);

      // Prefer action_file; if only live ACTION_LOG entries exist (executor), persist those.
      const liveEntries = Array.isArray(session.lastActionLog) ? session.lastActionLog : [];
      if (!actionFile && !trajectoryFile && !liveEntries.length) {
        return res.status(500).json({ error: 'No action_file or trajectory_file from agent' });
      }

      try {
        if (!session.persistedActionIds) session.persistedActionIds = new Set();

        let flow = [];
        let jsonSteps = 0;
        try {
          if (trajectoryFile && existsSync(trajectoryFile)) {
            const jsonKey = Number.isFinite(resolvedTrajId) ? `db_${resolvedTrajId}` : id;
            const { record, flow: f } = saveTrajectoryRecord({
              trajectoryId: jsonKey,
              task: task || '',
              model: session.model,
              sourcePath: trajectoryFile,
              exploreMeta: { is_done: data.is_done, is_successful: data.is_successful },
            });
            flow = f || [];
            jsonSteps = record?.stepCount || 0;
          }
        } catch (jsonErr) {
          console.warn('[save-trajectory] legacy JSON store skipped:', jsonErr.message);
        }

        // If no action_file but we have live entries, persist them directly
        if (!actionFile && liveEntries.length) {
          await persistLiveActionEntries(session, liveEntries);
        }

        const actionCount = data.action_count
          ?? liveEntries.length
          ?? flow.filter((s) => s.type !== 'done' && !s.error).length;

        let dbId = Number.isFinite(resolvedTrajId) ? resolvedTrajId : null;
        if (actionFile || trajectoryFile) {
          dbId = await persistSessionTrajectory({
            id: Number.isFinite(resolvedTrajId) ? resolvedTrajId : undefined,
            task: task || '',
            model: session.model,
            url: data.url || '',
            isDone: data.is_done,
            isSuccessful: data.is_successful,
            actionFile: actionFile || null,
            flow,
            logFile: data.log_file || null,
            phaseDescriptions: mergedPhaseDescriptions,
            excludeActionIds: session.persistedActionIds,
            ...(Number.isFinite(resolvedFunctionId) ? { functionId: resolvedFunctionId } : {}),
          });
        } else if (dbId != null) {
          // Live entries already appended; refresh phase descriptions
          for (const [k, v] of Object.entries(mergedPhaseDescriptions)) {
            const n = Number(k);
            if (Number.isFinite(n) && v) {
              await upsertPhaseDescription(dbId, n, String(v)).catch(() => {});
            }
          }
        }
        if (dbId != null) session.dbTrajectoryId = dbId;

        let dbStepCount = null;
        try {
          const { getDB } = await import('../../../config/database.js');
          const row = await getDB()('trajectory').where({ id: dbId }).first();
          dbStepCount = row?.step_count ?? null;
          console.log(`[save-trajectory] DB trajectory id=${dbId} step_count=${dbStepCount}`);
        } catch (e) {
          console.warn('[save-trajectory] could not read back step_count:', e.message);
        }

        if (data.form_file) {
          try {
            await persistFormSnapshotsFromFile(data.form_file, { trajectoryId: dbId });
          } catch (formErr) {
            console.warn('[save-trajectory] form_snapshot DB write failed:', formErr.message);
          }
        }

        gb.lastActionLog = [];
        session.lastActionLog = [];

        return res.json({
          trajectoryDbId: dbId,
          sessionId: id,
          dbId,
          steps: dbStepCount ?? (jsonSteps || actionCount),
          actions: actionCount,
          dbStepCount,
          isSuccessful: data.is_successful ?? null,
          action_file: actionFile,
          log_file: data.log_file,
          action_count: data.action_count ?? actionCount,
          log_count: data.log_count,
          storage: 'db',
        });
      } catch (err) {
        return res.status(500).json({ error: `Trajectory save error: ${err.message}` });
      }
    }

    // Executor path: WS event instead of local stdin/stdout
    if (session.useExecutor) {
      try {
        const resultP = execSession.waitForSessionEvent(id, 'save_trajectory_result', 30000);
        writeAgentEvent(session, 'save_trajectory', {});
        const data = await resultP;
        return finalizeSave(data);
      } catch (err) {
        // Fallback: persist whatever live ACTION_LOG we already have
        if (Array.isArray(session.lastActionLog) && session.lastActionLog.length) {
          console.warn('[save-trajectory] executor save timed out; persisting live ACTION_LOG:', err.message);
          return finalizeSave({
            success: true,
            action_count: session.lastActionLog.length,
            is_done: null,
            is_successful: null,
          });
        }
        return res.status(504).json({ error: err.message || 'Timeout waiting for trajectory' });
      }
    }

    try {
      gb.stdin.write(JSON.stringify({ event: 'save_trajectory' }) + '\n');
    } catch (err) {
      return res.status(503).json({ error: `Browser not ready: ${err.message}` });
    }

    const timeout = setTimeout(() => {
      cleanupTrajListener();
      if (!res.writableEnded) res.status(504).json({ error: 'Timeout waiting for trajectory' });
    }, 30000);
    let pendingBuffer = '';

    const onStdout = async (chunk) => {
      pendingBuffer += chunk.toString();
      const lines = pendingBuffer.split('\n');
      pendingBuffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.event === 'save_trajectory_result') {
            clearTimeout(timeout);
            cleanupTrajListener();
            return finalizeSave(msg.data || {});
          }
        } catch {}
      }
    };

    function cleanupTrajListener() { gb.process?.stdout?.removeListener('data', onStdout); }
    gb.process.stdout.on('data', onStdout);
  });

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

  app.post('/api/browser/watcher/action', async (req, res) => {
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
  });

  // ── WebSocket 消息处理（通过 ws-server 的 onWsMessage 注册） ──
  onWsMessage((ws, msg) => {
    if (msg.type === 'session:step') {
      const { sessionId, task, maxSteps, caseDataFile, phaseNumber, trajectoryDbId } = msg.payload || {};
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
      executeAgentStep({ session, task, maxSteps: maxSteps || 40, caseDataFile, phaseNumber, trajectoryDbId, channel });
    }
  });
}
