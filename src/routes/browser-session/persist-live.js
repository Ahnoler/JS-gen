import { broadcast } from '../../ws-server.js';
import { appendRecordedStep } from '../../services/trajectory-service.js';
import { removeRecordedStepsByDbIds } from '../../services/trajectory/trajectory-persist-service.js';
import * as screenshotService from '../../services/screenshot-service.js';
import { isMetaStepAction } from '../../models/meta-step-actions.js';

const PENDING_SHOT_TTL_MS = 2 * 60 * 1000;

/**
 * Shared screenshot buffer + UPSERT helpers used by the three Node event fans:
 *  1) executor-events.js          — executor WS (manual/cdp + autoPersist agent)
 *  2) global-browser.js           — local Python stdout (engineering /api/browser/session)
 *  3) trajectory-record-lifecycle — v2 record/start AI agent subscribe
 * Screenshots arrive as one-shot step_screenshot (entryId + base64); step dbId may land
 * earlier or later → stashOrApply / flushPending bridge the race.
 */

function ensureShotMaps(ctx) {
  if (!ctx) return null;
  if (!ctx._lastPersistByActionId) ctx._lastPersistByActionId = new Map();
  if (!ctx._pendingStepShots) ctx._pendingStepShots = new Map();
  return ctx;
}

function prunePendingShots(ctx) {
  if (!ctx?._pendingStepShots?.size) return;
  const now = Date.now();
  for (const [eid, shot] of ctx._pendingStepShots) {
    if (!shot || (now - (shot.ts || 0)) > PENDING_SHOT_TTL_MS) {
      ctx._pendingStepShots.delete(eid);
    }
  }
}

function decodeB64(b64) {
  if (!b64 || typeof b64 !== 'string') return null;
  try {
    const buf = Buffer.from(b64, 'base64');
    return buf.length ? buf : null;
  } catch {
    return null;
  }
}

async function writeShotsForStep(trajectoryStepId, trajectoryId, beforeB64, afterB64, dialogB64 = null, dialogMeta = null) {
  const stepId = Number(trajectoryStepId);
  if (!Number.isFinite(stepId) || stepId <= 0) return;
  const trajId = trajectoryId != null ? Number(trajectoryId) : null;
  const before = decodeB64(beforeB64);
  const after = decodeB64(afterB64);
  const dialog = decodeB64(dialogB64);

  const upsertOne = async (kind, buffer) => {
    try {
      await screenshotService.replaceStepScreenshot(stepId, {
        trajectoryId: trajId,
        kind,
        buffer,
      });
    } catch (err) {
      // Coalesce / live-remove can delete trajectory_step before the matching
      // step_screenshot flush lands → FK 1452. Harmless; the replacement step
      // gets its own before/after under a new entryId.
      const errno = err?.errno ?? err?.code;
      const sqlMsg = err?.sqlMessage || '';
      if (errno === 1452 || errno === 'ER_NO_REFERENCED_ROW_2'
        || /foreign key constraint fails/i.test(sqlMsg)
        || /foreign key constraint fails/i.test(String(err?.message || ''))) {
        console.warn(
          `[step-screenshot] ${kind} upsert skipped (step ${stepId} gone — coalesce/remove race)`,
        );
        return;
      }
      console.warn(
        `[step-screenshot] ${kind} upsert failed:`,
        sqlMsg || err?.message || err,
      );
    }
  };

  if (before) await upsertOne('before', before);
  if (after) await upsertOne('after', after);

  if (dialog) {
    try {
      await screenshotService.replaceDialogScreenshot(stepId, {
        trajectoryId: trajId,
        buffer: dialog,
        mimeType: 'image/png',
        metadataJson: JSON.stringify(dialogMeta || {}),
      });
    } catch (err) {
      const errno = err?.errno ?? err?.code;
      const sqlMsg = err?.sqlMessage || '';
      if (errno === 1452 || errno === 'ER_NO_REFERENCED_ROW_2'
        || /foreign key constraint fails/i.test(sqlMsg)
        || /foreign key constraint fails/i.test(String(err?.message || ''))) {
        console.warn(
          `[step-screenshot] dialog upsert skipped (step ${stepId} gone — coalesce/remove race)`,
        );
        return;
      }
      console.warn('[step-screenshot] dialog upsert failed:', sqlMsg || err?.message || err);
    }
  }
}

/**
 * Store screenshots until trajectory_step dbId is known, or apply immediately.
 * @param {object} ctx session or runtime (needs _lastPersistByActionId / _pendingStepShots)
 * @param {string} entryId ACTION_LOG entry UUID
 * @param {{ before?: string|null, after?: string|null, trajectoryId?: number|null }} shots
 */
