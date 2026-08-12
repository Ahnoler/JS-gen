/**
 * Remote-bridge WS message router: `remote:*` messages from ws-server, BiB target
 * resolution (executor mode) and local screencast/input dispatch.
 */
import { state } from '../../state.js';
import { onWsMessage } from '../../ws-server.js';
import * as remoteSessionService from '../../services/remote-session-service.js';
import { USE_EXECUTOR } from '../../../config/config.js';
import { sendToExecutor } from '../../executor-session-client.js';
import { getTrajectoryRuntime } from '../../services/trajectory-runtime.js';
import { hideHighlight } from '../inspect.js';
import {
  bridge, getRemoteStatus, broadcastStatus, broadcastInspect,
} from './state.js';
import { startScreencast } from './screencast.js';
import { handleAck, handleInput, handleViewport } from './cdp-input.js';

function pickFromBinding(binding, trajectoryId = null) {
  if (!binding?.agentSessionId) return null;
  const session = state.sessions.get(binding.agentSessionId);
  const nodeUuid = session?.executorNodeUuid || binding.nodeUuid;
  if (!nodeUuid) return null;
  // Prefer executor-backed sessions; allow nodeUuid from binding after mild state drift.
  if (session && session.useExecutor === false) return null;
  return {
    executorNodeUuid: nodeUuid,
    sessionId: binding.agentSessionId,
    trajectoryId: binding.trajectoryId != null
      ? Number(binding.trajectoryId)
      : (trajectoryId != null ? Number(trajectoryId) : null),
    remoteSessionId: binding.remoteSessionId,
  };
}

function pickFromAgentSession(sessionId, trajectoryId = null) {
  if (!sessionId) return null;
  const binding = remoteSessionService.getLiveBindingByAgentSession?.(sessionId);
  const fromBinding = pickFromBinding(binding, trajectoryId);
  if (fromBinding) return fromBinding;

  const session = state.sessions.get(sessionId);
  if (session?.useExecutor && session?.executorNodeUuid) {
    return {
      executorNodeUuid: session.executorNodeUuid,
      sessionId,
      trajectoryId: trajectoryId != null ? Number(trajectoryId) : null,
      remoteSessionId: null,
    };
  }
  return null;
}

/**
 * Resolve which executor session should receive remote:* commands.
 * Priority: trajectoryId → remoteSessionId/uuid → sessionId → traj runtime →
 * single attached binding (only when no identity keys were sent).
 *
 * @param {{ trajectoryId?: number|null, sessionId?: string|null, remoteSessionId?: number|null, remoteSessionUuid?: string|null }} [opts]
 */
export function resolveBibTarget(opts = {}) {
  const tid = opts.trajectoryId != null ? Number(opts.trajectoryId) : null;
  const sessionId = opts.sessionId || null;
  const remoteSessionId = opts.remoteSessionId != null ? Number(opts.remoteSessionId) : null;
  const remoteSessionUuid = opts.remoteSessionUuid || null;
  const hasIdentity = Number.isFinite(tid)
    || !!sessionId
    || Number.isFinite(remoteSessionId)
    || !!remoteSessionUuid;

  const binding = remoteSessionService.resolveLiveBinding?.({
    trajectoryId: Number.isFinite(tid) ? tid : null,
    sessionId,
    remoteSessionId: Number.isFinite(remoteSessionId) ? remoteSessionId : null,
    remoteSessionUuid,
  });
  const fromBinding = pickFromBinding(binding, Number.isFinite(tid) ? tid : null);
  if (fromBinding) return fromBinding;

  if (sessionId) {
    const picked = pickFromAgentSession(sessionId, Number.isFinite(tid) ? tid : null);
    if (picked) return picked;
  }

  if (Number.isFinite(tid)) {
    const runtime = getTrajectoryRuntime(tid);
    if (runtime?.sessionId) {
      const picked = pickFromAgentSession(runtime.sessionId, tid);
      if (picked) return picked;
      if (runtime.executorNodeUuid) {
        return {
          executorNodeUuid: runtime.executorNodeUuid,
          sessionId: runtime.sessionId,
          trajectoryId: tid,
          remoteSessionId: runtime.remoteSessionId || null,
        };
      }
    }
  }

  // Legacy no-identity callers: if resolveLiveBinding already tried single-attach
  // and missed (e.g. binding without agentSessionId), try list again via pick.
  if (!hasIdentity) {
    const attached = (remoteSessionService.listLiveBindings?.() || []).filter((b) => b.attached);
    if (attached.length === 1) {
      const picked = pickFromBinding(attached[0], null);
      if (picked) return picked;
    }
  }

  return null;
}

