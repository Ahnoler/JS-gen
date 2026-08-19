/**
 * Lightweight smoke for dialog screenshot V3 integration.
 * Does not require MySQL.
 */
import assert from 'node:assert/strict';
import {
  buildScreenshotEntries,
  buildV3Properties,
} from '../../src/services/transaction-export-v3.js';

// buildScreenshotEntries should output type=dialog entry from dialogScreenshots rows
const { entries, idByDialog } = buildScreenshotEntries({
  traj: { id: 157 },
  phases: [],
  phaseScreenshots: [],
  dialogScreenshots: [
    {
      id: 456,
      imageUrl: 'http://minio/uara-step-phase-picture/screenshots/dialog-456.png',
      metadataJson: {
        dialog: true,
        phaseNumber: 2,
        dialogKey: 'page-2|dialog:地址选择器',
        dialogTitle: '地址选择器',
      },
    },
  ],
});
assert.equal(entries.length, 1, 'should output one dialog screenshot entry');
const e = entries[0];
assert.equal(e.type, 'dialog', 'type=dialog');
assert.equal(e.eventTypeValue, 'click', 'eventTypeValue=click');
assert.equal(e.eventTypeName, '点击', 'eventTypeName=点击');
assert.equal(e.elementType, '', 'elementType empty');
assert.equal(e.mothed, '', 'mothed empty');
assert.ok(Array.isArray(e.screenshot) && e.screenshot[0] === 'http://minio/uara-step-phase-picture/screenshots/dialog-456.png', 'screenshot array has url');
assert.equal(typeof e.propertiesID, 'string', 'propertiesID is string');
assert.equal(e.propertiesID, '1', 'propertiesID="1"');
assert.equal(typeof e.propertiesPID, 'string', 'propertiesPID is string');
assert.equal(e.propertiesPID, '0', 'propertiesPID="0" (no parent)');
assert.equal(e.realLabel, '', 'realLabel empty');
assert.equal(e.id, undefined, 'no id field (use propertiesID)');
assert.equal(e.pid, undefined, 'no pid field (use propertiesPID)');
assert.equal(e.label, undefined, 'no label field (use realLabel)');
assert.equal(e.regionId, '', 'regionId empty');
assert.equal(e.regionLabel, '', 'regionLabel empty');
assert.deepEqual(e.rect, {}, 'rect empty object');
assert.equal(e.scanIndex, undefined, 'no scanIndex');
assert.equal(e.key, undefined, 'no key field');
assert.equal(e.name, undefined, 'no name field');
assert.equal(e.phaseNumber, undefined, 'no phaseNumber field');
assert.equal(e.url, undefined, 'no url field (use screenshot array)');
assert.equal(e.bucket, undefined, 'no bucket field');
assert.equal(e.file, undefined, 'no file field');
assert.equal(e.expires, undefined, 'no expires field');
assert.equal(idByDialog.get('地址选择器'), Number(e.propertiesID), 'idByDialog maps dialog title to entry numeric id');

// buildV3Properties should assign dialog pid (numeric, pointing at screenshot entry id) for overlay steps
const dialogShotId = idByDialog.get('地址选择器');
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
  screenshotCount: entries.length,
  idByPhase: new Map(),
  idByDialog,
});
assert.equal(properties[0].propertiesPID, String(dialogShotId), 'dialog propertiesPID (string) points at screenshot entry id');

console.log('ok: characterize-dialog-screenshot');