export async function stashOrApplyStepScreenshot(ctx, entryId, {
  before = null,
  after = null,
  dialog = null,
  dialogMeta = null,
  trajectoryId = null,
} = {}) {
  const eid = entryId != null ? String(entryId) : '';
  if (!eid || (!before && !after && !dialog)) return;
  const maps = ensureShotMaps(ctx);
  if (!maps) return;
  prunePendingShots(maps);

  const info = maps._lastPersistByActionId.get(eid);
  const dbId = info?.dbId != null ? Number(info.dbId) : null;
  const trajId = trajectoryId != null
    ? Number(trajectoryId)
    : (info?.trajectoryId != null ? Number(info.trajectoryId) : (ctx.dbTrajectoryId != null ? Number(ctx.dbTrajectoryId) : (ctx.trajectoryId != null ? Number(ctx.trajectoryId) : null)));

  if (Number.isFinite(dbId) && dbId > 0) {
    await writeShotsForStep(dbId, trajId, before, after, dialog, dialogMeta);
    maps._pendingStepShots.delete(eid);
    return;
  }

  const prev = maps._pendingStepShots.get(eid) || {};
  maps._pendingStepShots.set(eid, {
    before: before || prev.before || null,
    after: after || prev.after || null,
    dialog: dialog || prev.dialog || null,
    dialogMeta: dialogMeta || prev.dialogMeta || null,
    trajectoryId: trajId,
    ts: Date.now(),
  });
}

/**
 * After appendRecordedStep: consume any pending screenshots for this entryId.
 */
export async function flushPendingStepScreenshot(ctx, entryId, dbId, trajectoryId = null) {
  const eid = entryId != null ? String(entryId) : '';
  const stepId = Number(dbId);
  if (!eid || !Number.isFinite(stepId) || stepId <= 0) return;
  const maps = ensureShotMaps(ctx);
  if (!maps) return;
  const pending = maps._pendingStepShots.get(eid);
  if (!pending) return;
  maps._pendingStepShots.delete(eid);
  const trajId = trajectoryId != null
    ? Number(trajectoryId)
    : (pending.trajectoryId != null ? Number(pending.trajectoryId) : null);
  await writeShotsForStep(stepId, trajId, pending.before, pending.after, pending.dialog, pending.dialogMeta);
}

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
  ensureShotMaps(session);

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
        const actionName = String(entry.action || entry.actionType || '').trim();
        const isMeta = isMetaStepAction(actionName);
        // Meta checkpoints stay in DB for Type B replay, but do not push live UI noise
        if (!isMeta) {
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
            isMeta: false,
          });
        }
        const result = { ...persisted, trajectoryId: trajId, entry, isMeta };
        if (aid) session._lastPersistByActionId.set(aid, result);
        if (aid && persisted.dbId != null) {
          await flushPendingStepScreenshot(session, aid, persisted.dbId, trajId);
        }
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

/**
 * Remove previously live-persisted steps whose ACTION_LOG entry.id was coalesced away.
 * @param {object} session
 * @param {string[]} removedIds ACTION_LOG entry UUIDs
 * @param {object} [runtime] optional trajectory runtime (shares maps with session when present)
 */
export async function removeLivePersistedActions(session, removedIds, runtime = null) {
  const ids = (Array.isArray(removedIds) ? removedIds : [])
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  if (!ids.length) return { removed: 0 };

  const trajId = session?.dbTrajectoryId != null
    ? Number(session.dbTrajectoryId)
    : (runtime?.trajectoryId != null ? Number(runtime.trajectoryId) : null);
  if (!Number.isFinite(trajId) || trajId <= 0) return { removed: 0 };

  if (!session.persistedActionIds) session.persistedActionIds = new Set();
  if (!session._lastPersistByActionId) session._lastPersistByActionId = new Map();
  const persistMap = session._lastPersistByActionId;
  const persistedIds = session.persistedActionIds;
  const runtimeMap = runtime?._lastPersistByActionId;
  const runtimePersisted = runtime?.persistedActionIds;

  const dbIds = [];
  for (const aid of ids) {
    const info = persistMap.get(aid) || runtimeMap?.get(aid);
    const dbId = info?.dbId != null ? Number(info.dbId) : null;
    if (Number.isFinite(dbId) && dbId > 0) dbIds.push(dbId);
    persistedIds.delete(aid);
    persistMap.delete(aid);
    runtimePersisted?.delete(aid);
    runtimeMap?.delete(aid);
    session?._pendingStepShots?.delete(aid);
    runtime?._pendingStepShots?.delete(aid);
  }

  if (!dbIds.length) return { removed: 0 };

  const result = await removeRecordedStepsByDbIds(trajId, dbIds);
  if (result.removed > 0) {
    broadcast('action_removed', {
      trajectoryDbId: trajId,
      sessionId: session?.sessionId || runtime?.sessionId || null,
      removedIds: ids,
      dbIds,
      removed: result.removed,
    });
  }
  return result;
}
