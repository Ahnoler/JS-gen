import { writeFileSync, existsSync, unlinkSync } from 'fs';
import path from 'path';
import os from 'os';
import { state } from '../../state.js';
import { upsertPhaseDescription } from '../../services/trajectory-service.js';
import * as execSession from '../../executor-session-client.js';
import { broadcastWatcherStatus } from './broadcasts.js';
import { bindExecutorSessionEvents } from './executor-events.js';
import { handleSessionMessage } from './session-message.js';

/**
 * Single-step agent execution for both executor (remote WS) and local
 * shared-browser (Python stdin/stdout) modes. Wires phase description upsert,
 * cancellation, and session-message dispatch.
 */

/**
 * Execute one agent step on a remote executor session (WS fan-out).
 * @param {object} opts step options
 * @param {object} opts.session target session state
 * @param {string} opts.task agent instruction text
 * @param {number} [opts.maxSteps] max steps for the agent
 * @param {string} [opts.businessDataFile] path to business data file
 * @param {number} [opts.phaseNumber] UI phase number
 * @param {number|string} [opts.trajectoryDbId] bound trajectory DB id
 * @param {{ send: (event: string, data: unknown) => void, end: () => void, onAbort: (cb: () => void) => void }} opts.channel SSE/WS push channel
 * @returns {Promise<void>}
 */
async function executeExecutorStep({ session, task, maxSteps, businessDataFile, phaseNumber, trajectoryDbId, channel }) {
  if (session.busy) return channel.send('error', { message: 'Browser is busy executing a step' });
  if (!session.executorNodeUuid) return channel.send('error', { message: 'Executor session not bound' });

  if (businessDataFile) session.businessDataFile = businessDataFile;
  session.busy = true;
  broadcastWatcherStatus();

  let aborted = false;
  channel.onAbort(() => {
    aborted = true;
    if (session.busy) {
      try {
        execSession.forwardStdin({
          nodeUuid: session.executorNodeUuid,
          sessionId: session.sessionId,
          event: 'cancel_step',
        });
      } catch {}
      session.busy = false;
    }
    cleanupListeners();
  });

  const stepIndex = session.stepIndex + 1;
  session.lastTask = task;
  session.lastMaxSteps = maxSteps || 30;
  if (phaseNumber != null) session.lastPhaseNumber = phaseNumber;

  const resolvedTrajId = trajectoryDbId != null && trajectoryDbId !== ''
    ? Number(trajectoryDbId)
    : (session.dbTrajectoryId != null ? Number(session.dbTrajectoryId) : null);
  if (Number.isFinite(resolvedTrajId)) session.dbTrajectoryId = resolvedTrajId;

  const pn = phaseNumber != null ? Number(phaseNumber) : stepIndex;
  if (Number.isFinite(pn) && task) {
    if (!session.phaseDescriptions) session.phaseDescriptions = {};
    session.phaseDescriptions[String(pn)] = String(task);
    if (Number.isFinite(resolvedTrajId)) {
      try {
        const phaseDbId = await upsertPhaseDescription(resolvedTrajId, pn, task);
        if (phaseDbId) session.activePhaseId = phaseDbId;
      } catch (err) {
        console.warn('[session-step] upsertPhaseDescription failed:', err.message);
      }
    }
  }

  const handleMsg = handleSessionMessage(channel, session, stepIndex, cleanupListeners);

  function cleanupListeners() {
    if (session._executorUnsub) {
      session._executorUnsub();
      session._executorUnsub = null;
    }
  }

  // Ensure durable persist hook is active (also set on session create)
  bindExecutorSessionEvents(session);

  session._executorUnsub = execSession.subscribeSessionEvents(session.sessionId, (type, payload) => {
    if (aborted) return;
    if (type === 'session.process_exit') {
      aborted = true;
      session.busy = false;
      channel.send('error', { message: `Executor agent process exited (code ${payload.code})` });
      channel.end();
      cleanupListeners();
      return;
    }
    handleMsg({ type, data: payload });
  });

  try {
    execSession.forwardStdin({
      nodeUuid: session.executorNodeUuid,
      sessionId: session.sessionId,
      event: 'step',
      data: {
        instruction: task,
        max_steps: maxSteps || 40,
        phase_number: Number.isFinite(pn) ? pn : stepIndex,
        business_data_file: session.businessDataFile,
      },
    });
  } catch (writeErr) {
    session.busy = false;
    channel.send('error', { message: `Failed to send step to executor: ${writeErr.message}` });
    channel.end();
    cleanupListeners();
  }
}

// ── Shared: execute a single step on the global browser agent ──
// Callers: HTTP+SSE handler (POST /step) and WebSocket handler
/**
 * Execute one agent step — dispatches to executor or local shared-browser path.
 * @param {object} opts step options
 * @param {object} opts.session target session state
 * @param {string} opts.task agent instruction text
 * @param {number} [opts.maxSteps] max steps for the agent
 * @param {string} [opts.businessDataFile] path to business data file
 * @param {number} [opts.phaseNumber] UI phase number
 * @param {number|string} [opts.trajectoryDbId] bound trajectory DB id
 * @param {{ send: (event: string, data: unknown) => void, end: () => void, onAbort: (cb: () => void) => void }} opts.channel SSE/WS push channel
 * @returns {Promise<void>}
 */
export async function executeAgentStep({ session, task, maxSteps, businessDataFile, phaseNumber, trajectoryDbId, channel }) {
  if (session.useExecutor) {
    return executeExecutorStep({ session, task, maxSteps, businessDataFile, phaseNumber, trajectoryDbId, channel });
  }

  const gb = state.globalBrowser;
  if (gb.busy) return channel.send('error', { message: 'Browser is busy executing a step' });
  if (!gb.ready || !gb.stdin) return channel.send('error', { message: 'Browser not ready' });

  if (businessDataFile) session.businessDataFile = businessDataFile;
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
      try {
        const phaseDbId = await upsertPhaseDescription(resolvedTrajId, pn, task);
        if (phaseDbId) session.activePhaseId = phaseDbId;
      } catch (err) {
        console.warn('[session-step] upsertPhaseDescription failed:', err.message);
      }
    }
  }

  const cancelFlagPath = path.join(os.tmpdir(), 'browser_use_cancel_global');
  try { if (existsSync(cancelFlagPath)) unlinkSync(cancelFlagPath); } catch {}

  try {
    const stepData = { instruction: task, max_steps: maxSteps || 30 };
    if (session.businessDataFile) stepData.business_data_file = session.businessDataFile;
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
  const handleMsg = handleSessionMessage(channel, session, stepIndex, cleanupListeners);

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
