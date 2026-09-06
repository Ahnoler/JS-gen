/**
 * Characterization: trajectory critical path contracts (offline, no DB/server).
 *
 * Covers:
 *   - facade module surface (query / step / account / recording / persist / phase / meta re-exports)
 *   - focused modules loadable directly (persist / phase / meta)
 *   - recordStatus enum + stop → recorded|failed, detached:false (≠ detach)
 *   - action log → stepFromActionLog → element xpath_smart preference
 *   - stepsToActionEntries / trajectoryStepToActionEntry for assemble/replay
 *   - buildLoginInstruction / buildStepsFromFlow / buildStepsFromActionFile
 *
 * Run:
 *   node scripts/characterization/characterize-trajectory.mjs
 *
 * Live HTTP path remains: node scripts/smoke/accept-recording-apis.mjs [baseUrl]
 */
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  TRAJECTORY_RECORD_STATUSES,
  TRAJECTORY_PHASE_STATUSES,
  normalizeActionName,
  normalizeElementJson,
  stepFromActionLog,
} from '../../src/models/helpers.js';
import { trajectoryStepToActionEntry } from '../../src/models/element.js';
import {
  buildLoginInstruction,
  stepsToActionEntries,
  buildStepsFromFlow,
  buildStepsFromActionFile,
  prepareTrajectoryRecording,
  attachTrajectoryLive,
  startTrajectoryRecording,
  stopTrajectoryRecording,
  detachTrajectoryLive,
  toggleTrajectoryManualRecord,
  getTrajectoryTree,
  getTrajectoryActionFlow,
  createTrajectoryStep,
  confirmTrajectoryStep,
  clearTrajectory,
  confirmTrajectory,
} from '../../src/services/trajectory-service.js';
import { runDefaultLogin } from '../../src/services/trajectory/trajectory-record-lifecycle.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function testStatusEnums() {
  for (const s of ['draft', 'recording', 'failed', 'recorded', 'completed']) {
    assert(TRAJECTORY_RECORD_STATUSES.includes(s), `missing recordStatus: ${s}`);
  }
  for (const s of ['pending', 'running', 'completed', 'failed']) {
    assert(TRAJECTORY_PHASE_STATUSES.includes(s), `missing phaseStatus: ${s}`);
  }
}

function testFacadeSurface() {
  const fns = {
    prepareTrajectoryRecording,
    attachTrajectoryLive,
    startTrajectoryRecording,
    stopTrajectoryRecording,
    detachTrajectoryLive,
    toggleTrajectoryManualRecord,
    getTrajectoryTree,
    getTrajectoryActionFlow,
    createTrajectoryStep,
    confirmTrajectoryStep,
    clearTrajectory,
    confirmTrajectory,
    buildLoginInstruction,
    stepsToActionEntries,
    buildStepsFromFlow,
    buildStepsFromActionFile,
  };
  for (const [name, fn] of Object.entries(fns)) {
    assert(typeof fn === 'function', `facade missing export: ${name}`);
  }
}

