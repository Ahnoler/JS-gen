/**
 * Characterization: operation-component signature + LLM JSON parse (no live LLM / DB).
 * Run: node scripts/characterization/characterize-operation-component.mjs
 */
import assert from 'assert';
import {
  computePhaseSignature,
  extractStableSemantics,
  normalizeSemanticText,
  parseLlmJsonObject,
  stepsToSnapshot,
  stepSignatureFragment,
} from '../../src/services/operation-component-signature.js';

function section(name) {
  console.log(`\n== ${name} ==`);
}

section('normalizeSemanticText');
assert.strictEqual(normalizeSemanticText('  客  户 名  '), '客 户 名');
assert.strictEqual(normalizeSemanticText(null), '');

section('label semantics distinguish fill targets');
const fillAccount = stepSignatureFragment({
  actionType: 'fill_form_field',
  params: { label_text: '账号', text: 'user001' },
});
const fillCustomer = stepSignatureFragment({
  actionType: 'fill_form_field',
  params: { label_text: '客户名称', text: '测试公司' },
});
assert.strictEqual(fillAccount.semantics.label_text, '账号');
assert.strictEqual(fillCustomer.semantics.label_text, '客户名称');
assert.notStrictEqual(
  JSON.stringify(fillAccount),
  JSON.stringify(fillCustomer),
  'account vs customer must differ',
);
// fill text value must NOT enter semantics
assert.ok(!('text' in fillAccount.semantics));

section('phase signatures differ by label');
const sigA = computePhaseSignature([
  { stepNumber: 1, actionType: 'fill_form_field', params: { label_text: '账号', text: 'a' } },
  { stepNumber: 2, actionType: 'click_button', params: { button_text: '登录' } },
]);
const sigB = computePhaseSignature([
  { stepNumber: 1, actionType: 'fill_form_field', params: { label_text: '客户名称', text: 'b' } },
  { stepNumber: 2, actionType: 'click_button', params: { button_text: '登录' } },
]);
assert.notStrictEqual(sigA.signature, sigB.signature);

section('same structure same signature (different fill values)');
const sigC = computePhaseSignature([
  { stepNumber: 1, actionType: 'fill_form_field', params: { label_text: '账号', text: 'other' } },
  { stepNumber: 2, actionType: 'click_button', params: { button_text: '登录' } },
]);
assert.strictEqual(sigA.signature, sigC.signature);

section('is_replay steps excluded');
const withReplay = computePhaseSignature([
  { stepNumber: 1, actionType: 'fill_form_field', params: { label_text: '账号', text: 'a' }, isReplay: true },
  { stepNumber: 2, actionType: 'click_button', params: { button_text: '登录' } },
]);
const onlyClick = computePhaseSignature([
  { stepNumber: 2, actionType: 'click_button', params: { button_text: '登录' } },
]);
assert.strictEqual(withReplay.signature, onlyClick.signature);

section('select option_text in semantics');
const sel = extractStableSemantics('select_option', { label_text: '证件类型', option_text: '身份证', value: '01' });
assert.strictEqual(sel.label_text, '证件类型');
assert.strictEqual(sel.option_text, '身份证');
assert.ok(!('value' in sel));

section('stepsToSnapshot preserves raw values');
const snap = stepsToSnapshot([
  { stepNumber: 1, actionType: 'fill_form_field', params: { label_text: '账号', text: 'secret' }, element: { xpath: '//x' } },
]);
assert.strictEqual(snap[0].params.text, 'secret');
assert.strictEqual(snap[0].elementJson.xpath, '//x');

section('parseLlmJsonObject fallbacks');
assert.deepStrictEqual(
  parseLlmJsonObject('{"name":"查询","key":"q","description":"d","paramSchema":null,"confidence":0.9}'),
  { name: '查询', key: 'q', description: 'd', paramSchema: null, confidence: 0.9 },
);
assert.strictEqual(
  parseLlmJsonObject('这里是说明\n```json\n{"name":"引入","confidence":0.5}\n```').name,
  '引入',
);
assert.strictEqual(parseLlmJsonObject('not json'), null);

console.log('\nAll characterize-operation-component checks passed.');
