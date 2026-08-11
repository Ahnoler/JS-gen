import { LLM_API_KEY, PORT } from '../../../config/config.js';
import { state } from '../../state.js';
import { broadcast } from '../../ws-server.js';
import {
  refreshCdpEndpoints, clearCdpEndpoints, detachLive, notifyManualRecordingChanged,
} from '../../cdp/remote-bridge.js';
import {
  killTree, killOrphans, waitForReady, spawnAgent,
} from '../../runtime/agent-process.js';
import { broadcastWatcherStatus } from './broadcasts.js';
import { persistLiveActionEntries, stashOrApplyStepScreenshot } from './persist-live.js';

async function ensureCdpDiscovered() {
  const gb = state.globalBrowser;
  if (gb.cdpWsUrl) return;
  try {
    await refreshCdpEndpoints();
  } catch (e) {
    console.warn('[browser-global] CDP discover failed:', e.message);
  }
}

export async function teardownRemoteBridge() {
  try { await detachLive({ crashed: true }); } catch {}
  clearCdpEndpoints();
}

export async function ensureGlobalBrowser(modelId) {
  const gb = state.globalBrowser;
  if (gb.isAlive()) {
    if (!gb.ready) await waitForReady(gb.process, 15000);
    await ensureCdpDiscovered();
    return;
  }
  gb.reset();
  killOrphans();

  const child = spawnAgent(['--session', '--session-id', 'global', '--model', modelId, '--base-url', `http://localhost:${PORT}/v1`, '--api-key', LLM_API_KEY], { OPENAI_API_KEY: LLM_API_KEY });

  child.stderr.on('data', (chunk) => { console.log(chunk.toString().trimEnd()); });
  child.on('exit', () => {
    gb.reset({ clearCdp: false });
    teardownRemoteBridge().finally(() => broadcastWatcherStatus());
    console.log('[browser-global] Agent process exited');
  });

  gb.process = child;
  gb.stdin = child.stdin;
  gb.model = modelId;
  gb.lastActionLog = [];

  child.stdin.on('error', () => {
    if (!gb.ready) return;
    gb.reset({ clearCdp: false });
    teardownRemoteBridge().finally(() => broadcastWatcherStatus());
  });

  try {
    await waitForReady(child, 15000);
    gb.ready = true;
    await ensureCdpDiscovered();
    broadcastWatcherStatus();
    console.log('[browser-global] Browser ready');

    // Persistent stdout listener: always forward action_log_sync / manual / cdp / step_screenshot
    // regardless of which handler (step, CDP, etc.) is active.
    //
    // Listener #2 of 3 for step_screenshot (local / engineering debug session):
    // When USE_EXECUTOR is off, the control plane spawns Python directly (ensureGlobalBrowser)
    // and reads child.stdout — there is no executor WS fan-out. This is the /api/browser/session
    // debug path used by the in-repo engineering tools, not the product v2 executor attach flow.
    let syncBuf = '';
    child.stdout.on('data', (chunk) => {
      syncBuf += chunk.toString();
      const lines = syncBuf.split('\n');
      syncBuf = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.event === 'action_log_sync') {
            gb.lastActionLog = msg.data?.entries || [];
            broadcast('action_log_sync', {
              ...(msg.data || {}),
              sessionId: [...state.sessions.keys()][0] || null,
            });
          } else if (msg.event === 'manual_action_recorded') {
            const entry = msg.data?.entry;
            gb.lastActionLog = Array.isArray(gb.lastActionLog) ? gb.lastActionLog : [];
            if (entry) {
              // Keep in-memory pending list in sync even if action_log_sync is delayed
              const idx = gb.lastActionLog.findIndex((e) => e.id && entry.id && e.id === entry.id);
              if (idx < 0) gb.lastActionLog.push(entry);
            }
            broadcast('manual_action_recorded', msg.data || {});
            // Live-persist only when「自动入库」is on (phase via selectedPhaseId → last phase)
            const session = [...state.sessions.values()][0];
            const autoPersist = !!(session?.autoPersist ?? gb.autoPersist);
            if (autoPersist && entry && session) {
              persistLiveActionEntries(session, [entry], { source: 'manual' })
                .catch((err) => console.warn('[manual-record] live persist failed:', err.message));
            }
          } else if (msg.event === 'cdp_action_result') {
            // Quick-action dedicated persist (local agent); HTTP handler also claim-safe
            const raw = msg.entry || msg.data?.entry;
            const entry = raw ? { ...raw, source: 'cdp' } : null;
            const session = [...state.sessions.values()][0];
            const autoPersist = !!(session?.autoPersist ?? gb.autoPersist);
            if (entry) {
              gb.lastActionLog = Array.isArray(gb.lastActionLog) ? gb.lastActionLog : [];
              const idx = gb.lastActionLog.findIndex((e) => e.id && entry.id && e.id === entry.id);
              if (idx < 0) gb.lastActionLog.push(entry);
            }
            if (autoPersist && entry && session && Number.isFinite(Number(session.dbTrajectoryId))) {
              persistLiveActionEntries(session, [entry], { source: 'cdp' })
                .catch((err) => console.warn('[cdp-action] live persist failed:', err.message));
            }
          } else if (msg.event === 'step_screenshot') {
            const session = [...state.sessions.values()][0];
            const data = msg.data || {};
            if (session && data.entryId) {
              stashOrApplyStepScreenshot(session, data.entryId, {
                before: data.before,
                after: data.after,
                trajectoryId: session.dbTrajectoryId,
              }).catch((err) => console.warn('[step-screenshot] stash failed:', err.message));
            }
          } else if (msg.event === 'manual_record_status') {
            gb.manualRecording = !!msg.data?.enabled;
            if (gb.manualRecording) notifyManualRecordingChanged(true);
            broadcast('manual_record_status', {
              ...(msg.data || {}),
              sessionId: [...state.sessions.keys()][0] || null,
            });
          }
        } catch {}
      }
    });
  } catch (err) {
    killTree(child.pid);
    setTimeout(() => killOrphans(), 2000);
    gb.process = null; gb.stdin = null;
    throw err;
  }
}
