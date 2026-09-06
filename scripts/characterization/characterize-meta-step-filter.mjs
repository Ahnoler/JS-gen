/**
 * Characterization: product hides meta steps (save_form_snapshot etc.).
 * Run: node scripts/characterization/characterize-meta-step-filter.mjs
 */
import assert from 'node:assert/strict';
import {
  META_STEP_ACTIONS,
  isMetaStepAction,
  isMetaStep,
  filterMetaSteps,
} from '../../src/models/meta-step-actions.js';

assert.ok(META_STEP_ACTIONS.includes('save_form_snapshot'));
assert.equal(isMetaStepAction('save_form_snapshot'), true);
assert.equal(isMetaStepAction('fill_form_field'), false);
assert.equal(isMetaStep({ actionType: 'save_form_snapshot' }), true);
assert.equal(isMetaStep({ action: 'click_element_by_index' }), false);

const mixed = [
  { id: 1, actionType: 'fill_form_field' },
  { id: 2, actionType: 'save_form_snapshot' },
  { id: 3, actionType: 'select_option' },
  { id: 4, actionType: 'get_pending_tasks' },
];
assert.deepEqual(
  filterMetaSteps(mixed).map((s) => s.id),
  [1, 3],
);
assert.equal(filterMetaSteps(mixed, { includeMeta: true }).length, 4);

// Routes / query / persist / replay wiring cues
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const querySrc = readFileSync(join(root, 'src/services/trajectory/trajectory-query-service.js'), 'utf8');
const stepSrc = readFileSync(join(root, 'src/services/trajectory/trajectory-step-service.js'), 'utf8');
const persistSrc = readFileSync(join(root, 'src/routes/browser-session/persist-live.js'), 'utf8');
const replaySrc = readFileSync(join(root, 'src/services/trajectory/trajectory-session-replay.js'), 'utf8');
const treeRoute = readFileSync(join(root, 'src/routes/v2/trajectory.js'), 'utf8');
const phaseRoute = readFileSync(join(root, 'src/routes/v2/trajectory-steps.js'), 'utf8');

assert.match(querySrc, /filterMetaSteps/);
assert.match(querySrc, /includeMeta/);
assert.match(stepSrc, /META_STEP_ACTIONS/);
assert.match(stepSrc, /whereNotIn\('action_type'/);
assert.match(persistSrc, /isMetaStepAction/);
assert.match(persistSrc, /do not push live UI noise|Meta checkpoints stay in DB/);
assert.match(replaySrc, /META_STEP_ACTIONS/);
assert.match(replaySrc, /Auto-include meta checkpoints/);
assert.match(treeRoute, /includeMeta/);
assert.match(phaseRoute, /includeMeta/);

console.log('characterize-meta-step-filter: OK');
