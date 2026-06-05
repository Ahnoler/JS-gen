import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { TRAJECTORIES_DIR } from './config.js';
import { extractFlowFromTrajectory } from './script-utils.js';

function extractNextGoals(trajectory, limit = 50) {
  const history = trajectory?.history || [];
  const steps = [];
  for (let i = 0; i < history.length && steps.length < limit; i++) {
    const goal = history[i]?.model_output?.current_state?.next_goal;
    if (goal) {
      steps.push({ step: i + 1, goal });
    }
  }
  return steps;
}

function indexPath() {
  return path.join(TRAJECTORIES_DIR, 'index.json');
}

export function ensureTrajectoriesDir() {
  if (!existsSync(TRAJECTORIES_DIR)) mkdirSync(TRAJECTORIES_DIR, { recursive: true });
}

export function loadTrajectoryIndex() {
  ensureTrajectoriesDir();
  if (!existsSync(indexPath())) return [];
  try { return JSON.parse(readFileSync(indexPath(), 'utf-8')); } catch { return []; }
}

export function saveTrajectoryIndex(list) {
  ensureTrajectoriesDir();
  writeFileSync(indexPath(), JSON.stringify(list, null, 2), 'utf-8');
}

export function createTrajectoryId() {
  return 'traj_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
}

export function saveTrajectoryRecord({ trajectoryId, task, model, sourcePath, exploreMeta }) {
  ensureTrajectoriesDir();
  const fileName = `${trajectoryId}.json`;
  const destPath = path.join(TRAJECTORIES_DIR, fileName);

  const trajectoryJson = readFileSync(sourcePath, 'utf-8');
  const trajectory = JSON.parse(trajectoryJson);
  writeFileSync(destPath, JSON.stringify(trajectory, null, 2), 'utf-8');

  const flow = extractFlowFromTrajectory(trajectory);
  const actionCount = flow.filter(s => s.type !== 'done' && !s.error).length;

  const steps = extractNextGoals(trajectory, 50);

  const record = {
    trajectoryId,
    fileName,
    task,
    model: model || '',
    stepCount: trajectory?.history?.length || flow.length,
    actionCount,
    steps,
    isDone: exploreMeta?.is_done ?? null,
    isSuccessful: exploreMeta?.is_successful ?? null,
    createdAt: new Date().toISOString(),
  };

  const list = loadTrajectoryIndex();
  list.unshift(record);
  saveTrajectoryIndex(list);

  return { record, trajectory, flow };
}

export function getTrajectoryRecord(trajectoryId) {
  const list = loadTrajectoryIndex();
  return list.find(r => r.trajectoryId === trajectoryId) || null;
}

export function loadTrajectoryJson(trajectoryId) {
  const record = getTrajectoryRecord(trajectoryId);
  if (!record) return null;
  const filePath = path.join(TRAJECTORIES_DIR, record.fileName);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

export function deleteTrajectory(trajectoryId) {
  const list = loadTrajectoryIndex();
  const idx = list.findIndex(r => r.trajectoryId === trajectoryId);
  if (idx === -1) return false;

  const record = list[idx];
  const filePath = path.join(TRAJECTORIES_DIR, record.fileName);
  try { if (existsSync(filePath)) unlinkSync(filePath); } catch {}

  list.splice(idx, 1);
  saveTrajectoryIndex(list);
  return true;
}
