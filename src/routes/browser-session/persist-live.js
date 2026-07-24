import { broadcast } from '../../ws-server.js';
import { appendRecordedStep } from '../../services/trajectory-service.js';

/**
 * Live-persist ACTION_LOG entries for a bound trajectory (executor + local).
 * Dedupes by entry.id via session.persistedActionIds.
 *
 * Phase targeting:
 * - manual: session.selectedPhaseId, else last phase of trajectory
 * - agent:  session.activePhaseId (current executing phase), else entry.phase, else last phase
 */
export async function persistLiveActionEntries(session, entries, { source } = {}) {
  const trajId = session?.dbTrajectoryId != null ? Number(session.dbTrajectoryId) : null;
  if (!Number.isFinite(trajId) || !Array.isArray(entries) || !entries.length) return [];
  if (!session.persistedActionIds) session.persistedActionIds = new Set();
  if (!session._lastPersistByActionId) session._lastPersistByActionId = new Map();
  if (!session._persistInflight) session._persistInflight = new Map();

  const out = [];
  for (const entry of entries) {
    if (!entry) continue;
    const aid = entry.id != null ? String(entry.id) : '';

    // Another dedicated-path caller already owns this id — wait for it (no second DB write)
    if (aid && session.persistedActionIds.has(aid)) {
      const prev = session._lastPersistByActionId.get(aid);
      if (prev) {
        out.push(prev);
        continue;
      }
      const inflight = session._persistInflight.get(aid);
      if (inflight) {
        const waited = await inflight;
        if (waited) out.push(waited);
      }
      continue;
    }

    let resolveInflight = null;
    if (aid) {
      session.persistedActionIds.add(aid);
      const inflightPromise = new Promise((resolve) => { resolveInflight = resolve; });
      session._persistInflight.set(aid, inflightPromise);
    }

    const entrySource = source || entry.source || 'agent';
    // User-driven paths (manual / CDP quick action) bind to selected phase
    const phaseIdOverride = (entrySource === 'manual' || entrySource === 'cdp')
      ? (session.selectedPhaseId != null ? Number(session.selectedPhaseId) : null)
      : (session.activePhaseId != null
        ? Number(session.activePhaseId)
        : (session.selectedPhaseId != null ? Number(session.selectedPhaseId) : null));

    try {
      const persisted = await appendRecordedStep(trajId, entry, {
        source: entrySource,
        trajectoryPhaseId: Number.isFinite(phaseIdOverride) ? phaseIdOverride : undefined,
      });
      if (persisted) {
        const evt = entrySource === 'manual'
          ? 'manual_action_persisted'
          : entrySource === 'cdp'
            ? 'cdp_action_persisted'
            : 'action_persisted';
        broadcast(evt, {
          trajectoryDbId: trajId,
          sessionId: session.sessionId,
          ...persisted,
          entry,
        });
        const result = { ...persisted, entry };
        if (aid) session._lastPersistByActionId.set(aid, result);
        if (resolveInflight) resolveInflight(result);
        out.push(result);
      } else {
        if (aid) session.persistedActionIds.delete(aid);
        if (resolveInflight) resolveInflight(null);
      }
    } catch (err) {
      if (aid) session.persistedActionIds.delete(aid);
      if (resolveInflight) resolveInflight(null);
      console.warn('[live-persist] appendRecordedStep failed:', err.message);
    } finally {
      if (aid) session._persistInflight.delete(aid);
    }
  }
  return out;
}
