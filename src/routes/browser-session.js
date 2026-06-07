import { writeFileSync, existsSync, unlinkSync } from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { STANDALONE_LLM, LLM_BASE_URL, LLM_API_KEY } from '../config.js';
import { state } from '../state.js';
import { createTrajectoryId, saveTrajectoryRecord } from '../trajectory-store.js';
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

  const child = spawnAgent(['--session', '--session-id', 'global', '--model', modelId, '--base-url', LLM_BASE_URL, '--api-key', LLM_API_KEY], { OPENAI_API_KEY: LLM_API_KEY });

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
    state.sessions.set(sessionId, { sessionId, stepIndex: 0, trajectories: [], createdAt: new Date().toISOString(), model: gb.model });
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
    const cancelFlagPath = path.join(os.tmpdir(), 'browser_use_cancel_global');
    try { if (existsSync(cancelFlagPath)) unlinkSync(cancelFlagPath); } catch {}

    try {
      gb.stdin.write(JSON.stringify({ event: 'step', data: { instruction: task, max_steps: maxSteps || 40 } }) + '\n');
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
    if (gb.stdin) {
      try { gb.stdin.write(JSON.stringify({ event: 'close' }) + '\n'); } catch {}
      setTimeout(() => {
        if (gb.process && !gb.process.killed) killTree(gb.process.pid);
        setTimeout(() => killOrphans(), 2000);
      }, 3000);
    }
    gb.process = null; gb.stdin = null; gb.ready = false; gb.busy = false; gb.stepIndex = 0;
    state.sessions.clear();
    console.log('[browser-global] Browser closed, all sessions cleared');
    res.json({ status: 'closed' });
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
              try { unlinkSync(trajectoryFile); } catch {}
              const actionCount = flow.filter(s => s.type !== 'done' && !s.error).length;
              return res.json({ trajectoryId, steps: record.stepCount, actions: actionCount, isSuccessful: record.isSuccessful });
            } catch (err) { return res.status(500).json({ error: `Trajectory save error: ${err.message}` }); }
          }
        } catch {}
      }
    };

    function cleanupTrajListener() { gb.process.stdout.removeListener('data', onStdout); }
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
