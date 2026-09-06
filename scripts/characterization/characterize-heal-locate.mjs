/**
 * Table-driven characterization for the Heal-Locate MVP rule engine + contract.
 *
 * Pins:
 *  - D3 category mapping for every trigger signal
 *  - D3 priority (combined signals win by priority, not by token order)
 *  - D5 contract field completeness and prompt/runtime separation
 *  - evidence contains only deterministic input facts
 *
 * Usage: node scripts/characterization/characterize-heal-locate.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeMissingReason } from '../../src/services/trajectory/missing-reason-analyzer.js';
import {
  buildHealContract,
  TARGET_KEYS,
  RUNTIME_KEYS,
} from '../../src/services/trajectory/heal-contract.js';
import {
  buildStepHealInstruction,
  buildFormStructureHealInstruction,
} from '../../src/routes/browser-session/heal-instruction.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf-8');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`OK: ${name}`);
}

function reason(input) {
  return analyzeMissingReason(input);
}

const cases = [
  {
    name: 'changed_structure: healType form_structure wins over visible-error tokens',
    input: { healType: 'form_structure', errorResult: 'xpath-not-found', action: 'save_form_snapshot' },
    category: 'changed_structure',
    action: 'repair',
  },
  {
    name: 'changed_structure: report added_required non-empty',
    input: {
      healType: 'step',
      action: 'save_form_snapshot',
      errorResult: 'form-structure:{"added_required":["新字段"]}',
      formStructureReport: { added_required: ['新字段'] },
    },
    category: 'changed_structure',
    action: 'repair',
  },
  {
    name: 'changed_structure: report missing_required non-empty',
    input: {
      healType: 'step',
      errorResult: 'form-structure:{"missing_required":["旧字段"]}',
      formStructureReport: { missing_required: ['旧字段'] },
    },
    category: 'changed_structure',
    action: 'repair',
  },
  {
    name: 'business_locked: disabled token',
    input: { errorResult: 'field-disabled:客户名称' },
    category: 'business_locked',
    action: 'skip',
  },
  {
    name: 'business_locked: read-only token',
    input: { errorResult: 'control is read-only' },
    category: 'business_locked',
    action: 'skip',
  },
  {
    name: 'business_locked: locked token',
    input: { errorResult: 'business record locked' },
    category: 'business_locked',
    action: 'skip',
  },
  {
    name: 'permission_blocked: 403 token',
    input: { errorResult: 'HTTP 403 forbidden' },
    category: 'permission_blocked',
    action: 'skip',
  },
  {
    name: 'permission_blocked: unauthorized token (no business token)',
    input: { errorResult: 'unauthorized request' },
    category: 'permission_blocked',
    action: 'skip',
  },
  {
    name: 'permission_blocked: 无权限 token (no business token)',
    input: { errorResult: '无权限访问该页面' },
    category: 'permission_blocked',
    action: 'skip',
  },
  {
    name: 'conditional_absent: ok-skip marker',
    input: { errorResult: 'ok-skip:label-not-found | field absent — skip' },
    category: 'conditional_absent',
    action: 'skip',
  },
  {
    name: 'conditional_absent: context absentSkip flag',
    input: { errorResult: 'unrelated', context: { absentSkip: true } },
    category: 'conditional_absent',
    action: 'skip',
  },
  {
    name: 'conditional_absent: absent-skip marker',
    input: { errorResult: 'absent-skip' },
    category: 'conditional_absent',
    action: 'skip',
  },
  {
    name: 'not_loaded: timeout token',
    input: { errorResult: 'Timeout waiting for replay_done' },
    category: 'not_loaded',
    action: 'retry',
  },
  {
    name: 'not_loaded: loading token',
    input: { errorResult: 'page still loading' },
    category: 'not_loaded',
    action: 'retry',
  },
  {
    name: 'not_loaded: context timeout flag',
    input: { errorResult: 'unrelated', context: { timeout: true } },
    category: 'not_loaded',
    action: 'retry',
  },
  {
    name: 'not_visible: label-not-found without absent flag',
    input: { errorResult: 'label-not-found' },
    category: 'not_visible',
    action: 'heal',
  },
  {
    name: 'not_visible: xpath-not-found',
    input: { errorResult: 'xpath-not-found' },
    category: 'not_visible',
    action: 'heal',
  },
  {
    name: 'not_visible: option-not-found',
    input: { errorResult: 'option-not-found:张三' },
    category: 'not_visible',
    action: 'heal',
  },
  {
    name: 'not_visible: no-items',
    input: { errorResult: 'no-items' },
    category: 'not_visible',
    action: 'heal',
  },
  {
    name: 'not_visible: false_ok value mismatch',
    input: { errorResult: 'false_ok:expected=张三,actual=李四' },
    category: 'not_visible',
    action: 'heal',
  },
  {
    name: 'unknown: no known signal',
    input: { errorResult: 'some future error string' },
    category: 'unknown',
    action: 'fail',
  },
  {
    name: 'unknown: empty errorResult',
    input: { errorResult: '' },
    category: 'unknown',
    action: 'fail',
  },
];

for (const c of cases) {
  check(`category: ${c.name}`, () => {
    const r = reason(c.input);
    assert.equal(r.category, c.category, `category ${r.category} != ${c.category}`);
    assert.equal(r.suggestedAction, c.action, `suggestedAction ${r.suggestedAction} != ${c.action}`);
    assert.equal(typeof r.confidence, 'number', 'confidence is number');
    assert.ok(r.confidence >= 0 && r.confidence <= 1, 'confidence in [0,1]');
    assert.ok(Array.isArray(r.evidence), 'evidence is array');
  });
}

check('unknown confidence <= 0.3', () => {
  const r = reason({ errorResult: 'no signal at all' });
  assert.ok(r.confidence <= 0.3, `unknown confidence ${r.confidence} > 0.3`);
  assert.equal(r.suggestedAction, 'fail');
});

check('priority: business_locked beats not_visible', () => {
  assert.equal(reason({ errorResult: 'disabled and xpath-not-found' }).category, 'business_locked');
});

check('priority: changed_structure beats business_locked', () => {
  assert.equal(
    reason({
      healType: 'form_structure',
      errorResult: 'disabled and xpath-not-found',
    }).category,
    'changed_structure',
  );
});

check('priority: conditional_absent beats not_loaded', () => {
  assert.equal(
    reason({ errorResult: 'ok-skip:label-not-found timeout' }).category,
    'conditional_absent',
  );
});

check('priority: not_loaded beats not_visible', () => {
  assert.equal(
    reason({ errorResult: 'loading then xpath-not-found' }).category,
    'not_loaded',
  );
});

check('errorResult object is normalized to JSON text', () => {
  const r = reason({ errorResult: { error: 'xpath-not-found' } });
  assert.equal(r.category, 'not_visible');
  assert.ok(r.evidence.some((e) => e.startsWith('error={')), 'object error stringified in evidence');
});

check('evidence only carries deterministic input facts', () => {
  const r = reason({
    action: 'fill_form_field',
    errorResult: 'xpath-not-found',
    context: { previousAction: 'click_menu_item', timeout: true },
  });
  assert.ok(r.evidence.includes('action=fill_form_field'));
  assert.ok(r.evidence.some((e) => e.startsWith('error=xpath-not-found')));
  assert.ok(r.evidence.includes('context.timeout=true'));
  assert.ok(r.evidence.includes('previous_action=click_menu_item'));
  for (const item of r.evidence) {
    assert.ok(typeof item === 'string' && item.length > 0, 'evidence item is non-empty string');
    assert.ok(!/page_state|visible_element|dom=/.test(item), 'evidence must not invent page state');
  }
});

check('contract: Type A fields complete + prompt/runtime separated', () => {
  const contract = buildHealContract({
    failedEntry: {
      action: 'fill_form_field',
      params: { label_text: '客户名称', value: '张三' },
      element: { xpath_smart: '//div[contains(@class,"el-form-item")]//input', xpath_full: '/html/body/input' },
    },
    errorResult: 'xpath-not-found',
    healType: 'step',
    maxSteps: 12,
  });
  assert.equal(contract.mode, 'heal');
  assert.equal(contract.scope, 'step');
  assert.equal(contract.strategy, 'visibility_recovery');
  assert.equal(contract.reason.category, 'not_visible');
  assert.equal(contract.reason.suggestedAction, 'heal');
  assert.equal(contract.target.action, 'fill_form_field');
  assert.equal(contract.target.label, '客户名称');
  assert.equal(contract.target.xpath_smart, '//div[contains(@class,"el-form-item")]//input');
  assert.equal(contract.target.option_text, '');
  assert.deepEqual(contract.runtime, { retry_count: 1, max_steps: 12 });
  assert.deepEqual(Object.keys(contract.target).sort(), [...TARGET_KEYS].sort());
  assert.deepEqual(Object.keys(contract.runtime).sort(), [...RUNTIME_KEYS].sort());
});

check('contract: Type B scope/strategy/reason', () => {
  const contract = buildHealContract({
    failedEntry: {
      action: 'save_form_snapshot',
      params: { container: 'main' },
    },
    errorResult: 'form-structure:{"added_required":["新增字段"]}',
    formStructureReport: { added_required: ['新增字段'], added_optional: [], missing_required: [], missing_optional: [] },
    healType: 'form_structure',
    maxSteps: 24,
    retryCount: 1,
  });
  assert.equal(contract.scope, 'form_structure');
  assert.equal(contract.strategy, 'structure_repair');
  assert.equal(contract.reason.category, 'changed_structure');
  assert.equal(contract.reason.suggestedAction, 'repair');
  assert.equal(contract.runtime.max_steps, 24);
  assert.ok(contract.reason.evidence.includes('heal_type=form_structure'));
  assert.ok(contract.reason.evidence.includes('report.added_required=non_empty'));
});

check('contract: not_loaded maps to retry_current_step', () => {
  const contract = buildHealContract({
    failedEntry: { action: 'click_menu_item', params: {} },
    errorResult: 'Timeout waiting for replay_done',
    healType: 'step',
    maxSteps: 12,
  });
  assert.equal(contract.scope, 'step');
  assert.equal(contract.strategy, 'retry_current_step');
  assert.equal(contract.reason.category, 'not_loaded');
  assert.equal(contract.reason.suggestedAction, 'retry');
});

check('contract: old callers without reason still get a valid contract', () => {
  const contract = buildHealContract({});
  assert.equal(contract.mode, 'heal');
  assert.equal(contract.scope, 'step');
  assert.equal(contract.strategy, 'visibility_recovery');
  assert.equal(contract.reason.category, 'unknown');
  assert.equal(contract.reason.suggestedAction, 'fail');
  assert.equal(contract.reason.confidence, 0.2);
  assert.deepEqual(contract.runtime, { retry_count: 1, max_steps: 12 });
});

check('instruction: Type A legacy text unchanged + analysis appended', () => {
  const entry = {
    action: 'fill_form_field',
    params: { label_text: '客户名称', value: '张三' },
  };
  const legacy = buildStepHealInstruction(entry, 'xpath-not-found');
  assert.match(legacy, /当前为步骤回放失败后的单步自愈阶段/);
  assert.match(legacy, /【失败动作】fill_form_field/);
  assert.doesNotMatch(legacy, /【失败分析】/);
  const contract = buildHealContract({ failedEntry: entry, errorResult: 'xpath-not-found' });
  const structured = buildStepHealInstruction(entry, 'xpath-not-found', { contract });
  assert.match(structured, /当前为步骤回放失败后的单步自愈阶段/);
  assert.match(structured, /【失败分析】\ncategory=not_visible\nsuggestedAction=heal/);
  assert.ok(
    structured.startsWith(legacy),
    'legacy prefix is byte-for-byte unchanged when analysis is appended',
  );
});

check('instruction: Type B appends changed_structure analysis', () => {
  const report = { container: 'main', added_required: ['新增字段'] };
  const instruction = buildFormStructureHealInstruction(report);
  assert.match(instruction, /当前为【表单结构变化自愈】阶段/);
  assert.match(instruction, /【失败分析】\ncategory=changed_structure\nsuggestedAction=repair/);
});

check('wiring: Type A builds and forwards heal_contract', () => {
  const runner = read('src/services/trajectory/replay-batch-runner.js');
  assert.match(runner, /buildHealContract\(\{/);
  assert.match(runner, /buildStepHealInstruction\(entry, failResult, \{ contract \}\)/);
  assert.match(runner, /runHealStep\(runtime, instruction, HEAL_MAX_STEPS, 'step', contract\)/);
  assert.match(runner, /const previousAction = i > 0 \? actions\[i - 1\]\?\.action/);
  assert.match(runner, /context: \{ previousAction \}/);
});

check('wiring: Type B builds and forwards heal_contract', () => {
  const fsh = read('src/services/trajectory/form-structure-heal.js');
  assert.match(fsh, /buildHealContract\(\{/);
  assert.match(fsh, /buildFormStructureHealInstruction\(\{/);
  assert.match(
    fsh,
    /runHealStep\(runtime, instruction, FORM_STRUCTURE_HEAL_MAX_STEPS, 'form_structure', contract\)/,
  );
});

check('wiring: runHealStep appends heal_contract and keeps legacy fields', () => {
  const shared = read('src/services/trajectory/replay-heal-shared.js');
  assert.match(shared, /healContract = null/);
  assert.match(shared, /heal_contract: healContract/);
  assert.match(shared, /heal_type: healType,/);
  assert.match(shared, /healType,/);
});

check('wiring: session.step pass-through on both control plane and executor', () => {
  const client = read('src/executor-session-client.js');
  const handler = read('executor/session-handler.js');
  assert.match(client, /healContract: data\.heal_contract \?\? data\.healContract/);
  assert.match(handler, /heal_contract: payload\.healContract \?\? payload\.heal_contract/);
});

console.log(`\nAll heal-locate characterizations passed (${passed} checks).`);
