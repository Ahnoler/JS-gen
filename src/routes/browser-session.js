import { writeFileSync, existsSync, unlinkSync, readFileSync } from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import http from 'http';
import { spawn, execSync } from 'child_process';
import { STANDALONE_LLM, LLM_BASE_URL, LLM_API_KEY, PORT, PROJECT_DIR, SKILL_DIR } from '../config.js';
import { state } from '../state.js';
import { createTrajectoryId, saveTrajectoryRecord } from '../trajectory-store.js';
import { saveCaseDataRecord } from '../case-data-store.js';
import {
  PYTHON_EXE, AGENT_SCRIPT, killTree, killOrphans,
  waitForReady, isProcessAlive, spawnAgent, setupSSE, resolveModelId,
} from './explore-utils.js';

async function ensureGlobalBrowser(modelId) {
  const gb = state.globalBrowser;
  if (isProcessAlive(gb.process)) {
    if (!gb.ready) await waitForReady(gb.process, 15000);
    return;
  }
  gb.process = null;
  gb.stdin = null;
  gb.ready = false;
  gb.busy = false;
  gb.stepIndex = 0;
  killOrphans();

  const child = spawnAgent(['--session', '--session-id', 'global', '--model', modelId, '--base-url', `http://localhost:${PORT}/v1`, '--api-key', LLM_API_KEY], { OPENAI_API_KEY: LLM_API_KEY });

  child.stderr.on('data', (chunk) => { console.log('[browser-global stderr] ' + chunk.toString().trimEnd()); });
  child.on('exit', () => {
    gb.process = null; gb.stdin = null; gb.ready = false; gb.busy = false; gb.stepIndex = 0;
    console.log('[browser-global] Process exited');
  });

  gb.process = child;
  gb.stdin = child.stdin;
  gb.model = modelId;

  child.stdin.on('error', () => {
    if (!gb.ready) return;
    gb.process = null; gb.stdin = null; gb.ready = false; gb.busy = false; gb.stepIndex = 0;
  });

  try {
    await waitForReady(child, 15000);
    gb.ready = true;
    console.log('[browser-global] Browser ready');
  } catch (err) {
    killTree(child.pid);
    setTimeout(() => killOrphans(), 2000);
    gb.process = null; gb.stdin = null;
    throw err;
  }
}

function handleSessionMessage(send, session, stepIndex, gb, res, cleanupListener) {
  return (msg) => {
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
        send('done', { stepIndex: session.stepIndex, success: true });
        if (!res.writableEnded) res.end();
        cleanupListener();
        break;
      }
      case 'phase_error':
        send('status', { phase: 'error', label: `Step failed: ${msg.data.message}` });
        gb.busy = false;
        send('done', { stepIndex, success: false, error: msg.data.message });
        if (!res.writableEnded) res.end();
        cleanupListener();
        break;
      case 'error':
        send('error', msg.data);
        gb.busy = false;
        if (!res.writableEnded) res.end();
        cleanupListener();
        break;
      case 'nav_step':
        send('status', { phase: 'navigating', label: msg.data.label });
        break;
      // Rerun pipeline events
      case 'rerun_start':
        send('rerun_start', msg.data);
        send('status', { phase: 'rerun', label: `Replaying ${msg.data.prefix_entries} history entries to step ${msg.data.failed_step}...` });
        break;
      case 'rerun_replay_done':
        send('rerun_replay_done', msg.data);
        send('status', { phase: 'rerun', label: 'Prefix replay complete — browser at error scene' });
        break;
      case 'rerun_replay_error':
        send('rerun_replay_error', msg.data);
        send('status', { phase: 'rerun', label: `Replay error: ${msg.data.message}` });
        break;
      case 'rerun_resume':
        send('rerun_resume', msg.data);
        send('status', { phase: 'rerun', label: `Resuming recording: ${msg.data.instruction?.slice(0, 60) || ''}` });
        break;
      case 'rerun_validate':
        send('rerun_validate', msg.data);
        send('status', { phase: 'rerun', label: msg.data.passed ? `Validation passed — ${msg.data.new_actions} actions recorded` : `Validation FAILED — agent completed but actions may be incomplete` });
        break;
      case 'rerun_done':
        send('rerun_done', msg.data);
        send('status', { phase: 'done', label: msg.data.validated !== false ? `Rerun complete — ${msg.data.new_actions} actions merged → ${msg.data.merged_file || '(none)'}` : 'Rerun complete — validation failed, not merged' });
        gb.busy = false;
        if (!res.writableEnded) res.end();
        cleanupListener();
        break;
    }
  };
}

