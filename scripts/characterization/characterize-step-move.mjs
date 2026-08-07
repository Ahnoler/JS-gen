/**
 * Pure step-move ordering (no DB).
 * Run: node scripts/characterization/characterize-step-move.mjs
 */
import assert from 'assert';
import { planStepMove } from '../../src/services/trajectory-step-move.js';

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

console.log('ok: characterize-step-move');
