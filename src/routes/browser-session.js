import { writeFileSync, existsSync, unlinkSync, readFileSync } from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { LLM_BASE_URL, LLM_API_KEY, PORT, PROJECT_DIR } from '../../config/config.js';
import { state } from '../state.js';
import { saveTrajectoryRecord } from '../trajectory-store.js';
import { saveCaseDataRecord } from '../case-data-store.js';
import { persistSessionTrajectory, getTrajectoryActionFlow, upsertPhaseDescription, appendRecordedStep } from '../services/trajectory-service.js';
import { persistSessionCaseData, persistFormSnapshotsFromFile } from '../services/case-data-service.js';
import { broadcast, onWsMessage } from '../ws-server.js';
import {
  refreshCdpEndpoints, clearCdpEndpoints, detachLive, getRemoteStatus, initRemoteBridgeWs,
  notifyManualRecordingChanged,
} from '../cdp/remote-bridge.js';
import {
  PYTHON_EXE, AGENT_SCRIPT, killTree, killOrphans,
  waitForReady, isProcessAlive, spawnAgent, setupSSE, createPushChannel, resolveModelId,
} from './explore-utils.js';

function broadcastSessions() {
  const gb = state.globalBrowser;
  const list = [];
  for (const [id, s] of state.sessions) {
    list.push({
      sessionId: id, model: s.model, stepIndex: s.stepIndex,
      busy: gb.busy, createdAt: s.createdAt, stepCount: s.trajectories.length,
    });
  }
  broadcast('sessions:updated', { sessions: list });
}

function broadcastWatcherStatus() {
  const gb = state.globalBrowser;
  broadcast('watcher:status', {
    connected: !!(gb.ready && gb.stdin),
    agentBusy: gb.busy,
    cdpReady: !!(gb.cdpWsUrl || gb.cdpHttp),
    cdpHttp: gb.cdpHttp || null,
  });
  broadcast('remote:status', getRemoteStatus());
}

async function ensureCdpDiscovered() {
  const gb = state.globalBrowser;
  if (gb.cdpWsUrl) return;
  try {
    await refreshCdpEndpoints();
  } catch (e) {
    console.warn('[browser-global] CDP discover failed:', e.message);
  }
}

async function teardownRemoteBridge() {
  try { await detachLive({ crashed: true }); } catch {}
  clearCdpEndpoints();
}

