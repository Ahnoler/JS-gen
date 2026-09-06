/**
 * Characterization for H4/P2 heal-decision routing gate.
 *
 * Default flag off keeps the existing heal flow; when
 * HEAL_LOCATE_DECISION_ENABLED=1 the Type A runner routes skip/fail/retry
 * before calling runHealStep.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DECISION_FLAG,
  healDecisionEnabled,
  routeSuggestedAction,
} from '../../src/services/trajectory/heal-decision.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const runner = readFileSync(path.join(root, 'src/services/trajectory/replay-batch-runner.js'), 'utf-8');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`OK: ${name}`);
}

check('flag is off for empty env', () => {
  assert.equal(healDecisionEnabled({}), false);
  assert.equal(healDecisionEnabled({ [DECISION_FLAG]: '' }), false);
  assert.equal(healDecisionEnabled({ [DECISION_FLAG]: '0' }), false);
  assert.equal(healDecisionEnabled({ [DECISION_FLAG]: 'true' }), false);
});

check('flag is on only for exact 1', () => {
  assert.equal(healDecisionEnabled({ [DECISION_FLAG]: '1' }), true);
});

check('default routing never changes control flow', () => {
  for (const suggestedAction of ['skip', 'fail', 'retry', 'heal', 'repair', 'unknown']) {
    assert.equal(
      routeSuggestedAction({ suggestedAction, enabled: false }),
      'heal_current',
      `${suggestedAction} defaults to heal_current`,
    );
  }
});

check('enabled routing maps suggestedAction', () => {
  assert.equal(routeSuggestedAction({ suggestedAction: 'skip', enabled: true }), 'skip');
  assert.equal(routeSuggestedAction({ suggestedAction: 'fail', enabled: true }), 'fail');
  assert.equal(routeSuggestedAction({ suggestedAction: 'retry', enabled: true }), 'retry');
  assert.equal(routeSuggestedAction({ suggestedAction: 'heal', enabled: true }), 'heal_current');
  assert.equal(routeSuggestedAction({ suggestedAction: 'repair', enabled: true }), 'heal_current');
  assert.equal(routeSuggestedAction({ suggestedAction: 'unknown', enabled: true }), 'heal_current');
});

check('Type A runner imports and gates the decision flag', () => {
  assert.match(runner, /healDecisionEnabled, routeSuggestedAction/);
  assert.match(runner, /route = routeSuggestedAction\(/);
  assert.match(runner, /enabled: healDecisionEnabled\(\)/);
});

check('Type A runner implements skip branch', () => {
  assert.match(runner, /if \(route === 'skip'\) \{/);
  assert.match(runner, /decision: 'skip'/);
  assert.match(runner, /skipped-by-decision/);
  assert.match(runner, /continue;/);
});

check('Type A runner implements fail branch without runHealStep', () => {
  assert.match(runner, /if \(route === 'fail'\) \{/);
  assert.match(runner, /decision: 'fail'/);
  const failBranch = runner.slice(
    runner.indexOf("if (route === 'fail') {"),
    runner.indexOf('await runHealStep', runner.indexOf("if (route === 'fail') {")),
  );
  assert.match(failBranch, /emitReplay\('replay:finished'/);
  assert.doesNotMatch(failBranch, /runHealStep/);
});

check('Type A runner implements bounded retry before heal fallback', () => {
  assert.match(runner, /if \(route === 'retry'\) \{/);
  assert.match(runner, /const retryLimit = Math\.max\(1, Math\.min\(Number\(contract\.runtime\?\.retry_count\) \|\| 1, 3\)\)/);
  assert.match(runner, /forwardReplayEntry\(runtime, entry, doSuppress\)/);
  assert.match(runner, /markStepReplayOk\(stepId\)/);
  assert.match(runner, /decision: 'retry'/);
  const retryBranch = runner.slice(
    runner.indexOf("if (route === 'retry') {"),
    runner.indexOf('await runHealStep', runner.indexOf("if (route === 'retry') {")),
  );
  assert.match(retryBranch, /retriedOk/);
  assert.match(retryBranch, /continue;/);
});

check('heal fallback still follows retry failure', () => {
  const afterRetry = runner.slice(runner.indexOf("if (!runtime.abortReplay) {", runner.indexOf("if (route === 'retry') {")));
  assert.match(afterRetry, /await runHealStep\(runtime, instruction, HEAL_MAX_STEPS, 'step', contract\)/);
});

console.log(`\nAll heal-decision characterizations passed (${passed} checks).`);
