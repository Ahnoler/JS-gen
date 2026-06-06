import { writeFileSync, existsSync, unlinkSync, readdirSync } from 'fs';
import path from 'path';
import os from 'os';
import { STANDALONE_LLM, LLM_BASE_URL, LLM_API_KEY } from '../config.js';
import { state } from '../state.js';
import { createTrajectoryId, saveTrajectoryRecord } from '../trajectory-store.js';
import {
  PYTHON_EXE, AGENT_SCRIPT, killTree, killOrphans,
  flushPendingBuffer, finishExplore, parsePhases,
  spawnAgent, setupSSE, resolveModelId,
} from './explore-utils.js';

function handleAgentMessage(send, isMultiPhase, ctx) {
  return (msg) => {
    switch (msg.event) {
      case 'nav_step':
        send('status', { phase: 'navigating', label: msg.data.label });
        break;
      case 'step':
        send('step', msg.data);
        send('status', { phase: 'exploring', label: `Step ${msg.data.step}: ${msg.data.next_goal || 'thinking...'}` });
        break;
      case 'phase_start':
        send('phase_start', msg.data);
        send('status', { phase: 'workflow', label: `Phase ${msg.data.phase}/${msg.data.total}: ${msg.data.name}`, currentPhase: msg.data.phase, totalPhases: msg.data.total });
        break;
      case 'phase_done':
        send('phase_done', msg.data);
        send('status', { phase: 'workflow', label: `✓ Phase ${msg.data.phase}/${msg.data.total} done: ${msg.data.name}`, currentPhase: msg.data.phase, totalPhases: msg.data.total });
        break;
      case 'phase_error':
        send('status', { phase: 'error', label: `✗ Phase ${msg.data.phase} failed: ${msg.data.message}` });
        break;
      case 'workflow_done':
        ctx.workflowDone = true;
        send('status', { phase: 'explore_done', label: `All ${msg.data.total_phases} phases completed`, totalPhases: msg.data.total_phases });
        break;
      case 'done':
        if (!isMultiPhase) {
          if (msg.data?.output_file) ctx.outputPath = msg.data.output_file;
          ctx.exploreMeta = msg.data;
          send('status', { phase: 'explore_done', label: `Exploration complete (${msg.data.steps} steps)`, steps: msg.data.steps, isDone: msg.data.is_done, isSuccessful: msg.data.is_successful });
        }
        break;
      case 'error':
        send('status', { phase: 'error', label: msg.data.message });
        break;
    }
  };
}

function handleWorkflowComplete(res, exploreLockRef, send, phases, workflowPath) {
  const trajectoryId = createTrajectoryId();
  let totalActions = 0;
  try {
    const dir = os.tmpdir();
    const files = readdirSync(dir).filter(f => f.includes('browser_use_phase'));
    totalActions = files.length;
  } catch {}

  send('trajectory', {
    trajectoryId, steps: phases.length, actions: totalActions,
    isSuccessful: true,
    summary: phases.map((p, i) => ({ phase: i + 1, name: p.name, desc: p.task.slice(0, 80) })),
  });
  console.log('[browser-use] Workflow complete, trajectory:', trajectoryId);
  finishExplore(res, exploreLockRef, send, {
    success: true, phase: 'explore_only', trajectoryId,
    actionCount: totalActions, stepCount: phases.length,
    isSuccessful: true, message: `Workflow complete: ${phases.length} phases executed.`,
  });
  if (workflowPath) { try { unlinkSync(workflowPath); } catch {} }
}

function handleSingleExploreComplete(res, exploreLockRef, send, task, modelId, ctx) {
  if (!existsSync(ctx.outputPath)) {
    send('error', { message: `Trajectory file not found: ${ctx.outputPath}` });
    finishExplore(res, exploreLockRef, send, { success: false });
    return;
  }
  try {
    const trajectoryId = createTrajectoryId();
    const { record, flow } = saveTrajectoryRecord({ trajectoryId, task, model: modelId, sourcePath: ctx.outputPath, exploreMeta: ctx.exploreMeta });
    try { unlinkSync(ctx.outputPath); } catch {}
    const actionCount = flow.filter(s => s.type !== 'done' && !s.error).length;
    send('trajectory', {
      trajectoryId, steps: record.stepCount, actions: actionCount,
      isSuccessful: record.isSuccessful,
      summary: flow.slice(0, 10).map(s => ({ step: s.stepNumber, type: s.type, desc: s.description || s.type })),
    });
    console.log('[browser-use] Trajectory saved:', trajectoryId, `(${actionCount} actions)`);
    finishExplore(res, exploreLockRef, send, {
      success: true, phase: 'explore_only', trajectoryId,
      actionCount, stepCount: record.stepCount,
      isSuccessful: record.isSuccessful, message: 'Exploration complete.',
    });
  } catch (err) {
    send('error', { message: err.message });
    finishExplore(res, exploreLockRef, send, { success: false });
  }
}

