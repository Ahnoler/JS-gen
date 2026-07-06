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

  child.stderr.on('data', (chunk) => { console.log(chunk.toString().trimEnd()); });
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
      case 'intervention_needed':
        send('intervention_needed', msg.data);
        break;
      case 'intervention_resolved':
        send('intervention_resolved', msg.data);
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
    try {
      const actionData = JSON.parse(readFileSync(absActionPath, 'utf-8'));
      const url = actionData.url || '';
      const commands = actionData?.tests?.[0]?.commands || actionData?.actions || [];
      const remaining = commands.filter((c, i) => (i + 1) >= failedStep);

      // Load heal prompt template
      const healPromptPath = path.resolve(PROJECT_DIR, 'scripts', 'prompts', 'heal-prompt.md');
      let template = '';
      try {
        template = existsSync(healPromptPath) ? readFileSync(healPromptPath, 'utf-8') : '';
      } catch (_) {}

      // Build URL section
      const urlSection = (url && !url.includes('unknown'))
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
      } else {
        // Fallback: build inline
        const lines = [];
        if (urlSection) lines.push(urlSection.trim());
        lines.push('当前为脚本执行失败后的自愈修复阶段。请根据下方操作步骤与 Log 文件，逐步导航并复现失败场景，抵达出错页面后，扫描当前表单，建立任务清单，重新填写所有表单项。');
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
                caseDataPath: msg.data.case_data_file,
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
