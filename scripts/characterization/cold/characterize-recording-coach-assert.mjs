import assert from 'node:assert/strict';
import { assertSteps } from '../../../tools/recording-coach/src/assert-steps.mjs';

// (a) recorded + 0 steps → fail
{
  const r = assertSteps(
    { recordStatus: 'recorded', stepCount: 0, steps: [] },
    { rejectZeroStepRecorded: true, minStepCount: 1 },
  );
  assert.equal(r.pass, false);
  assert.ok(r.reasons.some((x) => x.includes('rejectZeroStepRecorded')));
  assert.equal(r.verdict, 'BLOCKED');
}

// (b) click_table_row_radio + row_text=first → pass
{
  const r = assertSteps(
    {
      recordStatus: 'recorded',
      stepCount: 2,
      steps: [
        { actionType: 'click_element_by_index', paramsJson: {} },
        {
          actionType: 'click_table_row_radio',
          paramsJson: { row_text: 'first' },
          elementJson: {
            xpath_smart:
              "//div[contains(@class,'el-dialog')]//div[contains(@class,'el-table__body-wrapper')]//tr[contains(@class,'el-table__row')][1]",
          },
        },
      ],
    },
    {
      minStepCount: 1,
      requireActionTypes: ['click_table_row_radio'],
      paramEquals: { 'click_table_row_radio.row_text': 'first' },
      xpathSmartIncludes: {
        click_table_row_radio: ['el-table__body-wrapper', 'el-table__row'],
      },
    },
  );
  assert.equal(r.pass, true, r.reasons.join('; '));
  assert.equal(r.verdict, 'DONE');
}

// (c) wrong row_text → fail
{
  const r = assertSteps(
    {
      recordStatus: 'recorded',
      stepCount: 1,
      steps: [
        {
          actionType: 'click_table_row_radio',
          paramsJson: { row_text: '26080511161570617' },
          elementJson: { xpath_smart: "//tr[.//*[normalize-space()='260805']]" },
        },
      ],
    },
    {
      requireActionTypes: ['click_table_row_radio'],
      paramEquals: { 'click_table_row_radio.row_text': 'first' },
    },
  );
  assert.equal(r.pass, false);
  assert.ok(r.reasons.some((x) => x.includes('paramEquals')));
}

// (d) honest reject from doneLogs → REJECTED
{
  const r = assertSteps(
    {
      recordStatus: 'failed',
      stepCount: 2,
      steps: [{ actionType: 'click_element_by_index', paramsJson: { text: '确认' } }],
      phases: [
        {
          status: 'completed',
          doneLogs: [{ text: '该客户已发起评级流程，请等待流程完成后再进行评级 全局流水号 abcdef' }],
        },
      ],
    },
    {
      honestReject: { enabled: true },
      requireActionTypes: ['click_table_row_radio'],
    },
  );
  assert.equal(r.pass, false);
  assert.equal(r.verdict, 'REJECTED');
  assert.match(r.rejectExcerpt, /已发起评级流程/);
}

console.log('OK characterize-recording-coach-assert');
