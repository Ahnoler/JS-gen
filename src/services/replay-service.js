/**
 * Trajectory Playwright replay orchestration.
 */
import { randomUUID } from 'crypto';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import path from 'path';
import { PROJECT_DIR } from '../../config/config.js';
import * as trajectoryDao from '../dao/trajectory-dao.js';
import { getTrajectoryTree } from './trajectory-service.js';
import { trajectoryStepToActionEntry } from '../models/element.js';
import { assembleActionToScript } from './assemble-service.js';
import {
  executeScript,
  abortActiveScriptRun,
  isScriptExecuting,
  parseReplayStepMarker,
  findScreenshotsForStep,
} from '../runtime/script-runner.js';
import { createPushChannel } from '../runtime/sse-channel.js';
import { broadcast } from '../ws-server.js';
import * as screenshotService from './screenshot-service.js';

/** @type {Map<string, object>} */
const plansById = new Map();
/** @type {Map<number, string>} trajectoryId → latest planId */
const latestPlanByTrajectory = new Map();
/** @type {Map<string, object>} */
const replaysById = new Map();
/** @type {Map<number, string>} */
const latestReplayByTrajectory = new Map();

function stepsToReplayCommands(steps) {
  return (steps || []).map((s) => {
    const entry = trajectoryStepToActionEntry(s);
    const rawEl = s.element ?? s.elementJson ?? null;
    const el = typeof rawEl === 'string'
      ? (() => { try { return JSON.parse(rawEl); } catch { return {}; } })()
      : (rawEl || {});
    return {
      ...entry,
      target: entry.target || el.xpath || el.target || '',
      phase: s.phaseNumber ?? entry.phase ?? 0,
      source: s.source || 'agent',
    };
  });
}

function assertNotRecording(traj) {
  if (traj.recordStatus === 'recording') {
    const err = new Error('Trajectory is AI-recording; stop recording before replay');
    err.statusCode = 409;
    throw err;
  }
  if (traj.recordStatus === 'live') {
    const err = new Error('Trajectory is live (prepared); detach before replay');
    err.statusCode = 409;
    throw err;
  }
}

/**
 * Materialize + assemble a replay plan for a trajectory.
 */
export async function prepareReplay(trajectoryId) {
  const tid = Number(trajectoryId);
  const traj = await trajectoryDao.getById(tid);
  if (!traj) {
    const err = new Error('Trajectory not found');
    err.statusCode = 404;
    throw err;
  }
  assertNotRecording(traj);

  const tree = await getTrajectoryTree(tid);
  const flatSteps = [];
  for (const phase of tree?.phases || []) {
    for (const step of phase.steps || []) {
      flatSteps.push({
        stepId: step.id,
        phaseId: phase.id,
        phaseNumber: phase.phaseNumber,
        stepNumber: step.stepNumber,
        actionType: step.actionType || '',
        confirmed: !!step.confirmed,
      });
    }
  }
  for (const step of tree?.orphanSteps || []) {
    flatSteps.push({
      stepId: step.id,
      phaseId: step.trajectoryPhaseId || null,
      phaseNumber: step.phaseNumber ?? 0,
      stepNumber: step.stepNumber,
      actionType: step.actionType || '',
      confirmed: !!step.confirmed,
    });
  }

  if (!flatSteps.length && !(traj.steps || []).length) {
    const err = new Error('Trajectory has no steps to replay');
    err.statusCode = 400;
    throw err;
  }

  const dbSteps = traj.steps || [];
  const commands = stepsToReplayCommands(dbSteps.length ? dbSteps : flatSteps.map((s) => ({
    id: s.stepId,
    trajectoryPhaseId: s.phaseId,
    phaseNumber: s.phaseNumber,
    stepNumber: s.stepNumber,
    actionType: s.actionType,
  })));

  const actionDir = path.join(PROJECT_DIR, 'scripts', 'action');
  if (!existsSync(actionDir)) mkdirSync(actionDir, { recursive: true });
  const fileName = `action_db_${tid}_replay.json`;
  const absPath = path.join(actionDir, fileName);
  const actionJson = {
    id: String(tid),
    name: traj.name || 'replay',
    url: traj.url || '',
    tests: [{ id: String(tid), name: 'replay', commands }],
  };
  writeFileSync(absPath, JSON.stringify(actionJson, null, 2), 'utf-8');

  const assembled = assembleActionToScript({
    actionFile: `scripts/action/${fileName}`,
    // preview: do not register in Dashboard generated index — script is server-only
    preview: true,
    description: `Replay trajectory ${tid}`,
  });

  // Map assembler step numbers by walking deduped commands that assembler will not skip.
  // Prefer ids embedded in assembled output markers via command metadata.
  const stepMap = [];
  let assemblerStep = 0;
  const SKIP = new Set([
    'scroll_down', 'scroll_up', 'get_page_state', 'scan_form_fields', 'scan_visible_fields',
    'check_field_value', 'verify_field_value', 'take_screenshot',
    'save_trajectory', 'save_case_data', 'read_case_data',
    'match_form_rule', 'init_task_list', 'get_pending_tasks', 'sync_tasks_from_errors',
    'expand_all_el_tree', 'task_done', 'task_retry', 'save_form_snapshot',
  ]);
  for (const cmd of assembled.dedupedCommands || []) {
    const action = cmd.action || '';
    if (SKIP.has(action)) continue;
    assemblerStep += 1;
    const stepId = cmd.id ?? cmd.stepId ?? null;
    const phaseId = cmd.phaseId ?? cmd.trajectoryPhaseId ?? null;
    const meta = flatSteps.find((s) => String(s.stepId) === String(stepId)) || null;
    stepMap.push({
      assemblerStep,
      stepId: stepId != null ? Number(stepId) : null,
      phaseId: phaseId != null ? Number(phaseId) : (meta?.phaseId ?? null),
      phaseNumber: meta?.phaseNumber ?? cmd.phase ?? 0,
      stepNumber: meta?.stepNumber ?? assemblerStep,
      actionType: action,
    });
  }

  const replayPlanId = randomUUID();
  const plan = {
    replayPlanId,
    trajectoryId: tid,
    createdAt: new Date().toISOString(),
    actionFile: `scripts/action/${fileName}`,
    scriptFile: assembled.scriptFile,
    fileName: path.basename(assembled.scriptFile),
    // Kept server-side only — never returned to API clients
    script: assembled.script,
    stats: assembled.stats,
    tree,
    steps: flatSteps,
    stepMap,
  };
  plansById.set(replayPlanId, plan);
  latestPlanByTrajectory.set(tid, replayPlanId);

  try {
    const metaPath = `${assembled.scriptFile}.replay-meta.json`;
    writeFileSync(metaPath, JSON.stringify({
      replayPlanId,
      trajectoryId: tid,
      stepMap,
      steps: flatSteps,
    }, null, 2), 'utf-8');
  } catch {}

  // Public prepare payload: no script body / paths for the frontend
  return {
    replayPlanId,
    trajectoryId: tid,
    ready: true,
    stepCount: flatSteps.length,
    tree,
    steps: flatSteps,
    stepMap,
  };
}

