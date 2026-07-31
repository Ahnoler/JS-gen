import { state } from '../../state.js';
import { broadcast } from '../../ws-server.js';
import * as execSession from '../../executor-session-client.js';
import { persistLiveActionEntries, removeLivePersistedActions } from './persist-live.js';

/** Durable executor → control-plane event hook for a session (persist + broadcast). */
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
    if (type === 'manual_record_status') {
      session.manualRecording = !!payload?.enabled;
      broadcast('manual_record_status', { ...(payload || {}), sessionId: session.sessionId });
    }
  });
}