async function ensureGlobalBrowser(modelId) {
  const gb = state.globalBrowser;
  if (isProcessAlive(gb.process)) {
    if (!gb.ready) await waitForReady(gb.process, 15000);
    await ensureCdpDiscovered();
    return;
  }
  gb.process = null;
  gb.stdin = null;
  gb.ready = false;
  gb.busy = false;
  gb.stepIndex = 0;
  gb.cdpHttp = null;
  gb.cdpWsUrl = null;
  gb.cdpPort = null;
  killOrphans();

  const child = spawnAgent(['--session', '--session-id', 'global', '--model', modelId, '--base-url', `http://localhost:${PORT}/v1`, '--api-key', LLM_API_KEY], { OPENAI_API_KEY: LLM_API_KEY });

  child.stderr.on('data', (chunk) => { console.log(chunk.toString().trimEnd()); });
  child.on('exit', () => {
    gb.process = null; gb.stdin = null; gb.ready = false; gb.busy = false; gb.stepIndex = 0;
    teardownRemoteBridge().finally(() => broadcastWatcherStatus());
    console.log('[browser-global] Agent process exited');
  });

  gb.process = child;
  gb.stdin = child.stdin;
  gb.model = modelId;
  gb.lastActionLog = [];

  child.stdin.on('error', () => {
    if (!gb.ready) return;
    gb.process = null; gb.stdin = null; gb.ready = false; gb.busy = false; gb.stepIndex = 0;
    teardownRemoteBridge().finally(() => broadcastWatcherStatus());
  });

  try {
    await waitForReady(child, 15000);
    gb.ready = true;
    await ensureCdpDiscovered();
    broadcastWatcherStatus();
    console.log('[browser-global] Browser ready');

    // Persistent stdout listener: always forward action_log_sync events
    // regardless of which handler (step, CDP, etc.) is active
    let syncBuf = '';
    child.stdout.on('data', (chunk) => {
      syncBuf += chunk.toString();
      const lines = syncBuf.split('\n');
      syncBuf = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.event === 'action_log_sync') {
            gb.lastActionLog = msg.data?.entries || [];
            broadcast('action_log_sync', {
              ...(msg.data || {}),
              sessionId: [...state.sessions.keys()][0] || null,
            });
          } else if (msg.event === 'manual_action_recorded') {
            const entry = msg.data?.entry;
            gb.lastActionLog = Array.isArray(gb.lastActionLog) ? gb.lastActionLog : [];
            if (entry) {
              // Keep in-memory pending list in sync even if action_log_sync is delayed
              const idx = gb.lastActionLog.findIndex((e) => e.id && entry.id && e.id === entry.id);
              if (idx < 0) gb.lastActionLog.push(entry);
            }
            broadcast('manual_action_recorded', msg.data || {});
            // Live-persist only when「自动入库」is on
            const session = [...state.sessions.values()][0];
            const trajId = session?.dbTrajectoryId != null ? Number(session.dbTrajectoryId) : null;
            const autoPersist = !!(session?.autoPersist ?? gb.autoPersist);
            if (autoPersist && Number.isFinite(trajId) && entry) {
              appendRecordedStep(trajId, entry, { source: 'manual' })
                .then((persisted) => {
                  if (session) {
                    if (!session.persistedActionIds) session.persistedActionIds = new Set();
                    if (entry.id) session.persistedActionIds.add(String(entry.id));
                  }
                  if (persisted) {
                    broadcast('manual_action_persisted', {
                      trajectoryDbId: trajId,
                      ...persisted,
                      entry,
                    });
                  }
                })
                .catch((err) => console.warn('[manual-record] live persist failed:', err.message));
            }
          } else if (msg.event === 'manual_record_status') {
            gb.manualRecording = !!msg.data?.enabled;
            if (gb.manualRecording) notifyManualRecordingChanged(true);
            broadcast('manual_record_status', {
              ...(msg.data || {}),
              sessionId: [...state.sessions.keys()][0] || null,
            });
          }
        } catch {}
      }
    });
  } catch (err) {
    killTree(child.pid);
    setTimeout(() => killOrphans(), 2000);
    gb.process = null; gb.stdin = null;
    throw err;
  }
}

function handleSessionMessage(channel, session, stepIndex, gb, cleanupListener) {
  return (msg) => {
    const send = channel.send;
    switch (msg.event) {
      case 'step':
        send('step', msg.data);
        send('status', { phase: 'exploring', label: `Step ${msg.data.step}: ${msg.data.next_goal || 'thinking...'}` });
        break;
      case 'phase_start':
        send('phase_start', msg.data);
        send('status', { phase: 'session_step', label: `Step ${msg.data.phase}: ${msg.data.name}`, currentStep: msg.data.phase });
        break;
      case 'phase_done': {
        const trajectoryFile = msg.data?.trajectory_file;
        session.stepIndex = msg.data?.step_index || stepIndex;
        session.trajectories.push({ step: session.stepIndex, path: trajectoryFile || '', time: new Date().toISOString() });
        send('phase_done', msg.data);
        send('status', { phase: 'step_done', label: `Step ${session.stepIndex} completed` });
        gb.busy = false;
        broadcastSessions();
        broadcastWatcherStatus();
        send('done', { stepIndex: session.stepIndex, success: true });
        channel.end();
        cleanupListener();
        break;
      }
      case 'phase_error':
        send('status', { phase: 'error', label: `Step failed: ${msg.data.message}` });
        gb.busy = false;
        broadcastWatcherStatus();
        send('done', { stepIndex, success: false, error: msg.data.message });
        channel.end();
        cleanupListener();
        break;
      case 'error':
        send('error', msg.data);
        gb.busy = false;
        broadcastWatcherStatus();
        send('done', { stepIndex, success: false, error: msg.data.message || 'Agent error' });
        channel.end();
        cleanupListener();
        break;
      case 'nav_step':
        send('status', { phase: 'navigating', label: msg.data.label });
        break;
      case 'intervention_needed':
        send('intervention_needed', msg.data);
        break;
      case 'intervention_resolved':
        send('intervention_resolved', msg.data);
        break;
      case 'action_log_sync':
        send('action_log_sync', msg.data);
        break;
    }
  };
}

