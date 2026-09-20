import fs from 'node:fs';
import path from 'node:path';

export const PHASES = [
  'CollectInputs',
  'ReadyToCreate',
  'Created',
  'Prepared',
  'Recording',
  'Settled',
  'Asserting',
  'Done',
  'RetryNewTraj',
];

/** @type {Record<string, string[]>} */
const ALLOWED = {
  CollectInputs: ['ReadyToCreate'],
  ReadyToCreate: ['Created', 'CollectInputs'],
  Created: ['Prepared', 'ReadyToCreate'],
  Prepared: ['Recording', 'Created'],
  Recording: ['Settled'],
  Settled: ['Asserting', 'Recording'],
  Asserting: ['Done', 'RetryNewTraj'],
  Done: ['RetryNewTraj'],
  RetryNewTraj: ['ReadyToCreate'],
};

/**
 * @param {string} [repoRoot]
 */
export function createEvidenceDir(repoRoot = process.cwd()) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const evidenceDir = path.join(repoRoot, 'tmp', `recording-coach-${stamp}`);
  fs.mkdirSync(evidenceDir, { recursive: true });
  const wf = emptyWorkflow(evidenceDir);
  saveWorkflow(wf);
  return { evidenceDir, workflowPath: path.join(evidenceDir, 'workflow.json') };
}

export function emptyWorkflow(evidenceDir) {
  return {
    opencodeSessionId: null,
    phase: 'CollectInputs',
    trajectoryId: null,
    evidenceDir,
    dispatchBriefPath: null,
    preflight: null,
    acceptedPhases: null,
    cdpChecked: false,
    inputs: {
      goal: '',
      functionId: null,
      systemAccountId: null,
      stamp: {},
      forbidden: [],
      allowEngineEdit: false,
      taskText: '',
      assert: {},
      businessProbeRequired: false,
      productLabel: '',
    },
    lastError: null,
    updatedAt: new Date().toISOString(),
  };
}

export function loadWorkflow(evidenceDir) {
  const p = path.join(evidenceDir, 'workflow.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function saveWorkflow(wf) {
  wf.updatedAt = new Date().toISOString();
  const p = path.join(wf.evidenceDir, 'workflow.json');
  fs.mkdirSync(wf.evidenceDir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(wf, null, 2), 'utf8');
  return wf;
}

export function assertTransition(wf, nextPhase) {
  const cur = wf.phase;
  const ok = (ALLOWED[cur] || []).includes(nextPhase);
  if (!ok) {
    throw new Error(`illegal phase transition: ${cur} → ${nextPhase}`);
  }
}

/**
 * @param {object} wf
 * @param {string} toolName
 * @param {object} [payload]
 */
export function applyToolSuccess(wf, toolName, payload = {}) {
  switch (toolName) {
    case 'mark_inputs_ready':
      assertTransition(wf, 'ReadyToCreate');
      wf.phase = 'ReadyToCreate';
      if (payload.inputs) Object.assign(wf.inputs, payload.inputs);
      break;
    case 'create_trajectory':
      assertTransition(wf, 'Created');
      wf.phase = 'Created';
      wf.trajectoryId = payload.trajectoryId ?? payload.id ?? null;
      break;
    case 'prepare_record':
      assertTransition(wf, 'Prepared');
      wf.phase = 'Prepared';
      break;
    case 'start_record':
      assertTransition(wf, 'Recording');
      wf.phase = 'Recording';
      break;
    case 'start_settled':
      assertTransition(wf, 'Settled');
      wf.phase = 'Settled';
      break;
    case 'detach_trajectory':
      // optional; stay Settled or Recording→user may detach early
      break;
    case 'assert_steps':
      if (wf.phase === 'Settled') {
        assertTransition(wf, 'Asserting');
        wf.phase = 'Asserting';
      }
      if (wf.phase === 'Asserting') {
        assertTransition(wf, 'Done');
        wf.phase = 'Done';
      }
      break;
    case 'retry_new_traj':
      if (wf.phase === 'Asserting' || wf.phase === 'Done') {
        assertTransition(wf, 'RetryNewTraj');
        wf.phase = 'RetryNewTraj';
      }
      assertTransition(wf, 'ReadyToCreate');
      wf.phase = 'ReadyToCreate';
      wf.trajectoryId = null;
      wf.cdpChecked = false;
      wf.cdpPort = null;
      wf.lastError = null;
      break;
    default:
      throw new Error(`unknown tool for phase apply: ${toolName}`);
  }
  wf.lastError = null;
  return saveWorkflow(wf);
}

export function setPhase(wf, nextPhase) {
  assertTransition(wf, nextPhase);
  wf.phase = nextPhase;
  return saveWorkflow(wf);
}
