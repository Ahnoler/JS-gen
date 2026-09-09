/**
 * File-based trajectory store: index + per-trajectory JSON persistence under TRAJECTORIES_DIR.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { TRAJECTORIES_DIR } from '../config/config.js';
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

/**
 * Ensure the trajectories directory exists.
 * @returns {void} result
 */
export function ensureTrajectoriesDir() {
  if (!existsSync(TRAJECTORIES_DIR)) mkdirSync(TRAJECTORIES_DIR, { recursive: true });
}

/**
 * Load and parse the trajectory index.json (returns [] on missing/parse error).
 * @returns {object[]} result
 */
export function loadTrajectoryIndex() {
  ensureTrajectoriesDir();
  if (!existsSync(indexPath())) return [];
  try { return JSON.parse(readFileSync(indexPath(), 'utf-8')); } catch { return []; }
}

/**
 * Persist the trajectory index list to index.json.
 * @param {object[]} list list
 * @returns {void} result
 */
export function saveTrajectoryIndex(list) {
  ensureTrajectoriesDir();
  writeFileSync(indexPath(), JSON.stringify(list, null, 2), 'utf-8');
}

/**
 * Save a trajectory JSON to the trajectories dir and update the index.
 * @param {object} opts opts
 * @param {string} opts.trajectoryId opts.trajectory id
 * @param {string} [opts.task] task
 * @param {string} [opts.model] model
 * @param {string} opts.sourcePath path to the source trajectory JSON
 * @param {object} [opts.exploreMeta] extra metadata (is_done, is_successful)
 * @returns {{ record: object, trajectory: object, flow: object[] }} saved record, parsed trajectory, and flow steps
 */
export function saveTrajectoryRecord({ trajectoryId, task, model, sourcePath, exploreMeta }) {
  ensureTrajectoriesDir();
  const fileName = `${trajectoryId}.json`;
  const destPath = path.join(TRAJECTORIES_DIR, fileName);

  let trajectory;
  if (path.resolve(sourcePath) === path.resolve(destPath)) {
    // Already saved to trajectories/ by session_runner — no copy needed
    trajectory = JSON.parse(readFileSync(destPath, 'utf-8'));
  } else {
    trajectory = JSON.parse(readFileSync(sourcePath, 'utf-8'));
    writeFileSync(destPath, JSON.stringify(trajectory, null, 2), 'utf-8');
  }

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
  const existingIdx = list.findIndex((r) => r.trajectoryId === trajectoryId);
  if (existingIdx >= 0) {
    // Same session → replace index entry (do not stack duplicates)
    list[existingIdx] = { ...list[existingIdx], ...record, createdAt: list[existingIdx].createdAt };
  } else {
    list.unshift(record);
  }
  saveTrajectoryIndex(list);

  return { record, trajectory, flow };
}