export default function (app) {
  app.post('/api/browser/session', async (req, res) => {
    const { model } = req.body || {};
    if (!existsSync(PYTHON_EXE)) return res.status(500).json({ error: `Python not found at ${PYTHON_EXE}` });
    if (!existsSync(AGENT_SCRIPT)) return res.status(500).json({ error: `Agent script not found at ${AGENT_SCRIPT}` });

    const sessionId = crypto.randomUUID();
    const modelId = resolveModelId(model);

    try { await ensureGlobalBrowser(modelId); } catch (err) { return res.status(500).json({ error: err.message }); }

    const gb = state.globalBrowser;
    state.sessions.set(sessionId, { sessionId, stepIndex: 0, trajectories: [], createdAt: new Date().toISOString(), model: gb.model, lastTask: null, lastMaxSteps: null, caseDataFile: null });
    console.log(`[browser-session] Created session ${sessionId} (shared browser)`);
    broadcastSessions();
    broadcastWatcherStatus();
    res.json({ sessionId, model: gb.model });
  });

  // ── Shared: execute a single step on the global browser agent ──
  // Callers: HTTP+SSE handler (POST /step) and WebSocket handler
  function executeAgentStep({ session, task, maxSteps, caseDataFile, phaseNumber, trajectoryDbId, channel }) {
    const gb = state.globalBrowser;
    if (gb.busy) return channel.send('error', { message: 'Browser is busy executing a step' });
    if (!gb.ready || !gb.stdin) return channel.send('error', { message: 'Browser not ready' });

    if (caseDataFile) session.caseDataFile = caseDataFile;
    gb.busy = true;
    broadcastWatcherStatus();

    let aborted = false;

    channel.onAbort(() => {
      aborted = true;
      if (gb.busy) {
        const cancelFile = path.join(os.tmpdir(), 'browser_use_cancel_global');
        try { writeFileSync(cancelFile, 'cancel'); } catch {}
        try { gb.stdin.write(JSON.stringify({ event: 'cancel_step' }) + '\n'); } catch {}
        gb.busy = false;
      }
      cleanupListeners();
    });

    const stepIndex = session.stepIndex + 1;
    session.lastTask = task;
    session.lastMaxSteps = maxSteps || 40;
    if (phaseNumber != null) session.lastPhaseNumber = phaseNumber;

    // Bind trajectory + remember phase task for phase.description
    const resolvedTrajId = trajectoryDbId != null && trajectoryDbId !== ''
      ? Number(trajectoryDbId)
      : (session.dbTrajectoryId != null ? Number(session.dbTrajectoryId) : null);
    if (Number.isFinite(resolvedTrajId)) session.dbTrajectoryId = resolvedTrajId;

    const pn = phaseNumber != null ? Number(phaseNumber) : stepIndex;
    if (Number.isFinite(pn) && task) {
      if (!session.phaseDescriptions) session.phaseDescriptions = {};
      session.phaseDescriptions[String(pn)] = String(task);
      // Write description immediately so it does not depend on later「保存轨迹」payload
      if (Number.isFinite(resolvedTrajId)) {
        upsertPhaseDescription(resolvedTrajId, pn, task).catch((err) => {
          console.warn('[session-step] upsertPhaseDescription failed:', err.message);
        });
      }
    }

    const cancelFlagPath = path.join(os.tmpdir(), 'browser_use_cancel_global');
    try { if (existsSync(cancelFlagPath)) unlinkSync(cancelFlagPath); } catch {}

    try {
      const stepData = { instruction: task, max_steps: maxSteps || 40 };
      if (session.caseDataFile) stepData.case_data_file = session.caseDataFile;
      // Prefer UI phase number so _ACTION_LOG.phase matches 【阶段N】 and DB trajectory_phase
      if (Number.isFinite(pn)) stepData.phase_number = pn;
      gb.stdin.write(JSON.stringify({ event: 'step', data: stepData }) + '\n');
    } catch (writeErr) {
      gb.busy = false;
      channel.send('error', { message: `Failed to write step to agent: ${writeErr.message}` });
      channel.end();
      return;
    }

    let pendingBuffer = '';
    const handleMsg = handleSessionMessage(channel, session, stepIndex, gb, cleanupListeners);

    function onStdout(chunk) {
      if (aborted) return;
      pendingBuffer += chunk.toString();
      const lines = pendingBuffer.split('\n');
      pendingBuffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try { handleMsg(JSON.parse(line)); } catch {}
      }
    }

    function cleanupListeners() {
      try { gb.process.stdout.removeListener('data', onStdout); } catch {}
      try { gb.process.removeListener('exit', onProcessExit); } catch {}
    }

    function onProcessExit(code) {
      if (aborted) return;
      aborted = true;
      gb.busy = false;
      channel.send('error', { message: `Agent process exited unexpectedly (code ${code})` });
      channel.end();
      cleanupListeners();
    }

    gb.process.stdout.on('data', onStdout);
    gb.process.on('exit', onProcessExit);
  }

  app.post('/api/browser/session/:id/step', async (req, res) => {
    const { id } = req.params;
    const { task, maxSteps, caseDataFile, phaseNumber, trajectoryDbId } = req.body || {};
    const gb = state.globalBrowser;
    if (!task) return res.status(400).json({ error: 'task is required' });

    const session = state.sessions.get(id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const channel = createPushChannel(null, res);
    setupSSE(res);  // sets headers
    executeAgentStep({ session, task, maxSteps, caseDataFile, phaseNumber, trajectoryDbId, channel });
  });

  app.post('/api/browser/session/:id/continue', async (req, res) => {
    const { id } = req.params;
    const session = state.sessions.get(id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!session.lastTask) return res.status(400).json({ error: 'No previous task to continue' });
    req.body = { task: session.lastTask, maxSteps: session.lastMaxSteps };
    req.params.id = id;
    const stepRoute = app._router.stack.find(r => r.route && r.route.path === '/api/browser/session/:id/step' && r.route.methods.post);
    if (stepRoute) stepRoute.handle(req, res);
    else res.status(500).json({ error: 'Step handler not found' });
  });

  // ── Helper: wait for a specific event from the agent process stdout ──
  function waitForAgentEvent(eventName, timeoutMs = 60000) {
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

    // Construct resume instruction from action + log files
    let resumeInstruction = '';
    let replayedCount = 0;
    try {
      const actionData = JSON.parse(readFileSync(absActionPath, 'utf-8'));
      const url = actionData.url || '';
      const commands = actionData?.tests?.[0]?.commands || actionData?.actions || [];
      const remaining = commands.filter((c, i) => (i + 1) >= failedStep);

      // ── CDP Replay phase: replay pre-failure actions to reproduce page state ──
      const preFailure = commands.filter((c, i) => (i + 1) < failedStep);
      if (preFailure.length > 0) {
        const gb = state.globalBrowser;
        if (gb.ready && gb.stdin) {
          try {
            gb.stdin.write(JSON.stringify({
              event: 'replay_actions',
              data: { actions: preFailure },
            }) + '\n');
            const replayResult = await waitForAgentEvent('replay_done', 120000);
            replayedCount = replayResult.count || 0;
            console.log(`[rerun] Replay done: ${replayedCount} actions executed via CDP`);
          } catch (e) {
            console.log(`[rerun] Replay error (continuing with heal): ${e.message}`);
          }
        }
      }

      // Load heal prompt template
      const healPromptPath = path.resolve(PROJECT_DIR, 'scripts', 'prompts', 'heal-prompt.md');
      let template = '';
      try {
        template = existsSync(healPromptPath) ? readFileSync(healPromptPath, 'utf-8') : '';
      } catch (_) {}

      // Build URL section
      const replayNote = replayedCount > 0
        ? `当前页面已通过 CDP 自动回放了前 ${replayedCount} 步操作，处于第 ${failedStep} 步的待操作状态。无需重复导航和登录，直接扫描当前表单，建立任务清单，从第 ${failedStep} 步开始继续填写。\n\n`
        : '';
      const urlSection = replayedCount > 0
        ? replayNote
        : (url && !url.includes('unknown'))
          ? '【目标URL】\n' + url + '\n\n'
          : '';

      // Build form changes section
      let formChangesSection = '';
      if (form_changes) {
        const changesList = Array.isArray(form_changes) ? form_changes : [form_changes];
        for (const change of changesList) {
          const container = change.container || 'main';
          const containerInfo = container !== 'main' ? ` (容器: ${container})` : '';
          const missing_required = change.missing_required || [];
          const added_required = change.added_required || [];
          const missing_optional = change.missing_optional || [];
          const added_optional = change.added_optional || [];
          const isWarning = missing_required.length === 0 && added_required.length === 0;

          if (isWarning) {
            if (missing_optional.length || added_optional.length) {
              formChangesSection += `【P3 FORM WARNING: 可选字段变化${containerInfo}（仅参考）】\n`;
              if (missing_optional.length) {
                formChangesSection += '  已移除的可选字段：' + missing_optional.map(f => '"' + f + '"').join('、') + '\n';
              }
              if (added_optional.length) {
                formChangesSection += '  新增的可选字段：' + added_optional.map(f => '"' + f + '"').join('、') + '\n';
              }
              formChangesSection += '\n';
            } else if (change.reordered) {
              formChangesSection += `【P4 FORM WARNING: 字段顺序变化${containerInfo}（仅参考）】\n\n`;
            }
          } else {
            formChangesSection += `【P2 FORM ERROR: 必填字段变化${containerInfo}（导致脚本失败，需自愈修复）】\n`;
            if (missing_required.length) {
              formChangesSection += '  已从表单中移除的必填字段（无需填写，跳过）：\n';
              missing_required.forEach(f => formChangesSection += '    - "' + f + '"\n');
            }
            if (added_required.length) {
              formChangesSection += '  表单中新增的必填字段（必须扫描页面找到并填写）：\n';
              added_required.forEach(f => formChangesSection += '    - "' + f + '"\n');
            }
            if (missing_optional.length || added_optional.length) {
              formChangesSection += '  附：可选字段变化 — 移除：' + (missing_optional.map(f => '"' + f + '"').join('、') || '无') + ' | 新增：' + (added_optional.map(f => '"' + f + '"').join('、') || '无') + '\n';
            }
            formChangesSection += '\n';
          }
        }
      }

      // Build remaining commands
      let remainingCmds = '';
      for (const cmd of remaining) {
        const stepNum = commands.indexOf(cmd) + 1;
        const a = cmd.action || ''; const p = cmd.params || {};
        if (a === 'fill_form_field') remainingCmds += '- Step ' + stepNum + ': 填写 "' + (p.label_text || '') + '" = "' + (p.value || '') + '"\n';
        else if (a === 'select_option') remainingCmds += '- Step ' + stepNum + ': 在 "' + (p.label_text || '') + '" 中选择 "' + (p.option_text || '') + '"\n';
        else if (a === 'click_element_by_index') remainingCmds += '- Step ' + stepNum + ': 点击 "' + (p.text || p.index || '') + '"\n';
        else remainingCmds += '- Step ' + stepNum + ': ' + a + '\n';
      }

      // Build log section
      let logSection = '';
      if (log_file) {
        const logPath = path.resolve(PROJECT_DIR, log_file);
        if (existsSync(logPath)) {
          const logContent = readFileSync(logPath, 'utf-8');
          if (logContent.trim()) {
            logSection = '\n---\n\n## 文件说明\n\n以下包含两份文件，供你理解任务上下文：\n\n' +
              '### 截断的 Action 文件（上方操作步骤列表）\n' +
              '- 来源于原始脚本从第 ' + failedStep + ' 步开始截断后的剩余操作步骤。\n' +
              '- 这是原始脚本期望执行的步骤（可能已不适用于当前页面状态，仅供参考业务意图）。\n' +
              '- 你需要根据下方 Log 文件中的完整上下文，理解原始录制的正确操作流程。\n\n' +
              '### 完整的 Log 文件（下方日志内容）\n' +
              '- 来源于原始录制时完整成功执行的过程日志，包含完整的导航路径和所有成功操作。\n' +
              '- 请参照 Log 中的完整操作序列来理解业务目标、导航步骤和正确的操作方式。\n' +
              '- 复现失败场景后，请根据 Log 中的业务意图重新填写表单。\n\n' +
              '## 原始执行日志\n```\n' + logContent.trim() + '\n```\n';
          }
        }
      }

      // Assemble from template
      if (template) {
        resumeInstruction = template
          .replace('{{URL_SECTION}}', urlSection)
          .replace('{{FORM_CHANGES_SECTION}}', formChangesSection)
          .replace('{{FAILED_STEP}}', String(failedStep))
          .replace('{{REMAINING_COMMANDS}}', remainingCmds || '(无剩余操作步骤)')
          .replace('{{LOG_SECTION}}', logSection);
        if (replayedCount > 0) {
          resumeInstruction = resumeInstruction.replace('逐步导航并复现失败场景，抵达出错页面后，', '');
        }
      } else {
        // Fallback: build inline
        const lines = [];
        if (urlSection) lines.push(urlSection.trim());
        if (replayedCount === 0) lines.push('当前为脚本执行失败后的自愈修复阶段。请根据下方操作步骤与 Log 文件，逐步导航并复现失败场景，抵达出错页面后，扫描当前表单，建立任务清单，重新填写所有表单项。');
        if (formChangesSection) lines.push('\n' + formChangesSection.trim());
        lines.push('\n## 剩余操作步骤（从第 ' + failedStep + ' 步开始）');
        lines.push(remainingCmds || '(无剩余操作步骤)');
        if (logSection) lines.push(logSection.trim());
        resumeInstruction = lines.join('\n');
      }
    } catch (e) {
      resumeInstruction = 'Continue recording from step ' + failedStep + '. See action file for details.';
    }

    // Forward to step handler (it handles SSE, agent communication)
    req.body = { task: resumeInstruction, maxSteps: maxSteps || 40 };
    const stepRoute = app._router.stack.find(r => r.route && r.route.path === '/api/browser/session/:id/step' && r.route.methods.post);
    if (stepRoute) {
      stepRoute.handle(req, res);
    } else {
      res.status(500).json({ error: 'Step handler not found' });
    }
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

  app.delete('/api/browser/session/:id', (req, res) => {
    const { id } = req.params;
    const session = state.sessions.get(id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

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
   * Query: ?trajectoryId=<numeric trajectory.id>
   */
  app.get('/api/browser/session/:id/action-flow', async (req, res) => {
    const { id } = req.params;
    const session = state.sessions.get(id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const trajectoryDbId = req.query.trajectoryId != null && req.query.trajectoryId !== ''
      ? Number(req.query.trajectoryId)
      : (session.dbTrajectoryId != null ? Number(session.dbTrajectoryId) : null);

    const gb = state.globalBrowser;
    let pending = Array.isArray(gb.lastActionLog) ? gb.lastActionLog : [];

    if (gb.ready && gb.stdin && !gb.busy) {
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
    if (gb.busy) return res.status(409).json({ error: 'Browser is busy executing a step' });
    if (!gb.stdin) return res.status(503).json({ error: 'Browser not ready' });
    gb.stdin.write(JSON.stringify({ event: 'save_trajectory' }) + '\n');

    const timeout = setTimeout(() => { cleanupTrajListener(); if (!res.writableEnded) res.status(504).json({ error: 'Timeout waiting for trajectory' }); }, 30000);
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
            console.log('[save-trajectory] Python response:', JSON.stringify(msg.data, null, 2));
            if (!msg.data.success) return res.status(500).json({ error: msg.data.message || 'Failed to save trajectory' });
            const trajectoryFile = msg.data.trajectory_file;
            const actionFile = msg.data.action_file;
            console.log('[save-trajectory] actionFile:', actionFile, 'trajectoryFile:', trajectoryFile);
            // DB is primary. action_file (ACTION_LOG dump) is enough; native traj JSON optional.
            if (!actionFile && !trajectoryFile) {
              return res.status(500).json({ error: 'No action_file or trajectory_file from agent' });
            }
            try {
              if (!session.persistedActionIds) session.persistedActionIds = new Set();

              // Optional legacy JSON index — never block save if it fails
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
                    exploreMeta: { is_done: msg.data.is_done, is_successful: msg.data.is_successful },
                  });
                  flow = f || [];
                  jsonSteps = record?.stepCount || 0;
                }
              } catch (jsonErr) {
                console.warn('[save-trajectory] legacy JSON store skipped:', jsonErr.message);
              }
              const actionCount = msg.data.action_count
                ?? flow.filter(s => s.type !== 'done' && !s.error).length;

              const dbId = await persistSessionTrajectory({
                id: Number.isFinite(resolvedTrajId) ? resolvedTrajId : undefined,
                task: task || '',
                model: session.model,
                url: msg.data.url || '',
                isDone: msg.data.is_done,
                isSuccessful: msg.data.is_successful,
                actionFile: actionFile || null,
                flow,
                logFile: msg.data.log_file || null,
                phaseDescriptions: mergedPhaseDescriptions,
                excludeActionIds: session.persistedActionIds,
                ...(Number.isFinite(resolvedFunctionId) ? { functionId: resolvedFunctionId } : {}),
              });
              if (dbId != null) session.dbTrajectoryId = dbId;

              let dbStepCount = null;
              try {
                const { getDB } = await import('../../config/database.js');
                const row = await getDB()('trajectory').where({ id: dbId }).first();
                dbStepCount = row?.step_count ?? null;
                console.log(`[save-trajectory] DB trajectory id=${dbId} step_count=${dbStepCount}`);
              } catch (e) {
                console.warn('[save-trajectory] could not read back step_count:', e.message);
              }

              if (msg.data.form_file) {
                try {
                  await persistFormSnapshotsFromFile(msg.data.form_file, { trajectoryId: dbId });
                } catch (formErr) {
                  console.warn('[save-trajectory] form_snapshot DB write failed:', formErr.message);
                }
              }

              gb.lastActionLog = [];

              return res.json({
                trajectoryDbId: dbId,
                sessionId: id,
                dbId,
                steps: dbStepCount ?? (jsonSteps || actionCount),
                actions: actionCount,
                dbStepCount,
                isSuccessful: msg.data.is_successful ?? null,
                action_file: actionFile,
                log_file: msg.data.log_file,
                action_count: msg.data.action_count,
                log_count: msg.data.log_count,
                storage: 'db',
              });
            } catch (err) { return res.status(500).json({ error: `Trajectory save error: ${err.message}` }); }
          }
        } catch {}
      }
    };

    function cleanupTrajListener() { gb.process.stdout.removeListener('data', onStdout); }
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

  app.get('/api/browser/watcher/status', (req, res) => {
    const gb = state.globalBrowser;
    const session = [...state.sessions.values()][0];
    const connected = !!(gb.ready && gb.stdin);
    res.json({
      connected,
      agentBusy: gb.busy,
      cdpReady: !!(gb.cdpWsUrl || gb.cdpHttp),
      cdpHttp: gb.cdpHttp || null,
      manualRecording: !!gb.manualRecording,
      autoPersist: !!(session?.autoPersist ?? gb.autoPersist),
      remote: getRemoteStatus(),
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
   * Body: { enabled: boolean, trajectoryDbId?, sessionId? }
   */
  app.post('/api/browser/session/:id/manual-record', async (req, res) => {
    const { id } = req.params;
    const { enabled, trajectoryDbId } = req.body || {};
    const session = state.sessions.get(id);
    const gb = state.globalBrowser;
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!gb.ready || !gb.stdin) return res.status(503).json({ error: 'Browser not ready' });

    if (trajectoryDbId != null && trajectoryDbId !== '') {
      session.dbTrajectoryId = Number(trajectoryDbId);
    }

    const event = enabled ? 'manual_record_start' : 'manual_record_stop';
    try {
      gb.stdin.write(JSON.stringify({ event }) + '\n');
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }

    // Wait briefly for status ack
    const status = await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve({ enabled: !!enabled, timedOut: true }), 5000);
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
      error: status.error || null,
    });
  });

  app.post('/api/browser/watcher/action', async (req, res) => {
    try {
      const gb = state.globalBrowser;
      if (!gb.ready || !gb.stdin) return res.status(503).json({ error: 'Agent not ready. Start a session first.' });
      if (!gb.process || !gb.process.stdout) return res.status(503).json({ error: 'Agent process not available' });

      const { action, params, trajectoryDbId, sessionId, source } = req.body || {};
      if (!action) return res.status(400).json({ error: 'action is required' });

      // Resolve session + trajectory for live persist
      const session = sessionId ? state.sessions.get(sessionId) : null;
      const resolvedTrajId = trajectoryDbId != null && trajectoryDbId !== ''
        ? Number(trajectoryDbId)
        : (session?.dbTrajectoryId != null ? Number(session.dbTrajectoryId) : null);

      // Wait up to 5s for agent to not be busy (quick actions need idle browser)
      const deadline = Date.now() + 5000;
      while (gb.busy && Date.now() < deadline) { await new Promise(r => setTimeout(r, 200)); }

      const reqId = crypto.randomUUID().slice(0, 8);

      // Set up one-shot listener for the result
      const result = await new Promise((resolve) => {
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

        // Send after listener is attached
        try {
          gb.stdin.write(JSON.stringify({ event: 'cdp_action', data: { id: reqId, action, params: params || [] } }) + '\n');
        } catch (err) {
          cleanup();
          resolve({ error: String(err) });
        }
      });

      if (result.error) {
        return res.status(500).json({ error: result.error, action, params });
      }

      // Live-persist CDP action only when「自动入库」is on
      let persisted = null;
      const bodyAuto = req.body && typeof req.body.autoPersist === 'boolean'
        ? req.body.autoPersist
        : null;
      const autoPersist = !!(bodyAuto !== null
        ? bodyAuto
        : (session?.autoPersist ?? gb.autoPersist));
      if (session) session.autoPersist = autoPersist;
      gb.autoPersist = autoPersist;
      if (autoPersist && Number.isFinite(resolvedTrajId) && result.entry) {
        try {
          const stepSource = source || result.entry.source || 'cdp';
          persisted = await appendRecordedStep(resolvedTrajId, result.entry, { source: stepSource });
          if (session) {
            if (!session.persistedActionIds) session.persistedActionIds = new Set();
            if (result.entry.id) session.persistedActionIds.add(String(result.entry.id));
            session.dbTrajectoryId = resolvedTrajId;
          }
        } catch (dbErr) {
          console.warn('[watcher-action] live DB persist failed:', dbErr.message);
        }
      } else if (session && Number.isFinite(resolvedTrajId)) {
        session.dbTrajectoryId = resolvedTrajId;
      }

      res.json({
        status: 'executed',
        action,
        params,
        result: result.result,
        trajectoryDbId: Number.isFinite(resolvedTrajId) ? resolvedTrajId : null,
        autoPersist: !!autoPersist,
        persisted,
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