function resolvePlan(trajectoryId, replayPlanId) {
  const tid = Number(trajectoryId);
  let plan = replayPlanId ? plansById.get(replayPlanId) : null;
  if (!plan) {
    const lid = latestPlanByTrajectory.get(tid);
    plan = lid ? plansById.get(lid) : null;
  }
  if (!plan || plan.trajectoryId !== tid) {
    const err = new Error('Replay plan not found; call prepare first');
    err.statusCode = 400;
    throw err;
  }
  return plan;
}

/**
 * Start replay; events broadcast as replay:* (and returned channel for SSE if needed).
 */
export async function startReplay(trajectoryId, { replayPlanId = null, ws = null } = {}) {
  const tid = Number(trajectoryId);
  const traj = await trajectoryDao.getById(tid);
  if (!traj) {
    const err = new Error('Trajectory not found');
    err.statusCode = 404;
    throw err;
  }
  assertNotRecording(traj);

  if (isScriptExecuting()) {
    const err = new Error('Another script is already executing');
    err.statusCode = 409;
    throw err;
  }

  const plan = resolvePlan(tid, replayPlanId);
  const script = plan.script || (existsSync(plan.scriptFile) ? readFileSync(plan.scriptFile, 'utf-8') : null);
  if (!script) {
    const err = new Error('Assembled script missing; call prepare again');
    err.statusCode = 400;
    throw err;
  }

  const replayId = randomUUID();
  const completedStepIds = [];
  const screenshotsAcc = [];
  let failedStep = null;

  const byAssembler = new Map(plan.stepMap.map((m) => [m.assemblerStep, m]));

  const replayState = {
    replayId,
    trajectoryId: tid,
    replayPlanId: plan.replayPlanId,
    status: 'running',
    startedAt: new Date().toISOString(),
    completedStepIds,
    screenshots: screenshotsAcc,
    failedStep: null,
    success: null,
    result: null,
  };
  replaysById.set(replayId, replayState);
  latestReplayByTrajectory.set(tid, replayId);

  const sendReplay = (event, payload) => {
    broadcast(`replay:${event}`, { replayId, trajectoryId: tid, ...payload });
  };

  const channel = createPushChannel(ws, null, 'replay');
  const baseSend = channel.send.bind(channel);
  channel.send = (event, payload) => {
    baseSend(event, payload);
    if (event === 'status') {
      sendReplay('status', payload || {});
      return;
    }
    if (event === 'result') {
      const scriptErrors = payload?.scriptErrors || [];
      if (!payload?.success && scriptErrors.length) {
        const first = scriptErrors[0];
        const mapped = byAssembler.get(Number(first.step)) || null;
        failedStep = {
          assemblerStep: first.step,
          stepId: mapped?.stepId ?? null,
          phaseId: mapped?.phaseId ?? null,
          error: first.error,
          action: first.action,
        };
        sendReplay('step', {
          stepId: failedStep.stepId,
          phaseId: failedStep.phaseId,
          phaseNumber: mapped?.phaseNumber,
          stepNumber: mapped?.stepNumber ?? first.step,
          assemblerStep: first.step,
          status: 'failed',
          error: first.error,
        });
      }
      for (const s of payload?.screenshots || []) {
        if (!screenshotsAcc.find((x) => x.fileName === s.fileName)) {
          screenshotsAcc.push(s);
        }
      }
      const result = {
        success: !!payload?.success,
        replayId,
        trajectoryId: tid,
        completedStepIds: [...completedStepIds],
        failedStep,
        screenshots: [...screenshotsAcc],
        scriptErrors: scriptErrors.length ? scriptErrors : undefined,
        exitCode: payload?.exitCode,
      };
      replayState.status = 'done';
      replayState.success = result.success;
      replayState.failedStep = failedStep;
      replayState.finishedAt = new Date().toISOString();
      replayState.result = result;
      sendReplay('result', result);
      return;
    }
    if (event === 'done') {
      sendReplay('done', payload || {});
    }
  };

  sendReplay('status', { phase: 'running' });

  const handle = executeScript({
    script,
    fileName: plan.fileName || `replay_${tid}.js`,
    channel,
    hooks: {
      busyMessage: '另一个脚本正在执行中，请等待完成',
      keepScriptFile: true,
      onStdoutLine: (line, ctx) => {
        const marker = parseReplayStepMarker(line);
        if (!marker) return;
        const n = Number(marker.step);
        const mapped = byAssembler.get(n) || {
          assemblerStep: n,
          stepId: marker.id ? Number(marker.id) : null,
          phaseId: marker.phaseId ? Number(marker.phaseId) : null,
          phaseNumber: null,
          stepNumber: n,
        };
        const shots = ctx.screenshotsSoFar();
        const { before, after } = findScreenshotsForStep(n, shots);

        const emitShot = (shot, kind) => {
          if (!shot || screenshotsAcc.find((s) => s.fileName === shot.fileName)) return;
          screenshotsAcc.push({
            ...shot,
            kind,
            stepId: mapped.stepId,
            stepNumber: mapped.stepNumber ?? n,
          });
          sendReplay('screenshot', {
            stepId: mapped.stepId,
            phaseId: mapped.phaseId,
            stepNumber: mapped.stepNumber ?? n,
            kind,
            fileName: shot.fileName,
            url: shot.url,
          });
        };
        emitShot(before, 'before');
        emitShot(after, 'after');

        // Persist to MySQL (overwrite recording screenshots for this step)
        if (mapped.stepId != null && (before?.absolutePath || after?.absolutePath)) {
          const persistOne = (shot, kind) => {
            if (!shot?.absolutePath || !existsSync(shot.absolutePath)) return;
            try {
              const buf = readFileSync(shot.absolutePath);
              screenshotService.replaceStepScreenshot(mapped.stepId, {
                trajectoryId: tid,
                kind,
                buffer: buf,
              }).catch((err) => console.warn('[replay] screenshot upsert failed:', err?.message || err));
            } catch (err) {
              console.warn('[replay] screenshot read failed:', err?.message || err);
            }
          };
          persistOne(before, 'before');
          persistOne(after, 'after');
        }

        if (mapped.stepId != null && !completedStepIds.includes(mapped.stepId)) {
          completedStepIds.push(mapped.stepId);
        }
        sendReplay('step', {
          stepId: mapped.stepId,
          phaseId: mapped.phaseId,
          phaseNumber: mapped.phaseNumber,
          stepNumber: mapped.stepNumber ?? n,
          assemblerStep: n,
          status: marker.ok === false ? 'failed' : 'completed',
        });
      },
    },
  });

  if (!handle) {
    const err = new Error('Failed to start script execution');
    err.statusCode = 409;
    throw err;
  }

  return { replayId, trajectoryId: tid, replayPlanId: plan.replayPlanId };
}

export function stopReplay(trajectoryId) {
  const tid = Number(trajectoryId);
  const replayId = latestReplayByTrajectory.get(tid);
  const stopped = abortActiveScriptRun();
  if (replayId && replaysById.has(replayId)) {
    const st = replaysById.get(replayId);
    if (st.status === 'running') {
      st.status = 'aborted';
      st.finishedAt = new Date().toISOString();
      broadcast('replay:status', { replayId, trajectoryId: tid, phase: 'done', aborted: true });
      broadcast('replay:done', { replayId, trajectoryId: tid, aborted: true });
    }
  }
  return { trajectoryId: tid, replayId: replayId || null, stopped };
}

export function getReplay(replayId) {
  return replaysById.get(replayId) || null;
}

export function getLatestReplay(trajectoryId) {
  const id = latestReplayByTrajectory.get(Number(trajectoryId));
  return id ? replaysById.get(id) : null;
}
