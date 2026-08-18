/**
 * Lightweight smoke for dialog screenshot V3 integration.
 * Does not require MySQL.
 */
import assert from 'node:assert/strict';
import {
  buildV3Screenshots,
  buildV3Properties,
} from '../../src/services/transaction-export-v3.js';

// buildV3Screenshots should output type=dialog from dialogScreenshots rows
const shots = buildV3Screenshots({
  traj: { id: 157 },
  phases: [],
  phaseScreenshots: [],
  dialogScreenshots: [
    {
      id: 456,
      metadataJson: {
        dialog: true,
        phaseNumber: 2,
        dialogKey: 'page-2|dialog:地址选择器',
        dialogTitle: '地址选择器',
      },
    },
  ],
});
assert.equal(shots.length, 1, 'should output one dialog screenshot');
assert.equal(shots[0].type, 'dialog', 'type=dialog');
assert.equal(shots[0].key, 'page-2|dialog:地址选择器', 'key matches pid');
assert.equal(shots[0].url, '/api/v2/screenshots/456/image', 'url uses screenshot id');

// buildV3Properties should assign dialog pid for overlay steps
const { properties } = buildV3Properties({
  traj: {
    id: 157,
    steps: [
      {
        stepNumber: 1,
        actionType: 'select_option',
        source: 'agent',
        trajectoryPhaseId: 2,
        phaseNumber: 2,
        elementJson: {
          tag: 'input',
          xpath: '//input[1]',
          target_kind: 'form_select',
          formLabel: '省份',
          region_id: 'overlay:地址选择器',
          region_label: '地址选择器',
        },
        paramsJson: {},
      },
    ],
  },
  phases: [{ id: 2, phaseNumber: 2, description: '' }],
});
assert.equal(properties[0].pid, 'page-2|dialog:地址选择器', 'dialog pid matches dialogKey');

console.log('ok: characterize-dialog-screenshot');
