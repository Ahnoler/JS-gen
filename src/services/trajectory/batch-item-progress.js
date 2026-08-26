import { parseDoneLogs } from '../../models/phase-done-logs.js';

export const PHASE_LOOKUP_STATUSES = new Set([
  'preparing', 'recording', 'recorded', 'failed', 'cancelled',
]);

/**
 * Summarize phase progress for a trajectory.
 * @param {Array<object>} [phases] phase rows with status, phaseNumber, description, doneLogs
 * @returns {{ phaseCompleted: number, phaseTotal: number, phaseName: string, lastDoneText: string }} phase summary
 */
export function summarizePhases(phases = []) {
  const list = Array.isArray(phases) ? phases : [];
  const phaseTotal = list.length;
  const phaseCompleted = list.filter((p) => p.status === 'completed').length;
  const running = list.find((p) => p.status === 'running');
  const completed = list
    .filter((p) => p.status === 'completed')
    .sort((a, b) => (Number(a.phaseNumber) || 0) - (Number(b.phaseNumber) || 0));
  const named = running || completed[completed.length - 1];
  const latestCompleted = completed[completed.length - 1] || null;
  return {
    phaseCompleted,
    phaseTotal,
    phaseName: named ? String(named.description || '').trim() : '',
    lastDoneText: latestCompletedDoneText(latestCompleted),
  };
}

function latestCompletedDoneText(phase) {
  if (!phase) return '';
  const logs = parseDoneLogs(phase.doneLogs ?? phase.done_logs);
  const fromLog = logs.length ? String(logs[logs.length - 1].text || '').trim() : '';
  if (fromLog) return fromLog;
  const n = Number(phase.phaseNumber) || 0;
  return n > 0 ? `阶段${n}已完成` : '';
}

function recordingRatioPercent(phaseCompleted, phaseTotal) {
  if (!(Number(phaseTotal) > 0)) return 40;
  return Math.min(90, Math.round(40 + 50 * (Number(phaseCompleted) / Number(phaseTotal))));
}

function pipelinePercent(status, mode) {
  if (mode === 'draft') {
    if (status === 'pending') return 0;
    if (status === 'analyzing') return 40;
    if (status === 'analyzed') return 70;
    if (status === 'drafted') return 100;
    return null;
  }
  const map = {
    pending: 0,
    analyzing: 10,
    analyzed: 20,
    queued: 25,
    waiting_executor: 30,
    preparing: 40,
    recorded: 100,
    drafted: 100,
  };
  return Object.prototype.hasOwnProperty.call(map, status) ? map[status] : null;
}

/**
 * Compute batch item progress percent and phase summary.
 * @param {object} [root0] progress input
 * @param {string} [root0.status] batch item record status
 * @param {string} [root0.mode] pipeline mode ('record' or 'draft')
 * @param {number|null} [root0.trajectoryId] trajectory DB id (enables phase lookup)
 * @param {Array<object>} [root0.phases] phase rows for the trajectory
 * @returns {{ progressPercent: number, phaseCompleted: number, phaseTotal: number, phaseName: string, lastDoneText: string }} progress result
 */
export function computeBatchItemProgress({
  status,
  mode = 'record',
  trajectoryId = null,
  phases = [],
} = {}) {
  const st = String(status || '');
  const md = mode === 'draft' ? 'draft' : 'record';
  const hasTraj = Number(trajectoryId) > 0;
  const lookUp = hasTraj && PHASE_LOOKUP_STATUSES.has(st);
  const phaseFields = lookUp
    ? summarizePhases(phases)
    : { phaseCompleted: 0, phaseTotal: 0, phaseName: '', lastDoneText: '' };

  let progressPercent = 0;
  if (st === 'rejected') progressPercent = 0;
  else if (st === 'recording') {
    progressPercent = recordingRatioPercent(phaseFields.phaseCompleted, phaseFields.phaseTotal);
  } else if (st === 'failed' || st === 'cancelled') {
    progressPercent = hasTraj
      ? recordingRatioPercent(phaseFields.phaseCompleted, phaseFields.phaseTotal)
      : (md === 'draft' ? 40 : 10);
  } else {
    const piped = pipelinePercent(st, md);
    progressPercent = piped == null ? 0 : piped;
  }
  progressPercent = Math.max(0, Math.min(100, Math.round(progressPercent)));
  return { progressPercent, ...phaseFields };
}