export default function (app, exploreLockRef) {
  app.post('/api/browser-use/explore', async (req, res) => {
    const { task, model } = req.body || {};
    if (!task) return res.status(400).json({ error: 'task is required' });
    if (!STANDALONE_LLM && !state.client) return res.status(503).json({ error: 'opencode server not ready' });
    if (!existsSync(PYTHON_EXE)) return res.status(500).json({ error: `Python not found at ${PYTHON_EXE}` });
    if (!existsSync(AGENT_SCRIPT)) return res.status(500).json({ error: `Agent script not found at ${AGENT_SCRIPT}` });
    if (exploreLockRef.value) return res.status(409).json({ error: 'Exploration already in progress. Cancel or wait for it to complete.' });

    exploreLockRef.value = true;
    console.log('[browser-use] Exploration started (locked)');

    const modelId = resolveModelId(model);
    const phases = parsePhases(task);
    const isMultiPhase = phases.length > 1;
    if (isMultiPhase) console.log(`[browser-use] Detected ${phases.length} phases, using workflow mode`);

    const workflowPath = isMultiPhase ? path.join(os.tmpdir(), `browser_use_workflow_${Date.now()}.json`) : null;
    if (workflowPath) writeFileSync(workflowPath, JSON.stringify(phases, null, 2), 'utf-8');

    const send = setupSSE(res);
    let aborted = false;
    let child = null;
    const ctx = { outputPath: path.join(os.tmpdir(), `browser_use_trajectory_${Date.now()}.json`), exploreMeta: null, workflowDone: false };

    const cleanup = () => {
      aborted = true;
      exploreLockRef.value = false;
      if (child && !child.killed) killTree(child.pid);
      setTimeout(() => killOrphans(), 2000);
    };
    res.on('close', cleanup);
    killOrphans();

    send('status', { phase: isMultiPhase ? 'workflow' : 'exploring', label: 'Browser Use Agent starting...', totalPhases: phases.length });

    const pythonArgs = isMultiPhase
      ? ['--workflow', workflowPath, '--model', modelId, '--base-url', LLM_BASE_URL, '--api-key', LLM_API_KEY, '--output', ctx.outputPath]
      : ['--task', task, '--model', modelId, '--base-url', LLM_BASE_URL, '--api-key', LLM_API_KEY, '--output', ctx.outputPath];

    child = spawnAgent(pythonArgs);
    child.env.OPENAI_API_KEY = LLM_API_KEY;

    let stderr = '';
    let pendingBuffer = '';
    const handleMsg = handleAgentMessage(send, isMultiPhase, ctx);

    child.stdout.on('data', (chunk) => {
      if (aborted) return;
      pendingBuffer += chunk.toString();
      const lines = pendingBuffer.split('\n');
      pendingBuffer = lines.pop() || '';
      for (const line of lines) { if (!line.trim()) continue; try { handleMsg(JSON.parse(line)); } catch {} }
    });

    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); console.log('[browser-use stderr] ' + chunk.toString().trimEnd()); });

    child.on('close', (code) => {
      if (aborted) return;
      flushPendingBuffer(pendingBuffer, handleMsg);
      if (code !== 0 && !ctx.workflowDone) {
        const errMsg = stderr.split('\n').filter(Boolean).slice(-5).join('\n') || `Process exited with code ${code}`;
        send('error', { message: errMsg, code });
        finishExplore(res, exploreLockRef, send, { success: false });
        return;
      }
      if (isMultiPhase && ctx.workflowDone) {
        handleWorkflowComplete(res, exploreLockRef, send, phases, workflowPath);
      } else if (!isMultiPhase) {
        handleSingleExploreComplete(res, exploreLockRef, send, task, modelId, ctx);
      }
      if (workflowPath) { try { unlinkSync(workflowPath); } catch {} }
    });

    child.on('error', (err) => {
      if (aborted) return;
      send('error', { message: `Failed to start Python agent: ${err.message}` });
      finishExplore(res, exploreLockRef, send, { success: false });
    });
  });
}
