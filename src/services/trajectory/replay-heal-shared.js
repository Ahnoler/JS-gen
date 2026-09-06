/**
 * Shared replay-heal helpers — byte-identical definitions formerly duplicated
 * in replay-batch-runner.js and form-structure-heal.js (move-only refactor).
 *
 * Owned by the Type A single-step AI heal and Type B form-structure heal
 * paths; both callers import from here instead of redefining locally.
 */
import * as execSession from '../../executor-session-client.js';
import * as memoryService from '../../memory/memory-service.js';
import { broadcast } from '../../ws-server.js';

const REPLAY_TIMEOUT_MS = 300000;
const HEAL_TIMEOUT_MS = 300000;
/** Enough room to redo one failed action only (no extra form diagnosis). */
const HEAL_MAX_STEPS = 12;

/** Sentinel: user stopped replay/heal via cancel_step / steps/replay/stop. */
const USER_ABORT_CODE = 'USER_ABORT';

/**
 * Create a sentinel error indicating the user aborted replay/heal.
 * @returns {Error & { code: string }} user-abort error
 */
function makeUserAbortError() {
  const err = new Error(USER_ABORT_CODE);
  err.code = USER_ABORT_CODE;
  return err;
}

/**
 * Check whether an error represents a user-initiated abort.
 * @param {Error|null|undefined} err error to check
 * @returns {boolean} true if the error is a user abort
 */
function isUserAbort(err) {
  if (!err) return false;
  if (err.code === USER_ABORT_CODE) return true;
  const msg = String(err.message || err || '');
  return msg === USER_ABORT_CODE || /USER_ABORT|Replay aborted/i.test(msg);
}

/**
 * Build the trajectory scope object for WS broadcast payloads.
 * @param {number} tid trajectory DB id
 * @returns {{ trajectoryId: number, trajectoryDbId: number }} scope object
 */
function trajScope(tid) {
  return { trajectoryId: tid, trajectoryDbId: tid };
}

/**
 * Broadcast a replay WS event with trajectory scope and extra payload.
 * @param {string} type event type
 * @param {number} tid trajectory DB id
 * @param {object} [extra] extra payload fields
 * @returns {void}
 */
function emitReplay(type, tid, extra = {}) {
  broadcast(type, { ...trajScope(tid), ...extra });
}

/**
 * Coerce a step id to a finite positive number, or null.
 * @param {string|number|null|undefined} id step id
 * @returns {number|null} numeric step id, or null
 */
function toNumericStepId(id) {
  if (id == null || id === '') return null;
  const n = Number(id);
  return Number.isFinite(n) ? n : null;
}

/**
 * Run a single AI heal step in the executor session and await phase_done/phase_error.
 * @param {object} runtime trajectory runtime (sessionId, executorNodeUuid, abortReplay, …)
 * @param {string} instruction heal instruction text for the agent
 * @param {number} [maxSteps] max heal steps (default HEAL_MAX_STEPS)
 * @param {'step'|'form_structure'} [healType] heal scope (default 'step')
 * @param {object|null} [healContract] structured heal contract payload
 * @returns {Promise<void>} resolves on phase_done; rejects on error/abort/timeout
 */
async function runHealStep(runtime, instruction, maxSteps = HEAL_MAX_STEPS, healType = 'step', healContract = null) {
  // P2-1: record replay-heal decision (deterministic instruction template, not LLM-generated)
  try {
    await memoryService.ingestEvents([{
      eventType: 'decision',
      trajectoryId: runtime.trajectoryDbId ?? runtime.trajectoryId ?? null,
      sessionId: runtime.sessionId,
      payload: { kind: 'heal', healType },
      decision: {
        decisionType: 'heal',
        model: '',
        temperature: 0.0,
        inputPreview: String(instruction || '').slice(0, 500),
        outputJson: {
          healType,
          maxSteps,
          healContract: healContract
            ? {
                mode: healContract.mode,
                scope: healContract.scope,
                strategy: healContract.strategy,
                category: healContract.reason?.category || null,
              }
            : null,
        },
        policyChecks: [{ check: 'instruction_present', pass: Boolean(instruction) }],
        auditStatus: instruction ? 'passed' : 'failed',
      },
    }]);
  } catch (err) {
    console.warn('[replay] heal decision ingest skipped:', err?.message || err);
  }

  await new Promise((resolve, reject) => {
    let settled = false;
    let sawAgentStopped = false;

    const rejectAbort = () => {
      cleanup();
      reject(makeUserAbortError());
    };

    const unsubDone = execSession.onSessionEvent(runtime.sessionId, 'phase_done', () => {
      if (settled) return;
      if (runtime.abortReplay || sawAgentStopped) {
        rejectAbort();
        return;
      }
      cleanup();
      resolve();
    });
    const unsubErr = execSession.onSessionEvent(runtime.sessionId, 'phase_error', (payload) => {
      if (settled) return;
      if (runtime.abortReplay || sawAgentStopped) {
        rejectAbort();
        return;
      }
      cleanup();
      reject(new Error(payload?.message || 'phase_error'));
    });
    const unsubStopped = execSession.onSessionEvent(runtime.sessionId, 'agent_stopped', () => {
      if (settled) return;
      sawAgentStopped = true;
      runtime.abortReplay = true;
      rejectAbort();
    });
    const timer = setTimeout(() => {
      if (settled) return;
      if (runtime.abortReplay || sawAgentStopped) {
        rejectAbort();
        return;
      }
      cleanup();
      reject(new Error('Timeout waiting for heal phase_done'));
    }, HEAL_TIMEOUT_MS);

    function cleanup() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { unsubDone(); } catch { /* ignore */ }
      try { unsubErr(); } catch { /* ignore */ }
      try { unsubStopped(); } catch { /* ignore */ }
    }

    if (runtime.abortReplay) {
      rejectAbort();
      return;
    }

    execSession.forwardStdin({
      nodeUuid: runtime.executorNodeUuid,
      sessionId: runtime.sessionId,
      event: 'step',
      data: {
        instruction,
        max_steps: maxSteps,
        phase_number: 0,
        heal_type: healType,
        healType,
        ...(healContract ? { heal_contract: healContract } : {}),
      },
    });
  });
}

export {
  REPLAY_TIMEOUT_MS,
  HEAL_TIMEOUT_MS,
  HEAL_MAX_STEPS,
  USER_ABORT_CODE,
  makeUserAbortError,
  isUserAbort,
  trajScope,
  emitReplay,
  toNumericStepId,
  runHealStep,
};