async function testFocusedModules() {
  const persist = await import('../../src/services/trajectory/trajectory-persist-service.js');
  const phase = await import('../../src/services/trajectory/trajectory-phase-service.js');
  const meta = await import('../../src/services/trajectory/trajectory-meta-service.js');
  const recording = await import('../../src/services/trajectory/trajectory-recording-service.js');
  const lifecycle = await import('../../src/services/trajectory/trajectory-record-lifecycle.js');
  const runtime = await import('../../src/services/trajectory/trajectory-runtime.js');
  const attach = await import('../../src/services/trajectory/trajectory-attach-service.js');
  for (const name of [
    'buildStepsFromActionFile',
    'buildStepsFromFlow',
    'persistSessionTrajectory',
    'appendRecordedStep',
    'saveFullTrajectory',
  ]) {
    assert(typeof persist[name] === 'function', `persist module missing: ${name}`);
  }
  for (const name of [
    'upsertPhaseDescription',
    'markPhaseStatus',
    'clearTrajectory',
    'addPhaseToTrajectory',
    'syncTrajectoryPhaseDescriptions',
  ]) {
    assert(typeof phase[name] === 'function', `phase module missing: ${name}`);
  }
  for (const name of [
    'createEmptyTrajectory',
    'createTransactionWithPhases',
    'analyzeRequirementToPhases',
    'confirmTrajectory',
  ]) {
    assert(typeof meta[name] === 'function', `meta module missing: ${name}`);
  }
  for (const name of [
    'getTrajectoryRuntime',
    'getAllTrajectoryRuntimes',
    'touchTrajectoryRuntimeActivity',
    'clearTrajectoryRuntimesForNode',
    'prepareTrajectoryRecording',
    'attachTrajectoryLive',
    'detachTrajectoryLive',
    'startTrajectoryRecording',
    'stopTrajectoryRecording',
    'replayTrajectorySteps',
    'resolveTrajectoryElement',
    'toggleTrajectoryManualRecord',
  ]) {
    assert(typeof recording[name] === 'function', `recording facade missing: ${name}`);
  }
  // Facade re-exports must be the same function identity as focused modules
  assert(clearTrajectory === phase.clearTrajectory, 'clearTrajectory must re-export phase module');
  assert(confirmTrajectory === meta.confirmTrajectory, 'confirmTrajectory must re-export meta module');
  assert(
    buildStepsFromFlow === persist.buildStepsFromFlow,
    'buildStepsFromFlow must re-export persist module',
  );
  assert(
    stopTrajectoryRecording === lifecycle.stopTrajectoryRecording,
    'stopTrajectoryRecording must re-export lifecycle module',
  );
  assert(
    stopTrajectoryRecording === recording.stopTrajectoryRecording,
    'trajectory-service stop must match recording facade',
  );
  assert(
    recording.touchTrajectoryRuntimeActivity === runtime.touchTrajectoryRuntimeActivity,
    'touch must re-export runtime module',
  );
  assert(
    recording.attachTrajectoryLive === attach.attachTrajectoryLive,
    'attach must re-export attach module',
  );
}

