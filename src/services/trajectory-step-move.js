/**
 * Pure planner for POST .../steps/move.
 * Builds global order = phases sorted by phaseNumber, each phase's steps in list order
 * after removing stepId and inserting before beforeStepId (or phase end).
 */
export function planStepMove({
  steps,
  phases,
  stepId,
  targetPhaseId,
  beforeStepId = null,
}) {
  const sid = Number(stepId);
  const tidPhase = Number(targetPhaseId);
  const before = beforeStepId == null || beforeStepId === ''
    ? null
    : Number(beforeStepId);

  if (!Number.isFinite(sid) || sid <= 0) {
    return { ok: false, code: 'invalid_step', message: 'stepId required' };
  }
  if (!Number.isFinite(tidPhase) || tidPhase <= 0) {
    return { ok: false, code: 'invalid_phase', message: 'targetPhaseId required' };
  }
  if (before != null && before === sid) {
    return { ok: false, code: 'invalid_before', message: 'beforeStepId must differ from stepId' };
  }

  const phaseList = (phases || [])
    .map((p) => ({ id: Number(p.id), phaseNumber: Number(p.phaseNumber) || 0 }))
    .filter((p) => p.id > 0)
    .sort((a, b) => a.phaseNumber - b.phaseNumber || a.id - b.id);

  const targetPhase = phaseList.find((p) => p.id === tidPhase);
  if (!targetPhase) {
    return { ok: false, code: 'invalid_phase', message: 'targetPhaseId not in trajectory' };
  }

  const all = (steps || []).map((s) => ({
    id: Number(s.id),
    trajectoryPhaseId: s.trajectoryPhaseId != null ? Number(s.trajectoryPhaseId) : null,
    phaseNumber: Number(s.phaseNumber) || 0,
    stepNumber: Number(s.stepNumber) || 0,
  }));

  const moving = all.find((s) => s.id === sid);
  if (!moving) {
    return { ok: false, code: 'invalid_step', message: 'stepId not in trajectory' };
  }

  if (before != null) {
    const anchor = all.find((s) => s.id === before);
    if (!anchor) {
      return { ok: false, code: 'invalid_before', message: 'beforeStepId not in trajectory' };
    }
    // Anchor must be in target phase after move (same phase as target; if anchor is the
    // moving step we already rejected; if anchor is currently elsewhere, reject unless
    // it's already targetPhaseId).
    if (Number(anchor.trajectoryPhaseId) !== tidPhase) {
      return { ok: false, code: 'invalid_before', message: 'beforeStepId not in targetPhaseId' };
    }
  }

  // Bucket by phase id (unknown/null → keep relative global order in an "orphan" bucket at end)
  const byPhase = new Map(phaseList.map((p) => [p.id, []]));
  const orphans = [];
  const rest = all
    .filter((s) => s.id !== sid)
    .slice()
    .sort((a, b) => a.stepNumber - b.stepNumber || a.id - b.id);

  for (const s of rest) {
    const pid = s.trajectoryPhaseId;
    if (pid != null && byPhase.has(pid)) byPhase.get(pid).push({ ...s });
    else orphans.push({ ...s });
  }

  const moved = {
    ...moving,
    trajectoryPhaseId: tidPhase,
    phaseNumber: targetPhase.phaseNumber,
  };

  const targetBucket = byPhase.get(tidPhase);
  if (before == null) {
    targetBucket.push(moved);
  } else {
    const idx = targetBucket.findIndex((s) => s.id === before);
    if (idx < 0) {
      return { ok: false, code: 'invalid_before', message: 'beforeStepId not in target phase list' };
    }
    targetBucket.splice(idx, 0, moved);
  }

  const ordered = [];
  for (const p of phaseList) {
    for (const s of byPhase.get(p.id) || []) ordered.push(s);
  }
  for (const s of orphans) ordered.push(s);

  for (let i = 0; i < ordered.length; i += 1) {
    ordered[i] = { ...ordered[i], stepNumber: i + 1 };
  }

  return { ok: true, ordered, movedStepId: sid };
}
