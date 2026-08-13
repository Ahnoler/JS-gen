import { parseDoneLogs } from '../../models/phase-done-logs.js';

export const PHASE_LOOKUP_STATUSES = new Set([
  'preparing', 'recording', 'recorded', 'failed', 'cancelled',
]);

export function summarizePhases(phases = []) {
  const list = Array.isArray(phases) ? phases : [];
  const phaseTotal = list.length;
  const phaseCompleted = list.filter((p) => p.status === 'completed').length;
  const running = list.find((p) => p.status === 'running');
  const completed = list
    .filter((p) => p.status === 'completed')
    .sort((a, b) => (Number(a.phaseNumber) || 0) - (Number(b.phaseNumber) || 0));
  const named = running || completed[completed.length - 1];
  let last = null;
  for (const p of list) {
    for (const e of parseDoneLogs(p.doneLogs ?? p.done_logs)) {
      if (!last || String(e.at) >= String(last.at)) last = e;
    }
  }
  return {
    phaseCompleted,
    phaseTotal,
    phaseName: named ? String(named.description || '').trim() : '',
    lastDoneText: last?.text || '',
  };
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
