/**
 * Characterization: trajectory critical path contracts (offline, no DB/server).
 *
 * Covers:
 *   - facade module surface (query / step / account / recording re-exports)
 *   - recordStatus enum + stop → recorded|draft, detached:false (≠ detach)
 *   - action log → stepFromActionLog → element xpath_smart preference
 *   - stepsToActionEntries / trajectoryStepToActionEntry for assemble/replay
 *   - buildLoginInstruction / buildStepsFromFlow / buildStepsFromActionFile
 *
 * Run:
 *   node scripts/characterize-trajectory.mjs
 *
 * Live HTTP path remains: node scripts/accept-recording-apis.mjs [baseUrl]
 */
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  TRAJECTORY_RECORD_STATUSES,
  TRAJECTORY_PHASE_STATUSES,
  normalizeActionName,
  normalizeElementJson,
  stepFromActionLog,
} from '../src/models/helpers.js';
import { trajectoryStepToActionEntry } from '../src/models/element.js';
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
} from '../src/services/trajectory-service.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function testStatusEnums() {
  for (const s of ['draft', 'live', 'recording', 'recorded', 'completed']) {
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

function testStopDoesNotDetach() {
  const src = Function.prototype.toString.call(stopTrajectoryRecording);
  assert(
    /detached:\s*false/.test(src),
    'stopTrajectoryRecording must return detached: false',
  );
  assert(
    /recordStatus\s*=\s*success\s*\?\s*'recorded'\s*:\s*'draft'/.test(src)
      || (src.includes("'recorded'") && src.includes("'draft'")),
    'stop must map success→recorded / !success→draft',
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
      description: '点击保存',
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
    description: '点保存',
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
    buildLoginInstruction({ username: 'u' }, {});
  } catch (err) {
    threw = true;
    assert(err.statusCode === 400, 'empty url → 400');
  }
  assert(threw, 'buildLoginInstruction must require url');

  const task = buildLoginInstruction(
    { username: 'admin', password: 'secret' },
    { url: 'https://example.com/login' },
  );
  assert(task.includes('Navigate to https://example.com/login'));
  assert(task.includes('Enter username: admin'));
  assert(task.includes('Enter password: secret'));
  assert(task.includes('Click the login/submit button'));
}

function testBuildStepsHelpers() {
  const fromFlow = buildStepsFromFlow([
    { type: 'go_to_url', description: 'open', params: { url: 'https://x' } },
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

function main() {
  console.log('\n=== Trajectory critical-path characterization ===\n');
  const tests = [
    ['status enums', testStatusEnums],
    ['facade surface', testFacadeSurface],
    ['stop ≠ detach', testStopDoesNotDetach],
    ['normalizeActionName', testNormalizeActionName],
    ['element xpath_smart', testElementSmartXpathPreference],
    ['stepFromActionLog', testStepFromActionLog],
    ['stepsToActionEntries', testStepsToActionEntries],
    ['trajectoryStepToActionEntry', testTrajectoryStepToActionEntry],
    ['buildLoginInstruction', testBuildLoginInstruction],
    ['buildSteps helpers', testBuildStepsHelpers],
  ];
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      fn();
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