export default function (app) {
  app.post('/api/browser/session', async (req, res) => {
    const { model } = req.body || {};
    if (!STANDALONE_LLM && !state.client) return res.status(503).json({ error: 'opencode server not ready' });
    if (!existsSync(PYTHON_EXE)) return res.status(500).json({ error: `Python not found at ${PYTHON_EXE}` });
    if (!existsSync(AGENT_SCRIPT)) return res.status(500).json({ error: `Agent script not found at ${AGENT_SCRIPT}` });

    const sessionId = crypto.randomUUID();
    const modelId = resolveModelId(model);

    try { await ensureGlobalBrowser(modelId); } catch (err) { return res.status(500).json({ error: err.message }); }

    const gb = state.globalBrowser;
    state.sessions.set(sessionId, { sessionId, stepIndex: 0, trajectories: [], createdAt: new Date().toISOString(), model: gb.model, lastTask: null, lastMaxSteps: null, caseDataFile: null });
    console.log(`[browser-session] Created session ${sessionId} (shared browser)`);
    res.json({ sessionId, model: gb.model });
  });

  app.post('/api/browser/session/:id/step', async (req, res) => {
    const { id } = req.params;
    const { task, maxSteps, caseDataFile } = req.body || {};
    const gb = state.globalBrowser;
    if (!task) return res.status(400).json({ error: 'task is required' });

    const session = state.sessions.get(id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (gb.busy) return res.status(409).json({ error: 'Browser is busy executing a step' });
    if (!gb.ready || !gb.stdin) return res.status(503).json({ error: 'Browser not ready' });

    // Store case data paths in session (first step sets them)
    if (caseDataFile) session.caseDataFile = caseDataFile;

    gb.busy = true;
    const send = setupSSE(res);
    let aborted = false;

    res.on('close', () => {
      aborted = true;
      if (gb.busy) {
        const cancelFile = path.join(os.tmpdir(), `browser_use_cancel_global`);
        try { writeFileSync(cancelFile, 'cancel'); } catch {}
        try { gb.stdin.write(JSON.stringify({ event: 'cancel_step' }) + '\n'); } catch {}
        gb.busy = false;
      }
      cleanupListener();
    });

    const stepIndex = session.stepIndex + 1;
    session.lastTask = task;
    session.lastMaxSteps = maxSteps || 40;
    const cancelFlagPath = path.join(os.tmpdir(), 'browser_use_cancel_global');
    try { if (existsSync(cancelFlagPath)) unlinkSync(cancelFlagPath); } catch {}

    try {
      const stepData = { instruction: task, max_steps: maxSteps || 40 };
      if (session.caseDataFile) stepData.case_data_file = session.caseDataFile;
      gb.stdin.write(JSON.stringify({ event: 'step', data: stepData }) + '\n');
    } catch (writeErr) {
      gb.busy = false;
      send('error', { message: `Failed to write step to agent: ${writeErr.message}` });
      if (!res.writableEnded) res.end();
      return;
    }

    let pendingBuffer = '';
    const handleMsg = handleSessionMessage(send, session, stepIndex, gb, res, cleanupListener);

    const onStdout = (chunk) => {
      if (aborted) return;
      pendingBuffer += chunk.toString();
      const lines = pendingBuffer.split('\n');
      pendingBuffer = lines.pop() || '';
      for (const line of lines) { if (!line.trim()) continue; try { handleMsg(JSON.parse(line)); } catch {} }
    };

    function cleanupListener() {
      gb.process.stdout.removeListener('data', onStdout);
      gb.process.removeListener('exit', onProcessExit);
    }

    function onProcessExit(code) {
      if (aborted) return;
      aborted = true;
      gb.busy = false;
      if (!res.writableEnded) {
        send('error', { message: `Agent process exited unexpectedly (code ${code})` });
        res.end();
      }
      cleanupListener();
    }

    gb.process.stdout.on('data', onStdout);
    gb.process.on('exit', onProcessExit);
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

  // Self-healing: partial script (CDP) → agent re-records from failed step
  app.post('/api/browser/session/:id/rerun', async (req, res) => {
    const { id } = req.params;
    const { action_file, failedStep, maxSteps, log_file } = req.body || {};
    const gb = state.globalBrowser;

    const session = state.sessions.get(id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (gb.busy) return res.status(409).json({ error: 'Browser is busy' });
    if (!action_file) return res.status(400).json({ error: 'action_file is required' });
    if (!failedStep || failedStep <= 0) return res.status(400).json({ error: 'failedStep (> 0) is required' });

    const absActionPath = path.resolve(PROJECT_DIR, action_file);
    if (!existsSync(absActionPath)) return res.status(404).json({ error: `Action file not found: ${absActionPath}` });

    const send = setupSSE(res);
    let aborted = false;
    let partialProc = null;
    let agentProc = null;

    res.on('close', () => {
      aborted = true;
      try { if (partialProc && !partialProc.killed) partialProc.kill(); } catch {}
      try { if (agentProc && !agentProc.killed) agentProc.kill(); } catch {}
      gb.busy = false;
    });

    gb.busy = true;

    try {
      // Step 1: Assemble partial CDP script
      send('status', { phase: 'assembling', label: 'Assembling partial script...' });
      const assemblerPy = path.join(PROJECT_DIR, 'scripts', 'script_assembler.py');
      const partialScriptPath = path.join(os.tmpdir(), `partial_cdp_${Date.now()}.js`);
      execSync(`python "${assemblerPy}" "${absActionPath}" "${partialScriptPath}" --partial-cdp ${failedStep}`, {
        encoding: 'utf-8', timeout: 30000, cwd: PROJECT_DIR,
      });
      if (!existsSync(partialScriptPath)) {
        throw new Error('Partial script assembly failed');
      }

      // Step 2: Run partial script, capture CDP port, resolve WS URL
      send('status', { phase: 'replaying', label: 'Replaying steps 1~' + (failedStep - 1) + '...' });
      const runJsPath = path.join(SKILL_DIR, 'run.js');
      let cdpPort = null;
      let partialStdout = '';

      await new Promise((resolve, reject) => {
        partialProc = spawn('node', [runJsPath, partialScriptPath], {
          cwd: SKILL_DIR,
          env: { ...process.env, PLAYWRIGHT_SKIP_EXISTING: '1' },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        const timeout = setTimeout(() => { try { partialProc.kill(); } catch {} reject(new Error('Partial script timeout (90s)')); }, 90000);

        partialProc.stdout.on('data', (chunk) => {
          const text = chunk.toString();
          partialStdout += text;
          send('log', { type: 'info', message: text.trimEnd() });
          const m = partialStdout.match(/CDP_PORT:(\d+)/);
          if (m && !cdpPort) {
            cdpPort = parseInt(m[1]);
            send('status', { phase: 'cdp_ready', label: `CDP port ${cdpPort} captured` });
          }
        });
        partialProc.stderr.on('data', (chunk) => {
          send('log', { type: 'error', message: chunk.toString().trimEnd() });
        });
        partialProc.on('close', (code) => {
          clearTimeout(timeout);
          if (!cdpPort) {
            reject(new Error(`Partial script exited code ${code} before exposing CDP port`));
          } else {
            resolve();
          }
        });
        partialProc.on('error', (err) => { clearTimeout(timeout); reject(err); });
      });

      if (!cdpPort) throw new Error('No CDP port captured');

      // Resolve WebSocket URL from Chrome's /json/version endpoint
      let cdpEndpoint = null;
      try {
        const versionJson = await new Promise((resolve, reject) => {
          http.get(`http://127.0.0.1:${cdpPort}/json/version`, (resp) => {
            let data = '';
            resp.on('data', c => data += c);
            resp.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
          }).on('error', reject);
        });
        cdpEndpoint = versionJson.webSocketDebuggerUrl;
        send('log', { type: 'success', message: `CDP: ${cdpEndpoint}` });
      } catch (e) {
        // Fallback: construct URL manually
        cdpEndpoint = `http://127.0.0.1:${cdpPort}`;
        send('log', { type: 'warn', message: `CDP fallback: ${cdpEndpoint} (${e.message})` });
      }
      if (!cdpEndpoint) throw new Error('Could not resolve CDP WebSocket URL');

      // Step 3: Kill old global browser, start new one with CDP
      send('status', { phase: 'connecting', label: 'Connecting agent via CDP...' });
      if (gb.process && !gb.process.killed) {
        try { gb.stdin.write(JSON.stringify({ event: 'close' }) + '\n'); } catch {}
        setTimeout(() => { try { if (gb.process && !gb.process.killed) gb.process.kill(); } catch {} }, 5000);
      }

      // Step 4: Spawn new agent with CDP
      const pythonExe = process.env.PYTHON_EXE || 'python';
      const agentScript = path.join(PROJECT_DIR, 'scripts', 'browser-use-agent.py');
      const modelId = session.model || 'deepseek-v4-flash';
      agentProc = spawn(pythonExe, [
        agentScript, '--session', '--session-id', 'global',
        '--model', modelId, '--base-url', `http://localhost:${PORT}/v1`,
        '--api-key', LLM_API_KEY || '', '--cdp-url', cdpEndpoint,
      ], {
        cwd: PROJECT_DIR,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', OPENAI_API_KEY: LLM_API_KEY || '' },
      });

      // Wait for agent ready
      let agentReady = false;
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Agent ready timeout')), 30000);
        agentProc.stdout.on('data', (chunk) => {
          const text = chunk.toString();
          try {
            const msg = JSON.parse(text.trim().split('\n').pop());
            if (msg.event === 'ready') { agentReady = true; clearTimeout(timeout); resolve(); }
          } catch {}
        });
        agentProc.on('error', (err) => { clearTimeout(timeout); reject(err); });
        agentProc.on('close', (code) => { clearTimeout(timeout); reject(new Error(`Agent exited ${code}`)); });
      });
      if (!agentReady) throw new Error('Agent did not emit ready');

      // Update globalBrowser state
      state.globalBrowser.process = agentProc;
      state.globalBrowser.stdin = agentProc.stdin;
      state.globalBrowser.ready = true;
      state.globalBrowser.busy = false;

      gb.busy = false;

      // Step 5: Construct resume instruction from action + log files
      let resumeInstruction = '';
      try {
        const actionData = JSON.parse(readFileSync(absActionPath, 'utf-8'));
        const url = actionData.url || '';
        const commands = actionData?.tests?.[0]?.commands || actionData?.actions || [];
        const remaining = commands.filter((c, i) => (i + 1) >= failedStep);
        const lines = [];
        if (url && !url.includes('unknown')) lines.push(`【目标URL】\n${url}\n`);
        lines.push('请先扫描当前表单，建立任务清单，完成剩余待填表单项。\n');
        for (const cmd of remaining) {
          const stepNum = commands.indexOf(cmd) + 1;
          const a = cmd.action || '';
          const p = cmd.params || {};
          if (a === 'fill_form_field') lines.push(`- Step ${stepNum}: 填写 "${p.label_text || ''}" = "${p.value || ''}"`);
          else if (a === 'select_option') lines.push(`- Step ${stepNum}: 在 "${p.label_text || ''}" 中选择 "${p.option_text || ''}"`);
          else if (a === 'click_element_by_index') lines.push(`- Step ${stepNum}: 点击 "${p.text || p.index || ''}"`);
          else lines.push(`- Step ${stepNum}: ${a}`);
        }
        if (log_file) {
          const logPath = path.resolve(PROJECT_DIR, log_file);
          if (existsSync(logPath)) {
            const logContent = readFileSync(logPath, 'utf-8');
            const logLines = logContent.split('\n').filter(l => { const m = l.match(/^\[(\d+)\]/); return m && parseInt(m[1]) >= failedStep; });
            if (logLines.length) lines.push('\n## 原始执行日志\n```\n' + logLines.slice(-40).join('\n') + '\n```');
          }
        }
        resumeInstruction = lines.join('\n');
      } catch (e) {
        send('log', { type: 'warn', message: `Failed to auto-construct instruction: ${e.message}` });
        resumeInstruction = `Continue recording from step ${failedStep}. See action file for remaining steps.`;
      }

      // Step 6: Send step with resume instruction
      req.body = { task: resumeInstruction, maxSteps: maxSteps || 40 };
      const stepRoute = app._router.stack.find(r => r.route && r.route.path === '/api/browser/session/:id/step' && r.route.methods.post);
      if (stepRoute) {
        stepRoute.handle(req, res);
      } else {
        send('error', { message: 'Step handler not found' });
        if (!res.writableEnded) res.end();
      }
    } catch (err) {
      gb.busy = false;
      send('error', { message: err.message });
      if (!res.writableEnded) res.end();
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
    state.executionRecords.unshift(record);
    state.sessions.delete(id);
    console.log(`[browser-session] Archived session ${id} to execution records (browser stays alive)`);
    res.json({ status: 'archived', sessionId: id });
  });

  app.delete('/api/browser/browser', (req, res) => {
    const gb = state.globalBrowser;
    const proc = gb.process;

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

  app.post('/api/browser/session/:id/trajectory', async (req, res) => {
    const { id } = req.params;
    const { task } = req.body || {};
    const gb = state.globalBrowser;
    const session = state.sessions.get(id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (gb.busy) return res.status(409).json({ error: 'Browser is busy executing a step' });
    if (!gb.stdin) return res.status(503).json({ error: 'Browser not ready' });
    gb.stdin.write(JSON.stringify({ event: 'save_trajectory' }) + '\n');

    const timeout = setTimeout(() => { cleanupTrajListener(); if (!res.writableEnded) res.status(504).json({ error: 'Timeout waiting for trajectory' }); }, 30000);
    let pendingBuffer = '';

    const onStdout = (chunk) => {
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
            if (!msg.data.success) return res.status(500).json({ error: msg.data.message || 'Failed to save trajectory' });
            const trajectoryFile = msg.data.trajectory_file;
            if (!trajectoryFile || !existsSync(trajectoryFile)) return res.status(500).json({ error: 'Trajectory file not found' });
            try {
              const trajectoryId = createTrajectoryId();
              const { record, flow } = saveTrajectoryRecord({ trajectoryId, task: task || '', model: session.model, sourcePath: trajectoryFile, exploreMeta: { is_done: msg.data.is_done, is_successful: msg.data.is_successful } });
              const actionCount = flow.filter(s => s.type !== 'done' && !s.error).length;
              return res.json({ trajectoryId, steps: record.stepCount, actions: actionCount, isSuccessful: record.isSuccessful, action_file: msg.data.action_file, log_file: msg.data.log_file, action_count: msg.data.action_count, log_count: msg.data.log_count });
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

    const onStdout = (chunk) => {
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
              const { record } = saveCaseDataRecord({
                sourcePath: msg.data.case_data_file,
                sessionId: id,
                model: session.model,
                description: session.lastTask ? session.lastTask.slice(0, 100) : '',
              });
              return res.json({ caseDataFile: msg.data.case_data_file, recordId: record.recordId, keys: msg.data.keys });
            } catch (err) {
              return res.json({ caseDataFile: msg.data.case_data_file, keys: msg.data.keys });
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

  app.get('/api/browser/session/execution-records', (req, res) => { res.json(state.executionRecords); });

  app.get('/api/browser/session/execution-record/:sessionId', (req, res) => {
    const record = state.executionRecords.find(r => r.sessionId === req.params.sessionId);
    if (!record) return res.status(404).json({ error: 'Execution record not found' });
    res.json(record);
  });

  app.delete('/api/browser/session/execution-record/:sessionId', (req, res) => {
    const idx = state.executionRecords.findIndex(r => r.sessionId === req.params.sessionId);
    if (idx === -1) return res.status(404).json({ error: 'Execution record not found' });
    state.executionRecords.splice(idx, 1);
    console.log(`[browser-session] Permanently deleted execution record ${req.params.sessionId}`);
    res.json({ status: 'deleted', sessionId: req.params.sessionId });
  });
}
