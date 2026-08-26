import { state } from '../../state.js';
import { broadcast } from '../../ws-server.js';
import * as execSession from '../../executor-session-client.js';
import {
  persistLiveActionEntries,
  removeLivePersistedActions,
  stashOrApplyStepScreenshot,
  applyPageLevelScreenshot,
} from './persist-live.js';
import { writeAgentEvent } from './agent-io.js';

/**
 * Enable/disable Python before/after page screenshots for a session.
 * @param {object} session target session state
 * @param {boolean} enabled whether to enable page-level screenshots
 * @returns {boolean} whether the event was successfully written
 */
export function setSessionCaptureScreenshots(session, enabled) {
  if (!session) return false;
  return writeAgentEvent(session, 'capture_screenshots', { enabled: !!enabled });
}

/**
 * Durable executor → control-plane event hook for a session (persist + broadcast).
 *
 * Listener #1 of 3 for step_screenshot (executor product path):
 * USE_EXECUTOR sessions receive Python events via executor WS → subscribeSessionEvents.
 * Handles manual / CDP live-persist (+ agent action_log_sync when autoPersist).
 * AI record/start has its own subscribe in trajectory-record-lifecycle.js (listener #3).
 * @param {object} session target session state
 */
export function bindExecutorSessionEvents(session) {
  if (!session?.useExecutor || !session.sessionId || session._persistUnsub) return;
  session._persistUnsub = execSession.subscribeSessionEvents(session.sessionId, (type, payload) => {
    if (type === 'action_log_sync') {
      const entries = Array.isArray(payload?.entries) ? payload.entries : [];
      session.lastActionLog = entries;
      broadcast('action_log_sync', { ...(payload || {}), sessionId: session.sessionId });
      const autoPersist = !!(session.autoPersist ?? state.globalBrowser.autoPersist);
      if (autoPersist && Number.isFinite(Number(session.dbTrajectoryId))) {
        const removedIds = Array.isArray(payload?.removedIds) ? payload.removedIds : [];
        const cleanup = removedIds.length
          ? removeLivePersistedActions(session, removedIds).catch(() => {})
          : Promise.resolve();
        cleanup.then(() => {
          // Agent steps only — manual/cdp are persisted via dedicated events (avoid double-write race)
          const agentEntries = entries.filter((e) => {
            const src = e?.source || 'agent';
            return src === 'agent';
          });
          if (agentEntries.length) {
            persistLiveActionEntries(session, agentEntries).catch(() => {});
          }
        });
      }
      return;
    }
    if (type === 'manual_action_recorded') {
      const entry = payload?.entry;
      if (entry) {
        session.lastActionLog = Array.isArray(session.lastActionLog) ? session.lastActionLog : [];
        const idx = session.lastActionLog.findIndex((e) => e.id && entry.id && e.id === entry.id);
        if (idx < 0) session.lastActionLog.push(entry);
        else session.lastActionLog[idx] = entry;
      }
      broadcast('manual_action_recorded', { ...(payload || {}), sessionId: session.sessionId });
      const autoPersist = !!(session.autoPersist ?? state.globalBrowser.autoPersist);
      if (autoPersist && entry) {
        persistLiveActionEntries(session, [entry], { source: 'manual' }).catch(() => {});
      }
      return;
    }
    // Quick actions (CDP watcher): dedicated persist path — not via action_log_sync
    if (type === 'cdp_action_result') {
      const raw = payload?.entry;
      const entry = raw ? { ...raw, source: 'cdp' } : null;
      if (entry) {
        session.lastActionLog = Array.isArray(session.lastActionLog) ? session.lastActionLog : [];
        const idx = session.lastActionLog.findIndex((e) => e.id && entry.id && e.id === entry.id);
        if (idx < 0) session.lastActionLog.push(entry);
        else session.lastActionLog[idx] = entry;
      }
      const autoPersist = !!(session.autoPersist ?? state.globalBrowser.autoPersist);
      if (autoPersist && entry && Number.isFinite(Number(session.dbTrajectoryId))) {
        persistLiveActionEntries(session, [entry], { source: 'cdp' }).catch(() => {});
      }
      return;
    }
    if (type === 'step_screenshot') {
      const entryId = payload?.entryId;
      stashOrApplyStepScreenshot(session, entryId, {
        before: payload?.before,
        after: payload?.after,
        trajectoryId: session.dbTrajectoryId,
      }).catch((err) => console.warn('[step-screenshot] stash failed:', err?.message || err));
      return;
    }
    if (type === 'page_level_screenshot') {
      if (Number.isFinite(Number(session?.dbTrajectoryId))) {
        applyPageLevelScreenshot(session.dbTrajectoryId, payload).catch((err) => {
          console.warn('[page-level-screenshot] persist failed:', err?.message || err);
        });
      }
      return;
    }
    if (type === 'manual_record_status') {
      session.manualRecording = !!payload?.enabled;
      broadcast('manual_record_status', { ...(payload || {}), sessionId: session.sessionId });
    }
  });
}
