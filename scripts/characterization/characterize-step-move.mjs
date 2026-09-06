/**
 * Pure step-move ordering (no DB).
 * Run: node scripts/characterization/characterize-step-move.mjs
 */
import assert from 'assert';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { planStepMove } from '../../src/services/trajectory/trajectory-step-move.js';

const phases = [
  { id: 1, phaseNumber: 1 },
  { id: 2, phaseNumber: 2 },
];

function ids(ordered) {
  return ordered.map((s) => s.id);
}

// Within phase: [10,20,30] move 30 before 10 → [30,10,20]
{
  const steps = [
    { id: 10, trajectoryPhaseId: 1, stepNumber: 1 },
    { id: 20, trajectoryPhaseId: 1, stepNumber: 2 },
    { id: 30, trajectoryPhaseId: 1, stepNumber: 3 },
  ];
  const r = planStepMove({ steps, phases, stepId: 30, targetPhaseId: 1, beforeStepId: 10 });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(ids(r.ordered), [30, 10, 20]);
  assert.deepStrictEqual(r.ordered.map((s) => s.stepNumber), [1, 2, 3]);
}

// Append end of phase: omit beforeStepId
{
  const steps = [
    { id: 10, trajectoryPhaseId: 1, stepNumber: 1 },
    { id: 20, trajectoryPhaseId: 1, stepNumber: 2 },
    { id: 30, trajectoryPhaseId: 2, stepNumber: 3 },
  ];
  const r = planStepMove({ steps, phases, stepId: 10, targetPhaseId: 2, beforeStepId: null });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(ids(r.ordered), [20, 30, 10]);
  assert.strictEqual(r.ordered.find((s) => s.id === 10).trajectoryPhaseId, 2);
  assert.strictEqual(r.ordered.find((s) => s.id === 10).phaseNumber, 2);
}

// Cross-phase insert before
{
  const steps = [
    { id: 10, trajectoryPhaseId: 1, stepNumber: 1 },
    { id: 20, trajectoryPhaseId: 1, stepNumber: 2 },
    { id: 30, trajectoryPhaseId: 2, stepNumber: 3 },
    { id: 40, trajectoryPhaseId: 2, stepNumber: 4 },
  ];
  const r = planStepMove({ steps, phases, stepId: 20, targetPhaseId: 2, beforeStepId: 40 });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(ids(r.ordered), [10, 30, 20, 40]);
}

// Empty target phase append: phase1=[10], phase2=[], phase3=[30] → move 10 to phase2 end
{
  const phasesB = [
    { id: 1, phaseNumber: 1 },
    { id: 2, phaseNumber: 2 },
    { id: 3, phaseNumber: 3 },
  ];
  const steps = [
    { id: 10, trajectoryPhaseId: 1, stepNumber: 1 },
    { id: 30, trajectoryPhaseId: 3, stepNumber: 2 },
  ];
  const r = planStepMove({ steps, phases: phasesB, stepId: 10, targetPhaseId: 2, beforeStepId: null });
  assert.strictEqual(r.ok, true);
  // phase1 empty, phase2=[10], phase3=[30]
  assert.deepStrictEqual(ids(r.ordered), [10, 30]);
  assert.strictEqual(r.ordered[0].trajectoryPhaseId, 2);
}

// beforeStepId not in target phase → fail
{
  const steps = [
    { id: 10, trajectoryPhaseId: 1, stepNumber: 1 },
    { id: 20, trajectoryPhaseId: 2, stepNumber: 2 },
  ];
  const r = planStepMove({ steps, phases, stepId: 10, targetPhaseId: 2, beforeStepId: 10 });
  // before === stepId invalid
  assert.strictEqual(r.ok, false);
}

{
  const steps = [
    { id: 10, trajectoryPhaseId: 1, stepNumber: 1 },
    { id: 20, trajectoryPhaseId: 2, stepNumber: 2 },
  ];
  const r = planStepMove({ steps, phases, stepId: 20, targetPhaseId: 2, beforeStepId: 10 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'invalid_before');
}

// Step edit/move gate (2026-08-16): 409 only when AI recording is actually active
// （纯观看占位 recordStatus=recording 且非 AI 录制 → 放行步骤编辑/移动）
{
  const svc = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'services', 'trajectory', 'trajectory-step-service.js'),
    'utf8',
  );
  assert.ok(
    svc.includes("traj?.recordStatus === 'recording' && (await isAiRecordingActive(tid))"),
    'gate uses AI-active check',
  );
  assert.ok(svc.includes('await assertNotBusyForStepEdit('), 'call sites await the async guard');
  assert.ok(svc.includes('Cannot move steps while AI recording'), '409 message unchanged');
  const guardCalls = (svc.match(/await assertNotBusyForStepEdit\(/g) || []).length;
  assert.ok(guardCalls >= 3, `AI-active guard wired to move/update/remove (${guardCalls} call sites)`);
}

console.log('ok: characterize-step-move');