/**
 * Register the WS message router exactly once. `attachLive` is injected by
 * index.js to keep this module free of import cycles.
 */
export function ensureWsHook(attachLive) {
  if (bridge.wsHooked) return;
  bridge.wsHooked = true;
  onWsMessage(async (ws, msg) => {
    const type = msg?.type;
    if (!type || !String(type).startsWith('remote:')) return;

    // Executor mode: proxy remote_* WS commands — scoped by subscribed trajectoryId.
    if (USE_EXECUTOR) {
      if (type === 'remote:subscribe') {
        const trajectoryId = msg.payload?.trajectoryId != null
          ? Number(msg.payload.trajectoryId)
          : null;
        const sessionId = msg.payload?.sessionId || null;
        const remoteSessionId = msg.payload?.remoteSessionId != null
          ? Number(msg.payload.remoteSessionId)
          : null;
        const remoteSessionUuid = msg.payload?.remoteSessionUuid
          ? String(msg.payload.remoteSessionUuid)
          : null;
        bridge.wsTrajectoryBind.set(ws, {
          trajectoryId: Number.isFinite(trajectoryId) ? trajectoryId : null,
          sessionId: sessionId || null,
          remoteSessionId: Number.isFinite(remoteSessionId) ? remoteSessionId : null,
          remoteSessionUuid: remoteSessionUuid || null,
        });
        const live = await remoteSessionService.getLiveStatus({
          trajectoryId: Number.isFinite(trajectoryId) ? trajectoryId : undefined,
          sessionId: sessionId || undefined,
          remoteSessionId: Number.isFinite(remoteSessionId) ? remoteSessionId : undefined,
          remoteSessionUuid: remoteSessionUuid || undefined,
        }).catch(() => null);
        ws.send(JSON.stringify({
          type: 'remote:status',
          payload: live || { attached: false, cdpReady: true, trajectoryId },
        }));
        return;
      }
      if (type === 'remote:unsubscribe') {
        bridge.wsTrajectoryBind.delete(ws);
        return;
      }

      const bind = bridge.wsTrajectoryBind.get(ws) || {};
      const trajectoryId = msg.payload?.trajectoryId != null
        ? Number(msg.payload.trajectoryId)
        : bind.trajectoryId;
      const sessionId = msg.payload?.sessionId || bind.sessionId || null;
      const remoteSessionId = msg.payload?.remoteSessionId != null
        ? Number(msg.payload.remoteSessionId)
        : (bind.remoteSessionId != null ? Number(bind.remoteSessionId) : null);
      const remoteSessionUuid = msg.payload?.remoteSessionUuid
        || bind.remoteSessionUuid
        || null;
      const live = await remoteSessionService.getLiveStatus({
        trajectoryId: Number.isFinite(trajectoryId) ? trajectoryId : undefined,
        sessionId: sessionId || undefined,
        remoteSessionId: Number.isFinite(remoteSessionId) ? remoteSessionId : undefined,
        remoteSessionUuid: remoteSessionUuid || undefined,
      }).catch(() => null);

      const pick = resolveBibTarget({
        trajectoryId: Number.isFinite(trajectoryId) ? trajectoryId : null,
        sessionId,
        remoteSessionId: Number.isFinite(remoteSessionId) ? remoteSessionId : null,
        remoteSessionUuid,
      });

      if (!pick) {
        // Do not invent attached:false for input — that would lock the canvas while
        // prepare's bib_start is still broadcasting frames.
        if (
          type === 'remote:status'
          || type === 'remote:start'
          || type === 'remote:stop'
          || type === 'remote:tabs'
          || type === 'remote:switch_tab'
        ) {
          ws.send(JSON.stringify({
            type: 'remote:status',
            payload: live || {
              attached: false,
              cdpReady: true,
              trajectoryId: Number.isFinite(trajectoryId) ? trajectoryId : null,
            },
          }));
        } else if (type === 'remote:input') {
          console.warn(
            '[remote-bridge] drop remote:input — no executor pick',
            { trajectoryId, sessionId, remoteSessionId, remoteSessionUuid },
          );
          try {
            ws.send(JSON.stringify({
              type: 'remote:error',
              payload: {
                id: 'resolve-pick',
                message: 'no executor pick for remote:input',
                trajectoryId: Number.isFinite(trajectoryId) ? trajectoryId : null,
                sessionId: sessionId || null,
                remoteSessionId: Number.isFinite(remoteSessionId) ? remoteSessionId : null,
              },
            }));
          } catch {}
        }
        return;
      }

      const { executorNodeUuid, sessionId: pickSessionId } = pick;

      try {
        if (type === 'remote:start') {
          sendToExecutor(executorNodeUuid, 'session.bib_start', { sessionId: pickSessionId });
        } else if (type === 'remote:stop') {
          sendToExecutor(executorNodeUuid, 'session.bib_stop', { sessionId: pickSessionId });
        } else if (type === 'remote:ack') {
          sendToExecutor(executorNodeUuid, 'session.bib_ack', {
            sessionId: pickSessionId,
            ...(msg.payload || {}),
          });
        } else if (type === 'remote:input') {
          // Strip routing keys so executor Input.* payload stays clean
          const {
            trajectoryId: _t,
            sessionId: _s,
            remoteSessionId: _r,
            remoteSessionUuid: _u,
            ...inputPayload
          } = msg.payload || {};
          sendToExecutor(executorNodeUuid, 'session.bib_input', {
            sessionId: pickSessionId,
            ...inputPayload,
          });
        } else if (type === 'remote:tabs') {
          sendToExecutor(executorNodeUuid, 'session.bib_tabs', { sessionId: pickSessionId });
        } else if (type === 'remote:switch_tab') {
          sendToExecutor(executorNodeUuid, 'session.bib_switch_tab', {
            sessionId: pickSessionId,
            targetId: msg.payload?.targetId,
            url: msg.payload?.url,
            pageId: msg.payload?.pageId,
          });
        }
      } catch {}

      if (
        type === 'remote:start'
        || type === 'remote:stop'
        || type === 'remote:status'
        || type === 'remote:tabs'
        || type === 'remote:switch_tab'
      ) {
        const live2 = await remoteSessionService.getLiveStatus({
          trajectoryId: Number.isFinite(trajectoryId) ? trajectoryId : undefined,
          sessionId: pickSessionId || undefined,
          remoteSessionId: Number.isFinite(remoteSessionId) ? remoteSessionId : undefined,
        }).catch(() => null);
        ws.send(JSON.stringify({
          type: 'remote:status',
          payload: live2 || { attached: false, cdpReady: true, trajectoryId },
        }));
      }
      return;
    }

    if (type === 'remote:subscribe') {
      bridge.subscribers.add(ws);
      ws.send(JSON.stringify({ type: 'remote:status', payload: getRemoteStatus() }));
      return;
    }
    if (type === 'remote:unsubscribe') {
      bridge.subscribers.delete(ws);
      return;
    }
    if (type === 'remote:start') {
      try {
        bridge.subscribers.add(ws);
        if (!bridge.client) {
          // Never pass dashboard canvas size as Chrome viewport unless resize:true
          await attachLive(msg.payload || {});
        } else if (!bridge.screencastOn) {
          await startScreencast();
        } else if (msg.payload?.resize === true) {
          await handleViewport(msg.payload);
        }
        ws.send(JSON.stringify({ type: 'remote:status', payload: getRemoteStatus() }));
      } catch (e) {
        ws.send(JSON.stringify({ type: 'remote:error', payload: { message: e.message } }));
      }
      return;
    }
    if (type === 'remote:stop') {
      bridge.subscribers.delete(ws);
      if (bridge.subscribers.size === 0 && bridge.client) {
        try { await bridge.client.send('Page.stopScreencast'); } catch {}
        bridge.screencastOn = false;
      }
      broadcastStatus();
      return;
    }
    if (type === 'remote:ack') {
      await handleAck(msg.payload || {});
      return;
    }
    if (type === 'remote:input') {
      const result = await handleInput(msg.payload || {});
      if (!result.ok && result.reason === 'agent_busy') {
        ws.send(JSON.stringify({ type: 'remote:status', payload: getRemoteStatus() }));
      }
      if (result?.clipboard) {
        ws.send(JSON.stringify({
          type: 'remote:clipboard',
          payload: {
            sessionId: msg.payload?.sessionId || null,
            requestId: result.requestId || msg.payload?.requestId || null,
            ok: !!result.ok,
            text: result.text == null ? '' : String(result.text),
            reason: result.reason || null,
          },
        }));
      }
      return;
    }
    if (type === 'remote:inspect') {
      // Optional explicit inspect toggle / one-shot
      const p = msg.payload || {};
      if (typeof p.enabled === 'boolean') bridge.inspectEnabled = p.enabled;
      if (p.clear) {
        if (bridge.client) await hideHighlight(bridge.client);
        broadcastInspect('');
      }
      ws.send(JSON.stringify({ type: 'remote:status', payload: getRemoteStatus() }));
      return;
    }
    if (type === 'remote:viewport') {
      await handleViewport(msg.payload || {});
      return;
    }
    if (type === 'remote:status') {
      ws.send(JSON.stringify({ type: 'remote:status', payload: getRemoteStatus() }));
    }
  });
}