function testStopDoesNotDetach() {
  const src = Function.prototype.toString.call(stopTrajectoryRecording);
  assert(
    /detached:\s*false/.test(src),
    'stopTrajectoryRecording must return detached: false',
  );
  assert(
    /finishTransientRecording\s*\(\s*tid,\s*success\s*\?\s*'success'\s*:\s*'failure'/.test(src)
      || (src.includes("finishTransientRecording") && src.includes("'success'") && src.includes("'failure'")),
    'stop must map success→success / !success→failure via finishTransientRecording',
  );
  assert(
    !/\bdetachTrajectoryLive\b/.test(src),
    'stop must not call detachTrajectoryLive (use POST …/detach)',
  );
  assert(
    !/\bdetachExecutorLease\b/.test(src),
    'stop must not free executor lease',
  );
}

function testNormalizeActionName() {
  assert(normalizeActionName('clickElementByIndex') === 'click_element_by_index');
  assert(normalizeActionName('fillFormField') === 'fill_form_field');
  assert(normalizeActionName('fill_date_field') === 'fill_form_field');
  assert(normalizeActionName('fillDateField') === 'fill_form_field');
  assert(normalizeActionName('clickMenuItem') === 'click_menu_item');
  assert(normalizeActionName('select_option') === 'select_option');
}

function testElementSmartXpathPreference() {
  const el = normalizeElementJson({
    tag: 'button',
    text: '保存',
    xpath: '/html/body/div[9]//button',
    xpath_full: '/html/body/div[9]//button',
    xpath_smart: "//div[contains(@class,'el-drawer')]//button[normalize-space()='保存']",
    candidates: [
      { type: 'xpath_full', value: '/html/body/div[9]//button' },
      {
        type: 'xpath_smart',
        value: "//div[contains(@class,'el-drawer')]//button[normalize-space()='保存']",
      },
    ],
  });
  assert(el, 'normalizeElementJson should return object');
  assert(
    el.xpath === el.xpath_smart,
    'primary xpath must prefer xpath_smart over absolute',
  );
  assert(
    String(el.xpath_smart).includes('el-drawer'),
    'xpath_smart must be preserved',
  );
  assert(Array.isArray(el.candidates) && el.candidates.length >= 2, 'candidates kept');
}

function testStepFromActionLog() {
  const step = stepFromActionLog(
    {
      action: 'clickElementByIndex',
      params: { index: 12, text: '保存' },
      element: {
        tag: 'button',
        text: '保存',
        xpath_smart: "//button[normalize-space()='保存']",
        xpath_full: '/html/body/div[1]/button',
        candidates: [
          { type: 'xpath_smart', value: "//button[normalize-space()='保存']" },
        ],
      },
      success: true,
      result: 'clicked',
    },
    { trajectoryId: 42, stepNumber: 3, phaseNumber: 2, source: 'agent' },
  );
  assert(step.trajectoryId === 42);
  assert(step.stepNumber === 3);
  assert(step.phaseNumber === 2);
  assert(step.actionType === 'click_element_by_index');
  assert(step.source === 'agent');
  assert(step.element?.xpath_smart?.includes('保存'));
  assert(step.element?.xpath === step.element?.xpath_smart);
  assert(step.extractedContent === 'clicked');
}

function testStepsToActionEntries() {
  const entries = stepsToActionEntries([
    {
      actionType: 'click_element_by_index',
      phaseNumber: 1,
      stepNumber: 1,
      params: { index: 1 },
      element: {
        tag: 'li',
        text: '客户管理',
        xpath: '/html/body/.../li[3]',
        xpath_smart: "//li[contains(@class,'el-menu-item')][normalize-space()='客户管理']",
        candidates: [
          {
            type: 'xpath_smart',
            value: "//li[contains(@class,'el-menu-item')][normalize-space()='客户管理']",
          },
        ],
      },
      extractedContent: 'ok',
      source: 'agent',
    },
  ]);
  assert(entries.length === 1);
  const e = entries[0];
  assert(e.action === 'click_element_by_index');
  assert(e.target === e.element.xpath_smart, 'assemble target must prefer xpath_smart');
  assert(e.params?.text === '客户管理', 'text backfilled into params for text-first replay');
  assert(e.persisted === true);
  assert(e.phase === 1);
}

function testTrajectoryStepToActionEntry() {
  const entry = trajectoryStepToActionEntry({
    id: 99,
    actionType: 'click_element_by_index',
    phaseNumber: 2,
    trajectoryPhaseId: 7,
    params: { index: 5 },
    element: {
      tag: 'button',
      text: '保存',
      xpath: '/abs',
      xpath_smart: "//button[normalize-space()='保存']",
      candidates: [{ type: 'xpath_smart', value: "//button[normalize-space()='保存']" }],
    },
    extractedContent: 'ok',
  });
  assert(entry.action === 'click_element_by_index');
  assert(entry.target === "//button[normalize-space()='保存']");
  assert(entry.element.xpath_smart === entry.target);
  assert(entry.params.text === '保存');
  assert(entry.stepId === '99');
  assert(entry.phaseId === 7);
  assert(entry.phase === 2);
}

function testBuildLoginInstruction() {
  let threw = false;
  try {
    buildLoginInstruction({ account: 'u' }, {});
  } catch (err) {
    threw = true;
    assert(err.statusCode === 400, 'empty url → 400');
  }
  assert(threw, 'buildLoginInstruction must require url');

  const task = buildLoginInstruction(
    { account: 'admin', password: 'secret' },
    { url: 'https://example.com/login' },
  );
  assert(task.includes('Navigate to https://example.com/login'));
  assert(task.includes('Enter username: admin'));
  assert(task.includes('Enter password: secret'));
  assert(task.includes('Click the login/submit button'));
}

function testRunDefaultLoginHardcoded() {
  const body = Function.prototype.toString.call(runDefaultLogin);
  // replay 会话编排已统一到 runReplayActions helper（字面量样板移入 helper），
  // 此处断言调用关系与语义保持：委托调用 + 动作数组 + 超时 + 抑制持久化仍在本函数。
  assert(/runReplayActions/.test(body), 'runDefaultLogin delegates to runReplayActions');
  assert(/go_to_url/.test(body), 'runDefaultLogin includes go_to_url');
  assert(/['"]login['"]/.test(body), 'runDefaultLogin includes login action');
  assert(/180000/.test(body), 'login replay timeout is 180000ms');
  assert(/stopOnFail:\s*true/.test(body), 'login replay stopOnFail');
  // helper 契约：replay_actions/waitForSessionEvent/no-op 免疫由 helper 统一承载
  const helper = readFileSync(new URL('../../src/services/replay-actions.js', import.meta.url), 'utf8');
  assert(/replay_actions/.test(helper), 'helper sends replay_actions');
  assert(/replay_done/.test(helper), 'helper waits for replay_done');
  assert(/stop_on_fail/.test(helper), 'helper forwards stop_on_fail');
  assert(!/event:\s*['"]step['"]/.test(body), 'must not send Agent step event');
  assert(!/max_steps:\s*10/.test(body), 'must not start Agent with max_steps 10');
  assert(!/phase_done/.test(body), 'must not wait phase_done');
  assert(!/buildLoginInstruction/.test(body), 'must not build NL login instruction');
  assert(/suppressStepPersist/.test(body), 'still suppress persist');
  assert(/loginDone/.test(body), 'sets loginDone');
}

function testBuildStepsHelpers() {
  const fromFlow = buildStepsFromFlow([
    { type: 'go_to_url', params: { url: 'https://x' } },
    { type: 'done' },
    { type: 'click_element_by_index', phaseNumber: 1, params: { index: 1 }, element: { text: 'a' } },
  ]);
  assert(fromFlow.length === 2, 'done filtered out');
  assert(fromFlow[0].actionType === 'go_to_url');
  assert(fromFlow[1].phaseNumber === 1);
  assert(fromFlow[1].source === 'agent');

  const dir = mkdtempSync(join(tmpdir(), 'traj-char-'));
  try {
    const path = join(dir, 'action.json');
    writeFileSync(
      path,
      JSON.stringify({
        commands: [
          {
            action: 'fillFormField',
            params: { label: '姓名', value: '张三' },
            phase: 1,
            element: { tag: 'input', xpath_smart: "//label[contains(.,'姓名')]/.." },
          },
        ],
      }),
    );
    const steps = buildStepsFromActionFile(path);
    assert(steps.length === 1);
    assert(steps[0].actionType === 'fill_form_field');
    assert(steps[0].stepNumber === 1);
    assert(steps[0].phaseNumber === 1);
    assert(steps[0].element?.xpath_smart?.includes('姓名'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  assert(buildStepsFromActionFile('/nonexistent/action.json').length === 0);
}

async function main() {
  console.log('\n=== Trajectory critical-path characterization ===\n');
  const tests = [
    ['status enums', testStatusEnums],
    ['facade surface', testFacadeSurface],
    ['focused modules', testFocusedModules],
    ['stop ≠ detach', testStopDoesNotDetach],
    ['normalizeActionName', testNormalizeActionName],
    ['element xpath_smart', testElementSmartXpathPreference],
    ['stepFromActionLog', testStepFromActionLog],
    ['stepsToActionEntries', testStepsToActionEntries],
    ['trajectoryStepToActionEntry', testTrajectoryStepToActionEntry],
    ['buildLoginInstruction', testBuildLoginInstruction],
    ['runDefaultLogin hardcoded', testRunDefaultLoginHardcoded],
    ['buildSteps helpers', testBuildStepsHelpers],
  ];
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed += 1;
      console.log(`  ✗ ${name} — ${err.message}`);
    }
  }
  console.log(failed ? `\nFAILED (${failed})\n` : '\nOK\n');
  process.exit(failed ? 1 : 0);
}

main();
