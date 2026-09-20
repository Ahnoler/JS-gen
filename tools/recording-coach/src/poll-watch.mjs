export const POLL_INTERVAL_MS = 60_000;
export const RECORD_DEADLINE_MS = 2_400_000;

export function pollSnapshotName(n) {
  return `poll-${n}.json`;
}

function logText(entry) {
  if (typeof entry === 'string') return entry;
  return String(entry?.text ?? '');
}

export function phaseDigest(trajectory) {
  const phases = Array.isArray(trajectory?.phases) ? trajectory.phases : [];
  const rows = phases.map((p) => {
    const doneLogTexts = (Array.isArray(p.doneLogs) ? p.doneLogs : [])
      .map(logText)
      .filter(Boolean)
      .map((t) => t.slice(0, 400));
    const status = String(p.status || '');
    return {
      id: p.id,
      phaseNumber: p.phaseNumber,
      status,
      done: status === 'completed' || status === 'done',
      doneLogTexts,
      tailUnreliable: true,
    };
  });
  return {
    phases: rows,
    doneCount: rows.filter((r) => r.done).length,
    phaseCount: rows.length,
  };
}
