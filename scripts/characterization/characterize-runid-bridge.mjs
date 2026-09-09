/**
 * runId bridge characterization (offline, no DB/session).
 * Pins spec 4.3.1 P0-1 (09-09 adversarial review): the recording runId must
 * survive BOTH whitelists between the control plane and the Python subprocess —
 *   forwardStdin (src/executor-session-client.js)  →  WS session.step
 *   →  createSessionHandler (executor/session-handler.js)  →  stdin JSON
 *   →  scripts/session_runner.py data.get("runId")  (key must stay `runId`).
 * Calls the real module code; only the executor session sink is a stub.
 * Run: node scripts/characterization/characterize-runid-bridge.mjs
 */
import assert from 'node:assert/strict';
import { mapStepPayloadForExecutor } from '../../src/executor-session-client.js';
import { createSessionHandler } from '../../executor/session-handler.js';

// Manager stub: capture what handleSessionMessage forwards to the Python stdin
// sink (manager.forward → slot.writeEvent JSON line).
function makeCaptureManager() {
  const forwarded = [];
  return {
    forwarded,
    forward(sessionId, stdinEvent, data = {}) {
      forwarded.push({ sessionId, stdinEvent: stdinEvent, data });
      return { sessionId, slotIndex: 0 };
    },
  };
}

// Cross-WS/stdin serialization: undefined keys vanish exactly as in production.
function toWire(value) {
  return JSON.parse(JSON.stringify(value));
}

function testRunIdSurvivesBothHops() {
  // Shape actually sent by trajectory-recording-runner.js (stepData.runId).
  const data = {
    instruction: 'Phase 1: open the order list',
    phase_number: 1,
    max_steps: 40,
    runId: 'run-20260909-abc123',
  };

  // Hop 1: control plane forwardStdin mapping → WS session.step payload.
  const wsPayload = toWire({ sessionId: 'sess-1', ...mapStepPayloadForExecutor(data) });
  assert.equal(wsPayload.runId, 'run-20260909-abc123', 'hop1 forwardStdin keeps runId');

  // Hop 2: executor createSessionHandler('session.step') → manager.forward data.
  const manager = makeCaptureManager();
  const handler = createSessionHandler(manager);
  return Promise.resolve(handler('session.step', wsPayload)).then(() => {
    assert.equal(manager.forwarded.length, 1, 'handler dispatched exactly one stdin event');
    const { sessionId, stdinEvent, data: stdinData } = manager.forwarded[0];
    assert.equal(sessionId, 'sess-1');
    assert.equal(stdinEvent, 'step');
    // Key must be exactly `runId` — session_runner.py:578 consumes data.get("runId").
    const wire = toWire(stdinData);
    assert.equal(wire.runId, 'run-20260909-abc123', 'hop2 keeps runId value unchanged');
    assert.ok(!('run_id' in wire), 'runId must not be renamed to run_id at the Python boundary');
  });
}

function testRunIdSnakeCaseCompat() {
  // Tolerant read: snake_case run_id also bridges through as runId.
  const wsPayload = toWire({ sessionId: 's', ...mapStepPayloadForExecutor({ run_id: 'run-snake-1' }) });
  assert.equal(wsPayload.runId, 'run-snake-1', 'hop1 accepts snake_case run_id');

  const manager = makeCaptureManager();
  return Promise.resolve(createSessionHandler(manager)('session.step', wsPayload)).then(() => {
    const wire = toWire(manager.forwarded[0].data);
    assert.equal(wire.runId, 'run-snake-1', 'hop2 normalizes run_id to runId');
    assert.ok(!('run_id' in wire), 'no duplicate run_id key on the wire');
  });
}

function testLegacyPayloadWithoutRunIdNotBroken() {
  // Compat window: old control plane / payload without runId must serialize to
  // Python exactly as before — no runId key at all (data.get("runId") → None).
  const wsPayload = toWire({
    sessionId: 's',
    ...mapStepPayloadForExecutor({ instruction: 'legacy step', phase_number: 2 }),
  });
  assert.ok(!('runId' in wsPayload), 'hop1 must not inject a runId for legacy payloads');

  const manager = makeCaptureManager();
  return Promise.resolve(createSessionHandler(manager)('session.step', wsPayload)).then(() => {
    const wire = toWire(manager.forwarded[0].data);
    assert.ok(!('runId' in wire), 'hop2 must not inject runId for legacy payloads');
    assert.ok(!('run_id' in wire), 'no run_id key for legacy payloads');
    assert.equal(wire.instruction, 'legacy step', 'legacy instruction still bridges');
    assert.equal(wire.max_steps, 40, 'legacy max_steps falls back to handler default');
    assert.equal(wire.phase_number, 2, 'legacy phase_number mapping unchanged');
  });
}

function testAdjacentWhitelistFieldsUnchanged() {
  // The mapper extraction must not disturb the pre-existing whitelist fields
  // (camelCase wire keys read from snake_case/camelCase stdin data).
  const wsPayload = toWire(mapStepPayloadForExecutor({
    instruction: 'do it',
    max_steps: 25,
    phase_number: 3,
    business_data_file: '/tmp/biz.xlsx',
    special_element_candidates: [{ kind: 'input' }],
    prior_outcome: { success: true },
    trajectory_id: 42,
    fact_pack: { facts: [1] },
    heal_contract: { heal_type: 'form_structure' },
  }));
  // After wire serialization, keys whose value was undefined are absent
  // (businessData / priorPhases / allPhases / businessDataBlock / runId).
  assert.deepEqual(wsPayload, {
    task: 'do it',
    maxSteps: 25,
    phaseNumber: 3,
    businessDataFile: '/tmp/biz.xlsx',
    specialElementCandidates: [{ kind: 'input' }],
    priorOutcome: { success: true },
    trajectoryId: 42,
    factPack: { facts: [1] },
    healContract: { heal_type: 'form_structure' },
  });
}

const steps = [
  testRunIdSurvivesBothHops,
  testRunIdSnakeCaseCompat,
  testLegacyPayloadWithoutRunIdNotBroken,
  testAdjacentWhitelistFieldsUnchanged,
];
let passed = 0;
for (const [i, fn] of steps.entries()) {
  try {
    await fn();
    passed += 1;
    console.log(`step ${i + 1}/${steps.length} ${fn.name}: OK`);
  } catch (err) {
    console.error(`FAIL step ${i + 1} (${fn.name}): ${err.message}`);
    process.exit(1);
  }
}
console.log(`OK ${passed} passed`);
