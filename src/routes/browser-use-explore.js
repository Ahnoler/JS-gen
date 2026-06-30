import { spawn, execSync } from 'child_process';
import { writeFileSync, existsSync, unlinkSync, readdirSync } from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { PROJECT_DIR, STANDALONE_LLM, LLM_BASE_URL, LLM_API_KEY, PORT } from '../config.js';
import { state } from '../state.js';
import { createTrajectoryId, saveTrajectoryRecord } from '../trajectory-store.js';

const PYTHON_EXE = 'D:\\anaconda3\\envs\\browser_use\\python.exe';
const AGENT_SCRIPT = path.join(PROJECT_DIR, 'scripts', 'browser-use-agent.py');

function killTree(pid) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore', timeout: 5000 });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {}
}

function killOrphans() {
  try {
    if (process.platform === 'win32') {
      const psScript = path.join(os.tmpdir(), `_kill_bu_orphans_${Date.now()}.ps1`);
      writeFileSync(psScript, `
$procs = Get-CimInstance Win32_Process -Filter "name='chrome.exe'" | Where-Object { $_.CommandLine -match 'remote.debugging.(port|pipe)|playwright|browser.use|\.agent-browser|openclaw|xbrowser' }
foreach ($p in $procs) {
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}
`, 'utf-8');
      execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psScript}"`, {
        stdio: 'ignore', timeout: 10000, windowsHide: true,
      });
      try { unlinkSync(psScript); } catch {}
    }
  } catch {}
}

function flushPendingBuffer(pendingBuffer, onMessage) {
  const trimmed = pendingBuffer.trim();
  if (!trimmed) return;
  for (const line of trimmed.split('\n')) {
    if (!line.trim()) continue;
    try { onMessage(JSON.parse(line)); } catch {}
  }
}

function finishExplore(res, exploreLockRef, send, payload) {
  send('done', payload);
  exploreLockRef.value = false;
  console.log('[browser-use] Exploration finished (lock released)');
  if (!res.writableEnded) res.end();
}

/**
 * Parse multi-phase task text into structured phases.
 * Format:
 *   【目标URL】
 *   http://...
 *   【阶段1：名称】
 *   instructions...
 *   【阶段2：名称】
 *   instructions...
 */
function parsePhases(task) {
  const phaseRegex = /【阶段(\d+)[：:]\s*(.+?)】/g;
  const phases = [];
  let lastEnd = 0;
  let prefix = '';

  // Extract prefix (everything before first 【阶段N：】)
  const firstMatch = phaseRegex.exec(task);
  if (firstMatch) {
    prefix = task.slice(0, firstMatch.index).trim();
    lastEnd = phaseRegex.lastIndex;
  }

  // Reset and collect phases
  phaseRegex.lastIndex = 0;
  let match;
  const matches = [];
  while ((match = phaseRegex.exec(task)) !== null) {
    matches.push({ num: parseInt(match[1]), name: match[2].trim(), index: match.index, endIndex: phaseRegex.lastIndex });
  }

    for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const contentStart = m.endIndex;
    const contentEnd = i + 1 < matches.length ? matches[i + 1].index : task.length;
    let content = task.slice(contentStart, contentEnd).trim();

    // Phase 1 gets the prefix (URL etc.), others don't
    if (i === 0 && prefix) {
      content = prefix + '\n\n' + content;
    }

    // Strip screenshot-only lines (waste steps, no automation value)
    content = content.replace(/^\d+[\.\)、]\s*截图[^：:\n]*$/gm, '').trim();

    // Determine maxSteps per phase
    const navPhases = ['登录', '导航'];
    const isNav = navPhases.some(kw => m.name.includes(kw));
    const maxSteps = isNav ? 50 : 40;

    phases.push({
      name: `Phase ${m.num}: ${m.name}`,
      task: content,
      maxSteps,
    });
  }

  return phases;
}

