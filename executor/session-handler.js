/**
 * Maps WS session.* commands from control plane to SessionManager.
 */

/** @param {import('./session-manager.js').SessionManager} manager */
export function createSessionHandler(manager) {
  return async function handleSessionMessage(type, payload) {
    const sessionId = payload?.sessionId;
    // list / list_cdp may use requestId as sessionId for reply routing
    if (!sessionId && type !== 'session.list' && type !== 'session.list_cdp') {
      throw new Error('sessionId is required');
    }

    switch (type) {
      case 'session.open':
        return manager.open(payload);
      case 'session.list':
        return {
          requestId: payload?.requestId || sessionId,
          sessions: manager.list(),
        };
      case 'session.list_cdp':
        return {
          requestId: payload?.requestId || sessionId,
          ...(await manager.listCdp()),
        };
      case 'session.attach_bib':
        return manager.attachBib({
          sessionId,
          remoteSessionUuid: payload.remoteSessionUuid,
          quality: payload.quality,
          resize: payload.resize,
          viewportW: payload.viewportW,
          viewportH: payload.viewportH,
          deviceScaleFactor: payload.deviceScaleFactor,
        });
      case 'session.detach_bib':
        return manager.detachBib(sessionId, { crashed: !!payload.crashed });
      case 'session.bib_start':
        return manager.bibStart(sessionId, payload);
      case 'session.bib_stop':
        return manager.bibStop(sessionId);
      case 'session.bib_ack':
        return manager.bibAck(sessionId, payload);
      case 'session.bib_input':
        return manager.bibInput(sessionId, payload);
      case 'session.bib_tabs':
        return manager.bibListTabs(sessionId);
      case 'session.bib_switch_tab':
        return manager.bibSwitchTab(sessionId, {
          targetId: payload.targetId,
          url: payload.url,
          pageId: payload.pageId,
        });
      case 'session.bib_resolve_element':
        return manager.bibResolveElement(sessionId, {
          labelText: payload.labelText || payload.label_text,
          actionType: payload.actionType || payload.action || '',
          params: payload.params || {},
          requestId: payload.requestId,
        });
      case 'session.step':
        return manager.forward(sessionId, 'step', {
          instruction: payload.task || payload.instruction,
          max_steps: payload.maxSteps ?? payload.max_steps ?? 40,
          phase_number: payload.phaseNumber ?? payload.phase_number,
          case_data_file: payload.caseDataFile ?? payload.case_data_file,
          case_data: payload.caseData ?? payload.case_data,
          special_element_candidates:
            payload.specialElementCandidates
            ?? payload.special_element_candidates
            ?? null,
          prior_phases:
            payload.priorPhases ?? payload.prior_phases ?? null,
        });
      case 'session.close':
        return manager.close(sessionId, {
          // 释放资源默认关浏览器；显式 keepBrowser:true 才留空闲 CDP
          keepBrowser: payload?.keepBrowser === true || payload?.keep_browser === true,
        });
      case 'session.cancel_step':
        return manager.forward(sessionId, 'cancel_step', {});
      case 'session.intervene':
        return { ok: false, error: 'Gone', message: 'session.intervene is retired. Use manual recording.' };
      case 'session.manual_record_start':
        return manager.forward(sessionId, 'manual_record_start', {});
      case 'session.manual_record_stop':
        return manager.forward(sessionId, 'manual_record_stop', {});
      case 'session.manual_dom_event':
        return manager.forward(sessionId, 'manual_dom_event', payload.domEvent || payload);
      case 'session.cdp_action':
        return manager.forward(sessionId, 'cdp_action', payload);
      case 'session.save_trajectory':
        return manager.forward(sessionId, 'save_trajectory', {});
      case 'session.save_case_data':
        return manager.forward(sessionId, 'save_case_data', {});
      case 'session.get_action_log':
        return manager.forward(sessionId, 'get_action_log', {});
      case 'session.reset_trajectory':
        return manager.forward(sessionId, 'reset_trajectory', {});
      case 'session.stdin':
        return manager.forward(sessionId, payload.event, payload.data || {});
      default:
        throw new Error(`Unknown session command: ${type}`);
    }
  };
}

/** Relay Python stdout JSON to control plane WS (type = event name). */
export function relayAgentEvent(send, msg) {
  const event = msg.event;
  if (!event) return;
  // Flat agent events (e.g. cdp_action_result) put fields on the root;
  // nested ones use data{}. Merge both so nothing is dropped.
  const { event: _e, session_id: sid, data, ...rest } = msg;
  const payload = {
    sessionId: sid || data?.sessionId,
    ...(data && typeof data === 'object' ? data : {}),
    ...rest,
  };
  send(event, payload);
}
