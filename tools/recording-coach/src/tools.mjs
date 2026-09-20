/**
 * Control-plane tool handlers for recording-coach.
 * Phase gates + Strategy A start_record (long timeout + poll).
 */

import fs from 'node:fs';
import path from 'node:path';
import { createClient, unwrap } from './http.mjs';
import { assertDispatchBrief } from './dispatch-brief.mjs';
import { assertSteps } from './assert-steps.mjs';
import { loadWorkflow, saveWorkflow, applyToolSuccess, assertTransition } from './workflow.mjs';
import { phaseDigest, pollSnapshotName, POLL_INTERVAL_MS, RECORD_DEADLINE_MS } from './poll-watch.mjs';
import { assertNumericPhaseIds, cdpPortFromPrepare } from './phase-ids.mjs';
import {
  conclusionFromAssert,
  formatOperatorClose,
  pickEvidence,
} from './close-contract.mjs';
import { cdpPrecheck } from './cdp-precheck.mjs';
import { assertBusinessTaskText } from './task-text.mjs';

const TERMINAL_RECORD = new Set(['recorded', 'completed', 'failed', 'idle', 'draft']);

/**
 * @param {{ evidenceDir: string, baseUrl?: string }} opts
 */
export function createTools(opts) {
  const evidenceDir = opts.evidenceDir;
  const http = createClient({ baseUrl: opts.baseUrl });
  /** @type {Promise|null} */
  let startInFlight = null;

  function wf() {
    return loadWorkflow(evidenceDir);
  }

  function appendProgress(line) {
    const p = path.join(evidenceDir, 'progress.log');
    fs.appendFileSync(p, `[${new Date().toISOString()}] ${line}\n`, 'utf8');
  }

  function writeJson(name, obj) {
    fs.writeFileSync(path.join(evidenceDir, name), JSON.stringify(obj, null, 2), 'utf8');
  }

  function requirePhase(w, allowed) {
    const list = Array.isArray(allowed) ? allowed : [allowed];
    if (!list.includes(w.phase)) {
      throw new Error(`tool gated: need phase in [${list.join(',')}], have ${w.phase}`);
    }
  }

  function matchedSlotFromExecutors(executorData, prepareData) {
    const remoteSessionId = prepareData?.remoteSessionId;
    const trajectoryId = prepareData?.trajectoryId ?? prepareData?.trajectory?.id;
    const nodes = Array.isArray(executorData)
      ? executorData
      : executorData?.nodes || executorData?.items || [];
    for (const node of nodes) {
      for (const slot of node.slots || []) {
        if (
          remoteSessionId != null &&
          Number(slot.remoteSessionId) === Number(remoteSessionId)
        ) {
          return slot.slotIndex;
        }
        if (trajectoryId != null && Number(slot.trajectoryId) === Number(trajectoryId)) {
          return slot.slotIndex;
        }
      }
    }
    return null;
  }

  async function list_executors() {
    const raw = await http.get('/api/v2/executors');
    const data = unwrap(raw);
    writeJson('list-executors.json', raw);
    return { ok: true, data };
  }

  async function get_trajectory({ trajectoryId, summary = true } = {}) {
    const w = wf();
    const id = trajectoryId ?? w.trajectoryId;
    if (id == null) throw new Error('trajectoryId required');
    const raw = await http.get(`/api/v2/trajectories/${id}`);
    const data = unwrap(raw);
    if (summary && data && typeof data === 'object') {
      const steps = Array.isArray(data.steps) ? data.steps : [];
      return {
        ok: true,
        data: {
          id: data.id,
          name: data.name,
          recordStatus: data.recordStatus,
          stepCount: data.stepCount ?? steps.length,
          phaseCount: Array.isArray(data.phases) ? data.phases.length : 0,
          phases: (data.phases || []).map((p) => ({
            id: p.id,
            name: p.name,
            status: p.status,
          })),
          actionTypes: [...new Set(steps.map((s) => s.actionType).filter(Boolean))],
        },
      };
    }
    return { ok: true, data };
  }

  async function analyze_trajectory({ description, functionId, taskText } = {}) {
    const w = wf();
    requirePhase(w, ['ReadyToCreate', 'CollectInputs', 'Created']);
    const desc = description || taskText || w.inputs.taskText || w.inputs.goal;
    const fid = functionId ?? w.inputs.functionId;
    if (!desc || fid == null) throw new Error('analyze needs description/taskText and functionId');
    const raw = await http.post(
      '/api/v2/trajectories/analyze',
      { description: desc, functionId: Number(fid) },
      { timeoutMs: 180_000 },
    );
    writeJson('analyze.json', raw);
    return { ok: true, data: unwrap(raw) };
  }

  async function save_dispatch_brief({ text } = {}) {
    const w = wf();
    requirePhase(w, ['CollectInputs', 'ReadyToCreate']);
    assertDispatchBrief(text);
    const briefPath = path.join(evidenceDir, 'dispatch-brief.md');
    fs.writeFileSync(briefPath, String(text), 'utf8');
    w.dispatchBriefPath = briefPath;
    saveWorkflow(w);
    return { ok: true, dispatchBriefPath: briefPath, phase: w.phase };
  }

  function executorSummary(executorData) {
    const nodes = Array.isArray(executorData)
      ? executorData
      : executorData?.nodes || executorData?.items || [];
    return nodes.map((n) => ({
      connected: n.connected,
      capacity: n.capacity,
      inUse: n.inUse,
    }));
  }

  function hasFreeExecutorSlot(executorData) {
    const nodes = Array.isArray(executorData)
      ? executorData
      : executorData?.nodes || executorData?.items || [];
    if (!Array.isArray(nodes) || !nodes.length) return false;
    return nodes.some((n) => {
      if (!n.connected) return false;
      const cap = Number(n.capacity ?? 1);
      const used = Number(n.inUse ?? 0);
      return used < cap;
    });
  }

  async function probeGet(probePath) {
    try {
      const raw = await http.get(probePath);
      return { path: probePath, ok: true, status: 200, data: unwrap(raw) };
    } catch (e) {
      const statusMatch = /HTTP (\d+)/.exec(String(e.message));
      return {
        path: probePath,
        ok: false,
        status: statusMatch ? Number(statusMatch[1]) : 0,
        error: String(e.message || e),
      };
    }
  }

  async function preflight_readonly({ probes = [] } = {}) {
    const w = wf();
    requirePhase(w, 'ReadyToCreate');
    const probeList = Array.isArray(probes) ? probes : [];

    for (const probe of probeList) {
      const probePath = String(probe?.path || '');
      if (!probePath.startsWith('/api/v2/')) {
        throw new Error('probe path must start with /api/v2/');
      }
    }

    const ex = await list_executors();
    const executors = executorSummary(ex.data);

    if (!hasFreeExecutorSlot(ex.data)) {
      const preflight = { ok: false, at: new Date().toISOString(), executors, probes: [] };
      writeJson('preflight.json', preflight);
      w.preflight = { ok: false };
      saveWorkflow(w);
      throw new Error('BLOCKED_无空闲槽位');
    }

    if (w.inputs.businessProbeRequired === true && probeList.length === 0) {
      const preflight = { ok: false, at: new Date().toISOString(), executors, probes: [] };
      writeJson('preflight.json', preflight);
      w.preflight = { ok: false };
      saveWorkflow(w);
      throw new Error('BLOCKED_前置未核');
    }

    const probeResults = [];
    for (const probe of probeList) {
      const result = await probeGet(String(probe.path));
      probeResults.push({
        label: probe.label,
        path: probe.path,
        status: result.status,
        ok: result.ok,
        data: result.data,
        error: result.error,
      });
      if (!result.ok) {
        const preflight = {
          ok: false,
          at: new Date().toISOString(),
          executors,
          probes: probeResults,
        };
        writeJson('preflight.json', preflight);
        w.preflight = { ok: false };
        saveWorkflow(w);
        throw new Error('BLOCKED_前置未核');
      }
    }

    const at = new Date().toISOString();
    const preflight = { ok: true, at, executors, probes: probeResults };
    writeJson('preflight.json', preflight);
    w.preflight = { ok: true, at };
    saveWorkflow(w);
    return { ok: true, preflight, phase: w.phase };
  }

  async function accept_phases() {
    const w = wf();
    requirePhase(w, 'ReadyToCreate');
    const analyzePath = path.join(evidenceDir, 'analyze.json');
    if (!fs.existsSync(analyzePath)) {
      throw new Error('analyze.json required');
    }
    const raw = JSON.parse(fs.readFileSync(analyzePath, 'utf8'));
    const phases = unwrap(raw)?.phases || [];
    if (!phases.length) {
      throw new Error('no phases in analyze');
    }
    if (phases.length > 10) {
      throw new Error('phase count must be <= 10');
    }
    for (const phase of phases) {
      const desc = String(phase?.description || '').trim();
      if (desc.length < 20) {
        throw new Error('phase description too short');
      }
    }
    w.acceptedPhases = phases;
    saveWorkflow(w);
    return { ok: true, phaseCount: phases.length, phase: w.phase };
  }

  async function create_trajectory(args = {}) {
    let w = wf();
    requirePhase(w, 'ReadyToCreate');
    if (!w.preflight?.ok) throw new Error('preflight required');
    if (!w.dispatchBriefPath) throw new Error('dispatch brief required');
    if (!Array.isArray(w.acceptedPhases) || w.acceptedPhases.length === 0) {
      throw new Error('accept_phases required');
    }
    if (w.acceptedPhases.length > 10) {
      throw new Error('phase count must be <= 10');
    }
    const prepared = String(w.inputs.taskText || '').trim();
    const incoming = String(args.task || args.taskText || '').trim();
    // Prepared gate text wins over a shorter label the model may pass (e.g. "STC首行").
    const task =
      prepared && (!incoming || incoming.length < prepared.length)
        ? prepared
        : incoming || prepared || w.inputs.goal;
    assertBusinessTaskText(task);
    const fid = args.functionId ?? w.inputs.functionId;
    const accountId = args.systemAccountId ?? w.inputs.systemAccountId;
    if (!task || fid == null || accountId == null) {
      throw new Error('create needs task, functionId, systemAccountId');
    }
    const phases = w.acceptedPhases;
    const name =
      args.name ||
      `coach-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16)}`;
    const raw = await http.post(
      '/api/v2/trajectories',
      {
        name,
        task,
        requirement: args.requirement || task,
        phases,
        functionId: Number(fid),
        systemAccountId: Number(accountId),
      },
      { timeoutMs: 60_000 },
    );
    writeJson('create.json', raw);
    const data = unwrap(raw);
    const tid = data?.id;
    fs.writeFileSync(path.join(evidenceDir, 'traj-id.txt'), String(tid), 'utf8');
    w = applyToolSuccess(wf(), 'create_trajectory', { trajectoryId: tid });
    return { ok: true, trajectoryId: tid, data, phase: w.phase };
  }

  async function prepare_record({ trajectoryId } = {}) {
    let w = wf();
    requirePhase(w, 'Created');
    const id = trajectoryId ?? w.trajectoryId;
    if (id == null) throw new Error('trajectoryId required');
    const ex = await list_executors();
    const nodes = Array.isArray(ex.data) ? ex.data : ex.data?.nodes || ex.data?.items || [];
    if (Array.isArray(nodes) && nodes.length) {
      const free = nodes.filter((n) => {
        if (!n.connected) return false;
        const cap = Number(n.capacity ?? 1);
        const used = Number(n.inUse ?? 0);
        return used < cap;
      });
      if (!free.length) {
        throw new Error('no free executor slot — refuse prepare');
      }
    }
    const raw = await http.post(
      `/api/v2/trajectories/${id}/record/prepare`,
      {},
      { timeoutMs: 600_000 },
    );
    writeJson('prepare.json', raw);
    const data = unwrap(raw);
    if (data?.ready !== true) {
      throw new Error('prepare not ready — stop');
    }
    const matchedSlot = matchedSlotFromExecutors(ex.data, data);
    w = wf();
    w.cdpPort = cdpPortFromPrepare(data, matchedSlot);
    w.cdpChecked = false;
    w = applyToolSuccess(w, 'prepare_record', {});
    return { ok: true, data, phase: w.phase };
  }

  async function cdp_precheck({ needles } = {}) {
    const w = wf();
    requirePhase(w, 'Prepared');
    const port = Number(w.cdpPort);
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error('cdp port missing');
    }
    const result = await cdpPrecheck({ port, evidenceDir, needles });
    const next = wf();
    next.cdpChecked = true;
    saveWorkflow(next);
    return { ok: true, ...result, phase: next.phase };
  }

  /**
   * Strategy A: long POST timeout + parallel poll GET every 60s → snapshots + progress.log
   */
  async function start_record({ trajectoryId, phaseIds, timeoutMs = RECORD_DEADLINE_MS } = {}) {
    let w = wf();
    requirePhase(w, 'Prepared');
    if (startInFlight) throw new Error('start_record already in flight (MVP one Recording)');
    const id = trajectoryId ?? w.trajectoryId;
    if (id == null) throw new Error('trajectoryId required');
    if (w.cdpChecked !== true) throw new Error('cdp precheck required');

    let ids = phaseIds;
    if (!ids?.length) {
      const detail = unwrap(await http.get(`/api/v2/trajectories/${id}`));
      ids = (detail?.phases || []).map((p) => p.id).filter(Boolean);
    }
    ids = assertNumericPhaseIds(ids);

    w = applyToolSuccess(wf(), 'start_record', {});
    appendProgress(`start_record begin traj=${id} phases=${JSON.stringify(ids)}`);

    let pollTimer;
    let pollN = 0;
    const started = Date.now();
    /** @type {(reason: Error) => void} */
    let rejectRun;
    const deadlinePromise = new Promise((_, reject) => {
      rejectRun = reject;
    });
    const deadlineTimer = setTimeout(
      () => rejectRun(new Error('BLOCKED_录制超时')),
      timeoutMs,
    );

    const pollOnce = async () => {
      pollN += 1;
      const raw = await http.get(`/api/v2/trajectories/${id}`, { timeoutMs: 30_000 });
      writeJson(pollSnapshotName(pollN), raw);
      const d = unwrap(raw);
      const digest = phaseDigest(d);
      appendProgress(
        `poll n=${pollN} recordStatus=${d?.recordStatus} stepCount=${d?.stepCount ?? '?'} done=${digest.doneCount}/${digest.phaseCount}`,
      );
      if (Date.now() - started > timeoutMs) {
        const err = new Error('BLOCKED_录制超时');
        rejectRun(err);
        throw err;
      }
    };
    const handlePollError = (e) => {
      if (String(e.message || e).includes('BLOCKED_录制超时')) {
        rejectRun(e);
      } else {
        appendProgress(`poll error: ${e.message}`);
      }
    };
    pollTimer = setInterval(() => {
      pollOnce().catch(handlePollError);
    }, POLL_INTERVAL_MS);
    void pollOnce().catch(handlePollError);

    const run = (async () => {
      try {
        const raw = await Promise.race([
          http.post(
            `/api/v2/trajectories/${id}/record/start`,
            { phaseIds: ids },
            { timeoutMs },
          ),
          deadlinePromise,
        ]);
        writeJson('start.json', raw);
        appendProgress(`start HTTP done status=${unwrap(raw)?.recordStatus}`);
        let cur = wf();
        if (cur.phase === 'Recording') {
          assertTransition(cur, 'Settled');
          cur.phase = 'Settled';
          saveWorkflow(cur);
        }
        return { ok: true, data: unwrap(raw), phase: 'Settled' };
      } catch (e) {
        appendProgress(`start error: ${e.message}`);
        try {
          await http.post(`/api/v2/trajectories/${id}/detach`, {}, { timeoutMs: 60_000 });
          appendProgress('detach after start failure');
        } catch (de) {
          appendProgress(`detach failed: ${de.message}`);
        }
        const cur = wf();
        cur.lastError = String(e.message || e);
        if (cur.phase === 'Recording') {
          try {
            assertTransition(cur, 'Settled');
            cur.phase = 'Settled';
          } catch {
            /* keep Recording for manual detach */
          }
        }
        saveWorkflow(cur);
        throw e;
      } finally {
        clearTimeout(deadlineTimer);
        clearInterval(pollTimer);
        startInFlight = null;
      }
    })();

    startInFlight = run;
    return run;
  }

  async function start_settled() {
    let w = wf();
    requirePhase(w, 'Recording');
    w = applyToolSuccess(w, 'start_settled', {});
    return { ok: true, phase: w.phase };
  }

  async function detach_trajectory({ trajectoryId } = {}) {
    const w = wf();
    const id = trajectoryId ?? w.trajectoryId;
    if (id == null) throw new Error('trajectoryId required');
    const raw = await http.post(
      `/api/v2/trajectories/${id}/detach`,
      {},
      { timeoutMs: 60_000 },
    );
    writeJson('detach.json', raw);
    applyToolSuccess(wf(), 'detach_trajectory', {});
    return { ok: true, data: unwrap(raw) };
  }

  async function assert_steps_tool({ criteria } = {}) {
    let w = wf();
    requirePhase(w, ['Settled', 'Asserting', 'Done']);
    const id = w.trajectoryId;
    if (id == null) throw new Error('trajectoryId required');
    const raw = await http.get(`/api/v2/trajectories/${id}`);
    const data = unwrap(raw);
    writeJson('traj-final.json', raw);
    const crit = { ...(criteria || w.inputs.assert || {}) };
    if (crit.honestReject === undefined) {
      crit.honestReject = { enabled: true };
    }
    const result = assertSteps(data, crit);
    const verdictPath = path.join(evidenceDir, 'verdict.txt');
    fs.writeFileSync(
      verdictPath,
      `${result.verdict}\npass=${result.pass}\n${result.reasons.join('\n')}\n`,
      'utf8',
    );
    if (w.phase === 'Settled' || w.phase === 'Asserting') {
      applyToolSuccess(wf(), 'assert_steps', {});
    }
    return { ok: true, ...result, phase: wf().phase };
  }

  async function write_evidence_summary({ text } = {}) {
    const body =
      text ||
      `evidenceDir=${evidenceDir}\ntrajectoryId=${wf().trajectoryId}\nphase=${wf().phase}\n`;
    fs.writeFileSync(path.join(evidenceDir, 'summary.txt'), body, 'utf8');
    return { ok: true };
  }

  async function mark_inputs_ready(inputs = {}) {
    const w = wf();
    requirePhase(w, 'CollectInputs');
    const taskText = String(inputs.taskText ?? w.inputs.taskText ?? '');
    assertBusinessTaskText(taskText);
    const next = applyToolSuccess(w, 'mark_inputs_ready', { inputs });
    return { ok: true, phase: next.phase, inputs: next.inputs };
  }

  async function retry_new_traj() {
    const w = wf();
    requirePhase(w, ['Asserting', 'Done', 'RetryNewTraj']);
    const next = applyToolSuccess(w, 'retry_new_traj', {});
    return { ok: true, phase: next.phase };
  }

  async function write_through_report() {
    const w = wf();
    requirePhase(w, 'Done');
    const id = w.trajectoryId;
    if (id == null) throw new Error('trajectoryId required');

    const raw = await http.get(`/api/v2/trajectories/${id}`);
    writeJson('traj-final.json', raw);
    const data = unwrap(raw);

    const crit = { ...(w.inputs.assert || {}) };
    if (crit.honestReject === undefined) {
      crit.honestReject = { enabled: true };
    }
    const assertResult = assertSteps(data, crit);
    const productLabel = String(w.inputs.productLabel || '').trim() || 'steps';
    const conclusion = conclusionFromAssert(assertResult, productLabel);
    const evidence = pickEvidence({ trajectory: data, evidenceDir });

    const reportPath = path.join(evidenceDir, 'through-report.md');
    const phaseLines = (data.phases || []).map((p) => {
      const logs = Array.isArray(p.doneLogs) ? p.doneLogs : [];
      const logText = logs.length
        ? (typeof logs[0] === 'string' ? logs[0] : String(logs[0]?.text ?? '')).slice(0, 400)
        : '';
      return `- id=${p.id} status=${p.status} doneLog=${logText}`;
    });
    const reportBody = [
      '# Through Report',
      '',
      `Trajectory id: ${data.id}`,
      `Conclusion: ${conclusion}`,
      '',
      '## Phases',
      ...phaseLines,
      '',
      '## Evidence',
      `1. ${evidence[0]}`,
      `2. ${evidence[1]}`,
      `3. ${evidence[2]}`,
    ].join('\n');
    fs.writeFileSync(reportPath, reportBody, 'utf8');

    const closeMessage = formatOperatorClose({
      conclusion,
      reportPath,
      evidence,
    });
    fs.writeFileSync(path.join(evidenceDir, 'close.txt'), closeMessage, 'utf8');

    return { ok: true, closeMessage };
  }

  const handlers = {
    mark_inputs_ready,
    save_dispatch_brief,
    preflight_readonly,
    accept_phases,
    list_executors,
    get_trajectory,
    analyze_trajectory,
    create_trajectory,
    prepare_record,
    cdp_precheck,
    start_record,
    start_settled,
    detach_trajectory,
    assert_steps: assert_steps_tool,
    write_evidence_summary,
    retry_new_traj,
    write_through_report,
  };

  /**
   * @param {string} name
   * @param {object} [args]
   */
  async function call(name, args = {}) {
    const fn = handlers[name];
    if (!fn) throw new Error(`unknown tool: ${name}`);
    return fn(args);
  }

  return { handlers, call, http, evidenceDir };
}

export { TERMINAL_RECORD };