export default function (app) {

  const exploreLockRef = { value: false };

  app.post('/api/browser-use/explore', async (req, res) => {
    const { task, model } = req.body || {};

    if (!task) return res.status(400).json({ error: 'task is required' });
    if (!STANDALONE_LLM && !state.client) return res.status(503).json({ error: 'opencode server not ready' });
    if (!existsSync(PYTHON_EXE)) return res.status(500).json({ error: `Python not found at ${PYTHON_EXE}` });
    if (!existsSync(AGENT_SCRIPT)) return res.status(500).json({ error: `Agent script not found at ${AGENT_SCRIPT}` });

    if (exploreLockRef.value) {
      return res.status(409).json({ error: 'Exploration already in progress. Cancel or wait for it to complete.' });
    }
    exploreLockRef.value = true;
    console.log('[browser-use] Exploration started (locked)');

    const modelId = model || (state.defaultModel ? `${state.defaultModel.providerID}/${state.defaultModel.modelID}` : (STANDALONE_LLM ? 'deepseek-v4-flash' : 'deepseek/deepseek-v4-flash'));

    // Parse phases from task
    const phases = parsePhases(task);
    const isMultiPhase = phases.length > 1;

    if (isMultiPhase) {
      console.log(`[browser-use] Detected ${phases.length} phases, using workflow mode`);
    }

    // Write workflow JSON (temp file)
    const workflowPath = isMultiPhase
      ? path.join(os.tmpdir(), `browser_use_workflow_${Date.now()}.json`)
      : null;
    if (workflowPath) {
      writeFileSync(workflowPath, JSON.stringify(phases, null, 2), 'utf-8');
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    if (res.socket) {
      res.socket.setNoDelay(true);
      res.socket.setKeepAlive(true, 30000);
    }

    const send = (event, data) => {
      if (res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    let aborted = false;
    let child = null;

    const cleanup = () => {
      aborted = true;
      exploreLockRef.value = false;
      if (child && !child.killed) killTree(child.pid);
      setTimeout(() => killOrphans(), 2000);
    };

    res.on('close', cleanup);
    killOrphans();

    send('status', { phase: isMultiPhase ? 'workflow' : 'exploring', label: 'Browser Use Agent starting...', totalPhases: phases.length });

    let outputPath = path.join(os.tmpdir(), `browser_use_trajectory_${Date.now()}.json`);

    // Build args
    const pythonArgs = isMultiPhase
      ? ['--workflow', workflowPath, '--model', modelId, '--base-url', `http://localhost:${PORT}/v1`, '--api-key', LLM_API_KEY, '--output', outputPath]
      : ['--task', task, '--model', modelId, '--base-url', `http://localhost:${PORT}/v1`, '--api-key', LLM_API_KEY, '--output', outputPath];

    child = spawn(PYTHON_EXE, [AGENT_SCRIPT, ...pythonArgs], {
      cwd: PROJECT_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUNBUFFERED: '1',
        OPENAI_API_KEY: LLM_API_KEY,
      },
    });

    let stderr = '';
    let pendingBuffer = '';
    let exploreMeta = null;
    let workflowDone = false;

    const handleAgentMessage = (msg) => {
      switch (msg.event) {
        case 'nav_step':
          send('status', { phase: 'navigating', label: msg.data.label });
          break;

        case 'step':
          send('step', msg.data);
          send('status', {
            phase: 'exploring',
            label: `Step ${msg.data.step}: ${msg.data.next_goal || 'thinking...'}`,
          });
          break;

        case 'phase_start':
          send('phase_start', msg.data);
          send('status', {
            phase: 'workflow',
            label: `Phase ${msg.data.phase}/${msg.data.total}: ${msg.data.name}`,
            currentPhase: msg.data.phase,
            totalPhases: msg.data.total,
          });
          break;

        case 'phase_done':
          send('phase_done', msg.data);
          send('status', {
            phase: 'workflow',
            label: `✓ Phase ${msg.data.phase}/${msg.data.total} done: ${msg.data.name}`,
            currentPhase: msg.data.phase,
            totalPhases: msg.data.total,
          });
          break;

        case 'phase_error':
          send('status', {
            phase: 'error',
            label: `✗ Phase ${msg.data.phase} failed: ${msg.data.message}`,
          });
          break;

        case 'workflow_done':
          workflowDone = true;
          send('status', {
            phase: 'explore_done',
            label: `All ${msg.data.total_phases} phases completed`,
            totalPhases: msg.data.total_phases,
          });
          break;

        case 'done':
          if (!isMultiPhase) {
            if (msg.data?.output_file) outputPath = msg.data.output_file;
            exploreMeta = msg.data;
            send('status', {
              phase: 'explore_done',
              label: `Exploration complete (${msg.data.steps} steps)`,
              steps: msg.data.steps,
              isDone: msg.data.is_done,
              isSuccessful: msg.data.is_successful,
            });
          }
          break;

        case 'error':
          send('status', { phase: 'error', label: msg.data.message });
          break;
      }
    };

    child.stdout.on('data', (chunk) => {
      if (aborted) return;
      pendingBuffer += chunk.toString();
      const lines = pendingBuffer.split('\n');
      pendingBuffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try { handleAgentMessage(JSON.parse(line)); } catch {}
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      console.log('[browser-use stderr] ' + chunk.toString().trimEnd());
    });

    child.on('close', (code) => {
      if (aborted) return;

      flushPendingBuffer(pendingBuffer, handleAgentMessage);

      if (code !== 0 && !workflowDone) {
        const errMsg = stderr.split('\n').filter(Boolean).slice(-5).join('\n') || `Process exited with code ${code}`;
        send('error', { message: errMsg, code });
        finishExplore(res, exploreLockRef, send, { success: false });
        return;
      }

      if (isMultiPhase && workflowDone) {
        // Workflow complete — save a combined trajectory record
        const trajectoryId = createTrajectoryId();
        // Try to read individual phase trajectories, combine into one record
        let totalActions = 0;
        try {
          const dir = os.tmpdir();
          const files = readdirSync(dir).filter(f => f.includes('browser_use_phase'));
          totalActions = files.length;
        } catch {}

        send('trajectory', {
          trajectoryId,
          steps: phases.length,
          actions: totalActions,
          isSuccessful: true,
          summary: phases.map((p, i) => ({
            phase: i + 1,
            name: p.name,
            desc: p.task.slice(0, 80),
          })),
        });

        console.log('[browser-use] Workflow complete, trajectory:', trajectoryId);
        finishExplore(res, exploreLockRef, send, {
          success: true,
          phase: 'explore_only',
          trajectoryId,
          actionCount: totalActions,
          stepCount: phases.length,
          isSuccessful: true,
          message: `Workflow complete: ${phases.length} phases executed.`,
        });
      } else if (!isMultiPhase) {
        if (!existsSync(outputPath)) {
          send('error', { message: `Trajectory file not found: ${outputPath}` });
          finishExplore(res, exploreLockRef, send, { success: false });
          return;
        }
        try {
          const trajectoryId = createTrajectoryId();
          const { record, flow } = saveTrajectoryRecord({
            trajectoryId,
            task,
            model: modelId,
            sourcePath: outputPath,
            exploreMeta,
          });
          try { unlinkSync(outputPath); } catch {}
          const actionCount = flow.filter(s => s.type !== 'done' && !s.error).length;
          send('trajectory', {
            trajectoryId,
            steps: record.stepCount,
            actions: actionCount,
            isSuccessful: record.isSuccessful,
            summary: flow.slice(0, 10).map(s => ({
              step: s.stepNumber,
              type: s.type,
              desc: s.description || s.type,
            })),
          });
          console.log('[browser-use] Trajectory saved:', trajectoryId, `(${actionCount} actions)`);
          finishExplore(res, exploreLockRef, send, {
            success: true,
            phase: 'explore_only',
            trajectoryId,
            actionCount,
            stepCount: record.stepCount,
            isSuccessful: record.isSuccessful,
            message: 'Exploration complete.',
          });
        } catch (err) {
          send('error', { message: err.message });
          finishExplore(res, exploreLockRef, send, { success: false });
        }
      }

      // Cleanup workflow file
      if (workflowPath) {
        try { unlinkSync(workflowPath); } catch {}
      }
    });

    child.on('error', (err) => {
      if (aborted) return;
      send('error', { message: `Failed to start Python agent: ${err.message}` });
      finishExplore(res, exploreLockRef, send, { success: false });
    });
  });

  // ========== Session mode routes ==========

  function waitForReady(child, timeout = 15000) {
    return new Promise((resolve, reject) => {
      let buffer = '';
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Timeout waiting for Python agent ready'));
      }, timeout);

      const onStdout = (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.event === 'ready') {
              cleanup();
              resolve(msg);
            }
          } catch {}
        }
      };

      const onExit = (code) => {
        cleanup();
        reject(new Error(`Python agent exited with code ${code} before ready`));
      };

      function cleanup() {
        clearTimeout(timer);
        child.stdout.removeListener('data', onStdout);
        child.removeListener('exit', onExit);
      }

      child.stdout.on('data', onStdout);
      child.on('exit', onExit);
    });
  }

  function isProcessAlive(proc) {
    if (!proc) return false;
    if (proc.killed) return false;
    if (proc.exitCode !== null) return false;
    return true;
  }

  async function ensureGlobalBrowser(modelId) {
    const gb = state.globalBrowser;
    if (isProcessAlive(gb.process)) {
      if (!gb.ready) await waitForReady(gb.process, 15000);
      return;
    }

    // Process is dead — clean up stale state immediately
    gb.process = null;
    gb.stdin = null;
    gb.ready = false;
    gb.busy = false;
    gb.stepIndex = 0;

    killOrphans();

    const child = spawn(PYTHON_EXE, [
      AGENT_SCRIPT,
      '--session',
      '--session-id', 'global',
      '--model', modelId,
      '--base-url', `http://localhost:${PORT}/v1`,
      '--api-key', LLM_API_KEY,
    ], {
      cwd: PROJECT_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUNBUFFERED: '1',
        OPENAI_API_KEY: LLM_API_KEY,
      },
    });

    child.stderr.on('data', (chunk) => {
      console.log('chunk.toString().trimEnd());
    });

    child.on('exit', () => {
      gb.process = null;
      gb.stdin = null;
      gb.ready = false;
      gb.busy = false;
      gb.stepIndex = 0;
      console.log('[browser-global] Process exited');
    });

    gb.process = child;
    gb.stdin = child.stdin;
    gb.model = modelId;

    // Detect stdin pipe errors (process died, pipe broken)
    child.stdin.on('error', () => {
      if (!gb.ready) return;
      gb.process = null;
      gb.stdin = null;
      gb.ready = false;
      gb.busy = false;
      gb.stepIndex = 0;
    });

    try {
      await waitForReady(child, 15000);
      gb.ready = true;
      console.log('[browser-global] Browser ready');
    } catch (err) {
      killTree(child.pid);
      setTimeout(() => killOrphans(), 2000);
      gb.process = null;
      gb.stdin = null;
      throw err;
    }
  }

  app.post('/api/browser/session', async (req, res) => {
    const { model } = req.body || {};

    if (!STANDALONE_LLM && !state.client) return res.status(503).json({ error: 'opencode server not ready' });
    if (!existsSync(PYTHON_EXE)) return res.status(500).json({ error: `Python not found at ${PYTHON_EXE}` });
    if (!existsSync(AGENT_SCRIPT)) return res.status(500).json({ error: `Agent script not found at ${AGENT_SCRIPT}` });

    const sessionId = crypto.randomUUID();
    const modelId = model || (state.defaultModel ? `${state.defaultModel.providerID}/${state.defaultModel.modelID}` : (STANDALONE_LLM ? 'deepseek-v4-flash' : 'deepseek/deepseek-v4-flash'));

    try {
      await ensureGlobalBrowser(modelId);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }

    const gb = state.globalBrowser;
    state.sessions.set(sessionId, {
      sessionId,
      stepIndex: 0,
      trajectories: [],
      createdAt: new Date().toISOString(),
      model: gb.model,
    });

    console.log(`[browser-session] Created session ${sessionId} (shared browser)`);
    res.json({ sessionId, model: gb.model });
  });

  app.post('/api/browser/session/:id/step', async (req, res) => {
    const { id } = req.params;
    const { task, maxSteps } = req.body || {};
    const gb = state.globalBrowser;

    if (!task) return res.status(400).json({ error: 'task is required' });

    const session = state.sessions.get(id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (gb.busy) return res.status(409).json({ error: 'Browser is busy executing a step' });
    if (!gb.ready || !gb.stdin) return res.status(503).json({ error: 'Browser not ready' });

    gb.busy = true;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    if (res.socket) {
      res.socket.setNoDelay(true);
      res.socket.setKeepAlive(true, 30000);
    }

    const send = (event, data) => {
      if (res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    let aborted = false;
    res.on('close', () => {
      aborted = true;
      if (gb.busy) {
        // Signal Python to stop the current agent step
        const cancelFile = path.join(os.tmpdir(), `browser_use_cancel_global`);
        try { writeFileSync(cancelFile, 'cancel'); } catch {}
        try { gb.stdin.write(JSON.stringify({ event: 'cancel_step' }) + '\n'); } catch {}
        gb.busy = false;
      }
      cleanupListener();
    });

    const stepIndex = session.stepIndex + 1;

    // Clear stale cancel flag before sending step command
    const cancelFlagPath = path.join(os.tmpdir(), 'browser_use_cancel_global');
    try { if (existsSync(cancelFlagPath)) unlinkSync(cancelFlagPath); } catch {}

    try {
      gb.stdin.write(JSON.stringify({
        event: 'step',
        data: { instruction: task, max_steps: maxSteps || 40 },
      }) + '\n');
    } catch (writeErr) {
      gb.busy = false;
      send('error', { message: `Failed to write step to agent: ${writeErr.message}` });
      if (!res.writableEnded) res.end();
      return;
    }

    let pendingBuffer = '';

    const handleSessionMessage = (msg) => {
      switch (msg.event) {
        case 'step':
          send('step', msg.data);
          send('status', {
            phase: 'exploring',
            label: `Step ${msg.data.step}: ${msg.data.next_goal || 'thinking...'}`,
          });
          break;

        case 'phase_start':
          send('phase_start', msg.data);
          send('status', {
            phase: 'session_step',
            label: `Step ${msg.data.phase}: ${msg.data.name}`,
            currentStep: msg.data.phase,
          });
          break;

        case 'phase_done': {
          const trajectoryFile = msg.data?.trajectory_file;
          session.stepIndex = msg.data?.step_index || stepIndex;
          session.trajectories.push({
            step: session.stepIndex,
            path: trajectoryFile || '',
            time: new Date().toISOString(),
          });
          send('phase_done', msg.data);
          send('status', {
            phase: 'step_done',
            label: `Step ${session.stepIndex} completed`,
          });

          gb.busy = false;
          send('done', { stepIndex: session.stepIndex, success: true });
          if (!res.writableEnded) res.end();
          cleanupListener();
          break;
        }

        case 'phase_error':
          send('status', {
            phase: 'error',
            label: `Step failed: ${msg.data.message}`,
          });
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
      }
    };

    const onStdout = (chunk) => {
      if (aborted) return;
      pendingBuffer += chunk.toString();
      const lines = pendingBuffer.split('\n');
      pendingBuffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try { handleSessionMessage(JSON.parse(line)); } catch {}
      }
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

  app.delete('/api/browser/session/:id', (req, res) => {
    const { id } = req.params;
    const session = state.sessions.get(id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const record = {
      sessionId: id,
      model: session.model,
      stepIndex: session.stepIndex,
      steps: session.trajectories.map(t => ({
        step: t.step,
        path: t.path,
        time: t.time,
      })),
      createdAt: session.createdAt,
      archivedAt: new Date().toISOString(),
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

    res.json({
      sessionId: id,
      stepIndex: session.stepIndex,
      busy: state.globalBrowser.busy,
      steps: session.trajectories.map(t => ({
        step: t.step,
        path: t.path,
        time: t.time,
      })),
    });
  });

  app.post('/api/browser/session/:id/reset-trajectory', async (req, res) => {
    const gb = state.globalBrowser;
    if (!gb.stdin || !gb.ready) return res.status(503).json({ error: 'Browser not ready' });
    if (gb.busy) return res.status(409).json({ error: 'Browser is busy executing a step' });

    gb.stdin.write(JSON.stringify({ event: 'reset_trajectory' }) + '\n');

    const timeout = setTimeout(() => {
      gb.process.stdout.removeListener('data', onData);
      if (!res.writableEnded) res.status(504).json({ error: 'Timeout waiting for trajectory reset' });
    }, 15000);

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
            return res.json({ status: 'reset', cumulative_file: msg.data.cumulative_file });
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

    const timeout = setTimeout(() => {
      cleanupTrajListener();
      if (!res.writableEnded) res.status(504).json({ error: 'Timeout waiting for trajectory' });
    }, 30000);

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

            if (!msg.data.success) {
              return res.status(500).json({ error: msg.data.message || 'Failed to save trajectory' });
            }

            const trajectoryFile = msg.data.trajectory_file;
            if (!trajectoryFile || !existsSync(trajectoryFile)) {
              return res.status(500).json({ error: 'Trajectory file not found' });
            }

            try {
              const trajectoryId = createTrajectoryId();
              const { record, flow } = saveTrajectoryRecord({
                trajectoryId,
                task: task || '',
                model: session.model,
                sourcePath: trajectoryFile,
                exploreMeta: {
                  is_done: msg.data.is_done,
                  is_successful: msg.data.is_successful,
                },
              });
              try { unlinkSync(trajectoryFile); } catch {}
              const actionCount = flow.filter(s => s.type !== 'done' && !s.error).length;
              return res.json({
                trajectoryId,
                steps: record.stepCount,
                actions: actionCount,
                isSuccessful: record.isSuccessful,
              });
            } catch (err) {
              return res.status(500).json({ error: `Trajectory save error: ${err.message}` });
            }
          }
        } catch {}
      }
    };

    function cleanupTrajListener() {
      gb.process.stdout.removeListener('data', onStdout);
    }

    gb.process.stdout.on('data', onStdout);
  });

  app.get('/api/browser/sessions', (req, res) => {
    const gb = state.globalBrowser;
    const list = [];
    for (const [id, s] of state.sessions) {
      list.push({
        sessionId: id,
        model: s.model,
        stepIndex: s.stepIndex,
        busy: gb.busy,
        createdAt: s.createdAt,
        stepCount: s.trajectories.length,
      });
    }
    res.json(list);
  });

  app.get('/api/browser/session/execution-records', (req, res) => {
    res.json(state.executionRecords);
  });

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
